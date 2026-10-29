// stackEngine.js — THE stacking engine. One source, three runtimes:
//   • the app (Stack Check, src/App.jsx)
//   • the server (/evaluate, server/index.js)
//   • the screen-reader extension (bundled for JavaScriptCore by scripts/build-engine.mjs)
// Pure: no imports, no DOM, no network. Callers supply a travel-time matrix and dwell times.

export const WINDOW_MIN = 45;                        // dropoff window (min): flag only when STACKING pushes completion past max(45, solo journey)
// The sliding dropoff window, in minutes: 45·60·75·90… (+15 per +15 the solo run exceeds 37). Single
// definition — the verdict maths and the at-risk notification schedule both size their window from
// here, so the two can never drift apart. Formula unchanged from where it was first written.
export const slidingWindowMin = soloMin => WINDOW_MIN + 15*Math.max(0,Math.ceil((soloMin-37)/15));
export const STACK_GREEN_MAX_MIN  = 13;             // pickup-detour delta: <13 min = green
export const STACK_ORANGE_MAX_MIN = 17;             // pickup-detour delta: 13–17 = orange, >17 = red; also the far-pickup exempt cutoff + ⚠ line
// Stack Check time-budget assumptions. TEMPORARY flat values — once waitEngine.js has enough
// real samples for a restaurant+hour, that average OVERRIDES the flat PICKUP_DWELL_MIN below.
export const PICKUP_DWELL_MIN  = 5;                 // per pickup: parking + walking in + waiting if not ready + walking back
export const DROPOFF_DWELL_MIN = 2;                 // per drop-off: parking + walking to the door + handover

// Plan a stack of N orders (each = optional pickup + a drop-off) from your current spot (matrix
// index 0). Finds the best legal stop order (each order's pickup before its own drop) and checks
// every order delivers within the window (pickup→drop, or now→drop if already in hand). Branch-and-
// bound with a safety cap so it stays fast for the realistic 2–6 orders.
export function planStack(m, orders, dwell){
  const D=m.dur, X=m.dist;
  dwell=dwell||{};                                                          // {stopIdx: seconds spent at that stop} — pickup dwell (real wait or flat) + drop dwell (flat)
  const stopIdxs=[]; orders.forEach(o=>{ if(o.pickupIdx!=null)stopIdxs.push(o.pickupIdx); stopIdxs.push(o.dropIdx); });
  const dropToPickup={}; orders.forEach(o=>{ if(o.pickupIdx!=null)dropToPickup[o.dropIdx]=o.pickupIdx; });
  const windowsOK=()=>true;   // no flat window gate — pick the fastest stacked route; each order is judged vs its own solo baseline afterwards
  let best=null, count=0; const CAP=300000;
  (function rec(seq,used,time,arr){
    if(count>CAP)return;
    if(seq.length===stopIdxs.length){
      count++;
      const ok=windowsOK(arr), total=Math.max(0,...stopIdxs.map(i=>arr[i]));
      const cand={seq:seq.slice(),ok,total,arr:{...arr}};
      if(!best||(cand.ok&&!best.ok)||(cand.ok===best.ok&&cand.total<best.total))best=cand;
      return;
    }
    const last=seq.length?seq[seq.length-1]:0;
    for(const s of stopIdxs){
      if(used.has(s))continue;
      if(dropToPickup[s]!==undefined&&!used.has(dropToPickup[s]))continue;   // can't drop before its pickup
      const t=time+(dwell[last]||0)+D[last][s];                             // + dwell at the stop you're leaving (real wait / flat pickup / flat drop)
      if(best&&best.ok&&t>=best.total)continue;                             // prune slower partials
      used.add(s);arr[s]=t;seq.push(s);
      rec(seq,used,t,arr);
      seq.pop();used.delete(s);delete arr[s];
    }
  })([],new Set(),0,{});
  if(!best)return null;
  const arr=best.arr;
  const label={}; orders.forEach((o,i)=>{ if(o.pickupIdx!=null)label[o.pickupIdx]="P"+(i+1); label[o.dropIdx]="D"+(i+1); });

  // Stacking-detour guard — measures the EXTRA driving that STACKING imposes, not raw distance.
  // For each pickup: (a) solo = drive straight from You to it alone; (b) via route = cumulative drive
  // from You along the optimized sequence to reach it. added = (b − a). Only when 2+ orders are stacked,
  // and only added > STACK_ORANGE_MAX_MIN flags — a lone far pickup adds nothing, so it never triggers.
  const stacked = orders.length >= 2;                                      // no stacking ⇒ no detour to check
  const pickupSet=new Set(orders.filter(o=>o.pickupIdx!=null).map(o=>o.pickupIdx));
  const detourWarnings=[];
  const legs=[];                                                            // leg-by-leg breakdown of the optimized route (diagnostic)
  const addedDetour={};                                                    // {pickupIdx: EXTRA drive seconds stacking adds vs going straight there}
  { let prev=0, cum=0;                                                      // cum = cumulative DRIVE time from You (start) along the route, dwell excluded
    for(const s of best.seq){
      const secs=D[prev][s];
      cum += (secs!=null?secs:0);                                           // (b) running drive time from the start to this stop
      const endsAtPickup=pickupSet.has(s);
      let added=null, overCap=false;
      if(endsAtPickup){
        const solo=D[0][s];                                                 // (a) direct You → this pickup, alone
        added = (solo!=null) ? (cum-solo) : null;                          // (b − a): extra driving stacking adds to reach it
        addedDetour[s]=added;
        overCap = stacked && added!=null && added>STACK_ORANGE_MAX_MIN*60 && (solo==null||solo/60<=STACK_ORANGE_MAX_MIN);  // >17 EXTRA min ⇒ red, UNLESS the pickup is already >17min away (far-pickup exempt)
        if(overCap) detourWarnings.push({to:label[s], mins:Math.round(added/60)});
      }
      legs.push({from:prev===0?"You":label[prev], to:label[s], legMins:secs!=null?Math.round(secs/60*10)/10:null, cumMins:Math.round(cum/60*10)/10, soloMins:endsAtPickup&&D[0][s]!=null?Math.round(D[0][s]/60*10)/10:null, addedMins:added!=null?Math.round(added/60*10)/10:null, checked:endsAtPickup, overCap});
      prev=s;
    }
  }

  // Per-order verdict — ONLY for a real stack (2+ orders). TWO SEPARATE checks, never mixed:
  //   Check 1 — PICKUP DETOUR (13/17): delta = via-route drive to the pickup − direct You→pickup drive.
  //             <13 green · 13–17 orange · >17 red. PICKUPS ONLY — never drops, never P→D or D→D legs.
  //             Far-pickup exemption: if You→pickup already exceeds the red cap, the platform accepted
  //             that distance, so it's shown as info and never flagged.
  //   Check 2 — 45-MIN DROPOFF WINDOW: flag only when STACKING pushes completion past max(45, solo
  //             journey). A long solo journey (distance) extends the window and never flags on its own.
  // A single order gets no verdict at all (colours/banner = null).
  const RANK={green:0,orange:1,red:2}, worseColor=(a,b)=>RANK[a]>=RANK[b]?a:b;
  const pickupColor=o=>{                                                    // Check 1 — pickup detour only
    if(o.pickupIdx==null) return "green";                                             // in-hand: no pickup leg
    if((D[0][o.pickupIdx]||0)/60 > STACK_ORANGE_MAX_MIN) return "green";               // far pickup (>17min away) → exempt, info only
    const ad=addedDetour[o.pickupIdx]; if(ad==null) return "green";
    const d=ad/60;                                                                     // detour delta (min): via-route − solo direct
    return d<STACK_GREEN_MAX_MIN ? "green" : d<=STACK_ORANGE_MAX_MIN ? "orange" : "red";
  };
  // Check 2 — SLIDING dropoff window (formula + thresholds UNCHANGED). windowSecOf() exposes the sized
  // window so the incoming-order check below can read each EXISTING order's remaining slack. Window = the
  // SOLO run (You→P + pickup dwell + P→D) sized 45·60·75·90… (+15min per +15min the solo run exceeds 37).
  const windowSecOf=o=>{
    const dwellP=o.pickupIdx!=null?(dwell[o.pickupIdx]||0):0;
    const soloSec=o.pickupIdx!=null ? D[0][o.pickupIdx]+dwellP+D[o.pickupIdx][o.dropIdx] : D[0][o.dropIdx];  // solo total run to drop arrival
    return slidingWindowMin(soloSec/60)*60;
  };
  const windowColor=o=> arr[o.dropIdx] > windowSecOf(o) ? "red" : "green";                                  // over its own window (diagnostic only)

  // ── INCOMING-ORDER VERDICT ────────────────────────────────────────────────────────────────────
  // The driver has already committed to the EXISTING chain (every order except the most recently added),
  // so those are never judged — always green. Only the INCOMING order (last added) gets a verdict, based
  // purely on how taking it affects the existing orders' delivery windows in the optimized route:
  //   green  = no existing order is affected
  //   orange = it brings an existing order within EXISTING_TIGHT_MIN of its window (tight but possible)
  //   red    = it pushes an existing order past its window (would break a committed order)
  const incomingIdx=orders.length-1;                                     // most recently added = the order being evaluated
  const EXISTING_TIGHT_MIN=10;                                           // within 10min of an existing order's window ⇒ orange
  let incomingColor="green";
  orders.forEach((eo,i)=>{
    if(i===incomingIdx) return;                                          // existing chain only
    const slackMin=(windowSecOf(eo)-arr[eo.dropIdx])/60;                 // room this committed order still has in the stacked route
    incomingColor=worseColor(incomingColor, slackMin<0 ? "red" : slackMin<=EXISTING_TIGHT_MIN ? "orange" : "green");
  });

  const perOrder=orders.map((o,i)=>{
    const dwellP=o.pickupIdx!=null?(dwell[o.pickupIdx]||0):0, dwellD=dwell[o.dropIdx]||0;
    const baseline=o.pickupIdx!=null                                       // solo journey: You→P + pickup dwell + P→D + drop dwell
      ? D[0][o.pickupIdx]+dwellP+D[o.pickupIdx][o.dropIdx]+dwellD
      : D[0][o.dropIdx]+dwellD;                                            //  in-hand: You→D + drop dwell
    const actual=arr[o.dropIdx]+dwellD;                                    // completion time within the full stacked route
    const ad=o.pickupIdx!=null?addedDetour[o.pickupIdx]:null;             // pickup-detour delta (info)
    const detourMin=ad!=null?ad/60:null;
    // Existing chain = always green (already committed). Incoming order = its impact on the chain.
    const color=stacked ? (i===incomingIdx ? incomingColor : "green") : null;
    return {n:i+1, incoming:i===incomingIdx, hasPickup:o.pickupIdx!=null, color, timeColor:windowColor(o), pickColor:pickupColor(o),
            baselineMin:Math.round(baseline/60), actualMin:Math.round(actual/60), overMin:Math.round((actual-baseline)/60*10)/10,
            detourMin:detourMin!=null?Math.round(detourMin*10)/10:null,
            slackMin:Math.round((windowSecOf(o)-arr[o.dropIdx])/60*10)/10};   // room left in its own window (used by judgeOffer)
  });
  const bannerColor=stacked?incomingColor:null;                          // the whole stack's verdict = the incoming order's verdict

  let d=0,last=0; for(const s of best.seq){ d+=X[last][s]; last=s; }
  const totalPay=orders.reduce((s,o)=>s+(o.pay||0),0);
  return {
    feasible:best.ok,
    bannerColor,                                                            // "green" | "orange" | "red" — worst order colour across the stack
    perOrder,
    order:["You",...best.seq.map(i=>label[i])],
    totalMin:Math.round(best.total/60),
    totalMiles:Math.round(d/1609.34*10)/10,
    rate: totalPay>0&&best.total>0?Math.round(totalPay/(best.total/3600)):null,
    detourWarnings,                                                          // [{to,mins}] pickups where stacking adds > the cap in EXTRA driving
    stacked,                                                                 // true when 2+ orders → the detour check is active
    legs,                                                                    // [{from,to,legMins,cumMins,soloMins,addedMins,checked,overCap}] every leg
  };
}

// ── Offer verdict (screen reader) ────────────────────────────────────────────────────────────────────
// Shared by /evaluate (live Mapbox times) and the extension (offline estimate), so both say exactly the
// same thing for the same times. Inputs are coordinates only; who resolves postcodes/names is the caller.
//   start: {lat,lng}   where the run currently is (the extension has no GPS: next stop of the run)
//   run:   [{pickup:{lat,lng}|null (null once collected), drop:{lat,lng}, pay}]   accepted orders, oldest first
//   offer: {pickup:{lat,lng}|null, drop:{lat,lng}, pay}
// Returns the points to fetch a matrix for, and the orders in planStack's shape (offer last = "incoming").
export function buildOfferStack(start, run, offer){
  const points=[start], orders=[];
  for(const o of [...run, offer]){
    let pickupIdx=null;
    if(o.pickup){ points.push(o.pickup); pickupIdx=points.length-1; }
    points.push(o.drop);
    orders.push({pickupIdx, dropIdx:points.length-1, pay:o.pay||0});
  }
  return {points, orders};
}

// Verdict for the incoming (last) order against the run, plus the notification line.
// Tiers, worst wins:
//   red    — an accepted order misses its deadline, or a pickup detour goes past the red cap
//   orange — an accepted order ends within 10 min of its deadline, a detour is in the orange band,
//            or the offer's marginal £/hour (its pay over the time it adds) is below opts.minRate
//   green  — otherwise
// opts: { minRate: £/hr threshold (driver's average, default 15), offline: true → "Offline estimate" }
export const DEFAULT_MIN_RATE = 15;
export function judgeOffer(matrix, orders, opts={}){
  const dwell={};
  orders.forEach(o=>{ if(o.pickupIdx!=null)dwell[o.pickupIdx]=PICKUP_DWELL_MIN*60; dwell[o.dropIdx]=DROPOFF_DWELL_MIN*60; });
  const withOffer=planStack(matrix, orders, dwell);
  const without=orders.length>1 ? planStack(matrix, orders.slice(0,-1), dwell) : null;
  if(!withOffer) return null;
  const offer=orders[orders.length-1];
  const pay=offer.pay||0;
  const addedMin=Math.max(0, withOffer.totalMin-(without?without.totalMin:0));
  const rate=addedMin>0 ? pay/(addedMin/60) : null;                    // marginal £/hr of the added time
  const minRate=opts.minRate>0 ? opts.minRate : DEFAULT_MIN_RATE;
  const money=v=>"£"+v.toFixed(2);
  const rateTxt=rate!=null ? `(${money(rate)}/hr)` : "(no extra time)";
  const gain=`+${money(pay)} for +${addedMin} min ${rateTxt}`;

  // Deadlines: the tightest accepted order in the stacked route.
  const existing=withOffer.perOrder.filter(o=>!o.incoming);
  const tightest=existing.reduce((a,o)=>a&&a.slackMin<=o.slackMin?a:o, null);
  const late=tightest&&tightest.slackMin<0, tight=tightest&&!late&&tightest.slackMin<=10;
  // Pickup detours: the engine's own tiers (<13 green · 13–17 orange · >17 red, far pickups exempt).
  const RANK={green:0,orange:1,red:2};
  const worstPick=withOffer.perOrder.reduce((a,o)=>RANK[o.pickColor]>RANK[a.pickColor]?o:a, withOffer.perOrder[0]);
  const detourMin=worstPick&&worstPick.detourMin!=null?Math.round(worstPick.detourMin):null;

  let verdict, text;
  if(late)                                { verdict="red";    text=`❌ Skip: breaks order ${tightest.n} deadline by ${Math.ceil(-tightest.slackMin)} min`; }
  else if(worstPick.pickColor==="red")    { verdict="red";    text=`❌ Skip: pickup detour +${detourMin} min`; }
  else if(tight)                          { verdict="orange"; text=`🟠 Tight: ${gain}, order ${tightest.n} only ${Math.floor(tightest.slackMin)} min from its deadline`; }
  else if(worstPick.pickColor==="orange") { verdict="orange"; text=`🟠 Long detour: ${gain}, pickup adds ${detourMin} min`; }
  else if(rate!=null&&rate<minRate)       { verdict="orange"; text=`🟠 Fits but slow: ${gain}`; }
  else                                    { verdict="green";  text=`✅ Fits: ${gain}, all deadlines safe`; }
  if(opts.approx) text+=" · restaurant approx";
  return {verdict, addedMin, rate:rate!=null?Math.round(rate*100)/100:null, text:(opts.offline?"Offline estimate · ":"")+text, totalMin:withOffer.totalMin, offline:!!opts.offline};
}

// ── Solo verdict (no run yet): is this offer worth it on its own? ───────────────────────────────────
// With the card's miles (opts.miles): £/mile, ignoring the app's own time estimate — drivers beat it.
//   ✅ ≥ £2.00/mi (pay at least double the miles) · 🟠 ≥ £1.50/mi · ❌ below.
// Without miles (Deliveroo): £/hr = pay ÷ (trip minutes + one pickup and one drop-off dwell buffer),
// against the driver's average (opts.minRate, default £15/hr). ✅ at or above it · 🟠 below it ·
// ❌ under 60% of it.
export const POOR_FRACTION = 0.6;
export const GOOD_PER_MILE = 2.0, OK_PER_MILE = 1.5;
export function judgeSolo(pay, minutes, opts={}){
  if(!(pay>0)||(!(minutes>0)&&!(opts.miles>0))) return null;
  const money=v=>"£"+v.toFixed(2);
  if(opts.miles>0){
    const perMile=pay/opts.miles;
    const base=`${money(pay)} for ${opts.miles.toFixed(1)} mi = ${money(perMile)}/mi`;
    let verdict, text;
    if(perMile>=GOOD_PER_MILE)    { verdict="green";  text=`✅ Good offer: ${base}`; }
    else if(perMile>=OK_PER_MILE) { verdict="orange"; text=`🟠 OK: ${base} (good is ${money(GOOD_PER_MILE)}/mi)`; }
    else                          { verdict="red";    text=`❌ Poor: ${base}`; }
    if(opts.approx) text+=" · restaurant approx";
    return {verdict, perMile:Math.round(perMile*100)/100, text:(opts.offline?"Offline estimate · ":"")+text, offline:!!opts.offline};
  }
  const totalMin=Math.round(minutes+PICKUP_DWELL_MIN+DROPOFF_DWELL_MIN);
  const rate=pay/(totalMin/60);
  const avg=opts.minRate>0 ? opts.minRate : DEFAULT_MIN_RATE;
  const base=`${money(pay)} for ${totalMin} min = ${money(rate)}/hr`;
  let verdict, text;
  if(rate>=avg)                     { verdict="green";  text=`✅ Good offer: ${base}`; }
  else if(rate>=avg*POOR_FRACTION)  { verdict="orange"; text=`🟠 Below your average: ${base} (avg £${Math.round(avg)}/hr)`; }
  else                              { verdict="red";    text=`❌ Poor: ${base}`; }
  if(opts.approx) text+=" · restaurant approx";
  return {verdict, totalMin, rate:Math.round(rate*100)/100, text:(opts.offline?"Offline estimate · ":"")+text, offline:!!opts.offline};
}

// Offer labels every verdict ends with, in this order, when the card shows them.
export const VERDICT_FLAGS = ["Must verify ID","Customer verification","Heavy","Age-restricted","Exclusive","Package"];
export function appendFlags(text, flags){
  const shown=VERDICT_FLAGS.filter(f=>(flags||[]).includes(f));
  return shown.length ? `${text} · ${shown.join(" · ")}` : text;
}

import { useState, useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, setDoc, getDoc,
  collection, addDoc, query, orderBy, limitToLast,
  onSnapshot, getDocs, serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "./firebase";

const FL = document.createElement("link");
FL.rel = "stylesheet";
FL.href = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;600;700&display=swap";
document.head.appendChild(FL);

const MAPBOX_TOKEN = "pk.eyJ1Ijoia2luZ29mbWFkbmVzcyIsImEiOiJjbXAzZTFoNDYwbGNtMnBzODZuYnNiY3FvIn0.yVEwZEGgiP8gqqOIycdJWA";
const CFG = { MIN_SAMPLES: 2, COMMUNITY_MIN: 3 };

const RESTAURANTS = [
  { id:"mcdonalds",  name:"McDonald's",  baseWait:4,  rel:0.86, label:"Usually fast" },
  { id:"kfc",        name:"KFC",         baseWait:13, rel:0.42, label:"High queue risk" },
  { id:"burgerking", name:"Burger King", baseWait:6,  rel:0.70, label:"Moderate wait" },
  { id:"greggs",     name:"Greggs",      baseWait:2,  rel:0.93, label:"Very fast" },
  { id:"nandos",     name:"Nando's",     baseWait:17, rel:0.45, label:"Unpredictable" },
  { id:"fiveguys",   name:"Five Guys",   baseWait:12, rel:0.55, label:"Wait likely" },
  { id:"dominos",    name:"Domino's",    baseWait:8,  rel:0.72, label:"Usually on time" },
  { id:"pizzahut",   name:"Pizza Hut",   baseWait:10, rel:0.60, label:"Variable" },
  { id:"subway",     name:"Subway",      baseWait:5,  rel:0.80, label:"Mostly quick" },
  { id:"pret",       name:"Pret",        baseWait:3,  rel:0.88, label:"Fast grab" },
  { id:"wingstop",   name:"Wingstop",    baseWait:14, rel:0.50, label:"Often delayed" },
  { id:"leon",       name:"Leon",        baseWait:7,  rel:0.75, label:"Reliable" },
];

const AVATAR_COLORS = ["#ff6600","#00e87a","#ff3232","#00aaff","#ffd600","#aa00ff","#ff8000","#00ccbc"];
const B = { fontFamily:"'Bebas Neue',sans-serif" };
const M = { fontFamily:"'JetBrains Mono',monospace" };
const ROOT = { ...M, background:"#060606", color:"#f0f0f0", minHeight:"100vh", maxWidth:430, margin:"0 auto", userSelect:"none" };

const store = {
  get:  k     => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):null; } catch(e) { return null; } },
  set:  (k,v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch(e) {} },
  del:  k     => { try { localStorage.removeItem(k); } catch(e) {} },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function timePeriod(h) {
  if (h>=5&&h<10)  return "morning";
  if (h>=10&&h<14) return "lunch";
  if (h>=14&&h<17) return "afternoon";
  if (h>=17&&h<21) return "evening";
  return "late night";
}
function dayLabel(d) { return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d]; }

// Map Firebase auth error codes to friendly messages
function fbAuthError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "Username already taken — try another";
  if (code.includes("user-not-found"))       return "Wrong username or password";
  if (code.includes("wrong-password"))       return "Wrong username or password";
  if (code.includes("invalid-credential"))   return "Wrong username or password";
  if (code.includes("too-many-requests"))    return "Too many attempts — try again in a moment";
  if (code.includes("weak-password"))        return "Password must be at least 6 characters";
  return err?.message || "Something went wrong";
}

// We store users as {username}@delivr.app in Firebase Auth so
// drivers never have to deal with emails
function toEmail(username) { return `${username.trim().toLowerCase()}@delivr.app`; }

// ── Pattern computation (runs client-side from Firestore logs) ────────────────
function bucketStats(logs) {
  if (!logs.length) return null;
  const avg = logs.reduce((s, l) => s + l.waitMins, 0) / logs.length;
  return {
    avg:     Math.round(avg * 10) / 10,
    min:     Math.round(Math.min(...logs.map(l => l.waitMins))),
    max:     Math.round(Math.max(...logs.map(l => l.waitMins))),
    count:   logs.length,
    drivers: new Set(logs.map(l => l.username)).size,
  };
}

function computePatterns(logs) {
  const byRest = {};
  for (const log of logs) {
    (byRest[log.restaurantId] = byRest[log.restaurantId] || []).push(log);
  }
  const patterns = {};
  for (const [restId, rl] of Object.entries(byRest)) {
    const entry = { overall: bucketStats(rl), byPeriod: {}, byDayPeriod: {} };
    for (const per of ["morning","lunch","afternoon","evening","late night"]) {
      const b = rl.filter(l => l.period === per);
      if (b.length) entry.byPeriod[per] = bucketStats(b);
    }
    for (let dow = 0; dow < 7; dow++) {
      for (const per of ["morning","lunch","afternoon","evening","late night"]) {
        const b = rl.filter(l => l.dow === dow && l.period === per);
        if (b.length) entry.byDayPeriod[`${dow}_${per}`] = bucketStats(b);
      }
    }
    patterns[restId] = entry;
  }
  patterns._meta = {
    totalLogs:    logs.length,
    totalDrivers: new Set(logs.map(l => l.username)).size,
  };
  return patterns;
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function useGPS() {
  const [g,setG]=useState({lat:null,lng:null,accuracy:null,speedKmh:null,status:"pending",denied:false});
  const wid=useRef(null);
  const start=useCallback(()=>{
    if(!("geolocation" in navigator)){setG(x=>({...x,status:"error"}));return;}
    setG(x=>({...x,status:"acquiring"}));
    if(wid.current!=null)navigator.geolocation.clearWatch(wid.current);
    wid.current=navigator.geolocation.watchPosition(
      p=>setG(x=>({...x,lat:p.coords.latitude,lng:p.coords.longitude,accuracy:Math.round(p.coords.accuracy),speedKmh:p.coords.speed!=null?Math.round(p.coords.speed*3.6):null,status:"active",denied:false})),
      e=>setG(x=>({...x,status:e.code===1?"denied":"error",denied:e.code===1})),
      {enableHighAccuracy:true,timeout:10000,maximumAge:5000}
    );
  },[]);
  useEffect(()=>{start();return ()=>{if(wid.current!=null)navigator.geolocation.clearWatch(wid.current);};},[start]);
  return {...g,retry:start};
}

function distMeters(lat1,lng1,lat2,lng2) {
  if(lat1==null||lng1==null||lat2==null||lng2==null)return null;
  const R=6371000,toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

async function findNearbyBranches(lat,lng) {
  if(!MAPBOX_TOKEN||lat==null||lng==null)return[];
  const results=await Promise.all(RESTAURANTS.map(async r=>{
    try{
      const res=await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(r.name)}.json?proximity=${lng},${lat}&types=poi&limit=1&access_token=${MAPBOX_TOKEN}`);
      const g=await res.json();
      if(!g.features?.length)return null;
      const c=g.features[0].center;
      return{id:r.id,name:r.name,branchLat:c[1],branchLng:c[0]};
    }catch(e){return null;}
  }));
  return results.filter(Boolean);
}

function getPersonalWait(restId,now,waitLog) {
  const h=now.getHours(),dow=now.getDay(),per=timePeriod(h);
  const logs=waitLog.filter(l=>l.restaurantId===restId);
  if(!logs.length)return null;
  const sameDayPer=logs.filter(l=>l.dow===dow&&l.period===per);
  const samePer=logs.filter(l=>l.period===per);
  let bucket,context;
  if(sameDayPer.length>=CFG.MIN_SAMPLES){bucket=sameDayPer;context=dayLabel(dow)+" "+per;}
  else if(samePer.length>=CFG.MIN_SAMPLES){bucket=samePer;context=per;}
  else if(logs.length>=CFG.MIN_SAMPLES){bucket=logs;context="all visits";}
  else{bucket=logs;context="1 visit";}
  const avg=bucket.reduce((s,l)=>s+l.waitMins,0)/bucket.length;
  return{avg:Math.round(avg*10)/10,min:Math.min(...bucket.map(l=>l.waitMins)),max:Math.max(...bucket.map(l=>l.waitMins)),count:logs.length,bucketCount:bucket.length,context,hasEnough:bucket.length>=CFG.MIN_SAMPLES};
}

function getCommunityWait(restId,now,patterns) {
  const p=patterns[restId];
  if(!p)return null;
  const dow=now.getDay(),per=timePeriod(now.getHours());
  const b=p.byDayPeriod?.[`${dow}_${per}`]||p.byPeriod?.[per]||p.overall;
  if(!b||b.count<CFG.COMMUNITY_MIN)return null;
  return{avg:b.avg,min:b.min,max:b.max,count:b.count,drivers:b.drivers};
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function LiveTimer({startedAt}) {
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{
    const tick=()=>setElapsed(Math.floor((Date.now()-new Date(startedAt))/1000));
    tick();const id=setInterval(tick,1000);return ()=>clearInterval(id);
  },[startedAt]);
  const m=Math.floor(elapsed/60),s=elapsed%60;
  return<span style={{...M,fontSize:56,fontWeight:700,color:"#ff6600",letterSpacing:2,fontVariantNumeric:"tabular-nums"}}>{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}</span>;
}

function PasswordInput({value,onChange,placeholder}) {
  const [show,setShow]=useState(false);
  return(
    <div style={{position:"relative"}}>
      <input type={show?"text":"password"} value={value} onChange={onChange} placeholder={placeholder||"Password"}
        style={{width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:14,padding:"16px 48px 16px 18px",color:"#f0f0f0",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:show?1:3}}
        onFocus={e=>{e.target.style.borderColor="#ff6600";}} onBlur={e=>{e.target.style.borderColor="#222";}}
      />
      <button type="button" onClick={()=>setShow(s=>!s)}
        style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#444",padding:4}}>
        {show?"🙈":"👁"}
      </button>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({onLogin}) {
  const [mode,setMode]=useState("login");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [colorIdx,setColorIdx]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const color=AVATAR_COLORS[colorIdx];

  function switchMode(m){setMode(m);setError("");setPassword("");setConfirm("");}

  async function submit(e) {
    e.preventDefault();setError("");
    if(!username.trim()||!password){setError("Fill in all fields");return;}
    if(mode==="register"){
      if(username.trim().length<2){setError("Username must be at least 2 characters");return;}
      if(password.length<6){setError("Password must be at least 6 characters");return;}
      if(password!==confirm){setError("Passwords do not match");return;}
    }
    setLoading(true);
    try{
      const email=toEmail(username);
      if(mode==="register"){
        const cred=await createUserWithEmailAndPassword(auth,email,password);
        const profile={username:username.trim(),color,initial:username.trim()[0].toUpperCase(),joinedAt:new Date().toISOString()};
        await setDoc(doc(db,"users",cred.user.uid),profile);
        onLogin({name:profile.username,color:profile.color,initial:profile.initial},cred.user.uid);
      }else{
        const cred=await signInWithEmailAndPassword(auth,email,password);
        const snap=await getDoc(doc(db,"users",cred.user.uid));
        if(!snap.exists()){setError("Account not found");return;}
        const p=snap.data();
        onLogin({name:p.username,color:p.color,initial:p.initial},cred.user.uid);
      }
    }catch(err){
      setError(fbAuthError(err));
    }finally{
      setLoading(false);
    }
  }

  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 24px 60px",background:"linear-gradient(160deg,#0e0600 0%,#060606 55%)"}}>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{...B,fontSize:80,color:"#ff6600",letterSpacing:8,lineHeight:1,textShadow:"0 0 80px #ff660044"}}>DELIVR</div>
        <div style={{fontSize:10,color:"#2a2a2a",letterSpacing:5,marginTop:6}}>DRIVER COMMUNITY</div>
      </div>

      <div style={{display:"flex",background:"#0d0d0d",borderRadius:12,padding:4,marginBottom:28,border:"1px solid #1a1a1a"}}>
        {["login","register"].map(m=>(
          <button key={m} type="button" onClick={()=>switchMode(m)}
            style={{flex:1,padding:"11px 0",background:mode===m?"#ff6600":"none",border:"none",borderRadius:9,cursor:"pointer",...B,fontSize:16,letterSpacing:2,color:mode===m?"#000":"#555",transition:"all 0.15s"}}>
            {m==="login"?"SIGN IN":"CREATE ACCOUNT"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:7}}>DRIVER NAME</div>
          <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. FastRider99" maxLength={20} autoFocus
            style={{width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:14,padding:"16px 18px",color:"#f0f0f0",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:1}}
            onFocus={e=>{e.target.style.borderColor="#ff6600";}} onBlur={e=>{e.target.style.borderColor="#222";}}/>
        </div>
        <div>
          <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:7}}>PASSWORD {mode==="register"&&<span style={{color:"#2a2a2a"}}>(min 6 chars)</span>}</div>
          <PasswordInput value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password"/>
        </div>
        {mode==="register"&&<>
          <div>
            <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:7}}>CONFIRM PASSWORD</div>
            <PasswordInput value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repeat password"/>
          </div>
          <div>
            <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:10}}>YOUR COLOUR</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {AVATAR_COLORS.map((c,i)=>(
                <button key={i} type="button" onClick={()=>setColorIdx(i)}
                  style={{width:40,height:40,borderRadius:"50%",background:c,border:colorIdx===i?"3px solid #fff":"3px solid transparent",cursor:"pointer",outline:"none",boxShadow:colorIdx===i?"0 0 18px "+c+"cc":"none",transition:"all 0.15s"}}/>
              ))}
            </div>
          </div>
          {username.trim().length>=1&&(
            <div style={{display:"flex",alignItems:"center",gap:14,background:"#0d0d0d",borderRadius:12,padding:"12px 16px",border:"1px solid #1a1a1a"}}>
              <div style={{width:44,height:44,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"0 0 20px "+color+"66"}}>
                <span style={{...B,fontSize:22,color:"#000"}}>{username.trim()[0].toUpperCase()}</span>
              </div>
              <div>
                <div style={{...B,fontSize:20,letterSpacing:1,color:"#f0f0f0"}}>{username.trim()}</div>
                <div style={{fontSize:9,color:"#555",marginTop:2,letterSpacing:1}}>NEW DRIVER</div>
              </div>
            </div>
          )}
        </>}
        {error&&<div style={{background:"#1a0505",border:"1px solid #ff323244",borderRadius:10,padding:"12px 14px",fontSize:12,...M,color:"#ff3232"}}>{error}</div>}
        <button type="submit" disabled={loading}
          style={{minHeight:64,background:loading?"#1a1a1a":"#ff6600",border:"none",borderRadius:14,...B,fontSize:28,letterSpacing:4,color:loading?"#333":"#000",cursor:loading?"default":"pointer",marginTop:6,boxShadow:loading?"none":"0 0 40px #ff660040",transition:"all 0.2s"}}>
          {loading?"LOADING...":(mode==="login"?"SIGN IN →":"CREATE ACCOUNT →")}
        </button>
      </form>
    </div>
  );
}

// ── WAITS SCREEN ──────────────────────────────────────────────────────────────
function WaitsScreen({now,gps,nearby,waitLog,activeWait,communityPatterns,onArrived,onPickedUp,onCancelWait}) {
  const [picking,setPicking]=useState(false);
  const per=timePeriod(now.getHours());
  const meta=communityPatterns._meta;

  const distMap={};
  if(gps.status==="active"&&nearby?.length){
    nearby.forEach(n=>{const d=distMeters(gps.lat,gps.lng,n.branchLat,n.branchLng);if(d!=null)distMap[n.id]=d;});
  }

  const sorted=RESTAURANTS.slice().sort((a,b)=>{
    if(activeWait?.restaurantId===a.id)return -1;
    if(activeWait?.restaurantId===b.id)return 1;
    const da=distMap[a.id],db=distMap[b.id];
    if(da!=null&&db!=null)return da-db;
    if(da!=null)return -1;if(db!=null)return 1;
    return(b.baseWait/b.rel)-(a.baseWait/a.rel);
  });

  if(picking){
    return(
      <div style={{padding:"20px 16px 100px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
          <button onClick={()=>setPicking(false)} style={{background:"none",border:"none",color:"#ff6600",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
          <div>
            <div style={{...B,fontSize:28,color:"#ff6600",letterSpacing:2}}>ARRIVED AT</div>
            <div style={{fontSize:9,color:"#444",letterSpacing:1}}>{Object.keys(distMap).length>0?"SORTED BY DISTANCE":"WHICH RESTAURANT?"}</div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {RESTAURANTS.slice().sort((a,b)=>{const da=distMap[a.id],db=distMap[b.id];if(da!=null&&db!=null)return da-db;if(da!=null)return -1;if(db!=null)return 1;return 0;}).map(r=>{
            const personal=getPersonalWait(r.id,now,waitLog);
            const community=getCommunityWait(r.id,now,communityPatterns);
            const d=distMap[r.id];
            const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;
            const best=personal?.hasEnough?personal.avg:(community?.avg??null);
            return(
              <button key={r.id} onClick={()=>{onArrived(r.id);setPicking(false);}} style={{background:"#0d0d0d",border:"1px solid #1e1e1e",borderRadius:12,padding:"14px 16px",cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"}}>
                <div>
                  <div style={{...B,fontSize:20,letterSpacing:1,color:"#f0f0f0"}}>{r.name}</div>
                  <div style={{fontSize:10,color:"#555",marginTop:2}}>
                    {dStr&&<span style={{color:"#ff6600"}}>{dStr+" · "}</span>}
                    {best!=null?<span style={{color:"#00e87a"}}>{"~"+best+"m"}</span>:("est: "+r.baseWait+"m")}
                  </div>
                </div>
                <span style={{...B,fontSize:26,color:"#ff6600"}}>→</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return(
    <div style={{padding:"20px 16px 100px"}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <div style={{...B,fontSize:34,color:"#ff6600",letterSpacing:2}}>RESTAURANT WAITS</div>
          <div style={{fontSize:10,color:"#444",letterSpacing:1,marginTop:2}}>{per.toUpperCase()+" · "+dayLabel(now.getDay()).toUpperCase()}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"6px 10px",marginTop:4}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:{pending:"#555",acquiring:"#ffd600",active:"#00e87a",error:"#ff6600",denied:"#ff3232"}[gps.status]||"#555",boxShadow:"0 0 5px "+({pending:"#555",acquiring:"#ffd600",active:"#00e87a",error:"#ff6600",denied:"#ff3232"}[gps.status]||"#555")}}/>
          <span style={{fontSize:9,color:"#444",letterSpacing:1}}>{gps.status==="active"?"±"+gps.accuracy+"m":gps.status.toUpperCase()}</span>
        </div>
      </div>

      {meta?.totalLogs>0&&(
        <div style={{background:"linear-gradient(135deg,#001a0d,#000d06)",border:"1px solid #00e87a22",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#00e87a",boxShadow:"0 0 8px #00e87a",animation:"criticalPulse 2.5s ease-in-out infinite"}}/>
            <span style={{...B,fontSize:14,color:"#00e87a",letterSpacing:2}}>COMMUNITY DATA LIVE</span>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{...M,fontSize:11,fontWeight:700,color:"#00e87a"}}>{meta.totalLogs.toLocaleString()} logs</div>
            <div style={{fontSize:9,color:"#00a055",letterSpacing:1}}>{meta.totalDrivers} driver{meta.totalDrivers!==1?"s":""}</div>
          </div>
        </div>
      )}

      {activeWait?(
        <div style={{background:"linear-gradient(135deg,#1a0a00,#100700)",border:"2px solid #ff6600",borderRadius:16,padding:"20px",marginBottom:16,boxShadow:"0 0 40px #ff660018"}}>
          <div style={{fontSize:9,color:"#ff6600",letterSpacing:2,marginBottom:6}}>⏱ WAITING AT</div>
          <div style={{...B,fontSize:28,color:"#f0f0f0",letterSpacing:1,marginBottom:14}}>
            {(RESTAURANTS.find(r=>r.id===activeWait.restaurantId)||{name:"Unknown"}).name}
          </div>
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><LiveTimer startedAt={activeWait.startedAt}/></div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={onPickedUp} style={{flex:1,minHeight:72,background:"#00e87a",border:"none",borderRadius:12,...B,fontSize:24,letterSpacing:2,color:"#000",cursor:"pointer",boxShadow:"0 0 20px #00e87a33"}}>✓ PICKED UP</button>
            <button onClick={onCancelWait} style={{minHeight:72,width:72,background:"#1a1a1a",border:"1px solid #2a2a2a",borderRadius:12,...B,fontSize:22,color:"#444",cursor:"pointer"}}>✕</button>
          </div>
          <div style={{fontSize:9,color:"#4a2200",textAlign:"center",marginTop:10,letterSpacing:1}}>TAP PICKED UP THE MOMENT YOU HAVE THE ORDER</div>
        </div>
      ):(
        <button onClick={()=>setPicking(true)} style={{width:"100%",minHeight:80,background:"#ff6600",border:"none",borderRadius:14,...B,fontSize:26,letterSpacing:3,color:"#000",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,boxShadow:"0 0 40px #ff660040"}}>
          📍 ARRIVED AT RESTAURANT
        </button>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {sorted.map(r=>{
          const personal=getPersonalWait(r.id,now,waitLog);
          const community=getCommunityWait(r.id,now,communityPatterns);
          const usePersonal=personal?.hasEnough;
          const useCommunity=!usePersonal&&community!=null;
          const displayWait=usePersonal?personal.avg:useCommunity?community.avg:Math.round(r.baseWait/r.rel);
          const dataSource=usePersonal?"YOUR DATA":useCommunity?"COMMUNITY":"EST.";
          const riskColor=displayWait>18?"#ff3232":displayWait>10?"#ffd600":"#00e87a";
          const riskLabel=displayWait>18?"HIGH RISK":displayWait>10?"MODERATE":"LOW RISK";
          const isActive=activeWait?.restaurantId===r.id;
          const myLogs=waitLog.filter(l=>l.restaurantId===r.id);
          const d=distMap[r.id];
          const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;

          return(
            <div key={r.id} style={{background:isActive?"#150900":"#0d0d0d",borderRadius:12,border:"1px solid "+(isActive?"#ff6600":riskColor+"33"),padding:"14px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:19,letterSpacing:1,color:"#f0f0f0"}}>
                    {r.name}
                    {dStr&&<span style={{fontSize:10,color:"#ff6600",marginLeft:8,...M,fontWeight:400}}>{dStr}</span>}
                  </div>
                  <div style={{fontSize:9,color:"#555",marginTop:2}}>{r.label}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                  <div style={{...B,fontSize:34,color:riskColor,letterSpacing:1,lineHeight:1}}>{displayWait}m</div>
                  <div style={{fontSize:9,color:"#444",marginTop:1}}>{dataSource}</div>
                </div>
              </div>
              <div style={{background:"#1a1a1a",borderRadius:4,height:4,marginBottom:10,overflow:"hidden"}}>
                <div style={{height:4,borderRadius:4,width:Math.min(100,(displayWait/40)*100)+"%",background:riskColor}}/>
              </div>
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                {usePersonal?(
                  <div style={{flex:1,minWidth:80,background:"#001a0d",border:"1px solid #00e87a33",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#00e87a",letterSpacing:2,marginBottom:2}}>YOUR DATA</div>
                    <div style={{...B,fontSize:17,color:"#00e87a",letterSpacing:1}}>{personal.avg}m</div>
                    <div style={{fontSize:8,color:"#00a055",marginTop:1}}>{personal.bucketCount}v · {personal.context}</div>
                  </div>
                ):personal&&!personal.hasEnough?(
                  <div style={{flex:1,minWidth:80,background:"#0d0d0d",border:"1px solid #ff660033",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#ff6600",letterSpacing:2,marginBottom:2}}>YOUR DATA</div>
                    <div style={{...B,fontSize:17,color:"#ff6600",letterSpacing:1}}>{personal.avg}m</div>
                    <div style={{fontSize:8,color:"#664400",marginTop:1}}>1 visit</div>
                  </div>
                ):(
                  <div style={{flex:1,minWidth:80,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#333",letterSpacing:2,marginBottom:2}}>YOUR DATA</div>
                    <div style={{...B,fontSize:14,color:"#2a2a2a",letterSpacing:1}}>NONE YET</div>
                  </div>
                )}
                {community?(
                  <div style={{flex:1,minWidth:80,background:"#000d1a",border:"1px solid #00aaff33",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#00aaff",letterSpacing:2,marginBottom:2}}>COMMUNITY</div>
                    <div style={{...B,fontSize:17,color:"#00aaff",letterSpacing:1}}>{community.avg}m</div>
                    <div style={{fontSize:8,color:"#005580",marginTop:1}}>{community.count} logs · {community.drivers}d</div>
                  </div>
                ):(
                  <div style={{flex:1,minWidth:80,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#222",letterSpacing:2,marginBottom:2}}>COMMUNITY</div>
                    <div style={{...B,fontSize:14,color:"#1e1e1e",letterSpacing:1}}>NO DATA</div>
                  </div>
                )}
                <div style={{minWidth:72,background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"7px 10px"}}>
                  <div style={{fontSize:8,color:"#333",letterSpacing:2,marginBottom:2}}>DATABASE</div>
                  <div style={{...B,fontSize:17,color:"#555",letterSpacing:1}}>{r.baseWait}m</div>
                  <div style={{fontSize:8,color:"#2a2a2a",marginTop:1}}>{Math.round(r.rel*100)}% rel.</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:9,background:riskColor+"22",color:riskColor,border:"1px solid "+riskColor+"44",borderRadius:5,padding:"3px 8px"}}>{riskLabel}</span>
                {myLogs.length>0&&<span style={{fontSize:9,color:"#444"}}>{myLogs.length+" visit"+(myLogs.length!==1?"s":"")}</span>}
                {!isActive&&<button onClick={()=>onArrived(r.id)} style={{marginLeft:"auto",background:"#ff6600",border:"none",borderRadius:7,...B,fontSize:13,letterSpacing:1,color:"#000",cursor:"pointer",padding:"6px 14px",minHeight:32}}>ARRIVED</button>}
                {isActive&&<span style={{marginLeft:"auto",fontSize:10,...B,color:"#ff6600",letterSpacing:1,animation:"criticalPulse 1.5s ease-in-out infinite"}}>● TIMING NOW</span>}
              </div>
            </div>
          );
        })}
      </div>

      {waitLog.length>0&&(
        <div style={{marginTop:20}}>
          <div style={{...B,fontSize:16,color:"#2a2a2a",letterSpacing:2,marginBottom:8}}>RECENT WAIT LOGS</div>
          {waitLog.slice().reverse().slice(0,6).map(l=>{
            const r=RESTAURANTS.find(x=>x.id===l.restaurantId);
            const c=l.waitMins>15?"#ff3232":l.waitMins>8?"#ffd600":"#00e87a";
            return(
              <div key={l.id} style={{background:"#0d0d0d",borderRadius:8,padding:"10px 14px",border:"1px solid #141414",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div>
                  <div style={{...B,fontSize:15,letterSpacing:1,color:"#f0f0f0"}}>{r?r.name:"Unknown"}</div>
                  <div style={{fontSize:9,color:"#444",marginTop:1}}>{new Date(l.ts).toLocaleString("en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})+" · "+l.period}</div>
                </div>
                <div style={{...B,fontSize:22,color:c,letterSpacing:1}}>{l.waitMins}m</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CHAT SCREEN (Firestore real-time) ─────────────────────────────────────────
function ChatScreen({user,onLogout}) {
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [ready,setReady]=useState(false);
  const bottomRef=useRef(null);
  const inputRef=useRef(null);

  // Live listener — fires instantly for every connected device
  useEffect(()=>{
    const q=query(collection(db,"messages"),orderBy("ts","asc"),limitToLast(100));
    const unsub=onSnapshot(q,snap=>{
      setMessages(snap.docs.map(d=>({id:d.id,...d.data()})));
      setReady(true);
    },()=>setReady(true));
    return unsub;
  },[]);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages.length]);

  async function send(){
    const text=input.trim();
    if(!text)return;
    setInput("");
    try{
      await addDoc(collection(db,"messages"),{
        user:  user.name,
        color: user.color,
        initial:user.initial,
        text,
        ts: new Date().toISOString(),
      });
    }catch(e){}
    inputRef.current?.focus();
  }

  function onKey(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}
  function fmt(ts){try{return new Date(ts).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});}catch(e){return "";}}

  return(
    <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 56px)"}}>
      <div style={{padding:"10px 16px",borderBottom:"1px solid #111",background:"#080808",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{...B,fontSize:24,color:"#ff6600",letterSpacing:2}}>DRIVER CHAT</div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:2}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:ready?"#00e87a":"#ffd600",boxShadow:"0 0 6px "+(ready?"#00e87a":"#ffd600"),animation:ready?"criticalPulse 2.5s ease-in-out infinite":"none"}}/>
            <span style={{fontSize:9,color:"#444",letterSpacing:1}}>{ready?"LIVE · FIREBASE":"CONNECTING..."}</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:user.color,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 14px "+user.color+"55"}}>
            <span style={{...B,fontSize:16,color:"#000"}}>{user.initial}</span>
          </div>
          <button onClick={onLogout} style={{background:"none",border:"1px solid #1e1e1e",borderRadius:8,padding:"6px 10px",color:"#444",cursor:"pointer",fontSize:9,...B,letterSpacing:1}}>OUT</button>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"10px 14px 6px",display:"flex",flexDirection:"column",gap:2}}>
        {ready&&messages.length===0&&(
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,paddingBottom:40}}>
            <div style={{fontSize:38,opacity:0.2}}>💬</div>
            <div style={{...B,fontSize:18,color:"#222",letterSpacing:2}}>NO MESSAGES YET</div>
            <div style={{fontSize:10,color:"#1e1e1e"}}>BE THE FIRST TO SAY SOMETHING</div>
          </div>
        )}
        {!ready&&(
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{...B,fontSize:14,color:"#ffd600",letterSpacing:2,animation:"criticalPulse 1.2s ease-in-out infinite"}}>CONNECTING...</div>
          </div>
        )}
        {messages.map((m,i)=>{
          const prev=messages[i-1];
          const isFirst=!prev||prev.user!==m.user||(new Date(m.ts)-new Date(prev.ts))>120000;
          const isMe=m.user===user.name;
          return(
            <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start",marginTop:isFirst?12:2}}>
              {isFirst&&(
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,...(isMe?{marginRight:4}:{marginLeft:40})}}>
                  {!isMe&&<span style={{fontSize:10,color:m.color,...M,fontWeight:700}}>{m.user}</span>}
                  <span style={{fontSize:9,color:"#2a2a2a"}}>{fmt(m.ts)}</span>
                  {isMe&&<span style={{fontSize:10,color:m.color,...M,fontWeight:700}}>You</span>}
                </div>
              )}
              <div style={{display:"flex",alignItems:"flex-end",gap:8,flexDirection:isMe?"row-reverse":"row"}}>
                {!isMe&&(
                  <div style={{width:28,height:28,borderRadius:"50%",background:isFirst?m.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginBottom:2}}>
                    {isFirst&&<span style={{...B,fontSize:13,color:"#000"}}>{m.initial}</span>}
                  </div>
                )}
                <div style={{maxWidth:"76%",background:isMe?"#ff6600":"#141414",borderRadius:isMe?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"10px 14px",border:isMe?"none":"1px solid #1e1e1e",boxShadow:isMe?"0 2px 16px #ff660028":"none"}}>
                  <span style={{fontSize:14,...M,color:isMe?"#000":"#ddd",lineHeight:1.55,wordBreak:"break-word"}}>{m.text}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      <div style={{padding:"10px 12px 14px",borderTop:"1px solid #111",background:"#080808",flexShrink:0,display:"flex",gap:10,alignItems:"center"}}>
        <div style={{flex:1,background:"#111",border:"1px solid #222",borderRadius:24,padding:"11px 18px",display:"flex",alignItems:"center"}}>
          <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey}
            placeholder={ready?"Say something to the group...":"Connecting..."}
            disabled={!ready} maxLength={500}
            style={{flex:1,background:"none",border:"none",color:"#f0f0f0",fontSize:14,...M,outline:"none",opacity:ready?1:0.4}}
            onFocus={e=>{e.target.parentElement.style.borderColor="#ff6600";}}
            onBlur={e=>{e.target.parentElement.style.borderColor="#222";}}
          />
        </div>
        <button onClick={send} disabled={!input.trim()||!ready}
          style={{width:46,height:46,borderRadius:"50%",background:input.trim()&&ready?"#ff6600":"#1a1a1a",border:"none",cursor:input.trim()&&ready?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:18,boxShadow:input.trim()&&ready?"0 0 20px #ff660050":"none",transition:"all 0.15s",color:input.trim()&&ready?"#000":"#333"}}>
          ↑
        </button>
      </div>
    </div>
  );
}

// ── BOTTOM NAV ────────────────────────────────────────────────────────────────
function BottomNav({screen,onNav,activeWait,unreadChat}) {
  const tabs=[
    {id:"waits",icon:"⏱",label:"WAITS",dot:activeWait,  dotColor:"#ff6600"},
    {id:"chat", icon:"💬",label:"CHAT", dot:unreadChat,  dotColor:"#00e87a"},
  ];
  return(
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"#0a0a0a",borderTop:"1px solid #141414",display:"flex",zIndex:200,height:56}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onNav(t.id)} style={{flex:1,background:"none",border:"none",cursor:"pointer",padding:"10px 0 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          <span style={{fontSize:20,position:"relative"}}>
            {t.icon}
            {t.dot&&<span style={{position:"absolute",top:-3,right:-5,width:8,height:8,borderRadius:"50%",background:t.dotColor,boxShadow:"0 0 8px "+t.dotColor,display:"block"}}/>}
          </span>
          <span style={{...B,fontSize:11,letterSpacing:1,color:t.id===screen?"#ff6600":"#333"}}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── ROOT APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]    =useState(()=>store.get("delivr_user")||null);
  const [screen,setScreen]=useState("waits");
  const [now,setNow]      =useState(new Date());
  const [nearby,setNearby]=useState(()=>store.get("delivr_nearby")||[]);
  const [waitLog,setWaitLog]=useState(()=>store.get("delivr_waitlog")||[]);
  const [activeWait,setActiveWait]=useState(()=>store.get("delivr_activewait")||null);
  const [communityPatterns,setCommunityPatterns]=useState({});
  const [unreadChat,setUnreadChat]=useState(false);
  const lastFetchRef=useRef({lat:null,lng:null});
  const gps=useGPS();

  // Restore Firebase auth session on reload
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async fbUser=>{
      if(!fbUser){setUser(null);store.del("delivr_user");return;}
      // If we already have user in state, keep it
      if(user)return;
      try{
        const snap=await getDoc(doc(db,"users",fbUser.uid));
        if(snap.exists()){
          const p=snap.data();
          const u={name:p.username,color:p.color,initial:p.initial};
          setUser(u);store.set("delivr_user",u);
        }
      }catch(e){}
    });
    return unsub;
  },[]);

  // Live Firestore listener for community patterns — updates instantly when any driver logs
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"waitLogs"),snap=>{
      const logs=snap.docs.map(d=>d.data());
      setCommunityPatterns(computePatterns(logs));
    },()=>{});
    return unsub;
  },[]);

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),15000);return ()=>clearInterval(id);},[]);

  useEffect(()=>{
    if(gps.status!=="active"||gps.lat==null||!MAPBOX_TOKEN)return;
    const last=lastFetchRef.current;
    const far=last.lat==null||distMeters(last.lat,last.lng,gps.lat,gps.lng)>800;
    if(nearby.length===0||far){
      lastFetchRef.current={lat:gps.lat,lng:gps.lng};
      findNearbyBranches(gps.lat,gps.lng).then(res=>{setNearby(res);store.set("delivr_nearby",res);}).catch(()=>{});
    }
  },[gps.status,gps.lat,gps.lng,nearby.length]);

  function handleNav(s){if(s==="chat")setUnreadChat(false);setScreen(s);}

  function handleLogin(userData){
    setUser(userData);store.set("delivr_user",userData);
  }

  async function handleLogout(){
    await signOut(auth);
    setUser(null);store.del("delivr_user");
    setScreen("waits");
  }

  function handleArrived(restaurantId){
    const a={restaurantId,startedAt:new Date().toISOString()};
    setActiveWait(a);store.set("delivr_activewait",a);
  }

  async function handlePickedUp(){
    if(!activeWait)return;
    const waitMins=Math.round((Date.now()-new Date(activeWait.startedAt))/60000*10)/10;
    const ts=new Date();
    const entry={
      id:           Date.now().toString(),
      restaurantId: activeWait.restaurantId,
      waitMins,
      ts:           ts.toISOString(),
      hour:         ts.getHours(),
      dow:          ts.getDay(),
      period:       timePeriod(ts.getHours()),
    };
    // Save locally (instant, works offline)
    const newLog=[...waitLog,entry];
    setWaitLog(newLog);store.set("delivr_waitlog",newLog);
    setActiveWait(null);store.set("delivr_activewait",null);
    // Write to Firestore — triggers live pattern update for all drivers
    try{
      await addDoc(collection(db,"waitLogs"),{...entry,username:user?.name||"anon"});
    }catch(e){}
  }

  function handleCancelWait(){setActiveWait(null);store.set("delivr_activewait",null);}

  const CSS=`
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#060606}
    ::-webkit-scrollbar{display:none}
    button:active{opacity:0.75;transform:scale(0.97)}
    input{outline:none}
    @keyframes criticalPulse{0%,100%{opacity:1;filter:drop-shadow(0 0 4px currentColor)}50%{opacity:0.35;filter:drop-shadow(0 0 16px currentColor)}}
    @keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
  `;

  if(!user){
    return <div style={ROOT}><style>{CSS}</style><LoginScreen onLogin={handleLogin}/></div>;
  }

  return(
    <div>
      <style>{CSS}</style>
      <div style={ROOT}>
        <div style={{height:"calc(100vh - 56px)",overflowY:"auto"}}>
          {screen==="waits"&&(
            <WaitsScreen now={now} gps={gps} nearby={nearby} waitLog={waitLog} activeWait={activeWait}
              communityPatterns={communityPatterns}
              onArrived={handleArrived} onPickedUp={handlePickedUp} onCancelWait={handleCancelWait}/>
          )}
          {screen==="chat"&&<ChatScreen user={user} onLogout={handleLogout}/>}
        </div>
        <BottomNav screen={screen} onNav={handleNav} activeWait={!!activeWait} unreadChat={unreadChat}/>
      </div>
    </div>
  );
}

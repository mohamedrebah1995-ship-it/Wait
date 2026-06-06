import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, limitToLast,
  onSnapshot, getDocs, serverTimestamp,
} from "firebase/firestore";
import { auth, db, storage } from "./firebase";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

const FL = document.createElement("link");
FL.rel = "stylesheet";
FL.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Nunito:wght@400;600;700;800&display=swap";
document.head.appendChild(FL);

const MAPBOX_TOKEN = "pk.eyJ1Ijoia2luZ29mbWFkbmVzcyIsImEiOiJjbXAzZTFoNDYwbGNtMnBzODZuYnNiY3FvIn0.yVEwZEGgiP8gqqOIycdJWA";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const GOOGLE_MAPS_KEY = "AIzaSyARDTROkeGrhMw_ZKsYw8SuLnw3skQf2yk";
const ADSENSE_CLIENT = "ca-pub-3527173535512943";
const ADSENSE_SLOT   = "";  // ← paste your AdSense ad-unit slot ID here once AdSense is approved
const SUB_PRICE = "£4.99";
// Accounts that can see the admin APP STATS screen (add more emails if needed)
const OWNER_EMAILS = ["mohamedrebah1995@gmail.com","contact.morebah@gmail.com"];
const isOwner = u => !!u?.email && OWNER_EMAILS.includes(u.email.toLowerCase());
const CFG = { MIN_SAMPLES: 2, COMMUNITY_MIN: 1 };

const RESTAURANTS = [
  { id:"mcdonalds",       name:"McDonald's Braintree",                      baseWait:4,  rel:0.86, label:"Usually fast" },
  { id:"kfc",             name:"KFC Braintree - Galleys Island",            baseWait:13, rel:0.42, label:"High queue risk" },
  { id:"nandos",          name:"Nando's Braintree",                         baseWait:17, rel:0.45, label:"Unpredictable" },
  { id:"fiveguys",        name:"Five Guys Braintree",                       baseWait:12, rel:0.55, label:"Wait likely" },
  { id:"subway",          name:"Subway Manor Street Braintree",             baseWait:5,  rel:0.82, label:"Mostly quick" },
  { id:"pizzahut",        name:"Pizza Hut Braintree",                       baseWait:10, rel:0.62, label:"Variable" },
  { id:"timhortons",      name:"Tim Hortons Braintree",                     baseWait:5,  rel:0.80, label:"Usually fast" },
  { id:"starbucks",       name:"Starbucks Braintree",                       baseWait:6,  rel:0.75, label:"Moderate wait" },
  { id:"wagamama",        name:"wagamama Braintree Village",                baseWait:16, rel:0.48, label:"Wait likely" },
  { id:"zizzi",           name:"Zizzi Braintree",                           baseWait:15, rel:0.50, label:"Sit-down wait" },
  { id:"pizzaexpress",    name:"PizzaExpress Braintree",                    baseWait:13, rel:0.55, label:"Variable" },
  { id:"prezzo",          name:"Prezzo Braintree",                          baseWait:14, rel:0.52, label:"Sit-down wait" },
  { id:"wildwood",        name:"Wildwood Braintree",                        baseWait:14, rel:0.52, label:"Variable" },
  { id:"realgreek",       name:"The Real Greek Braintree",                  baseWait:13, rel:0.58, label:"Moderate wait" },
  { id:"bills",           name:"Bill's Braintree Restaurant",               baseWait:15, rel:0.50, label:"Sit-down wait" },
  { id:"cocodimama",      name:"Coco di Mama Braintree",                    baseWait:8,  rel:0.70, label:"Moderate wait" },
  { id:"tobycarvery",     name:"Toby Carvery Braintree",                    baseWait:18, rel:0.45, label:"Often delayed" },
  { id:"fowlersfarm",     name:"The Fowler's Farm Braintree",               baseWait:12, rel:0.60, label:"Variable" },
  { id:"hasturk",         name:"Hasturk Braintree",                         baseWait:10, rel:0.65, label:"Moderate wait" },
  { id:"bfcperiperi",     name:"BFC Peri Peri Braintree",                   baseWait:8,  rel:0.72, label:"Usually fast" },
  { id:"salamis",         name:"Salamis Fish and Chips Braintree",          baseWait:10, rel:0.65, label:"Moderate wait" },
  { id:"kaspas",          name:"Kaspa's Braintree",                         baseWait:8,  rel:0.68, label:"Usually fast" },
  { id:"mosaic",          name:"Mosaic Mediterranean Restaurant Braintree", baseWait:12, rel:0.60, label:"Moderate wait" },
  { id:"yumy",            name:"Yumy Braintree",                            baseWait:10, rel:0.65, label:"Moderate wait" },
  { id:"bagels",          name:"Braintree Bagels",                          baseWait:4,  rel:0.85, label:"Very fast" },
  { id:"thaitree",        name:"Braintree Thai Restaurant",                 baseWait:12, rel:0.62, label:"Variable" },
  { id:"oysters",         name:"Oysters Braintree",                         baseWait:10, rel:0.65, label:"Moderate wait" },
  { id:"sainsburys",      name:"Sainsbury's Braintree",                     baseWait:6,  rel:0.78, label:"Usually quick" },
  { id:"tesco",           name:"Tesco Superstore Braintree",                baseWait:5,  rel:0.80, label:"Usually quick" },
  { id:"tescoexpress",    name:"Tesco Express Braintree",                   baseWait:4,  rel:0.85, label:"Very fast" },
  { id:"coopchallislane", name:"Co-op Food Challis Lane Braintree",         baseWait:4,  rel:0.85, label:"Very fast" },
  { id:"coopchurchst",    name:"Co-op Food Church Street Braintree",        baseWait:4,  rel:0.85, label:"Very fast" },
  { id:"coopgalleys",     name:"Co-op Food Galleys Corner Braintree",       baseWait:3,  rel:0.88, label:"Very fast" },
  { id:"morrisonsdaily",  name:"Morrisons Daily Braintree",                 baseWait:4,  rel:0.85, label:"Usually quick" },
  { id:"onestop",         name:"One Stop Braintree",                        baseWait:3,  rel:0.88, label:"Very fast" },
  { id:"bp",              name:"BP Braintree",                              baseWait:3,  rel:0.90, label:"Very fast" },
];

// Curated chains always shown first (in this order), then Google nearby for the rest.
// `keys` are lowercase name fragments used to match a real nearby branch from Google.
const CURATED = [
  { id:"mcdonalds",   name:"McDonald's",    keys:["mcdonald"],                  baseWait:4,  rel:0.86, label:"Usually fast" },
  { id:"kfc",         name:"KFC",           keys:["kfc"],                       baseWait:13, rel:0.45, label:"High queue risk" },
  { id:"nandos",      name:"Nando's",       keys:["nando"],                     baseWait:17, rel:0.45, label:"Unpredictable" },
  { id:"wagamama",    name:"Wagamama",      keys:["wagamama"],                  baseWait:16, rel:0.48, label:"Wait likely" },
  { id:"pizzaexpress",name:"Pizza Express", keys:["pizza express","pizzaexpress","pizzaexp"], baseWait:13, rel:0.55, label:"Variable" },
  { id:"zizzi",       name:"Zizzi",         keys:["zizzi"],                     baseWait:15, rel:0.50, label:"Sit-down wait" },
  { id:"cocodimama",  name:"Coco di Mama",  keys:["coco di mama","coco"],       baseWait:8,  rel:0.70, label:"Moderate wait" },
  { id:"sainsburys",  name:"Sainsbury's",   keys:["sainsbury"],                 baseWait:6,  rel:0.78, label:"Usually quick" },
];

// Merge: curated chains (pinned to their nearest real branch) first, then other nearby places.
async function buildRestaurantList(places, lat, lng) {
  const matchesCurated = p => { const n=(p.name||"").toLowerCase(); return CURATED.find(c=>c.keys.some(k=>n.includes(k))); };
  // Each curated chain: use the nearby match if it has hours; otherwise look it up
  // directly so we always know its real Google open/closed status.
  const seed = await Promise.all(CURATED.map(async c => {
    let m = places.find(p => { const n=(p.name||"").toLowerCase(); return c.keys.some(k=>n.includes(k)); });
    if(!m || m.openNow===undefined){
      try{
        const res = await searchRestaurants(c.name, lat, lng);
        const t = res.find(x=>{ const n=(x.name||"").toLowerCase(); return c.keys.some(k=>n.includes(k)); }) || res[0];
        if(t) m = t;
      }catch(e){}
    }
    return m ? { ...c, id:m.id, branchLat:m.branchLat, branchLng:m.branchLng, address:m.address, openNow:m.openNow } : c;
  }));
  const extras = places.filter(p => !matchesCurated(p));
  return [...seed, ...extras];
}

// ── Aggregation key ───────────────────────────────────────────────────────────
// All logs for the same chain share one key (e.g. every "KFC" → "kfc"), so logs
// scattered across old static ids and new Google place ids merge back together.
function chainKeyFromName(name){
  if(!name)return null;
  const n=name.toLowerCase();
  const c=CURATED.find(c=>c.keys.some(k=>n.includes(k)));
  return c?c.id:null;
}
function logKey(l){ return chainKeyFromName(l.restaurantName)||l.restaurantId; }   // for a stored log
function cardKey(r){ return chainKeyFromName(r.name)||r.id; }                       // for a restaurant card

// ── Contributor badges ────────────────────────────────────────────────────────
const BADGE_TIERS = [
  { min:1000, emoji:"👑", label:"Legend" },
  { min:500,  emoji:"🔥", label:"Elite" },
  { min:100,  emoji:"🏅", label:"Pro" },
  { min:50,   emoji:"🥈", label:"Regular" },
  { min:10,   emoji:"🥉", label:"Starter" },
];
const REACTIONS = ["👍","❤️","😂","🔥","😮","🙏"];   // chat message reactions
const QUALITY_MIN_WAIT = 0.5;  // minutes — instant arrive→collect (<30s) doesn't count
const DAILY_CAP = 15;          // max logs counted per driver per day (anti-spam)
function badgeFor(count){ return BADGE_TIERS.find(t=>count>=t.min)||null; }
function nextTier(count){ const sorted=[...BADGE_TIERS].sort((a,b)=>a.min-b.min); return sorted.find(t=>count<t.min)||null; }
// username → counted quality logs (per-day capped) used for badges & leaderboard
function computeContributions(logs){
  const perUserDay={};
  for(const l of logs){
    if((l.waitMins||0)<QUALITY_MIN_WAIT)continue;        // skip junk/instant logs
    const u=l.username||"anon";
    const day=(l.ts||"").slice(0,10);
    (perUserDay[u]=perUserDay[u]||{});
    perUserDay[u][day]=(perUserDay[u][day]||0)+1;
  }
  const counts={};
  for(const [u,days] of Object.entries(perUserDay)){
    counts[u]=Object.values(days).reduce((s,n)=>s+Math.min(n,DAILY_CAP),0);
  }
  return counts;
}

const AVATAR_COLORS = ["#00b8a9","#06c167","#ff5a2d","#2b8fff","#f5a623","#a855f7","#ef4444","#ec4899"];
const B = { fontFamily:"'Poppins',sans-serif" };
const M = { fontFamily:"'Nunito',sans-serif" };
const ROOT = { ...M, background:"var(--bg)", color:"var(--ink)", minHeight:"100vh", maxWidth:430, margin:"0 auto", userSelect:"none" };

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
  if (h>=21)       return "late night";   // 21:00–23:59
  return "early morning";                 // 00:00–04:59
}
function dayLabel(d) { return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d]; }

// Map Firebase auth error codes to friendly messages
function fbAuthError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "That email is already registered — sign in instead";
  if (code.includes("user-not-found"))       return "No account with that email — please register";
  if (code.includes("wrong-password"))       return "Wrong email or password";
  if (code.includes("invalid-credential"))   return "Wrong email or password — if you're new or had an older account, tap CREATE ACCOUNT";
  if (code.includes("invalid-email"))        return "Enter a valid email address";
  if (code.includes("too-many-requests"))    return "Too many attempts — try again in a moment";
  if (code.includes("weak-password"))        return "Password must be at least 6 characters";
  return err?.message || "Something went wrong";
}


// ── Pattern computation (runs client-side from Firestore logs) ────────────────
// Recency weight: a log from the last 2h counts ~3x, last 24h ~2x, older 1x.
// This makes the shown wait automatically track current conditions.
function recencyWeight(ts) {
  const ageH = (Date.now() - new Date(ts).getTime()) / 3600000;
  if (ageH < 0) return 3;
  return 1 + 2 * Math.exp(-ageH / 6); // smooth decay: ~3 now → ~1 after a day
}

function bucketStats(logs) {
  if (!logs.length) return null;
  let wSum = 0, wAvg = 0;
  for (const l of logs) { const w = recencyWeight(l.ts); wSum += w; wAvg += w * l.waitMins; }
  const avg = wSum > 0 ? wAvg / wSum : logs.reduce((s, l) => s + l.waitMins, 0) / logs.length;
  return {
    avg:     Math.round(avg * 10) / 10,   // recency-weighted average
    min:     Math.round(Math.min(...logs.map(l => l.waitMins))),
    max:     Math.round(Math.max(...logs.map(l => l.waitMins))),
    count:   logs.length,
    drivers: new Set(logs.map(l => l.username)).size,
  };
}

function computePatterns(logs) {
  const byRest = {};
  for (const log of logs) {
    const key = logKey(log);                       // group by chain so logs merge
    (byRest[key] = byRest[key] || []).push(log);
  }
  const patterns = {};
  for (const [restId, rl] of Object.entries(byRest)) {
    const entry = { overall: bucketStats(rl), byPeriod: {}, byDayPeriod: {}, byHour: {}, byDayHour: {} };
    for (const per of ["early morning","morning","lunch","afternoon","evening","late night"]) {
      const b = rl.filter(l => l.period === per);
      if (b.length) entry.byPeriod[per] = bucketStats(b);
    }
    for (let dow = 0; dow < 7; dow++) {
      for (const per of ["early morning","morning","lunch","afternoon","evening","late night"]) {
        const b = rl.filter(l => l.dow === dow && l.period === per);
        if (b.length) entry.byDayPeriod[`${dow}_${per}`] = bucketStats(b);
      }
    }
    // Hourly buckets — for precise "this day & hour" predictions and charts
    for (let h = 0; h < 24; h++) {
      const bh = rl.filter(l => Number(l.hour) === h);
      if (bh.length) entry.byHour[h] = bucketStats(bh);
      for (let dow = 0; dow < 7; dow++) {
        const b = rl.filter(l => l.dow === dow && Number(l.hour) === h);
        if (b.length) entry.byDayHour[`${dow}_${h}`] = bucketStats(b);
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
// Safari needs geolocation requested from a real tap. So: if permission is already
// granted we acquire silently; otherwise we wait on a "prompt" state until the user
// taps Enable (a gesture), which is the only thing Safari will reliably prompt on.
// Once we have ONE fix, the user is never sent back to the gate.
function useGPS() {
  const grantedBefore=store.get("delivr_geo_granted")===true;   // persisted across refreshes
  const [g,setG]=useState({lat:null,lng:null,accuracy:null,speedKmh:null,status:grantedBefore?"acquiring":"pending",denied:false});
  const wid=useRef(null);
  const hasFix=useRef(false);
  const start=useCallback((userGesture=false)=>{
    if(!("geolocation" in navigator)){setG(x=>({...x,status:"error"}));return;}
    setG(x=>({...x,status:x.lat!=null?"active":"acquiring"}));
    const onPos=p=>{
      hasFix.current=true;
      store.set("delivr_geo_granted",true);   // remember consent so we never gate this user again
      setG(x=>({...x,lat:p.coords.latitude,lng:p.coords.longitude,accuracy:Math.round(p.coords.accuracy),speedKmh:p.coords.speed!=null?Math.round(p.coords.speed*3.6):null,status:"active",denied:false}));
    };
    const onErr=e=>setG(x=>{
      if(hasFix.current)return{...x,status:"active",denied:false};        // already have a fix → never re-block
      if(store.get("delivr_geo_granted")===true)return{...x,status:"acquiring",denied:false}; // granted before → keep app open, retry in bg
      if(e.code===1)return{...x,status:userGesture?"denied":"prompt",denied:userGesture}; // only a tapped attempt counts as real denial
      return{...x,status:"prompt",denied:false};                          // timeout/unavailable → let the user tap to retry
    });
    navigator.geolocation.getCurrentPosition(onPos,onErr,{enableHighAccuracy:false,timeout:12000,maximumAge:60000});
    if(wid.current!=null)navigator.geolocation.clearWatch(wid.current);
    wid.current=navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,timeout:30000,maximumAge:15000});
  },[]);
  useEffect(()=>{
    let perm;
    if(grantedBefore){
      start(false);                                          // returning user → acquire silently, app shows immediately
    } else if(navigator.permissions?.query){
      navigator.permissions.query({name:"geolocation"}).then(p=>{
        perm=p;
        if(p.state==="granted")start(false);
        else if(p.state==="denied")setG(x=>({...x,status:"denied",denied:true}));
        else setG(x=>({...x,status:"prompt"}));              // first-timer → needs a tap
        p.onchange=()=>{
          if(p.state==="granted")start(false);
          else if(p.state==="denied"&&!hasFix.current)setG(x=>({...x,status:"denied",denied:true}));
        };
      }).catch(()=>start(false));
    } else {
      start(false);
    }
    return ()=>{ if(wid.current!=null)navigator.geolocation.clearWatch(wid.current); if(perm)perm.onchange=null; };
  },[start]);
  return {...g,retry:()=>start(true)};
}

function distMeters(lat1,lng1,lat2,lng2) {
  if(lat1==null||lng1==null||lat2==null||lng2==null)return null;
  const R=6371000,toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// Fetch real nearby restaurants from Google Places based on driver's GPS position
async function fetchNearbyRestaurants(lat,lng) {
  if(!GOOGLE_MAPS_KEY||lat==null||lng==null)return[];
  try{
    const res=await fetch("https://places.googleapis.com/v1/places:searchNearby",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":GOOGLE_MAPS_KEY,"X-Goog-FieldMask":"places.id,places.displayName,places.location,places.types,places.currentOpeningHours,places.businessStatus"},
      body:JSON.stringify({
        includedTypes:["restaurant","fast_food_restaurant","cafe","bakery","meal_takeaway","sandwich_shop","pizza_restaurant","coffee_shop","supermarket","convenience_store","grocery_store"],
        maxResultCount:20,
        rankPreference:"DISTANCE",
        locationRestriction:{circle:{center:{latitude:lat,longitude:lng},radius:5000}},
      }),
    });
    const g=await res.json();
    if(!g.places?.length)return[];
    return g.places.map(p=>{
      const types=p.types||[];
      let baseWait=10,rel=0.70,label="Variable";
      if(types.some(t=>["fast_food_restaurant","hamburger_restaurant","sandwich_shop","meal_takeaway"].includes(t))){baseWait=5;rel=0.80;label="Usually fast";}
      else if(types.some(t=>["cafe","coffee_shop","bakery"].includes(t))){baseWait=4;rel=0.85;label="Quick grab";}
      else if(types.includes("pizza_restaurant")){baseWait=10;rel=0.68;label="Variable";}
      else if(types.some(t=>["supermarket","convenience_store","grocery_store"].includes(t))){baseWait=5;rel=0.82;label="Usually quick";}
      // openNow: true/false from Google; undefined when Google has no hours data
      const openNow=p.businessStatus&&p.businessStatus!=="OPERATIONAL"?false:p.currentOpeningHours?.openNow;
      return{id:p.id,name:p.displayName?.text||"Unknown",branchLat:p.location.latitude,branchLng:p.location.longitude,baseWait,rel,label,openNow};
    });
  }catch(e){return[];}
}

// Single-restaurant live geocode using Google Places API (more reliable than Mapbox for chains)
async function geocodeBranch(lat,lng,name) {
  try{
    const res=await fetch("https://places.googleapis.com/v1/places:searchText",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":GOOGLE_MAPS_KEY,"X-Goog-FieldMask":"places.location,places.displayName"},
      body:JSON.stringify({
        textQuery:name,
        locationBias:{circle:{center:{latitude:lat,longitude:lng},radius:2000}},
        maxResultCount:1,
      }),
    });
    const g=await res.json();
    if(!g.places?.length)return null;
    const loc=g.places[0].location;
    return{lat:loc.latitude,lng:loc.longitude};
  }catch(e){return null;}
}

// Search restaurants by name — used in the picker so drivers can find any restaurant anywhere
async function searchRestaurants(query,lat,lng) {
  if(!query||query.trim().length<2)return[];
  try{
    const body={textQuery:query.trim(),maxResultCount:20};
    if(lat!=null&&lng!=null)body.locationBias={circle:{center:{latitude:lat,longitude:lng},radius:50000}};
    const res=await fetch("https://places.googleapis.com/v1/places:searchText",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":GOOGLE_MAPS_KEY,"X-Goog-FieldMask":"places.id,places.displayName,places.location,places.formattedAddress,places.currentOpeningHours,places.businessStatus"},
      body:JSON.stringify(body),
    });
    const g=await res.json();
    if(!g.places?.length)return[];
    return g.places.map(p=>({
      id:p.id,
      name:p.displayName?.text||"Unknown",
      address:p.formattedAddress||"",
      branchLat:p.location.latitude,
      branchLng:p.location.longitude,
      openNow:p.businessStatus&&p.businessStatus!=="OPERATIONAL"?false:p.currentOpeningHours?.openNow,
      baseWait:10,rel:0.70,label:"",
    }));
  }catch(e){console.error("searchRestaurants error:",e);return[];}
}

function getPersonalWait(restId,now,waitLog) {
  const h=now.getHours(),dow=now.getDay(),per=timePeriod(h);
  const logs=waitLog.filter(l=>logKey(l)===restId);
  if(!logs.length)return null;
  const sameDayPer=logs.filter(l=>l.dow===dow&&l.period===per);
  const samePer=logs.filter(l=>l.period===per);
  let bucket,context;
  if(sameDayPer.length>=CFG.MIN_SAMPLES){bucket=sameDayPer;context=dayLabel(dow)+" "+per;}
  else if(samePer.length>=CFG.MIN_SAMPLES){bucket=samePer;context=per;}
  else if(logs.length>=CFG.MIN_SAMPLES){bucket=logs;context="all visits";}
  else{bucket=logs;context="1 visit";}
  let wSum=0,wAvg=0;for(const l of bucket){const w=recencyWeight(l.ts);wSum+=w;wAvg+=w*l.waitMins;}
  const avg=wSum>0?wAvg/wSum:bucket.reduce((s,l)=>s+l.waitMins,0)/bucket.length;
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

// Predicted wait for a specific day + hour, using the finest bucket with enough data.
// Tries this day & hour (±1h window) → this hour any day → day+period → period → overall.
function predictWait(restId,dow,hour,patterns) {
  const p=patterns[restId];
  if(!p)return null;
  const sumBuckets=(picks)=>{
    let n=0,wsum=0,drivers=0;
    for(const b of picks){ if(b){ n+=b.count; wsum+=b.avg*b.count; drivers=Math.max(drivers,b.drivers||0); } }
    return n>0?{avg:Math.round(wsum/n*10)/10,count:n,drivers}:null;
  };
  // this weekday, hour ±1
  const dh=sumBuckets([p.byDayHour?.[`${dow}_${(hour+23)%24}`],p.byDayHour?.[`${dow}_${hour}`],p.byDayHour?.[`${dow}_${(hour+1)%24}`]]);
  if(dh&&dh.count>=CFG.COMMUNITY_MIN)return{...dh,context:dayLabel(dow)+" "+hourLabel(hour),tier:"day-hour"};
  // any day, this hour ±1
  const hh=sumBuckets([p.byHour?.[(hour+23)%24],p.byHour?.[hour],p.byHour?.[(hour+1)%24]]);
  if(hh&&hh.count>=CFG.COMMUNITY_MIN)return{...hh,context:hourLabel(hour)+" (any day)",tier:"hour"};
  // day + period
  const per=timePeriod(hour);
  const dp=p.byDayPeriod?.[`${dow}_${per}`];
  if(dp&&dp.count>=CFG.COMMUNITY_MIN)return{avg:dp.avg,count:dp.count,drivers:dp.drivers,context:dayLabel(dow)+" "+per,tier:"day-period"};
  const pp=p.byPeriod?.[per];
  if(pp&&pp.count>=CFG.COMMUNITY_MIN)return{avg:pp.avg,count:pp.count,drivers:pp.drivers,context:per,tier:"period"};
  if(p.overall&&p.overall.count>=CFG.COMMUNITY_MIN)return{avg:p.overall.avg,count:p.overall.count,drivers:p.overall.drivers,context:"all times",tier:"overall"};
  return null;
}

function hourLabel(h){ const ampm=h<12?"am":"pm"; const hr=h%12===0?12:h%12; return hr+ampm; }

// ── Shared UI ─────────────────────────────────────────────────────────────────
function LiveTimer({startedAt}) {
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{
    const tick=()=>setElapsed(Math.floor((Date.now()-new Date(startedAt))/1000));
    tick();const id=setInterval(tick,1000);return ()=>clearInterval(id);
  },[startedAt]);
  const m=Math.floor(elapsed/60),s=elapsed%60;
  return<span style={{...M,fontSize:56,fontWeight:700,color:"#00b8a9",letterSpacing:2,fontVariantNumeric:"tabular-nums"}}>{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}</span>;
}

// Compact timer for the persistent banner
function MiniTimer({startedAt}) {
  const [e,setE]=useState(0);
  useEffect(()=>{const t=()=>setE(Math.floor((Date.now()-new Date(startedAt))/1000));t();const id=setInterval(t,1000);return ()=>clearInterval(id);},[startedAt]);
  const m=Math.floor(e/60),s=e%60;
  return <span style={{...M,fontSize:14,fontWeight:700,color:"#ff5a2d",fontVariantNumeric:"tabular-nums"}}>{String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}</span>;
}

// Persistent wait banner shown on every tab while a wait is active
function PersistentWaitBanner({restaurantName,startedAt,onPickedUp}) {
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,background:"linear-gradient(135deg,var(--tint-coral),var(--tint-coral2))",borderBottom:"1px solid #ff5a2d44",padding:"0 12px",height:56,flexShrink:0}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:8,...M,fontWeight:700,color:"#ff5a2d",letterSpacing:1}}>⏱ WAITING AT</div>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
          <span style={{...B,fontSize:15,color:"var(--ink)",letterSpacing:0.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{restaurantName}</span>
          <MiniTimer startedAt={startedAt}/>
        </div>
      </div>
      <button onClick={onPickedUp} style={{flexShrink:0,background:"#06c167",border:"none",borderRadius:10,...B,fontWeight:700,fontSize:12,letterSpacing:0.5,color:"#fff",padding:"9px 11px",cursor:"pointer"}}>✓ GOT IT — PICKED UP</button>
    </div>
  );
}

function PasswordInput({value,onChange,placeholder}) {
  const [show,setShow]=useState(false);
  return(
    <div style={{position:"relative"}}>
      <input type={show?"text":"password"} value={value} onChange={onChange} placeholder={placeholder||"Password"}
        style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:14,padding:"16px 48px 16px 18px",color:"var(--ink)",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:show?1:3}}
        onFocus={e=>{e.target.style.borderColor="#00b8a9";}} onBlur={e=>{e.target.style.borderColor="var(--border2)";}}
      />
      <button type="button" onClick={()=>setShow(s=>!s)}
        style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:16,color:"var(--muted2)",padding:4}}>
        {show?"🙈":"👁"}
      </button>
    </div>
  );
}

// ── AD BANNER ─────────────────────────────────────────────────────────────────
// Shows a real AdSense unit once ADSENSE_SLOT is set & approved; otherwise a placeholder.
// Hidden entirely for premium subscribers.
function AdBanner({premium}) {
  const ref=useRef(null);
  const pushed=useRef(false);
  useEffect(()=>{
    if(premium||!ADSENSE_SLOT||pushed.current)return;
    try{(window.adsbygoogle=window.adsbygoogle||[]).push({});pushed.current=true;}catch(e){}
  },[premium]);
  if(premium)return null;
  // Placeholder shown until AdSense slot is configured/approved
  if(!ADSENSE_SLOT){
    return(
      <div style={{background:"var(--card)",border:"1px dashed var(--faint2)",borderRadius:12,padding:"18px 16px",textAlign:"center",marginBottom:8}}>
        <div style={{fontSize:8,color:"var(--faint)",letterSpacing:2,marginBottom:4}}>ADVERTISEMENT</div>
        <div style={{...B,fontSize:15,color:"var(--muted2)",letterSpacing:1}}>YOUR AD HERE</div>
        <div style={{fontSize:9,color:"var(--faint2)",marginTop:4}}>Go premium to remove ads · {SUB_PRICE}/mo</div>
      </div>
    );
  }
  return(
    <div style={{marginBottom:8}}>
      <ins ref={ref} className="adsbygoogle" style={{display:"block"}}
        data-ad-client={ADSENSE_CLIENT} data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto" data-full-width-responsive="true"/>
    </div>
  );
}

// ── UPGRADE / SUBSCRIPTION ────────────────────────────────────────────────────
function UpgradeScreen({premium,onBack,onSubscribe,onCancel}) {
  const perks=[
    {icon:"🚫",title:"No ads",desc:"Clean, distraction-free experience"},
    {icon:"📊",title:"Full community data",desc:"See every driver's logs & full history"},
    {icon:"💬",title:"All area chats",desc:"Access driver chat in any town, not just yours"},
    {icon:"📁",title:"Export your logs",desc:"Download your wait history as CSV"},
  ];
  return(
    <div style={{padding:"20px 16px 120px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
        <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:2}}>DELIVR PREMIUM</div>
      </div>

      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:52,marginBottom:8}}>⭐</div>
        <div style={{...B,fontSize:48,color:"#00b8a9",letterSpacing:1,lineHeight:1}}>{SUB_PRICE}<span style={{fontSize:18,color:"var(--muted)"}}>/month</span></div>
        <div style={{fontSize:11,...M,color:"var(--muted)",marginTop:6}}>Cancel anytime</div>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:28}}>
        {perks.map((p,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:14,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:26}}>{p.icon}</div>
            <div>
              <div style={{...B,fontSize:17,color:"var(--ink)",letterSpacing:1}}>{p.title}</div>
              <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:2}}>{p.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {premium?(
        <>
          <div style={{background:"linear-gradient(135deg,var(--tint-green),var(--tint-green))",border:"1px solid #06c16744",borderRadius:14,padding:"18px",textAlign:"center",marginBottom:16}}>
            <div style={{...B,fontSize:22,color:"#06c167",letterSpacing:2}}>✓ YOU'RE PREMIUM</div>
            <div style={{fontSize:10,...M,color:"#0a8f4f",marginTop:4}}>Thanks for supporting Delivr</div>
          </div>
          <button onClick={onCancel}
            style={{width:"100%",minHeight:48,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:16,letterSpacing:2,color:"var(--muted2)",cursor:"pointer"}}>
            CANCEL SUBSCRIPTION
          </button>
        </>
      ):(
        <button onClick={onSubscribe}
          style={{width:"100%",minHeight:64,background:"#00b8a9",border:"none",borderRadius:14,...B,fontSize:24,letterSpacing:3,color:"#000",cursor:"pointer",boxShadow:"0 0 40px #00b8a940"}}>
          UPGRADE NOW →
        </button>
      )}
    </div>
  );
}

// ── GPS GATE ──────────────────────────────────────────────────────────────────
function GPSGateScreen({status,onRetry,onSkip}) {
  const acquiring=status==="pending"||status==="acquiring";
  const denied=status==="denied";
  const error=status==="error";
  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 28px",background:"linear-gradient(160deg,var(--tint-teal) 0%,var(--bg) 55%)"}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{fontSize:64,marginBottom:20}}>{acquiring?"🛰️":denied?"🔒":"📍"}</div>
        <div style={{...B,fontSize:34,color:"#00b8a9",letterSpacing:2,marginBottom:12}}>
          {acquiring?"GETTING LOCATION":denied?"LOCATION BLOCKED":error?"NO GPS ON DEVICE":"ENABLE LOCATION"}
        </div>
        <div style={{fontSize:13,...M,color:"var(--muted)",lineHeight:1.8,maxWidth:330,margin:"0 auto"}}>
          {acquiring?"Waiting for GPS signal…":
           denied?"Location is turned off for this site. Here's how to switch it on:":
           error?"This device can't provide a location.":
           "DELIVR needs your location to show nearby restaurants and verify arrivals."}
        </div>
      </div>

      {/* iOS Safari instructions when blocked */}
      {denied&&(
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px 18px",maxWidth:360,marginBottom:20,fontSize:12,...M,color:"var(--muted)",lineHeight:1.8}}>
          <div style={{...B,fontSize:13,color:"var(--ink)",letterSpacing:1,marginBottom:8}}>ON IPHONE (SAFARI)</div>
          1. Tap the <b>“aA”</b> on the left of the address bar<br/>
          2. Tap <b>Website Settings</b><br/>
          3. Set <b>Location → Allow</b><br/>
          4. Also check <b>Settings → Privacy → Location Services → Safari → While Using</b><br/>
          5. Then tap the button below
        </div>
      )}

      <div style={{width:"100%",maxWidth:360,display:"flex",flexDirection:"column",gap:12}}>
        {!error&&(
          <button onClick={onRetry} disabled={acquiring} style={{minHeight:62,background:acquiring?"var(--border)":"#00b8a9",border:"none",borderRadius:14,...B,fontSize:24,letterSpacing:2,color:acquiring?"var(--muted2)":"#fff",cursor:acquiring?"default":"pointer",boxShadow:acquiring?"none":"0 8px 20px #00b8a940"}}>
            {acquiring?"ACQUIRING…":denied?"I'VE ENABLED IT → RETRY":"ENABLE LOCATION →"}
          </button>
        )}
        {/* Escape hatch so a GPS-broken phone is never fully locked out */}
        {(denied||error)&&(
          <button onClick={onSkip} style={{minHeight:46,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...M,fontSize:12,fontWeight:700,letterSpacing:1,color:"var(--muted2)",cursor:"pointer"}}>
            Continue without location (limited features)
          </button>
        )}
      </div>
    </div>
  );
}

// ── PROFILE SCREEN ────────────────────────────────────────────────────────────
function ProfileScreen({user,waitLog,gps,premium,theme,onToggleTheme,onBack,onLogout,onSave,onUpgrade,onStats,contribCount}) {
  const [name,setName]=useState(user.name||"");
  const [phone,setPhone]=useState(user.phone||"");
  const [area,setArea]=useState(user.area||"");
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [showPw,setShowPw]=useState(false);
  const [curPw,setCurPw]=useState("");
  const [newPw,setNewPw]=useState("");
  const [pwMsg,setPwMsg]=useState("");
  const [pwLoading,setPwLoading]=useState(false);

  const totalLogs=waitLog.length;
  const totalRestaurants=new Set(waitLog.map(l=>l.restaurantId)).size;
  const avgWait=totalLogs>0?(waitLog.reduce((s,l)=>s+l.waitMins,0)/totalLogs).toFixed(1):"—";

  async function save(){
    setSaving(true);setSaved(false);
    await onSave({name:name.trim()||user.name,phone:phone.trim(),area:area.trim()});
    setSaving(false);setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  }

  async function changePw(){
    if(!curPw||newPw.length<6){setPwMsg("New password must be at least 6 characters");return;}
    setPwLoading(true);setPwMsg("");
    try{
      const loginEmail=user.email||auth.currentUser?.email;
      const cred=EmailAuthProvider.credential(loginEmail,curPw);
      await reauthenticateWithCredential(auth.currentUser,cred);
      await updatePassword(auth.currentUser,newPw);
      setPwMsg("✓ Password changed");setCurPw("");setNewPw("");setShowPw(false);
    }catch(e){
      setPwMsg(e.code==="auth/wrong-password"||e.code==="auth/invalid-credential"?"Wrong current password":"Could not change password");
    }
    setPwLoading(false);
  }

  const stat=(val,label)=>(
    <div style={{flex:1,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 10px",textAlign:"center"}}>
      <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:1}}>{val}</div>
      <div style={{fontSize:8,...M,color:"var(--muted2)",marginTop:3,letterSpacing:1}}>{label}</div>
    </div>
  );

  return(
    <div style={{padding:"20px 16px 120px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
        <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:2}}>DRIVER PROFILE</div>
      </div>

      {/* Avatar + info */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:20,background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px"}}>
        <div style={{width:56,height:56,borderRadius:"50%",background:user.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"0 0 20px "+user.color+"55"}}>
          <span style={{...B,fontSize:26,color:"#000"}}>{user.initial}</span>
        </div>
        <div>
          <div style={{...B,fontSize:22,color:"var(--ink)",letterSpacing:1}}>{user.name}</div>
          <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:2}}>{user.email||"—"}</div>
          <div style={{marginTop:6,background:premium?"var(--tint-green)":"var(--tint-amber)",border:"1px solid "+(premium?"#06c16744":"#f5a62344"),borderRadius:5,padding:"3px 10px",display:"inline-block"}}>
            <span style={{...B,fontSize:11,color:premium?"#06c167":"#f5a623",letterSpacing:2}}>{premium?"⭐ PREMIUM":"FREE PLAN"}</span>
          </div>
        </div>
      </div>

      {/* Subscription card */}
      <button onClick={onUpgrade}
        style={{width:"100%",background:premium?"linear-gradient(135deg,var(--tint-green),var(--tint-green))":"linear-gradient(135deg,var(--tint-coral),var(--tint-coral2))",border:"1px solid "+(premium?"#06c16744":"#00b8a966"),borderRadius:14,padding:"16px",marginBottom:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",textAlign:"left"}}>
        <div>
          <div style={{...B,fontSize:18,color:premium?"#06c167":"#00b8a9",letterSpacing:1}}>{premium?"PREMIUM ACTIVE":"GO PREMIUM"}</div>
          <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:3}}>{premium?"Manage your subscription":"No ads + full data · "+SUB_PRICE+"/mo"}</div>
        </div>
        <span style={{...B,fontSize:24,color:premium?"#06c167":"#00b8a9"}}>›</span>
      </button>

      {/* Stats */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {stat(totalLogs,"TOTAL LOGS")}
        {stat(totalRestaurants,"RESTAURANTS")}
        {stat(avgWait+"m","AVG WAIT")}
      </div>

      {/* Contributor badge + progress */}
      {(()=>{
        const c=contribCount||0;
        const bg=badgeFor(c);
        const nx=nextTier(c);
        const prevMin=bg?bg.min:0;
        const pct=nx?Math.min(100,Math.round((c-prevMin)/(nx.min-prevMin)*100)):100;
        return(
          <div style={{background:"linear-gradient(135deg,var(--tint-amber),var(--tint-coral))",border:"1px solid #f5a62344",borderRadius:14,padding:"16px",marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:nx?10:0}}>
              <div>
                <div style={{fontSize:9,color:"var(--muted)",letterSpacing:2,marginBottom:3}}>CONTRIBUTOR RANK</div>
                <div style={{...B,fontSize:20,color:"var(--ink)",letterSpacing:1}}>{bg?bg.emoji+" "+bg.label.toUpperCase():"NO BADGE YET"}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{...B,fontSize:24,color:"#f5a623"}}>{c}</div>
                <div style={{fontSize:8,color:"var(--muted)",letterSpacing:1}}>QUALITY LOGS</div>
              </div>
            </div>
            {nx&&(
              <>
                <div style={{background:"var(--border)",borderRadius:4,height:6,overflow:"hidden",marginBottom:5}}>
                  <div style={{height:6,borderRadius:4,width:pct+"%",background:"#f5a623"}}/>
                </div>
                <div style={{fontSize:10,...M,color:"var(--muted)"}}>{nx.min-c} more to {nx.emoji} {nx.label}</div>
              </>
            )}
          </div>
        );
      })()}

      {/* Edit fields */}
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
        <div>
          <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:6}}>DRIVER NAME</div>
          <input value={name} onChange={e=>setName(e.target.value)}
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
        </div>
        <div>
          <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:6}}>PHONE (OPTIONAL)</div>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+44 7700 000000" type="tel"
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
        </div>
        <div>
          <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:6}}>YOUR AREA</div>
          <input value={area} onChange={e=>setArea(e.target.value)} placeholder="e.g. Braintree, Chelmsford..."
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
          <div style={{fontSize:9,...M,color:"var(--faint)",marginTop:5}}>Sets your chat room and local restaurant list</div>
        </div>
      </div>

      <button onClick={save} disabled={saving}
        style={{width:"100%",minHeight:56,background:saving?"var(--border)":saved?"#06c167":"#00b8a9",border:"none",borderRadius:12,...B,fontSize:22,letterSpacing:3,color:saving?"var(--faint)":"#000",cursor:saving?"default":"pointer",marginBottom:20,boxShadow:saving?"none":saved?"0 0 30px #06c16730":"0 0 30px #00b8a930",transition:"all 0.2s"}}>
        {saving?"SAVING...":saved?"✓ SAVED":"SAVE CHANGES"}
      </button>

      {/* Change password */}
      <button onClick={()=>{setShowPw(s=>!s);setPwMsg("");}}
        style={{width:"100%",minHeight:52,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:18,letterSpacing:2,color:"var(--muted)",cursor:"pointer",marginBottom:showPw?0:16}}>
        {showPw?"↑ HIDE":"CHANGE PASSWORD"}
      </button>
      {showPw&&(
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"16px",marginBottom:16,display:"flex",flexDirection:"column",gap:10,marginTop:8}}>
          <input value={curPw} onChange={e=>setCurPw(e.target.value)} type="password" placeholder="Current password"
            style={{background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:10,padding:"12px 14px",color:"var(--ink)",fontSize:14,...M,outline:"none",boxSizing:"border-box",width:"100%"}}/>
          <input value={newPw} onChange={e=>setNewPw(e.target.value)} type="password" placeholder="New password (min 6)"
            style={{background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:10,padding:"12px 14px",color:"var(--ink)",fontSize:14,...M,outline:"none",boxSizing:"border-box",width:"100%"}}/>
          {pwMsg&&<div style={{fontSize:11,...M,color:pwMsg.startsWith("✓")?"#06c167":"#ef4444"}}>{pwMsg}</div>}
          <button onClick={changePw} disabled={pwLoading}
            style={{minHeight:48,background:"#00b8a9",border:"none",borderRadius:10,...B,fontSize:18,letterSpacing:2,color:"#000",cursor:"pointer"}}>
            {pwLoading?"UPDATING...":"UPDATE PASSWORD"}
          </button>
        </div>
      )}

      {/* App stats / data health — owner only */}
      {isOwner(user)&&(
        <button onClick={onStats}
          style={{width:"100%",background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px",marginBottom:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",textAlign:"left"}}>
          <div>
            <div style={{...B,fontSize:18,color:"#00b8a9",letterSpacing:1}}>📊 APP STATS</div>
            <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:3}}>Owner only · live data & top restaurants</div>
          </div>
          <span style={{...B,fontSize:24,color:"#00b8a9"}}>›</span>
        </button>
      )}

      {/* Appearance — light / dark toggle */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"14px 16px",marginBottom:16}}>
        <div>
          <div style={{...B,fontWeight:700,fontSize:16,color:"var(--ink)",letterSpacing:1}}>APPEARANCE</div>
          <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:2}}>{theme==="dark"?"Dark mode":"Light mode"}</div>
        </div>
        <button onClick={onToggleTheme} aria-label="Toggle dark mode"
          style={{position:"relative",width:64,height:34,borderRadius:18,border:"none",cursor:"pointer",background:theme==="dark"?"#00b8a9":"var(--border2)",transition:"background 0.2s",flexShrink:0}}>
          <span style={{position:"absolute",top:3,left:theme==="dark"?33:3,width:28,height:28,borderRadius:"50%",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,0.3)",transition:"left 0.2s",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>
            {theme==="dark"?"🌙":"☀️"}
          </span>
        </button>
      </div>

      <button onClick={onLogout}
        style={{width:"100%",minHeight:52,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:18,letterSpacing:2,color:"var(--muted2)",cursor:"pointer"}}>
        SIGN OUT
      </button>

      <div style={{textAlign:"center",marginTop:18}}>
        <a href="/privacy.html" style={{fontSize:10,...M,color:"var(--muted2)",letterSpacing:1,textDecoration:"none"}}>Privacy Policy</a>
      </div>
    </div>
  );
}

// ── ONBOARDING (first-time users, dark theme) ─────────────────────────────────
function Onboarding({onFinish}) {
  const [step,setStep]=useState(0);
  const D={bg:"#0e1316",card:"#192127",ink:"#eaf0f2",muted:"#9aa7af",teal:"#00b8a9",coral:"#ff5a2d",green:"#06c167"};

  const slides=[
    {
      emoji:"⏳",
      title:"You've been waiting.\nNow waiting pays.",
      body:"Every minute you sit outside a restaurant is data. Delivr turns the wait you already do into live intel that saves you — and every driver near you — time and money.",
    },
    {
      steps:[
        {e:"📍",t:"Arrive",d:"Tap once when you reach the restaurant. The timer starts automatically."},
        {e:"✅",t:"Pick up",d:"Tap once the moment you've got the order. That's your wait, logged."},
        {e:"⚡",t:"Everyone sees it",d:"Every nearby driver instantly sees the real wait time — no more guessing."},
      ],
      title:"Two taps. That's it.",
    },
    {
      emoji:"🤝",
      title:"Help me.\nI help you.",
      body:"Delivr only works because drivers share. The more you log, the smarter it gets for everyone — which restaurants are slammed, which are quick, right now. Join the crew and never walk into a 25-minute wait blind again.",
    },
  ];
  const s=slides[step];
  const isLast=step===slides.length-1;

  return(
    <div style={{minHeight:"100vh",background:D.bg,color:D.ink,display:"flex",flexDirection:"column",padding:"0 26px",fontFamily:"'Nunito',sans-serif",position:"relative",overflow:"hidden"}}>
      {/* glow */}
      <div style={{position:"absolute",top:-120,right:-80,width:280,height:280,borderRadius:"50%",background:D.teal,opacity:0.12,filter:"blur(40px)"}}/>
      <div style={{position:"absolute",bottom:-100,left:-90,width:260,height:260,borderRadius:"50%",background:D.coral,opacity:0.10,filter:"blur(40px)"}}/>

      {/* skip */}
      {!isLast&&(
        <button onClick={onFinish} style={{position:"absolute",top:18,right:22,background:"none",border:"none",color:D.muted,fontSize:13,fontWeight:700,cursor:"pointer",zIndex:2}}>Skip</button>
      )}

      <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",zIndex:1,paddingTop:40}}>
        <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:28,color:D.teal,letterSpacing:3,marginBottom:36}}>DELIVR</div>

        {s.emoji&&<div style={{fontSize:80,marginBottom:24}}>{s.emoji}</div>}

        {s.title&&(
          <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:34,lineHeight:1.15,letterSpacing:-0.5,marginBottom:18,whiteSpace:"pre-line"}}>{s.title}</div>
        )}

        {s.body&&<div style={{fontSize:16,lineHeight:1.7,color:D.muted,maxWidth:380}}>{s.body}</div>}

        {s.steps&&(
          <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:8}}>
            {s.steps.map((st,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:16,background:D.card,borderRadius:18,padding:"18px 18px"}}>
                <div style={{fontSize:34,flexShrink:0}}>{st.e}</div>
                <div>
                  <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:18,color:i===2?D.teal:D.ink}}>{st.t}</div>
                  <div style={{fontSize:13,lineHeight:1.5,color:D.muted,marginTop:2}}>{st.d}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* dots + button */}
      <div style={{zIndex:1,paddingBottom:40}}>
        <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:22}}>
          {slides.map((_,i)=>(
            <div key={i} style={{width:i===step?26:8,height:8,borderRadius:4,background:i===step?D.teal:"#2a363c",transition:"all 0.25s"}}/>
          ))}
        </div>
        <button onClick={()=>isLast?onFinish():setStep(step+1)}
          style={{width:"100%",minHeight:62,background:isLast?D.coral:D.teal,border:"none",borderRadius:18,fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:isLast?20:22,letterSpacing:isLast?0.5:1,color:"#fff",cursor:"pointer",boxShadow:isLast?"0 8px 24px "+D.coral+"55":"0 8px 24px "+D.teal+"44"}}>
          {isLast?"JOIN THE COMMUNITY →":"NEXT"}
        </button>
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({onLogin,onRegistered,initialMode}) {
  const [mode,setMode]=useState(initialMode||"login");
  const [username,setUsername]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [colorIdx,setColorIdx]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [resetMsg,setResetMsg]=useState("");
  const color=AVATAR_COLORS[colorIdx];
  const emailValid=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  function switchMode(m){setMode(m);setError("");setResetMsg("");setPassword("");setConfirm("");}

  async function submit(e) {
    e.preventDefault();setError("");setResetMsg("");
    const em=email.trim().toLowerCase();
    if(mode==="register"&&(!username.trim()||username.trim().length<2)){setError("Driver name must be at least 2 characters");return;}
    if(!emailValid(em)){setError("Enter a valid email address");return;}
    if(!password||password.length<6){setError("Password must be at least 6 characters");return;}
    if(mode==="register"&&password!==confirm){setError("Passwords do not match");return;}
    setLoading(true);
    try{
      if(mode==="register"){
        // Real email = login identifier → Firebase enforces one account per email
        const cred=await createUserWithEmailAndPassword(auth,em,password);
        const profile={name:username.trim(),color,initial:username.trim()[0].toUpperCase(),email:em};
        await updateProfile(cred.user,{displayName:JSON.stringify(profile)});
        try{ await setDoc(doc(db,"users",cred.user.uid),{username:profile.name,color,initial:profile.initial,email:em,emailVerified:false,joinedAt:new Date().toISOString()}); }catch(e){}
        // Send verification code via backend
        const r=await fetch(`${API_URL}/auth/send-code`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})});
        if(!r.ok){const d=await r.json();setError(d.error||"Could not send verification email");return;}
        onRegistered(profile,em);
      }else{
        const cred=await signInWithEmailAndPassword(auth,em,password);
        let profile=null;
        if(cred.user.displayName){
          try{ profile=JSON.parse(cred.user.displayName); }catch(e){}
        }
        if(!profile){
          try{
            const snap=await getDoc(doc(db,"users",cred.user.uid));
            if(snap.exists()){ const p=snap.data(); profile={name:p.username,color:p.color,initial:p.initial,email:p.email}; }
          }catch(e){}
        }
        if(!profile){setError("Account not found — please register");return;}
        onLogin(profile);
      }
    }catch(err){
      setError(fbAuthError(err));
    }finally{
      setLoading(false);
    }
  }

  async function forgotPassword(){
    setError("");setResetMsg("");
    const em=email.trim().toLowerCase();
    if(!emailValid(em)){setError("Type your email above first, then tap Forgot password");return;}
    setLoading(true);
    try{
      await sendPasswordResetEmail(auth,em);
      setResetMsg("Reset link sent to "+em+" — check inbox & spam. If nothing arrives in 2 min, that email may not have an account yet.");
    }catch(err){
      console.error("password reset error:",err?.code,err?.message,err);
      setError(fbAuthError(err)+(err?.code?" ["+err.code+"]":""));
    }finally{
      setLoading(false);
    }
  }

  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 24px 60px",background:"linear-gradient(160deg,var(--tint-teal) 0%,var(--bg) 55%)"}}>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{...B,fontSize:80,color:"#00b8a9",letterSpacing:8,lineHeight:1,textShadow:"0 0 80px #00b8a944"}}>DELIVR</div>
        <div style={{fontSize:10,color:"var(--faint2)",letterSpacing:5,marginTop:6}}>DRIVER COMMUNITY</div>
      </div>

      <div style={{display:"flex",background:"var(--card)",borderRadius:12,padding:4,marginBottom:28,border:"1px solid var(--border)"}}>
        {["login","register"].map(m=>(
          <button key={m} type="button" onClick={()=>switchMode(m)}
            style={{flex:1,padding:"11px 0",background:mode===m?"#00b8a9":"none",border:"none",borderRadius:9,cursor:"pointer",...B,fontSize:16,letterSpacing:2,color:mode===m?"#000":"var(--muted)",transition:"all 0.15s"}}>
            {m==="login"?"SIGN IN":"CREATE ACCOUNT"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:14}}>
        {mode==="register"&&(
          <div>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>DRIVER NAME</div>
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. FastRider99" maxLength={20} autoFocus
              style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:14,padding:"16px 18px",color:"var(--ink)",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:1}}
              onFocus={e=>{e.target.style.borderColor="#00b8a9";}} onBlur={e=>{e.target.style.borderColor="var(--border2)";}}/>
          </div>
        )}
        <div>
          <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>EMAIL ADDRESS</div>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" type="email" autoComplete="email" autoFocus={mode==="login"}
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:14,padding:"16px 18px",color:"var(--ink)",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:1}}
            onFocus={e=>{e.target.style.borderColor="#00b8a9";}} onBlur={e=>{e.target.style.borderColor="var(--border2)";}}/>
        </div>
        <div>
          <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>PASSWORD {mode==="register"&&<span style={{color:"var(--faint2)"}}>(min 6 chars)</span>}</div>
          <PasswordInput value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password"/>
          {mode==="login"&&(
            <div style={{textAlign:"right",marginTop:8}}>
              <button type="button" onClick={forgotPassword} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:11,...M,letterSpacing:1,padding:0}}>Forgot password?</button>
            </div>
          )}
        </div>
        {mode==="register"&&<>
          <div>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>CONFIRM PASSWORD</div>
            <PasswordInput value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repeat password"/>
          </div>
          <div>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:10}}>YOUR COLOUR</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {AVATAR_COLORS.map((c,i)=>(
                <button key={i} type="button" onClick={()=>setColorIdx(i)}
                  style={{width:40,height:40,borderRadius:"50%",background:c,border:colorIdx===i?"3px solid #fff":"3px solid transparent",cursor:"pointer",outline:"none",boxShadow:colorIdx===i?"0 0 18px "+c+"cc":"none",transition:"all 0.15s"}}/>
              ))}
            </div>
          </div>
          {username.trim().length>=1&&(
            <div style={{display:"flex",alignItems:"center",gap:14,background:"var(--card)",borderRadius:12,padding:"12px 16px",border:"1px solid var(--border)"}}>
              <div style={{width:44,height:44,borderRadius:"50%",background:color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:"0 0 20px "+color+"66"}}>
                <span style={{...B,fontSize:22,color:"#000"}}>{username.trim()[0].toUpperCase()}</span>
              </div>
              <div>
                <div style={{...B,fontSize:20,letterSpacing:1,color:"var(--ink)"}}>{username.trim()}</div>
                <div style={{fontSize:9,color:"var(--muted)",marginTop:2,letterSpacing:1}}>NEW DRIVER</div>
              </div>
            </div>
          )}
        </>}
        {error&&<div style={{background:"var(--tint-red)",border:"1px solid #ef444444",borderRadius:10,padding:"12px 14px",fontSize:12,...M,color:"#ef4444"}}>{error}</div>}
        {resetMsg&&<div style={{background:"var(--tint-green)",border:"1px solid #06c16744",borderRadius:10,padding:"12px 14px",fontSize:12,...M,color:"#06c167"}}>{resetMsg}</div>}
        <button type="submit" disabled={loading}
          style={{minHeight:64,background:loading?"var(--border)":"#00b8a9",border:"none",borderRadius:14,...B,fontSize:28,letterSpacing:4,color:loading?"var(--faint)":"#000",cursor:loading?"default":"pointer",marginTop:6,boxShadow:loading?"none":"0 0 40px #00b8a940",transition:"all 0.2s"}}>
          {loading?"LOADING...":(mode==="login"?"SIGN IN →":"CREATE ACCOUNT →")}
        </button>
      </form>
      <div style={{textAlign:"center",marginTop:28}}>
        <a href="/privacy.html" style={{fontSize:10,...M,color:"var(--muted2)",letterSpacing:1,textDecoration:"none"}}>Privacy Policy</a>
      </div>
    </div>
  );
}

// ── VERIFY CODE SCREEN ────────────────────────────────────────────────────────
function VerifyCodeScreen({email,onVerified,onBack}) {
  const [code,setCode]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [resending,setResending]=useState(false);
  const [resent,setResent]=useState(false);

  async function verify(){
    if(code.length!==6){setError("Enter the full 6-digit code");return;}
    setLoading(true);setError("");
    try{
      const r=await fetch(`${API_URL}/auth/verify-code`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,code})});
      const d=await r.json();
      if(!r.ok){setError(d.error||"Wrong code");return;}
      onVerified();
    }catch(e){setError("Cannot reach server — make sure it is running");}
    finally{setLoading(false);}
  }

  async function resend(){
    setResending(true);setResent(false);setError("");
    try{
      await fetch(`${API_URL}/auth/send-code`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
      setResent(true);setTimeout(()=>setResent(false),5000);
    }catch(e){}
    setResending(false);
  }

  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 24px 60px",background:"linear-gradient(160deg,var(--tint-teal) 0%,var(--bg) 55%)"}}>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{fontSize:56,marginBottom:16}}>📨</div>
        <div style={{...B,fontSize:40,color:"#00b8a9",letterSpacing:3,marginBottom:8}}>CHECK YOUR EMAIL</div>
        <div style={{fontSize:13,...M,color:"var(--muted)",lineHeight:1.7}}>We sent a 6-digit code to</div>
        <div style={{fontSize:14,...M,color:"var(--ink)",fontWeight:700,marginTop:4}}>{email}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>ENTER YOUR CODE</div>
          <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))}
            placeholder="000000" maxLength={6} inputMode="numeric" autoFocus
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:14,padding:"20px 18px",color:"#00b8a9",fontSize:32,...M,fontWeight:700,outline:"none",boxSizing:"border-box",letterSpacing:8,textAlign:"center"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}
            onKeyDown={e=>{if(e.key==="Enter")verify();}}/>
        </div>
        {error&&<div style={{background:"var(--tint-red)",border:"1px solid #ef444444",borderRadius:10,padding:"12px 14px",fontSize:12,...M,color:"#ef4444"}}>{error}</div>}
        <button onClick={verify} disabled={loading||code.length!==6}
          style={{minHeight:64,background:loading||code.length!==6?"var(--border)":"#00b8a9",border:"none",borderRadius:14,...B,fontSize:28,letterSpacing:4,color:loading||code.length!==6?"var(--faint)":"#000",cursor:loading||code.length!==6?"default":"pointer",boxShadow:loading||code.length!==6?"none":"0 0 40px #00b8a940",transition:"all 0.2s"}}>
          {loading?"VERIFYING...":"VERIFY →"}
        </button>
        <button onClick={resend} disabled={resending||resent}
          style={{minHeight:52,background:"none",border:"1px solid "+(resent?"#06c167":"var(--faint2)"),borderRadius:12,...B,fontSize:18,letterSpacing:2,color:resent?"#06c167":"var(--muted)",cursor:resending||resent?"default":"pointer",transition:"all 0.2s"}}>
          {resending?"SENDING...":(resent?"✓ CODE SENT":"RESEND CODE")}
        </button>
        <button onClick={onBack}
          style={{minHeight:44,background:"none",border:"none",color:"var(--faint)",cursor:"pointer",fontSize:11,...M,letterSpacing:1}}>
          Use a different account
        </button>
      </div>
    </div>
  );
}

// ── RESTAURANT DETAIL ─────────────────────────────────────────────────────────
function RestaurantDetail({r,now,gps,waitLog,communityPatterns,distMap,checkingId,arrivalError,activeWait,manualVoted,onArrived,onManualArrive,onBack}) {
  const ck=cardKey(r);
  const personal=getPersonalWait(ck,now,waitLog);
  const community=getCommunityWait(ck,now,communityPatterns);
  const usePersonal=personal?.hasEnough;
  const useCommunity=!usePersonal&&community!=null;
  const hasReal=usePersonal||useCommunity;
  const displayWait=usePersonal?personal.avg:useCommunity?community.avg:null;
  const riskColor=displayWait==null?"var(--muted)":displayWait>18?"#ef4444":displayWait>10?"#f5a623":"#06c167";
  const d=distMap[r.id];
  const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;
  const isChecking=checkingId===r.id;
  const hasError=arrivalError?.restaurantId===r.id;
  const isActive=activeWait?.restaurantId===r.id;
  const myLogs=waitLog.filter(l=>logKey(l)===ck);
  const periods=["early morning","morning","lunch","afternoon","evening","late night"];
  const p=communityPatterns[ck];
  // Manual Arrive: enabled only within 300m of the restaurant's pinned location
  const manualDist=gps?.status==="active"&&gps.lat!=null?distMeters(gps.lat,gps.lng,r.branchLat??r.lat,r.branchLng??r.lng):null;
  const within300=manualDist!=null&&manualDist<=300;
  const voted=manualVoted===r.id;

  return(
    <div style={{padding:"20px 16px 120px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
        <div style={{flex:1}}>
          <div style={{...B,fontSize:22,color:"var(--ink)",letterSpacing:1}}>{r.name}</div>
          <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>{r.label}{dStr&&<span style={{color:"#00b8a9"}}>{" · "+dStr+" away"}</span>}</div>
        </div>
        <div style={{textAlign:"right"}}>
          {r.openNow===false?(
            <div style={{...B,fontSize:22,color:"var(--muted2)",letterSpacing:1}}>CLOSED</div>
          ):displayWait!=null?(<>
            <div style={{...B,fontSize:38,color:riskColor,letterSpacing:1,lineHeight:1}}>{displayWait}m</div>
            <div style={{fontSize:9,color:"var(--muted2)"}}>{usePersonal?"YOUR AVG":"COMMUNITY"}</div>
          </>):(
            <div style={{...B,fontSize:15,color:"var(--faint)",letterSpacing:1}}>NO DATA YET</div>
          )}
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <div style={{flex:1,background:"var(--tint-green)",border:"1px solid #06c16722",borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:8,color:"#06c167",letterSpacing:2,marginBottom:4}}>YOUR DATA</div>
          {personal?(<>
            <div style={{...B,fontSize:24,color:"#06c167"}}>{personal.avg}m</div>
            <div style={{fontSize:9,color:"#0a8f4f",marginTop:2}}>{personal.count} visit{personal.count!==1?"s":""} · {personal.context}</div>
          </>):<div style={{...B,fontSize:14,color:"var(--border)"}}>NO VISITS YET</div>}
        </div>
        <div style={{flex:1,background:"var(--tint-blue)",border:"1px solid #2b8fff22",borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:8,color:"#2b8fff",letterSpacing:2,marginBottom:4}}>COMMUNITY</div>
          {community?(<>
            <div style={{...B,fontSize:24,color:"#2b8fff"}}>{community.avg}m</div>
            <div style={{fontSize:9,color:"#1c6fd0",marginTop:2}}>{community.count} logs · {community.drivers} driver{community.drivers!==1?"s":""}</div>
          </>):<div style={{...B,fontSize:14,color:"var(--border)"}}>NO DATA YET</div>}
        </div>
      </div>

      {/* Typical wait predicted for right now (this day + hour) */}
      {(()=>{
        const pred=predictWait(ck,now.getDay(),now.getHours(),communityPatterns);
        if(!pred)return null;
        const c=pred.avg>18?"#ef4444":pred.avg>10?"#f5a623":"#06c167";
        return(
          <div style={{background:"var(--tint-teal)",border:"1px solid #00b8a933",borderRadius:12,padding:"14px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:9,color:"#00b8a9",letterSpacing:2,marginBottom:3}}>TYPICAL RIGHT NOW</div>
              <div style={{fontSize:11,...M,color:"var(--muted)"}}>Based on {pred.context} · {pred.count} log{pred.count!==1?"s":""}</div>
            </div>
            <div style={{...B,fontSize:30,color:c,letterSpacing:1}}>{pred.avg}m</div>
          </div>
        );
      })()}

      {/* Busiest times — hourly bar chart for the current weekday */}
      {(()=>{
        const dow=now.getDay();
        const hrs=[];
        for(let h=6;h<=23;h++){ const b=p?.byDayHour?.[`${dow}_${h}`]||p?.byHour?.[h]; if(b)hrs.push({h,avg:b.avg}); }
        if(hrs.length<2)return null;
        const max=Math.max(...hrs.map(x=>x.avg),1);
        const busiest=hrs.reduce((a,b)=>b.avg>a.avg?b:a,hrs[0]);
        return(
          <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:12}}>BUSIEST TIMES · {dayLabel(dow).toUpperCase()}</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:3,height:80}}>
              {hrs.map(x=>{
                const ht=Math.max(8,(x.avg/max)*70);
                const c=x.avg>18?"#ef4444":x.avg>10?"#f5a623":"#06c167";
                return(
                  <div key={x.h} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <div style={{...B,fontSize:8,color:c}}>{x.avg}</div>
                    <div style={{width:"100%",maxWidth:14,height:ht,borderRadius:3,background:c,opacity:x.h===busiest.h?1:0.55}}/>
                    <div style={{fontSize:7,color:"var(--faint)"}}>{x.h}</div>
                  </div>
                );
              })}
            </div>
            <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:10,textAlign:"center"}}>Busiest around <b style={{color:"#ef4444"}}>{hourLabel(busiest.h)}</b> (~{busiest.avg}m) · hours shown bottom</div>
          </div>
        );
      })()}

      {myLogs.length>0&&(
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:10}}>YOUR VISITS</div>
          {myLogs.slice().reverse().map(l=>{
            const c=l.waitMins>15?"#ef4444":l.waitMins>8?"#f5a623":"#06c167";
            return(
              <div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:8,borderBottom:"1px solid var(--border3)",marginBottom:8}}>
                <div style={{fontSize:10,...M,color:"var(--muted)"}}>{new Date(l.ts).toLocaleString("en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
                <div style={{...B,fontSize:16,color:c}}>{l.waitMins}m</div>
              </div>
            );
          })}
        </div>
      )}

      {onArrived&&(
      <div style={{position:"fixed",bottom:56,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,padding:"12px 16px",background:"var(--card)",borderTop:"1px solid var(--border3)"}}>
        {!isActive?(
          <>
            <button onClick={()=>onArrived(r)} disabled={isChecking}
              style={{width:"100%",minHeight:64,background:isChecking?"var(--tint-coral)":hasError?"var(--tint-red)":"#ff5a2d",border:isChecking?"1px solid #00b8a944":hasError?"1px solid #ef444444":"none",borderRadius:16,...B,fontWeight:700,fontSize:22,letterSpacing:1,color:isChecking?"#00b8a9":hasError?"#ef4444":"#fff",cursor:isChecking?"default":"pointer",boxShadow:isChecking||hasError?"none":"0 8px 20px #ff5a2d40"}}>
              {isChecking?"CHECKING...":hasError?arrivalError.dist+"M AWAY":"📍 ARRIVED HERE"}
            </button>
            {/* Manual Arrive — only active within 300m; logs a location vote to fix the pin */}
            <button onClick={()=>{ if(within300&&!voted) onManualArrive(r); }} disabled={!within300||voted}
              style={{width:"100%",minHeight:48,marginTop:8,background:voted?"var(--tint-green)":"none",border:"1px solid "+(voted?"#06c16766":within300?"#00b8a966":"var(--border2)"),borderRadius:12,...B,fontSize:16,letterSpacing:2,color:voted?"#06c167":within300?"#00b8a9":"var(--faint)",cursor:within300&&!voted?"pointer":"default"}}>
              {voted?"✓ LOCATION VOTED":within300?"MANUAL ARRIVE":(manualDist!=null?"MANUAL ARRIVE · "+(manualDist<1000?Math.round(manualDist)+"m away":(manualDist/1000).toFixed(1)+"km away"):"MANUAL ARRIVE · NO GPS")}
            </button>
          </>
        ):(
          <div style={{...B,fontSize:16,color:"#00b8a9",letterSpacing:2,textAlign:"center",padding:"14px 0"}}>● TIMING NOW — GO BACK TO LOG</div>
        )}
      </div>
      )}
    </div>
  );
}

// ── LIVE ACTIVITY FEED ────────────────────────────────────────────────────────
function relTime(ts){
  const s=Math.floor((Date.now()-new Date(ts).getTime())/1000);
  if(s<60)return "just now";
  const m=Math.floor(s/60); if(m<60)return m+"m ago";
  const h=Math.floor(m/60); if(h<24)return h+"h ago";
  return Math.floor(h/24)+"d ago";
}
function LiveFeed({activeWaitsList,communityLogs,contribCounts,onOpen}) {
  const [,tick]=useState(0);
  useEffect(()=>{const id=setInterval(()=>tick(x=>x+1),30000);return ()=>clearInterval(id);},[]); // refresh relative times
  const events=[
    ...activeWaitsList.map(w=>({kind:"arrived",user:w.username||"A driver",rest:w.restaurantName||"a restaurant",ts:w.startedAt})),
    ...communityLogs.map(l=>({kind:"picked",user:l.username||"A driver",rest:l.restaurantName||"a restaurant",waitMins:l.waitMins,ts:l.ts})),
  ].sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,10);

  return(
    <div onClick={onOpen} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"12px 14px",marginBottom:14,cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:"#06c167",boxShadow:"0 0 6px #06c167",animation:"criticalPulse 2s ease-in-out infinite"}}/>
        <span style={{...B,fontSize:13,color:"var(--ink)",letterSpacing:2}}>LIVE ACTIVITY</span>
        <span style={{marginLeft:"auto",fontSize:10,...M,fontWeight:700,color:"#00b8a9"}}>View all ›</span>
      </div>
      {events.length===0?(
        <div style={{fontSize:11,...M,color:"var(--faint)",padding:"6px 0"}}>No activity yet — be the first to log a wait.</div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {events.map((e,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:9,fontSize:12,...M}}>
              <span style={{fontSize:14}}>{e.kind==="arrived"?"🟢":"✅"}</span>
              <span style={{color:"var(--ink)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                <b style={{fontWeight:700}}>{e.user}</b>{(()=>{const bg=badgeFor(contribCounts?.[e.user]||0);return bg?<span style={{marginLeft:2}}>{bg.emoji}</span>:null;})()}
                {e.kind==="arrived"?" arrived at ":" picked up at "}
                <b style={{fontWeight:700}}>{e.rest}</b>
                {e.kind==="picked"&&e.waitMins!=null&&<span style={{color:"#06c167"}}>{" · "+e.waitMins}m</span>}
              </span>
              <span style={{color:"var(--faint)",fontSize:10,flexShrink:0}}>{relTime(e.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LOGBOOK (date-based community activity) ───────────────────────────────────
function Logbook({communityLogs,contribCounts,onBack}) {
  const [offset,setOffset]=useState(0); // 0 = today, 1 = yesterday, ...
  const day=new Date(); day.setDate(day.getDate()-offset);
  const dayStr=day.toISOString().slice(0,10);
  const isToday=offset===0;
  const label=isToday?"Today":offset===1?"Yesterday":day.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"short"});

  const items=communityLogs
    .filter(l=>(l.ts||"").slice(0,10)===dayStr)
    .sort((a,b)=>new Date(b.ts)-new Date(a.ts));

  return(
    <div style={{padding:"20px 16px 100px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
        <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:2}}>LOGBOOK</div>
      </div>

      {/* day navigator */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"10px 14px",marginBottom:14}}>
        <button onClick={()=>setOffset(o=>o+1)} style={{background:"none",border:"none",color:"#00b8a9",fontSize:22,cursor:"pointer",padding:"0 8px"}}>‹</button>
        <div style={{textAlign:"center"}}>
          <div style={{...B,fontSize:18,color:"var(--ink)",letterSpacing:1}}>{label}</div>
          <div style={{fontSize:9,...M,color:"var(--muted)"}}>{items.length} pickup{items.length!==1?"s":""}</div>
        </div>
        <button onClick={()=>setOffset(o=>Math.max(0,o-1))} disabled={isToday} style={{background:"none",border:"none",color:isToday?"var(--faint2)":"#00b8a9",fontSize:22,cursor:isToday?"default":"pointer",padding:"0 8px"}}>›</button>
      </div>

      {items.length===0?(
        <div style={{fontSize:11,...M,color:"var(--faint)",textAlign:"center",padding:"40px 0"}}>No activity logged on this day.</div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {items.map((l,i)=>{
            const bg=badgeFor(contribCounts?.[l.username]||0);
            const c=l.waitMins>15?"#ef4444":l.waitMins>8?"#f5a623":"#06c167";
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
                <span style={{fontSize:14}}>✅</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,...M,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <b style={{fontWeight:700}}>{l.username||"A driver"}</b>{bg&&<span style={{marginLeft:2}}>{bg.emoji}</span>} picked up at <b style={{fontWeight:700}}>{l.restaurantName||"a restaurant"}</b>
                  </div>
                  <div style={{fontSize:9,...M,color:"var(--muted)",marginTop:1}}>{new Date(l.ts).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</div>
                </div>
                {l.waitMins!=null&&<span style={{...B,fontSize:16,color:c,flexShrink:0}}>{l.waitMins}m</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── WAITS SCREEN ──────────────────────────────────────────────────────────────
function WaitsScreen({now,gps,restaurants,waitLog,activeWait,communityPatterns,communityLogs,checkingId,arrivalError,premium,manualVoted,activeCounts,activeWaitsList,contribCounts,onOpenLogbook,onArrived,onManualArrive,onPickedUp,onCancelWait}) {
  const [picking,setPicking]=useState(false);
  const [selectedRestaurant,setSelectedRestaurant]=useState(null);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const searchTimer=useRef(null);
  const per=timePeriod(now.getHours());
  const meta=communityPatterns._meta;

  const distMap={};
  if(gps.status==="active"&&restaurants?.length){
    restaurants.forEach(r=>{
      const lat=r.branchLat??r.lat,lng=r.branchLng??r.lng;
      const d=distMeters(gps.lat,gps.lng,lat,lng);
      if(d!=null)distMap[r.id]=d;
    });
  }

  // Sort: active wait pinned top → fixed priority chains (in order) → nearest → busiest → estimate
  const PRIORITY=[["mcdonald"],["kfc"],["nando"],["wagamama"],["pizza express","pizzaexpress"],["zizzi"],["coco di mama","cocodimama"],["sainsbury"]];
  const prio=r=>{const n=(r.name||"").toLowerCase();const i=PRIORITY.findIndex(keys=>keys.some(k=>n.includes(k)));return i===-1?999:i;};
  const logCount=r=>communityPatterns[cardKey(r)]?.overall?.count||0;
  const sorted=restaurants.slice().sort((a,b)=>{
    if(activeWait?.restaurantId===a.id)return -1;
    if(activeWait?.restaurantId===b.id)return 1;
    const pa=prio(a),pb=prio(b);
    if(pa!==pb)return pa-pb;                  // McDonald's, KFC, Nando's... in this exact order
    const da=distMap[a.id],db=distMap[b.id];
    if(da!=null&&db!=null)return da-db;       // then nearest by GPS
    if(da!=null)return -1;if(db!=null)return 1;
    const la=logCount(a),lb=logCount(b);
    if(la!==lb)return lb-la;                  // then busiest
    return(b.baseWait/b.rel)-(a.baseWait/a.rel);
  });

  function handleSearchInput(q){
    setSearchQuery(q);
    clearTimeout(searchTimer.current);
    if(!q.trim()){setSearchResults([]);return;}
    setSearching(true);
    searchTimer.current=setTimeout(async()=>{
      const results=await searchRestaurants(q,gps.lat,gps.lng);
      setSearchResults(results);
      setSearching(false);
    },400);
  }

  function closePicker(){setPicking(false);setSearchQuery("");setSearchResults([]);}

  if(selectedRestaurant){
    return <RestaurantDetail r={selectedRestaurant} now={now} gps={gps} waitLog={waitLog} communityPatterns={communityPatterns}
      distMap={distMap} checkingId={checkingId} arrivalError={arrivalError} activeWait={activeWait} manualVoted={manualVoted}
      onArrived={onArrived} onManualArrive={onManualArrive} onBack={()=>setSelectedRestaurant(null)}/>;
  }

  if(picking){
    const displayList=searchQuery.trim().length>=2?searchResults:restaurants.slice().sort((a,b)=>{const da=distMap[a.id],db=distMap[b.id];if(da!=null&&db!=null)return da-db;if(da!=null)return -1;if(db!=null)return 1;return 0;});
    return(
      <div style={{padding:"20px 16px 100px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <button onClick={closePicker} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
          <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:2}}>ARRIVED AT</div>
        </div>
        <div style={{position:"relative",marginBottom:14}}>
          <input value={searchQuery} onChange={e=>handleSearchInput(e.target.value)}
            placeholder="Type restaurant name..." autoFocus
            style={{width:"100%",background:"var(--card)",border:"1px solid #00b8a966",borderRadius:12,padding:"14px 18px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="#00b8a966"}/>
          {searching&&<div style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"#00b8a9",...B,letterSpacing:1}}>SEARCHING...</div>}
        </div>
        {searchQuery.length>=2&&searchResults.length===0&&!searching&&(
          <div style={{fontSize:11,color:"var(--muted2)",textAlign:"center",padding:"20px 0",...M}}>No results found — try a different name</div>
        )}
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {displayList.map(r=>{
            const d=distMap[r.id];
            const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;
            const personal=getPersonalWait(r.id,now,waitLog);
            const community=getCommunityWait(r.id,now,communityPatterns);
            const best=personal?.hasEnough?personal.avg:(community?.avg??null);
            const isChecking=checkingId===r.id;
            const hasError=arrivalError?.restaurantId===r.id;
            return(
              <button key={r.id} onClick={async()=>{const ok=await onArrived(r);if(ok)closePicker();}} disabled={isChecking}
                style={{background:"var(--card)",border:"1px solid "+(hasError?"#ef444444":"var(--border)"),borderRadius:12,padding:"14px 16px",cursor:isChecking?"default":"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:18,letterSpacing:1,color:"var(--ink)"}}>{r.name}</div>
                  <div style={{fontSize:10,color:"var(--muted)",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {dStr&&<span style={{color:"#00b8a9"}}>{dStr+" · "}</span>}
                    {r.address||( best!=null?<span style={{color:"#06c167"}}>{"~"+best+"m wait"}</span>:("est. "+r.baseWait+"m"))}
                  </div>
                </div>
                <span style={{...B,fontSize:isChecking||hasError?10:26,color:hasError?"#ef4444":isChecking?"var(--muted)":"#00b8a9",letterSpacing:1,flexShrink:0,marginLeft:10}}>
                  {isChecking?"CHECKING...":hasError?arrivalError.dist+"M AWAY":"→"}
                </span>
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
          <div style={{...B,fontSize:34,color:"#00b8a9",letterSpacing:2}}>RESTAURANT WAITS</div>
          <div style={{fontSize:10,color:"var(--muted2)",letterSpacing:1,marginTop:2}}>{per.toUpperCase()+" · "+dayLabel(now.getDay()).toUpperCase()}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5,background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"6px 10px",marginTop:4}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:{pending:"var(--muted)",acquiring:"#f5a623",active:"#06c167",error:"#00b8a9",denied:"#ef4444"}[gps.status]||"var(--muted)",boxShadow:"0 0 5px "+({pending:"var(--muted)",acquiring:"#f5a623",active:"#06c167",error:"#00b8a9",denied:"#ef4444"}[gps.status]||"var(--muted)")}}/>
          <span style={{fontSize:9,color:"var(--muted2)",letterSpacing:1}}>{gps.status==="active"?"±"+gps.accuracy+"m":gps.status.toUpperCase()}</span>
        </div>
      </div>

      {meta?.totalLogs>0&&(
        <div style={{background:"linear-gradient(135deg,var(--tint-green),var(--tint-green))",border:"1px solid #06c16722",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#06c167",boxShadow:"0 0 8px #06c167",animation:"criticalPulse 2.5s ease-in-out infinite"}}/>
            <span style={{...B,fontSize:14,color:"#06c167",letterSpacing:2}}>COMMUNITY DATA LIVE</span>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{...M,fontSize:11,fontWeight:700,color:"#06c167"}}>{meta.totalLogs.toLocaleString()} logs</div>
            <div style={{fontSize:9,color:"#0a8f4f",letterSpacing:1}}>{meta.totalDrivers} driver{meta.totalDrivers!==1?"s":""}</div>
          </div>
        </div>
      )}

      <LiveFeed activeWaitsList={activeWaitsList} communityLogs={communityLogs} contribCounts={contribCounts} onOpen={onOpenLogbook}/>

      {activeWait?(
        <div style={{background:"linear-gradient(135deg,var(--tint-coral),var(--tint-coral2))",border:"2px solid #00b8a9",borderRadius:16,padding:"20px",marginBottom:16,boxShadow:"0 0 40px #00b8a918"}}>
          <div style={{fontSize:9,color:"#00b8a9",letterSpacing:2,marginBottom:6}}>⏱ WAITING AT</div>
          <div style={{...B,fontSize:28,color:"var(--ink)",letterSpacing:1,marginBottom:14}}>
            {(restaurants.find(r=>r.id===activeWait.restaurantId)||{name:activeWait.restaurantName||"Unknown"}).name}
          </div>
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><LiveTimer startedAt={activeWait.startedAt}/></div>
          <div style={{display:"flex",gap:10}}>
            <button onClick={onPickedUp} style={{flex:1,minHeight:72,background:"#06c167",border:"none",borderRadius:12,...B,fontSize:24,letterSpacing:2,color:"#000",cursor:"pointer",boxShadow:"0 0 20px #06c16733"}}>✓ PICKED UP</button>
            <button onClick={onCancelWait} style={{minHeight:72,width:72,background:"var(--border)",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:22,color:"var(--muted2)",cursor:"pointer"}}>✕</button>
          </div>
          <div style={{fontSize:9,color:"var(--muted2)",textAlign:"center",marginTop:10,letterSpacing:1}}>TAP PICKED UP THE MOMENT YOU HAVE THE ORDER</div>
        </div>
      ):(
        <button onClick={()=>setPicking(true)} style={{width:"100%",minHeight:80,background:"#ff5a2d",border:"none",borderRadius:18,...B,fontWeight:700,fontSize:24,letterSpacing:1,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,boxShadow:"0 8px 20px #ff5a2d40"}}>
          📍 ARRIVED AT RESTAURANT
        </button>
      )}

      {!premium&&<AdBanner premium={premium}/>}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {sorted.map((r,idx)=>{
          const ck=cardKey(r);
          const personal=getPersonalWait(ck,now,waitLog);
          const community=getCommunityWait(ck,now,communityPatterns);
          const usePersonal=personal?.hasEnough;
          const useCommunity=!usePersonal&&community!=null;
          const hasReal=usePersonal||useCommunity;
          const realAvg=usePersonal?personal.avg:useCommunity?community.avg:null;  // real data only — no guessing
          const dataSource=usePersonal?"YOUR DATA":useCommunity?"COMMUNITY":null;
          const closed=r.openNow===false;
          const waitingNow=activeCounts[ck]||0;
          const riskColor=realAvg==null?"var(--muted)":realAvg>18?"#ef4444":realAvg>10?"#f5a623":"#06c167";
          const riskLabel=realAvg==null?null:realAvg>18?"HIGH RISK":realAvg>10?"MODERATE":"LOW RISK";
          const isActive=activeWait?.restaurantId===r.id;
          const myLogs=waitLog.filter(l=>logKey(l)===ck);
          const d=distMap[r.id];
          const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;
          const isChecking=checkingId===r.id;
          const hasError=arrivalError?.restaurantId===r.id;
          const borderCol=closed?"var(--border)":isActive?"#00b8a9":hasReal?riskColor+"33":"var(--border)";

          return(
            <Fragment key={r.id}>
            {!premium&&idx===6&&<AdBanner premium={premium}/>}
            <div onClick={()=>setSelectedRestaurant(r)} style={{background:isActive?"var(--tint-teal)":"var(--card)",borderRadius:12,border:"1px solid "+borderCol,padding:"14px 16px",cursor:"pointer",opacity:closed?0.72:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:19,letterSpacing:1,color:"var(--ink)"}}>
                    {r.name}
                    {dStr&&<span style={{fontSize:10,color:"#00b8a9",marginLeft:8,...M,fontWeight:400}}>{dStr}</span>}
                  </div>
                  <div style={{fontSize:9,marginTop:2}}>
                    {waitingNow>0
                      ? <span style={{color:"#06c167",fontWeight:700}}>🟢 {waitingNow} waiting now</span>
                      : <span style={{color:"var(--muted)"}}>{closed?"Closed right now":"No one waiting now"}</span>}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                  {closed?(
                    <div style={{...B,fontSize:20,color:"var(--muted2)",letterSpacing:1}}>CLOSED</div>
                  ):hasReal?(<>
                    <div style={{...B,fontSize:34,color:riskColor,letterSpacing:1,lineHeight:1}}>{realAvg}m</div>
                    <div style={{fontSize:9,color:"var(--muted2)",marginTop:1}}>{dataSource}</div>
                  </>):(
                    <div style={{...B,fontSize:15,color:"var(--faint)",letterSpacing:1}}>NO DATA YET</div>
                  )}
                </div>
              </div>
              {hasReal&&!closed&&(
                <div style={{background:"var(--border)",borderRadius:4,height:4,marginBottom:10,overflow:"hidden"}}>
                  <div style={{height:4,borderRadius:4,width:Math.min(100,(realAvg/40)*100)+"%",background:riskColor}}/>
                </div>
              )}
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",marginTop:hasReal&&!closed?0:8}}>
                {usePersonal?(
                  <div style={{flex:1,minWidth:80,background:"var(--tint-green)",border:"1px solid #06c16733",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#06c167",letterSpacing:2,marginBottom:2}}>YOUR DATA</div>
                    <div style={{...B,fontSize:17,color:"#06c167",letterSpacing:1}}>{personal.avg}m</div>
                    <div style={{fontSize:8,color:"#0a8f4f",marginTop:1}}>{personal.bucketCount}v · {personal.context}</div>
                  </div>
                ):personal?(
                  <div style={{flex:1,minWidth:80,background:"var(--card)",border:"1px solid #00b8a933",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#00b8a9",letterSpacing:2,marginBottom:2}}>YOUR DATA</div>
                    <div style={{...B,fontSize:17,color:"#00b8a9",letterSpacing:1}}>{personal.avg}m</div>
                    <div style={{fontSize:8,color:"var(--muted2)",marginTop:1}}>1 visit</div>
                  </div>
                ):(
                  <div style={{flex:1,minWidth:80,background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"var(--faint)",letterSpacing:2,marginBottom:2}}>YOUR DATA</div>
                    <div style={{...B,fontSize:14,color:"var(--faint2)",letterSpacing:1}}>NONE YET</div>
                  </div>
                )}
                {community?(
                  <div style={{flex:1,minWidth:80,background:"var(--tint-blue)",border:"1px solid #2b8fff33",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#2b8fff",letterSpacing:2,marginBottom:2}}>COMMUNITY</div>
                    <div style={{...B,fontSize:17,color:"#2b8fff",letterSpacing:1}}>{community.avg}m</div>
                    <div style={{fontSize:8,color:"#1c6fd0",marginTop:1}}>{community.count} logs · {community.drivers}d</div>
                  </div>
                ):(
                  <div style={{flex:1,minWidth:80,background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"var(--border2)",letterSpacing:2,marginBottom:2}}>COMMUNITY</div>
                    <div style={{...B,fontSize:14,color:"var(--border)",letterSpacing:1}}>NO DATA</div>
                  </div>
                )}
                <div style={{minWidth:72,background:waitingNow>0?"var(--tint-green)":"var(--card)",border:"1px solid "+(waitingNow>0?"#06c16744":"var(--border)"),borderRadius:8,padding:"7px 10px"}}>
                  <div style={{fontSize:8,color:waitingNow>0?"#06c167":"var(--faint)",letterSpacing:2,marginBottom:2}}>WAITING NOW</div>
                  <div style={{...B,fontSize:17,color:waitingNow>0?"#06c167":"var(--faint2)",letterSpacing:1}}>{waitingNow}</div>
                  <div style={{fontSize:8,color:waitingNow>0?"#0a8f4f":"var(--faint2)",marginTop:1}}>live now</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {closed?(
                  <span style={{fontSize:9,background:"var(--border)",color:"var(--muted2)",border:"1px solid var(--faint2)",borderRadius:5,padding:"3px 8px"}}>CLOSED</span>
                ):riskLabel?(
                  <span style={{fontSize:9,background:riskColor+"22",color:riskColor,border:"1px solid "+riskColor+"44",borderRadius:5,padding:"3px 8px"}}>{riskLabel}</span>
                ):(
                  <span style={{fontSize:9,background:"var(--border)",color:"var(--muted2)",border:"1px solid var(--border)",borderRadius:5,padding:"3px 8px"}}>NO DATA YET</span>
                )}
                {myLogs.length>0&&<span style={{fontSize:9,color:"var(--muted2)"}}>{myLogs.length+" visit"+(myLogs.length!==1?"s":"")}</span>}
                {!isActive&&<button onClick={e=>{e.stopPropagation();onArrived(r);}} disabled={isChecking} style={{marginLeft:"auto",background:isChecking?"var(--tint-coral)":hasError?"var(--tint-red)":"#00b8a9",border:isChecking?"1px solid #00b8a944":hasError?"1px solid #ef444444":"none",borderRadius:7,...B,fontSize:hasError?11:13,letterSpacing:1,color:isChecking?"#00b8a9":hasError?"#ef4444":"#000",cursor:isChecking?"default":"pointer",padding:"6px 14px",minHeight:32}}>{isChecking?"CHECKING...":hasError?arrivalError.dist+"M AWAY":"ARRIVED"}</button>}
                {isActive&&<span style={{marginLeft:"auto",fontSize:10,...B,color:"#00b8a9",letterSpacing:1,animation:"criticalPulse 1.5s ease-in-out infinite"}}>● TIMING NOW</span>}
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>

      {waitLog.length>0&&(
        <div style={{marginTop:20}}>
          <div style={{...B,fontSize:16,color:"var(--faint2)",letterSpacing:2,marginBottom:8}}>RECENT WAIT LOGS</div>
          {waitLog.slice().reverse().slice(0,6).map(l=>{
            const r=restaurants.find(x=>x.id===l.restaurantId);
            const c=l.waitMins>15?"#ef4444":l.waitMins>8?"#f5a623":"#06c167";
            return(
              <div key={l.id} style={{background:"var(--card)",borderRadius:8,padding:"10px 14px",border:"1px solid var(--border3)",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div>
                  <div style={{...B,fontSize:15,letterSpacing:1,color:"var(--ink)"}}>{r?r.name:(l.restaurantName||"Unknown")}</div>
                  <div style={{fontSize:9,color:"var(--muted2)",marginTop:1}}>{new Date(l.ts).toLocaleString("en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})+" · "+l.period}</div>
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

// Downscale + JPEG-compress an image before upload (keeps chat fast & cheap)
function compressImage(file,maxDim=1280,quality=0.7){
  return new Promise(resolve=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let {width,height}=img;
      if(width>=height&&width>maxDim){height=Math.round(height*maxDim/width);width=maxDim;}
      else if(height>width&&height>maxDim){width=Math.round(width*maxDim/height);height=maxDim;}
      const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
      canvas.getContext("2d").drawImage(img,0,0,width,height);
      canvas.toBlob(b=>resolve(b||file),"image/jpeg",quality);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);resolve(file);};
    img.src=url;
  });
}

// Voice message: play/pause button + progress + duration
function VoiceMessage({url,duration,isMe}){
  const audioRef=useRef(null);
  const [playing,setPlaying]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{
    const a=audioRef.current;if(!a)return;
    const onPlay=()=>setPlaying(true),onPause=()=>setPlaying(false),onEnd=()=>{setPlaying(false);setElapsed(0);},onTime=()=>setElapsed(Math.floor(a.currentTime));
    a.addEventListener("play",onPlay);a.addEventListener("pause",onPause);a.addEventListener("ended",onEnd);a.addEventListener("timeupdate",onTime);
    return ()=>{a.removeEventListener("play",onPlay);a.removeEventListener("pause",onPause);a.removeEventListener("ended",onEnd);a.removeEventListener("timeupdate",onTime);};
  },[]);
  const total=duration||0;
  const fmt=s=>Math.floor(s/60)+":"+String(Math.max(0,s)%60).padStart(2,"0");
  const toggle=()=>{const a=audioRef.current;if(!a)return;playing?a.pause():a.play();};
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,minWidth:150}}>
      <audio ref={audioRef} src={url} preload="metadata"/>
      <button onClick={toggle} style={{width:34,height:34,borderRadius:"50%",border:"none",background:isMe?"rgba(0,0,0,0.18)":"#00b8a9",color:isMe?"#000":"#fff",cursor:"pointer",fontSize:13,flexShrink:0}}>{playing?"⏸":"▶"}</button>
      <div style={{flex:1}}>
        <div style={{height:4,background:isMe?"rgba(0,0,0,0.2)":"var(--border2)",borderRadius:2,overflow:"hidden"}}>
          <div style={{height:4,width:(total?Math.min(100,elapsed/total*100):0)+"%",background:isMe?"#000":"#00b8a9"}}/>
        </div>
      </div>
      <span style={{fontSize:11,...M,color:isMe?"#000":"var(--ink)",flexShrink:0}}>{fmt(elapsed||total)}</span>
    </div>
  );
}

// ── CHAT SCREEN (Firestore real-time) ─────────────────────────────────────────
function ChatScreen({user,onLogout,area,contribCounts}) {
  const room=(area||"general").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")||"general";
  const [messages,setMessages]=useState([]);
  const [input,setInput]=useState("");
  const [ready,setReady]=useState(false);
  const [sendError,setSendError]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [recording,setRecording]=useState(false);
  const bottomRef=useRef(null);
  const inputRef=useRef(null);
  const fileRef=useRef(null);
  const recorderRef=useRef(null);
  const chunksRef=useRef([]);
  const recStartRef=useRef(0);
  const maxTimerRef=useRef(null);

  // Live listener — re-subscribes whenever the room (area) changes
  useEffect(()=>{
    setReady(false);setMessages([]);
    const q=query(collection(db,"chats",room,"messages"),orderBy("ts","asc"),limitToLast(100));
    const unsub=onSnapshot(q,snap=>{
      setMessages(snap.docs.map(d=>({id:d.id,...d.data()})));
      setReady(true);
    },err=>{console.error("chat listen error:",err);setReady(true);});
    return unsub;
  },[room]);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages.length]);

  async function postMessage(extra){
    try{
      await addDoc(collection(db,"chats",room,"messages"),{
        user:user.name,color:user.color,initial:user.initial,
        ts:new Date().toISOString(),...extra,
      });
    }catch(e){console.error("chat send error:",e);setSendError(true);}
  }

  async function send(){
    const text=input.trim();
    if(!text)return;
    setInput("");setSendError(false);
    await postMessage({text});
    inputRef.current?.focus();
  }

  // Upload a file to Storage, then post a message with its URL
  async function uploadMedia(blob,kind,ext,extra={}){
    setUploading(true);setSendError(false);
    try{
      const path=`chats/${room}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const r=storageRef(storage,path);
      const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),20000));
      await Promise.race([uploadBytes(r,blob),timeout]);
      const url=await getDownloadURL(r);
      await postMessage({type:kind,url,...extra});
    }catch(e){console.error("upload error:",e);setSendError(true);}
    setUploading(false);
  }

  async function onPickImage(e){
    const f=e.target.files?.[0];
    if(f){ const blob=await compressImage(f); uploadMedia(blob,"image","jpg"); }
    e.target.value="";
  }

  // Hold-to-record voice (max 60s, uploads on release)
  async function startRecording(){
    if(recording)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const rec=new MediaRecorder(stream);
      chunksRef.current=[];recStartRef.current=Date.now();
      rec.ondataavailable=ev=>{ if(ev.data.size>0)chunksRef.current.push(ev.data); };
      rec.onstop=()=>{
        stream.getTracks().forEach(t=>t.stop());
        clearTimeout(maxTimerRef.current);
        const dur=Math.round((Date.now()-recStartRef.current)/1000);
        const blob=new Blob(chunksRef.current,{type:rec.mimeType||"audio/webm"});
        setRecording(false);
        if(blob.size>0&&dur>=1)uploadMedia(blob,"voice","webm",{duration:dur});
      };
      recorderRef.current=rec;
      rec.start();
      setRecording(true);
      maxTimerRef.current=setTimeout(()=>{ if(recorderRef.current?.state==="recording")recorderRef.current.stop(); },60000); // 60s cap
    }catch(e){console.error("mic error:",e);alert("Microphone access needed for voice messages.");}
  }
  function stopRecording(){ if(recorderRef.current?.state==="recording")recorderRef.current.stop(); }

  // Long-press any message → action menu (react, and delete if it's your own)
  const [actionMsg,setActionMsg]=useState(null);
  const pressTimer=useRef(null);
  function startPress(m){ pressTimer.current=setTimeout(()=>setActionMsg(m),500); }
  function endPress(){ clearTimeout(pressTimer.current); }

  async function toggleReaction(m,emoji){
    const reactions={...(m.reactions||{})};
    const set=new Set(reactions[emoji]||[]);
    if(set.has(user.name))set.delete(user.name); else set.add(user.name);  // tap again to remove
    if(set.size)reactions[emoji]=[...set]; else delete reactions[emoji];
    try{ await updateDoc(doc(db,"chats",room,"messages",m.id),{reactions}); }catch(e){console.error("reaction error:",e);}
  }

  async function deleteMsg(m){
    if(m.user!==user.name)return;                       // own messages only
    if(!window.confirm("Delete this message?"))return;
    try{
      await deleteDoc(doc(db,"chats",room,"messages",m.id));
      if(m.url){ try{ await deleteObject(storageRef(storage,m.url)); }catch(e){} }
    }catch(e){console.error("delete msg error:",e);}
  }

  function onKey(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}
  function fmt(ts){try{return new Date(ts).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});}catch(e){return "";}}

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <div style={{padding:"10px 16px",borderBottom:"1px solid var(--border3)",background:"var(--card)",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{...B,fontSize:24,color:"#00b8a9",letterSpacing:2}}>DRIVER CHAT</div>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:1,marginTop:1}}>{(area||"GENERAL").toUpperCase()} ROOM</div>
          <div style={{display:"flex",alignItems:"center",gap:5,marginTop:2}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:ready?"#06c167":"#f5a623",boxShadow:"0 0 6px "+(ready?"#06c167":"#f5a623"),animation:ready?"criticalPulse 2.5s ease-in-out infinite":"none"}}/>
            <span style={{fontSize:9,color:"var(--muted2)",letterSpacing:1}}>{ready?"LIVE · FIREBASE":"CONNECTING..."}</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:user.color,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 14px "+user.color+"55"}}>
            <span style={{...B,fontSize:16,color:"#000"}}>{user.initial}</span>
          </div>
          <button onClick={onLogout} style={{background:"none",border:"1px solid var(--border)",borderRadius:8,padding:"6px 10px",color:"var(--muted2)",cursor:"pointer",fontSize:9,...B,letterSpacing:1}}>OUT</button>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"10px 14px 6px",display:"flex",flexDirection:"column",gap:2}}>
        {/* Pinned welcome — shown to every driver */}
        <div style={{alignSelf:"center",maxWidth:"92%",background:"var(--tint-teal)",border:"1px solid #00b8a933",borderRadius:14,padding:"12px 16px",margin:"4px 0 10px",textAlign:"center"}}>
          <div style={{...B,fontSize:15,color:"#00b8a9",letterSpacing:1,marginBottom:4}}>👋 WELCOME{user?.name?(", "+user.name.toUpperCase()):""}!</div>
          <div style={{fontSize:11,...M,color:"var(--muted)",lineHeight:1.6}}>
            This is the {(area||"driver").toString().replace(/_/g," ")} chat. Share live wait times, photos &amp; voice notes, and help each other out. Be kind, keep it useful. 🚗💨
          </div>
        </div>
        {ready&&messages.length===0&&(
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,paddingBottom:40}}>
            <div style={{fontSize:38,opacity:0.2}}>💬</div>
            <div style={{...B,fontSize:18,color:"var(--border2)",letterSpacing:2}}>NO MESSAGES YET</div>
            <div style={{fontSize:10,color:"var(--border)"}}>BE THE FIRST TO SAY SOMETHING</div>
          </div>
        )}
        {!ready&&(
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{...B,fontSize:14,color:"#f5a623",letterSpacing:2,animation:"criticalPulse 1.2s ease-in-out infinite"}}>CONNECTING...</div>
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
                  {!isMe&&<span style={{fontSize:10,color:m.color,...M,fontWeight:700}}>{m.user}{(()=>{const bg=badgeFor(contribCounts?.[m.user]||0);return bg?<span title={bg.label} style={{marginLeft:3}}>{bg.emoji}</span>:null;})()}</span>}
                  <span style={{fontSize:9,color:"var(--faint2)"}}>{fmt(m.ts)}</span>
                  {isMe&&<span style={{fontSize:10,color:m.color,...M,fontWeight:700}}>You</span>}
                </div>
              )}
              <div style={{display:"flex",width:"100%",alignItems:"flex-end",gap:8,justifyContent:isMe?"flex-end":"flex-start"}}>
                {!isMe&&(
                  <div style={{width:28,height:28,borderRadius:"50%",background:isFirst?m.color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginBottom:2}}>
                    {isFirst&&<span style={{...B,fontSize:13,color:"#000"}}>{m.initial}</span>}
                  </div>
                )}
                <div onPointerDown={()=>startPress(m)} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
                  onContextMenu={e=>{e.preventDefault();setActionMsg(m);}}
                  style={{maxWidth:"76%",background:isMe?"#00b8a9":"var(--border3)",borderRadius:isMe?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:m.type==="image"?"4px":"10px 14px",border:isMe?"none":"1px solid var(--border)",boxShadow:isMe?"0 2px 16px #00b8a928":"none",overflow:"hidden",cursor:"pointer",userSelect:"none"}}>
                  {m.type==="image"?(
                    <img src={m.url} alt="" onClick={()=>window.open(m.url,"_blank")} style={{maxWidth:"100%",maxHeight:240,borderRadius:14,display:"block",cursor:"pointer"}}/>
                  ):(m.type==="voice"||m.type==="audio")?(
                    <VoiceMessage url={m.url} duration={m.duration} isMe={isMe}/>
                  ):(
                    <span style={{fontSize:14,...M,color:isMe?"#000":"var(--ink)",lineHeight:1.55,whiteSpace:"pre-wrap",overflowWrap:"anywhere",wordBreak:"normal"}}>{m.text}</span>
                  )}
                </div>
              </div>
              {m.reactions&&Object.keys(m.reactions).length>0&&(
                <div style={{display:"flex",gap:4,marginTop:3,flexWrap:"wrap",...(isMe?{justifyContent:"flex-end",marginRight:4}:{marginLeft:40})}}>
                  {Object.entries(m.reactions).filter(([,u])=>u.length>0).map(([emoji,u])=>{
                    const mine=u.includes(user.name);
                    return(
                      <button key={emoji} onClick={()=>toggleReaction(m,emoji)}
                        style={{display:"flex",alignItems:"center",gap:3,background:mine?"#00b8a922":"var(--border3)",border:"1px solid "+(mine?"#00b8a9":"var(--border)"),borderRadius:12,padding:"1px 7px",cursor:"pointer"}}>
                        <span style={{fontSize:12}}>{emoji}</span>
                        <span style={{fontSize:10,...M,fontWeight:700,color:mine?"#00b8a9":"var(--muted)"}}>{u.length}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      {/* Long-press action menu: react + delete (own) */}
      {actionMsg&&(
        <div onClick={()=>setActionMsg(null)} style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 16px 90px"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:18,padding:"14px",boxShadow:"0 10px 36px rgba(0,0,0,0.35)",width:"100%",maxWidth:380}}>
            <div style={{display:"flex",justifyContent:"space-around",alignItems:"center"}}>
              {REACTIONS.map(em=>{
                const mine=(actionMsg.reactions?.[em]||[]).includes(user.name);
                return(
                  <button key={em} onClick={()=>{toggleReaction(actionMsg,em);setActionMsg(null);}}
                    style={{background:mine?"#00b8a922":"none",border:mine?"1px solid #00b8a9":"none",borderRadius:"50%",width:46,height:46,fontSize:26,cursor:"pointer",transition:"transform 0.1s"}}>{em}</button>
                );
              })}
            </div>
            {actionMsg.user===user.name&&(
              <button onClick={()=>{const m=actionMsg;setActionMsg(null);deleteMsg(m);}}
                style={{width:"100%",marginTop:12,background:"var(--tint-red)",border:"1px solid #ef444444",borderRadius:12,padding:"11px",...B,fontWeight:700,fontSize:15,letterSpacing:1,color:"#ef4444",cursor:"pointer"}}>🗑  DELETE MESSAGE</button>
            )}
          </div>
        </div>
      )}
      {sendError&&<div style={{padding:"8px 16px",background:"var(--tint-red)",borderTop:"1px solid #ef444433",fontSize:11,...M,color:"#ef4444",textAlign:"center"}}>Couldn't send — check connection</div>}
      {uploading&&<div style={{padding:"8px 16px",background:"var(--tint-teal)",borderTop:"1px solid #00b8a933",fontSize:11,...M,color:"#00b8a9",textAlign:"center"}}>Uploading…</div>}
      {recording&&<div style={{padding:"8px 16px",background:"var(--tint-red)",borderTop:"1px solid #ef444433",fontSize:11,...M,color:"#ef4444",textAlign:"center"}}>● Recording… release the mic to send (max 60s)</div>}
      <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} style={{display:"none"}}/>
      <div style={{padding:"10px 10px 14px",borderTop:"1px solid var(--border3)",background:"var(--card)",flexShrink:0,display:"flex",gap:8,alignItems:"center"}}>
        {/* photo */}
        <button onClick={()=>fileRef.current?.click()} disabled={uploading||recording}
          style={{width:42,height:42,borderRadius:"50%",background:"var(--border3)",border:"1px solid var(--border2)",cursor:"pointer",flexShrink:0,fontSize:18,color:"var(--muted)"}}>📷</button>
        {/* voice — hold to record */}
        <button
          onPointerDown={e=>{e.preventDefault();startRecording();}}
          onPointerUp={stopRecording}
          onPointerLeave={()=>{if(recording)stopRecording();}}
          onContextMenu={e=>e.preventDefault()}
          disabled={uploading}
          style={{width:42,height:42,borderRadius:"50%",background:recording?"#ef4444":"var(--border3)",border:"1px solid "+(recording?"#ef4444":"var(--border2)"),cursor:"pointer",flexShrink:0,fontSize:18,color:recording?"#fff":"var(--muted)",touchAction:"none",userSelect:"none"}}>{recording?"●":"🎤"}</button>
        <div style={{flex:1,background:"var(--border3)",border:"1px solid var(--border2)",borderRadius:24,padding:"11px 16px",display:"flex",alignItems:"center"}}>
          <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey}
            placeholder="Message…"
            maxLength={500}
            style={{flex:1,background:"none",border:"none",color:"var(--ink)",fontSize:14,...M,outline:"none"}}
            onFocus={e=>{e.target.parentElement.style.borderColor="#00b8a9";}}
            onBlur={e=>{e.target.parentElement.style.borderColor="var(--border2)";}}
          />
        </div>
        <button onClick={send} disabled={!input.trim()}
          style={{width:46,height:46,borderRadius:"50%",background:input.trim()?"#00b8a9":"var(--border)",border:"none",cursor:input.trim()?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:18,boxShadow:input.trim()?"0 0 20px #00b8a950":"none",transition:"all 0.15s",color:input.trim()?"#fff":"var(--faint)"}}>
          ↑
        </button>
      </div>
    </div>
  );
}

// ── CHECK SCREEN ─────────────────────────────────────────────────────────────
function CheckScreen({restaurants,communityPatterns,communityLogs,waitLog,now,gps,activeCounts}) {
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [selected,setSelected]=useState(null);
  const searchTimer=useRef(null);

  function handleInput(q){
    setQuery(q);
    clearTimeout(searchTimer.current);
    if(!q.trim()){setResults([]);return;}
    setSearching(true);
    searchTimer.current=setTimeout(async()=>{
      const places=await searchRestaurants(q,gps.lat,gps.lng);
      const augmented=places.map(p=>{
        const dist=gps.status==="active"&&gps.lat!=null?distMeters(gps.lat,gps.lng,p.branchLat,p.branchLng):null;
        return{...p,dist};
      });
      augmented.sort((a,b)=>{ if(a.dist!=null&&b.dist!=null)return a.dist-b.dist; if(a.dist!=null)return -1; if(b.dist!=null)return 1; return 0; });
      setResults(augmented);
      setSearching(false);
    },400);
  }

  function logsLastHour(restId){
    const cutoff=Date.now()-60*60*1000;
    return communityLogs.filter(l=>logKey(l)===restId&&new Date(l.ts).getTime()>cutoff);
  }
  const distOf=r=>{ const lat=r.branchLat??r.lat,lng=r.branchLng??r.lng; return gps.status==="active"&&gps.lat!=null&&lat!=null?distMeters(gps.lat,gps.lng,lat,lng):(r.dist??null); };

  // Distances for the detail view
  const distMap={};
  [...restaurants,...results,...(selected?[selected]:[])].forEach(r=>{const d=distOf(r); if(d!=null)distMap[r.id]=d;});

  // Tapped a restaurant → full stats (detail in stats-only mode: no arrive/manual buttons)
  if(selected){
    return <RestaurantDetail r={selected} now={now} gps={gps} waitLog={waitLog} communityPatterns={communityPatterns} distMap={distMap} onBack={()=>setSelected(null)}/>;
  }

  // Default = nearby restaurants (sorted by distance). When searching, show search results.
  const list=query.trim()
    ? results
    : restaurants.map(r=>({...r,dist:distOf(r)})).sort((a,b)=>{ if(a.dist!=null&&b.dist!=null)return a.dist-b.dist; if(a.dist!=null)return -1; if(b.dist!=null)return 1; return 0; });

  return(
    <div style={{padding:"20px 16px 100px"}}>
      <div style={{marginBottom:16}}>
        <div style={{...B,fontSize:34,color:"#00b8a9",letterSpacing:2}}>CHECK RESTAURANT</div>
        <div style={{fontSize:10,color:"var(--muted2)",letterSpacing:1,marginTop:2}}>{query.trim()?"SEARCH RESULTS":"NEARBY · TAP FOR FULL STATS"}</div>
      </div>
      <div style={{position:"relative",marginBottom:14}}>
        <input value={query} onChange={e=>handleInput(e.target.value)} placeholder="Search any branch — KFC, Sainsbury's…"
          style={{width:"100%",background:"var(--card)",border:"1px solid #00b8a966",borderRadius:12,padding:"14px 18px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
          onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="#00b8a966"}/>
        {searching&&<div style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"#00b8a9",...B,letterSpacing:1}}>SEARCHING...</div>}
      </div>
      {query.trim()&&!searching&&results.length===0&&(
        <div style={{fontSize:11,color:"var(--muted2)",textAlign:"center",padding:"40px 0",...M}}>No results found</div>
      )}
      {!query.trim()&&list.length===0&&(
        <div style={{fontSize:11,color:"var(--faint)",textAlign:"center",padding:"40px 0",...M}}>Waiting for your location to find nearby restaurants…</div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {list.map((r,i)=>{
          const lid=cardKey(r);
          const community=getCommunityWait(lid,now,communityPatterns);
          const recentLogs=logsLastHour(lid);
          const waitingNow=activeCounts?.[lid]||0;
          const closed=r.openNow===false;
          const d=r.dist??distOf(r);
          const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;
          return(
            <div key={r.id+i} onClick={()=>setSelected(r)} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",opacity:closed?0.72:1,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:18,color:"var(--ink)",letterSpacing:1}}>{r.name}</div>
                  {r.address&&<div style={{fontSize:9,color:"var(--muted)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.address}</div>}
                  <div style={{fontSize:9,marginTop:3}}>
                    {closed
                      ? <span style={{color:"var(--muted2)",fontWeight:700}}>● CLOSED right now</span>
                      : waitingNow>0
                        ? <span style={{color:"#06c167",fontWeight:700}}>🟢 {waitingNow} waiting now</span>
                        : community
                          ? <span style={{color:"#2b8fff",fontWeight:700}}>~{community.avg}m typical wait</span>
                          : <span style={{color:"var(--muted)"}}>No wait data yet</span>}
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,marginLeft:10}}>
                  {dStr&&<span style={{...B,fontSize:15,color:"#00b8a9",letterSpacing:1}}>{dStr}</span>}
                  <span style={{...B,fontSize:22,color:"var(--faint)"}}>›</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── STATS / ADMIN ─────────────────────────────────────────────────────────────
function StatsScreen({communityLogs,communityPatterns,activeCounts,contribCounts,onBack}) {
  const totalLogs=communityLogs.length;
  const totalDrivers=new Set(communityLogs.map(l=>l.username)).size;
  const now=Date.now();
  const last24=communityLogs.filter(l=>now-new Date(l.ts).getTime()<864e5).length;
  const lastH=communityLogs.filter(l=>now-new Date(l.ts).getTime()<36e5).length;
  const waitingNow=Object.values(activeCounts||{}).reduce((s,n)=>s+n,0);
  const avgAll=totalLogs?Math.round(communityLogs.reduce((s,l)=>s+l.waitMins,0)/totalLogs*10)/10:0;

  // aggregate per chain from raw logs (same key as the rest of the app)
  const byRest={};
  communityLogs.forEach(l=>{
    const k=logKey(l);if(!k)return;
    (byRest[k]=byRest[k]||{count:0,sum:0,name:l.restaurantName||k}).count++;
    byRest[k].sum+=l.waitMins;
    if(l.restaurantName)byRest[k].name=l.restaurantName;
  });
  const top=Object.values(byRest).sort((a,b)=>b.count-a.count).slice(0,10);

  const stat=(val,label,color)=>(
    <div style={{flex:1,minWidth:90,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 12px",textAlign:"center"}}>
      <div style={{...B,fontSize:26,color:color||"#00b8a9",letterSpacing:1}}>{val}</div>
      <div style={{fontSize:8,...M,color:"var(--muted)",marginTop:3,letterSpacing:1}}>{label}</div>
    </div>
  );

  return(
    <div style={{padding:"20px 16px 100px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
        <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:2}}>APP STATS</div>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
        {stat(totalLogs.toLocaleString(),"TOTAL LOGS")}
        {stat(totalDrivers,"DRIVERS")}
        {stat(Object.keys(byRest).length,"RESTAURANTS")}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        {stat(waitingNow,"WAITING NOW","#06c167")}
        {stat(lastH,"LOGS / HR")}
        {stat(last24,"LOGS / 24H")}
        {stat(avgAll+"m","AVG WAIT","#f5a623")}
      </div>

      <div style={{...B,fontSize:16,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>TOP RESTAURANTS BY LOGS</div>
      {top.length===0&&<div style={{fontSize:11,color:"var(--faint)",...M,padding:"20px 0",textAlign:"center"}}>No logs yet</div>}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {top.map((r,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
            <span style={{...B,fontSize:14,color:"var(--faint)",width:18}}>{i+1}</span>
            <span style={{flex:1,minWidth:0,...M,fontSize:13,fontWeight:700,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(/^ChIJ|^[A-Za-z0-9_-]{20,}$/.test(r.name))?"Unknown restaurant":r.name}</span>
            <span style={{fontSize:11,...M,color:"var(--muted)"}}>{r.count} log{r.count!==1?"s":""}</span>
            <span style={{...B,fontSize:14,color:"#00b8a9"}}>{Math.round(r.sum/r.count*10)/10}m</span>
          </div>
        ))}
      </div>

      {/* Top contributors leaderboard */}
      {(()=>{
        const ranked=Object.entries(contribCounts||{}).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count).slice(0,10);
        if(!ranked.length)return null;
        return(
          <>
            <div style={{...B,fontSize:16,color:"var(--muted2)",letterSpacing:2,margin:"22px 0 8px"}}>TOP CONTRIBUTORS</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {ranked.map((u,i)=>{
                const bg=badgeFor(u.count);
                return(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
                    <span style={{...B,fontSize:14,color:"var(--faint)",width:18}}>{i+1}</span>
                    <span style={{flex:1,minWidth:0,...M,fontSize:13,fontWeight:700,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}{bg&&<span style={{marginLeft:4}}>{bg.emoji}</span>}</span>
                    <span style={{fontSize:11,...M,color:"var(--muted)"}}>{bg?bg.label:"—"}</span>
                    <span style={{...B,fontSize:14,color:"#f5a623"}}>{u.count}</span>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ── BOTTOM NAV ────────────────────────────────────────────────────────────────
function BottomNav({screen,onNav,activeWait,unreadChat}) {
  const tabs=[
    {id:"waits",icon:"⏱",label:"WAITS",dot:activeWait,  dotColor:"#00b8a9"},
    {id:"check",icon:"🔍",label:"CHECK",dot:false,       dotColor:"#2b8fff"},
    {id:"chat", icon:"💬",label:"CHAT", dot:unreadChat,  dotColor:"#06c167"},
  ];
  return(
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"var(--card)",borderTop:"1px solid var(--border3)",display:"flex",zIndex:200,height:56}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onNav(t.id)} style={{flex:1,background:"none",border:"none",cursor:"pointer",padding:"10px 0 8px",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          <span style={{fontSize:20,position:"relative"}}>
            {t.icon}
            {t.dot&&<span style={{position:"absolute",top:-3,right:-5,width:8,height:8,borderRadius:"50%",background:t.dotColor,boxShadow:"0 0 8px "+t.dotColor,display:"block"}}/>}
          </span>
          <span style={{...B,fontSize:11,letterSpacing:1,color:t.id===screen?"#00b8a9":"var(--faint)"}}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── ROOT APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]          =useState(()=>store.get("delivr_user")||null);
  const [pendingVerify,setPendingVerify]=useState(null);
  const [screen,setScreen]=useState(()=>store.get("delivr_tab")||"waits");  // restore last tab on refresh
  const [showProfile,setShowProfile]=useState(false);
  const [showUpgrade,setShowUpgrade]=useState(false);
  const [showStats,setShowStats]=useState(false);
  const [showLogbook,setShowLogbook]=useState(false);
  const [reminder,setReminder]=useState(null);   // in-app "still waiting?" notification text
  const [theme,setTheme]=useState(()=>store.get("delivr_theme")||"light");
  const [onboarded,setOnboarded]=useState(()=>!!store.get("delivr_onboarded"));
  const [startRegister,setStartRegister]=useState(false);
  const premium=!!user?.premium;

  // Apply + persist the colour theme
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    store.set("delivr_theme",theme);
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute("content",theme==="dark"?"#0e1316":"#ffffff");
  },[theme]);
  const toggleTheme=()=>setTheme(t=>t==="dark"?"light":"dark");
  const [now,setNow]      =useState(new Date());
  const [restaurants,setRestaurants]=useState(CURATED);
  const [waitLog,setWaitLog]=useState(()=>store.get("delivr_waitlog")||[]);
  const [activeWait,setActiveWait]=useState(()=>store.get("delivr_activewait")||null);
  const [communityPatterns,setCommunityPatterns]=useState({});
  const [communityLogs,setCommunityLogs]=useState([]);
  const [unreadChat,setUnreadChat]=useState(false);
  const [checkingId,setCheckingId]=useState(null);
  const [arrivalError,setArrivalError]=useState(null);
  const [pinnedLocations,setPinnedLocations]=useState({});
  const [manualVoted,setManualVoted]=useState(null);
  const [gpsSkipped,setGpsSkipped]=useState(false);   // user chose to continue without location
  const [activeCounts,setActiveCounts]=useState({});  // restaurantId → # drivers waiting now
  const [activeWaitsList,setActiveWaitsList]=useState([]); // live active waits for the feed
  const lastFetchRef=useRef({lat:null,lng:null});
  const gps=useGPS();

  // Restaurants with crowd-sourced pinned locations applied (overrides Google coords)
  const resolvedRestaurants=useMemo(()=>restaurants.map(r=>{
    const p=pinnedLocations[r.id];
    return p?{...r,branchLat:p.lat,branchLng:p.lng}:r;
  }),[restaurants,pinnedLocations]);

  // Contributor counts (quality logs, per-day capped) for badges & leaderboard
  const contribCounts=useMemo(()=>computeContributions(communityLogs),[communityLogs]);

  // Restore session on page reload
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async fbUser=>{
      if(!fbUser){setUser(null);store.del("delivr_user");return;}
      // Already have user in state (just logged in)
      if(user)return;
      // Try to restore from Auth displayName first
      let profile=null;
      if(fbUser.displayName){
        try{ profile=JSON.parse(fbUser.displayName); }catch(e){}
      }
      // Fallback to Firestore
      if(!profile){
        try{
          const snap=await getDoc(doc(db,"users",fbUser.uid));
          if(snap.exists()){ const p=snap.data(); profile={name:p.username,color:p.color,initial:p.initial}; }
        }catch(e){}
      }
      if(profile){ setUser(profile);store.set("delivr_user",profile); }
    });
    return unsub;
  },[]);

  // Live Firestore listener for community patterns — updates instantly when any driver logs
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"waitLogs"),snap=>{
      const logs=snap.docs.map(d=>d.data());
      setCommunityPatterns(computePatterns(logs));
      setCommunityLogs(logs);
    },()=>{});
    return unsub;
  },[]);

  // Live listener for crowd-sourced pinned restaurant locations
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"restaurantLocations"),snap=>{
      const m={};snap.docs.forEach(d=>{m[d.id]=d.data();});
      setPinnedLocations(m);
    },()=>{});
    return unsub;
  },[]);

  // Live listener for who's waiting right now (real-time presence)
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,"activeWaits"),snap=>{
      const cutoff=Date.now()-60*60*1000; // ignore stale (>60min) entries
      const counts={};const list=[];
      snap.docs.forEach(d=>{
        const w=d.data();
        if(w.restaurantId&&new Date(w.startedAt).getTime()>cutoff){
          const k=logKey(w);
          counts[k]=(counts[k]||0)+1;
          list.push(w);
        }
      });
      setActiveCounts(counts);
      setActiveWaitsList(list);
    },()=>{});
    return unsub;
  },[]);

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),15000);return ()=>clearInterval(id);},[]);

  // Reminders at 20 & 40 min into an open wait (in-app + browser notification if allowed).
  // Notifications only — never auto-closes or auto-logs the wait.
  useEffect(()=>{
    if(!activeWait){setReminder(null);return;}
    const start=new Date(activeWait.startedAt).getTime();
    const name=activeWait.restaurantName||"the restaurant";
    const fire=()=>{
      const msg=`Still waiting at ${name}? Tap when you have your food.`;
      setReminder(msg);
      try{ if(window.Notification&&Notification.permission==="granted")new Notification("DELIVR",{body:msg}); }catch(e){}
    };
    const timers=[];
    [20,40].forEach(min=>{
      const delay=start+min*60000-Date.now();
      if(delay>0)timers.push(setTimeout(fire,delay));
    });
    return ()=>timers.forEach(clearTimeout);
  },[activeWait?.startedAt]);

  // After returning from Stripe Checkout, verify payment and flip premium on
  useEffect(()=>{
    if(!user)return;
    const params=new URLSearchParams(window.location.search);
    if(params.get("stripe")!=="success")return;
    const sid=params.get("session_id");
    // Clean the URL so it doesn't re-trigger on refresh
    window.history.replaceState({},"",window.location.pathname);
    if(!sid)return;
    (async()=>{
      try{
        const r=await fetch(`${API_URL}/stripe/verify-session?session_id=${encodeURIComponent(sid)}`);
        const d=await r.json();
        if(d.paid){ await setPremium(true,d.subscriptionId); setShowUpgrade(false); setShowProfile(true); }
      }catch(e){}
    })();
  },[user]);

  useEffect(()=>{
    if(gps.status!=="active"||gps.lat==null)return;
    const last=lastFetchRef.current;
    const far=last.lat==null||distMeters(last.lat,last.lng,gps.lat,gps.lng)>500;
    if(!far)return;
    lastFetchRef.current={lat:gps.lat,lng:gps.lng};
    // Curated chains first (pinned to their nearest branch, with real opening hours), then other nearby places.
    fetchNearbyRestaurants(gps.lat,gps.lng).then(async places=>{
      const list=await buildRestaurantList(places,gps.lat,gps.lng);
      if(list.length)setRestaurants(list);
    }).catch(()=>{});
  },[gps.status,gps.lat,gps.lng]);

  function handleNav(s){if(s==="chat")setUnreadChat(false);setScreen(s);store.set("delivr_tab",s);}

  function handleLogin(userData){
    setUser(userData);store.set("delivr_user",userData);
  }

  function handleRegistered(profile,email){
    setPendingVerify({profile,email});
  }

  function handleVerified(){
    const profile={...pendingVerify.profile,emailVerified:true};
    setUser(profile);store.set("delivr_user",profile);
    setPendingVerify(null);
  }

  async function handleLogout(){
    await signOut(auth);
    setUser(null);store.del("delivr_user");
    setScreen("waits");setShowProfile(false);
  }

  async function setPremium(val,subscriptionId){
    const updated={...user,premium:val,subscriptionId:val?(subscriptionId??user?.subscriptionId??null):null};
    setUser(updated);store.set("delivr_user",updated);
    try{ await updateDoc(doc(db,"users",auth.currentUser.uid),{premium:val,subscriptionId:updated.subscriptionId}); }catch(e){}
    try{ await updateProfile(auth.currentUser,{displayName:JSON.stringify(updated)}); }catch(e){}
  }

  async function handleSubscribe(){
    try{
      const r=await fetch(`${API_URL}/stripe/create-checkout-session`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:user?.email||""}),
      });
      const d=await r.json();
      if(d.url){ window.location.href=d.url; }      // redirect to Stripe hosted checkout
      else { alert(d.error||"Could not start checkout"); }
    }catch(e){ alert("Could not reach payment server"); }
  }

  async function handleCancelSub(){
    if(user?.subscriptionId){
      try{
        await fetch(`${API_URL}/stripe/cancel`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({subscriptionId:user.subscriptionId}),
        });
      }catch(e){}
    }
    await setPremium(false);
    setShowUpgrade(false);
  }

  async function handleSaveProfile(updates){
    const updated={...user,...updates};
    setUser(updated);store.set("delivr_user",updated);
    try{ await updateDoc(doc(db,"users",auth.currentUser.uid),{...updates}); }catch(e){}
    if(auth.currentUser&&updates.name&&updates.name!==user.name){
      try{ await updateProfile(auth.currentUser,{displayName:JSON.stringify(updated)}); }catch(e){}
    }
    // If area changed, geocode it and fetch restaurants for that area
    if(updates.area&&updates.area!==user.area){
      const coords=await geocodeBranch(null,null,updates.area+" UK");
      if(coords){
        lastFetchRef.current={lat:null,lng:null}; // force refetch
        fetchNearbyRestaurants(coords.lat,coords.lng).then(async places=>{
          const list=await buildRestaurantList(places,coords.lat,coords.lng);
          if(list.length)setRestaurants(list);
        }).catch(()=>{});
      }
    }
  }

  async function handleArrived(restaurantOrId){
    // Accept either a full restaurant object or just an ID
    const restaurant=typeof restaurantOrId==="string"
      ?restaurants.find(r=>r.id===restaurantOrId)
      :restaurantOrId;
    if(!restaurant)return false;
    const restaurantId=restaurant.id;
    // Register in restaurants state if not already there
    if(!restaurants.find(r=>r.id===restaurantId)){
      setRestaurants(prev=>[restaurant,...prev]);
    }
    if(gps.status==="active"&&gps.lat!=null){
      setCheckingId(restaurantId);setArrivalError(null);
      let branch=restaurant.branchLat!=null?{lat:restaurant.branchLat,lng:restaurant.branchLng}:null;
      if(!branch)branch=await geocodeBranch(gps.lat,gps.lng,restaurant.name);
      if(branch){
        const dist=distMeters(gps.lat,gps.lng,branch.lat,branch.lng);
        // Adaptive radius: forgiving on phones with poor GPS, capped so it can't go wide-open
        const allow=Math.min(150,Math.max(80,(gps.accuracy||40)+30));
        if(dist!=null&&dist>allow){
          setArrivalError({restaurantId,dist:Math.round(dist)});
          setCheckingId(null);
          setTimeout(()=>setArrivalError(a=>a?.restaurantId===restaurantId?null:a),4000);
          return false;
        }
      }
      setCheckingId(null);
    }
    const a={restaurantId,restaurantName:restaurant.name,startedAt:new Date().toISOString()};
    setActiveWait(a);store.set("delivr_activewait",a);
    // Ask for notification permission (on this tap gesture) so 20/40-min reminders can show
    try{ if(window.Notification&&Notification.permission==="default")Notification.requestPermission(); }catch(e){}
    // Add to live "waiting now" presence list
    try{ await setDoc(doc(db,"activeWaits",auth.currentUser.uid),{restaurantId,restaurantName:restaurant.name,startedAt:a.startedAt,username:user?.name||"anon"}); }catch(e){}
    return true;
  }

  // Manual Arrive: record the driver's GPS as a location vote, then re-cluster.
  async function handleManualArrive(restaurant){
    if(gps.status!=="active"||gps.lat==null)return;
    const eff=pinnedLocations[restaurant.id];
    const rLat=eff?eff.lat:(restaurant.branchLat??restaurant.lat);
    const rLng=eff?eff.lng:(restaurant.branchLng??restaurant.lng);
    const dist=rLat!=null?distMeters(gps.lat,gps.lng,rLat,rLng):0;
    if(dist!=null&&dist>300)return; // enforce 300m server-side of the UI gate
    try{
      await addDoc(collection(db,"locationVotes"),{
        restaurantId:restaurant.id,
        restaurantName:restaurant.name||"",
        lat:gps.lat,lng:gps.lng,
        username:user?.name||"anon",
        ts:new Date().toISOString(),
      });
      setManualVoted(restaurant.id);
      setTimeout(()=>setManualVoted(v=>v===restaurant.id?null:v),3000);
      await maybeUpdatePinnedLocation(restaurant.id,restaurant.name);
    }catch(e){console.error("manual arrive error:",e);}
  }

  // When 5+ votes from different drivers cluster within 100m, pin the average location.
  async function maybeUpdatePinnedLocation(restaurantId,restaurantName){
    try{
      const snap=await getDocs(query(collection(db,"locationVotes"),where("restaurantId","==",restaurantId)));
      const votes=snap.docs.map(d=>d.data());
      if(votes.length<5)return;
      let best=null;
      for(const c of votes){
        const near=votes.filter(v=>distMeters(c.lat,c.lng,v.lat,v.lng)<=100);
        const users=new Set(near.map(v=>v.username));
        if(users.size>=5&&(!best||users.size>best.userCount)){
          // one point per user (latest) so a single driver can't skew the average
          const perUser={};for(const v of near)perUser[v.username]=v;
          best={pts:Object.values(perUser),userCount:users.size};
        }
      }
      if(!best)return;
      const avgLat=best.pts.reduce((s,v)=>s+v.lat,0)/best.pts.length;
      const avgLng=best.pts.reduce((s,v)=>s+v.lng,0)/best.pts.length;
      await setDoc(doc(db,"restaurantLocations",restaurantId),{
        lat:avgLat,lng:avgLng,votes:best.userCount,
        name:restaurantName||"",updatedAt:new Date().toISOString(),
      });
    }catch(e){console.error("cluster error:",e);}
  }

  async function handlePickedUp(){
    if(!activeWait)return;
    const waitMins=Math.round((Date.now()-new Date(activeWait.startedAt))/60000*10)/10;
    const ts=new Date();
    const entry={
      id:             Date.now().toString(),
      restaurantId:   activeWait.restaurantId,
      restaurantName: activeWait.restaurantName||"",
      waitMins,
      ts:             ts.toISOString(),
      hour:           ts.getHours(),
      dow:            ts.getDay(),
      period:         timePeriod(ts.getHours()),
    };
    // Save locally (instant, works offline)
    const newLog=[...waitLog,entry];
    setWaitLog(newLog);store.set("delivr_waitlog",newLog);
    setActiveWait(null);store.set("delivr_activewait",null);
    // Remove from live "waiting now" presence list
    try{ await deleteDoc(doc(db,"activeWaits",auth.currentUser.uid)); }catch(e){}
    // Write to Firestore — triggers live pattern update for all drivers
    try{
      await addDoc(collection(db,"waitLogs"),{...entry,username:user?.name||"anon"});
    }catch(e){}
  }

  function handleCancelWait(){
    setActiveWait(null);store.set("delivr_activewait",null);
    try{ deleteDoc(doc(db,"activeWaits",auth.currentUser.uid)); }catch(e){}
  }
  // Auto-pickup removed: PICKED UP is manual-only so GPS drift can't create fake short waits.

  const CSS=`
    :root{
      --bg:#f4f6f8;--card:#ffffff;--ink:#16242b;
      --muted:#6b7a82;--muted2:#8a97a0;--faint:#aab4ba;--faint2:#cdd4d9;
      --border:#e9edf0;--border2:#dfe4e8;--border3:#eef1f3;
      --tint-green:#e7f7ee;--tint-blue:#e8f1ff;--tint-red:#fdecec;
      --tint-coral:#fff1ec;--tint-coral2:#ffe4d8;--tint-amber:#fff7e0;--tint-teal:#e6faf8;
    }
    [data-theme="dark"]{
      --bg:#0e1316;--card:#192127;--ink:#eaf0f2;
      --muted:#9aa7af;--muted2:#7d8a92;--faint:#5e6b73;--faint2:#46535b;
      --border:#28343a;--border2:#313d44;--border3:#222d33;
      --tint-green:#10291d;--tint-blue:#112338;--tint-red:#2c1517;
      --tint-coral:#2a1b13;--tint-coral2:#341f14;--tint-amber:#2a2410;--tint-teal:#0d2927;
    }
    *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
    html,body{background:var(--bg);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    ::-webkit-scrollbar{display:none}
    button{font-family:'Poppins',sans-serif}
    button:active{opacity:0.85;transform:scale(0.98)}
    input{outline:none}
    @keyframes criticalPulse{0%,100%{opacity:1}50%{opacity:0.4}}
    @keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
  `;

  if(!user){
    if(pendingVerify){
      return <div style={ROOT}><style>{CSS}</style>
        <VerifyCodeScreen email={pendingVerify.email} onVerified={handleVerified} onBack={()=>setPendingVerify(null)}/>
      </div>;
    }
    // First-time visitors see the 3-screen onboarding before login
    if(!onboarded){
      return <div style={ROOT}><style>{CSS}</style>
        <Onboarding onFinish={()=>{store.set("delivr_onboarded",true);setOnboarded(true);setStartRegister(true);}}/>
      </div>;
    }
    return <div style={ROOT}><style>{CSS}</style><LoginScreen initialMode={startRegister?"register":"login"} onLogin={handleLogin} onRegistered={handleRegistered}/></div>;
  }

  // Only gate when the user must act: permission denied, needs a tap to prompt, or no GPS.
  // While acquiring/pending we let the app load (location fills in shortly) so a slow
  // fix never traps anyone.
  if(["denied","prompt","error"].includes(gps.status)&&!gpsSkipped){
    return <div style={ROOT}><style>{CSS}</style><GPSGateScreen status={gps.status} onRetry={gps.retry} onSkip={()=>setGpsSkipped(true)}/></div>;
  }

  return(
    <div>
      <style>{CSS}</style>
      <div style={ROOT}>
        {/* Profile avatar button — fixed top right */}
        {!showProfile&&!showUpgrade&&!showStats&&!showLogbook&&(
          <button onClick={()=>setShowProfile(true)}
            style={{position:"fixed",top:14,right:14,zIndex:300,width:38,height:38,borderRadius:"50%",background:user.color,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 14px "+user.color+"55"}}>
            <span style={{...B,fontSize:17,color:"#000"}}>{user.initial}</span>
          </button>
        )}

        {/* Persistent wait banner — visible on every tab while a wait is open */}
        {activeWait&&!showProfile&&!showUpgrade&&!showStats&&!showLogbook&&(
          <PersistentWaitBanner restaurantName={activeWait.restaurantName||"Restaurant"} startedAt={activeWait.startedAt} onPickedUp={handlePickedUp}/>
        )}

        <div style={{height:"calc(100vh - 56px"+(activeWait&&!showProfile&&!showUpgrade&&!showStats&&!showLogbook?" - 56px":"")+")",overflowY:"auto"}}>
          {showLogbook?(
            <Logbook communityLogs={communityLogs} contribCounts={contribCounts} onBack={()=>setShowLogbook(false)}/>
          ):showStats&&isOwner(user)?(
            <StatsScreen communityLogs={communityLogs} communityPatterns={communityPatterns} activeCounts={activeCounts} contribCounts={contribCounts} onBack={()=>setShowStats(false)}/>
          ):showUpgrade?(
            <UpgradeScreen premium={premium} onBack={()=>setShowUpgrade(false)} onSubscribe={handleSubscribe} onCancel={handleCancelSub}/>
          ):showProfile?(
            <ProfileScreen user={user} waitLog={waitLog} gps={gps} premium={premium} theme={theme} onToggleTheme={toggleTheme} contribCount={contribCounts[user.name]||0}
              onBack={()=>setShowProfile(false)} onLogout={handleLogout} onSave={handleSaveProfile}
              onUpgrade={()=>{setShowProfile(false);setShowUpgrade(true);}}
              onStats={()=>{setShowProfile(false);setShowStats(true);}}/>
          ):screen==="waits"?(
            <WaitsScreen now={now} gps={gps} restaurants={resolvedRestaurants} waitLog={waitLog} activeWait={activeWait}
              communityPatterns={communityPatterns} communityLogs={communityLogs} checkingId={checkingId} arrivalError={arrivalError} premium={premium} manualVoted={manualVoted} activeCounts={activeCounts} activeWaitsList={activeWaitsList} contribCounts={contribCounts} onOpenLogbook={()=>setShowLogbook(true)}
              onArrived={handleArrived} onManualArrive={handleManualArrive} onPickedUp={handlePickedUp} onCancelWait={handleCancelWait}/>
          ):screen==="check"?(
            <CheckScreen restaurants={resolvedRestaurants} communityPatterns={communityPatterns} communityLogs={communityLogs} waitLog={waitLog} now={now} gps={gps} activeCounts={activeCounts}/>
          ):(
            <ChatScreen user={user} onLogout={handleLogout} area={user.area||"general"} contribCounts={contribCounts}/>
          )}
        </div>
        {/* 20/40-min reminder toast */}
        {reminder&&(
          <div style={{position:"fixed",bottom:68,left:"50%",transform:"translateX(-50%)",width:"calc(100% - 24px)",maxWidth:406,zIndex:400,background:"var(--card)",border:"1px solid #ff5a2d66",borderRadius:14,padding:"12px 14px",boxShadow:"0 8px 30px rgba(0,0,0,0.25)",display:"flex",alignItems:"center",gap:10,animation:"slideDown 0.2s ease"}}>
            <span style={{fontSize:20}}>⏰</span>
            <div style={{flex:1,fontSize:12,...M,color:"var(--ink)",lineHeight:1.4}}>{reminder}</div>
            <button onClick={()=>{handlePickedUp();setReminder(null);}} style={{flexShrink:0,background:"#06c167",border:"none",borderRadius:9,...B,fontWeight:700,fontSize:12,color:"#fff",padding:"8px 10px",cursor:"pointer"}}>PICKED UP</button>
            <button onClick={()=>setReminder(null)} style={{flexShrink:0,background:"none",border:"none",color:"var(--muted2)",fontSize:18,cursor:"pointer",padding:"0 2px"}}>✕</button>
          </div>
        )}
        {!showProfile&&!showUpgrade&&!showStats&&!showLogbook&&<BottomNav screen={screen} onNav={handleNav} activeWait={!!activeWait} unreadChat={unreadChat}/>}
      </div>
    </div>
  );
}

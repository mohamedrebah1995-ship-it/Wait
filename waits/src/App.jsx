import { useState, useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
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
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const GOOGLE_MAPS_KEY = "AIzaSyARDTROkeGrhMw_ZKsYw8SuLnw3skQf2yk";
const CFG = { MIN_SAMPLES: 2, COMMUNITY_MIN: 3 };

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

// Fetch real nearby restaurants from Google Places based on driver's GPS position
async function fetchNearbyRestaurants(lat,lng) {
  if(!GOOGLE_MAPS_KEY||lat==null||lng==null)return[];
  try{
    const res=await fetch("https://places.googleapis.com/v1/places:searchNearby",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":GOOGLE_MAPS_KEY,"X-Goog-FieldMask":"places.id,places.displayName,places.location,places.types"},
      body:JSON.stringify({
        includedTypes:["restaurant","fast_food_restaurant","cafe","bakery","meal_takeaway","sandwich_shop","pizza_restaurant","coffee_shop","supermarket","convenience_store","grocery_store"],
        maxResultCount:50,
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
      return{id:p.id,name:p.displayName?.text||"Unknown",branchLat:p.location.latitude,branchLng:p.location.longitude,baseWait,rel,label};
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
  if(!query||query.length<2)return[];
  try{
    const body={textQuery:query,maxResultCount:10,"X-Goog-FieldMask":"places.id,places.displayName,places.location,places.formattedAddress,places.types"};
    if(lat!=null)body.locationBias={circle:{center:{latitude:lat,longitude:lng},radius:50000}};
    const res=await fetch("https://places.googleapis.com/v1/places:searchText",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":GOOGLE_MAPS_KEY,"X-Goog-FieldMask":"places.id,places.displayName,places.location,places.formattedAddress"},
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
      baseWait:10,rel:0.70,label:"",
    }));
  }catch(e){return[];}
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
function LoginScreen({onLogin,onRegistered}) {
  const [mode,setMode]=useState("login");
  const [username,setUsername]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [colorIdx,setColorIdx]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const color=AVATAR_COLORS[colorIdx];

  // Firebase Auth requires an email — we derive one from username internally
  const toEmail=name=>`${name.trim().toLowerCase().replace(/\s+/g,"")}@delivr.app`;

  function switchMode(m){setMode(m);setError("");setPassword("");setConfirm("");setEmail("");}

  async function submit(e) {
    e.preventDefault();setError("");
    if(!username.trim()||username.trim().length<2){setError("Driver name must be at least 2 characters");return;}
    if(mode==="register"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setError("Enter a valid email address");return;}
    if(!password||password.length<6){setError("Password must be at least 6 characters");return;}
    if(mode==="register"&&password!==confirm){setError("Passwords do not match");return;}
    setLoading(true);
    try{
      const firebaseEmail=toEmail(username);
      if(mode==="register"){
        const cred=await createUserWithEmailAndPassword(auth,firebaseEmail,password);
        const profile={name:username.trim(),color,initial:username.trim()[0].toUpperCase(),email:email.trim()};
        await updateProfile(cred.user,{displayName:JSON.stringify(profile)});
        try{ await setDoc(doc(db,"users",cred.user.uid),{username:profile.name,color,initial:profile.initial,email:email.trim(),emailVerified:false,joinedAt:new Date().toISOString()}); }catch(e){}
        // Send verification code via backend
        const r=await fetch(`${API_URL}/auth/send-code`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email.trim()})});
        if(!r.ok){const d=await r.json();setError(d.error||"Could not send verification email");return;}
        onRegistered(profile,email.trim());
      }else{
        const cred=await signInWithEmailAndPassword(auth,email,password);
        // Read profile from Auth displayName — works even if Firestore is locked
        let profile=null;
        if(cred.user.displayName){
          try{ profile=JSON.parse(cred.user.displayName); }catch(e){}
        }
        // Fallback to Firestore if displayName not set (old accounts)
        if(!profile){
          try{
            const snap=await getDoc(doc(db,"users",cred.user.uid));
            if(snap.exists()){ const p=snap.data(); profile={name:p.username,color:p.color,initial:p.initial}; }
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
        {mode==="register"&&(
          <div>
            <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:7}}>EMAIL ADDRESS</div>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" type="email" autoComplete="email"
              style={{width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:14,padding:"16px 18px",color:"#f0f0f0",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:1}}
              onFocus={e=>{e.target.style.borderColor="#ff6600";}} onBlur={e=>{e.target.style.borderColor="#222";}}/>
          </div>
        )}
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
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 24px 60px",background:"linear-gradient(160deg,#0e0600 0%,#060606 55%)"}}>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{fontSize:56,marginBottom:16}}>📨</div>
        <div style={{...B,fontSize:40,color:"#ff6600",letterSpacing:3,marginBottom:8}}>CHECK YOUR EMAIL</div>
        <div style={{fontSize:13,...M,color:"#555",lineHeight:1.7}}>We sent a 6-digit code to</div>
        <div style={{fontSize:14,...M,color:"#f0f0f0",fontWeight:700,marginTop:4}}>{email}</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <div style={{fontSize:9,color:"#444",letterSpacing:2,marginBottom:7}}>ENTER YOUR CODE</div>
          <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))}
            placeholder="000000" maxLength={6} inputMode="numeric" autoFocus
            style={{width:"100%",background:"#0d0d0d",border:"1px solid #222",borderRadius:14,padding:"20px 18px",color:"#ff6600",fontSize:32,...M,fontWeight:700,outline:"none",boxSizing:"border-box",letterSpacing:8,textAlign:"center"}}
            onFocus={e=>e.target.style.borderColor="#ff6600"} onBlur={e=>e.target.style.borderColor="#222"}
            onKeyDown={e=>{if(e.key==="Enter")verify();}}/>
        </div>
        {error&&<div style={{background:"#1a0505",border:"1px solid #ff323244",borderRadius:10,padding:"12px 14px",fontSize:12,...M,color:"#ff3232"}}>{error}</div>}
        <button onClick={verify} disabled={loading||code.length!==6}
          style={{minHeight:64,background:loading||code.length!==6?"#1a1a1a":"#ff6600",border:"none",borderRadius:14,...B,fontSize:28,letterSpacing:4,color:loading||code.length!==6?"#333":"#000",cursor:loading||code.length!==6?"default":"pointer",boxShadow:loading||code.length!==6?"none":"0 0 40px #ff660040",transition:"all 0.2s"}}>
          {loading?"VERIFYING...":"VERIFY →"}
        </button>
        <button onClick={resend} disabled={resending||resent}
          style={{minHeight:52,background:"none",border:"1px solid "+(resent?"#00e87a":"#2a2a2a"),borderRadius:12,...B,fontSize:18,letterSpacing:2,color:resent?"#00e87a":"#555",cursor:resending||resent?"default":"pointer",transition:"all 0.2s"}}>
          {resending?"SENDING...":(resent?"✓ CODE SENT":"RESEND CODE")}
        </button>
        <button onClick={onBack}
          style={{minHeight:44,background:"none",border:"none",color:"#333",cursor:"pointer",fontSize:11,...M,letterSpacing:1}}>
          Use a different account
        </button>
      </div>
    </div>
  );
}

// ── WAITS SCREEN ──────────────────────────────────────────────────────────────
function WaitsScreen({now,gps,restaurants,waitLog,activeWait,communityPatterns,checkingId,arrivalError,onArrived,onPickedUp,onCancelWait}) {
  const [picking,setPicking]=useState(false);
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

  const sorted=restaurants.slice().sort((a,b)=>{
    if(activeWait?.restaurantId===a.id)return -1;
    if(activeWait?.restaurantId===b.id)return 1;
    const da=distMap[a.id],db=distMap[b.id];
    if(da!=null&&db!=null)return da-db;
    if(da!=null)return -1;if(db!=null)return 1;
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

  if(picking){
    const displayList=searchQuery.trim().length>=2?searchResults:restaurants.slice().sort((a,b)=>{const da=distMap[a.id],db=distMap[b.id];if(da!=null&&db!=null)return da-db;if(da!=null)return -1;if(db!=null)return 1;return 0;});
    return(
      <div style={{padding:"20px 16px 100px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <button onClick={closePicker} style={{background:"none",border:"none",color:"#ff6600",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
          <div style={{...B,fontSize:28,color:"#ff6600",letterSpacing:2}}>ARRIVED AT</div>
        </div>
        <div style={{position:"relative",marginBottom:14}}>
          <input value={searchQuery} onChange={e=>handleSearchInput(e.target.value)}
            placeholder="Type restaurant name..." autoFocus
            style={{width:"100%",background:"#0d0d0d",border:"1px solid #ff660066",borderRadius:12,padding:"14px 18px",color:"#f0f0f0",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#ff6600"} onBlur={e=>e.target.style.borderColor="#ff660066"}/>
          {searching&&<div style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",fontSize:10,color:"#ff6600",...B,letterSpacing:1}}>SEARCHING...</div>}
        </div>
        {searchQuery.length>=2&&searchResults.length===0&&!searching&&(
          <div style={{fontSize:11,color:"#444",textAlign:"center",padding:"20px 0",...M}}>No results found — try a different name</div>
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
                style={{background:"#0d0d0d",border:"1px solid "+(hasError?"#ff323244":"#1e1e1e"),borderRadius:12,padding:"14px 16px",cursor:isChecking?"default":"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:18,letterSpacing:1,color:"#f0f0f0"}}>{r.name}</div>
                  <div style={{fontSize:10,color:"#555",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {dStr&&<span style={{color:"#ff6600"}}>{dStr+" · "}</span>}
                    {r.address||( best!=null?<span style={{color:"#00e87a"}}>{"~"+best+"m wait"}</span>:("est. "+r.baseWait+"m"))}
                  </div>
                </div>
                <span style={{...B,fontSize:isChecking||hasError?10:26,color:hasError?"#ff3232":isChecking?"#555":"#ff6600",letterSpacing:1,flexShrink:0,marginLeft:10}}>
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
            {(restaurants.find(r=>r.id===activeWait.restaurantId)||{name:"Unknown"}).name}
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
          const isChecking=checkingId===r.id;
          const hasError=arrivalError?.restaurantId===r.id;

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
                {!isActive&&<button onClick={()=>onArrived(r.id)} disabled={isChecking} style={{marginLeft:"auto",background:isChecking?"#1a0a00":hasError?"#1a0505":"#ff6600",border:isChecking?"1px solid #ff660044":hasError?"1px solid #ff323244":"none",borderRadius:7,...B,fontSize:hasError?11:13,letterSpacing:1,color:isChecking?"#ff6600":hasError?"#ff3232":"#000",cursor:isChecking?"default":"pointer",padding:"6px 14px",minHeight:32}}>{isChecking?"CHECKING...":hasError?arrivalError.dist+"M AWAY":"ARRIVED"}</button>}
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
            const r=restaurants.find(x=>x.id===l.restaurantId);
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
  const [user,setUser]          =useState(()=>store.get("delivr_user")||null);
  const [pendingVerify,setPendingVerify]=useState(null);
  const [screen,setScreen]=useState("waits");
  const [now,setNow]      =useState(new Date());
  const [restaurants,setRestaurants]=useState(()=>store.get("delivr_nearby")||RESTAURANTS);
  const [waitLog,setWaitLog]=useState(()=>store.get("delivr_waitlog")||[]);
  const [activeWait,setActiveWait]=useState(()=>store.get("delivr_activewait")||null);
  const [communityPatterns,setCommunityPatterns]=useState({});
  const [unreadChat,setUnreadChat]=useState(false);
  const [checkingId,setCheckingId]=useState(null);
  const [arrivalError,setArrivalError]=useState(null);
  const lastFetchRef=useRef({lat:null,lng:null});
  const autoPickupTimerRef=useRef(null);
  const handlePickedUpRef=useRef(null);
  const gps=useGPS();

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
    },()=>{});
    return unsub;
  },[]);

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),15000);return ()=>clearInterval(id);},[]);

  useEffect(()=>{
    if(gps.status!=="active"||gps.lat==null)return;
    const last=lastFetchRef.current;
    const far=last.lat==null||distMeters(last.lat,last.lng,gps.lat,gps.lng)>500;
    if(far){
      lastFetchRef.current={lat:gps.lat,lng:gps.lng};
      fetchNearbyRestaurants(gps.lat,gps.lng).then(res=>{
        if(res.length>0){setRestaurants(res);store.set("delivr_nearby",res);}
      }).catch(()=>{});
    }
  },[gps.status,gps.lat,gps.lng]);

  function handleNav(s){if(s==="chat")setUnreadChat(false);setScreen(s);}

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
    setScreen("waits");
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
        if(dist!=null&&dist>50){
          setArrivalError({restaurantId,dist:Math.round(dist)});
          setCheckingId(null);
          setTimeout(()=>setArrivalError(a=>a?.restaurantId===restaurantId?null:a),4000);
          return false;
        }
      }
      setCheckingId(null);
    }
    const a={restaurantId,startedAt:new Date().toISOString()};
    setActiveWait(a);store.set("delivr_activewait",a);
    return true;
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

  handlePickedUpRef.current=handlePickedUp;

  function handleCancelWait(){setActiveWait(null);store.set("delivr_activewait",null);}

  // Auto-trigger PICKED UP when driver moves >30m from restaurant and stays away 20s
  useEffect(()=>{
    if(!activeWait||gps.status!=="active"||gps.lat==null||!restaurants.length){
      if(autoPickupTimerRef.current){clearTimeout(autoPickupTimerRef.current);autoPickupTimerRef.current=null;}
      return;
    }
    const branch=restaurants.find(n=>n.id===activeWait.restaurantId);
    if(!branch)return;
    const dist=distMeters(gps.lat,gps.lng,branch.branchLat??branch.lat,branch.branchLng??branch.lng);
    if(dist==null)return;
    if(dist>30){
      if(!autoPickupTimerRef.current){
        autoPickupTimerRef.current=setTimeout(()=>{autoPickupTimerRef.current=null;handlePickedUpRef.current?.();},20000);
      }
    }else{
      if(autoPickupTimerRef.current){clearTimeout(autoPickupTimerRef.current);autoPickupTimerRef.current=null;}
    }
  },[gps.lat,gps.lng,gps.status,activeWait?.restaurantId,restaurants]);

  useEffect(()=>()=>{if(autoPickupTimerRef.current)clearTimeout(autoPickupTimerRef.current);},[]);

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
    if(pendingVerify){
      return <div style={ROOT}><style>{CSS}</style>
        <VerifyCodeScreen email={pendingVerify.email} onVerified={handleVerified} onBack={()=>setPendingVerify(null)}/>
      </div>;
    }
    return <div style={ROOT}><style>{CSS}</style><LoginScreen onLogin={handleLogin} onRegistered={handleRegistered}/></div>;
  }


  return(
    <div>
      <style>{CSS}</style>
      <div style={ROOT}>
        <div style={{height:"calc(100vh - 56px)",overflowY:"auto"}}>
          {screen==="waits"&&(
            <WaitsScreen now={now} gps={gps} restaurants={restaurants} waitLog={waitLog} activeWait={activeWait}
              communityPatterns={communityPatterns} checkingId={checkingId} arrivalError={arrivalError}
              onArrived={handleArrived} onPickedUp={handlePickedUp} onCancelWait={handleCancelWait}/>
          )}
          {screen==="chat"&&<ChatScreen user={user} onLogout={handleLogout}/>}
        </div>
        <BottomNav screen={screen} onNav={handleNav} activeWait={!!activeWait} unreadChat={unreadChat}/>
      </div>
    </div>
  );
}

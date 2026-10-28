// ── SCREEN READER BUTTON (iOS only) ───────────────────────────────────────────
// Small pill next to the STACK CHECK title. Tap = open the iOS broadcast sheet (driver confirms there).
// While the extension is heartbeating it shows "● Reading". Stopping is done from the red status-bar pill.
// Long-press = debug sheet: reader status, extension memory peak, and the last 5 detected events.
// Renders nothing off iOS.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SCREEN_READER_SUPPORTED, startShift, screenReaderStatus, recentEvents } from "./screenReader";

const B = { fontFamily:"'Poppins',sans-serif" };
const M = { fontFamily:"'Nunito',sans-serif" };
const LONG_PRESS_MS = 600;
const MEMORY_LIMIT_MB = 50;

// Connection state for the "Offline" badge. navigator.onLine can only be trusted when it says offline,
// which is the case that matters here.
function useOnline(){
  const [online,setOnline]=useState(()=>typeof navigator==="undefined"||navigator.onLine!==false);
  useEffect(()=>{
    const up=()=>setOnline(true), down=()=>setOnline(false);
    window.addEventListener("online",up); window.addEventListener("offline",down);
    return ()=>{window.removeEventListener("online",up);window.removeEventListener("offline",down);};
  },[]);
  return online;
}

export default function ScreenReaderButton(){
  const online=useOnline();
  const [status,setStatus]=useState(null);
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  const [debugOpen,setDebugOpen]=useState(false);
  const pressRef=useRef({timer:null,fired:false});

  useEffect(()=>{
    if(!SCREEN_READER_SUPPORTED) return;
    let alive=true;
    const poll=()=>screenReaderStatus().then(s=>{if(alive)setStatus(s);}).catch(()=>{});
    poll();
    const id=setInterval(poll,2000);
    return ()=>{alive=false;clearInterval(id);};
  },[]);

  if(!SCREEN_READER_SUPPORTED) return null;
  const live=!!status?.live;

  async function onTap(){
    if(pressRef.current.fired){ pressRef.current.fired=false; return; }   // the long-press already handled it
    if(live||busy) return;
    setBusy(true); setFailed(false);
    try{ await startShift(); }
    catch{ setFailed(true); }
    finally{ setBusy(false); }
  }
  function pressStart(){
    pressRef.current.fired=false;
    pressRef.current.timer=setTimeout(()=>{ pressRef.current.fired=true; setDebugOpen(true); },LONG_PRESS_MS);
  }
  function pressEnd(){ clearTimeout(pressRef.current.timer); }

  const label=live?"● Reading":busy?"…":failed?"Retry":"Start shift";
  return (
    <>
      <button type="button" onClick={onTap} onTouchStart={pressStart} onTouchEnd={pressEnd} onTouchMove={pressEnd}
        onContextMenu={e=>{e.preventDefault();setDebugOpen(true);}}
        style={{...B,pointerEvents:"auto",flexShrink:0,fontWeight:800,fontSize:10,letterSpacing:.4,padding:"3px 8px",borderRadius:999,cursor:live?"default":"pointer",
          WebkitUserSelect:"none",userSelect:"none",WebkitTouchCallout:"none",
          border:live?"none":"1px solid #06c167",background:live?"#06c167":"transparent",color:live?"#00250f":"#06c167"}}>
        {label}
        {!online&&<span style={{marginLeft:5,padding:"0 5px",borderRadius:999,background:"#f5a623",color:"#2b1a00",fontSize:8.5,fontWeight:800,letterSpacing:.3}}>Offline</span>}
      </button>
      {debugOpen&&createPortal(<DebugSheet status={status} onClose={()=>setDebugOpen(false)}/>,document.body)}
    </>
  );
}

function money(v){ return typeof v==="number" ? "£"+v.toFixed(2) : null; }

function eventLine(e){
  // Location is only ever a postcode here; the extension never logs street addresses.
  const bits=[
    e.offerType,
    e.pay!=null&&(e.offerType==="Add-on"?"+":"")+money(e.pay),
    e.minutes!=null&&e.minutes+" min",
    e.miles!=null&&e.miles+" mi",
    e.stops!=null&&e.stops+" stops",
    e.orders!=null&&e.orders+" order",
    e.restaurant,
    e.pickupPostcode&&"from "+e.pickupPostcode,
    e.dropPostcode&&"→ "+e.dropPostcode,
    e.pending&&"pending",
    e.earningsToday!=null&&"today "+money(e.earningsToday),
    e.cancellationFee!=null&&"fee "+money(e.cancellationFee),
  ].filter(Boolean);
  if(e.flags?.length) bits.push("["+e.flags.join(", ")+"]");
  return bits.join(" · ");
}

const PLATFORM_LABEL={UBER_EATS:"Uber Eats",JUST_EAT:"Just Eat",DELIVEROO:"Deliveroo"};

function DebugSheet({status,onClose}){
  const [events,setEvents]=useState(null);
  useEffect(()=>{
    let alive=true;
    const load=()=>recentEvents(5).then(ev=>{if(alive)setEvents(ev);}).catch(()=>{if(alive)setEvents([]);});
    load();
    const id=setInterval(load,3000);
    return ()=>{alive=false;clearInterval(id);};
  },[]);

  const peak=status?.peakMB||0;
  const row={display:"flex",justifyContent:"space-between",gap:12,fontSize:12,...M,color:"var(--muted)",padding:"3px 0"};
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"flex-end"}}>
      <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxHeight:"75vh",overflowY:"auto",background:"var(--card)",borderTop:"1px solid var(--border2)",
        borderRadius:"16px 16px 0 0",padding:"14px 16px calc(16px + env(safe-area-inset-bottom,0px))",boxSizing:"border-box"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{...B,fontWeight:800,fontSize:12,letterSpacing:1.2,color:"#00b8a9"}}>SCREEN READER DEBUG</div>
          <button type="button" onClick={onClose} style={{...B,background:"none",border:"none",color:"var(--muted)",fontSize:13,fontWeight:700,padding:"6px 2px",cursor:"pointer"}}>Close</button>
        </div>
        <div style={row}><span>State</span><span style={{color:"var(--ink)"}}>{status?.live?"Reading":status?.state||"—"}{status?.error?" · "+status.error:""}</span></div>
        {/* The funnel: every frame → bottom changed → delivery-app button seen (gate) → OCR → event.
            Frames that stop before "passed gate" were never read. */}
        <div style={row}><span>Frames</span><span style={{color:"var(--ink)"}}>{status?.ticks??0}</span></div>
        <div style={row}><span>Bottom changed</span><span style={{color:"var(--ink)"}}>{status?.changedFrames??0}</span></div>
        <div style={row}><span>Passed gate (delivery app)</span><span style={{color:"var(--ink)"}}>{status?.passedGate??0}</span></div>
        <div style={row}><span>OCR runs</span><span style={{color:"var(--ink)"}}>{status?.ocrPasses??0}</span></div>
        <div style={row}><span>Events</span><span style={{color:"var(--ink)"}}>{status?.events??0}</span></div>
        <div style={row}><span>Extension memory peak</span>
          <span style={{color:peak>MEMORY_LIMIT_MB*0.9?"#ef4444":"var(--ink)"}}>{peak?peak.toFixed(1):"—"} / {MEMORY_LIMIT_MB} MB</span></div>
        <div style={{...B,fontWeight:800,fontSize:10,letterSpacing:1.2,color:"var(--muted2)",margin:"12px 0 6px"}}>LAST 5 EVENTS</div>
        {events===null&&<div style={{fontSize:12,...M,color:"var(--muted)"}}>Loading…</div>}
        {events&&events.length===0&&<div style={{fontSize:12,...M,color:"var(--muted)"}}>No events yet. Start a shift and open a delivery app.</div>}
        {events&&events.map((e,i)=>(
          <div key={i} style={{borderTop:i?"1px solid var(--border2)":"none",padding:"8px 0"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12,...B,fontWeight:700,color:"var(--ink)"}}>
              <span>{e.type} · {PLATFORM_LABEL[e.platform]||e.platform}</span>
              <span style={{...M,fontWeight:400,color:"var(--muted)"}}>{e.at?new Date(e.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}):""}</span>
            </div>
            <div style={{fontSize:11.5,...M,color:"var(--muted)",lineHeight:1.45,marginTop:2,overflowWrap:"anywhere"}}>{eventLine(e)||"—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN READER BUTTON (iOS only) ───────────────────────────────────────────
// Small pill next to the STACK CHECK title. Tap = open the iOS broadcast sheet (driver confirms there).
// While the extension is heartbeating it shows "● Reading". Stopping is done from the red status-bar pill.
// Renders nothing off iOS.

import { useEffect, useState } from "react";
import { SCREEN_READER_SUPPORTED, startShift, screenReaderStatus } from "./screenReader";

const B = { fontFamily:"'Poppins',sans-serif" };

export default function ScreenReaderButton(){
  const [live,setLive]=useState(false);
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);

  useEffect(()=>{
    if(!SCREEN_READER_SUPPORTED) return;
    let alive=true;
    const poll=()=>screenReaderStatus().then(s=>{if(alive)setLive(!!s.live);}).catch(()=>{});
    poll();
    const id=setInterval(poll,2000);
    return ()=>{alive=false;clearInterval(id);};
  },[]);

  if(!SCREEN_READER_SUPPORTED) return null;

  async function onTap(){
    if(live||busy) return;
    setBusy(true); setFailed(false);
    try{ await startShift(); }
    catch{ setFailed(true); }
    finally{ setBusy(false); }
  }

  const label=live?"● Reading":busy?"…":failed?"Retry":"Start shift";
  return (
    <button type="button" onClick={onTap}
      style={{...B,pointerEvents:"auto",flexShrink:0,fontWeight:800,fontSize:10,letterSpacing:.4,padding:"3px 8px",borderRadius:999,cursor:live?"default":"pointer",
        border:live?"none":"1px solid #06c167",background:live?"#06c167":"transparent",color:live?"#00250f":"#06c167"}}>
      {label}
    </button>
  );
}

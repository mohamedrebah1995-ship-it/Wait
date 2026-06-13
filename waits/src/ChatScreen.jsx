// Chat feature — lazy-loaded on demand (heaviest screen: live messaging, image
// compression, hold-to-record voice notes, reactions). Pulled out of the main bundle
// so none of it — nor firebase/storage — loads until a driver opens the CHAT tab.
import { useState, useEffect, useRef } from "react";
import { collection, query, orderBy, limitToLast, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db, loadStorage } from "./firebase";
import { B, M, badgeFor, REACTIONS } from "./App.jsx";

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
function ChatScreen({user,onLogout,area,contribCounts,onGoProfile}) {
  const room="braintree";   // single community room (all historic chat merged here)
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

  // Live listener — re-subscribes whenever the room (area) changes. No area → no chat.
  useEffect(()=>{
    setReady(false);setMessages([]);
    if(!room)return;
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
      const {storage,ref,uploadBytes,getDownloadURL}=await loadStorage();
      const path=`chats/${room}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const r=ref(storage,path);
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
      if(m.url){ try{ const {storage,ref,deleteObject}=await loadStorage(); await deleteObject(ref(storage,m.url)); }catch(e){} }
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

export default ChatScreen;

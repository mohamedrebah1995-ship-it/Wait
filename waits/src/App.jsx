import { useState, useEffect, useRef, useCallback, useMemo, Fragment, lazy, Suspense } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, limit,
  onSnapshot, getDocs,
} from "firebase/firestore";
import { auth, db, setupPush } from "./firebase";

// Chat is the heaviest screen and rarely the landing tab — load it (and firebase/storage)
// on demand the first time a driver opens CHAT, not on first paint.
const ChatScreen = lazy(() => import("./ChatScreen.jsx"));

const FL = document.createElement("link");
FL.rel = "stylesheet";
FL.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Nunito:wght@400;600;700;800&display=swap";
document.head.appendChild(FL);

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
// Public Mapbox token — all restaurant location lookup runs on Mapbox (50k free req/month).
// Google Places has been removed entirely (it was running up real cost via many calls).
const MAPBOX_TOKEN = "pk.eyJ1Ijoia2luZ29mbWFkbmVzcyIsImEiOiJjbXAzZTFoNDYwbGNtMnBzODZuYnNiY3FvIn0.yVEwZEGgiP8gqqOIycdJWA";
const ADSENSE_CLIENT = "ca-pub-3527173535512943";
const ADSENSE_SLOT   = "";  // ← paste your AdSense ad-unit slot ID here once AdSense is approved
const SUB_PRICE = "£4.99";
// Accounts that can see the admin APP STATS screen (add more emails if needed)
const OWNER_EMAILS = ["mohamedrebah1995@gmail.com","contact.morebah@gmail.com"];
const isOwner = u => !!u?.email && OWNER_EMAILS.includes(u.email.toLowerCase());
// Delegated admins: see real driver names in the live activity + get premium perks.
const ADMIN_PERK_EMAILS = ["contact.morebah@gmail.com"];
const hasAdminPerks = u => !!u?.email && ADMIN_PERK_EMAILS.includes(u.email.toLowerCase());
const CFG = { MIN_SAMPLES: 2, COMMUNITY_MIN: 1 };

// Curated chains always shown first (in this order), then Google nearby for the rest.
// `keys` are lowercase name fragments used to match a real nearby branch from Google.
// Hardcoded fallback list with real branch coordinates, so the app can always show & sort by
// distance (Haversine) with ZERO API calls when no cache/API is available.
const CURATED = [
  { id:"mcdonalds",   name:"McDonald's",    keys:["mcdonald"],                  branchLat:51.86762, branchLng:0.58112, baseWait:4,  rel:0.86, label:"Usually fast" },
  { id:"kfc",         name:"KFC",           keys:["kfc"],                       branchLat:51.86744, branchLng:0.58075, baseWait:13, rel:0.45, label:"High queue risk" },
  { id:"nandos",      name:"Nando's",       keys:["nando"],                     branchLat:51.86784, branchLng:0.57229, baseWait:17, rel:0.45, label:"Unpredictable" },
  { id:"wagamama",    name:"Wagamama",      keys:["wagamama"],                  branchLat:51.86948, branchLng:0.57110, baseWait:16, rel:0.48, label:"Wait likely" },
  { id:"pizzaexpress",name:"Pizza Express", keys:["pizza express","pizzaexpress","pizzaexp"], branchLat:51.86790, branchLng:0.57150, baseWait:13, rel:0.55, label:"Variable" },
  { id:"zizzi",       name:"Zizzi",         keys:["zizzi"],                     branchLat:51.86792, branchLng:0.57150, baseWait:15, rel:0.50, label:"Sit-down wait" },
  { id:"cocodimama",  name:"Coco di Mama",  keys:["coco di mama","coco"],       branchLat:51.86794, branchLng:0.57154, baseWait:8,  rel:0.70, label:"Moderate wait" },
  { id:"sainsburys",  name:"Sainsbury's",   keys:["sainsbury"],                 branchLat:51.87881, branchLng:0.55298, baseWait:6,  rel:0.78, label:"Usually quick" },
];

// Merge: curated chains (pinned to their nearest real branch) first, then other nearby places.
// Cache of curated-chain branch locations resolved via Mapbox, persisted in localStorage for
// 24h (per entry). Once a chain's branch is looked up, its coords are reused — across reloads —
// so rebuilding the nearby list makes no API call for chains we already know within 24h.
// Hydrated lazily because `store` is defined further down.
const CHAIN_CACHE_KEY = "delivr_chainBranch";
const CHAIN_CACHE_TTL = 24 * 60 * 60 * 1000;
let _chainBranchCache = null;
function chainCache(){ if(!_chainBranchCache) _chainBranchCache = store.get(CHAIN_CACHE_KEY) || {}; return _chainBranchCache; }

async function buildRestaurantList(places, lat, lng) {
  const matchesCurated = p => { const n=(p.name||"").toLowerCase(); return CURATED.find(c=>c.keys.some(k=>n.includes(k))); };
  const cache = chainCache();
  // Each curated chain: prefer the nearby match (with hours); else reuse a cached branch
  // location (<24h old); else look it up once via Google and cache it.
  const seed = await Promise.all(CURATED.map(async c => {
    let m = places.find(p => { const n=(p.name||"").toLowerCase(); return c.keys.some(k=>n.includes(k)); });
    if(!m || m.openNow===undefined){
      const cached = cache[c.id];
      if(cached && cached.loc && Date.now()-cached.ts < CHAIN_CACHE_TTL){
        m = m ? { ...m, ...cached.loc } : { ...cached.loc };   // reuse known coords, skip the API call
      }else{
        try{
          const res = await searchRestaurants(c.name, lat, lng);
          const hit = res.find(x=>{ const n=(x.name||"").toLowerCase(); return c.keys.some(k=>n.includes(k)); }) || res[0];
          if(hit){ m = hit; cache[c.id] = { loc:{ id:hit.id, branchLat:hit.branchLat, branchLng:hit.branchLng, address:hit.address }, ts:Date.now() }; store.set(CHAIN_CACHE_KEY, cache); }
        }catch(e){}
      }
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
export const REACTIONS = ["👍","❤️","😂","🔥","😮","🙏"];   // chat message reactions
const QUALITY_MIN_WAIT = 0.5;  // minutes — instant arrive→collect (<30s) doesn't count
const DAILY_CAP = 15;          // max logs counted per driver per day (anti-spam)
export function badgeFor(count){ return BADGE_TIERS.find(t=>count>=t.min)||null; }
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
export const B = { fontFamily:"'Poppins',sans-serif" };
export const M = { fontFamily:"'Nunito',sans-serif" };
const ROOT = { ...M, background:"var(--bg)", color:"var(--ink)", minHeight:"100vh", maxWidth:430, margin:"0 auto", userSelect:"none" };

// ── Languages / i18n ──────────────────────────────────────────────────────────
const LANGS = [
  { code:"en", name:"English",    flag:"🇬🇧" },
  { code:"pl", name:"Polski",     flag:"🇵🇱" },
  { code:"ar", name:"العربية",    flag:"🇸🇦", rtl:true },
  { code:"hi", name:"हिन्दी",      flag:"🇮🇳" },
  { code:"ur", name:"اردو",       flag:"🇵🇰", rtl:true },
  { code:"pt", name:"Português",  flag:"🇵🇹" },
  { code:"zh", name:"中文",        flag:"🇨🇳" },
  { code:"ro", name:"Română",     flag:"🇷🇴" },
  { code:"es", name:"Español",    flag:"🇪🇸" },
  { code:"ru", name:"Русский",    flag:"🇷🇺" },
];
const T = {
  en:{ chooseLang:"Choose your language", continue:"CONTINUE →", tagline:"DRIVER COMMUNITY",
    next:"NEXT", join:"JOIN THE COMMUNITY →", skip:"Skip",
    ob1_title:"You've been waiting.\nNow waiting pays.", ob1_body:"Every minute you wait outside a restaurant is data. Delivr turns that wait into live intel that saves you and every driver near you time.",
    ob2_title:"Two taps. That's it.", ob2_arrive_t:"Arrive", ob2_arrive_d:"Tap once when you reach the restaurant. The timer starts automatically.", ob2_pickup_t:"Pick up", ob2_pickup_d:"Tap once when you've got the order. That's your wait, logged.", ob2_see_t:"Everyone sees it", ob2_see_d:"Every nearby driver instantly sees the real wait time.",
    ob3_title:"Help me.\nI help you.", ob3_body:"Delivr only works because drivers share. The more you log, the smarter it gets for everyone. Join the crew.",
    signin:"SIGN IN", create:"CREATE ACCOUNT", drivername:"DRIVER NAME", email:"EMAIL ADDRESS", password:"PASSWORD", confirm:"CONFIRM PASSWORD", colour:"YOUR COLOUR", forgot:"Forgot password?", signinBtn:"SIGN IN →", createBtn:"CREATE ACCOUNT →", changeLang:"🌐 Language" },
  pl:{ chooseLang:"Wybierz swój język", continue:"DALEJ →", tagline:"SPOŁECZNOŚĆ KIEROWCÓW",
    next:"DALEJ", join:"DOŁĄCZ DO SPOŁECZNOŚCI →", skip:"Pomiń",
    ob1_title:"Czekałeś.\nTeraz czekanie się opłaca.", ob1_body:"Każda minuta czekania pod restauracją to dane. Delivr zamienia to czekanie w informacje na żywo, które oszczędzają czas Tobie i kierowcom obok.",
    ob2_title:"Dwa dotknięcia. To wszystko.", ob2_arrive_t:"Przyjazd", ob2_arrive_d:"Dotknij raz po dotarciu do restauracji. Licznik startuje automatycznie.", ob2_pickup_t:"Odbiór", ob2_pickup_d:"Dotknij, gdy masz zamówienie. Twój czas oczekiwania zapisany.", ob2_see_t:"Wszyscy to widzą", ob2_see_d:"Każdy kierowca w pobliżu od razu widzi prawdziwy czas oczekiwania.",
    ob3_title:"Pomóż mi.\nJa pomogę Tobie.", ob3_body:"Delivr działa dzięki kierowcom. Im więcej zapisujesz, tym mądrzejszy dla wszystkich. Dołącz do ekipy.",
    signin:"ZALOGUJ", create:"ZAŁÓŻ KONTO", drivername:"NAZWA KIEROWCY", email:"ADRES E-MAIL", password:"HASŁO", confirm:"POTWIERDŹ HASŁO", colour:"TWÓJ KOLOR", forgot:"Nie pamiętasz hasła?", signinBtn:"ZALOGUJ →", createBtn:"ZAŁÓŻ KONTO →", changeLang:"🌐 Język" },
  ar:{ chooseLang:"اختر لغتك", continue:"متابعة →", tagline:"مجتمع السائقين",
    next:"التالي", join:"انضم إلى المجتمع →", skip:"تخطٍّ",
    ob1_title:"كنت تنتظر.\nالآن الانتظار يكافئك.", ob1_body:"كل دقيقة تنتظرها أمام المطعم هي بيانات. يحوّل ديليفر هذا الانتظار إلى معلومات حية توفّر وقتك ووقت كل سائق بقربك.",
    ob2_title:"نقرتان فقط.", ob2_arrive_t:"الوصول", ob2_arrive_d:"انقر مرة عند وصولك للمطعم. يبدأ المؤقّت تلقائياً.", ob2_pickup_t:"الاستلام", ob2_pickup_d:"انقر عند استلامك الطلب. هذا وقت انتظارك، مُسجّل.", ob2_see_t:"يراه الجميع", ob2_see_d:"كل سائق قريب يرى وقت الانتظار الحقيقي فوراً.",
    ob3_title:"ساعدني.\nأساعدك.", ob3_body:"ديليفر ينجح لأن السائقين يتشاركون. كلما سجّلت أكثر، أصبح أذكى للجميع. انضم إلينا.",
    signin:"تسجيل الدخول", create:"إنشاء حساب", drivername:"اسم السائق", email:"البريد الإلكتروني", password:"كلمة المرور", confirm:"تأكيد كلمة المرور", colour:"لونك", forgot:"نسيت كلمة المرور؟", signinBtn:"دخول →", createBtn:"إنشاء حساب →", changeLang:"🌐 اللغة" },
  hi:{ chooseLang:"अपनी भाषा चुनें", continue:"जारी रखें →", tagline:"ड्राइवर समुदाय",
    next:"आगे", join:"समुदाय से जुड़ें →", skip:"छोड़ें",
    ob1_title:"आप इंतज़ार करते रहे।\nअब इंतज़ार का फ़ायदा।", ob1_body:"रेस्टोरेंट के बाहर हर मिनट का इंतज़ार डेटा है। Delivr इसे लाइव जानकारी में बदलता है जो आपका और पास के हर ड्राइवर का समय बचाता है।",
    ob2_title:"बस दो टैप।", ob2_arrive_t:"पहुँचे", ob2_arrive_d:"रेस्टोरेंट पहुँचते ही एक बार टैप करें। टाइमर अपने आप शुरू।", ob2_pickup_t:"पिक अप", ob2_pickup_d:"ऑर्डर मिलते ही टैप करें। आपका इंतज़ार दर्ज।", ob2_see_t:"सबको दिखता है", ob2_see_d:"पास का हर ड्राइवर तुरंत असली इंतज़ार समय देखता है।",
    ob3_title:"मेरी मदद करो।\nमैं तुम्हारी करूँगा।", ob3_body:"Delivr तभी चलता है जब ड्राइवर साझा करते हैं। जितना ज़्यादा लॉग, सबके लिए उतना बेहतर। जुड़ें।",
    signin:"साइन इन", create:"खाता बनाएँ", drivername:"ड्राइवर नाम", email:"ईमेल पता", password:"पासवर्ड", confirm:"पासवर्ड पुष्टि", colour:"आपका रंग", forgot:"पासवर्ड भूल गए?", signinBtn:"साइन इन →", createBtn:"खाता बनाएँ →", changeLang:"🌐 भाषा" },
  ur:{ chooseLang:"اپنی زبان منتخب کریں", continue:"جاری رکھیں →", tagline:"ڈرائیور کمیونٹی",
    next:"آگے", join:"کمیونٹی میں شامل ہوں →", skip:"چھوڑیں",
    ob1_title:"آپ انتظار کرتے رہے۔\nاب انتظار کا فائدہ۔", ob1_body:"ریستوران کے باہر ہر منٹ کا انتظار ڈیٹا ہے۔ Delivr اسے لائیو معلومات میں بدل دیتا ہے جو آپ کا اور قریب کے ہر ڈرائیور کا وقت بچاتا ہے۔",
    ob2_title:"بس دو ٹیپ۔", ob2_arrive_t:"پہنچے", ob2_arrive_d:"ریستوران پہنچتے ہی ایک بار ٹیپ کریں۔ ٹائمر خودبخود شروع۔", ob2_pickup_t:"پک اپ", ob2_pickup_d:"آرڈر ملتے ہی ٹیپ کریں۔ آپ کا انتظار درج۔", ob2_see_t:"سب کو نظر آتا ہے", ob2_see_d:"قریب کا ہر ڈرائیور فوراً اصل انتظار وقت دیکھتا ہے۔",
    ob3_title:"میری مدد کرو۔\nمیں تمہاری کروں گا۔", ob3_body:"Delivr تبھی چلتا ہے جب ڈرائیور شیئر کرتے ہیں۔ جتنا زیادہ لاگ، سب کے لیے اتنا بہتر۔ شامل ہوں۔",
    signin:"سائن اِن", create:"اکاؤنٹ بنائیں", drivername:"ڈرائیور نام", email:"ای میل پتہ", password:"پاس ورڈ", confirm:"پاس ورڈ کی تصدیق", colour:"آپ کا رنگ", forgot:"پاس ورڈ بھول گئے؟", signinBtn:"سائن اِن →", createBtn:"اکاؤنٹ بنائیں →", changeLang:"🌐 زبان" },
  pt:{ chooseLang:"Escolha o seu idioma", continue:"CONTINUAR →", tagline:"COMUNIDADE DE MOTORISTAS",
    next:"PRÓXIMO", join:"ENTRAR NA COMUNIDADE →", skip:"Pular",
    ob1_title:"Você esperou.\nAgora esperar compensa.", ob1_body:"Cada minuto esperando fora do restaurante é dado. O Delivr transforma essa espera em informação ao vivo que poupa tempo seu e de cada motorista perto de você.",
    ob2_title:"Dois toques. Só isso.", ob2_arrive_t:"Cheguei", ob2_arrive_d:"Toque uma vez ao chegar ao restaurante. O cronômetro começa sozinho.", ob2_pickup_t:"Peguei", ob2_pickup_d:"Toque ao receber o pedido. Sua espera fica registrada.", ob2_see_t:"Todos veem", ob2_see_d:"Cada motorista por perto vê o tempo de espera real na hora.",
    ob3_title:"Ajude-me.\nEu ajudo você.", ob3_body:"O Delivr só funciona porque os motoristas compartilham. Quanto mais você registra, melhor para todos. Junte-se.",
    signin:"ENTRAR", create:"CRIAR CONTA", drivername:"NOME DO MOTORISTA", email:"E-MAIL", password:"SENHA", confirm:"CONFIRMAR SENHA", colour:"SUA COR", forgot:"Esqueceu a senha?", signinBtn:"ENTRAR →", createBtn:"CRIAR CONTA →", changeLang:"🌐 Idioma" },
};
// Strings used across the rest of the app
const T2 = {
  en:{ nav_waits:"WAITS",nav_check:"CHECK",nav_stats:"STATS",nav_chat:"CHAT",
    w_title:"RESTAURANT WAITS",w_arrived:"📍 ARRIVED AT RESTAURANT",w_waitingAt:"WAITING AT",w_pickedUp:"✓ PICKED UP",w_gotIt:"✓ GOT IT — PICKED UP",w_delivered:"✓ DELIVERED",w_arrivedShort:"ARRIVED",w_timingNow:"● TIMING NOW",w_noData:"NO DATA YET",w_closed:"CLOSED",w_closedNow:"Closed right now",w_waitingNow:"WAITING NOW",w_noOne:"No one waiting now",w_liveActivity:"LIVE ACTIVITY",w_viewAll:"View all ›",w_communityLive:"COMMUNITY DATA LIVE",w_yourData:"YOUR DATA",w_community:"COMMUNITY",w_recent:"RECENT WAIT LOGS",w_tapHint:"TAP PICKED UP THE MOMENT YOU HAVE THE ORDER",w_liveNow:"live now",
    prof_title:"DRIVER PROFILE",prof_free:"FREE PLAN",prof_premium:"⭐ PREMIUM",prof_goPremium:"GO PREMIUM",prof_premiumActive:"PREMIUM ACTIVE",prof_totalLogs:"TOTAL LOGS",prof_restaurants:"RESTAURANTS",prof_avgWait:"AVG WAIT",prof_rank:"CONTRIBUTOR RANK",prof_noBadge:"NO BADGE YET",prof_qualityLogs:"QUALITY LOGS",prof_name:"DRIVER NAME",prof_phone:"PHONE (OPTIONAL)",prof_area:"YOUR AREA",prof_areaHint:"Sets your chat room and local restaurant list",prof_save:"SAVE CHANGES",prof_saving:"SAVING...",prof_saved:"✓ SAVED",prof_changePw:"CHANGE PASSWORD",prof_appearance:"APPEARANCE",prof_light:"Light mode",prof_dark:"Dark mode",prof_signout:"SIGN OUT",prof_appStats:"📊 APP STATS",
    up_title:"DELIVR PREMIUM",up_month:"/month",up_cancel:"Cancel anytime",up_noAds:"No ads",up_fullData:"Full community data",up_allChats:"All area chats",up_export:"Export your logs",up_upgradeNow:"UPGRADE NOW →",up_active:"✓ YOU'RE PREMIUM",up_cancelSub:"CANCEL SUBSCRIPTION",
    chk_title:"CHECK RESTAURANT",chk_nearby:"NEARBY · TAP FOR FULL STATS",chk_results:"SEARCH RESULTS",chk_search:"Search any branch — KFC, Sainsbury's…" },
  pl:{ nav_waits:"CZASY",nav_check:"SPRAWDŹ",nav_stats:"STATY",nav_chat:"CZAT",
    w_title:"CZASY OCZEKIWANIA",w_arrived:"📍 DOTARŁEM DO RESTAURACJI",w_waitingAt:"CZEKASZ W",w_pickedUp:"✓ ODEBRANE",w_gotIt:"✓ MAM — ODEBRANE",w_arrivedShort:"DOTARŁEM",w_timingNow:"● MIERZENIE",w_noData:"BRAK DANYCH",w_closed:"ZAMKNIĘTE",w_closedNow:"Teraz zamknięte",w_waitingNow:"CZEKA TERAZ",w_noOne:"Nikt teraz nie czeka",w_liveActivity:"NA ŻYWO",w_viewAll:"Zobacz wszystko ›",w_communityLive:"DANE SPOŁECZNOŚCI NA ŻYWO",w_yourData:"TWOJE DANE",w_community:"SPOŁECZNOŚĆ",w_recent:"OSTATNIE WPISY",w_tapHint:"KLIKNIJ ODEBRANE GDY MASZ ZAMÓWIENIE",w_liveNow:"na żywo",
    prof_title:"PROFIL KIEROWCY",prof_free:"PLAN DARMOWY",prof_premium:"⭐ PREMIUM",prof_goPremium:"PRZEJDŹ NA PREMIUM",prof_premiumActive:"PREMIUM AKTYWNE",prof_totalLogs:"WSZYSTKIE WPISY",prof_restaurants:"RESTAURACJE",prof_avgWait:"ŚR. CZAS",prof_rank:"RANGA",prof_noBadge:"BRAK ODZNAKI",prof_qualityLogs:"WPISY",prof_name:"NAZWA KIEROWCY",prof_phone:"TELEFON (OPCJON.)",prof_area:"TWÓJ OBSZAR",prof_areaHint:"Ustawia czat i listę lokalnych restauracji",prof_save:"ZAPISZ",prof_saving:"ZAPISYWANIE...",prof_saved:"✓ ZAPISANO",prof_changePw:"ZMIEŃ HASŁO",prof_appearance:"WYGLĄD",prof_light:"Tryb jasny",prof_dark:"Tryb ciemny",prof_signout:"WYLOGUJ",prof_appStats:"📊 STATYSTYKI",
    up_title:"DELIVR PREMIUM",up_month:"/miesiąc",up_cancel:"Anuluj w każdej chwili",up_noAds:"Bez reklam",up_fullData:"Pełne dane społeczności",up_allChats:"Wszystkie czaty",up_export:"Eksport wpisów",up_upgradeNow:"ULEPSZ TERAZ →",up_active:"✓ MASZ PREMIUM",up_cancelSub:"ANULUJ SUBSKRYPCJĘ",
    chk_title:"SPRAWDŹ RESTAURACJĘ",chk_nearby:"W POBLIŻU · DOTKNIJ PO STATYSTYKI",chk_results:"WYNIKI",chk_search:"Szukaj — KFC, Sainsbury's…" },
  ar:{ nav_waits:"الانتظار",nav_check:"تحقّق",nav_stats:"إحصاء",nav_chat:"الدردشة",
    w_title:"أوقات الانتظار",w_arrived:"📍 وصلت إلى المطعم",w_waitingAt:"تنتظر في",w_pickedUp:"✓ تم الاستلام",w_gotIt:"✓ استلمت الطلب",w_arrivedShort:"وصلت",w_timingNow:"● جارٍ القياس",w_noData:"لا بيانات بعد",w_closed:"مغلق",w_closedNow:"مغلق الآن",w_waitingNow:"ينتظر الآن",w_noOne:"لا أحد ينتظر الآن",w_liveActivity:"النشاط المباشر",w_viewAll:"عرض الكل ›",w_communityLive:"بيانات المجتمع مباشرة",w_yourData:"بياناتك",w_community:"المجتمع",w_recent:"آخر السجلات",w_tapHint:"اضغط استلام فور حصولك على الطلب",w_liveNow:"مباشر",
    prof_title:"ملف السائق",prof_free:"الخطة المجانية",prof_premium:"⭐ مميّز",prof_goPremium:"اشترك في المميّز",prof_premiumActive:"المميّز مُفعّل",prof_totalLogs:"إجمالي السجلات",prof_restaurants:"المطاعم",prof_avgWait:"متوسط الانتظار",prof_rank:"رتبة المساهم",prof_noBadge:"لا شارة بعد",prof_qualityLogs:"سجلات",prof_name:"اسم السائق",prof_phone:"الهاتف (اختياري)",prof_area:"منطقتك",prof_areaHint:"يحدّد غرفة الدردشة وقائمة المطاعم المحلية",prof_save:"حفظ التغييرات",prof_saving:"جارٍ الحفظ...",prof_saved:"✓ تم الحفظ",prof_changePw:"تغيير كلمة المرور",prof_appearance:"المظهر",prof_light:"الوضع الفاتح",prof_dark:"الوضع الداكن",prof_signout:"تسجيل الخروج",prof_appStats:"📊 إحصائيات",
    up_title:"ديليفر المميّز",up_month:"/شهر",up_cancel:"إلغاء في أي وقت",up_noAds:"بدون إعلانات",up_fullData:"بيانات المجتمع الكاملة",up_allChats:"كل غرف الدردشة",up_export:"تصدير سجلاتك",up_upgradeNow:"اشترك الآن →",up_active:"✓ أنت مميّز",up_cancelSub:"إلغاء الاشتراك",
    chk_title:"تحقّق من مطعم",chk_nearby:"قريب · اضغط للإحصائيات",chk_results:"نتائج البحث",chk_search:"ابحث عن أي فرع — KFC…" },
  hi:{ nav_waits:"इंतज़ार",nav_check:"जाँचें",nav_stats:"आँकड़े",nav_chat:"चैट",
    w_title:"रेस्टोरेंट इंतज़ार",w_arrived:"📍 रेस्टोरेंट पहुँच गया",w_waitingAt:"यहाँ इंतज़ार",w_pickedUp:"✓ पिक अप हो गया",w_gotIt:"✓ मिल गया — पिक अप",w_arrivedShort:"पहुँचे",w_timingNow:"● समय गिन रहा है",w_noData:"अभी डेटा नहीं",w_closed:"बंद",w_closedNow:"अभी बंद है",w_waitingNow:"अभी इंतज़ार",w_noOne:"अभी कोई इंतज़ार नहीं",w_liveActivity:"लाइव गतिविधि",w_viewAll:"सब देखें ›",w_communityLive:"समुदाय डेटा लाइव",w_yourData:"आपका डेटा",w_community:"समुदाय",w_recent:"हाल के लॉग",w_tapHint:"ऑर्डर मिलते ही पिक अप दबाएँ",w_liveNow:"लाइव",
    prof_title:"ड्राइवर प्रोफ़ाइल",prof_free:"फ्री प्लान",prof_premium:"⭐ प्रीमियम",prof_goPremium:"प्रीमियम लें",prof_premiumActive:"प्रीमियम चालू",prof_totalLogs:"कुल लॉग",prof_restaurants:"रेस्टोरेंट",prof_avgWait:"औसत इंतज़ार",prof_rank:"योगदान रैंक",prof_noBadge:"अभी बैज नहीं",prof_qualityLogs:"लॉग",prof_name:"ड्राइवर नाम",prof_phone:"फ़ोन (वैकल्पिक)",prof_area:"आपका क्षेत्र",prof_areaHint:"आपका चैट रूम और स्थानीय रेस्टोरेंट सेट करता है",prof_save:"सहेजें",prof_saving:"सहेजा जा रहा...",prof_saved:"✓ सहेजा गया",prof_changePw:"पासवर्ड बदलें",prof_appearance:"रूप",prof_light:"लाइट मोड",prof_dark:"डार्क मोड",prof_signout:"साइन आउट",prof_appStats:"📊 आँकड़े",
    up_title:"डेलिवर प्रीमियम",up_month:"/माह",up_cancel:"कभी भी रद्द करें",up_noAds:"कोई विज्ञापन नहीं",up_fullData:"पूरा समुदाय डेटा",up_allChats:"सभी चैट",up_export:"लॉग एक्सपोर्ट",up_upgradeNow:"अभी अपग्रेड करें →",up_active:"✓ आप प्रीमियम हैं",up_cancelSub:"सदस्यता रद्द करें",
    chk_title:"रेस्टोरेंट जाँचें",chk_nearby:"पास · आँकड़ों के लिए टैप करें",chk_results:"खोज परिणाम",chk_search:"कोई भी ब्रांच खोजें — KFC…" },
  ur:{ nav_waits:"انتظار",nav_check:"چیک",nav_stats:"شماریات",nav_chat:"چیٹ",
    w_title:"ریستوران انتظار",w_arrived:"📍 ریستوران پہنچ گیا",w_waitingAt:"یہاں انتظار",w_pickedUp:"✓ پک اپ ہو گیا",w_gotIt:"✓ مل گیا — پک اپ",w_arrivedShort:"پہنچے",w_timingNow:"● وقت گن رہا ہے",w_noData:"ابھی ڈیٹا نہیں",w_closed:"بند",w_closedNow:"ابھی بند ہے",w_waitingNow:"ابھی انتظار",w_noOne:"ابھی کوئی انتظار نہیں",w_liveActivity:"لائیو سرگرمی",w_viewAll:"سب دیکھیں ›",w_communityLive:"کمیونٹی ڈیٹا لائیو",w_yourData:"آپ کا ڈیٹا",w_community:"کمیونٹی",w_recent:"حالیہ لاگ",w_tapHint:"آرڈر ملتے ہی پک اپ دبائیں",w_liveNow:"لائیو",
    prof_title:"ڈرائیور پروفائل",prof_free:"فری پلان",prof_premium:"⭐ پریمیم",prof_goPremium:"پریمیم لیں",prof_premiumActive:"پریمیم فعال",prof_totalLogs:"کل لاگ",prof_restaurants:"ریستوران",prof_avgWait:"اوسط انتظار",prof_rank:"کنٹری بیوٹر رینک",prof_noBadge:"ابھی بیج نہیں",prof_qualityLogs:"لاگ",prof_name:"ڈرائیور نام",prof_phone:"فون (اختیاری)",prof_area:"آپ کا علاقہ",prof_areaHint:"آپ کا چیٹ روم اور مقامی ریستوران سیٹ کرتا ہے",prof_save:"محفوظ کریں",prof_saving:"محفوظ ہو رہا...",prof_saved:"✓ محفوظ",prof_changePw:"پاس ورڈ تبدیل کریں",prof_appearance:"ظاہری شکل",prof_light:"لائٹ موڈ",prof_dark:"ڈارک موڈ",prof_signout:"سائن آؤٹ",prof_appStats:"📊 شماریات",
    up_title:"ڈیلیور پریمیم",up_month:"/ماہ",up_cancel:"کسی بھی وقت منسوخ کریں",up_noAds:"کوئی اشتہار نہیں",up_fullData:"مکمل کمیونٹی ڈیٹا",up_allChats:"تمام چیٹس",up_export:"لاگ ایکسپورٹ",up_upgradeNow:"ابھی اپ گریڈ کریں →",up_active:"✓ آپ پریمیم ہیں",up_cancelSub:"سبسکرپشن منسوخ کریں",
    chk_title:"ریستوران چیک کریں",chk_nearby:"قریب · شماریات کے لیے ٹیپ کریں",chk_results:"تلاش کے نتائج",chk_search:"کوئی برانچ تلاش کریں — KFC…" },
  pt:{ nav_waits:"ESPERAS",nav_check:"VERIFICAR",nav_stats:"DADOS",nav_chat:"CHAT",
    w_title:"ESPERAS NOS RESTAURANTES",w_arrived:"📍 CHEGUEI AO RESTAURANTE",w_waitingAt:"ESPERANDO EM",w_pickedUp:"✓ PEGUEI",w_gotIt:"✓ PEGUEI — RETIRADO",w_arrivedShort:"CHEGUEI",w_timingNow:"● CRONOMETRANDO",w_noData:"SEM DADOS AINDA",w_closed:"FECHADO",w_closedNow:"Fechado agora",w_waitingNow:"ESPERANDO AGORA",w_noOne:"Ninguém esperando agora",w_liveActivity:"ATIVIDADE AO VIVO",w_viewAll:"Ver tudo ›",w_communityLive:"DADOS DA COMUNIDADE AO VIVO",w_yourData:"SEUS DADOS",w_community:"COMUNIDADE",w_recent:"REGISTROS RECENTES",w_tapHint:"TOQUE EM PEGUEI ASSIM QUE RECEBER O PEDIDO",w_liveNow:"ao vivo",
    prof_title:"PERFIL DO MOTORISTA",prof_free:"PLANO GRÁTIS",prof_premium:"⭐ PREMIUM",prof_goPremium:"OBTER PREMIUM",prof_premiumActive:"PREMIUM ATIVO",prof_totalLogs:"TOTAL DE REGISTROS",prof_restaurants:"RESTAURANTES",prof_avgWait:"ESPERA MÉDIA",prof_rank:"RANQUE",prof_noBadge:"SEM EMBLEMA AINDA",prof_qualityLogs:"REGISTROS",prof_name:"NOME DO MOTORISTA",prof_phone:"TELEFONE (OPCIONAL)",prof_area:"SUA ÁREA",prof_areaHint:"Define seu chat e lista de restaurantes locais",prof_save:"SALVAR",prof_saving:"SALVANDO...",prof_saved:"✓ SALVO",prof_changePw:"ALTERAR SENHA",prof_appearance:"APARÊNCIA",prof_light:"Modo claro",prof_dark:"Modo escuro",prof_signout:"SAIR",prof_appStats:"📊 ESTATÍSTICAS",
    up_title:"DELIVR PREMIUM",up_month:"/mês",up_cancel:"Cancele quando quiser",up_noAds:"Sem anúncios",up_fullData:"Dados completos da comunidade",up_allChats:"Todos os chats",up_export:"Exportar registros",up_upgradeNow:"ASSINAR AGORA →",up_active:"✓ VOCÊ É PREMIUM",up_cancelSub:"CANCELAR ASSINATURA",
    chk_title:"VERIFICAR RESTAURANTE",chk_nearby:"PRÓXIMOS · TOQUE PARA ESTATÍSTICAS",chk_results:"RESULTADOS",chk_search:"Buscar qualquer filial — KFC…" },
};
for(const c of Object.keys(T2)){ Object.assign(T[c],T2[c]); }
// Disclaimer screen strings
const T3 = {
  en:{ disc_title:"BEFORE YOU START", disc_btn:"I UNDERSTAND", disc_body:"WAITS does not connect to Uber Eats, Deliveroo, Just Eat or any other delivery platform. We do not access your delivery app accounts, read your notifications, modify your GPS, or interact with any platform API. We only use your device location to detect nearby restaurants and your local area. Your delivery accounts are completely safe." },
  pl:{ disc_title:"ZANIM ZACZNIESZ", disc_btn:"ROZUMIEM", disc_body:"WAITS nie łączy się z Uber Eats, Deliveroo, Just Eat ani żadną inną platformą dostawczą. Nie mamy dostępu do Twoich kont w aplikacjach dostawczych, nie czytamy Twoich powiadomień, nie zmieniamy Twojego GPS ani nie korzystamy z żadnego API platform. Używamy lokalizacji Twojego urządzenia wyłącznie do wykrywania pobliskich restauracji i Twojej okolicy. Twoje konta dostawcze są całkowicie bezpieczne." },
  ar:{ disc_title:"قبل أن تبدأ", disc_btn:"أوافق وأفهم", disc_body:"لا يتصل WAITS بـ Uber Eats أو Deliveroo أو Just Eat أو أي منصة توصيل أخرى. نحن لا نصل إلى حساباتك في تطبيقات التوصيل، ولا نقرأ إشعاراتك، ولا نعدّل نظام تحديد المواقع لديك، ولا نتفاعل مع أي واجهة برمجية لأي منصة. نستخدم موقع جهازك فقط لاكتشاف المطاعم القريبة ومنطقتك المحلية. حساباتك في تطبيقات التوصيل آمنة تماماً." },
  hi:{ disc_title:"शुरू करने से पहले", disc_btn:"मैं समझ गया", disc_body:"WAITS, Uber Eats, Deliveroo, Just Eat या किसी अन्य डिलीवरी प्लेटफ़ॉर्म से कनेक्ट नहीं होता। हम आपके डिलीवरी ऐप अकाउंट तक नहीं पहुँचते, आपकी सूचनाएँ नहीं पढ़ते, आपका GPS नहीं बदलते, और किसी प्लेटफ़ॉर्म API से इंटरैक्ट नहीं करते। हम आपके डिवाइस की लोकेशन का उपयोग केवल आस-पास के रेस्टोरेंट और आपके क्षेत्र का पता लगाने के लिए करते हैं। आपके डिलीवरी अकाउंट पूरी तरह सुरक्षित हैं।" },
  ur:{ disc_title:"شروع کرنے سے پہلے", disc_btn:"میں سمجھ گیا", disc_body:"WAITS کا Uber Eats، Deliveroo، Just Eat یا کسی اور ڈیلیوری پلیٹ فارم سے کوئی تعلق نہیں۔ ہم آپ کے ڈیلیوری ایپ اکاؤنٹس تک رسائی نہیں کرتے، آپ کی نوٹیفیکیشنز نہیں پڑھتے، آپ کا GPS تبدیل نہیں کرتے، اور کسی پلیٹ فارم API سے تعامل نہیں کرتے۔ ہم آپ کے ڈیوائس کی لوکیشن صرف قریبی ریستوران اور آپ کے مقامی علاقے کا پتہ لگانے کے لیے استعمال کرتے ہیں۔ آپ کے ڈیلیوری اکاؤنٹس مکمل طور پر محفوظ ہیں۔" },
  pt:{ disc_title:"ANTES DE COMEÇAR", disc_btn:"ENTENDI", disc_body:"O WAITS não se conecta ao Uber Eats, Deliveroo, Just Eat nem a qualquer outra plataforma de entrega. Não acessamos suas contas dos apps de entrega, não lemos suas notificações, não modificamos seu GPS e não interagimos com nenhuma API de plataforma. Usamos a localização do seu dispositivo apenas para detectar restaurantes próximos e a sua área local. Suas contas de entrega estão completamente seguras." },
};
for(const c of Object.keys(T3)){ Object.assign(T[c],T3[c]); }
// Additional languages — full set
const T4 = {
  zh:{ chooseLang:"选择您的语言",continue:"继续 →",tagline:"司机社区",next:"下一步",join:"加入社区 →",skip:"跳过",
    ob1_title:"你一直在等待。\n现在等待有回报。",ob1_body:"你在餐厅外等待的每一分钟都是数据。Delivr 把等待变成实时信息，为你和附近每位司机节省时间。",
    ob2_title:"两次点击，就这么简单。",ob2_arrive_t:"到达",ob2_arrive_d:"到达餐厅时点一下，计时自动开始。",ob2_pickup_t:"取餐",ob2_pickup_d:"拿到订单时点一下，等待即被记录。",ob2_see_t:"所有人都能看到",ob2_see_d:"附近每位司机立即看到真实等待时间。",
    ob3_title:"帮我。\n我帮你。",ob3_body:"Delivr 因司机分享而强大。你记录得越多，对所有人就越聪明。加入我们吧。",
    signin:"登录",create:"创建账户",drivername:"司机名称",email:"电子邮箱",password:"密码",confirm:"确认密码",colour:"你的颜色",forgot:"忘记密码？",signinBtn:"登录 →",createBtn:"创建账户 →",changeLang:"🌐 语言",
    nav_waits:"等待",nav_check:"查询",nav_stats:"统计",nav_chat:"聊天",
    w_title:"餐厅等待时间",w_arrived:"📍 已到达餐厅",w_waitingAt:"正在等待",w_pickedUp:"✓ 已取餐",w_gotIt:"✓ 已取餐",w_arrivedShort:"已到达",w_timingNow:"● 计时中",w_noData:"暂无数据",w_closed:"已关闭",w_closedNow:"现在已关闭",w_waitingNow:"正在等待",w_noOne:"现在无人等待",w_liveActivity:"实时动态",w_viewAll:"查看全部 ›",w_communityLive:"社区数据实时更新",w_yourData:"你的数据",w_community:"社区",w_recent:"最近的等待记录",w_tapHint:"拿到订单后立即点“已取餐”",w_liveNow:"实时",
    prof_title:"司机资料",prof_free:"免费版",prof_premium:"⭐ 高级版",prof_goPremium:"升级高级版",prof_premiumActive:"高级版已激活",prof_totalLogs:"总记录",prof_restaurants:"餐厅",prof_avgWait:"平均等待",prof_rank:"贡献等级",prof_noBadge:"暂无徽章",prof_qualityLogs:"记录",prof_name:"司机名称",prof_phone:"电话（可选）",prof_area:"你的区域",prof_areaHint:"设置你的聊天室和本地餐厅列表",prof_save:"保存",prof_saving:"保存中...",prof_saved:"✓ 已保存",prof_changePw:"修改密码",prof_appearance:"外观",prof_light:"浅色模式",prof_dark:"深色模式",prof_signout:"退出登录",prof_appStats:"📊 应用统计",
    up_title:"DELIVR 高级版",up_month:"/月",up_cancel:"随时取消",up_noAds:"无广告",up_fullData:"完整社区数据",up_allChats:"所有区域聊天",up_export:"导出你的记录",up_upgradeNow:"立即升级 →",up_active:"✓ 你是高级会员",up_cancelSub:"取消订阅",
    chk_title:"查询餐厅",chk_nearby:"附近 · 点击查看统计",chk_results:"搜索结果",chk_search:"搜索任意分店 — KFC…",
    disc_title:"开始之前",disc_btn:"我明白了",disc_body:"WAITS 不连接 Uber Eats、Deliveroo、Just Eat 或任何其他配送平台。我们不会访问你的配送应用账户、读取你的通知、修改你的 GPS，也不会与任何平台 API 交互。我们仅使用你设备的位置来检测附近的餐厅和你所在的本地区域。你的配送账户完全安全。" },
  ro:{ chooseLang:"Alege limba ta",continue:"CONTINUĂ →",tagline:"COMUNITATEA ȘOFERILOR",next:"ÎNAINTE",join:"INTRĂ ÎN COMUNITATE →",skip:"Omite",
    ob1_title:"Ai tot așteptat.\nAcum așteptarea contează.",ob1_body:"Fiecare minut de așteptare în fața restaurantului înseamnă date. Delivr transformă această așteptare în informații live care îți economisesc timp ție și fiecărui șofer din apropiere.",
    ob2_title:"Două atingeri. Atât.",ob2_arrive_t:"Ajuns",ob2_arrive_d:"Atinge o dată când ajungi la restaurant. Cronometrul pornește automat.",ob2_pickup_t:"Preluat",ob2_pickup_d:"Atinge când ai comanda. Așteptarea ta e înregistrată.",ob2_see_t:"Toți văd",ob2_see_d:"Fiecare șofer din apropiere vede instant timpul real de așteptare.",
    ob3_title:"Ajută-mă.\nTe ajut.",ob3_body:"Delivr funcționează doar pentru că șoferii împărtășesc. Cu cât înregistrezi mai mult, cu atât e mai inteligent pentru toți. Alătură-te.",
    signin:"AUTENTIFICARE",create:"CREEAZĂ CONT",drivername:"NUME ȘOFER",email:"ADRESĂ EMAIL",password:"PAROLĂ",confirm:"CONFIRMĂ PAROLA",colour:"CULOAREA TA",forgot:"Ai uitat parola?",signinBtn:"INTRĂ →",createBtn:"CREEAZĂ CONT →",changeLang:"🌐 Limbă",
    nav_waits:"AȘTEPTĂRI",nav_check:"VERIFICĂ",nav_stats:"STATS",nav_chat:"CHAT",
    w_title:"AȘTEPTĂRI RESTAURANTE",w_arrived:"📍 AM AJUNS LA RESTAURANT",w_waitingAt:"AȘTEPT LA",w_pickedUp:"✓ PRELUAT",w_gotIt:"✓ AM PRELUAT",w_arrivedShort:"AJUNS",w_timingNow:"● SE CRONOMETREAZĂ",w_noData:"ÎNCĂ FĂRĂ DATE",w_closed:"ÎNCHIS",w_closedNow:"Închis acum",w_waitingNow:"AȘTEAPTĂ ACUM",w_noOne:"Nimeni nu așteaptă acum",w_liveActivity:"ACTIVITATE LIVE",w_viewAll:"Vezi tot ›",w_communityLive:"DATE COMUNITARE LIVE",w_yourData:"DATELE TALE",w_community:"COMUNITATE",w_recent:"ÎNREGISTRĂRI RECENTE",w_tapHint:"APASĂ PRELUAT IMEDIAT CE AI COMANDA",w_liveNow:"live",
    prof_title:"PROFIL ȘOFER",prof_free:"PLAN GRATUIT",prof_premium:"⭐ PREMIUM",prof_goPremium:"TRECI LA PREMIUM",prof_premiumActive:"PREMIUM ACTIV",prof_totalLogs:"TOTAL ÎNREGISTRĂRI",prof_restaurants:"RESTAURANTE",prof_avgWait:"AȘTEPTARE MEDIE",prof_rank:"RANG",prof_noBadge:"ÎNCĂ FĂRĂ INSIGNĂ",prof_qualityLogs:"ÎNREGISTRĂRI",prof_name:"NUME ȘOFER",prof_phone:"TELEFON (OPȚIONAL)",prof_area:"ZONA TA",prof_areaHint:"Stabilește chatul și lista de restaurante locale",prof_save:"SALVEAZĂ",prof_saving:"SE SALVEAZĂ...",prof_saved:"✓ SALVAT",prof_changePw:"SCHIMBĂ PAROLA",prof_appearance:"ASPECT",prof_light:"Mod luminos",prof_dark:"Mod întunecat",prof_signout:"DECONECTARE",prof_appStats:"📊 STATISTICI",
    up_title:"DELIVR PREMIUM",up_month:"/lună",up_cancel:"Anulează oricând",up_noAds:"Fără reclame",up_fullData:"Date complete ale comunității",up_allChats:"Toate chaturile",up_export:"Exportă înregistrările",up_upgradeNow:"TRECI LA PREMIUM →",up_active:"✓ EȘTI PREMIUM",up_cancelSub:"ANULEAZĂ ABONAMENTUL",
    chk_title:"VERIFICĂ RESTAURANT",chk_nearby:"ÎN APROPIERE · APASĂ PENTRU STATISTICI",chk_results:"REZULTATE",chk_search:"Caută orice locație — KFC…",
    disc_title:"ÎNAINTE SĂ ÎNCEPI",disc_btn:"AM ÎNȚELES",disc_body:"WAITS nu se conectează la Uber Eats, Deliveroo, Just Eat sau orice altă platformă de livrare. Nu accesăm conturile tale din aplicațiile de livrare, nu îți citim notificările, nu îți modificăm GPS-ul și nu interacționăm cu niciun API de platformă. Folosim locația dispozitivului tău doar pentru a detecta restaurantele din apropiere și zona ta. Conturile tale de livrare sunt complet în siguranță." },
  es:{ chooseLang:"Elige tu idioma",continue:"CONTINUAR →",tagline:"COMUNIDAD DE CONDUCTORES",next:"SIGUIENTE",join:"UNIRME A LA COMUNIDAD →",skip:"Omitir",
    ob1_title:"Has estado esperando.\nAhora esperar vale la pena.",ob1_body:"Cada minuto que esperas fuera de un restaurante son datos. Delivr convierte esa espera en información en vivo que te ahorra tiempo a ti y a cada conductor cercano.",
    ob2_title:"Dos toques. Eso es todo.",ob2_arrive_t:"Llegada",ob2_arrive_d:"Toca una vez al llegar al restaurante. El cronómetro empieza solo.",ob2_pickup_t:"Recogida",ob2_pickup_d:"Toca cuando tengas el pedido. Tu espera queda registrada.",ob2_see_t:"Todos lo ven",ob2_see_d:"Cada conductor cercano ve al instante el tiempo real de espera.",
    ob3_title:"Ayúdame.\nYo te ayudo.",ob3_body:"Delivr solo funciona porque los conductores comparten. Cuanto más registres, más inteligente es para todos. Únete al equipo.",
    signin:"INICIAR SESIÓN",create:"CREAR CUENTA",drivername:"NOMBRE DEL CONDUCTOR",email:"CORREO ELECTRÓNICO",password:"CONTRASEÑA",confirm:"CONFIRMAR CONTRASEÑA",colour:"TU COLOR",forgot:"¿Olvidaste tu contraseña?",signinBtn:"INICIAR SESIÓN →",createBtn:"CREAR CUENTA →",changeLang:"🌐 Idioma",
    nav_waits:"ESPERAS",nav_check:"CONSULTAR",nav_stats:"DATOS",nav_chat:"CHAT",
    w_title:"ESPERAS EN RESTAURANTES",w_arrived:"📍 LLEGUÉ AL RESTAURANTE",w_waitingAt:"ESPERANDO EN",w_pickedUp:"✓ RECOGIDO",w_gotIt:"✓ YA LO TENGO",w_arrivedShort:"LLEGUÉ",w_timingNow:"● CRONOMETRANDO",w_noData:"SIN DATOS AÚN",w_closed:"CERRADO",w_closedNow:"Cerrado ahora",w_waitingNow:"ESPERANDO AHORA",w_noOne:"Nadie esperando ahora",w_liveActivity:"ACTIVIDAD EN VIVO",w_viewAll:"Ver todo ›",w_communityLive:"DATOS DE LA COMUNIDAD EN VIVO",w_yourData:"TUS DATOS",w_community:"COMUNIDAD",w_recent:"REGISTROS RECIENTES",w_tapHint:"TOCA RECOGIDO EN CUANTO TENGAS EL PEDIDO",w_liveNow:"en vivo",
    prof_title:"PERFIL DEL CONDUCTOR",prof_free:"PLAN GRATIS",prof_premium:"⭐ PREMIUM",prof_goPremium:"OBTENER PREMIUM",prof_premiumActive:"PREMIUM ACTIVO",prof_totalLogs:"TOTAL DE REGISTROS",prof_restaurants:"RESTAURANTES",prof_avgWait:"ESPERA MEDIA",prof_rank:"RANGO",prof_noBadge:"SIN INSIGNIA AÚN",prof_qualityLogs:"REGISTROS",prof_name:"NOMBRE DEL CONDUCTOR",prof_phone:"TELÉFONO (OPCIONAL)",prof_area:"TU ZONA",prof_areaHint:"Define tu chat y lista de restaurantes locales",prof_save:"GUARDAR",prof_saving:"GUARDANDO...",prof_saved:"✓ GUARDADO",prof_changePw:"CAMBIAR CONTRASEÑA",prof_appearance:"APARIENCIA",prof_light:"Modo claro",prof_dark:"Modo oscuro",prof_signout:"CERRAR SESIÓN",prof_appStats:"📊 ESTADÍSTICAS",
    up_title:"DELIVR PREMIUM",up_month:"/mes",up_cancel:"Cancela cuando quieras",up_noAds:"Sin anuncios",up_fullData:"Datos completos de la comunidad",up_allChats:"Todos los chats",up_export:"Exporta tus registros",up_upgradeNow:"MEJORAR AHORA →",up_active:"✓ ERES PREMIUM",up_cancelSub:"CANCELAR SUSCRIPCIÓN",
    chk_title:"CONSULTAR RESTAURANTE",chk_nearby:"CERCA · TOCA PARA VER ESTADÍSTICAS",chk_results:"RESULTADOS",chk_search:"Busca cualquier sucursal — KFC…",
    disc_title:"ANTES DE EMPEZAR",disc_btn:"ENTIENDO",disc_body:"WAITS no se conecta a Uber Eats, Deliveroo, Just Eat ni a ninguna otra plataforma de reparto. No accedemos a tus cuentas de las apps de reparto, no leemos tus notificaciones, no modificamos tu GPS ni interactuamos con ninguna API de plataforma. Solo usamos la ubicación de tu dispositivo para detectar restaurantes cercanos y tu zona local. Tus cuentas de reparto están completamente seguras." },
  ru:{ chooseLang:"Выберите язык",continue:"ПРОДОЛЖИТЬ →",tagline:"СООБЩЕСТВО ВОДИТЕЛЕЙ",next:"ДАЛЕЕ",join:"ПРИСОЕДИНИТЬСЯ →",skip:"Пропустить",
    ob1_title:"Вы ждали.\nТеперь ожидание окупается.",ob1_body:"Каждая минута ожидания у ресторана — это данные. Delivr превращает ожидание в живую информацию, экономящую время вам и каждому водителю рядом.",
    ob2_title:"Два нажатия. Вот и всё.",ob2_arrive_t:"Прибытие",ob2_arrive_d:"Нажмите один раз по приезде в ресторан. Таймер запустится сам.",ob2_pickup_t:"Забрал",ob2_pickup_d:"Нажмите, когда получите заказ. Ваше ожидание записано.",ob2_see_t:"Все видят",ob2_see_d:"Каждый водитель рядом сразу видит реальное время ожидания.",
    ob3_title:"Помоги мне.\nЯ помогу тебе.",ob3_body:"Delivr работает только потому, что водители делятся. Чем больше вы записываете, тем умнее он для всех. Присоединяйтесь.",
    signin:"ВОЙТИ",create:"СОЗДАТЬ АККАУНТ",drivername:"ИМЯ ВОДИТЕЛЯ",email:"ЭЛ. ПОЧТА",password:"ПАРОЛЬ",confirm:"ПОДТВЕРДИТЕ ПАРОЛЬ",colour:"ВАШ ЦВЕТ",forgot:"Забыли пароль?",signinBtn:"ВОЙТИ →",createBtn:"СОЗДАТЬ АККАУНТ →",changeLang:"🌐 Язык",
    nav_waits:"ОЖИДАНИЕ",nav_check:"ПРОВЕРКА",nav_stats:"СТАТЫ",nav_chat:"ЧАТ",
    w_title:"ОЖИДАНИЕ В РЕСТОРАНАХ",w_arrived:"📍 Я В РЕСТОРАНЕ",w_waitingAt:"ОЖИДАНИЕ В",w_pickedUp:"✓ ЗАБРАЛ",w_gotIt:"✓ ЗАБРАЛ ЗАКАЗ",w_arrivedShort:"ПРИБЫЛ",w_timingNow:"● ИДЁТ ОТСЧЁТ",w_noData:"ПОКА НЕТ ДАННЫХ",w_closed:"ЗАКРЫТО",w_closedNow:"Сейчас закрыто",w_waitingNow:"СЕЙЧАС ЖДУТ",w_noOne:"Сейчас никто не ждёт",w_liveActivity:"ЖИВАЯ ЛЕНТА",w_viewAll:"Показать всё ›",w_communityLive:"ДАННЫЕ СООБЩЕСТВА В ЭФИРЕ",w_yourData:"ВАШИ ДАННЫЕ",w_community:"СООБЩЕСТВО",w_recent:"ПОСЛЕДНИЕ ЗАПИСИ",w_tapHint:"НАЖМИТЕ «ЗАБРАЛ», КАК ТОЛЬКО ПОЛУЧИТЕ ЗАКАЗ",w_liveNow:"в эфире",
    prof_title:"ПРОФИЛЬ ВОДИТЕЛЯ",prof_free:"БЕСПЛАТНО",prof_premium:"⭐ ПРЕМИУМ",prof_goPremium:"ПЕРЕЙТИ НА ПРЕМИУМ",prof_premiumActive:"ПРЕМИУМ АКТИВЕН",prof_totalLogs:"ВСЕГО ЗАПИСЕЙ",prof_restaurants:"РЕСТОРАНЫ",prof_avgWait:"СРЕДНЕЕ ОЖИДАНИЕ",prof_rank:"РАНГ",prof_noBadge:"ПОКА НЕТ ЗНАЧКА",prof_qualityLogs:"ЗАПИСИ",prof_name:"ИМЯ ВОДИТЕЛЯ",prof_phone:"ТЕЛЕФОН (НЕОБЯЗ.)",prof_area:"ВАШ РАЙОН",prof_areaHint:"Задаёт ваш чат и список местных ресторанов",prof_save:"СОХРАНИТЬ",prof_saving:"СОХРАНЕНИЕ...",prof_saved:"✓ СОХРАНЕНО",prof_changePw:"СМЕНИТЬ ПАРОЛЬ",prof_appearance:"ВНЕШНИЙ ВИД",prof_light:"Светлая тема",prof_dark:"Тёмная тема",prof_signout:"ВЫЙТИ",prof_appStats:"📊 СТАТИСТИКА",
    up_title:"DELIVR ПРЕМИУМ",up_month:"/мес",up_cancel:"Отмена в любое время",up_noAds:"Без рекламы",up_fullData:"Полные данные сообщества",up_allChats:"Все чаты районов",up_export:"Экспорт записей",up_upgradeNow:"ОФОРМИТЬ →",up_active:"✓ У ВАС ПРЕМИУМ",up_cancelSub:"ОТМЕНИТЬ ПОДПИСКУ",
    chk_title:"ПРОВЕРИТЬ РЕСТОРАН",chk_nearby:"РЯДОМ · НАЖМИТЕ ДЛЯ СТАТИСТИКИ",chk_results:"РЕЗУЛЬТАТЫ",chk_search:"Искать любой филиал — KFC…",
    disc_title:"ПЕРЕД НАЧАЛОМ",disc_btn:"Я ПОНИМАЮ",disc_body:"WAITS не подключается к Uber Eats, Deliveroo, Just Eat или любой другой платформе доставки. Мы не получаем доступ к вашим аккаунтам в приложениях доставки, не читаем уведомления, не изменяем ваш GPS и не взаимодействуем с API каких-либо платформ. Мы используем местоположение вашего устройства только для определения ближайших ресторанов и вашего района. Ваши аккаунты доставки полностью в безопасности." },
};
for(const c of Object.keys(T4)){ T[c]=Object.assign({},T.en,T4[c]); }   // base on English so any missing key falls back
let _lang="en";                                   // current language (set by App on render)
const tr = (lang,key) => (T[lang]&&T[lang][key])||T.en[key]||key;
const t  = key => (T[_lang]&&T[_lang][key])||T.en[key]||key;

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

// ── Earnings tracker (ARRIVED flow only) ──────────────────────────────────────
// Optional per-order payout logging. The "session clock" starts at the very first
// ARRIVED of a shift; the live £/hour rate = earnings so far ÷ time since that first
// ARRIVED, so it drops every second the driver waits. All data is personal (stored
// under users/{uid}/earnings) and never mixed with other drivers.
const PLATFORMS = ["Uber Eats", "Just Eat", "Deliveroo"];
const SESSION_GAP_MS = 60 * 60 * 1000;   // >1h with no ARRIVED → the driver stopped working; next ARRIVED begins a fresh session
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function parsePayout(v) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
// Driver-reported queue size (whole number, sane range). Empty/garbage → null.
function parseCount(v) {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
}
const REPORTED_COUNT_TTL_MS = 20 * 60 * 1000;   // a reported queue count goes stale after 20 min
const QUEUE_ALERT_TTL_MS = 20 * 60 * 1000;        // a long-queue alert auto-disappears after 20 min
const QUEUE_ALERT_COOLDOWN_MS = 10 * 60 * 1000;   // a driver can alert a given restaurant once per 10 min
// A payout banks against its full ARRIVED→next-ARRIVED window. When that next ARRIVED
// never comes (last order of a shift) we estimate the delivery leg with this many minutes.
const DEFAULT_DELIVERY_MINS = 12;
// Multi-delivery guard: two ARRIVED presses <10 min apart are a quick/stacked pickup, not a
// full earning window. We don't attribute that tiny gap to £/hour (it would inflate the rate);
// instead we fall back to the estimated delivery leg.
const MIN_CYCLE_GAP_MINS = 10;
function fmtGBP(n) { return "£" + (Math.round((n || 0) * 100) / 100).toFixed(2); }
function fmtRate(r) { return r == null ? "—" : "£" + (Math.round(r * 10) / 10).toFixed(1) + "/hr"; }

// Compute every personal statistic from this driver's own earnings entries.
// Each order's £/hour is measured against its real ARRIVED→next-ARRIVED window
// (cycleMins) — i.e. wait + drive + deliver — not just the time spent at the counter,
// so the rates reflect what the driver actually earns per working hour.
// periodStartMs clamps each session's start to the start of the view (e.g. midnight for TODAY),
// so a session that began before the period can't drag pre-period time into its £/hour.
function computeEarningsStats(entries, periodStartMs = 0) {
  if (!entries || !entries.length) return null;
  const orders = entries.filter(e => !e.bulk);   // per-delivery entries (drive £/hour + order stats)
  const enriched = [];
  let orderEarnings = 0, totalHours = 0, totalTips = 0, totalBase = 0;
  let bestOrder = null, worstWait = null;   // single-order extremes (highest payout / longest wait)
  for (const e of orders) {
    const base = Number(e.payout) || 0;
    const tip = Number(e.tip) || 0;
    const payout = base + tip;   // tip is part of the order's total earnings
    // Real window if recorded; otherwise estimate (wait + a delivery leg) for older/edge logs.
    const cycleMins = Number(e.cycleMins) > 0 ? Number(e.cycleMins) : (e.waitMins || 0) + DEFAULT_DELIVERY_MINS;
    const attrH = cycleMins / 60;
    orderEarnings += payout;
    totalTips += tip;
    totalBase += base;
    totalHours += attrH;
    if (!bestOrder || payout > bestOrder.payout) bestOrder = { name: e.restaurantName || "Order", payout, platform: e.platform || null };
    const w = e.waitMins || 0;
    if (!worstWait || w > worstWait.waitMins) worstWait = { name: e.restaurantName || "Restaurant", waitMins: w };
    enriched.push({ ...e, payout, attrH });
  }
  // Platform bulk totals (a lump £ logged for a whole platform). They add to total earnings and
  // the platform/day totals, but carry NO time, so they never affect £/hour or order counts.
  let bulkTotal = 0; const bulkByPlat = {}; const bulkByDow = {};
  for (const e of entries) {
    if (!e.bulk) continue;
    const amt = (Number(e.payout) || 0) + (Number(e.tip) || 0);
    bulkTotal += amt; totalBase += Number(e.payout) || 0; totalTips += Number(e.tip) || 0;
    const p = e.platform || "Other"; bulkByPlat[p] = (bulkByPlat[p] || 0) + amt;
    const d = e.dow ?? new Date(e.ts).getDay(); bulkByDow[d] = (bulkByDow[d] || 0) + amt;
  }
  const totalEarnings = orderEarnings + bulkTotal;
  // Headline £/hour uses the whole WORKING TIME per session: first ARRIVED → last DELIVERED,
  // so all the driving/waiting between deliveries counts — not just summed per-order windows.
  // Legacy/manual entries (no session timestamps) fall back to their own per-order time.
  const sessGroups = {};
  for (const e of enriched) {
    const sid = e.sessionId || ("__solo_" + (e.id || e.ts));
    const g = sessGroups[sid] || (sessGroups[sid] = { start: null, end: null, solo: 0 });
    g.solo += e.attrH;
    const st = e.sessionStart ? Math.max(new Date(e.sessionStart).getTime(), periodStartMs) : null;
    const en = e.deliveredAt ? new Date(e.deliveredAt).getTime() : null;
    if (st != null) g.start = g.start == null ? st : Math.min(g.start, st);
    if (en != null) g.end = g.end == null ? en : Math.max(g.end, en);
  }
  let sessionHours = 0;
  for (const g of Object.values(sessGroups)) {
    const span = (g.start != null && g.end != null && g.end > g.start) ? (g.end - g.start) / 3600000 : null;
    sessionHours += (span != null && span > 0) ? span : g.solo;
  }
  const workHours = sessionHours > 0 ? sessionHours : totalHours;
  totalHours = workHours;   // "TIME" card + headline rate both reflect real working time
  const overallRate = totalHours > 0 ? orderEarnings / totalHours : null;   // bulk lump sums excluded from £/hour

  const plat = {};
  for (const e of enriched) {
    const p = e.platform || "Other";
    (plat[p] = plat[p] || { sum: 0, hrs: 0, n: 0, total: 0 });
    plat[p].sum += e.payout; plat[p].hrs += e.attrH; plat[p].n += 1; plat[p].total += e.payout;
  }
  for (const [p, amt] of Object.entries(bulkByPlat)) {   // bulk adds to a platform's displayed total only
    (plat[p] = plat[p] || { sum: 0, hrs: 0, n: 0, total: 0 });
    plat[p].total += amt;
  }
  let bestPlatRate = null, bestPlatAvg = null, bestPlatTotal = null;
  for (const [p, v] of Object.entries(plat)) {
    const rate = v.hrs > 0 ? v.sum / v.hrs : null;
    const avg  = v.n   > 0 ? v.sum / v.n   : null;
    if (rate != null && (!bestPlatRate || rate > bestPlatRate.rate)) bestPlatRate = { platform: p, rate, n: v.n };
    if (avg  != null && (!bestPlatAvg  || avg  > bestPlatAvg.avg))   bestPlatAvg  = { platform: p, avg,  n: v.n };
    if (!bestPlatTotal || v.total > bestPlatTotal.sum) bestPlatTotal = { platform: p, sum: v.total, rate, n: v.n };
  }

  const rest = {};
  for (const e of enriched) {
    const k = e.restaurantId || e.restaurantName || "?";
    (rest[k] = rest[k] || { name: e.restaurantName || k, wait: 0, n: 0 });
    rest[k].wait += (e.waitMins || 0); rest[k].n += 1;
    if (e.restaurantName) rest[k].name = e.restaurantName;
  }
  let quickest = null, costliest = null;
  for (const v of Object.values(rest)) {
    const avgW = v.n > 0 ? v.wait / v.n : null;
    if (avgW == null) continue;
    if (!quickest  || avgW < quickest.avgW)  quickest  = { name: v.name, avgW, n: v.n };
    if (!costliest || avgW > costliest.avgW) costliest = { name: v.name, avgW, n: v.n };
  }

  const dow = {};
  for (const e of enriched) {
    const d = e.dow ?? new Date(e.ts).getDay();
    (dow[d] = dow[d] || { sum: 0, hrs: 0, n: 0 });
    dow[d].sum += e.payout; dow[d].hrs += e.attrH; dow[d].n += 1;
  }
  const dayTotal = d => (dow[d] ? dow[d].sum : 0) + (bulkByDow[d] || 0);
  let bestDay = null, bestDayTotal = null;
  for (const [d, v] of Object.entries(dow)) {
    const rate = v.hrs > 0 ? v.sum / v.hrs : null;
    if (rate != null && (!bestDay || rate > bestDay.rate)) bestDay = { dow: Number(d), rate, n: v.n };
  }
  for (const d of new Set([...Object.keys(dow), ...Object.keys(bulkByDow)])) {
    const tot = dayTotal(d);
    if (tot > 0 && (!bestDayTotal || tot > bestDayTotal.sum)) bestDayTotal = { dow: Number(d), sum: tot, n: dow[d] ? dow[d].n : 0 };
  }
  // Mon→Sun earnings totals (incl. bulk), for the weekly bar chart
  const byDay = [1, 2, 3, 4, 5, 6, 0].map(d => ({ dow: d, sum: dayTotal(d) }));

  const per = {};
  for (const e of enriched) {
    const p = e.period || timePeriod(e.hour ?? new Date(e.ts).getHours());
    (per[p] = per[p] || { sum: 0, hrs: 0, n: 0 });
    per[p].sum += e.payout; per[p].hrs += e.attrH; per[p].n += 1;
  }
  let bestPeriod = null;
  for (const [p, v] of Object.entries(per)) {
    const rate = v.hrs > 0 ? v.sum / v.hrs : null;
    if (rate != null && (!bestPeriod || rate > bestPeriod.rate)) bestPeriod = { period: p, rate, n: v.n };
  }

  return {
    totalEarnings, totalBase, totalTips, overallRate, totalOrders: enriched.length, totalHours,
    bestPlatRate, bestPlatAvg, bestPlatTotal, quickest, costliest,
    bestDay, bestDayTotal, bestPeriod, bestOrder, worstWait, byDay,
    platforms: Object.entries(plat).map(([name, v]) => ({
      name, n: v.n, avg: v.n > 0 ? v.sum / v.n : 0, rate: v.hrs > 0 ? v.sum / v.hrs : null, total: v.total,
    })).sort((a, b) => b.total - a.total),
  };
}

// Local-time day/week boundaries, so the daily view resets at midnight and the weekly
// summary always runs Monday → Sunday in the driver's own timezone.
function startOfDayMs(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function startOfWeekMs(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(0, 0, 0, 0); return x.getTime(); }

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

// Fetch nearby restaurants from the Mapbox Search Box category endpoint (driver's GPS position).
// Mapbox: 50k free requests/month. No Google.
async function fetchNearbyRestaurants(lat,lng) {
  if(!MAPBOX_TOKEN||lat==null||lng==null)return[];
  try{
    const res=await fetch(`https://api.mapbox.com/search/searchbox/v1/category/restaurant?proximity=${lng},${lat}&limit=25&access_token=${MAPBOX_TOKEN}`);
    const g=await res.json();
    if(!g.features?.length)return[];
    return g.features.map(f=>{
      const p=f.properties||{};
      const cats=[...(p.poi_category_ids||[]),p.maki].filter(Boolean);
      const ct=cats.join(" ").toLowerCase();
      let baseWait=10,rel=0.70,label="Variable";
      if(/fast_food|burger|sandwich|takeaway|chicken|kebab/.test(ct)){baseWait=5;rel=0.80;label="Usually fast";}
      else if(/cafe|coffee|bakery/.test(ct)){baseWait=4;rel=0.85;label="Quick grab";}
      else if(/pizza/.test(ct)){baseWait=10;rel=0.68;label="Variable";}
      else if(/grocery|supermarket|convenience/.test(ct)){baseWait=5;rel=0.82;label="Usually quick";}
      const lngv=p.coordinates?.longitude??f.geometry?.coordinates?.[0];
      const latv=p.coordinates?.latitude??f.geometry?.coordinates?.[1];
      return{id:p.mapbox_id||f.id,name:p.name||"Unknown",branchLat:latv,branchLng:lngv,baseWait,rel,label,openNow:undefined,cats};
    });
  }catch(e){return[];}
}

// Single-restaurant geocode via the Mapbox Search Box forward endpoint → {lat,lng}. No Google.
async function geocodeBranch(lat,lng,name) {
  if(!MAPBOX_TOKEN||!name)return null;
  try{
    let url=`https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(name)}&limit=1&access_token=${MAPBOX_TOKEN}`;
    if(lat!=null&&lng!=null)url+=`&proximity=${lng},${lat}`;
    const res=await fetch(url);
    const g=await res.json();
    const f=g.features?.[0];
    if(!f)return null;
    const p=f.properties||{};
    const lngv=p.coordinates?.longitude??f.geometry?.coordinates?.[0];
    const latv=p.coordinates?.latitude??f.geometry?.coordinates?.[1];
    return latv!=null?{lat:latv,lng:lngv}:null;
  }catch(e){return null;}
}

// Search restaurants by name — used in the picker so drivers can find any restaurant anywhere.
// Mapbox Search Box only (no Google). Mapbox carries no opening hours, so openNow stays unknown.
async function searchRestaurants(query,lat,lng) {
  if(!query||query.trim().length<2||!MAPBOX_TOKEN)return[];
  try{
    let url=`https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(query.trim())}&limit=10&access_token=${MAPBOX_TOKEN}`;
    if(lat!=null&&lng!=null)url+=`&proximity=${lng},${lat}`;
    const res=await fetch(url);
    const g=await res.json();
    if(!g.features?.length)return[];
    const pois=g.features.filter(f=>f.properties?.feature_type==="poi");
    return (pois.length?pois:g.features).map(f=>{
      const p=f.properties||{};
      const lngv=p.coordinates?.longitude??f.geometry?.coordinates?.[0];
      const latv=p.coordinates?.latitude??f.geometry?.coordinates?.[1];
      return{
        id:p.mapbox_id||f.id||(p.name+":"+lngv+","+latv),
        name:p.name||"Unknown",
        address:p.full_address||p.place_formatted||"",
        branchLat:latv,branchLng:lngv,
        openNow:undefined,   // no Google-equivalent hours from Mapbox
        cats:[...(p.poi_category_ids||[]),p.maki].filter(Boolean),   // for food-first ranking
        baseWait:10,rel:0.70,label:"",
      };
    });
  }catch(e){console.error("searchRestaurants (mapbox) error:",e);return[];}
}

// Rank search results: real food places / restaurants first, then nearest by GPS. Used by
// both the ARRIVED picker and the CHECK search so a driver sees relevant nearby branches first.
const FOOD_HINTS=["restaurant","food","cafe","coffee","bakery","bar","meal_takeaway","meal_delivery","fast_food","ice_cream","sandwich","pizza","deli","diner","steak","sushi","burger","chicken","grocery","supermarket","convenience"];
function isFoodResult(r){
  const t=(r.cats||[]).join(" ").toLowerCase();
  return FOOD_HINTS.some(h=>t.includes(h));
}
function rankResults(list,gps){
  const hasGps=gps&&gps.status==="active"&&gps.lat!=null;
  const withDist=list.map(r=>{
    const lat=r.branchLat??r.lat,lng=r.branchLng??r.lng;
    const dist=hasGps&&lat!=null?distMeters(gps.lat,gps.lng,lat,lng):null;
    return{...r,dist};
  });
  return withDist.sort((a,b)=>{
    const fa=isFoodResult(a),fb=isFoodResult(b);
    if(fa!==fb)return fa?-1:1;                              // food / restaurants first
    if(a.dist!=null&&b.dist!=null)return a.dist-b.dist;     // then nearest
    if(a.dist!=null)return -1; if(b.dist!=null)return 1;
    return 0;
  });
}

// Reverse-geocode the driver's GPS to their town/area (used to verify physical presence for
// area join). Mapbox reverse geocode (place type). No Google.
async function reverseGeocodeArea(lat,lng){
  if(!MAPBOX_TOKEN||lat==null||lng==null)return null;
  try{
    const res=await fetch(`https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&types=place&access_token=${MAPBOX_TOKEN}`);
    const g=await res.json();
    return g.features?.[0]?.properties?.name||null;
  }catch(e){console.error("reverseGeocodeArea error:",e);return null;}
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
        <div style={{fontSize:8,...M,fontWeight:700,color:"#ff5a2d",letterSpacing:1}}>{"⏱ "+t("w_waitingAt")}</div>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
          <span style={{...B,fontSize:15,color:"var(--ink)",letterSpacing:0.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{restaurantName}</span>
          <MiniTimer startedAt={startedAt}/>
        </div>
      </div>
      <button onClick={onPickedUp} style={{flexShrink:0,background:"#06c167",border:"none",borderRadius:10,...B,fontWeight:700,fontSize:12,letterSpacing:0.5,color:"#fff",padding:"9px 11px",cursor:"pointer"}}>{t("w_gotIt")}</button>
    </div>
  );
}

// Live earnings strip shown under the wait timer. Re-renders every second so the
// £/hour rate keeps dropping while the driver waits (earnings ÷ time since the
// session's first ARRIVED). Only appears once the driver is using the tracker.
function EarningsLive({session,pendingPayout,pendingPlatform}) {
  const [,tick]=useState(0);
  useEffect(()=>{const id=setInterval(()=>tick(x=>x+1),1000);return ()=>clearInterval(id);},[]);
  if(!session)return null;
  const earned=session.totalEarnings||0;
  const hasPending=pendingPayout!=null;
  if(earned<=0&&!hasPending)return null;
  const elapsedH=Math.max(0,(Date.now()-new Date(session.sessionStart).getTime())/3600000);
  const rate=earned>0&&elapsedH>0?earned/elapsedH:null;
  return(
    <div style={{background:"var(--card)",border:"1px solid #06c16744",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:8,color:"var(--muted2)",letterSpacing:2,marginBottom:2}}>SESSION EARNINGS</div>
          <div style={{...B,fontSize:22,color:"#06c167",letterSpacing:1}}>{fmtGBP(earned)}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:8,color:"var(--muted2)",letterSpacing:2,marginBottom:2}}>LIVE RATE</div>
          <div style={{...B,fontSize:22,color:rate==null?"var(--faint2)":rate>=12?"#06c167":rate>=8?"#f5a623":"#ff5a2d",letterSpacing:1,fontVariantNumeric:"tabular-nums"}}>{fmtRate(rate)}</div>
        </div>
      </div>
      {hasPending&&(
        <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid var(--border)",fontSize:10,...M,color:"var(--muted)"}}>
          {fmtGBP(pendingPayout)} pending{pendingPlatform?" · "+pendingPlatform:""} — counts when you mark it delivered
        </div>
      )}
    </div>
  );
}

// Optional popup after ARRIVED: pick the platform + type this order's payout in £.
// Fully skippable — skipping just starts the wait as normal with no earnings logged.
function EarningsPopup({restaurantName,onSave,onSkip}) {
  const [platform,setPlatform]=useState(null);
  const [amount,setAmount]=useState("");
  const [drivers,setDrivers]=useState("");
  const amt=parsePayout(amount);
  const cnt=parseCount(drivers);
  const earningsReady=amt!=null&&!!platform;
  const canSave=earningsReady||cnt!=null;
  return(
    <div onClick={onSkip} style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:18,padding:"20px",boxShadow:"0 12px 40px rgba(0,0,0,0.4)",width:"100%",maxWidth:380}}>
        <div style={{...B,fontSize:18,color:"#00b8a9",letterSpacing:1,marginBottom:2}}>💰 LOG THIS ORDER</div>
        <div style={{fontSize:11,...M,color:"var(--muted)",marginBottom:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{restaurantName||"Restaurant"} · optional</div>

        <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>WHICH PLATFORM?</div>
        <div style={{display:"flex",gap:8,marginBottom:18}}>
          {PLATFORMS.map(p=>{
            const active=platform===p;
            return(
              <button key={p} onClick={()=>setPlatform(p)}
                style={{flex:1,background:active?"#00b8a9":"var(--border3)",border:"1px solid "+(active?"#00b8a9":"var(--border)"),borderRadius:10,padding:"12px 6px",cursor:"pointer",...B,fontSize:12,letterSpacing:0.5,color:active?"#000":"var(--ink)"}}>
                {p}
              </button>
            );
          })}
        </div>

        <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>PAYOUT FOR THIS ORDER</div>
        <div style={{position:"relative",marginBottom:18}}>
          <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",...B,fontSize:20,color:"var(--muted)"}}>£</span>
          <input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus
            style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px 14px 34px",color:"var(--ink)",fontSize:20,...B,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
        </div>

        <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>DRIVERS WAITING HERE NOW?</div>
        <div style={{position:"relative",marginBottom:6}}>
          <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",fontSize:18}}>👥</span>
          <input value={drivers} onChange={e=>setDrivers(e.target.value)} inputMode="numeric" placeholder="e.g. 4"
            style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px 14px 44px",color:"var(--ink)",fontSize:20,...B,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
        </div>
        <div style={{fontSize:9,...M,color:"var(--faint)",marginBottom:18}}>Shared live with nearby drivers · expires in 20 min</div>

        <div style={{display:"flex",gap:10}}>
          <button onClick={onSkip} style={{flex:1,minHeight:52,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:15,letterSpacing:2,color:"var(--muted2)",cursor:"pointer"}}>SKIP</button>
          <button onClick={()=>canSave&&onSave({platform:earningsReady?platform:null,payout:earningsReady?amt:null,count:cnt})} disabled={!canSave}
            style={{flex:1.4,minHeight:52,background:canSave?"#06c167":"var(--border)",border:"none",borderRadius:12,...B,fontSize:16,letterSpacing:2,color:canSave?"#000":"var(--faint)",cursor:canSave?"pointer":"default"}}>SAVE</button>
        </div>
      </div>
    </div>
  );
}

// Shown after a delivery is marked DELIVERED. Optional cash tip (free text £) added to that
// order's total payout; kept separate from base pay in statistics. Dismissing = no tip.
function TipPopup({restaurantName,onConfirm}) {
  const [amount,setAmount]=useState("");
  const num=v=>{const n=parseFloat(String(v).replace(/[^0-9.]/g,""));return Number.isFinite(n)&&n>0?Math.round(n*100)/100:0;};
  return(
    <div onClick={()=>onConfirm(0)} style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:18,padding:"20px",boxShadow:"0 12px 40px rgba(0,0,0,0.4)",width:"100%",maxWidth:380}}>
        <div style={{...B,fontSize:18,color:"#06c167",letterSpacing:1,marginBottom:2}}>💵 ADD A CASH TIP?</div>
        <div style={{fontSize:11,...M,color:"var(--muted)",marginBottom:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{restaurantName||"Order"} · optional</div>
        <div style={{position:"relative",marginBottom:18}}>
          <span style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",...B,fontSize:20,color:"var(--muted)"}}>£</span>
          <input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" autoFocus
            style={{width:"100%",background:"var(--bg)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px 14px 34px",color:"var(--ink)",fontSize:20,...B,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#06c167"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>onConfirm(0)} style={{flex:1,minHeight:52,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:15,letterSpacing:1,color:"var(--muted2)",cursor:"pointer"}}>NO TIP</button>
          <button onClick={()=>onConfirm(num(amount))} style={{flex:1.4,minHeight:52,background:"#06c167",border:"none",borderRadius:12,...B,fontSize:16,letterSpacing:1,color:"#fff",cursor:"pointer"}}>ADD TIP</button>
        </div>
      </div>
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
    {icon:"🚫",title:t("up_noAds"),desc:"Clean, distraction-free experience"},
    {icon:"📊",title:t("up_fullData"),desc:"See every driver's logs & full history"},
    {icon:"💬",title:t("up_allChats"),desc:"Access driver chat in any town, not just yours"},
    {icon:"📁",title:t("up_export"),desc:"Download your wait history as CSV"},
  ];
  return(
    <div style={{padding:"20px 16px 120px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
        <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:2}}>{t("up_title")}</div>
      </div>

      <div style={{textAlign:"center",marginBottom:28}}>
        <div style={{fontSize:52,marginBottom:8}}>⭐</div>
        <div style={{...B,fontSize:48,color:"#00b8a9",letterSpacing:1,lineHeight:1}}>{SUB_PRICE}<span style={{fontSize:18,color:"var(--muted)"}}>{t("up_month")}</span></div>
        <div style={{fontSize:11,...M,color:"var(--muted)",marginTop:6}}>{t("up_cancel")}</div>
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
            <div style={{...B,fontSize:22,color:"#06c167",letterSpacing:2}}>{t("up_active")}</div>
            <div style={{fontSize:10,...M,color:"#0a8f4f",marginTop:4}}>Thanks for supporting Delivr</div>
          </div>
          <button onClick={onCancel}
            style={{width:"100%",minHeight:48,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:16,letterSpacing:2,color:"var(--muted2)",cursor:"pointer"}}>
            {t("up_cancelSub")}
          </button>
        </>
      ):(
        <button onClick={onSubscribe}
          style={{width:"100%",minHeight:64,background:"#00b8a9",border:"none",borderRadius:14,...B,fontSize:24,letterSpacing:3,color:"#000",cursor:"pointer",boxShadow:"0 0 40px #00b8a940"}}>
          {t("up_upgradeNow")}
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
function ProfileScreen({user,waitLog,gps,premium,theme,onToggleTheme,onBack,onLogout,onSave,onUpgrade,onStats,contribCount,lang,onSetLang}) {
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
    await onSave({name:name.trim()||user.name,phone:phone.trim()});  // area is GPS-only, joined separately
    setSaving(false);setSaved(true);
    setTimeout(()=>setSaved(false),3000);
  }

  // Join an area ONLY by physical GPS presence — no manual typing
  const [joining,setJoining]=useState(false);
  const [joinErr,setJoinErr]=useState("");
  const [langPicker,setLangPicker]=useState(false);
  async function joinArea(){
    setJoinErr("");
    if(gps.status!=="active"||gps.lat==null){ setJoinErr("Location needed — enable GPS to join your area"); return; }
    setJoining(true);
    // Cached area assignment: only re-geocode via Google if the driver has moved >1km
    // from where their area was last detected.
    const last=store.get("delivr_areaPos");
    const a=(last&&last.area&&distMeters(last.lat,last.lng,gps.lat,gps.lng)<1000)?last.area:await reverseGeocodeArea(gps.lat,gps.lng);
    setJoining(false);
    if(!a){ setJoinErr("Couldn't detect your area — make sure GPS is on and try again"); return; }
    store.set("delivr_areaPos",{lat:gps.lat,lng:gps.lng,area:a});
    setArea(a);
    await onSave({name:name.trim()||user.name,phone:phone.trim(),area:a});
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
        <div style={{...B,fontSize:28,color:"#00b8a9",letterSpacing:2}}>{t("prof_title")}</div>
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
            <span style={{...B,fontSize:11,color:premium?"#06c167":"#f5a623",letterSpacing:2}}>{premium?t("prof_premium"):t("prof_free")}</span>
          </div>
        </div>
      </div>

      {/* Subscription card */}
      <button onClick={onUpgrade}
        style={{width:"100%",background:premium?"linear-gradient(135deg,var(--tint-green),var(--tint-green))":"linear-gradient(135deg,var(--tint-coral),var(--tint-coral2))",border:"1px solid "+(premium?"#06c16744":"#00b8a966"),borderRadius:14,padding:"16px",marginBottom:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",textAlign:"left"}}>
        <div>
          <div style={{...B,fontSize:18,color:premium?"#06c167":"#00b8a9",letterSpacing:1}}>{premium?t("prof_premiumActive"):t("prof_goPremium")}</div>
          <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:3}}>{premium?"Manage your subscription":"No ads + full data · "+SUB_PRICE+"/mo"}</div>
        </div>
        <span style={{...B,fontSize:24,color:premium?"#06c167":"#00b8a9"}}>›</span>
      </button>

      {/* Stats */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {stat(totalLogs,t("prof_totalLogs"))}
        {stat(totalRestaurants,t("prof_restaurants"))}
        {stat(avgWait+"m",t("prof_avgWait"))}
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
                <div style={{fontSize:9,color:"var(--muted)",letterSpacing:2,marginBottom:3}}>{t("prof_rank")}</div>
                <div style={{...B,fontSize:20,color:"var(--ink)",letterSpacing:1}}>{bg?bg.emoji+" "+bg.label.toUpperCase():t("prof_noBadge")}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{...B,fontSize:24,color:"#f5a623"}}>{c}</div>
                <div style={{fontSize:8,color:"var(--muted)",letterSpacing:1}}>{t("prof_qualityLogs")}</div>
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
          <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:6}}>{t("prof_name")}</div>
          <input value={name} onChange={e=>setName(e.target.value)}
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
        </div>
        <div>
          <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:6}}>{t("prof_phone")}</div>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+44 7700 000000" type="tel"
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#00b8a9"} onBlur={e=>e.target.style.borderColor="var(--border2)"}/>
        </div>
        <div>
          <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:6}}>{t("prof_area")}</div>
          <div style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"12px 14px"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{...B,fontSize:16,color:area?"var(--ink)":"var(--faint)",letterSpacing:1}}>{area||"Not joined"}</div>
              <div style={{fontSize:9,...M,color:"var(--faint)",marginTop:1}}>{t("prof_areaHint")}</div>
            </div>
            <button onClick={joinArea} disabled={joining}
              style={{flexShrink:0,background:"#00b8a9",border:"none",borderRadius:10,...B,fontWeight:700,fontSize:12,letterSpacing:0.5,color:"#fff",padding:"10px 12px",cursor:joining?"default":"pointer"}}>
              {joining?"DETECTING…":"📍 JOIN MY AREA"}
            </button>
          </div>
          {joinErr&&<div style={{fontSize:10,...M,color:"#ef4444",marginTop:5}}>{joinErr}</div>}
          <div style={{fontSize:9,...M,color:"var(--faint)",marginTop:5}}>You can only join the area you're physically in (verified by GPS).</div>
        </div>
      </div>

      <button onClick={save} disabled={saving}
        style={{width:"100%",minHeight:56,background:saving?"var(--border)":saved?"#06c167":"#00b8a9",border:"none",borderRadius:12,...B,fontSize:22,letterSpacing:3,color:saving?"var(--faint)":"#000",cursor:saving?"default":"pointer",marginBottom:20,boxShadow:saving?"none":saved?"0 0 30px #06c16730":"0 0 30px #00b8a930",transition:"all 0.2s"}}>
        {saving?t("prof_saving"):saved?t("prof_saved"):t("prof_save")}
      </button>

      {/* Change password */}
      <button onClick={()=>{setShowPw(s=>!s);setPwMsg("");}}
        style={{width:"100%",minHeight:52,background:"none",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:18,letterSpacing:2,color:"var(--muted)",cursor:"pointer",marginBottom:showPw?0:16}}>
        {showPw?"↑ HIDE":t("prof_changePw")}
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
            <div style={{...B,fontSize:18,color:"#00b8a9",letterSpacing:1}}>{t("prof_appStats")}</div>
            <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:3}}>Owner only · live data & top restaurants</div>
          </div>
          <span style={{...B,fontSize:24,color:"#00b8a9"}}>›</span>
        </button>
      )}

      {/* Language — tap to open full picker */}
      <button onClick={()=>setLangPicker(true)} style={{width:"100%",background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px",marginBottom:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",textAlign:"left"}}>
        <div>
          <div style={{...B,fontWeight:700,fontSize:16,color:"var(--ink)",letterSpacing:1}}>🌐 LANGUAGE</div>
          <div style={{fontSize:11,...M,color:"var(--muted)",marginTop:3}}>{(LANGS.find(l=>l.code===lang)||LANGS[0]).flag} {(LANGS.find(l=>l.code===lang)||LANGS[0]).name}</div>
        </div>
        <span style={{...B,fontSize:24,color:"#00b8a9"}}>›</span>
      </button>
      {langPicker&&(
        <div onClick={()=>setLangPicker(false)} style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:18,padding:"14px",boxShadow:"0 10px 36px rgba(0,0,0,0.35)",width:"100%",maxWidth:360,maxHeight:"70vh",overflowY:"auto"}}>
            <div style={{...B,fontSize:16,color:"var(--ink)",letterSpacing:1,marginBottom:10,textAlign:"center"}}>🌐 CHOOSE LANGUAGE</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {LANGS.map(l=>{
                const active=lang===l.code;
                return(
                  <button key={l.code} onClick={()=>{onSetLang&&onSetLang(l.code);setLangPicker(false);}}
                    style={{display:"flex",alignItems:"center",gap:12,background:active?"#00b8a922":"var(--border3)",border:"1px solid "+(active?"#00b8a9":"var(--border)"),borderRadius:12,padding:"12px 14px",cursor:"pointer"}}>
                    <span style={{fontSize:22}}>{l.flag}</span>
                    <span style={{flex:1,textAlign:"left",fontSize:15,...M,fontWeight:700,color:active?"#00b8a9":"var(--ink)"}}>{l.name}</span>
                    {active&&<span style={{color:"#00b8a9",fontSize:16}}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Appearance — light / dark toggle */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"14px 16px",marginBottom:16}}>
        <div>
          <div style={{...B,fontWeight:700,fontSize:16,color:"var(--ink)",letterSpacing:1}}>{t("prof_appearance")}</div>
          <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:2}}>{theme==="dark"?t("prof_dark"):t("prof_light")}</div>
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
        {t("prof_signout")}
      </button>

      <div style={{textAlign:"center",marginTop:18}}>
        <a href="/privacy.html" style={{fontSize:10,...M,color:"var(--muted2)",letterSpacing:1,textDecoration:"none"}}>Privacy Policy</a>
      </div>
    </div>
  );
}

// ── STATS TAB — PERSONAL EARNINGS STATISTICS ──────────────────────────────────
// Reads only this driver's own earnings (users/{uid}/earnings). Never shows anyone else.
// Daily view (default) resets at local midnight; weekly view runs Monday → Sunday.
const DOW_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const titleCase = s => (s || "").replace(/\b\w/g, c => c.toUpperCase());

function StatCard({val,label,color}){
  return(
    <div style={{flex:1,minWidth:0,background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"16px 12px",textAlign:"center"}}>
      <div style={{...B,fontSize:24,color:color||"#06c167",letterSpacing:0.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val}</div>
      <div style={{fontSize:8,...M,color:"var(--muted)",marginTop:4,letterSpacing:1}}>{label}</div>
    </div>
  );
}
function StatRow({icon,label,value,sub,subColor}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:12,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px"}}>
      <div style={{fontSize:22}}>{icon}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:1,marginBottom:2}}>{label}</div>
        <div style={{...B,fontSize:16,color:"var(--ink)",letterSpacing:0.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{value}</div>
      </div>
      {sub&&<div style={{...B,fontSize:15,color:subColor||"#00b8a9",flexShrink:0}}>{sub}</div>}
    </div>
  );
}
function SectionLabel({children}){
  return <div style={{...B,fontSize:13,color:"var(--muted2)",letterSpacing:2,margin:"22px 0 8px"}}>{children}</div>;
}

// Mon→Sun earnings bar chart for the weekly view
function WeekChart({byDay}){
  const max=Math.max(...byDay.map(d=>d.sum),0.01);
  return(
    <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120,background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"14px 12px 10px"}}>
      {byDay.map((d,i)=>{
        const h=Math.max(4,Math.round((d.sum/max)*78));
        const isTop=d.sum>0&&d.sum===max;
        return(
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:5,height:"100%",justifyContent:"flex-end"}}>
            <div style={{...B,fontSize:8,color:d.sum>0?"var(--muted)":"var(--faint2)"}}>{d.sum>0?"£"+Math.round(d.sum):""}</div>
            <div style={{width:"72%",height:h,borderRadius:6,background:isTop?"#06c167":d.sum>0?"#00b8a9":"var(--border2)",transition:"height .3s"}}/>
            <div style={{...B,fontSize:10,color:"var(--faint)"}}>{DOW_SHORT[d.dow]}</div>
          </div>
        );
      })}
    </div>
  );
}

// Add OR edit one delivery. Saves straight to Firestore; the live earnings listener then
// refreshes every calculation. Every number is editable — platform, payout, restaurant, tip,
// and how long the delivery took (minutes, which drives £/hour). `isNew` = manual add (no delete).
function EarningsEditScreen({entry,isNew,bulk,onSave,onDelete,onCancel}){
  const isBulk=bulk||entry.bulk;   // platform-total entry: platform + amount only, no time/restaurant/tip
  const [platform,setPlatform]=useState(entry.platform||"");
  const [payout,setPayout]=useState(entry.payout!=null&&entry.payout!==""?String(entry.payout):"");
  const [restaurant,setRestaurant]=useState(entry.restaurantName||"");
  const [tip,setTip]=useState(entry.tip!=null&&entry.tip!==0&&entry.tip!==""?String(entry.tip):"");
  const [mins,setMins]=useState(entry.cycleMins>0?String(Math.round(entry.cycleMins)):"");
  const [confirmDel,setConfirmDel]=useState(false);
  const num=v=>{const n=parseFloat(String(v).replace(/[^0-9.]/g,""));return Number.isFinite(n)&&n>0?Math.round(n*100)/100:0;};
  const inputStyle={width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px",color:"var(--ink)",fontSize:15,...M,fontWeight:600,outline:"none",boxSizing:"border-box"};
  function save(){
    if(isBulk){ onSave({platform:platform||null,payout:num(payout),bulk:true}); return; }
    const obj={platform:platform||null,payout:num(payout),restaurantName:restaurant.trim(),tip:num(tip)};
    const m=num(mins);
    if(m>0)obj.cycleMins=m;   // minutes the delivery took → drives £/hour
    onSave(obj);
  }
  return(
    <div style={{padding:"22px 16px 100px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <button onClick={onCancel} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:28,padding:0,lineHeight:1}}>‹</button>
        <div style={{...B,fontSize:24,color:"#00b8a9",letterSpacing:2}}>{isBulk?(isNew?"LOG PLATFORM TOTAL":"EDIT PLATFORM TOTAL"):(isNew?"ADD DELIVERY":"EDIT DELIVERY")}</div>
      </div>
      {isNew&&<div style={{fontSize:11,...M,color:"var(--muted)",marginBottom:18,lineHeight:1.5}}>{isBulk?"Log one total for a platform — e.g. your whole Uber Eats total for today. Adds to your earnings total (not to £/hour).":"Manually log what you earned — e.g. an order you forgot to track. It counts toward your stats & £/hour."}</div>}
      {!isNew&&<div style={{height:14}}/>}
      <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>PLATFORM</div>
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        {PLATFORMS.map(p=>(
          <button key={p} onClick={()=>setPlatform(p)} style={{flex:1,border:"1px solid "+(platform===p?"#00b8a9":"var(--border2)"),background:platform===p?"#00b8a9":"var(--card)",color:platform===p?"#00261f":"var(--ink)",borderRadius:10,padding:"11px 0",cursor:"pointer",...B,fontSize:11,letterSpacing:0.3}}>{p}</button>
        ))}
      </div>
      <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>{isBulk?"TOTAL EARNED ON THIS PLATFORM (£)":"PAYOUT (£)"}</div>
      <input value={payout} onChange={e=>setPayout(e.target.value)} inputMode="decimal" placeholder="0.00" style={{...inputStyle,marginBottom:isBulk?24:18}}/>
      {!isBulk&&<>
      <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>RESTAURANT</div>
      <input value={restaurant} onChange={e=>setRestaurant(e.target.value)} placeholder={isNew?"Restaurant (optional)":"Restaurant name"} style={{...inputStyle,marginBottom:18}}/>
      <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>TIP (£)</div>
      <input value={tip} onChange={e=>setTip(e.target.value)} inputMode="decimal" placeholder="0.00" style={{...inputStyle,marginBottom:18}}/>
      <div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:2,marginBottom:8}}>TIME TAKEN (MINUTES) · OPTIONAL — SETS £/HOUR</div>
      <input value={mins} onChange={e=>setMins(e.target.value)} inputMode="numeric" placeholder="e.g. 25" style={{...inputStyle,marginBottom:24}}/>
      </>}
      <button onClick={save}
        style={{width:"100%",background:"#06c167",border:"none",borderRadius:12,padding:"15px",cursor:"pointer",...B,fontSize:15,color:"#fff",letterSpacing:1,marginBottom:12}}>{isBulk?(isNew?"LOG TOTAL":"SAVE CHANGES"):(isNew?"ADD DELIVERY":"SAVE CHANGES")}</button>
      {!isNew&&(!confirmDel?(
        <button onClick={()=>setConfirmDel(true)} style={{width:"100%",background:"none",border:"1px solid #ef444466",borderRadius:12,padding:"13px",cursor:"pointer",...B,fontSize:13,color:"#ef4444",letterSpacing:1}}>DELETE ENTRY</button>
      ):(
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setConfirmDel(false)} style={{flex:1,background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"13px",cursor:"pointer",...B,fontSize:13,color:"var(--ink)"}}>CANCEL</button>
          <button onClick={onDelete} style={{flex:1,background:"#ef4444",border:"none",borderRadius:12,padding:"13px",cursor:"pointer",...B,fontSize:13,color:"#fff",letterSpacing:1}}>CONFIRM DELETE</button>
        </div>
      ))}
    </div>
  );
}

// One delivery row in the STATS lists — whole row is tappable to open the edit screen.
function DeliveryRow({e,onTap}){
  return(
    <button onClick={()=>onTap(e)} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",cursor:"pointer",textAlign:"left",width:"100%"}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{...B,fontSize:14,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.bulk?(e.platform||"Platform")+" — total":(e.restaurantName||"Order")}</div>
        <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:1}}>{e.bulk?("Platform total · "+new Date(e.ts).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})):((e.platform||"—")+" · "+new Date(e.ts).toLocaleString("en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})+(e.tip>0?" · tip "+fmtGBP(e.tip):""))}</div>
      </div>
      <div style={{...B,fontSize:14,color:"#06c167",flexShrink:0}}>{fmtGBP((Number(e.payout)||0)+(Number(e.tip)||0))}</div>
      <span style={{...B,fontSize:11,color:"#00b8a9",letterSpacing:0.5,flexShrink:0,border:"1px solid var(--border2)",borderRadius:8,padding:"5px 9px"}}>EDIT</span>
    </button>
  );
}

function MyStats({earningsLog,activeOrders,now,shiftMins}){
  const [view,setView]=useState("today");   // today | week | all
  const [editing,setEditing]=useState(null);   // entry being edited, or null
  const [adding,setAdding]=useState(null);      // manual add: null | {platform} (prefill)
  const [drill,setDrill]=useState(null);        // drill-down: null | "__list__" (platform filter) | platform name
  // Re-bucket only when the calendar day rolls over (drives the midnight reset), not every tick.
  const dayKey=startOfDayMs(now||new Date());
  const {today,week,all,entries}=useMemo(()=>{
    const sod=startOfDayMs(dayKey);
    const sow=startOfWeekMs(dayKey);
    const tMs=e=>new Date(e.ts).getTime();
    const todayE=earningsLog.filter(e=>tMs(e)>=sod);
    const weekE=earningsLog.filter(e=>tMs(e)>=sow);
    return {
      today:computeEarningsStats(todayE,sod),   // clamp session time to midnight → today starts fresh
      week: computeEarningsStats(weekE,sow),
      all:  computeEarningsStats(earningsLog,0),
      entries:{today:todayE,week:weekE,all:earningsLog},
    };
  },[earningsLog,dayKey]);

  // Manual-delivery cap: max 20 per-delivery manual adds per day (bulk-platform totals don't count).
  const manualToday=entries.today.filter(e=>e.manual&&!e.bulk).length;
  const manualCapReached=manualToday>=20;

  // Edit/delete write straight to this driver's own earnings collection; the live listener
  // refreshes earningsLog → every stat recomputes in real time.
  async function saveEdit(updates){
    const uid=auth.currentUser?.uid;
    if(uid&&editing?.id){ try{ await updateDoc(doc(db,"users",uid,"earnings",editing.id),updates); }catch(e){} }
    setEditing(null);
  }
  async function deleteEdit(){
    const uid=auth.currentUser?.uid;
    if(uid&&editing?.id){ try{ await deleteDoc(doc(db,"users",uid,"earnings",editing.id)); }catch(e){} }
    setEditing(null);
  }
  // Manually add a delivery / platform income — for drivers who didn't run the ARRIVED flow.
  // Written to the same earnings collection so it counts in every stat exactly like a tracked order.
  async function saveNew(obj){
    const uid=auth.currentUser?.uid;
    setAdding(null);
    if(!uid||manualCapReached)return;   // enforce the 20-per-day manual cap
    const ts=new Date();
    const entry={
      platform:       obj.platform||null,
      payout:         obj.payout||0,
      tip:            obj.tip||0,
      restaurantId:   "manual-"+genId(),
      restaurantName: obj.restaurantName||"",
      waitMins:       0,
      cycleMins:      obj.cycleMins||0,   // 0 → £/hour is estimated until a time is set
      ts:             ts.toISOString(),
      hour:           ts.getHours(),
      dow:            ts.getDay(),
      period:         timePeriod(ts.getHours()),
      manual:         true,
    };
    try{ await addDoc(collection(db,"users",uid,"earnings"),entry); }catch(e){}
  }
  // Platform bulk total — one lump sum logged for a whole platform (counts toward total earnings,
  // not £/hour). Tagged bulk:true so it's excluded from the per-delivery stats.
  async function saveBulk(obj){
    const uid=auth.currentUser?.uid;
    setAdding(null);
    if(!uid)return;
    const ts=new Date();
    const entry={
      platform:obj.platform||null, payout:obj.payout||0, tip:0,
      restaurantId:"bulk-"+genId(), restaurantName:"", waitMins:0, cycleMins:0,
      ts:ts.toISOString(), hour:ts.getHours(), dow:ts.getDay(), period:timePeriod(ts.getHours()),
      manual:true, bulk:true,
    };
    try{ await addDoc(collection(db,"users",uid,"earnings"),entry); }catch(e){}
  }
  if(editing) return <EarningsEditScreen entry={editing} bulk={!!editing.bulk} onSave={saveEdit} onDelete={deleteEdit} onCancel={()=>setEditing(null)}/>;
  if(adding) return <EarningsEditScreen entry={{platform:adding.platform||"",payout:"",restaurantName:"",tip:"",cycleMins:0,bulk:adding.bulk}} isNew bulk={!!adding.bulk} onSave={adding.bulk?saveBulk:saveNew} onCancel={()=>setAdding(null)}/>;

  const s=view==="today"?today:view==="week"?week:all;
  const viewEntries=entries[view];
  const tabs=[["today","TODAY"],["week","THIS WEEK"],["all","ALL TIME"]];

  // Drill-down: tap total → platform list → that platform's deliveries → tap one → edit screen.
  if(drill&&s){
    const headerBack=(title,sub)=>(
      <div style={{marginBottom:16}}>
        <button onClick={()=>setDrill(null)} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:14,padding:0,...B,letterSpacing:1,marginBottom:8}}>‹ BACK</button>
        <div style={{...B,fontSize:22,color:"#00b8a9",letterSpacing:1}}>{title}</div>
        {sub&&<div style={{fontSize:11,...M,color:"var(--muted)",marginTop:2}}>{sub}</div>}
      </div>
    );
    const viewLabel=view==="today"?"Today":view==="week"?"This week":"All time";
    if(drill==="__list__"){
      return(
        <div style={{padding:"22px 16px 100px"}}>
          {headerBack("FILTER BY PLATFORM",viewLabel+" · tap a platform")}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {s.platforms.map(p=>(
              <button key={p.name} onClick={()=>setDrill(p.name)} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",cursor:"pointer",textAlign:"left",width:"100%"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:15,color:"var(--ink)"}}>{p.name}</div>
                  <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:1}}>{p.n>0?p.n+" order"+(p.n!==1?"s":""):"bulk total"}{p.rate!=null?<><span style={{margin:"0 5px",color:"var(--faint2)"}}>·</span>{fmtRate(p.rate)}</>:""}</div>
                </div>
                <span style={{...B,fontSize:15,color:"#06c167"}}>{fmtGBP(p.total)}</span>
                <span style={{...B,fontSize:18,color:"#00b8a9"}}>›</span>
              </button>
            ))}
          </div>
        </div>
      );
    }
    // a specific platform → its deliveries (tap any to edit)
    const filtered=viewEntries.filter(e=>(e.platform||"Other")===drill).slice().sort((a,b)=>new Date(b.ts)-new Date(a.ts));
    const total=filtered.reduce((sum,e)=>sum+(Number(e.payout)||0)+(Number(e.tip)||0),0);
    return(
      <div style={{padding:"22px 16px 100px"}}>
        {headerBack(drill.toUpperCase(),filtered.length+" item"+(filtered.length===1?"":"s")+" · "+fmtGBP(total))}
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <button onClick={()=>!manualCapReached&&setAdding({platform:drill})} disabled={manualCapReached} style={{flex:1,background:"var(--card)",border:"1px dashed "+(manualCapReached?"var(--border2)":"#06c16788"),borderRadius:12,padding:"12px 8px",cursor:manualCapReached?"default":"pointer",...B,fontSize:11,letterSpacing:0.5,color:manualCapReached?"var(--faint)":"#06c167"}}>{manualCapReached?"20/20 TODAY":"+ ADD DELIVERY"}</button>
          <button onClick={()=>setAdding({bulk:true,platform:drill})} style={{flex:1,background:"var(--card)",border:"1px dashed #00b8a988",borderRadius:12,padding:"12px 8px",cursor:"pointer",...B,fontSize:11,letterSpacing:0.5,color:"#00b8a9"}}>+ PLATFORM TOTAL</button>
        </div>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:"30px 20px",fontSize:12,...M,color:"var(--muted)"}}>No deliveries on this platform yet — tap “+ ADD” above.</div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {filtered.map((e,i)=><DeliveryRow key={e.id||i} e={e} onTap={setEditing}/>)}
          </div>
        )}
      </div>
    );
  }

  return(
    <div style={{padding:"22px 16px 100px"}}>
      {/* Header */}
      <div style={{marginBottom:14}}>
        <div style={{...B,fontSize:26,color:"#00b8a9",letterSpacing:2}}>MY STATS</div>
        <div style={{fontSize:11,...M,color:"var(--muted)",marginTop:2}}>Your earnings — only you can see this</div>
      </div>

      {/* Segmented control */}
      <div style={{display:"flex",gap:4,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:4,marginBottom:12}}>
        {tabs.map(([id,lbl])=>(
          <button key={id} onClick={()=>setView(id)}
            style={{flex:1,border:"none",borderRadius:9,padding:"9px 0",cursor:"pointer",...B,fontSize:11,letterSpacing:1,
              background:view===id?"#00b8a9":"transparent",color:view===id?"#00261f":"var(--muted)"}}>{lbl}</button>
        ))}
      </div>

      {/* Manually log earnings — per delivery, or one lump total per platform. Always available. */}
      <div style={{display:"flex",gap:8,marginBottom:manualCapReached?6:16}}>
        <button onClick={()=>!manualCapReached&&setAdding({})} disabled={manualCapReached} style={{flex:1,background:"var(--card)",border:"1px dashed "+(manualCapReached?"var(--border2)":"#06c16788"),borderRadius:12,padding:"12px 8px",cursor:manualCapReached?"default":"pointer",...B,fontSize:11,letterSpacing:0.5,color:manualCapReached?"var(--faint)":"#06c167"}}>{manualCapReached?"20/20 TODAY":"+ ADD DELIVERY"}</button>
        <button onClick={()=>setAdding({bulk:true})} style={{flex:1,background:"var(--card)",border:"1px dashed #00b8a988",borderRadius:12,padding:"12px 8px",cursor:"pointer",...B,fontSize:11,letterSpacing:0.5,color:"#00b8a9"}}>+ PLATFORM TOTAL</button>
      </div>
      {manualCapReached&&<div style={{fontSize:10,...M,color:"var(--muted2)",textAlign:"center",marginBottom:16}}>Daily manual delivery limit reached — edit/delete an entry, or use platform total.</div>}

      {/* Today's clocked shift time (from the WAITS shift timer) */}
      {view==="today"&&shiftMins>0&&(
        <div style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px",marginBottom:16}}>
          <span style={{fontSize:20}}>⏱️</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:8,color:"var(--muted2)",letterSpacing:2,marginBottom:2}}>SHIFT TIME TODAY (CLOCKED)</div>
            <div style={{...B,fontSize:16,color:"var(--ink)"}}>{fmtHM(shiftMins)}</div>
          </div>
        </div>
      )}

      {/* Out-for-delivery orders — not counted until marked delivered */}
      {activeOrders&&activeOrders.length>0&&(
        <div style={{background:"var(--card)",border:"1px solid #f5a62366",borderRadius:12,padding:"12px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>🛵</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:8,color:"var(--muted2)",letterSpacing:2,marginBottom:2}}>{activeOrders.length} OUT FOR DELIVERY — NOT COUNTED YET</div>
            <div style={{...B,fontSize:15,color:"var(--ink)"}}>{fmtGBP(activeOrders.reduce((s,o)=>s+(Number(o.payout)||0),0))}<span style={{...M,fontWeight:400,fontSize:11,color:"var(--muted)"}}>{" · counts when delivered"}</span></div>
          </div>
        </div>
      )}

      {!s?(
        <div style={{textAlign:"center",padding:"50px 20px"}}>
          <div style={{fontSize:48,marginBottom:14}}>{view==="today"?"📅":view==="week"?"📊":"💰"}</div>
          <div style={{...B,fontSize:17,color:"var(--ink)",letterSpacing:1,marginBottom:8}}>
            {view==="today"?"NOTHING LOGGED TODAY":view==="week"?"NOTHING LOGGED THIS WEEK":"NO EARNINGS LOGGED YET"}
          </div>
          <div style={{fontSize:12,...M,color:"var(--muted)",lineHeight:1.6}}>When you tap ARRIVED, log the platform and payout — it banks once you arrive at your next order, so your £/hour reflects driving &amp; delivery time too.</div>
        </div>
      ):(
        <>
          {/* Hero — period total (tap to drill into platforms) */}
          <button onClick={()=>s.platforms.length>0&&setDrill("__list__")} style={{display:"block",width:"100%",textAlign:"center",background:"linear-gradient(135deg,var(--tint-teal),var(--tint-green))",border:"1px solid #00b8a944",borderRadius:18,padding:"20px 18px",marginBottom:10,cursor:s.platforms.length>0?"pointer":"default"}}>
            <div style={{fontSize:9,...M,color:"var(--muted)",letterSpacing:2,marginBottom:4}}>
              {view==="today"?"EARNED TODAY":view==="week"?"EARNED THIS WEEK":"TOTAL EARNED"}
            </div>
            <div style={{...B,fontSize:42,color:"#06c167",letterSpacing:0.5,lineHeight:1.05}}>{fmtGBP(s.totalEarnings)}</div>
            <div style={{fontSize:12,...M,color:"var(--muted)",marginTop:6}}>
              {s.overallRate==null?"—":fmtRate(s.overallRate)}<span style={{margin:"0 6px",color:"var(--faint2)"}}>·</span>{s.totalOrders} order{s.totalOrders!==1?"s":""}
            </div>
            {s.totalTips>0&&(
              <div style={{fontSize:11,...M,color:"var(--muted)",marginTop:6,paddingTop:6,borderTop:"1px solid #00b8a922"}}>
                {fmtGBP(s.totalBase)} base<span style={{margin:"0 6px",color:"var(--faint2)"}}>·</span><span style={{color:"#06c167",fontWeight:700}}>{fmtGBP(s.totalTips)} tips</span>
              </div>
            )}
            {s.platforms.length>0&&<div style={{fontSize:9,...M,color:"#00b8a9",letterSpacing:1,marginTop:8}}>TAP TO FILTER BY PLATFORM ›</div>}
          </button>

          <div style={{display:"flex",gap:8,marginBottom:4}}>
            <StatCard val={s.overallRate==null?"—":fmtRate(s.overallRate)} label="AVG £/HOUR" color="#00b8a9"/>
            <StatCard val={s.totalOrders} label="ORDERS" color="#f5a623"/>
            <StatCard val={s.totalHours>0?(Math.round(s.totalHours*10)/10)+"h":"—"} label="TIME" color="#2b8fff"/>
          </div>

          {view==="week"&&(
            <>
              <SectionLabel>EARNINGS BY DAY</SectionLabel>
              <WeekChart byDay={s.byDay}/>
            </>
          )}

          {view==="today"?(
            <>
              <SectionLabel>TODAY'S HIGHLIGHTS</SectionLabel>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <StatRow icon="🏆" label="BEST PLATFORM TODAY" value={s.bestPlatTotal?s.bestPlatTotal.platform:"—"} sub={s.bestPlatTotal?fmtGBP(s.bestPlatTotal.sum):""} subColor="#06c167"/>
                <StatRow icon="💵" label="BEST ORDER" value={s.bestOrder?s.bestOrder.name:"—"} sub={s.bestOrder?fmtGBP(s.bestOrder.payout):""} subColor="#06c167"/>
                <StatRow icon="🐌" label="WORST WAIT" value={s.worstWait?s.worstWait.name:"—"} sub={s.worstWait?(Math.round(s.worstWait.waitMins*10)/10)+"m":""} subColor="#ef4444"/>
              </div>
            </>
          ):view==="week"?(
            <>
              <SectionLabel>THIS WEEK'S HIGHLIGHTS</SectionLabel>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <StatRow icon="📅" label="HIGHEST EARNING DAY" value={s.bestDayTotal?dayLabel(s.bestDayTotal.dow):"—"} sub={s.bestDayTotal?fmtGBP(s.bestDayTotal.sum):""} subColor="#06c167"/>
                <StatRow icon="🏆" label="BEST PAYING PLATFORM" value={s.bestPlatRate?s.bestPlatRate.platform:"—"} sub={s.bestPlatRate?fmtRate(s.bestPlatRate.rate):""}/>
                <StatRow icon="⚡" label="BEST RESTAURANT (QUICKEST)" value={s.quickest?s.quickest.name:"—"} sub={s.quickest?(Math.round(s.quickest.avgW*10)/10)+"m":""} subColor="#06c167"/>
                <StatRow icon="🐢" label="WORST RESTAURANT (SLOWEST)" value={s.costliest?s.costliest.name:"—"} sub={s.costliest?(Math.round(s.costliest.avgW*10)/10)+"m":""} subColor="#ef4444"/>
                <StatRow icon="🕒" label="MOST PROFITABLE TIME" value={s.bestPeriod?titleCase(s.bestPeriod.period):"—"} sub={s.bestPeriod?fmtRate(s.bestPeriod.rate):""}/>
                <StatRow icon="💎" label="BEST ORDER" value={s.bestOrder?s.bestOrder.name:"—"} sub={s.bestOrder?fmtGBP(s.bestOrder.payout):""} subColor="#06c167"/>
              </div>
              <div style={{fontSize:10,...M,color:"var(--faint)",textAlign:"center",marginTop:16}}>↻ Fresh summary every Monday</div>
            </>
          ):(
            <>
              <SectionLabel>YOUR BESTS</SectionLabel>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <StatRow icon="🏆" label="BEST PAYING PLATFORM / HOUR" value={s.bestPlatRate?s.bestPlatRate.platform:"—"} sub={s.bestPlatRate?fmtRate(s.bestPlatRate.rate):""}/>
                <StatRow icon="💵" label="HIGHEST AVG PAYOUT / ORDER" value={s.bestPlatAvg?s.bestPlatAvg.platform:"—"} sub={s.bestPlatAvg?fmtGBP(s.bestPlatAvg.avg):""} subColor="#06c167"/>
                <StatRow icon="⚡" label="QUICKEST RESTAURANT" value={s.quickest?s.quickest.name:"—"} sub={s.quickest?(Math.round(s.quickest.avgW*10)/10)+"m":""} subColor="#06c167"/>
                <StatRow icon="🐌" label="MOST COSTLY BY WAIT" value={s.costliest?s.costliest.name:"—"} sub={s.costliest?(Math.round(s.costliest.avgW*10)/10)+"m":""} subColor="#ef4444"/>
                <StatRow icon="📅" label="BEST DAY OF WEEK" value={s.bestDay?dayLabel(s.bestDay.dow):"—"} sub={s.bestDay?fmtRate(s.bestDay.rate):""}/>
                <StatRow icon="🕒" label="BEST TIME OF DAY" value={s.bestPeriod?titleCase(s.bestPeriod.period):"—"} sub={s.bestPeriod?fmtRate(s.bestPeriod.rate):""}/>
              </div>
            </>
          )}

          {s.platforms.length>0&&(
            <>
              <SectionLabel>BY PLATFORM</SectionLabel>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {s.platforms.map(p=>(
                  <button key={p.name} onClick={()=>setDrill(p.name)} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",cursor:"pointer",width:"100%",textAlign:"left"}}>
                    <span style={{flex:1,minWidth:0,...B,fontSize:14,color:"var(--ink)",letterSpacing:0.5,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                    <span style={{fontSize:10,...M,color:"var(--muted)"}}>{p.n>0?p.n+" order"+(p.n!==1?"s":""):"bulk"}</span>
                    {p.rate!=null&&<span style={{...B,fontSize:13,color:"var(--muted2)"}}>{fmtRate(p.rate)}</span>}
                    <span style={{...B,fontSize:14,color:"#06c167"}}>{fmtGBP(p.total)}</span>
                    <span style={{...B,fontSize:16,color:"#00b8a9"}}>›</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Individual deliveries — tap any row to open the edit screen */}
          {viewEntries.length>0&&(
            <>
              <SectionLabel>DELIVERIES</SectionLabel>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {viewEntries.slice().sort((a,b)=>new Date(b.ts)-new Date(a.ts)).map((e,i)=>(
                  <DeliveryRow key={e.id||i} e={e} onTap={setEditing}/>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── LANGUAGE PICKER (very first screen) ───────────────────────────────────────
function LanguageScreen({onChoose}) {
  return(
    <div style={{minHeight:"100vh",background:"#0e1316",color:"#eaf0f2",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 26px",fontFamily:"'Nunito',sans-serif"}}>
      <div style={{textAlign:"center",marginBottom:36}}>
        <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:40,color:"#00b8a9",letterSpacing:6}}>DELIVR</div>
        <div style={{fontSize:13,color:"#9aa7af",marginTop:10}}>🌐 Choose your language</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {LANGS.map(l=>(
          <button key={l.code} onClick={()=>onChoose(l.code)}
            style={{display:"flex",alignItems:"center",gap:14,background:"#192127",border:"1px solid #28343a",borderRadius:14,padding:"16px 18px",cursor:"pointer",textAlign:"left"}}>
            <span style={{fontSize:26}}>{l.flag}</span>
            <span style={{fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:18,color:"#eaf0f2",flex:1}}>{l.name}</span>
            <span style={{color:"#00b8a9",fontSize:20}}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── DISCLAIMER (shown once, after language) ───────────────────────────────────
function DisclaimerScreen({lang,onAccept}) {
  const tt=k=>tr(lang,k);
  return(
    <div style={{minHeight:"100vh",background:"#0e1316",color:"#eaf0f2",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 26px 40px",fontFamily:"'Nunito',sans-serif"}}>
      <div style={{textAlign:"center",marginBottom:26}}>
        <div style={{fontSize:56,marginBottom:16}}>🔒</div>
        <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:30,color:"#00b8a9",letterSpacing:1}}>{tt("disc_title")}</div>
      </div>
      <div style={{background:"#192127",border:"1px solid #28343a",borderRadius:16,padding:"20px",fontSize:14,lineHeight:1.8,color:"#cdd6da",marginBottom:24}}>
        {tt("disc_body")}
      </div>
      <button onClick={onAccept}
        style={{width:"100%",minHeight:62,background:"#00b8a9",border:"none",borderRadius:18,fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:20,letterSpacing:1,color:"#fff",cursor:"pointer",boxShadow:"0 8px 24px #00b8a944"}}>
        ✓ {tt("disc_btn")}
      </button>
    </div>
  );
}

// ── ONBOARDING (first-time users, dark theme) ─────────────────────────────────
function Onboarding({onFinish,lang}) {
  const [step,setStep]=useState(0);
  const D={bg:"#0e1316",card:"#192127",ink:"#eaf0f2",muted:"#9aa7af",teal:"#00b8a9",coral:"#ff5a2d",green:"#06c167"};
  const t=k=>tr(lang,k);

  const slides=[
    { emoji:"⏳", title:t("ob1_title"), body:t("ob1_body") },
    { title:t("ob2_title"), steps:[
        {e:"📍",t:t("ob2_arrive_t"),d:t("ob2_arrive_d")},
        {e:"✅",t:t("ob2_pickup_t"),d:t("ob2_pickup_d")},
        {e:"⚡",t:t("ob2_see_t"),d:t("ob2_see_d")},
      ] },
    { emoji:"🤝", title:t("ob3_title"), body:t("ob3_body") },
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
        <button onClick={onFinish} style={{position:"absolute",top:18,right:22,background:"none",border:"none",color:D.muted,fontSize:13,fontWeight:700,cursor:"pointer",zIndex:2}}>{t("skip")}</button>
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
          {isLast?t("join"):t("next")}
        </button>
      </div>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({onLogin,onRegistered,initialMode,lang,onChangeLang}) {
  const t=k=>tr(lang,k);
  const [mode,setMode]=useState(initialMode||"login");
  const [username,setUsername]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [colorIdx,setColorIdx]=useState(0);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [resetMsg,setResetMsg]=useState("");
  const [resetStage,setResetStage]=useState(false);   // showing the code+new-password form
  const [resetCode,setResetCode]=useState("");
  const [resetNewPw,setResetNewPw]=useState("");
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

  // Forgot password → Brevo emails a 6-digit reset code (no longer Firebase default email)
  async function forgotPassword(){
    setError("");setResetMsg("");
    const em=email.trim().toLowerCase();
    if(!emailValid(em)){setError("Type your email above first, then tap Forgot password");return;}
    setLoading(true);
    try{
      const r=await fetch(`${API_URL}/auth/send-reset-code`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em})});
      const d=await r.json();
      if(!r.ok){setError(d.error||"Could not send reset code");return;}
      setResetStage(true);setResetMsg("Reset code sent to "+em+" — check inbox & spam.");
    }catch(err){
      setError("Couldn't reach the server — try again");
    }finally{
      setLoading(false);
    }
  }

  // Submit the code + new password → backend sets it via Firebase Admin
  async function submitReset(){
    setError("");
    const em=email.trim().toLowerCase();
    if(resetCode.trim().length!==6){setError("Enter the 6-digit code");return;}
    if(resetNewPw.length<6){setError("New password must be at least 6 characters");return;}
    setLoading(true);
    try{
      const r=await fetch(`${API_URL}/auth/reset-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:em,code:resetCode.trim(),password:resetNewPw})});
      const d=await r.json();
      if(!r.ok){setError(d.error||"Could not reset password");return;}
      setResetStage(false);setResetCode("");setResetNewPw("");setPassword("");
      setResetMsg("✓ Password changed — sign in with your new password.");
    }catch(err){
      setError("Couldn't reach the server — try again");
    }finally{
      setLoading(false);
    }
  }

  // Reset password screen (enter code + new password)
  if(resetStage){
    return(
      <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 24px 60px",background:"linear-gradient(160deg,var(--tint-teal) 0%,var(--bg) 55%)"}}>
        <div style={{textAlign:"center",marginBottom:30}}>
          <div style={{fontSize:52,marginBottom:12}}>🔑</div>
          <div style={{...B,fontSize:34,color:"#00b8a9",letterSpacing:2}}>RESET PASSWORD</div>
          <div style={{fontSize:12,...M,color:"var(--muted)",marginTop:8}}>Enter the 6-digit code sent to<br/><b style={{color:"var(--ink)"}}>{email.trim().toLowerCase()}</b></div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <input value={resetCode} onChange={e=>setResetCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="000000" maxLength={6} inputMode="numeric" autoFocus
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:14,padding:"18px",color:"#00b8a9",fontSize:30,...M,fontWeight:700,letterSpacing:8,textAlign:"center",outline:"none",boxSizing:"border-box"}}/>
          <PasswordInput value={resetNewPw} onChange={e=>setResetNewPw(e.target.value)} placeholder="New password (min 6)"/>
          {error&&<div style={{background:"var(--tint-red)",border:"1px solid #ef444444",borderRadius:10,padding:"12px 14px",fontSize:12,...M,color:"#ef4444"}}>{error}</div>}
          <button onClick={submitReset} disabled={loading}
            style={{minHeight:60,background:loading?"var(--border)":"#00b8a9",border:"none",borderRadius:14,...B,fontSize:24,letterSpacing:2,color:loading?"var(--muted2)":"#fff",cursor:loading?"default":"pointer"}}>
            {loading?"…":"SET NEW PASSWORD →"}
          </button>
          <button onClick={forgotPassword} disabled={loading} style={{background:"none",border:"none",color:"var(--muted)",fontSize:12,...M,cursor:"pointer"}}>Resend code</button>
          <button onClick={()=>{setResetStage(false);setError("");}} style={{background:"none",border:"none",color:"var(--faint)",fontSize:12,...M,cursor:"pointer"}}>‹ Back to sign in</button>
        </div>
      </div>
    );
  }

  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"0 24px 60px",background:"linear-gradient(160deg,var(--tint-teal) 0%,var(--bg) 55%)"}}>
      <div style={{textAlign:"center",marginBottom:40}}>
        <div style={{...B,fontSize:80,color:"#00b8a9",letterSpacing:8,lineHeight:1,textShadow:"0 0 80px #00b8a944"}}>DELIVR</div>
        <div style={{fontSize:10,color:"var(--faint2)",letterSpacing:5,marginTop:6}}>{t("tagline")}</div>
        {onChangeLang&&<button type="button" onClick={onChangeLang} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:11,...M,marginTop:10}}>{t("changeLang")}</button>}
      </div>

      <div style={{display:"flex",background:"var(--card)",borderRadius:12,padding:4,marginBottom:28,border:"1px solid var(--border)"}}>
        {["login","register"].map(m=>(
          <button key={m} type="button" onClick={()=>switchMode(m)}
            style={{flex:1,padding:"11px 0",background:mode===m?"#00b8a9":"none",border:"none",borderRadius:9,cursor:"pointer",...B,fontSize:16,letterSpacing:2,color:mode===m?"#000":"var(--muted)",transition:"all 0.15s"}}>
            {m==="login"?t("signin"):t("create")}
          </button>
        ))}
      </div>

      <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:14}}>
        {mode==="register"&&(
          <div>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>{t("drivername")}</div>
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. FastRider99" maxLength={20} autoFocus
              style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:14,padding:"16px 18px",color:"var(--ink)",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:1}}
              onFocus={e=>{e.target.style.borderColor="#00b8a9";}} onBlur={e=>{e.target.style.borderColor="var(--border2)";}}/>
          </div>
        )}
        <div>
          <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>{t("email")}</div>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" type="email" autoComplete="email" autoFocus={mode==="login"}
            style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:14,padding:"16px 18px",color:"var(--ink)",fontSize:16,...M,fontWeight:600,outline:"none",boxSizing:"border-box",letterSpacing:1}}
            onFocus={e=>{e.target.style.borderColor="#00b8a9";}} onBlur={e=>{e.target.style.borderColor="var(--border2)";}}/>
        </div>
        <div>
          <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>{t("password")} {mode==="register"&&<span style={{color:"var(--faint2)"}}>(min 6 chars)</span>}</div>
          <PasswordInput value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password"/>
          {mode==="login"&&(
            <div style={{textAlign:"right",marginTop:8}}>
              <button type="button" onClick={forgotPassword} style={{background:"none",border:"none",color:"#00b8a9",cursor:"pointer",fontSize:11,...M,letterSpacing:1,padding:0}}>{t("forgot")}</button>
            </div>
          )}
        </div>
        {mode==="register"&&<>
          <div>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:7}}>{t("confirm")}</div>
            <PasswordInput value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Repeat password"/>
          </div>
          <div>
            <div style={{fontSize:9,color:"var(--muted2)",letterSpacing:2,marginBottom:10}}>{t("colour")}</div>
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
          {loading?"LOADING...":(mode==="login"?t("signinBtn"):t("createBtn"))}
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
  const displayWait=usePersonal?personal.avg:useCommunity?community.avg:null;
  const riskColor=displayWait==null?"var(--muted)":displayWait>18?"#ef4444":displayWait>10?"#f5a623":"#06c167";
  const d=distMap[r.id];
  const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;
  const isChecking=checkingId===r.id;
  const hasError=arrivalError?.restaurantId===r.id;
  const isActive=activeWait?.restaurantId===r.id;
  const myLogs=waitLog.filter(l=>logKey(l)===ck);
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
            <div style={{...B,fontSize:15,color:"var(--faint)",letterSpacing:1}}>{t("w_noData")}</div>
          )}
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <div style={{flex:1,background:"var(--tint-green)",border:"1px solid #06c16722",borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:8,color:"#06c167",letterSpacing:2,marginBottom:4}}>{t("w_yourData")}</div>
          {personal?(<>
            <div style={{...B,fontSize:24,color:"#06c167"}}>{personal.avg}m</div>
            <div style={{fontSize:9,color:"#0a8f4f",marginTop:2}}>{personal.count} visit{personal.count!==1?"s":""} · {personal.context}</div>
          </>):<div style={{...B,fontSize:14,color:"var(--border)"}}>NO VISITS YET</div>}
        </div>
        <div style={{flex:1,background:"var(--tint-blue)",border:"1px solid #2b8fff22",borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:8,color:"#2b8fff",letterSpacing:2,marginBottom:4}}>{t("w_community")}</div>
          {community?(<>
            <div style={{...B,fontSize:24,color:"#2b8fff"}}>{community.avg}m</div>
            <div style={{fontSize:9,color:"#1c6fd0",marginTop:2}}>{community.count} logs · {community.drivers} driver{community.drivers!==1?"s":""}</div>
          </>):<div style={{...B,fontSize:14,color:"var(--border)"}}>{t("w_noData")}</div>}
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
function LiveFeed({activeWaitsList,communityLogs,contribCounts,onOpen,myName,revealNames}) {
  const [,tick]=useState(0);
  useEffect(()=>{const id=setInterval(()=>tick(x=>x+1),30000);return ()=>clearInterval(id);},[]); // refresh relative times
  const events=[
    ...activeWaitsList.map(w=>({kind:"arrived",user:w.username||"A driver",rest:w.restaurantName||"a restaurant",ts:w.startedAt})),
    ...communityLogs.map(l=>({kind:"picked",user:l.username||"A driver",rest:l.restaurantName||"a restaurant",waitMins:l.waitMins,ts:l.ts})),
  ].sort((a,b)=>new Date(b.ts)-new Date(a.ts)).slice(0,5);   // 5 most recent on main screen

  return(
    <div onClick={onOpen} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"12px 14px",marginBottom:14,cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:10}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:"#06c167",boxShadow:"0 0 6px #06c167",animation:"criticalPulse 2s ease-in-out infinite"}}/>
        <span style={{...B,fontSize:13,color:"var(--ink)",letterSpacing:2}}>{t("w_liveActivity")}</span>
        <span style={{marginLeft:"auto",fontSize:10,...M,fontWeight:700,color:"#00b8a9"}}>{t("w_viewAll")}</span>
      </div>
      {events.length===0?(
        <div style={{fontSize:11,...M,color:"var(--faint)",padding:"6px 0"}}>No activity yet — be the first to log a wait.</div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {events.map((e,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:9,fontSize:12,...M}}>
              <span style={{fontSize:14}}>{e.kind==="arrived"?"🟢":"✅"}</span>
              <span style={{color:"var(--ink)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                <b style={{fontWeight:700}}>{(revealNames||e.user===myName)?e.user:"Driver"}</b>{(()=>{const bg=badgeFor(contribCounts?.[e.user]||0);return bg?<span style={{marginLeft:2}}>{bg.emoji}</span>:null;})()}
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
function Logbook({communityLogs,contribCounts,onBack,myName,revealNames}) {
  const [offset,setOffset]=useState(0); // 0 = today, 1 = yesterday, ...
  const [shown,setShown]=useState(20);  // paginate: render 20 at a time (prevents render crashes)
  useEffect(()=>{setShown(20);},[offset]);   // reset paging when the day changes
  const day=new Date(); day.setDate(day.getDate()-offset);
  const dayStr=day.toISOString().slice(0,10);
  const isToday=offset===0;
  const label=isToday?"Today":offset===1?"Yesterday":day.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"short"});

  const items=communityLogs
    .filter(l=>(l.ts||"").slice(0,10)===dayStr)
    .sort((a,b)=>new Date(b.ts)-new Date(a.ts));
  const visible=items.slice(0,shown);

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
          {visible.map((l,i)=>{
            const bg=badgeFor(contribCounts?.[l.username]||0);
            const c=l.waitMins>15?"#ef4444":l.waitMins>8?"#f5a623":"#06c167";
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
                <span style={{fontSize:14}}>✅</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,...M,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <b style={{fontWeight:700}}>{(revealNames||l.username===myName)?l.username:"Driver"}</b>{bg&&<span style={{marginLeft:2}}>{bg.emoji}</span>} picked up at <b style={{fontWeight:700}}>{l.restaurantName||"a restaurant"}</b>
                  </div>
                  <div style={{fontSize:9,...M,color:"var(--muted)",marginTop:1}}>{new Date(l.ts).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</div>
                </div>
                {l.waitMins!=null&&<span style={{...B,fontSize:16,color:c,flexShrink:0}}>{l.waitMins}m</span>}
              </div>
            );
          })}
          {items.length>shown&&(
            <button onClick={()=>setShown(s=>s+20)} style={{marginTop:6,background:"var(--card)",border:"1px solid var(--border2)",borderRadius:10,padding:"12px",cursor:"pointer",...B,fontSize:12,letterSpacing:1,color:"#00b8a9"}}>{"LOAD MORE ("+(items.length-shown)+" left)"}</button>
          )}
        </div>
      )}
    </div>
  );
}

// Shift clock in/out — counts up while on shift, shows today's total. startedAt persists in
// localStorage so the timer keeps running across a refresh.
function fmtHM(mins){ const m=Math.max(0,Math.floor(mins)); return Math.floor(m/60)+"h "+String(m%60).padStart(2,"0")+"m"; }
function ShiftTimer({activeShift,completedToday,onStart,onEnd}){
  const [,tick]=useState(0);
  useEffect(()=>{ if(!activeShift)return; const id=setInterval(()=>tick(x=>x+1),1000); return ()=>clearInterval(id); },[!!activeShift]);
  if(activeShift){
    const elapsed=(Date.now()-new Date(activeShift.startedAt).getTime())/60000;
    return(
      <div style={{background:"linear-gradient(135deg,var(--tint-green),var(--tint-teal))",border:"1px solid #06c16744",borderRadius:14,padding:"14px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"#06c167",boxShadow:"0 0 8px #06c167",animation:"criticalPulse 1.5s ease-in-out infinite",display:"block"}}/>
            <span style={{fontSize:9,...B,color:"#06c167",letterSpacing:2}}>ON SHIFT</span>
          </div>
          <div style={{...B,fontSize:24,color:"var(--ink)",letterSpacing:1,marginTop:2,fontVariantNumeric:"tabular-nums"}}>{fmtHM(elapsed)}</div>
          <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:1}}>{"Today: "+fmtHM(completedToday+elapsed)+" total"}</div>
        </div>
        <button onClick={onEnd} style={{flexShrink:0,background:"#ef4444",border:"none",borderRadius:10,...B,fontSize:13,letterSpacing:1,color:"#fff",padding:"12px 16px",cursor:"pointer"}}>END SHIFT</button>
      </div>
    );
  }
  return(
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
      <button onClick={onStart} style={{flex:1,background:"#06c167",border:"none",borderRadius:12,...B,fontSize:15,letterSpacing:1,color:"#fff",padding:"14px",cursor:"pointer"}}>▶ START SHIFT</button>
      {completedToday>0&&<div style={{flexShrink:0,textAlign:"right"}}><div style={{fontSize:9,...M,color:"var(--muted2)",letterSpacing:1}}>TODAY</div><div style={{...B,fontSize:16,color:"var(--ink)"}}>{fmtHM(completedToday)}</div></div>}
    </div>
  );
}

// ── WAITS SCREEN ──────────────────────────────────────────────────────────────
function WaitsScreen({now,gps,restaurants,waitLog,activeWait,session,activeOrders,communityPatterns,communityLogs,checkingId,arrivalError,premium,manualVoted,activeCounts,reportedCounts,activeWaitsList,contribCounts,myName,revealNames,driverCount,activeShift,shiftCompletedToday,onStartShift,onEndShift,queueAlerts,queueAlertsSent,onQueueAlert,onOpenLogbook,onArrived,onManualArrive,onPickedUp,onDelivered,onCancelWait}) {
  const [picking,setPicking]=useState(false);
  const [selectedRestaurant,setSelectedRestaurant]=useState(null);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [delivering,setDelivering]=useState(false);   // multi-order: showing "which order are you delivering?" selection
  const searchTimer=useRef(null);
  // Leave delivering mode automatically once every order has been delivered.
  useEffect(()=>{ if(!activeOrders||activeOrders.length===0) setDelivering(false); },[activeOrders?.length]);
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
    const term=q.trim().toLowerCase();
    const local=()=>restaurants.filter(r=>(r.name||"").toLowerCase().includes(term));
    searchTimer.current=setTimeout(async()=>{
      const results=await searchRestaurants(q,gps.lat,gps.lng);
      // Fallback: if Google returns nothing (offline / API quota exhausted), still
      // filter the already-loaded restaurant list locally so search keeps working.
      const list=results.length?results:local();
      // Show food places / restaurants first, then nearest by GPS.
      setSearchResults(rankResults(list,gps));
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
            const d=distMap[r.id]??r.dist;   // search results carry their own distance (ranked nearest-first)
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
          <div style={{...B,fontSize:34,color:"#00b8a9",letterSpacing:2}}>{t("w_title")}</div>
          <div style={{fontSize:10,color:"var(--muted2)",letterSpacing:1,marginTop:2}}>{per.toUpperCase()+" · "+dayLabel(now.getDay()).toUpperCase()}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5,background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"6px 10px",marginTop:4}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:{pending:"var(--muted)",acquiring:"#f5a623",active:"#06c167",error:"#00b8a9",denied:"#ef4444"}[gps.status]||"var(--muted)",boxShadow:"0 0 5px "+({pending:"var(--muted)",acquiring:"#f5a623",active:"#06c167",error:"#00b8a9",denied:"#ef4444"}[gps.status]||"var(--muted)")}}/>
          <span style={{fontSize:9,color:"var(--muted2)",letterSpacing:1}}>{gps.status==="active"?"±"+gps.accuracy+"m":gps.status.toUpperCase()}</span>
        </div>
      </div>

      <ShiftTimer activeShift={activeShift} completedToday={shiftCompletedToday} onStart={onStartShift} onEnd={onEndShift}/>

      {meta?.totalLogs>0&&(
        <div style={{background:"linear-gradient(135deg,var(--tint-green),var(--tint-green))",border:"1px solid #06c16722",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#06c167",boxShadow:"0 0 8px #06c167",animation:"criticalPulse 2.5s ease-in-out infinite"}}/>
            <span style={{...B,fontSize:14,color:"#06c167",letterSpacing:2}}>{t("w_communityLive")}</span>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{...M,fontSize:11,fontWeight:700,color:"#06c167"}}>{meta.totalLogs.toLocaleString()} logs</div>
            <div style={{fontSize:9,color:"#0a8f4f",letterSpacing:1}}>{(()=>{const n=Math.max(driverCount||0,meta.totalDrivers||0);return n+" driver"+(n!==1?"s":"");})()}</div>
          </div>
        </div>
      )}

      <LiveFeed activeWaitsList={activeWaitsList} communityLogs={communityLogs} contribCounts={contribCounts} onOpen={onOpenLogbook} myName={myName} revealNames={revealNames}/>

      {activeWait?(
        <div style={{background:"linear-gradient(135deg,var(--tint-coral),var(--tint-coral2))",border:"2px solid #00b8a9",borderRadius:16,padding:"20px",marginBottom:16,boxShadow:"0 0 40px #00b8a918"}}>
          <div style={{fontSize:9,color:"#00b8a9",letterSpacing:2,marginBottom:6}}>{"⏱ "+t("w_waitingAt")}</div>
          <div style={{...B,fontSize:28,color:"var(--ink)",letterSpacing:1,marginBottom:14}}>
            {(restaurants.find(r=>r.id===activeWait.restaurantId)||{name:activeWait.restaurantName||"Unknown"}).name}
          </div>
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}><LiveTimer startedAt={activeWait.startedAt}/></div>
          <EarningsLive session={session} pendingPayout={activeWait.payout} pendingPlatform={activeWait.platform}/>
          <div style={{display:"flex",gap:10}}>
            <button onClick={onPickedUp} style={{flex:1,minHeight:72,background:"#06c167",border:"none",borderRadius:12,...B,fontSize:24,letterSpacing:2,color:"#000",cursor:"pointer",boxShadow:"0 0 20px #06c16733"}}>{t("w_pickedUp")}</button>
            <button onClick={onCancelWait} style={{minHeight:72,width:72,background:"var(--border)",border:"1px solid var(--faint2)",borderRadius:12,...B,fontSize:22,color:"var(--muted2)",cursor:"pointer"}}>✕</button>
          </div>
          <div style={{fontSize:9,color:"var(--muted2)",textAlign:"center",marginTop:10,letterSpacing:1}}>{t("w_tapHint")}</div>
        </div>
      ):delivering&&activeOrders.length>0?(
        /* PROCEED TO DELIVER (2+ orders): pick which order is being handed over, mark delivered, loop */
        <div style={{background:"linear-gradient(135deg,var(--tint-teal),var(--tint-green))",border:"2px solid #06c167",borderRadius:16,padding:"18px",marginBottom:16}}>
          <div style={{fontSize:9,color:"#06c167",letterSpacing:2,marginBottom:12}}>WHICH ORDER ARE YOU DELIVERING?</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
            {activeOrders.map(o=>(
              <button key={o.id} onClick={()=>onDelivered(o.id)} style={{display:"flex",alignItems:"center",gap:10,background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"14px 16px",cursor:"pointer",textAlign:"left",width:"100%"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:15,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.restaurantName||"Order"}</div>
                  <div style={{fontSize:10,...M,color:"var(--muted)",marginTop:1}}>{fmtGBP(o.payout)+(o.platform?" · "+o.platform:"")}</div>
                </div>
                <span style={{...B,fontSize:12,color:"#06c167",letterSpacing:1,flexShrink:0}}>{t("w_delivered")}</span>
              </button>
            ))}
          </div>
          <button onClick={()=>setDelivering(false)} style={{width:"100%",background:"var(--card)",border:"1px solid var(--border2)",borderRadius:12,padding:"12px",cursor:"pointer",...B,fontSize:13,color:"var(--muted2)"}}>‹ BACK</button>
        </div>
      ):activeOrders.length>0?(
        /* OUT FOR DELIVERY — one order keeps the simple DELIVERED button; 2+ adds PROCEED TO DELIVER */
        <div style={{background:"linear-gradient(135deg,var(--tint-amber),var(--tint-coral))",border:"1px solid #f5a62366",borderRadius:16,padding:"16px",marginBottom:12}}>
          <div style={{fontSize:8,color:"var(--muted2)",letterSpacing:2,marginBottom:10}}>{activeOrders.length>1?activeOrders.length+" ORDERS OUT FOR DELIVERY":"OUT FOR DELIVERY"}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:14}}>
            {activeOrders.map(o=>(
              <div key={o.id} style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18}}>🛵</span>
                <div style={{flex:1,minWidth:0,...B,fontSize:14,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(o.restaurantName||"Order")}<span style={{...M,fontWeight:400,fontSize:11,color:"var(--muted)"}}>{o.platform?" · "+o.platform:""}</span></div>
                <span style={{...B,fontSize:14,color:"#06c167",flexShrink:0}}>{fmtGBP(o.payout)}</span>
              </div>
            ))}
          </div>
          {activeOrders.length===1?(
            <button onClick={()=>onDelivered(activeOrders[0].id)} style={{width:"100%",minHeight:60,background:"#06c167",border:"none",borderRadius:12,...B,fontSize:20,letterSpacing:2,color:"#fff",cursor:"pointer",boxShadow:"0 0 20px #06c16733",marginBottom:10}}>{t("w_delivered")}</button>
          ):(
            <button onClick={()=>setDelivering(true)} style={{width:"100%",minHeight:60,background:"#06c167",border:"none",borderRadius:12,...B,fontSize:18,letterSpacing:1,color:"#fff",cursor:"pointer",boxShadow:"0 0 20px #06c16733",marginBottom:10}}>PROCEED TO DELIVER</button>
          )}
          <button onClick={()=>setPicking(true)} style={{width:"100%",minHeight:48,background:"var(--card)",border:"1px solid #00b8a9",borderRadius:12,...B,fontSize:14,letterSpacing:1,color:"#00b8a9",cursor:"pointer"}}>+ ADD DELIVERY</button>
          <div style={{fontSize:9,color:"var(--muted2)",textAlign:"center",marginTop:9,letterSpacing:1}}>EARNINGS COUNT WHEN YOU MARK DELIVERED</div>
        </div>
      ):(
        /* No active wait and nothing out for delivery — the normal ARRIVED entry */
        <button onClick={()=>setPicking(true)} style={{width:"100%",minHeight:80,background:"#ff5a2d",border:"none",borderRadius:18,...B,fontWeight:700,fontSize:24,letterSpacing:1,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,boxShadow:"0 8px 20px #ff5a2d40"}}>
          {t("w_arrived")}
        </button>
      )}

      {!premium&&<AdBanner premium={premium}/>}

      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {sorted.map((r,idx)=>{
          const ck=cardKey(r);
          const personal=getPersonalWait(ck,now,waitLog);
          const community=getCommunityWait(ck,now,communityPatterns);
          const usePersonal=personal?.hasEnough;
          // Big number prefers COMMUNITY data, falling back to your own
          const useCommunity=community!=null;
          const hasReal=useCommunity||usePersonal;
          const realAvg=useCommunity?community.avg:usePersonal?personal.avg:null;
          const dataSource=useCommunity?t("w_community"):usePersonal?t("w_yourData"):null;
          const closed=r.openNow===false;
          const waitingNow=activeCounts[ck]||0;
          const rep=reportedCounts?.[ck];
          const repFresh=rep&&(now.getTime()-new Date(rep.ts).getTime()<REPORTED_COUNT_TTL_MS);
          const reportedWaiting=repFresh?rep.count:null;
          const reportedAgo=repFresh?Math.max(0,Math.round((now.getTime()-new Date(rep.ts).getTime())/60000)):null;
          const qa=queueAlerts?.[ck];
          const qaFresh=qa&&(now.getTime()-new Date(qa.ts).getTime()<QUEUE_ALERT_TTL_MS);
          const qaAgo=qaFresh?Math.max(0,Math.round((now.getTime()-new Date(qa.ts).getTime())/60000)):null;
          const qaSent=queueAlertsSent?.[ck];
          const qaCooldown=qaSent&&(now.getTime()-qaSent<QUEUE_ALERT_COOLDOWN_MS);
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
                  <div style={{fontSize:9,marginTop:2,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    {waitingNow>0
                      ? <span style={{color:"#06c167",fontWeight:700}}>🟢 {waitingNow} waiting now</span>
                      : <span style={{color:"var(--muted)"}}>{closed?t("w_closedNow"):t("w_noOne")}</span>}
                    {reportedWaiting!=null&&<span style={{color:"#ff5a2d",fontWeight:700}}>👥 {reportedWaiting} reported{reportedAgo!=null?" · "+reportedAgo+"m ago":""}</span>}
                    {qaFresh&&<span style={{color:"#fff",background:"#ef4444",fontWeight:700,borderRadius:5,padding:"2px 7px",letterSpacing:0.3}}>⚠ LONG QUEUE{qaAgo!=null?" · "+qaAgo+"m ago":""}</span>}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                  {closed?(
                    <div style={{...B,fontSize:20,color:"var(--muted2)",letterSpacing:1}}>CLOSED</div>
                  ):hasReal?(<>
                    <div style={{...B,fontSize:34,color:riskColor,letterSpacing:1,lineHeight:1}}>{realAvg}m</div>
                    <div style={{fontSize:9,color:"var(--muted2)",marginTop:1}}>{dataSource}</div>
                  </>):(
                    <div style={{...B,fontSize:15,color:"var(--faint)",letterSpacing:1}}>{t("w_noData")}</div>
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
                    <div style={{fontSize:8,color:"#06c167",letterSpacing:2,marginBottom:2}}>{t("w_yourData")}</div>
                    <div style={{...B,fontSize:17,color:"#06c167",letterSpacing:1}}>{personal.avg}m</div>
                    <div style={{fontSize:8,color:"#0a8f4f",marginTop:1}}>{personal.bucketCount}v · {personal.context}</div>
                  </div>
                ):personal?(
                  <div style={{flex:1,minWidth:80,background:"var(--card)",border:"1px solid #00b8a933",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#00b8a9",letterSpacing:2,marginBottom:2}}>{t("w_yourData")}</div>
                    <div style={{...B,fontSize:17,color:"#00b8a9",letterSpacing:1}}>{personal.avg}m</div>
                    <div style={{fontSize:8,color:"var(--muted2)",marginTop:1}}>1 visit</div>
                  </div>
                ):(
                  <div style={{flex:1,minWidth:80,background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"var(--faint)",letterSpacing:2,marginBottom:2}}>{t("w_yourData")}</div>
                    <div style={{...B,fontSize:14,color:"var(--faint2)",letterSpacing:1}}>NONE YET</div>
                  </div>
                )}
                {community?(
                  <div style={{flex:1,minWidth:80,background:"var(--tint-blue)",border:"1px solid #2b8fff33",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"#2b8fff",letterSpacing:2,marginBottom:2}}>{t("w_community")}</div>
                    <div style={{...B,fontSize:17,color:"#2b8fff",letterSpacing:1}}>{community.avg}m</div>
                    <div style={{fontSize:8,color:"#1c6fd0",marginTop:1}}>{community.count} logs · {community.drivers}d</div>
                  </div>
                ):(
                  <div style={{flex:1,minWidth:80,background:"var(--card)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 10px"}}>
                    <div style={{fontSize:8,color:"var(--border2)",letterSpacing:2,marginBottom:2}}>{t("w_community")}</div>
                    <div style={{...B,fontSize:14,color:"var(--border)",letterSpacing:1}}>NO DATA</div>
                  </div>
                )}
                <div style={{minWidth:72,background:waitingNow>0?"var(--tint-green)":"var(--card)",border:"1px solid "+(waitingNow>0?"#06c16744":"var(--border)"),borderRadius:8,padding:"7px 10px"}}>
                  <div style={{fontSize:8,color:waitingNow>0?"#06c167":"var(--faint)",letterSpacing:2,marginBottom:2}}>{t("w_waitingNow")}</div>
                  <div style={{...B,fontSize:17,color:waitingNow>0?"#06c167":"var(--faint2)",letterSpacing:1}}>{waitingNow}</div>
                  <div style={{fontSize:8,color:waitingNow>0?"#0a8f4f":"var(--faint2)",marginTop:1}}>{t("w_liveNow")}</div>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {closed?(
                  <span style={{fontSize:9,background:"var(--border)",color:"var(--muted2)",border:"1px solid var(--faint2)",borderRadius:5,padding:"3px 8px"}}>CLOSED</span>
                ):riskLabel?(
                  <span style={{fontSize:9,background:riskColor+"22",color:riskColor,border:"1px solid "+riskColor+"44",borderRadius:5,padding:"3px 8px"}}>{riskLabel}</span>
                ):(
                  <span style={{fontSize:9,background:"var(--border)",color:"var(--muted2)",border:"1px solid var(--border)",borderRadius:5,padding:"3px 8px"}}>{t("w_noData")}</span>
                )}
                {myLogs.length>0&&<span style={{fontSize:9,color:"var(--muted2)"}}>{myLogs.length+" visit"+(myLogs.length!==1?"s":"")}</span>}
                <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
                  {!closed&&<button onClick={e=>{e.stopPropagation();onQueueAlert(r);}} disabled={qaCooldown} title="Warn nearby drivers of a long queue" style={{background:qaCooldown?"var(--border)":"var(--tint-red)",border:"1px solid "+(qaCooldown?"var(--faint2)":"#ef444466"),borderRadius:7,...B,fontSize:9,letterSpacing:0.3,color:qaCooldown?"var(--muted2)":"#ef4444",cursor:qaCooldown?"default":"pointer",padding:"6px 9px",minHeight:32}}>{qaCooldown?"ALERTED ✓":"⚠ QUEUE ALERT"}</button>}
                  {!isActive&&<button onClick={e=>{e.stopPropagation();onArrived(r);}} disabled={isChecking} style={{background:isChecking?"var(--tint-coral)":hasError?"var(--tint-red)":"#00b8a9",border:isChecking?"1px solid #00b8a944":hasError?"1px solid #ef444444":"none",borderRadius:7,...B,fontSize:hasError?11:13,letterSpacing:1,color:isChecking?"#00b8a9":hasError?"#ef4444":"#000",cursor:isChecking?"default":"pointer",padding:"6px 14px",minHeight:32}}>{isChecking?"CHECKING...":hasError?arrivalError.dist+"M AWAY":t("w_arrivedShort")}</button>}
                  {isActive&&<span style={{fontSize:10,...B,color:"#00b8a9",letterSpacing:1,animation:"criticalPulse 1.5s ease-in-out infinite"}}>{t("w_timingNow")}</span>}
                </div>
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>

      {waitLog.length>0&&(
        <div style={{marginTop:20}}>
          <div style={{...B,fontSize:16,color:"var(--faint2)",letterSpacing:2,marginBottom:8}}>{t("w_recent")}</div>
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


// ── CHECK SCREEN ─────────────────────────────────────────────────────────────
function CheckScreen({restaurants,communityPatterns,waitLog,now,gps,activeCounts,reportedCounts}) {
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
    const term=q.trim().toLowerCase();
    searchTimer.current=setTimeout(async()=>{
      let places=await searchRestaurants(q,gps.lat,gps.lng);
      // Fallback: if Google returns nothing (offline / API quota exhausted), still
      // filter the already-loaded restaurant list locally so search keeps working.
      if(!places.length)places=restaurants.filter(r=>(r.name||"").toLowerCase().includes(term));
      // Show food places / restaurants first, then nearest by GPS.
      setResults(rankResults(places,gps));
      setSearching(false);
    },400);
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
        <div style={{...B,fontSize:34,color:"#00b8a9",letterSpacing:2}}>{t("chk_title")}</div>
        <div style={{fontSize:10,color:"var(--muted2)",letterSpacing:1,marginTop:2}}>{query.trim()?t("chk_results"):t("chk_nearby")}</div>
      </div>
      <div style={{position:"relative",marginBottom:14}}>
        <input value={query} onChange={e=>handleInput(e.target.value)} placeholder={t("chk_search")}
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
          const waitingNow=activeCounts?.[lid]||0;
          const rep=reportedCounts?.[lid];
          const repFresh=rep&&(now.getTime()-new Date(rep.ts).getTime()<REPORTED_COUNT_TTL_MS);
          const reportedWaiting=repFresh?rep.count:null;
          const reportedAgo=repFresh?Math.max(0,Math.round((now.getTime()-new Date(rep.ts).getTime())/60000)):null;
          const closed=r.openNow===false;
          const d=r.dist??distOf(r);
          const dStr=d!=null?(d<1000?Math.round(d)+"m":(d/1000).toFixed(1)+"km"):null;
          return(
            <div key={r.id+i} onClick={()=>setSelected(r)} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",opacity:closed?0.72:1,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...B,fontSize:18,color:"var(--ink)",letterSpacing:1}}>{r.name}</div>
                  {r.address&&<div style={{fontSize:9,color:"var(--muted)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.address}</div>}
                  <div style={{fontSize:9,marginTop:3,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    {closed
                      ? <span style={{color:"var(--muted2)",fontWeight:700}}>● CLOSED right now</span>
                      : waitingNow>0
                        ? <span style={{color:"#06c167",fontWeight:700}}>🟢 {waitingNow} waiting now</span>
                        : community
                          ? <span style={{color:"#2b8fff",fontWeight:700}}>~{community.avg}m typical wait</span>
                          : <span style={{color:"var(--muted)"}}>No wait data yet</span>}
                    {reportedWaiting!=null&&<span style={{color:"#ff5a2d",fontWeight:700}}>👥 {reportedWaiting} reported{reportedAgo!=null?" · "+reportedAgo+"m ago":""}</span>}
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
    {id:"waits",icon:"⏱",label:t("nav_waits"),dot:activeWait,  dotColor:"#00b8a9"},
    {id:"check",icon:"🔍",label:t("nav_check"),dot:false,       dotColor:"#2b8fff"},
    {id:"stats",icon:"📊",label:t("nav_stats"),dot:false,       dotColor:"#f5a623"},
    {id:"chat", icon:"💬",label:t("nav_chat"), dot:unreadChat,  dotColor:"#06c167"},
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
// First-login prompt explaining notifications are for wait reminders only.
function NotifPrompt({onAllow,onSkip}){
  return(
    <div onClick={onSkip} style={{position:"fixed",inset:0,zIndex:650,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 22px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:18,padding:"22px",boxShadow:"0 12px 40px rgba(0,0,0,0.4)",width:"100%",maxWidth:380,textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:8}}>🔔</div>
        <div style={{...B,fontSize:18,color:"#00b8a9",letterSpacing:1,marginBottom:8}}>WAIT TIME REMINDERS</div>
        <div style={{fontSize:13,...M,color:"var(--muted)",lineHeight:1.6,marginBottom:20}}>Allow notifications so we can remind you to tap GOT IT while you wait — even if your phone is locked or you&apos;re in another app like Uber Eats. We only send wait-time reminders. Nothing else.</div>
        <button onClick={onAllow} style={{width:"100%",background:"#06c167",border:"none",borderRadius:12,padding:"14px",cursor:"pointer",...B,fontSize:15,color:"#fff",letterSpacing:1,marginBottom:10}}>ALLOW NOTIFICATIONS</button>
        <button onClick={onSkip} style={{width:"100%",background:"none",border:"none",cursor:"pointer",...B,fontSize:13,color:"var(--muted2)",letterSpacing:1}}>NOT NOW</button>
      </div>
    </div>
  );
}

const TAB_ORDER=["waits","check","stats","chat"];   // swipe order: left = next, right = previous

export default function App() {
  const [user,setUser]          =useState(()=>store.get("delivr_user")||null);
  const [pendingVerify,setPendingVerify]=useState(null);
  const [screen,setScreen]=useState(()=>store.get("delivr_tab")||"waits");  // restore last tab on refresh
  const [navDir,setNavDir]=useState(0);   // -1/+1 direction of the last tab change (drives the slide animation)
  const swipeRef=useRef(null);            // touch-start position for swipe detection
  const [showNotifPrompt,setShowNotifPrompt]=useState(false);   // first-login notification ask
  const [showProfile,setShowProfile]=useState(false);
  const [showUpgrade,setShowUpgrade]=useState(false);
  const [showStats,setShowStats]=useState(false);
  const [showLogbook,setShowLogbook]=useState(false);
  const [reminder,setReminder]=useState(null);   // in-app "still waiting?" notification text
  const [theme,setTheme]=useState(()=>store.get("delivr_theme")||"light");
  const [onboarded,setOnboarded]=useState(()=>!!store.get("delivr_onboarded"));
  const [startRegister,setStartRegister]=useState(false);
  const [lang,setLang]=useState(()=>store.get("delivr_lang")||null);
  const [disclaimerOk,setDisclaimerOk]=useState(()=>!!store.get("delivr_disclaimer"));
  _lang=lang||"en";   // make t() use the current language for all child screens this render
  const premium=!!user?.premium||hasAdminPerks(user);   // delegated admins get premium perks

  // Apply + persist the colour theme
  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    store.set("delivr_theme",theme);
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute("content",theme==="dark"?"#0e1316":"#ffffff");
  },[theme]);
  const toggleTheme=()=>setTheme(t=>t==="dark"?"light":"dark");

  // Apply language direction (RTL for Arabic & Urdu)
  useEffect(()=>{
    const rtl=lang==="ar"||lang==="ur";
    document.documentElement.lang=lang||"en";
    document.documentElement.dir=rtl?"rtl":"ltr";
  },[lang]);
  function chooseLang(code){ setLang(code); store.set("delivr_lang",code); }
  const [now,setNow]      =useState(new Date());
  const [restaurants,setRestaurants]=useState(()=>store.get("delivr_restaurants")||CURATED);  // cached list shows instantly; refreshed on next nearby fetch
  const [waitLog,setWaitLog]=useState(()=>store.get("delivr_waitlog")||[]);
  const [activeWait,setActiveWait]=useState(()=>store.get("delivr_activewait")||null);
  const [session,setSession]=useState(()=>store.get("delivr_session")||null);   // earnings session (anchored to first ARRIVED)
  // Orders picked up but not yet DELIVERED (supports multi-delivery / stacked orders). Migrates
  // a legacy single pending order. Earnings bank per-order when the driver marks it delivered.
  const [activeOrders,setActiveOrders]=useState(()=>{
    const arr=store.get("delivr_activeorders");
    if(arr)return arr;
    const old=store.get("delivr_pendingorder");
    return old?[{...old,id:old.id||genId()}]:[];
  });
  const saveOrders=arr=>{ setActiveOrders(arr); store.set("delivr_activeorders",arr); };
  // Shift timer — clock in/out. activeShift survives refresh (localStorage); completed time today
  // is accumulated locally and each shift is also saved to Firestore (users/{uid}/shifts).
  const [activeShift,setActiveShift]=useState(()=>store.get("delivr_shift")||null);   // {startedAt} | null
  const [shiftToday,setShiftToday]=useState(()=>{
    const s=store.get("delivr_shifttoday");
    return (s&&s.date===new Date().toDateString())?s:{date:new Date().toDateString(),mins:0};
  });
  const [earningsLog,setEarningsLog]=useState([]);                               // this driver's own logged orders
  const [earningsPopup,setEarningsPopup]=useState(null);                         // {restaurantName} shown after a successful ARRIVED
  const [tipPrompt,setTipPrompt]=useState(null);                                 // {order} shown after a delivery is marked DELIVERED
  const [communityPatterns,setCommunityPatterns]=useState(()=>{   // cached averages (<30min) show instantly; live listener refreshes in the background
    const c=store.get("delivr_patterns");
    return (c&&c.ts&&Date.now()-c.ts<30*60*1000&&c.data)?c.data:{};
  });
  const [communityLogs,setCommunityLogs]=useState([]);
  const [unreadChat,setUnreadChat]=useState(false);
  const [checkingId,setCheckingId]=useState(null);
  const [arrivalError,setArrivalError]=useState(null);
  const [pinnedLocations,setPinnedLocations]=useState({});
  const [manualVoted,setManualVoted]=useState(null);
  const [gpsSkipped,setGpsSkipped]=useState(false);   // user chose to continue without location
  const [activeCounts,setActiveCounts]=useState({});  // restaurantId → # drivers waiting now
  const [activeWaitsList,setActiveWaitsList]=useState([]); // live active waits for the feed
  const [reportedCounts,setReportedCounts]=useState({});   // chain key → driver-reported {count,ts} (20-min TTL applied on render)
  const [queueAlerts,setQueueAlerts]=useState({});         // chain key → {ts,username} long-queue alert (area-specific, 20-min TTL)
  const [queueAlertsSent,setQueueAlertsSent]=useState(()=>store.get("delivr_qalerts_sent")||{});  // chain key → last-sent ms (10-min cooldown)
  const [driverCount,setDriverCount]=useState(0);          // live roster size
  const [signupCount,setSignupCount]=useState(0);          // true total sign-ups (backend)
  const lastFetchRef=useRef({lat:null,lng:null});
  const bankingRef=useRef(false);   // guards the idle auto-bank effect against re-entry
  const dayRef=useRef(startOfDayMs(new Date()));   // tracks the current calendar day for the midnight reset
  const gps=useGPS();

  // Which listeners a screen actually needs. The presence/location/count listeners only feed
  // the WAITS, CHECK (and owner APP STATS) views — they stay disconnected on STATS/CHAT so we
  // hold no live Firestore subscriptions the visible screen can't use. The personal earnings
  // listener attaches only while the STATS tab is open. The community waitLogs listener stays
  // global because patterns + contributor badges are read on nearly every screen.
  const liveTabActive = screen==="waits"||screen==="check"||showStats;
  const earningsActive = screen==="stats";

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

  // Live Firestore listener for community patterns — updates instantly when any driver logs.
  // Capped at the 500 most-recent logs so memory stays bounded as the app scales.
  useEffect(()=>{
    const q=query(collection(db,"waitLogs"),orderBy("ts","desc"),limit(500));
    const unsub=onSnapshot(q,snap=>{
      const logs=snap.docs.map(d=>d.data());
      const patterns=computePatterns(logs);
      setCommunityPatterns(patterns);
      setCommunityLogs(logs);
      store.set("delivr_patterns",{ts:Date.now(),data:patterns});   // cache averages for instant load next time
    },()=>{});
    return unsub;
  },[]);

  // Live listener for THIS driver's own earnings — personal only, never anyone else's.
  // Only attached while the STATS tab is open; disconnects on navigate-away. Waits for Firebase
  // Auth to finish restoring (auth.currentUser is null on first mount, so reading it
  // synchronously on a refresh would miss the session and never re-attach).
  useEffect(()=>{
    if(!earningsActive)return;
    let unsubSnap=null;
    const unsubAuth=onAuthStateChanged(auth,fbUser=>{
      if(unsubSnap){unsubSnap();unsubSnap=null;}
      if(!fbUser){setEarningsLog([]);return;}
      unsubSnap=onSnapshot(collection(db,"users",fbUser.uid,"earnings"),snap=>{
        setEarningsLog(snap.docs.map(d=>({...d.data(),id:d.id})));   // id = Firestore doc id, for edit/delete
      },()=>{});
    });
    return ()=>{ if(unsubSnap)unsubSnap(); unsubAuth(); };
  },[earningsActive]);

  // Live listener for crowd-sourced pinned restaurant locations (WAITS/CHECK only)
  useEffect(()=>{
    if(!liveTabActive)return;
    const unsub=onSnapshot(collection(db,"restaurantLocations"),snap=>{
      const m={};snap.docs.forEach(d=>{m[d.id]=d.data();});
      setPinnedLocations(m);
    },()=>{});
    return unsub;
  },[liveTabActive]);

  // Live driver count — register self into the public "drivers" collection, then listen to its size
  useEffect(()=>{
    if(!user||!auth.currentUser)return;
    try{ setDoc(doc(db,"drivers",auth.currentUser.uid),{joinedAt:new Date().toISOString()},{merge:true}); }catch(e){}
  },[user]);
  useEffect(()=>{
    if(!liveTabActive)return;
    const unsub=onSnapshot(collection(db,"drivers"),snap=>setDriverCount(snap.size),()=>{});
    return unsub;
  },[liveTabActive]);
  // True total sign-ups from the backend (Firebase Admin) — refreshed periodically while on a live tab
  useEffect(()=>{
    if(!user||!liveTabActive)return;
    const load=()=>fetch(`${API_URL}/stats/drivers`).then(r=>r.json()).then(d=>{if(d.count)setSignupCount(d.count);}).catch(()=>{});
    load();
    const id=setInterval(load,120000);
    return ()=>clearInterval(id);
  },[user,liveTabActive]);

  // Live listener for who's waiting right now (real-time presence; WAITS/CHECK only)
  useEffect(()=>{
    if(!liveTabActive)return;
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
  },[liveTabActive]);

  // Live listener for driver-reported queue counts (latest per restaurant; WAITS/CHECK only)
  useEffect(()=>{
    if(!liveTabActive)return;
    const unsub=onSnapshot(collection(db,"restaurantCounts"),snap=>{
      const m={};snap.docs.forEach(d=>{const c=d.data();m[d.id]={count:c.count,ts:c.ts};});
      setReportedCounts(m);
    },()=>{});
    return unsub;
  },[liveTabActive]);

  // Live listener for area-specific long-queue alerts (only drivers in the same area see them)
  useEffect(()=>{
    if(!liveTabActive)return;
    const area=user?.area||"general";
    const unsub=onSnapshot(query(collection(db,"queueAlerts"),where("area","==",area)),snap=>{
      const m={};snap.docs.forEach(d=>{const a=d.data();if(a.key)m[a.key]={ts:a.ts,username:a.username};});
      setQueueAlerts(m);
    },()=>{});
    return unsub;
  },[liveTabActive,user?.area]);

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),15000);return ()=>clearInterval(id);},[]);

  // MIDNIGHT HARD RESET — when the calendar day rolls over, the earnings session starts fresh
  // (sessionStart = midnight, earnings = 0), so previous-day session time/earnings never count
  // toward today's £/hour or live clock. The active wait / out-for-delivery orders are untouched.
  useEffect(()=>{
    const today=startOfDayMs(now);
    if(today===dayRef.current)return;
    dayRef.current=today;
    if(session){
      const fresh={sessionId:genId(),sessionStart:new Date(today).toISOString(),totalEarnings:0,lastActivity:new Date().toISOString()};
      setSession(fresh);store.set("delivr_session",fresh);
    }
  },[now]);

  // Safety net: auto-bank any orders left undelivered once the shift goes idle (~6h), so the
  // last orders of a shift are never lost if the driver forgot to mark them delivered. Uses an
  // estimated delivery leg. Runs on the 15s `now` tick; also catches orders left from a prior session.
  useEffect(()=>{
    if(!activeOrders.length||bankingRef.current)return;
    const newest=Math.max(...activeOrders.map(o=>new Date(o.pickedUpAt).getTime()));
    if(now.getTime()-newest<=SESSION_GAP_MS)return;
    bankingRef.current=true;
    let sess=session||{sessionId:genId(),sessionStart:activeOrders[0].arrivedAt,totalEarnings:0,lastActivity:activeOrders[0].pickedUpAt};
    for(const o of activeOrders) sess=bankOrder(o,sess,(o.waitMins||0)+DEFAULT_DELIVERY_MINS);
    setSession(sess);store.set("delivr_session",sess);
    saveOrders([]);store.del("delivr_pendingorder");
    bankingRef.current=false;
  },[activeOrders,now]);

  // Wait reminders at 5 / 10 / 30 min into an open wait — in-app banner (shown on every tab via
  // the toast below) + a local browser notification if allowed. The 60-min auto-removal is handled
  // separately so it also fires after the app was reopened.
  useEffect(()=>{
    if(!activeWait){setReminder(null);return;}
    const start=new Date(activeWait.startedAt).getTime();
    const name=activeWait.restaurantName||"the restaurant";
    const schedule=[
      [5,  `Still waiting at ${name}? Tap GOT IT when you have your food.`],
      [10, `You have been waiting at ${name} for 10 minutes — tap GOT IT when ready.`],
      [30, `Still at ${name}? Tap GOT IT or your session will be removed.`],
    ];
    const timers=[];
    schedule.forEach(([min,msg])=>{
      const delay=start+min*60000-Date.now();
      if(delay>0)timers.push(setTimeout(()=>{
        setReminder(msg);
        try{ if(window.Notification&&Notification.permission==="granted")new Notification("DELIVR",{body:msg}); }catch(e){}
      },delay));
    });
    return ()=>timers.forEach(clearTimeout);
  },[activeWait?.startedAt]);

  // 60-min UNPICKED REMOVAL — if ARRIVED was pressed but GOT IT never was, after 60 min the wait
  // session is removed completely: no waitLog is written (so it never counts toward stats or
  // community averages) and the live presence doc is deleted. Runs on the 15s tick so it also
  // catches a stale wait left from before the app was reopened.
  const removedWaitRef=useRef(false);
  useEffect(()=>{
    if(!activeWait){removedWaitRef.current=false;return;}
    if(removedWaitRef.current)return;
    const ageMs=now.getTime()-new Date(activeWait.startedAt).getTime();
    if(ageMs<60*60000)return;
    removedWaitRef.current=true;
    const name=activeWait.restaurantName||"the restaurant";
    const msg=`Your wait at ${name} was not completed and has been removed. No data was logged.`;
    setReminder(msg);
    try{ if(window.Notification&&Notification.permission==="granted")new Notification("DELIVR",{body:msg}); }catch(e){}
    setActiveWait(null);store.set("delivr_activewait",null);
    try{ deleteDoc(doc(db,"activeWaits",auth.currentUser.uid)); }catch(e){}
  },[now,activeWait]);

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
    // Persisted last-fetch position + time (survives reloads). Restaurant locations are cached in
    // localStorage and considered valid for 24h. We hit the API ONLY when there's no cache yet,
    // OR the cache is older than 24h, OR the driver has moved >2km from where it was built.
    // Within those bounds: ZERO API calls.
    const last=lastFetchRef.current.lat!=null?lastFetchRef.current:(store.get("delivr_lastfetch")||{lat:null,lng:null,ts:0});
    const haveCache=!!store.get("delivr_restaurants");
    const ageMs=last.lat!=null?Date.now()-(last.ts||0):Infinity;
    const movedMeters=last.lat!=null?distMeters(last.lat,last.lng,gps.lat,gps.lng):Infinity;
    const needFetch=!haveCache||ageMs>=24*60*60*1000||movedMeters>2000;
    if(!needFetch)return;   // valid cache (<24h) and driver within 2km → no API call at all
    const pos={lat:gps.lat,lng:gps.lng,ts:Date.now()};
    lastFetchRef.current=pos; store.set("delivr_lastfetch",pos);
    // Curated chains first (cached branch locations, 24h), then other nearby places — all Mapbox.
    // If the API is unavailable it returns nothing and we keep the cached/hardcoded list.
    fetchNearbyRestaurants(gps.lat,gps.lng).then(async places=>{
      const list=await buildRestaurantList(places,gps.lat,gps.lng);
      if(list.length){ setRestaurants(list); store.set("delivr_restaurants",list); }   // persist for instant load next session
    }).catch(()=>{});
  },[gps.status,gps.lat,gps.lng]);

  function handleNav(s){
    const from=TAB_ORDER.indexOf(screen),to=TAB_ORDER.indexOf(s);
    if(from>=0&&to>=0&&to!==from)setNavDir(to>from?1:-1);   // for the slide animation
    if(s==="chat")setUnreadChat(false);
    setScreen(s);store.set("delivr_tab",s);
  }
  // Swipe left/right anywhere on the tab content to move between WAITS → CHECK → STATS → CHAT.
  // Only horizontal swipes act (vertical scrolling is untouched); overlays disable it.
  function onTabTouchStart(e){const t=e.touches[0];swipeRef.current={x:t.clientX,y:t.clientY,t:Date.now()};}
  function onTabTouchEnd(e){
    const st=swipeRef.current;swipeRef.current=null;
    if(!st||showProfile||showUpgrade||showStats||showLogbook)return;
    const t=e.changedTouches[0],dx=t.clientX-st.x,dy=t.clientY-st.y;
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.7&&Date.now()-st.t<700){
      const i=TAB_ORDER.indexOf(screen);if(i<0)return;
      if(dx<0&&i<TAB_ORDER.length-1)handleNav(TAB_ORDER[i+1]);
      else if(dx>0&&i>0)handleNav(TAB_ORDER[i-1]);
    }
  }

  function startShift(){
    if(activeShift)return;
    const s={startedAt:new Date().toISOString()};
    setActiveShift(s);store.set("delivr_shift",s);
  }
  function endShift(){
    if(!activeShift)return;
    const startMs=new Date(activeShift.startedAt).getTime();
    const nowMs=Date.now();
    const fullMins=Math.round((nowMs-startMs)/60000);
    const today=new Date().toDateString();
    const todayMins=(nowMs-Math.max(startMs,startOfDayMs(new Date())))/60000;   // only today's portion if it spanned midnight
    setShiftToday(prev=>{
      const base=(prev&&prev.date===today)?prev.mins:0;
      const next={date:today,mins:base+todayMins};
      store.set("delivr_shifttoday",next);
      return next;
    });
    const uid=auth.currentUser?.uid;
    if(uid)addDoc(collection(db,"users",uid,"shifts"),{startedAt:activeShift.startedAt,endedAt:new Date(nowMs).toISOString(),mins:fullMins,ts:new Date(nowMs).toISOString()}).catch(()=>{});
    setActiveShift(null);store.del("delivr_shift");
  }
  // Today's shift minutes (completed today + the running shift's today-portion) for the displays.
  const shiftCompletedToday=(shiftToday.date===new Date().toDateString())?shiftToday.mins:0;
  const shiftMinsToday=shiftCompletedToday+(activeShift?(now.getTime()-Math.max(new Date(activeShift.startedAt).getTime(),startOfDayMs(now)))/60000:0);

  // Send a long-queue alert for a restaurant to everyone in the same area (one per restaurant per
  // 10 min). Keyed area_chain so the latest overwrites; a 20-min TTL is applied on read.
  function sendQueueAlert(restaurant){
    const key=cardKey(restaurant);
    const nowMs=Date.now();
    if(queueAlertsSent[key]&&nowMs-queueAlertsSent[key]<QUEUE_ALERT_COOLDOWN_MS)return;   // cooldown
    const area=user?.area||"general";
    try{
      setDoc(doc(db,"queueAlerts",area+"_"+key),{
        key, area, restaurantId:restaurant.id, restaurantName:restaurant.name||"",
        username:user?.name||"anon", ts:new Date(nowMs).toISOString(),
      });
    }catch(e){}
    const sent={...queueAlertsSent,[key]:nowMs};
    setQueueAlertsSent(sent);store.set("delivr_qalerts_sent",sent);
  }

  // Push notifications: on an already-granted device, register/refresh the FCM token; on first
  // login (permission still default) show the explained opt-in prompt (wait reminders only).
  useEffect(()=>{
    if(!user||typeof Notification==="undefined")return;
    if(Notification.permission==="granted"){
      const unsub=onAuthStateChanged(auth,fb=>{ if(fb)setupPush(fb.uid); });
      return unsub;
    }
    if(Notification.permission==="default"&&!store.get("delivr_notif_asked"))setShowNotifPrompt(true);
  },[user]);
  function allowNotifs(){
    store.set("delivr_notif_asked",true);setShowNotifPrompt(false);
    if(typeof Notification!=="undefined")Notification.requestPermission().then(p=>{ if(p==="granted")setupPush(auth.currentUser?.uid); }).catch(()=>{});
  }
  function skipNotifs(){ store.set("delivr_notif_asked",true);setShowNotifPrompt(false); }

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
          if(list.length){ setRestaurants(list); store.set("delivr_restaurants",list); }
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
    // Earnings session: anchored to the very first ARRIVED of the shift. Orders no longer bank
    // here — each banks when the driver taps DELIVERED — so ARRIVED just keeps the session alive.
    const arrivedMs=new Date(a.startedAt).getTime();
    const continuing=session&&(arrivedMs-new Date(session.lastActivity||session.sessionStart).getTime()<=SESSION_GAP_MS);
    let sess;
    if(continuing){
      sess={...session,lastActivity:a.startedAt};
    }else{
      // Long idle gap → new shift. Safety-bank any orders left undelivered from the old shift
      // (estimated leg), then start fresh.
      if(activeOrders.length&&session){ let s=session; for(const o of activeOrders) s=bankOrder(o,s,(o.waitMins||0)+DEFAULT_DELIVERY_MINS); }
      if(activeOrders.length){ saveOrders([]); store.del("delivr_pendingorder"); }
      sess={sessionId:genId(),sessionStart:a.startedAt,totalEarnings:0,lastActivity:a.startedAt};
    }
    setSession(sess);store.set("delivr_session",sess);
    // Optional earnings popup — driver can skip it
    setEarningsPopup({restaurantName:restaurant.name});
    // Ask for notification permission (on this tap gesture) so 20/40-min reminders can show
    try{ if(window.Notification&&Notification.permission==="default")Notification.requestPermission(); }catch(e){}
    // Add to live "waiting now" presence list
    try{ await setDoc(doc(db,"activeWaits",auth.currentUser.uid),{restaurantId,restaurantName:restaurant.name,startedAt:a.startedAt,username:user?.name||"anon"}); }catch(e){}
    return true;
  }

  // Save the optional popup fields. Payout (+ platform) is attached to the active wait
  // and counted on GOT IT; the reported driver count is shared live with nearby drivers.
  function handleSaveEarnings({platform,payout,count}){
    if(payout!=null&&platform){
      setActiveWait(prev=>{
        if(!prev)return prev;
        const n={...prev,platform,payout};
        store.set("delivr_activewait",n);
        return n;
      });
    }
    if(count!=null&&activeWait){
      // Latest report wins (doc keyed per restaurant); a 20-min TTL is applied on read.
      const key=chainKeyFromName(activeWait.restaurantName)||activeWait.restaurantId;
      try{
        setDoc(doc(db,"restaurantCounts",key),{
          count, restaurantId:activeWait.restaurantId, restaurantName:activeWait.restaurantName||"",
          username:user?.name||"anon", ts:new Date().toISOString(),
        });
      }catch(e){}
    }
    setEarningsPopup(null);
  }

  // Bank a picked-up order into its session: add the payout to the session total and write
  // the private earnings doc. cycleMins is the order's real ARRIVED→next-ARRIVED window
  // (wait + drive + deliver). Returns the updated session synchronously; the Firestore
  // writes are fire-and-forget so the UI never blocks on the network.
  function bankOrder(order,sess,cycleMins){
    const pickedUp=new Date(order.pickedUpAt);
    const tip=Number(order.tip)||0;
    const finalCycle=Math.round(Math.max(order.waitMins||0,cycleMins)*10)/10;
    // When this order was DELIVERED (ARRIVED + its full cycle). Used to measure the session's
    // real working time (first ARRIVED → last DELIVERED) for an accurate £/hour.
    const deliveredAt=order.arrivedAt?new Date(new Date(order.arrivedAt).getTime()+finalCycle*60000).toISOString():(order.pickedUpAt||new Date().toISOString());
    const updated={...sess,totalEarnings:(sess.totalEarnings||0)+order.payout+tip,lastActivity:new Date().toISOString()};
    const earnEntry={
      platform:       order.platform,
      payout:         order.payout,
      tip,            // cash tip, kept separate from base pay; total = payout + tip
      restaurantId:   order.restaurantId,
      restaurantName: order.restaurantName||"",
      waitMins:       order.waitMins,
      cycleMins:      finalCycle,
      arrivedAt:      order.arrivedAt||null,
      deliveredAt,
      sessionId:      updated.sessionId,
      sessionStart:   updated.sessionStart,
      ts:             order.pickedUpAt,
      hour:           pickedUp.getHours(),
      dow:            pickedUp.getDay(),
      period:         timePeriod(pickedUp.getHours()),
    };
    const uid=auth.currentUser?.uid;
    if(uid){
      addDoc(collection(db,"users",uid,"earnings"),earnEntry).catch(()=>{});
      setDoc(doc(db,"users",uid),{earningsSession:updated},{merge:true}).catch(()=>{});
    }
    return updated;
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
    // ALWAYS add this order to the out-for-delivery list — even if the earnings popup was skipped
    // — so the DELIVERED / ADD DELIVERY buttons always appear and the delivery flow never breaks.
    // A skipped order is a £0 entry (no platform) that the driver can edit later in STATS.
    const po={
      id:             genId(),
      platform:       activeWait.platform||null,
      payout:         activeWait.payout!=null?activeWait.payout:0,
      restaurantId:   activeWait.restaurantId,
      restaurantName: activeWait.restaurantName||"",
      waitMins,
      arrivedAt:      activeWait.startedAt,
      pickedUpAt:     ts.toISOString(),
    };
    saveOrders([...activeOrders,po]);
    if(session){const s={...session,lastActivity:ts.toISOString()};setSession(s);store.set("delivr_session",s);}
  }

  // DELIVERED — open the optional cash-tip prompt for this order. Banking happens on confirm.
  function handleDelivered(orderId){
    const order=activeOrders.find(o=>o.id===orderId)||activeOrders[0];
    if(!order)return;
    setTipPrompt({order});
  }
  // Confirm the delivery (with optional tip). The order's earnings count toward £/hour only now,
  // banked against its full ARRIVED→DELIVERED window, then dropped from the out-for-delivery list.
  function confirmDelivered(tip){
    const order=tipPrompt?.order;
    setTipPrompt(null);
    if(!order)return;
    const win=(Date.now()-new Date(order.arrivedAt).getTime())/60000;
    const cycleMins=win<MIN_CYCLE_GAP_MINS?(order.waitMins||0)+DEFAULT_DELIVERY_MINS:win;
    const sess=session||{sessionId:genId(),sessionStart:order.arrivedAt,totalEarnings:0,lastActivity:order.pickedUpAt};
    const updated=bankOrder({...order,tip:Number(tip)||0},sess,cycleMins);
    setSession(updated);store.set("delivr_session",updated);
    saveOrders(activeOrders.filter(o=>o.id!==order.id));
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
    @keyframes slideFromR{from{opacity:0.4;transform:translateX(26px)}to{opacity:1;transform:translateX(0)}}
    @keyframes slideFromL{from{opacity:0.4;transform:translateX(-26px)}to{opacity:1;transform:translateX(0)}}
  `;

  if(!user){
    if(pendingVerify){
      return <div style={ROOT}><style>{CSS}</style>
        <VerifyCodeScreen email={pendingVerify.email} onVerified={handleVerified} onBack={()=>setPendingVerify(null)}/>
      </div>;
    }
    // Step 0: pick language (first ever screen)
    if(!lang){
      return <div style={ROOT}><style>{CSS}</style><LanguageScreen onChoose={chooseLang}/></div>;
    }
    // Step 1: one-time privacy disclaimer (in chosen language)
    if(!disclaimerOk){
      return <div style={ROOT}><style>{CSS}</style>
        <DisclaimerScreen lang={lang} onAccept={()=>{store.set("delivr_disclaimer",true);setDisclaimerOk(true);}}/>
      </div>;
    }
    // First-time visitors see the 3-screen onboarding before login
    if(!onboarded){
      return <div style={ROOT}><style>{CSS}</style>
        <Onboarding lang={lang} onFinish={()=>{store.set("delivr_onboarded",true);setOnboarded(true);setStartRegister(true);}}/>
      </div>;
    }
    return <div style={ROOT}><style>{CSS}</style><LoginScreen lang={lang} onChangeLang={()=>{setLang(null);store.del("delivr_lang");}} initialMode={startRegister?"register":"login"} onLogin={handleLogin} onRegistered={handleRegistered}/></div>;
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

        <div onTouchStart={onTabTouchStart} onTouchEnd={onTabTouchEnd} style={{height:"calc(100vh - 56px"+(activeWait&&!showProfile&&!showUpgrade&&!showStats&&!showLogbook?" - 56px":"")+")",overflowY:"auto",overflowX:"hidden"}}>
          <Suspense fallback={<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",...B,color:"#f5a623",letterSpacing:2,fontSize:14}}>LOADING…</div>}>
          <div key={screen} style={{animation:navDir>0?"slideFromR 0.22s ease":navDir<0?"slideFromL 0.22s ease":"none"}}>
          {showLogbook?(
            <Logbook communityLogs={communityLogs} contribCounts={contribCounts} onBack={()=>setShowLogbook(false)} myName={user.name} revealNames={hasAdminPerks(user)}/>
          ):showStats&&isOwner(user)?(
            <StatsScreen communityLogs={communityLogs} communityPatterns={communityPatterns} activeCounts={activeCounts} contribCounts={contribCounts} onBack={()=>setShowStats(false)}/>
          ):showUpgrade?(
            <UpgradeScreen premium={premium} onBack={()=>setShowUpgrade(false)} onSubscribe={handleSubscribe} onCancel={handleCancelSub}/>
          ):showProfile?(
            <ProfileScreen user={user} waitLog={waitLog} gps={gps} premium={premium} theme={theme} onToggleTheme={toggleTheme} contribCount={contribCounts[user.name]||0}
              lang={lang||"en"} onSetLang={chooseLang}
              onBack={()=>setShowProfile(false)} onLogout={handleLogout} onSave={handleSaveProfile}
              onUpgrade={()=>{setShowProfile(false);setShowUpgrade(true);}}
              onStats={()=>{setShowProfile(false);setShowStats(true);}}/>
          ):screen==="waits"?(
            <WaitsScreen now={now} gps={gps} restaurants={resolvedRestaurants} waitLog={waitLog} activeWait={activeWait} session={session} activeOrders={activeOrders}
              communityPatterns={communityPatterns} communityLogs={communityLogs} checkingId={checkingId} arrivalError={arrivalError} premium={premium} manualVoted={manualVoted} activeCounts={activeCounts} reportedCounts={reportedCounts} activeWaitsList={activeWaitsList} contribCounts={contribCounts} myName={user.name} revealNames={hasAdminPerks(user)} driverCount={Math.max(driverCount,signupCount)} activeShift={activeShift} shiftCompletedToday={shiftCompletedToday} onStartShift={startShift} onEndShift={endShift} queueAlerts={queueAlerts} queueAlertsSent={queueAlertsSent} onQueueAlert={sendQueueAlert} onOpenLogbook={()=>setShowLogbook(true)}
              onArrived={handleArrived} onManualArrive={handleManualArrive} onPickedUp={handlePickedUp} onDelivered={handleDelivered} onCancelWait={handleCancelWait}/>
          ):screen==="check"?(
            <CheckScreen restaurants={resolvedRestaurants} communityPatterns={communityPatterns} waitLog={waitLog} now={now} gps={gps} activeCounts={activeCounts} reportedCounts={reportedCounts}/>
          ):screen==="stats"?(
            <MyStats earningsLog={earningsLog} activeOrders={activeOrders} now={now} shiftMins={shiftMinsToday}/>
          ):(
            <ChatScreen user={user} onLogout={handleLogout} area={user.area||"general"} contribCounts={contribCounts} onGoProfile={()=>setShowProfile(true)}/>
          )}
          </div>
          </Suspense>
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
        {/* Optional earnings popup — shown right after a successful ARRIVED */}
        {earningsPopup&&(
          <EarningsPopup restaurantName={earningsPopup.restaurantName} onSave={handleSaveEarnings} onSkip={()=>setEarningsPopup(null)}/>
        )}
        {/* Optional cash-tip prompt — shown right after a delivery is marked DELIVERED */}
        {tipPrompt&&(
          <TipPopup restaurantName={tipPrompt.order?.restaurantName} onConfirm={confirmDelivered}/>
        )}
        {/* First-login notification opt-in (wait reminders only) */}
        {showNotifPrompt&&<NotifPrompt onAllow={allowNotifs} onSkip={skipNotifs}/>}
        {!showProfile&&!showUpgrade&&!showStats&&!showLogbook&&<BottomNav screen={screen} onNav={handleNav} activeWait={!!activeWait} unreadChat={unreadChat}/>}
      </div>
    </div>
  );
}

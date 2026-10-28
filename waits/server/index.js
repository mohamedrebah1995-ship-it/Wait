import express from 'express';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import Stripe from 'stripe';
import admin from 'firebase-admin';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildOfferStack, judgeOffer } from '../src/stackEngine.js';   // the one stacking engine

const __dirname = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'delivr_jwt_2024_change_in_prod';
const PORT       = process.env.PORT || 3001;
const PROD       = process.env.NODE_ENV === 'production';
const DB_PATH    = process.env.DB_PATH || './delivr-db.json';
// Email + Brevo — keys come from environment variables only (never hardcoded)
const BREVO_KEY  = (process.env.BREVO_KEY  || '').trim();
const BREVO_FROM = (process.env.BREVO_FROM || 'mohamedrebah1995@gmail.com').trim();

// Firebase Admin — needed to reset an account's password server-side (for Brevo reset flow)
// and to send wait-reminder push notifications (FCM) from the scheduler below.
let adminAuth = null;
let adminReady = false;
try {
  const sa = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (sa) {
    const cred = JSON.parse(sa);
    if (cred.private_key) cred.private_key = cred.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    adminAuth = admin.auth();
    adminReady = true;
    console.log('Firebase Admin initialised');
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT not set — password reset + push disabled until added');
  }
} catch (e) {
  console.error('Firebase Admin init failed:', e.message);
}

// ── Wait-reminder push notifications (FCM) ────────────────────────────────────
// Polls the live activeWaits presence collection; for any open wait (ARRIVED pressed, GOT IT
// not) it pushes reminders at 5 / 10 / 30 min, and at 60 min sends a final notice and removes
// the unpicked wait entirely (so it is never logged or counted). Each driver's FCM token lives
// in users/{uid}.fcmToken. Runs only when Firebase Admin is configured.
const REMINDER_MARKS = [
  [5,  n => `Still waiting at ${n}? Tap GOT IT when you have your food.`],
  [10, n => `You have been waiting at ${n} for 10 minutes — tap GOT IT when ready.`],
  [30, n => `Still at ${n}? Tap GOT IT or your session will be removed.`],
];
const waitNotifyState = new Map();   // uid -> { startedAt, sent:Set<number> }

async function sendWaitPush(fs, uid, title, body) {
  try {
    const snap = await fs.collection('users').doc(uid).get();
    const token = snap.exists ? snap.data().fcmToken : null;
    if (!token) return;
    await admin.messaging().send({
      token,
      data: { title, body },   // data-only so our service worker controls display (no duplicates)
      webpush: { fcmOptions: { link: 'https://drivers-eyes.web.app' } },
    });
  } catch (e) {
    if (e && (e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-registration-token')) {
      try { await fs.collection('users').doc(uid).update({ fcmToken: admin.firestore.FieldValue.delete() }); } catch (_) {}
    }
  }
}

async function tickWaitReminders() {
  if (!adminReady) return;
  const fs = admin.firestore();
  try {
    const snap = await fs.collection('activeWaits').get();
    const seen = new Set();
    for (const doc of snap.docs) {
      const w = doc.data(); const uid = doc.id;
      if (!w || !w.startedAt) continue;
      seen.add(uid);
      const name = w.restaurantName || 'the restaurant';
      const ageMin = (Date.now() - new Date(w.startedAt).getTime()) / 60000;
      let st = waitNotifyState.get(uid);
      if (!st || st.startedAt !== w.startedAt) { st = { startedAt: w.startedAt, sent: new Set() }; waitNotifyState.set(uid, st); }
      for (const [m, msg] of REMINDER_MARKS) {
        if (ageMin >= m && !st.sent.has(m)) { st.sent.add(m); await sendWaitPush(fs, uid, 'DELIVR — Wait reminder', msg(name)); }
      }
      if (ageMin >= 60 && !st.sent.has(60)) {
        st.sent.add(60);
        await sendWaitPush(fs, uid, 'DELIVR', `Your wait at ${name} was not completed and has been removed. No data was logged.`);
        try { await fs.collection('activeWaits').doc(uid).delete(); } catch (_) {}
        waitNotifyState.delete(uid);
      }
    }
    for (const uid of [...waitNotifyState.keys()]) if (!seen.has(uid)) waitNotifyState.delete(uid);   // GOT IT pressed → wait gone
  } catch (e) { /* transient Firestore error — retry next tick */ }
}
setInterval(tickWaitReminders, 30000);

// ── ONE-TIME CODES (signup verification + password reset) ─────────────────────
// These used to live in ./delivr-db.json. That file sits on Railway's EPHEMERAL filesystem and is
// committed to the repo, so every deploy, restart or sleep/wake reset it to the June snapshot and
// silently threw away every pending code — the driver got the email, typed the right code, and was
// told "No active code — request a new one". It would also break outright behind more than one
// replica, since a code written on one instance is invisible to the other.
//
// Firestore is already the real database, is persistent, and is shared across instances. Written
// with the Admin SDK, so no client security rules are involved and drivers can't read their own
// codes. Doc id is the email, which also keeps the "one active code per address" behaviour.
const codeDoc = (kind, email) => admin.firestore().collection(kind).doc(email.toLowerCase());

async function putCode(kind, email, code, expiresAt) {
  await codeDoc(kind, email).set({ code, expiresAt, used: false, createdAt: Date.now() });
}
// Returns null when there's nothing usable, else the stored entry.
async function getCode(kind, email) {
  const snap = await codeDoc(kind, email).get();
  if (!snap.exists) return null;
  const d = snap.data();
  return d && !d.used ? d : null;
}
async function burnCode(kind, email) {
  try { await codeDoc(kind, email).set({ used: true }, { merge: true }); } catch { /* best effort */ }
}

// Shared Brevo sender (used by sign-up verification AND password reset)
async function sendBrevoEmail(to, subject, htmlContent) {
  if (!BREVO_KEY) throw new Error('BREVO_KEY not set');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'MOdelivr', email: BREVO_FROM }, to: [{ email: to }], subject, htmlContent }),
  });
  if (!r.ok) { const txt = await r.text(); throw new Error('Brevo: ' + txt); }
  return true;
}
function codeEmailHtml(title, code, note) {
  return `<div style="font-family:monospace;background:#060606;color:#f0f0f0;padding:40px;max-width:420px;margin:0 auto;border-radius:16px"><div style="font-size:36px;color:#ff6600;font-weight:bold;letter-spacing:6px;margin-bottom:6px">DELIVR</div><div style="font-size:11px;color:#444;letter-spacing:4px;margin-bottom:36px">DRIVER COMMUNITY</div><div style="font-size:11px;color:#666;letter-spacing:2px;margin-bottom:10px">${title}</div><div style="font-size:52px;font-weight:bold;color:#ff6600;letter-spacing:10px;margin-bottom:28px">${code}</div><div style="font-size:12px;color:#555;line-height:1.6">${note}</div></div>`;
}
// .trim() guards against trailing newlines/spaces accidentally pasted into env vars
const STRIPE_SECRET = (process.env.STRIPE_SECRET || '').trim();
const STRIPE_PRICE  = (process.env.STRIPE_PRICE  || '').trim();   // price_... for £4.99/mo
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();   // whsec_... for the webhook

// One Stripe price per plan in src/plans.js. Each is its own Railway variable so prices can be
// rotated without a deploy; any left unset simply won't be offered (checkout falls back to
// STRIPE_PRICE). Keep these ids in step with PLANS — the daily call caps live in src/plans.js.
const PLAN_PRICES = {
  basic:    (process.env.STRIPE_PRICE_BASIC     || STRIPE_PRICE).trim(),  // £4.99/mo  — 8 checks/day
  week:     (process.env.STRIPE_PRICE_WEEK      || '').trim(),            // £6.99/wk  — 30/day
  month:    (process.env.STRIPE_PRICE_MONTH     || '').trim(),            // £24.99/mo — 1,000/mo (33/day)
  year:     (process.env.STRIPE_PRICE_YEAR      || '').trim(),            // £249/yr   — 15,000/yr (41/day)
  weekPro:  (process.env.STRIPE_PRICE_WEEK_PRO  || '').trim(),            // £9.99/wk  — 50/day
  monthPro: (process.env.STRIPE_PRICE_MONTH_PRO || '').trim(),            // £29.99/mo — 2,000/mo (66/day)
  yearPro:  (process.env.STRIPE_PRICE_YEAR_PRO  || '').trim(),            // £299/yr   — 30,000/yr (82/day)
};
// Reverse lookup so a webhook can tell which plan a subscription's price belongs to.
const planFromPriceId = id => Object.keys(PLAN_PRICES).find(k => PLAN_PRICES[k] && PLAN_PRICES[k] === id) || null;
const APP_URL       = (process.env.APP_URL       || 'https://drivers-eyes.web.app').trim();
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

// ── Persistence ───────────────────────────────────────────────────────────────
function loadDB() {
  try {
    if (existsSync(DB_PATH)) return JSON.parse(readFileSync(DB_PATH, 'utf8'));
  } catch (e) {}
  return { users: [], messages: [], waitLogs: [] };
}
function saveDB() {
  try { writeFileSync(DB_PATH, JSON.stringify(db)); } catch (e) {}
}
let db = loadDB();
if (!db.waitLogs)          db.waitLogs = [];
if (!db.verificationCodes) db.verificationCodes = [];
if (!db.resetCodes)        db.resetCodes = [];

// ── Pattern computation ───────────────────────────────────────────────────────
function bucket(logs) {
  if (!logs.length) return null;
  const avg = logs.reduce((s, l) => s + l.waitMins, 0) / logs.length;
  return {
    avg:   Math.round(avg * 10) / 10,
    min:   Math.round(Math.min(...logs.map(l => l.waitMins))),
    max:   Math.round(Math.max(...logs.map(l => l.waitMins))),
    count: logs.length,
    // contributors = unique drivers
    drivers: new Set(logs.map(l => l.username)).size,
  };
}

const PERIODS = ['early morning', 'morning', 'lunch', 'afternoon', 'evening', 'late night'];

function computePatterns() {
  // Group logs by restaurant
  const byRest = {};
  for (const log of db.waitLogs) {
    (byRest[log.restaurantId] = byRest[log.restaurantId] || []).push(log);
  }

  const patterns = {};
  for (const [restId, logs] of Object.entries(byRest)) {
    const entry = { overall: bucket(logs), byPeriod: {}, byDayPeriod: {} };

    for (const per of PERIODS) {
      const b = logs.filter(l => l.period === per);
      if (b.length) entry.byPeriod[per] = bucket(b);
    }
    for (let dow = 0; dow < 7; dow++) {
      for (const per of PERIODS) {
        const b = logs.filter(l => l.dow === dow && l.period === per);
        if (b.length) entry.byDayPeriod[`${dow}_${per}`] = bucket(b);
      }
    }
    patterns[restId] = entry;
  }

  // Aggregate summary
  patterns._meta = {
    totalLogs:    db.waitLogs.length,
    totalDrivers: new Set(db.waitLogs.map(l => l.username)).size,
    updatedAt:    new Date().toISOString(),
  };

  return patterns;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
function makeToken(user) {
  return jwt.sign(
    { username: user.username, color: user.color, initial: user.initial },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function verifyBearer(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  try { return jwt.verify(auth.slice(7), JWT_SECRET); }
  catch (e) { res.status(401).json({ error: 'Invalid token' }); return null; }
}

function sanitize(s) { return (s || '').trim().replace(/[<>"]/g, ''); }

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
// Stripe webhooks need the raw body for signature verification, so skip JSON parsing there.
app.use((req, res, next) => req.originalUrl === '/stripe/webhook' ? next() : express.json()(req, res, next));

// Auth
app.post('/auth/register', async (req, res) => {
  const { username, password, color, initial } = req.body || {};
  const name = sanitize(username);
  if (!name || name.length < 2 || !password || password.length < 6)
    return res.status(400).json({ error: 'Username min 2 chars · Password min 6 chars' });
  if (db.users.find(u => u.username.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken — try another' });
  const hash = await bcrypt.hash(password, 10);
  const user = { username: name, password_hash: hash, color: color || '#ff6600', initial: initial || name[0].toUpperCase(), joinedAt: new Date().toISOString() };
  db.users.push(user);
  saveDB();
  res.json({ token: makeToken(user), user: { name: user.username, color: user.color, initial: user.initial } });
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Fill in all fields' });
  const user = db.users.find(u => u.username.toLowerCase() === sanitize(username).toLowerCase());
  if (!user || !await bcrypt.compare(password, user.password_hash))
    return res.status(401).json({ error: 'Wrong username or password' });
  res.json({ token: makeToken(user), user: { name: user.username, color: user.color, initial: user.initial } });
});

// Send 6-digit verification code via Brevo
app.post('/auth/send-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min
  if (!adminReady) return res.status(500).json({ error: 'Verification not configured on server' });
  try { await putCode('verificationCodes', email, code, expiresAt); }
  catch (e) { console.error('verification code store failed:', e.message); return res.status(500).json({ error: 'Could not start verification' }); }
  try {
    await sendBrevoEmail(email, 'Your Delivr verification code',
      codeEmailHtml('YOUR VERIFICATION CODE', code, "Expires in 10 minutes.<br>If you didn't create a Delivr account, ignore this email."));
    res.json({ ok: true });
  } catch (e) {
    console.error('Email error:', e.message);
    res.status(500).json({ error: 'Email send failed — check Brevo sender is verified', detail: String(e.message).slice(0, 300) });
  }
});

// Verify the code the driver typed in
app.post('/auth/verify-code', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
  if (!adminReady) return res.status(500).json({ error: 'Verification not configured on server' });
  let entry;
  try { entry = await getCode('verificationCodes', email); }
  catch (e) { console.error('verification read failed:', e.message); return res.status(500).json({ error: 'Could not verify code' }); }
  if (!entry)              return res.status(400).json({ error: 'No active code — tap Resend' });
  if (entry.code !== code) return res.status(400).json({ error: 'Wrong code — try again' });
  if (Date.now() > entry.expiresAt) return res.status(400).json({ error: 'Code expired — tap Resend' });
  await burnCode('verificationCodes', email);
  res.json({ ok: true });
});

// ── Password reset via Brevo (replaces Firebase default email) ────────────────
// 1) Email a 6-digit reset code (Brevo)
app.post('/auth/send-reset-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!adminAuth) return res.status(500).json({ error: 'Password reset not configured on server' });
  // Only send if the account actually exists
  try { await adminAuth.getUserByEmail(email); }
  catch (e) { return res.status(404).json({ error: 'No account with that email' }); }
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  try { await putCode('resetCodes', email, code, expiresAt); }
  catch (e) { console.error('reset code store failed:', e.message); return res.status(500).json({ error: 'Could not start password reset' }); }
  try {
    await sendBrevoEmail(email, 'Your Delivr password reset code',
      codeEmailHtml('YOUR PASSWORD RESET CODE', code, "Expires in 10 minutes.<br>If you didn't request this, ignore this email."));
    res.json({ ok: true });
  } catch (e) {
    // The real Brevo reason (unverified sender, bad key, quota) was previously only visible in
    // the Railway logs, which made this impossible to diagnose from the app.
    console.error('Reset email error:', e.message);
    res.status(500).json({ error: 'Email send failed — check Brevo sender is verified', detail: String(e.message).slice(0, 300) });
  }
});

// 2) Verify code + set the new password (via Firebase Admin)
app.post('/auth/reset-password', async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!adminAuth) return res.status(500).json({ error: 'Password reset not configured on server' });
  let entry;
  try { entry = await getCode('resetCodes', email); }
  catch (e) { console.error('reset code read failed:', e.message); return res.status(500).json({ error: 'Could not verify code' }); }
  if (!entry)              return res.status(400).json({ error: 'No active code — request a new one' });
  if (entry.code !== code) return res.status(400).json({ error: 'Wrong code — try again' });
  if (Date.now() > entry.expiresAt) return res.status(400).json({ error: 'Code expired — request a new one' });
  try {
    const u = await adminAuth.getUserByEmail(email);
    await adminAuth.updateUser(u.uid, { password });
    await burnCode('resetCodes', email);
    res.json({ ok: true });
  } catch (e) {
    console.error('reset-password error:', e.message);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

// Total registered drivers (true sign-up count, via Firebase Admin)
let _driverCountCache = { n: 0, at: 0 };
// ── /evaluate — stacking verdict for a screen-read offer (Delivr 1.1) ───────────────────────────────
// Called by the screen-reader extension. Accepts ONLY postcodes, restaurant names, pay, minutes and
// miles (plus whether each run order is already collected); anything else in the body is ignored.
// The verdict comes from src/stackEngine.js, the same engine the app and the extension run.
const MAPBOX_TOKEN = (process.env.MAPBOX_TOKEN || '').trim();
const PC_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$/;
const geoCache = new Map();   // "pc:CM7 1AA" / "name:mcdonald's@lat,lng" → {lat,lng}

function cleanEvalOrder(o) {
  if (!o || typeof o !== 'object') return null;
  const pc = v => (typeof v === 'string' && PC_RE.test(v.trim().toUpperCase())) ? v.trim().toUpperCase() : null;
  const num = (v, max) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max) ? v : null;
  return {
    restaurant: typeof o.restaurant === 'string' ? o.restaurant.slice(0, 80) : null,
    pickupPostcode: pc(o.pickupPostcode),
    dropPostcode: pc(o.dropPostcode),
    pay: num(o.pay, 500),
    minutes: num(o.minutes, 300),
    miles: num(o.miles, 200),
    pickedUp: o.pickedUp === true,
  };
}

async function mapboxJSON(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}
async function geocodePostcode(pc) {
  if (!pc) return null;
  const k = 'pc:' + pc; if (geoCache.has(k)) return geoCache.get(k);
  const g = await mapboxJSON(`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(pc)}&types=postcode&country=gb&limit=1&access_token=${MAPBOX_TOKEN}`);
  const c = g?.features?.[0]?.geometry?.coordinates;
  const v = c ? { lat: c[1], lng: c[0] } : null;
  if (v) geoCache.set(k, v);
  return v;
}
// Restaurant by name near the driver (or the run start): up to 5 branches, the closest wins. More than
// one branch means we can't be sure which one the app meant, so the result is marked approx.
function distKm(a, b) {
  const tr = x => x * Math.PI / 180, dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
async function geocodeRestaurant(name, near) {
  if (!name || !near) return null;
  const k = `name:${name.toLowerCase()}@${near.lat.toFixed(2)},${near.lng.toFixed(2)}`; if (geoCache.has(k)) return geoCache.get(k);
  const g = await mapboxJSON(`https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(name)}&proximity=${near.lng},${near.lat}&country=gb&types=poi&limit=5&access_token=${MAPBOX_TOKEN}`);
  const hits = (g?.features || []).map(f => f.geometry?.coordinates).filter(Boolean).map(c => ({ lat: c[1], lng: c[0] }));
  if (!hits.length) return null;
  hits.sort((a, b) => distKm(near, a) - distKm(near, b));
  const v = { ...hits[0], approx: hits.length > 1 };
  geoCache.set(k, v);
  return v;
}
// Pickup: its own postcode when the app shows one (Just Eat, Deliveroo), else the restaurant name
// searched near the driver / run start (Uber shows only the name), else the drop-off itself.
async function locateOrder(o, near) {
  const drop = await geocodePostcode(o.dropPostcode);
  if (!drop) return null;
  if (o.pickedUp) return { pickup: null, drop, pay: o.pay || 0 };
  const byPc = await geocodePostcode(o.pickupPostcode);
  const byName = byPc ? null : await geocodeRestaurant(o.restaurant, near);
  const pickup = byPc || (byName && { lat: byName.lat, lng: byName.lng }) || drop;
  return { pickup, drop, pay: o.pay || 0, approx: !!byName?.approx };
}

// The driver's own position (sent rounded to ~100 m), only if it's plausibly in the UK.
function cleanHere(h) {
  const ok = h && typeof h.lat === 'number' && typeof h.lng === 'number' && h.lat > 49 && h.lat < 61 && h.lng > -9 && h.lng < 2.5;
  return ok ? { lat: Math.round(h.lat * 1000) / 1000, lng: Math.round(h.lng * 1000) / 1000 } : null;
}

// Per-driver rate limit: 30 checks per 10 minutes. A real shift sees a few offers an hour; this only
// stops a leaked token from running up the Mapbox bill. In memory: resets if the server restarts.
const EVAL_LIMIT = 30, EVAL_WINDOW_MS = 10 * 60 * 1000;
const evalHits = new Map();   // uid → [timestamps]
function evalAllowed(uid) {
  const now = Date.now();
  const hits = (evalHits.get(uid) || []).filter(t => now - t < EVAL_WINDOW_MS);
  if (hits.length >= EVAL_LIMIT) { evalHits.set(uid, hits); return false; }
  hits.push(now); evalHits.set(uid, hits);
  if (evalHits.size > 5000) for (const [k, v] of evalHits) if (!v.some(t => now - t < EVAL_WINDOW_MS)) evalHits.delete(k);
  return true;
}

app.post('/evaluate', async (req, res) => {
  const devNoAuth = !PROD && process.env.EVALUATE_DEV_NOAUTH === '1';
  let uid = 'dev';
  if (!devNoAuth) {
    if (!adminReady) return res.status(503).json({ error: 'auth unavailable' });
    const h = req.headers.authorization || '';
    try { uid = (await adminAuth.verifyIdToken(h.slice(7))).uid; } catch { return res.status(401).json({ error: 'unauthorised' }); }
  }
  if (!evalAllowed(uid)) return res.status(429).json({ error: 'too many checks — try again shortly' });
  if (!MAPBOX_TOKEN) return res.status(503).json({ error: 'routing unavailable' });
  const offer = cleanEvalOrder(req.body?.offer);
  const run = (Array.isArray(req.body?.run) ? req.body.run : []).slice(0, 6).map(cleanEvalOrder).filter(Boolean);
  if (!offer?.dropPostcode || !run.length) return res.status(400).json({ error: 'need an offer with a drop-off postcode and a run' });

  const here = cleanHere(req.body?.here);
  const minRate = typeof req.body?.minRate === 'number' && req.body.minRate > 0 && req.body.minRate < 200 ? req.body.minRate : undefined;
  // Search restaurants near the driver; with no fresh position, near the run's first stop.
  const near = here || (await geocodePostcode(run[0].pickupPostcode)) || (await geocodePostcode(run[0].dropPostcode));
  const located = await Promise.all([...run, offer].map(o => locateOrder(o, near)));
  if (located.some(x => !x)) return res.status(422).json({ error: 'postcode not found' });
  const runLoc = located.slice(0, -1), offerLoc = located[located.length - 1];
  // Run start: the driver's own position when the app had a fresh fix, else the run's next stop.
  const first = runLoc[0];
  const start = here || first.pickup || first.drop;
  const { points, orders } = buildOfferStack(start, runLoc, offerLoc);
  if (points.length > 10) return res.status(400).json({ error: 'too many stops' });
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const g = await mapboxJSON(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving-traffic/${coords}?annotations=duration,distance&access_token=${MAPBOX_TOKEN}`);
  if (!g?.durations || !g?.distances) return res.status(502).json({ error: 'routing failed' });
  const result = judgeOffer({ dur: g.durations, dist: g.distances }, orders, { minRate, approx: offerLoc.approx });
  if (!result) return res.status(500).json({ error: 'no plan' });
  // Coordinates go back so the extension can cache them for its own offline estimates.
  res.json({ ...result, source: 'live', located: { start, run: runLoc, offer: offerLoc } });
});

// Health check: readiness only, never values. evaluate=true means /evaluate can answer for real.
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    evaluate: !!MAPBOX_TOKEN && adminReady,
    mapboxConfigured: !!MAPBOX_TOKEN,
    firebaseAdmin: adminReady,
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || null,
  });
});

app.get('/stats/drivers', async (_req, res) => {
  if (!adminAuth) return res.json({ count: 0 });
  if (Date.now() - _driverCountCache.at < 60000) return res.json({ count: _driverCountCache.n }); // 60s cache
  try {
    let count = 0, token;
    do { const r = await adminAuth.listUsers(1000, token); count += r.users.length; token = r.pageToken; } while (token);
    _driverCountCache = { n: count, at: Date.now() };
    res.json({ count });
  } catch (e) { console.error('stats/drivers error:', e.message); res.json({ count: _driverCountCache.n }); }
});

// Public community stats for the landing page — real registered drivers + total Firestore wait
// logs. Cached 30s so the landing can poll it without load. No auth (read-only counts only).
let _statsCache = { drivers: 0, logs: 0, at: 0 };
app.get('/stats', async (_req, res) => {
  if (Date.now() - _statsCache.at < 30000) return res.json({ drivers: _statsCache.drivers, logs: _statsCache.logs });
  if (!adminReady) return res.json({ drivers: _statsCache.drivers, logs: _statsCache.logs });
  try {
    // Registered drivers (reuse the 60s-cached count)
    let drivers = _driverCountCache.n;
    if (Date.now() - _driverCountCache.at >= 60000) {
      let count = 0, token;
      do { const r = await adminAuth.listUsers(1000, token); count += r.users.length; token = r.pageToken; } while (token);
      _driverCountCache = { n: count, at: Date.now() };
      drivers = count;
    }
    // Total wait logs (Firestore count aggregation — doesn't read every doc)
    let logs = _statsCache.logs;
    try { logs = (await admin.firestore().collection('waitLogs').count().get()).data().count; } catch (e) { /* keep last */ }
    _statsCache = { drivers, logs, at: Date.now() };
    res.json({ drivers, logs });
  } catch (e) {
    console.error('stats error:', e.message);
    res.json({ drivers: _statsCache.drivers, logs: _statsCache.logs });
  }
});

// Public community leaderboard — log counts per driver display name only. Deliberately exposes
// NOTHING else (no real name, email, online status, last-active, or location). Cached 5 min.
let _lbCache = { data: [], at: 0 };
app.get('/leaderboard', async (_req, res) => {
  if (Date.now() - _lbCache.at < 300000) return res.json(_lbCache.data);
  if (!adminReady) return res.json(_lbCache.data);
  try {
    const snap = await admin.firestore().collection('waitLogs').get();
    const weekAgo = Date.now() - 7 * 86400000;
    const by = {};
    snap.forEach(d => {
      const x = d.data(); const u = (x.username || '').trim();
      if (!u || u.toLowerCase() === 'anon') return;
      if (!by[u]) by[u] = { name: u, total: 0, week: 0 };
      by[u].total++;
      const t = Date.parse(x.ts);
      if (t >= weekAgo) by[u].week++;
    });
    const list = Object.values(by).sort((a, b) => b.total - a.total || b.week - a.week).slice(0, 50);
    _lbCache = { data: list, at: Date.now() };
    res.json(list);
  } catch (e) {
    console.error('leaderboard error:', e.message);
    res.json(_lbCache.data);
  }
});

// One-time: merge all historic chat into a single Braintree room (idempotent)
app.post('/admin/merge-chat', async (_req, res) => {
  if (!adminAuth) return res.status(500).json({ error: 'no admin' });
  try {
    const fs = admin.firestore();
    const target = fs.collection('chats').doc('braintree').collection('messages');
    const sources = [
      ['legacy', fs.collection('messages')],
      ['general', fs.collection('chats').doc('general').collection('messages')],
      ['brainteree', fs.collection('chats').doc('brainteree').collection('messages')],
    ];
    let copied = 0;
    for (const [tag, col] of sources) {
      const snap = await col.get();
      for (const d of snap.docs) { await target.doc(tag + '_' + d.id).set(d.data(), { merge: true }); copied++; }
    }
    res.json({ ok: true, copied });
  } catch (e) { res.json({ error: e.message }); }
});

// Diagnostic: where do chat messages actually live?
app.get('/debug/chatrooms', async (_req, res) => {
  if (!adminAuth) return res.json({ error: 'no admin' });
  try {
    const fs = admin.firestore();
    const out = {};
    const docs = await fs.collection('chats').listDocuments();
    for (const d of docs) {
      const snap = await d.collection('messages').get();
      out['chats/' + d.id] = snap.size;
    }
    try { const leg = await fs.collection('messages').get(); out['messages (legacy)'] = leg.size; } catch (e) {}
    res.json(out);
  } catch (e) { res.json({ error: e.message }); }
});

// ── Stripe subscription ─────────────────────────────────────────────────────
// Create a Checkout Session and return its URL
app.post('/stripe/create-checkout-session', async (req, res) => {
  if (!stripe || !STRIPE_PRICE) return res.status(500).json({ error: 'Payments not configured' });
  const { email, uid, planId } = req.body || {};
  // No planId at all = an older client, which only ever meant the original £4.99 price.
  // A planId we have no configured price for is REFUSED rather than falling back: falling back
  // would show a driver "£9.99/week" and then charge them £4.99/month, which is mis-selling.
  if (planId && !PLAN_PRICES[planId]) {
    console.error(`No Stripe price configured for plan "${planId}" — refusing checkout`);
    return res.status(400).json({ error: 'That plan is not available yet' });
  }
  const price = planId ? PLAN_PRICES[planId] : STRIPE_PRICE;
  const plan  = planId || 'basic';
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      customer_email: email || undefined,
      client_reference_id: uid || email || undefined,
      metadata: uid ? { uid, plan } : { plan },
      subscription_data: { metadata: uid ? { uid, plan } : { plan } },   // so subscription.* events carry the uid + plan
      success_url: `${APP_URL}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/?stripe=cancel`,
      allow_promotion_codes: true,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Stripe session error:', e.message);
    res.status(500).json({ error: 'Could not start checkout', detail: e.message });
  }
});

// Which plans can actually be bought right now — i.e. which have a Stripe price configured. The
// app shows only these, so a driver can never tap a plan that would fail or charge the wrong price.
app.get('/plans', (_req, res) => {
  res.json({ available: Object.keys(PLAN_PRICES).filter(k => PLAN_PRICES[k]) });
});

// ── Apple StoreKit receipt verification ──────────────────────────────────────
// The iOS app sends the signed transaction (JWS) from StoreKit 2; the entitlement is granted HERE,
// never on the device (`plan` is locked in firestore.rules).
//
// FAIL-CLOSED BY DESIGN: a JWS is only trustworthy once its x5c certificate chain has been checked
// against Apple's root CAs. Until that's configured this endpoint grants nothing and returns 503 —
// because accepting an unverified payload would let anyone POST themselves the £299 plan.
//
// To turn it on:
//   1. npm install @apple/app-store-server-library
//   2. Download Apple's root CAs (https://www.apple.com/certificateauthority/) into server/apple-certs/
//   3. Set APPLE_BUNDLE_ID=app.delivr.mobile and APPLE_APP_ID=<your numeric App Store id> on Railway
const APPLE_BUNDLE_ID = (process.env.APPLE_BUNDLE_ID || '').trim();
const APPLE_APP_ID    = (process.env.APPLE_APP_ID || '').trim();

let appleVerifier = null, appleVerifierTried = false;
async function getAppleVerifier() {
  if (appleVerifierTried) return appleVerifier;
  appleVerifierTried = true;
  if (!APPLE_BUNDLE_ID || !APPLE_APP_ID) return null;
  try {
    const { SignedDataVerifier, Environment } = await import('@apple/app-store-server-library');
    const fs = await import('node:fs');
    const dir = new URL('./apple-certs/', import.meta.url);
    const roots = fs.readdirSync(dir).filter(f => f.endsWith('.cer')).map(f => fs.readFileSync(new URL(f, dir)));
    if (!roots.length) return null;
    appleVerifier = new SignedDataVerifier(roots, true, Environment.PRODUCTION, APPLE_BUNDLE_ID, Number(APPLE_APP_ID));
  } catch (e) {
    console.warn('Apple IAP verification not configured:', e.message);
  }
  return appleVerifier;
}

app.post('/iap/verify', async (req, res) => {
  const { uid, plan, jws } = req.body || {};
  if (!uid || !plan || !jws) return res.status(400).json({ error: 'Missing uid, plan or jws' });
  if (!PLAN_PRICES[plan] && plan !== 'basic') return res.status(400).json({ error: 'Unknown plan' });

  const verifier = await getAppleVerifier();
  if (!verifier) {
    console.error('/iap/verify called but Apple verification is not configured — refusing to grant');
    return res.status(503).json({ error: 'Purchase verification is not configured yet' });
  }
  try {
    const tx = await verifier.verifyAndDecodeTransaction(jws);   // throws unless the signature chain is valid
    const expires = Number(tx.expiresDate || 0);
    if (expires && expires < Date.now()) return res.status(400).json({ error: 'Subscription already expired' });
    await setUserPremium(uid, true, tx.originalTransactionId || null, plan);
    res.json({ ok: true, plan });
  } catch (e) {
    console.error('Apple receipt rejected:', e.message);
    res.status(400).json({ error: 'Could not verify this purchase' });
  }
});

// Verify a completed session — frontend calls this on return from Stripe
app.get('/stripe/verify-session', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments not configured' });
  const { session_id } = req.query || {};
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paid = session.payment_status === 'paid' || session.status === 'complete';
    // Grant premium server-side (Admin SDK) as a reliable fallback to the webhook — clients can't
    // write premium themselves, so this is the safety net if the webhook is delayed/missed.
    const uid = session.client_reference_id || (session.metadata && session.metadata.uid);
    if (paid && uid) await setUserPremium(uid, true, session.subscription || null, (session.metadata && session.metadata.plan) || 'basic');
    res.json({ paid, subscriptionId: session.subscription || null, email: session.customer_email || null });
  } catch (e) {
    console.error('Stripe verify error:', e.message);
    res.status(500).json({ error: 'Could not verify payment' });
  }
});

// Cancel a subscription (at period end)
app.post('/stripe/cancel', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Payments not configured' });
  const { subscriptionId } = req.body || {};
  if (!subscriptionId) return res.status(400).json({ error: 'Missing subscriptionId' });
  try {
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('Stripe cancel error:', e.message);
    res.status(500).json({ error: 'Could not cancel subscription' });
  }
});

// ── Stripe webhook ───────────────────────────────────────────────────────────
// Keeps premium in sync with Stripe so it auto-revokes when a subscription is
// cancelled, expires or goes unpaid (and re-grants while active). Firestore is the
// source of truth the app reads premium from.
// `plan` rides along with premium so the Stack Check daily cap follows the subscription. It's
// written here (Admin SDK) and locked in firestore.rules, so a driver can't self-grant a bigger
// budget. Revoking clears it back to null; a lapsed subscriber falls to no plan, not a free one.
async function setUserPremium(uid, premium, subscriptionId, plan) {
  if (!adminReady || !uid) return;
  try {
    await admin.firestore().collection('users').doc(uid).set(
      {
        premium,
        subscriptionId: premium ? (subscriptionId || null) : null,
        plan: premium ? (plan || 'basic') : null,
      },
      { merge: true }
    );
    console.log(`Premium ${premium ? `granted (${plan || 'basic'})` : 'revoked'} for ${uid}`);
  } catch (e) { console.error('setUserPremium failed:', e.message); }
}
// Which plan a Stripe subscription represents: its own metadata first, else the price it bills.
function planOfSubscription(sub) {
  if (sub?.metadata?.plan) return sub.metadata.plan;
  const priceId = sub?.items?.data?.[0]?.price?.id;
  return (priceId && planFromPriceId(priceId)) || 'basic';
}
// Find the Firebase uid for a subscription: prefer its metadata, else the stored subscriptionId.
async function uidFromSubscription(sub) {
  if (sub.metadata && sub.metadata.uid) return sub.metadata.uid;
  if (!adminReady) return null;
  try {
    const snap = await admin.firestore().collection('users').where('subscriptionId', '==', sub.id).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  } catch (e) { console.error('uidFromSubscription failed:', e.message); }
  return null;
}

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(500).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Stripe webhook signature failed:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
  try {
    const obj = event.data.object;
    if (event.type === 'checkout.session.completed') {
      const uid = obj.client_reference_id || (obj.metadata && obj.metadata.uid);
      if (uid && (obj.payment_status === 'paid' || obj.status === 'complete')) {
        await setUserPremium(uid, true, obj.subscription || null, (obj.metadata && obj.metadata.plan) || 'basic');
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const uid = await uidFromSubscription(obj);
      const active = obj.status === 'active' || obj.status === 'trialing';
      await setUserPremium(uid, active, obj.id, planOfSubscription(obj));
    } else if (event.type === 'customer.subscription.deleted') {
      const uid = await uidFromSubscription(obj);
      await setUserPremium(uid, false, null);
    }
  } catch (e) {
    console.error('Stripe webhook handler error:', e.message);
  }
  res.json({ received: true });
});

// Wait log submission
app.post('/waits/log', (req, res) => {
  const info = verifyBearer(req, res);
  if (!info) return;
  const { restaurantId, waitMins, ts, hour, dow, period } = req.body || {};
  if (!restaurantId || waitMins == null) return res.status(400).json({ error: 'Missing fields' });
  const entry = {
    id:           Date.now().toString(36) + Math.random().toString(36).slice(2),
    username:     info.username,
    restaurantId,
    waitMins:     Math.round(Number(waitMins) * 10) / 10,
    ts:           ts || new Date().toISOString(),
    hour:         Number(hour),
    dow:          Number(dow),
    period:       period || 'unknown',
  };
  db.waitLogs.push(entry);
  // Keep up to 50,000 log entries
  if (db.waitLogs.length > 50000) db.waitLogs = db.waitLogs.slice(-50000);
  saveDB();
  // Push fresh patterns to all connected drivers immediately
  broadcast({ type: 'patterns', patterns: computePatterns() });
  res.json({ ok: true });
});

// Community patterns (public — no auth needed)
app.get('/waits/patterns', (_req, res) => {
  res.json(computePatterns());
});

// ── Production: serve built frontend ─────────────────────────────────────────
if (PROD) {
  const dist = join(__dirname, '../dist');
  app.use(express.static(dist));
  // SPA fallback — must come AFTER API routes
  app.get(/^(?!\/auth|\/waits).*/, (_req, res) => {
    res.sendFile(join(dist, 'index.html'));
  });
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
const server = createServer(app);
const wss    = new WebSocketServer({ server });
const clients = new Set();

function broadcast(data) {
  const str = JSON.stringify(data);
  for (const c of clients) if (c.readyState === 1) c.send(str);
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  let info;
  try { info = jwt.verify(params.get('token'), JWT_SECRET); }
  catch (e) { ws.close(4001, 'Unauthorized'); return; }

  ws.userInfo = info;
  clients.add(ws);

  // Seed with history + current patterns
  ws.send(JSON.stringify({ type: 'history',  messages: db.messages.slice(-100) }));
  ws.send(JSON.stringify({ type: 'patterns', patterns: computePatterns() }));
  broadcast({ type: 'online', count: clients.size });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'chat' && msg.text?.trim()) {
        const entry = {
          id:      Date.now().toString(36) + Math.random().toString(36).slice(2),
          user:    ws.userInfo.username,
          color:   ws.userInfo.color,
          initial: ws.userInfo.initial,
          text:    msg.text.trim().slice(0, 500),
          ts:      new Date().toISOString(),
        };
        db.messages.push(entry);
        if (db.messages.length > 500) db.messages = db.messages.slice(-500);
        saveDB();
        broadcast({ type: 'message', message: entry });
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ type: 'online', count: clients.size });
  });
});

server.listen(PORT, () => {
  console.log(`Delivr server → http://localhost:${PORT}  [${PROD ? 'production' : 'development'}]`);
});

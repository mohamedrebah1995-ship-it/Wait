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

// Shared Brevo sender (used by sign-up verification AND password reset)
async function sendBrevoEmail(to, subject, htmlContent) {
  if (!BREVO_KEY) throw new Error('BREVO_KEY not set');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'Delivr', email: BREVO_FROM }, to: [{ email: to }], subject, htmlContent }),
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
  db.verificationCodes = db.verificationCodes.filter(c => c.email !== email);
  db.verificationCodes.push({ email, code, expiresAt, used: false });
  saveDB();
  try {
    await sendBrevoEmail(email, 'Your Delivr verification code',
      codeEmailHtml('YOUR VERIFICATION CODE', code, "Expires in 10 minutes.<br>If you didn't create a Delivr account, ignore this email."));
    res.json({ ok: true });
  } catch (e) {
    console.error('Email error:', e.message);
    res.status(500).json({ error: 'Email send failed — check Brevo sender is verified' });
  }
});

// Verify the code the driver typed in
app.post('/auth/verify-code', (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
  const entry = db.verificationCodes.find(c => c.email === email && !c.used);
  if (!entry)              return res.status(400).json({ error: 'No active code — tap Resend' });
  if (entry.code !== code) return res.status(400).json({ error: 'Wrong code — try again' });
  if (Date.now() > entry.expiresAt) return res.status(400).json({ error: 'Code expired — tap Resend' });
  entry.used = true;
  saveDB();
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
  db.resetCodes = (db.resetCodes || []).filter(c => c.email !== email);
  db.resetCodes.push({ email, code, expiresAt, used: false });
  saveDB();
  try {
    await sendBrevoEmail(email, 'Your Delivr password reset code',
      codeEmailHtml('YOUR PASSWORD RESET CODE', code, "Expires in 10 minutes.<br>If you didn't request this, ignore this email."));
    res.json({ ok: true });
  } catch (e) {
    console.error('Reset email error:', e.message);
    res.status(500).json({ error: 'Email send failed — check Brevo sender is verified' });
  }
});

// 2) Verify code + set the new password (via Firebase Admin)
app.post('/auth/reset-password', async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!adminAuth) return res.status(500).json({ error: 'Password reset not configured on server' });
  const entry = (db.resetCodes || []).find(c => c.email === email && !c.used);
  if (!entry)              return res.status(400).json({ error: 'No active code — request a new one' });
  if (entry.code !== code) return res.status(400).json({ error: 'Wrong code — try again' });
  if (Date.now() > entry.expiresAt) return res.status(400).json({ error: 'Code expired — request a new one' });
  try {
    const u = await adminAuth.getUserByEmail(email);
    await adminAuth.updateUser(u.uid, { password });
    entry.used = true;
    saveDB();
    res.json({ ok: true });
  } catch (e) {
    console.error('reset-password error:', e.message);
    res.status(500).json({ error: 'Could not reset password' });
  }
});

// Total registered drivers (true sign-up count, via Firebase Admin)
let _driverCountCache = { n: 0, at: 0 };
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
  const { email, uid } = req.body || {};
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE, quantity: 1 }],
      customer_email: email || undefined,
      client_reference_id: uid || email || undefined,
      metadata: uid ? { uid } : undefined,
      subscription_data: uid ? { metadata: { uid } } : undefined,   // so subscription.* events carry the uid
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
    if (paid && uid) await setUserPremium(uid, true, session.subscription || null);
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
async function setUserPremium(uid, premium, subscriptionId) {
  if (!adminReady || !uid) return;
  try {
    await admin.firestore().collection('users').doc(uid).set(
      { premium, subscriptionId: premium ? (subscriptionId || null) : null },
      { merge: true }
    );
    console.log(`Premium ${premium ? 'granted' : 'revoked'} for ${uid}`);
  } catch (e) { console.error('setUserPremium failed:', e.message); }
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
        await setUserPremium(uid, true, obj.subscription || null);
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const uid = await uidFromSubscription(obj);
      const active = obj.status === 'active' || obj.status === 'trialing';
      await setUserPremium(uid, active, obj.id);
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

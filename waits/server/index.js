import express from 'express';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import Stripe from 'stripe';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'delivr_jwt_2024_change_in_prod';
const PORT       = process.env.PORT || 3001;
const PROD       = process.env.NODE_ENV === 'production';
const DB_PATH    = process.env.DB_PATH || './delivr-db.json';
const BREVO_KEY  = process.env.BREVO_KEY  || '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';
const BREVO_FROM = process.env.BREVO_FROM || 'mohamedrebah1995@gmail.com';
const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_PRICE  = process.env.STRIPE_PRICE  || '';   // price_... for £4.99/mo
const APP_URL       = process.env.APP_URL       || 'https://drivers-eyes.web.app';
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

const PERIODS = ['morning', 'lunch', 'afternoon', 'evening', 'late night'];

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
app.use(express.json());

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
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Delivr', email: BREVO_FROM },
        to: [{ email }],
        subject: 'Your Delivr verification code',
        htmlContent: `<div style="font-family:monospace;background:#060606;color:#f0f0f0;padding:40px;max-width:420px;margin:0 auto;border-radius:16px"><div style="font-size:36px;color:#ff6600;font-weight:bold;letter-spacing:6px;margin-bottom:6px">DELIVR</div><div style="font-size:11px;color:#444;letter-spacing:4px;margin-bottom:36px">DRIVER COMMUNITY</div><div style="font-size:11px;color:#666;letter-spacing:2px;margin-bottom:10px">YOUR VERIFICATION CODE</div><div style="font-size:52px;font-weight:bold;color:#ff6600;letter-spacing:10px;margin-bottom:28px">${code}</div><div style="font-size:12px;color:#555;line-height:1.6">Expires in 10 minutes.<br>If you didn't create a Delivr account, ignore this email.</div></div>`,
      }),
    });
    if (!r.ok) { const t = await r.text(); console.error('Brevo error:', t); return res.status(500).json({ error: 'Failed to send email — check Brevo sender is verified' }); }
    res.json({ ok: true });
  } catch (e) {
    console.error('Email error:', e);
    res.status(500).json({ error: 'Email send failed' });
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

// ── Stripe subscription ─────────────────────────────────────────────────────
// Diagnostic — shows what env the server actually loaded (no secrets leaked)
app.get('/stripe/debug', (_req, res) => {
  res.json({
    hasStripe: !!stripe,
    secretPrefix: STRIPE_SECRET ? STRIPE_SECRET.slice(0, 12) + '…' : null,
    secretLength: STRIPE_SECRET.length,
    price: STRIPE_PRICE || null,
    appUrl: APP_URL,
  });
});

// Create a Checkout Session and return its URL
app.post('/stripe/create-checkout-session', async (req, res) => {
  if (!stripe || !STRIPE_PRICE) return res.status(500).json({ error: 'Payments not configured' });
  const { email } = req.body || {};
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE, quantity: 1 }],
      customer_email: email || undefined,
      client_reference_id: email || undefined,
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

import express from 'express';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'delivr_jwt_2024_change_in_prod';
const PORT       = process.env.PORT || 3001;
const PROD       = process.env.NODE_ENV === 'production';
const DB_PATH    = process.env.DB_PATH || './delivr-db.json';

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
if (!db.waitLogs) db.waitLogs = [];

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

// routeCache.js — every Mapbox travel time we've fetched, kept on the device so Stack Check still works
// with no signal.
//
// Key: from-cell → to-cell + time band. Cells are coordinates rounded to 3 dp (~110 m), the same grid
// waitEngine.restaurantKey uses (Stack Check works on pinned coordinates, not postcodes).
// Time band: weekday/weekend × night / morning / midday / evening / late, because 8am and 2am
// traffic differ.
//
// Offline, any pair we never fetched is estimated: straight-line distance × a road factor ÷ the
// average speed learned from cached trips, so the matrix is always complete. Results that used any
// estimate carry `offline: true`.

const KEY = "delivr_routecache";
const MAX_ENTRIES = 4000;
const TTL_MS = 30 * 24 * 3600 * 1000;
const ROAD_FACTOR = 1.3;              // roads are ~30% longer than the straight line in towns
const DEFAULT_SPEED_MS = 8.3;         // ~30 km/h until we've learned the driver's own average

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full → keep going uncached */ } }

const cell = p => `${Math.round(p.lat * 1000) / 1000},${Math.round(p.lng * 1000) / 1000}`;

export function timeBand(d = new Date()) {
  const day = d.getDay(), h = d.getHours();
  const kind = day === 0 || day === 6 ? "we" : "wd";
  const part = h < 7 ? "night" : h < 10 ? "morning" : h < 16 ? "midday" : h < 20 ? "evening" : "late";
  return `${kind}-${part}`;
}

const pairKey = (a, b, band) => `${cell(a)}>${cell(b)}@${band}`;

function haversineM(a, b) {
  const R = 6371000, tr = x => x * Math.PI / 180;
  const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Average driving speed (m/s) over every cached trip longer than 500 m: the driver's own calibration.
function learnedSpeed(c) {
  let dist = 0, dur = 0;
  for (const v of Object.values(c)) if (v[1] > 500 && v[0] > 0) { dist += v[1]; dur += v[0]; }
  return dur > 600 ? dist / dur : DEFAULT_SPEED_MS;
}

// Store a full Mapbox matrix ({dur, dist} in s / m) for these points.
export function storeMatrix(points, m, when = new Date()) {
  if (!m?.dur || !m?.dist) return;
  const c = load(), band = timeBand(when), now = Date.now();
  points.forEach((a, i) => points.forEach((b, j) => {
    if (i !== j && m.dur[i]?.[j] != null && m.dist[i]?.[j] != null) c[pairKey(a, b, band)] = [m.dur[i][j], m.dist[i][j], now];
  }));
  const keys = Object.keys(c);
  for (const k of keys) if (now - c[k][2] > TTL_MS) delete c[k];
  const live = Object.keys(c);
  if (live.length > MAX_ENTRIES) live.sort((x, y) => c[x][2] - c[y][2]).slice(0, live.length - MAX_ENTRIES).forEach(k => delete c[k]);
  save(c);
}

// Matrix from the cache, preferring the current time band, then any band for that pair, then an
// estimate. Always complete; `offline` is true if any pair had to be estimated.
export function cachedMatrix(points, when = new Date()) {
  const c = load(), band = timeBand(when), now = Date.now();
  const speed = learnedSpeed(c);
  const byPair = {};
  for (const [k, v] of Object.entries(c)) {
    if (now - v[2] > TTL_MS) continue;
    const pair = k.slice(0, k.indexOf("@"));
    if (!byPair[pair] || v[2] > byPair[pair][2]) byPair[pair] = v;
  }
  let estimated = false;
  const dur = [], dist = [];
  points.forEach((a, i) => {
    dur[i] = []; dist[i] = [];
    points.forEach((b, j) => {
      if (i === j) { dur[i][j] = 0; dist[i][j] = 0; return; }
      const hit = c[pairKey(a, b, band)] || byPair[`${cell(a)}>${cell(b)}`];
      if (hit) { dur[i][j] = hit[0]; dist[i][j] = hit[1]; return; }
      const d = haversineM(a, b) * ROAD_FACTOR;
      dur[i][j] = d / speed; dist[i][j] = d; estimated = true;
    });
  });
  return { dur, dist, offline: estimated, cached: true };
}

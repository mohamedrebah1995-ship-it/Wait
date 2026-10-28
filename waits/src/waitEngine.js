// waitEngine.js — passive, GPS-measured restaurant wait times for Stack Check.
//
// ADDITIVE + fail-silent by design:
//  - Writes samples to a NEW Firestore collection `waitTimeSamples` (never touches existing ones).
//  - Reads a real per-restaurant/hour average back. Until there are at least WAIT_MIN_SAMPLES
//    samples for a restaurant+hour, getWaitAverage() returns null and Stack Check keeps its current
//    behaviour exactly (wait input stays 0 — there is intentionally NO default floor).
//  - Reuses the app's existing GPS stream; adds no new location prompts.

//  - Local-first: each sample goes to an on-device outbox first and is sent when there's signal, under a
//    fixed id (session + sequence), so a retry can never create a duplicate. Averages are kept on the
//    device too, so Stack Check still has them offline.

import { db, auth } from "./firebase";
import { collection, doc, setDoc, query, where, getDocs, limit, getCountFromServer } from "firebase/firestore";

export const WAIT_RADIUS_M   = 80;      // arrival/departure radius around a pickup (tunable)
export const WAIT_MIN_SAMPLES = 2;      // mirrors CFG.MIN_SAMPLES — min samples before we trust an avg
const MIN_DWELL_S = 30;                 // < 30s → GPS noise, discard
const MAX_DWELL_S = 60 * 60;            // > 60min → driver left the app open, discard

// Anonymous session id — a random UUID kept on the device. No identity, only a way to group pings.
export function sessionId() {
  try {
    let id = localStorage.getItem("delivr_wt_session");
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem("delivr_wt_session", id);
    }
    return id;
  } catch (e) { return "anon"; }
}

// Stable key for a restaurant: normalized name + coords rounded to a consistent grid (~110m), so the
// same place maps to the same key regardless of small address-string / GPS differences.
export function restaurantKey(name, lat, lng) {
  const n = (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  const r = v => (v == null ? "" : (Math.round(v * 1000) / 1000));   // 3 dp ≈ 110m
  return `${n}@${r(lat)},${r(lng)}`;
}

function distM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const R = 6371000, tr = x => x * Math.PI / 180;
  const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// In-memory dwell trackers, keyed by restaurantKey (not persisted across reloads — a live visit only).
const _active = new Map();   // key -> { key, lat, lng, arrivedAt }

// Feed the current GPS + the list of active pickups ([{key,lat,lng}]). Detects arrival (enters the
// radius → start a timer) and departure (leaves the radius → stop + log a sample).
export function trackWait(gps, pickups) {
  if (!gps || gps.lat == null) return;
  const here = { lat: gps.lat, lng: gps.lng };
  const activeKeys = new Set((pickups || []).map(p => p.key));
  for (const p of (pickups || [])) {
    const d = distM(here, p);
    if (d <= WAIT_RADIUS_M) {
      if (!_active.has(p.key)) _active.set(p.key, { ...p, arrivedAt: Date.now() });
    } else if (_active.has(p.key)) {
      finishSample(p.key);   // was inside, now outside → departed
    }
  }
  // A tracked pickup that's no longer in the list (order removed) → close it out too.
  for (const key of Array.from(_active.keys())) {
    if (!activeKeys.has(key)) finishSample(key);
  }
}

// Force-finish a dwell (e.g. the order was marked picked up in-app).
export function finishWait(key) { finishSample(key); }

function finishSample(key) {
  const t = _active.get(key);
  if (!t) return;
  _active.delete(key);
  const dwellS = (Date.now() - t.arrivedAt) / 1000;
  if (dwellS < MIN_DWELL_S || dwellS > MAX_DWELL_S) return;   // discard bad data automatically
  const now = new Date();
  const sample = {
    restaurantKey: key,
    dow: now.getDay(),
    hour: now.getHours(),
    durationMin: Math.round(dwellS / 60 * 10) / 10,
    session: sessionId(),
    ts: now.toISOString(),
  };
  enqueue(sample);
  // Count it in this device's averages straight away, signal or not.
  const entry = _cache.get(key);
  if (entry) { (entry.byHour[sample.hour] = entry.byHour[sample.hour] || []).push(sample.durationMin); saveCache(); }
  flushOutbox();
}

// ── Outbox: samples waiting to reach Firestore ───────────────────────────────
const OUTBOX_KEY = "delivr_wait_outbox";
const SEQ_KEY = "delivr_wait_seq";
function readJSON(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full */ } }

function enqueue(sample) {
  const seq = (readJSON(SEQ_KEY, 0) || 0) + 1;
  writeJSON(SEQ_KEY, seq);
  const box = readJSON(OUTBOX_KEY, []);
  box.push({ id: `${sample.session}-${seq}`, data: sample });
  writeJSON(OUTBOX_KEY, box.slice(-500));   // a week of heavy use; oldest dropped first if it ever overflows
}

let _flushing = false;
// Sends every queued sample. Safe to call any time; a no-op while offline or signed out.
export async function flushOutbox() {
  if (_flushing || (typeof navigator !== "undefined" && navigator.onLine === false) || !auth.currentUser) return;
  _flushing = true;
  try {
    for (const item of readJSON(OUTBOX_KEY, [])) {
      let done = false;
      try { await setDoc(doc(db, "waitTimeSamples", item.id), item.data); done = true; }
      catch (e) {
        // The rules allow create but not update, so "permission-denied" for a signed-in driver means
        // this id already reached the server on an earlier attempt.
        done = e?.code === "permission-denied";
        if (!done) break;   // offline / server unreachable: keep the rest for next time
      }
      if (done) writeJSON(OUTBOX_KEY, readJSON(OUTBOX_KEY, []).filter(x => x.id !== item.id));
    }
  } finally { _flushing = false; }
}
if (typeof window !== "undefined") window.addEventListener("online", () => { flushOutbox(); });
auth.onAuthStateChanged?.(u => { if (u) flushOutbox(); });

// ── Averages kept on the device ──────────────────────────────────────────────
const CACHE_KEY = "delivr_waitavg_cache";
function saveCache() { writeJSON(CACHE_KEY, Object.fromEntries(_cache)); }

// Real average wait for a restaurant + hour. Compute-on-read (mirrors how communityPatterns is
// derived from logs), cached ~10 min per restaurant. Returns { avgMin, count } or null when there
// aren't yet WAIT_MIN_SAMPLES samples for that hour — in which case Stack Check uses 0, unchanged.
// Kept on the device (CACHE_KEY): offline, the last averages fetched are used however old they are.
const _cache = new Map(Object.entries(readJSON(CACHE_KEY, {})));   // key -> { ts, byHour:{hour:[durations]} }
export async function getWaitAverage(key, hour) {
  if (!key) return null;
  try {
    let entry = _cache.get(key);
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (!offline && (!entry || Date.now() - entry.ts > 10 * 60 * 1000)) {
      try {
        const snap = await getDocs(query(collection(db, "waitTimeSamples"), where("restaurantKey", "==", key), limit(500)));
        const byHour = {};
        snap.forEach(d => { const x = d.data(); (byHour[x.hour] = byHour[x.hour] || []).push(x.durationMin); });
        // Samples still in the outbox aren't on the server yet; count them too.
        for (const { data } of readJSON(OUTBOX_KEY, [])) {
          if (data.restaurantKey === key) (byHour[data.hour] = byHour[data.hour] || []).push(data.durationMin);
        }
        entry = { ts: Date.now(), byHour };
        _cache.set(key, entry);
        saveCache();
      } catch { /* unreachable: fall back to whatever is cached */ }
    }
    if (!entry) return null;
    const arr = entry.byHour[hour] || [];
    if (arr.length < WAIT_MIN_SAMPLES) return null;
    const avg = arr.reduce((s, x) => s + x, 0) / arr.length;
    return { avgMin: Math.round(avg * 10) / 10, count: arr.length };
  } catch (e) { return null; }
}

// Admin readout: total wait-time samples collected so far (cheap count aggregation, no doc reads).
export async function getSampleCount(){
  try{ const snap=await getCountFromServer(collection(db,"waitTimeSamples")); return snap.data().count; }
  catch(e){ return null; }
}

// TODO (phase 2, NOT in this pass): live per-order risk gauge — how much of the 45-min window is
// left in real time as the driver moves, separate from this up-front feasibility check.

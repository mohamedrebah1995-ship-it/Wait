// ── SCREEN READER (iOS, Delivr 1.1) ───────────────────────────────────────────
// Bridge to the native ScreenReaderPlugin. Phase 1: start the broadcast and read its status.
// Nothing here reads or stores screen content. The extension only reports state, a heartbeat and counters.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "./firebase";

const IS_IOS = Capacitor.getPlatform() === "ios";
const ScreenReader = IS_IOS ? registerPlugin("ScreenReader") : null;

export const SCREEN_READER_SUPPORTED = IS_IOS;

// Hand the extension what it needs to call /evaluate for a whole shift: the server URL and the driver's
// Firebase refresh token (+ current ID token). The native side keeps them in the shared keychain and the
// extension mints new ID tokens itself, so the app never has to be reopened. Signing out clears them.
if (ScreenReader) {
  const url = import.meta.env.VITE_API_URL || "";
  onIdTokenChanged(auth, async user => {
    try {
      if (!user) { await ScreenReader.setEvaluateAuth({ url, refreshToken: "" }); return; }
      const r = await user.getIdTokenResult();
      await ScreenReader.setEvaluateAuth({
        url, token: r.token, expiresAt: Date.parse(r.expirationTime),
        refreshToken: user.refreshToken, apiKey: auth.app.options.apiKey,
      });
    } catch { /* the extension falls back to offline estimates */ }
  });
}

// The driver's own position for offer checks: rounded to 3 dp (~100 m), at most every 15 s.
// The extension uses it as the run start while it's under 2 minutes old.
let lastFixSent = 0;
export function shareFix(lat, lng) {
  if (!ScreenReader || lat == null || lng == null || Date.now() - lastFixSent < 15000) return;
  lastFixSent = Date.now();
  const r = v => Math.round(v * 1000) / 1000;
  ScreenReader.setFix({ lat: r(lat), lng: r(lng) }).catch(() => {});
}

// Your all-time £/hour from My Stats. Offer checks call an offer "slow" when its marginal £/hour is
// below this (£15/hr until there's history).
export function shareAverageRate(rate) {
  if (!ScreenReader || !(rate > 0)) return;
  ScreenReader.setAverageRate({ rate: Math.round(rate * 100) / 100 }).catch(() => {});
}

export async function endRun() {
  if (ScreenReader) await ScreenReader.endRun();
}

// A heartbeat older than this means the extension is no longer running (broadcast ended or app killed).
const LIVE_WINDOW_MS = 5000;

export async function startShift() {
  if (!ScreenReader) throw new Error("Screen reading is only available in the iOS app.");
  await ScreenReader.startShift();
}

// Last `limit` detected events from the extension's App Group log, newest first. Debug sheet only.
export async function recentEvents(limit = 5) {
  if (!ScreenReader) return [];
  const { events } = await ScreenReader.recentEvents({ limit });
  return (events || []).slice().reverse();
}

// { state, live, ticks, changedFrames, ocrPasses, events, peakMB, lastMB, error }.
// `live` is true only while the extension is heartbeating.
export async function screenReaderStatus() {
  if (!ScreenReader) return { state: "unsupported", live: false, ticks: 0, changedFrames: 0, error: "" };
  const s = await ScreenReader.status();
  const fresh = !!s.lastTickAt && (Date.now() - s.lastTickAt) < LIVE_WINDOW_MS;
  return { ...s, live: s.state === "reading" && fresh };
}

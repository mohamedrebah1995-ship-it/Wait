// ── SCREEN READER (iOS, Delivr 1.1) ───────────────────────────────────────────
// Bridge to the native ScreenReaderPlugin. Phase 1: start the broadcast and read its status.
// Nothing here reads or stores screen content. The extension only reports state, a heartbeat and counters.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "./firebase";

const IS_IOS = Capacitor.getPlatform() === "ios";
const ScreenReader = IS_IOS ? registerPlugin("ScreenReader") : null;

export const SCREEN_READER_SUPPORTED = IS_IOS;

// Hand the extension what it needs to call /evaluate: the server URL and the driver's Firebase ID token.
// Firebase refreshes the token about hourly while the app is open; each refresh is passed on.
if (ScreenReader) {
  const url = import.meta.env.VITE_API_URL || "";
  onIdTokenChanged(auth, async user => {
    try {
      const token = user ? await user.getIdToken() : "";
      await ScreenReader.setEvaluateAuth({ url, token });
    } catch { /* no token → the extension falls back to offline estimates */ }
  });
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

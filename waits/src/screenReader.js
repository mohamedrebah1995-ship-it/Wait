// ── SCREEN READER (iOS, Delivr 1.1) ───────────────────────────────────────────
// Bridge to the native ScreenReaderPlugin. Phase 1: start the broadcast and read its status.
// Nothing here reads or stores screen content. The extension only reports state, a heartbeat and counters.

import { Capacitor, registerPlugin } from "@capacitor/core";

const IS_IOS = Capacitor.getPlatform() === "ios";
const ScreenReader = IS_IOS ? registerPlugin("ScreenReader") : null;

export const SCREEN_READER_SUPPORTED = IS_IOS;

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

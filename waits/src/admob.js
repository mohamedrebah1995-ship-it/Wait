// ── ADMOB CONFIG (iOS app only) ───────────────────────────────────────────────
// One place for the AdMob identifiers, read from .env rather than written into a screen. AdSense
// (the web ad unit in App.jsx) is not allowed to run inside an app, which is why the native build
// needs AdMob instead — and why these two ad systems must never both be live on one surface.
//
// The App ID is ALSO required in ios/App/App/Info.plist under GADApplicationIdentifier. The SDK
// reads that key by name at launch, so it can't be injected from here — the two must be kept
// in step by hand. Changing one means changing the other.

export const ADMOB_APP_ID     = import.meta.env.VITE_ADMOB_APP_ID     || "";
export const ADMOB_BANNER_ID  = import.meta.env.VITE_ADMOB_BANNER_UNIT_ID || "";

// Google's always-fill test unit. Serving real ads to your own device during development is a
// policy violation that can get the account suspended, so anything not a release build uses this.
export const ADMOB_TEST_BANNER_ID = "ca-app-pub-3940256099942544/2934735716";

// Which unit a given build should actually request.
//
// `import.meta.env.PROD` is true for ANY `vite build` — including the native build used for device
// testing — so it can't be the deciding factor on its own: it would serve real ads to your own
// phone, which Google treats as invalid traffic and can suspend the account for.
// VITE_ADMOB_USE_TEST_ADS=true therefore forces the test unit regardless of build mode.
const FORCE_TEST_ADS = String(import.meta.env.VITE_ADMOB_USE_TEST_ADS || "") === "true";

export const bannerUnitId = () =>
  (!FORCE_TEST_ADS && import.meta.env.PROD && ADMOB_BANNER_ID)
    ? ADMOB_BANNER_ID
    : ADMOB_TEST_BANNER_ID;

export const usingTestAds = () => bannerUnitId() === ADMOB_TEST_BANNER_ID;

export const admobConfigured = () => !!ADMOB_APP_ID && !!ADMOB_BANNER_ID;

// Height reserved at the bottom of a screen showing the banner. The banner is a NATIVE view laid
// over the webview, so the web layout knows nothing about it — without this padding it would sit
// on top of the last row of content.
export const ADMOB_BANNER_SLOT_PX = 60;

// ── BANNER CONTROL ────────────────────────────────────────────────────────────
// iOS-app only. On the web this is inert: AdSense already runs there, and AdMob may not.
// Everything fails soft — an ad that won't load must never take a screen down with it.
import { Capacitor } from "@capacitor/core";

const NATIVE_IOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
let started = false, visible = false;

async function plugin() {
  if (!NATIVE_IOS) return null;
  try { return await import("@capacitor-community/admob"); } catch { return null; }
}

// Resolves true only when a banner is actually on screen, so the caller reserves space for a
// banner that exists rather than leaving a dead gap on web or when the ad fails to fill.
export async function showStatsBanner() {
  const m = await plugin();
  if (!m) return false;
  if (visible) return true;
  try {
    if (!started) {
      await m.AdMob.initialize();
      // App Tracking Transparency. Apple requires this prompt BEFORE the IDFA can be used, and
      // AdMob falls back to lower-paying non-personalised ads without it. Asked once — iOS only
      // ever shows the system dialog on `notDetermined`, and a refusal is respected, not re-asked.
      try {
        const { status } = await m.AdMob.trackingAuthorizationStatus();
        if (status === "notDetermined") await m.AdMob.requestTrackingAuthorization();
      } catch { /* ATT unavailable (older iOS) — ads still serve, just non-personalised */ }
      started = true;
    }
    await m.AdMob.showBanner({
      adId: bannerUnitId(),
      adSize: m.BannerAdSize.ADAPTIVE_BANNER,     // anchored adaptive — sizes itself to the screen width
      position: m.BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
    });
    visible = true;
    return true;
  } catch (e) { console.warn("AdMob banner failed:", e?.message || e); return false; }
}

export async function hideStatsBanner() {
  const m = await plugin();
  if (!m || !visible) return;
  visible = false;
  try { await m.AdMob.removeBanner(); }
  catch (e) { console.warn("AdMob removeBanner failed:", e?.message || e); }
}

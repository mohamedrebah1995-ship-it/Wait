// ── ANALYTICS (Google Analytics for Firebase) ─────────────────────────────────
// Nothing existed before this — the Firestore dashboard shows documents, not usage, and Analytics
// is a separate product that has to be switched on for the project.
//
// Requires a measurementId (G-XXXXXXXXXX), which only exists once Google Analytics is enabled in
// the Firebase console. Until VITE_FIREBASE_MEASUREMENT_ID is set this module is completely inert:
// every track() call is a no-op, nothing is imported, nothing can throw. That way the app ships
// safely whether or not the console side is done.
//
// ⚠️ iOS caveat: this is the *web* SDK running in a WKWebView. It reports from the PWA reliably;
// inside the Capacitor app the origin is capacitor:// and attribution is unreliable. Proper native
// reporting needs @capacitor-firebase/analytics, which is a separate job.

import { fbApp } from "./firebase";

const MEASUREMENT_ID = (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "").trim();

export const analyticsEnabled = () => !!MEASUREMENT_ID;

let _analytics = null;      // resolved SDK instance
let _pending = null;        // in-flight init, so concurrent calls share one import

async function instance() {
  if (!MEASUREMENT_ID) return null;
  if (_analytics) return _analytics;
  if (_pending) return _pending;
  _pending = (async () => {
    try {
      const m = await import("firebase/analytics");
      if (!(await m.isSupported())) return null;      // unsupported browser / no cookies
      _analytics = m.getAnalytics(fbApp);
      _analytics.__logEvent = m.logEvent;
      _analytics.__setUserId = m.setUserId;
      _analytics.__setUserProperties = m.setUserProperties;
      return _analytics;
    } catch { return null; }                          // never let reporting break the app
  })();
  return _pending;
}

// Start Analytics as soon as the app loads. This matters more than it looks: Firebase's automatic
// events (first_open, session_start, page_view, user_engagement) are what populate "active users"
// and the whole Realtime card — and they only happen once getAnalytics() has actually run. Without
// this, a driver could open the app, sit on the login screen, and register nothing at all.
export function initAnalytics() {
  if (!MEASUREMENT_ID) return;
  instance().then(a => {
    if (a) { try { a.__logEvent(a, "app_open"); } catch { /* ignore */ } }
  }).catch(() => {});
}

// Fire and forget. Analytics must never delay or break a driver's action, so this is deliberately
// not awaited at any call site and swallows everything.
export function track(event, params) {
  if (!MEASUREMENT_ID) return;
  instance().then(a => { if (a) { try { a.__logEvent(a, event, params || {}); } catch { /* ignore */ } } })
            .catch(() => {});
}

// Ties events to a driver so retention/cohorts work. Firebase forbids PII here, so this takes the
// Firebase uid — never a name or an email address.
export function identify(uid) {
  if (!MEASUREMENT_ID || !uid) return;
  instance().then(a => { if (a) { try { a.__setUserId(a, uid); } catch { /* ignore */ } } })
            .catch(() => {});
}

export function setUserProps(props) {
  if (!MEASUREMENT_ID || !props) return;
  instance().then(a => { if (a) { try { a.__setUserProperties(a, props); } catch { /* ignore */ } } })
            .catch(() => {});
}

// The events worth watching, named in one place so call sites can't drift or typo them.
// GA reserved names (sign_up, login, screen_view) are used where they fit, so Firebase's built-in
// reports light up rather than needing custom ones.
export const EV = {
  signUp:        "sign_up",
  login:         "login",
  screenView:    "screen_view",
  waitLogged:    "wait_logged",        // the core contribution — the number to watch
  stackCheck:    "stack_check_run",    // Stack Check usage, and it costs a Mapbox call
  chatSent:      "chat_message_sent",
  upgradeViewed: "upgrade_viewed",
  planSelected:  "plan_selected",
  learnOpened:   "learn_opened",
};

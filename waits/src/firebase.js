import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, browserLocalPersistence, inMemoryPersistence } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentSingleTabManager, memoryLocalCache, doc as fsDoc, getDocFromCache } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey:            "AIzaSyC1JGXIYJQ4KG3Jt0QEPEvgGRnYN-5aqII",
  authDomain:        "drivers-eyes.firebaseapp.com",
  projectId:         "drivers-eyes",
  storageBucket:     "drivers-eyes.firebasestorage.app",
  messagingSenderId: "927214965437",
  appId:             "1:927214965437:web:6318775a4f7f718ae31dd4",
  // Google Analytics needs this (G-XXXXXXXXXX). Omitted entirely when unset so the SDK doesn't
  // half-initialise — see src/analytics.js, which stays a no-op until it's provided.
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID.trim() }
    : {}),
};

export const fbApp = initializeApp(firebaseConfig);
// Firebase Auth on native (WKWebView): the default IndexedDB persistence write AFTER a successful
// sign-in hangs — the REST calls (signInWithPassword + lookup) return 200 but the promise never
// resolves (breadcrumb stuck on "1/4 signing in"). Force localStorage-backed persistence (fallback to
// in-memory), avoiding IndexedDB entirely. Web keeps the default getAuth().
export const auth = Capacitor.isNativePlatform()
  ? initializeAuth(fbApp, { persistence: [browserLocalPersistence, inMemoryPersistence] })
  : getAuth(fbApp);
// Firestore's default transport (WebChannel streaming) hangs inside the iOS/Android WKWebView, so on
// native we force long-polling (discrete XHRs) which works reliably. This is why sign-in stuck on
// "LOADING…" natively (auth REST succeeded, then the users-doc read never resolved). Web keeps the default.
//
// Offline: on native, Firestore keeps its data and queued writes on the device (IndexedDB), so earnings,
// shifts and wait logs show and save with no signal and sync when it returns. Auth's IndexedDB use
// hung in this WebView (above), so this one proves itself on every launch: one cache read must settle
// within 8s. If it doesn't, the cache is switched off for good on this device and the app reloads once
// with the old in-memory behaviour.
const FS_CACHE_KEY = "delivr_fs_cache";   // "on" (default) | "off" (IndexedDB failed its check here)
const fsCacheOff = (() => { try { return localStorage.getItem(FS_CACHE_KEY) === "off"; } catch { return true; } })();
const useDeviceCache = Capacitor.isNativePlatform() && !fsCacheOff;
export const db    = Capacitor.isNativePlatform()
  ? initializeFirestore(fbApp, {
      experimentalForceLongPolling: true,
      localCache: useDeviceCache ? persistentLocalCache({ tabManager: persistentSingleTabManager() }) : memoryLocalCache(),
    })
  : getFirestore(fbApp);

if (useDeviceCache) {
  const settled = getDocFromCache(fsDoc(db, "_cachecheck", "x")).then(() => true, () => true);   // "not cached" is fine: it answered
  const timedOut = new Promise(r => setTimeout(() => r(false), 8000));
  Promise.race([settled, timedOut]).then(ok => {
    if (ok) return;
    try { localStorage.setItem(FS_CACHE_KEY, "off"); } catch { /* nothing to remember with */ }
    location.reload();
  });
}

// ── Push notifications (FCM) ───────────────────────────────────────────────────
// VAPID public key from Firebase Console → Project Settings → Cloud Messaging →
// Web Push certificates → "Key pair". Push stays inactive until this is set.
const VAPID_KEY = "BFX6FDZ7iIokmowbUGcJl9C_DvPJWxbcgVOeMnBfBzuG3ek3zvgypA0O5-n6qygKfr7bN-L-JHSVEuT_lanjnVs";

// Register the SW, get this device's FCM token and store it on the driver's user doc so the
// backend can push wait reminders. Requires notification permission to already be granted.
// firebase/messaging is imported lazily so it never loads on first paint.
export async function setupPush(uid) {
  try {
    if (!uid || VAPID_KEY === "REPLACE_WITH_VAPID_KEY") return null;
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;
    if (Notification.permission !== 'granted') return null;
    const m = await import('firebase/messaging');
    if (!(await m.isSupported())) return null;
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = m.getMessaging(fbApp);
    const token = await m.getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', uid), { fcmToken: token }, { merge: true });
    }
    m.onMessage(messaging, () => {});   // app open → in-app banner already covers it; ignore
    return token;
  } catch (e) { return null; }
}

// Storage SDK (~12 kB gzip) is only needed for chat photo/voice uploads, so it's
// loaded on demand the first time a driver sends or deletes media — never on first paint.
let _storagePromise = null;
export function loadStorage() {
  if (!_storagePromise) {
    _storagePromise = import('firebase/storage').then(m => ({
      storage: m.getStorage(fbApp),
      ref: m.ref,
      uploadBytes: m.uploadBytes,
      getDownloadURL: m.getDownloadURL,
      deleteObject: m.deleteObject,
    }));
  }
  return _storagePromise;
}

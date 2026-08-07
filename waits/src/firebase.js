import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey:            "AIzaSyC1JGXIYJQ4KG3Jt0QEPEvgGRnYN-5aqII",
  authDomain:        "drivers-eyes.firebaseapp.com",
  projectId:         "drivers-eyes",
  storageBucket:     "drivers-eyes.firebasestorage.app",
  messagingSenderId: "927214965437",
  appId:             "1:927214965437:web:6318775a4f7f718ae31dd4",
};

export const fbApp = initializeApp(firebaseConfig);
export const auth  = getAuth(fbApp);
// Firestore's default transport (WebChannel streaming) hangs inside the iOS/Android WKWebView, so on
// native we force long-polling (discrete XHRs) which works reliably. This is why sign-in stuck on
// "LOADING…" natively (auth REST succeeded, then the users-doc read never resolved). Web keeps the default.
export const db    = Capacitor.isNativePlatform()
  ? initializeFirestore(fbApp, { experimentalForceLongPolling: true })
  : getFirestore(fbApp);

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

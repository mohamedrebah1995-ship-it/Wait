/* Firebase Cloud Messaging service worker — shows wait-reminder push notifications when the
   app is closed or in the background. Uses the compat CDN so it can run standalone. */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC1JGXIYJQ4KG3Jt0QEPEvgGRnYN-5aqII",
  authDomain: "drivers-eyes.firebaseapp.com",
  projectId: "drivers-eyes",
  storageBucket: "drivers-eyes.firebasestorage.app",
  messagingSenderId: "927214965437",
  appId: "1:927214965437:web:6318775a4f7f718ae31dd4",
});

const messaging = firebase.messaging();

// We send data-only messages, so display them ourselves (no duplicate auto-banner).
messaging.onBackgroundMessage((payload) => {
  const d = (payload && payload.data) || {};
  self.registration.showNotification(d.title || 'DELIVR', {
    body: d.body || '',
    tag: 'delivr-wait',     // same tag → a newer reminder replaces the older one
    renotify: true,
    icon: '/favicon.svg',
  });
});

// Tapping the notification focuses/opens the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('https://drivers-eyes.web.app');
    })
  );
});

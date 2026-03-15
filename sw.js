const CACHE = 'vyoraa-v1';
const ASSETS = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// ── PUSH NOTIFICATION HANDLER ────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: '⚡ Sprint Complete!', body: 'Your sprint has finished. How did it go?', tag: 'sprint-done' };

  if (e.data) {
    try { data = { ...data, ...e.data.json() }; }
    catch(err) { data.body = e.data.text(); }
  }

  const options = {
    body: data.body,
    icon: '/favicon-192-pwa.png',
    badge: '/favicon-192-pwa.png',
    tag: data.tag || 'sprint-done',
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 400],
    actions: [
      { action: 'open', title: '📋 Log Task' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    data: { url: '/' }
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── NOTIFICATION CLICK HANDLER ───────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  if (e.action === 'dismiss') return;

  // Open or focus the app
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});

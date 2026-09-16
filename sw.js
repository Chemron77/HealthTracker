// Health Tracker — Service Worker
// Handles offline caching and best-effort daily reminder notifications.

const CACHE_NAME = 'health-tracker-v5';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js'
];

// ── INSTALL: pre-cache app shell ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            // Cross-origin resources (like Chart.js) may fail with strict CORS;
            // fall back to a no-cors opaque request so it still gets cached.
            return fetch(url, { mode: 'no-cors' })
              .then((resp) => cache.put(url, resp))
              .catch(() => console.warn('Precache failed for', url, err));
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean up old caches ───────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: cache-first, falling back to network ─────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          // Cache successful same-origin responses for next time
          if (resp && resp.status === 200 && event.request.url.startsWith(self.location.origin)) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => {
          // Offline fallback: serve the app shell for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

// ── DAILY REMINDER SCHEDULING (best-effort, while SW is alive) ──
let reminderTimeoutId = null;

function msUntil(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function scheduleDaily(hhmm) {
  if (reminderTimeoutId) clearTimeout(reminderTimeoutId);
  const delay = msUntil(hhmm);
  reminderTimeoutId = setTimeout(() => {
    self.registration.showNotification('Health Tracker', {
      body: "Time to log today's health readings.",
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'daily-reminder',
      renotify: true
    });
    scheduleDaily(hhmm); // reschedule for the next day
  }, delay);
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SCHEDULE_NOTIF') {
    scheduleDaily(event.data.time || '08:00');
  }
});

// ── NOTIFICATION CLICK: focus or open the app ────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

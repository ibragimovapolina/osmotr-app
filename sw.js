// ================= Service Worker =================
// Кэширует оболочку приложения, чтобы оно открывалось без интернета.
//
// ⚠️ При обновлении приложения МЕНЯЙТЕ SW_VERSION (например, '1.1.5').
// Это автоматически сбросит старый кэш у всех пользователей.

const SW_VERSION = '2.1.14';
const CACHE_NAME = 'osmotr-' + SW_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './structure.js',
  './sync.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const NETWORK_FIRST = [
  './app.js',
  './db.js',
  './sync.js',
  './structure.js',
  './index.html'
];

self.addEventListener('install', (event) => {
  console.log('[SW] install, версия', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' })))
        .catch((err) => {
          console.warn('[SW] Не все файлы закэшированы:', err);
        });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activate, версия', SW_VERSION);
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api')) return;

  const path = url.pathname.split('/').pop() || 'index.html';
  const isNetworkFirst = NETWORK_FIRST.some(f => f.endsWith(path)) || req.mode === 'navigate';

  if (isNetworkFirst) {
    event.respondWith(
      fetch(req, { cache: 'reload' })
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate') return caches.match('./index.html');
            return new Response('Нет соединения', {
              status: 503,
              statusText: 'Offline',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('Нет соединения', {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

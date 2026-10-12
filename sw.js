// ================= Service Worker =================
// Кэширует оболочку приложения, чтобы оно открывалось без интернета.

const CACHE_NAME = 'osmotr-v1';

// Файлы, которые кэшируем при установке
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

self.addEventListener('install', (event) => {
  console.log('[SW] install');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Не все файлы закэшированы:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] activate');
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

  // Пропускаем запросы к API и сторонним доменам
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api')) return;

  // Только GET кэшируем
  if (req.method !== 'GET') return;

  // Стратегия: сеть → кэш. Если нет сети — отдаём из кэша.
  event.respondWith(
    fetch(req)
      .then((response) => {
        // Кэшируем успешные GET-ответы
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => {
        return caches.match(req).then((cached) => {
          if (cached) return cached;
          // Для навигационных запросов отдаём index.html
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Нет соединения', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
  );
});

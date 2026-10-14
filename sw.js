// ================= Service Worker =================
// Кэширует оболочку приложения, чтобы оно открывалось без интернета.
//
// ⚠️ При обновлении приложения МЕНЯЙТЕ SW_VERSION (например, '1.0.1').
// Это автоматически сбросит старый кэш у всех пользователей.

const SW_VERSION = '1.0.6';
const CACHE_NAME = 'osmotr-' + SW_VERSION;

// Файлы, которые нужно держать в кэше для офлайн-режима.
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

// Эти файлы всегда стараемся взять из сети, кэш — только фолбэк.
// Нужно, чтобы после обновления браузер сразу видел свежий код.
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
      return cache.addAll(PRECACHE_URLS).catch((err) => {
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

  // Только GET
  if (req.method !== 'GET') return;

  // Пропускаем сторонние домены и API
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api')) return;

  // Определяем, для какого файла применять стратегию «сначала сеть»
  const path = url.pathname.split('/').pop() || 'index.html';
  const isNetworkFirst = NETWORK_FIRST.some(f => f.endsWith(path)) || req.mode === 'navigate';

  if (isNetworkFirst) {
    // Network-first: сеть → кэш
    event.respondWith(
      fetch(req)
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

  // Cache-first для всего остального (иконки, manifest, css)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Обновляем кэш в фоне
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

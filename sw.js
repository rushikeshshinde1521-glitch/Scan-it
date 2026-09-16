/* GM Scan Pro - Service Worker
   Caches the app shell so the PWA works fully offline.
   Bump CACHE_NAME on every release so devices pick up the new files. */
const CACHE_NAME = 'gm-scan-pro-v13';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './css/app.css?v=13',
  './js/engine-boot.js?v=13',
  './js/config.js?v=13',
  './js/utils.js?v=13',
  './js/dpm.js?v=13',
  './js/parser.js?v=13',
  './js/scanner.js?v=13',
  './js/history.js?v=13',
  './js/settings.js?v=13',
  './js/ui.js?v=13',
  './vendor/zxing_reader.js',
  './vendor/zxing_reader.wasm'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('GM SW install cache partial:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => {
        if (k !== CACHE_NAME) return caches.delete(k);
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
};

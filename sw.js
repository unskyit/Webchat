// sw.js - Resilient Desktop & Mobile Offline PWA Cache
const CACHE_NAME = 'webchat-v8';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './utils.js',
  './protocol.js',
  './webrtc.js',
  './draw.js',
  './filesystem.js',
  './qrcode.min.js',
  './html5-qrcode.min.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Prevents 1 missing file or 404 from nuking the entire cache
      return Promise.allSettled(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn(`Failed to cache ${url}:`, err))
        )
      );
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // 1. Desktop & Mobile Navigation Requests (App Launch / Refresh)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html')
        .then((indexRes) => indexRes || caches.match('./'))
        .then((res) => res || fetch(e.request))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 2. Resource Requests (Scripts, CSS, Icons)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      
      // If not in cache and offline, don't crash - fallback safely
      return fetch(e.request).catch(() => {
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

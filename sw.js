// sw.js - Resilient Desktop & Mobile Offline PWA Cache
const CACHE_NAME = 'webchat-v12';
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
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html')
        .then((indexRes) => indexRes || caches.match('./'))
        .then((res) => res || fetch(e.request))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      
      return fetch(e.request).catch(() => {
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

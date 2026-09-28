// sw.js
const CACHE_NAME = 'webchat-v4';
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
  self.skipWaiting(); // Forces the waiting service worker to become the active service worker
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Added activate event to wipe out old cache versions (like v3) automatically
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all clients immediately
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // Return cached file if available, otherwise fetch from network
      return response || fetch(e.request);
    })
  );
});

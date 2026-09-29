// sw.js
const CACHE_NAME = 'webchat-v6';
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
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((response) => response || fetch(e.request)));
});

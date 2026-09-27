const CACHE_NAME = 'webchat-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './utils.js',
  './protocol.js',
  './webrtc.js',
  './qrcode.min.js',
  './html5-qrcode.min.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // Return cached file if available, otherwise fetch from network
      return response || fetch(e.request);
    })
  );
});

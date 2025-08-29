// Simple cache-first for static, stale-while-revalidate for runtime (images & CSV)
const STATIC_CACHE = 'vinyl-static-v28';
const RUNTIME_CACHE = 'vinyl-runtime-v28';

const CORE_ASSETS = [
  './',
  './index.html',
  './style.v28.css',
  './app.v28.js',
  './manifest.v28.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js',
  'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(CORE_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only GET
  if (req.method !== 'GET') return;

  // Same-origin static: cache-first
  if (url.origin === self.location.origin) {
    if (CORE_ASSETS.some(a => url.pathname.endsWith(a.replace('./','/')))) {
      event.respondWith(caches.match(req).then(r => r || fetch(req)));
      return;
    }
  }

  // Runtime: images, CSV, cross-origin libs — stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then((networkResp) => {
      try { cache.put(req, networkResp.clone()); } catch(e) {}
      return networkResp;
    }).catch(() => cached);
    return cached || fetchPromise;
  })());
});

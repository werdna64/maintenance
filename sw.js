// NOTE: bump this on every release, alongside the "version" field in
// version.json — app.js polls version.json to detect a stale build and
// prompt a reload; this cache name is what actually makes the new files
// take effect once that reload happens.
const CACHE_NAME = 'maintenance-tracker-0.1.24';
// style.css/app.js/db.js carry a ?v= cache-busting query string in
// index.html (see reloadForUpdate() in app.js for why) — kept identical
// here so install-time pre-caching matches what the page actually
// requests, instead of caching a URL nothing ever asks for.
const ASSETS = [
  './',
  './index.html',
  './style.css?v=0.1.24',
  './app.js?v=0.1.24',
  './db.js?v=0.1.24',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each asset independently — if one fails (e.g. this device
      // has never fetched firebase-config.js yet) the rest still install,
      // instead of addAll() failing the whole install on one miss.
      Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only handle plain http(s) requests — browser extensions (ad blockers,
  // compatibility shims, etc.) route their own chrome-extension:// / moz-
  // extension:// requests through the page's service worker too, and the
  // Cache API throws on anything but http(s). Let the browser handle those
  // itself instead of trying (and failing) to cache them.
  if (!event.request.url.startsWith('http')) return;
  // version.json must always hit the network — it's how the app detects a
  // newer build is live. Never let a cached copy answer this request.
  if (event.request.url.includes('version.json')) return;

  // The page navigation itself (index.html) must always be fetched fresh
  // when there's a connection — it's what pins which ?v=-tagged app.js/
  // db.js/style.css URLs get requested next. A stale cached copy here
  // can pair an old page structure with a freshly-fetched newer script
  // (GitHub Pages ignores the ?v= query string entirely — it's a client
  // cache key only, not a versioned file — so app.js always serves
  // current content regardless of which old query string an old cached
  // index.html asks for), and a script expecting an element the old
  // page doesn't have throws and aborts the rest of its own setup.
  // Network-first here, falling back to cache only when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        // Opportunistically cache the Firebase SDK and anything else the
        // app loads, so a repeat visit works offline too.
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

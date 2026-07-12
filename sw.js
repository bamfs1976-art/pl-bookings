/* Bookings Desk — service worker (PWA)
   Precaches the app shell so it launches offline, and serves static assets
   cache-first. Live FPL data (/api/fpl/*) and Supabase calls are never
   touched here — the app's own data layer decides what is fresh vs cached. */

const VERSION = 'plb-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* Never intercept the API or cross-origin calls (Supabase, CDNs) —
     freshness is the data layer's job. */
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;

  /* The page/app shell: network-first so deploys reach the app
     immediately, falling back to cache when offline. */
  const isShell = req.mode === 'navigate' ||
    url.pathname === '/' || url.pathname === '/index.html' ||
    url.pathname === '/manifest.webmanifest';

  if (isShell) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
    );
    return;
  }

  /* Other static assets (icons, logos): cache-first, then network. */
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
    )
  );
});

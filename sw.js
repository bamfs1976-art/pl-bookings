/* Bookings Desk — service worker (PWA)
   Precaches the app shell so it launches offline, and serves static assets
   cache-first. Live FPL data (/api/fpl/*) and Supabase calls are never
   touched here — the app's own data layer decides what is fresh vs cached. */

const VERSION = 'plb-v8';
const SHELL = [
  '/',
  '/index.html',
  '/data/pl_data.js',
  '/data/ref_history.js',
  '/data/model.js',
  '/assets/core.js',
  '/assets/tw.css',
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

  /* Code and data (the page, the scripts, the dataset, the model, the CSS):
     network-first so a deploy reaches the app immediately and index.html can
     never end up newer than the core.js it depends on. Falls back to cache
     when offline. Everything under /data or /assets, plus .js/.css/.html and
     the manifest, is treated as code. */
  const p = url.pathname;
  const isCode = req.mode === 'navigate' ||
    p === '/' || p === '/manifest.webmanifest' ||
    p.startsWith('/data/') || p.startsWith('/assets/') ||
    /\.(?:js|css|html|webmanifest)$/.test(p);

  if (isCode) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
    );
    return;
  }

  /* Everything else (icons, logos, images): cache-first, then network. */
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

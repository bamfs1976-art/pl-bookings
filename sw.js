/* Bookings Desk — service worker (PWA)
   Precaches the app shell so it launches offline, and serves static assets
   cache-first. Live FPL data (/api/fpl/*) and Supabase calls are never
   touched here — the app's own data layer decides what is fresh vs cached. */

const VERSION = 'plb-v11';
/* Every desk, not just the Premier League one. The shell decides what opens
   with no connection: installed on a phone, a page missing from here is a
   blank screen on the Underground even though it works perfectly on wifi.
   The three newer desks and the shared modules were never added when they
   were built, so the app was installable but only one quarter offline. */
const SHELL = [
  '/',
  '/index.html',
  '/today.html',
  '/eflc.html',
  '/laliga.html',
  '/data-frame.html',
  '/data/pl_data.js',
  '/data/ref_history.js',
  '/data/h2h.js',
  '/data/eflc_h2h.js',
  '/data/laliga_h2h.js',
  '/data/model.js',
  '/data/sim_model.js',
  '/data/eflc_data.js',
  '/data/eflc_fixtures.js',
  '/data/laliga_data.js',
  '/data/laliga_fixtures.js',
  '/data/pl_fixtures.js',
  '/assets/core.js',
  '/assets/save.js',
  '/assets/profile.js',
  '/assets/share.js',
  '/assets/plmodel.js',
  '/assets/suspension.js',
  '/assets/metric.js',
  '/assets/palette.js',
  '/assets/shell.js',
  '/assets/tour.js',
  '/assets/tw.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/logo.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  /* Cached one at a time, NOT with addAll. addAll is atomic: a single 404
     rejects the whole promise, the install fails, and the app has no offline
     shell at all — so a renamed data file would take the entire PWA down
     rather than costing it one page. With 28 entries across four desks that
     stopped being an acceptable trade. Each miss is skipped; the rest install. */
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
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

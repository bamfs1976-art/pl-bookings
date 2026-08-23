/* Bookings Desk — service worker (PWA)
   Precaches the app shell so it launches offline, and serves static assets
   cache-first. Live FPL data (/api/fpl/*) and Supabase calls are never
   touched here — the app's own data layer decides what is fresh vs cached. */

const VERSION = 'plb-v19';
/* Every desk, not just the Premier League one. The shell decides what opens
   with no connection: installed on a phone, a page missing from here is a
   blank screen on the Underground even though it works perfectly on wifi.
   The three newer desks and the shared modules were never added when they
   were built, so the app was installable but only one quarter offline. */
const SHELL = [
  '/',
  /* THE PRETTY ROUTES, not just the files behind them. `caches.match(req)`
     matches on URL, so a rewrite that was never fetched at install time is a
     cache miss offline and falls through to the fallback below — which meant
     tapping "Season calendar" on the Underground silently produced the
     Premier League desk. */
  '/pl',
  '/today',
  '/accas',
  '/derbies',
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
  '/data/core_insights.js',
  '/data/eflc_data.js',
  '/data/eflc_fixtures.js',
  '/data/laliga_data.js',
  '/data/laliga_fixtures.js',
  '/data/pl_fixtures.js',
  /* The 2025/26 match record the Methodology view scores the model against.
     Offline it is the difference between a backtest and an apology. */
  '/data/pl_backtest_2526.js',
  '/assets/accas.js',
  '/assets/rotation.js',
  '/assets/core.js',
  '/assets/save.js',
  '/assets/leaguebar.js',
  '/assets/profile.js',
  '/assets/share.js',
  '/assets/plmodel.js',
  '/assets/suspension.js',
  '/assets/metric.js',
  '/assets/refpicker.js',
  '/assets/a11y.js',
  '/assets/livecards.js',
  '/assets/charts.js',
  '/assets/push.js',
  '/assets/price.js',
  /* The library-backed modules. index.html calls all four directly, so a 404
     here is not a missing feature, it is a throw during boot. */
  '/assets/cardmodel.js',
  '/assets/screener.js',
  '/assets/backtest.js',
  '/assets/adminimport.js',
  '/icons/icon-16.png',
  '/icons/icon-32.png',
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
      /* Last resort is `/` — the home page. It used to be '/index.html', which
         WAS the home page until today's matches took that URL; leaving it
         would have made the offline fallback the Premier League desk, a page
         the reader did not ask for and cannot tell is a fallback. */
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
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

/* ── Web Push ──────────────────────────────────────────────────────────
   Referee appointments for watchlisted players. The payload is JSON from
   netlify/functions/push-cron.js: {title, body, url, tag}.

   EVERY BRANCH SHOWS SOMETHING. A push event that resolves without calling
   showNotification is a visible failure on Android and iOS — the browser
   posts its own "This site has been updated in the background" notice
   instead, which looks like a bug to the reader and cannot be styled or
   suppressed. So a malformed or empty payload still shows the generic
   fallback rather than returning early. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = {}; }
  const title = d.title || 'Bookings Desk';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'A referee appointment has been published.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    /* Tagged per fixture so a re-appointment REPLACES the earlier notice for
       that match rather than stacking a second, contradictory one. */
    tag: d.tag || 'plb',
    renotify: true,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  /* Focus an open tab rather than opening a second one. A notification that
     opens a duplicate desk every time is how people end up with nine tabs and
     no alerts. */
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) {
          if ('navigate' in c) { try { c.navigate(target); } catch (_) {} }
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

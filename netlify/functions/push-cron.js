/* Bookings Desk — referee appointment alerts (Netlify Scheduled Function).
 *
 * THE ONE ALERT THAT JUSTIFIES PUSH ON THIS DESK. PGMOL publish appointments
 * about a week before a round. The moment an official is named, every booking
 * probability in that fixture moves — the referee factor is the largest
 * multiplier the desk applies, running from roughly ×0.8 to ×1.3 — and the
 * fixture card goes from a neutral forecast to a priced one. It is the most
 * time-critical fact this product holds, and until now the only way to learn
 * it was to open the page on the right day and notice.
 *
 * WHY THIS NEEDS MEMORY. "A referee has been appointed" is not a property of
 * the current fixture list. Every appointed fixture looks the same whether it
 * was appointed a minute ago or a month ago; the news is the DIFFERENCE. So
 * the previous assignment per fixture is kept in plb_push_state, and the
 * failure mode of losing it is not silence — it is notifying every subscriber
 * about every appointed fixture, every hour, forever. The first run therefore
 * records the state and sends NOTHING (see `seeded`).
 *
 * WHERE THE DATA COMES FROM. This site's own deployed data/pl_fixtures.js,
 * harvested from API-Football three times a day by .github/workflows/
 * fixtures.yml and overlaid with data/appointments.json. Read from the
 * deployed origin rather than the harvest, because the deployed file is what
 * the app itself shows — an alert about an appointment the site is not yet
 * displaying would send people to a page that disagrees with them.
 *
 * WHO GETS IT. Only subscribers with a watchlisted player at one of the two
 * clubs. A bookings desk that notifies everyone about all ten fixtures is a
 * desk people turn notifications off for after one weekend.
 *
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY. No-ops without them, like every keyed feature
 * here.
 */
'use strict';

const vm = require('node:vm');
const webpush = require('../lib/webpush.js');

exports.config = { schedule: '@hourly' };

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');
const UA = 'Mozilla/5.0 (compatible; PLBookingsDesk/1.0; +https://plbookings.netlify.app)';

/* ── pure: what changed ────────────────────────────────────────────────
   `prev` maps fixture id -> the official assigned last time we looked.
   Returns one entry per fixture whose official is news.

   Two kinds, and they are not the same message. An appointment fills a gap;
   a CHANGE replaces a number the reader may already have acted on, which is
   the more urgent of the two and the one a naive "is ref set?" check misses
   entirely.

   Fixtures that have kicked off are excluded: an official named for a match
   already under way is a correction to the record, not a thing to act on. */
function appointmentNews(prev, fixtures, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const out = [];
  for (const f of fixtures || []) {
    if (!f || f.id == null || !f.ref) continue;
    if (f.st && f.st !== 'NS' && f.st !== 'TBD') continue;      /* started or done */
    const ko = f.d ? Date.parse(f.d) : NaN;
    if (isFinite(ko) && ko <= now) continue;
    const was = prev ? prev[f.id] : undefined;
    if (was === f.ref) continue;                                 /* already told them */
    out.push({ id: f.id, h: f.h, a: f.a, ref: f.ref, d: f.d, changed: !!was, was: was || null });
  }
  return out;
}

/* ── pure: does this subscriber care? ──────────────────────────────────
   A watchlist key is "CLUB|Player Name" — the club is everything before the
   first bar. Returns the matching player names, so the notification can say
   WHO rather than "a player you follow", which is the difference between a
   notification someone acts on and one they dismiss. */
function watchedIn(watch, fixture) {
  const hit = [];
  for (const k of watch || []) {
    if (typeof k !== 'string') continue;
    const bar = k.indexOf('|');
    if (bar < 1) continue;
    const club = k.slice(0, bar);
    if (club === fixture.h || club === fixture.a) hit.push(k.slice(bar + 1));
  }
  return hit;
}

/* ── pure: the words ───────────────────────────────────────────────────
   `ypg` is the official's cards per game where the desk knows it, and the
   league average, so the number carries its own comparison. "3.51 c/g" alone
   means nothing to most readers; "3.51 c/g, league 3.70" is a judgement. */
function alertText(news, names, ypg, leagueYpg) {
  const who = names.length === 1 ? names[0]
    : names.length === 2 ? names[0] + ' and ' + names[1]
      : names[0] + ' and ' + (names.length - 1) + ' others';
  const rate = (ypg == null) ? '' :
    ' · ' + ypg.toFixed(2) + ' cards a game' +
    (leagueYpg == null ? '' : (ypg > leagueYpg ? ' (strict)' : ypg < leagueYpg ? ' (lenient)' : ''));
  return {
    title: news.changed
      ? 'Referee changed: ' + news.h + ' v ' + news.a
      : 'Referee appointed: ' + news.h + ' v ' + news.a,
    body: (news.changed ? news.ref + ' replaces ' + news.was : news.ref) + rate + ' — affects ' + who,
  };
}

/* ── Supabase over REST ───────────────────────────────────────────────── */
function srvHeaders(srv, extra) {
  return { apikey: srv, Authorization: 'Bearer ' + srv, ...(extra || {}) };
}
async function getState(srv, key) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/plb_push_state?key=eq.' + encodeURIComponent(key) + '&select=value',
    { headers: srvHeaders(srv) });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0].value : null;
}
async function setState(srv, key, value) {
  await fetch(SUPABASE_URL + '/rest/v1/plb_push_state?on_conflict=key', {
    method: 'POST',
    headers: srvHeaders(srv, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

/* Read one of our own generated data files off the deployed site. Evaluated
   in a bare vm context — the same thing scripts/build-sim-model.mjs does with
   pl_data.js, and for the same reason: these are `const X = [...]` files with
   no export, and a regex over 380 records is a parser nobody wants to own.
   The context has no require, no process and no globals. */
async function loadDataFile(origin, path, name) {
  const r = await fetch(origin + path, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
  const ctx = Object.create(null);
  vm.createContext(ctx);
  vm.runInContext(await r.text(), ctx, { timeout: 4000 });
  const v = vm.runInContext(name, ctx);
  if (!v) throw new Error(path + ': did not define ' + name);
  return v;
}

exports.handler = async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:alerts@plbookings.netlify.app';
  if (!pub || !priv || !srv) return { statusCode: 200, body: 'not configured' };

  const origin = (process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/+$/, '');
  if (!origin) return { statusCode: 200, body: 'no site origin' };

  let fixtures, refs = [];
  try {
    fixtures = await loadDataFile(origin, '/data/pl_fixtures.js', 'PL_FIXTURES');
  } catch (e) {
    /* An unreachable data file must not advance the state — doing so would
       mark unseen appointments as already-told and lose them permanently. */
    return { statusCode: 200, body: 'fixtures unavailable: ' + e.message };
  }
  try { refs = await loadDataFile(origin, '/data/pl_data.js', 'REFS') || []; } catch (_) { /* rate is optional */ }

  const rate = {};
  refs.forEach((r) => { if (r && r.n && r.ypg != null) rate[r.n] = r.ypg; });
  const rated = Object.values(rate);
  const leagueYpg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null;

  const prev = await getState(srv, 'appointments');
  const state = {};
  (fixtures || []).forEach((f) => { if (f && f.id != null && f.ref) state[f.id] = f.ref; });

  /* FIRST RUN SENDS NOTHING. With no previous state every appointed fixture
     in the season looks new, and the first thing this feature would ever do
     is send every subscriber a notification for all of them. */
  if (!prev) {
    await setState(srv, 'appointments', state);
    return { statusCode: 200, body: 'seeded ' + Object.keys(state).length + ' appointments, sent nothing' };
  }

  const news = appointmentNews(prev, fixtures);
  if (!news.length) {
    await setState(srv, 'appointments', state);
    return { statusCode: 200, body: 'no new appointments' };
  }

  const sr = await fetch(SUPABASE_URL + '/rest/v1/plb_push_subs?select=endpoint,p256dh,auth,watch,prefs',
    { headers: srvHeaders(srv) });
  const subs = sr.ok ? await sr.json() : [];

  let sent = 0, gone = 0;
  const dead = [];
  for (const n of news) {
    const targets = (subs || []).filter((s) => !s.prefs || s.prefs.appointment !== false);
    await Promise.allSettled(targets.map(async (s) => {
      const names = watchedIn(s.watch, n);
      if (!names.length) return;                     /* not their fixture */
      const { title, body } = alertText(n, names, rate[n.ref], leagueYpg);
      try {
        const res = await webpush.send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, url: '/#p=gameweek', tag: 'appointment-' + n.id }),
          { publicKey: pub, privateKey: priv, subject },
          { ttl: 6 * 60 * 60, urgency: 'normal' }
        );
        if (res.ok) sent++;
        else if (res.gone) { gone++; dead.push(s.endpoint); }
      } catch (_) { /* one bad endpoint must not stop the round */ }
    }));
  }

  /* Expired subscriptions are the only way this table ever shrinks. */
  for (const e of dead) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/plb_push_subs?endpoint=eq.' + encodeURIComponent(e),
        { method: 'DELETE', headers: srvHeaders(srv, { Prefer: 'return=minimal' }) });
    } catch (_) { /* it will be retried next run */ }
  }

  /* Advance ONLY after a send round completed. If the process dies mid-round
     the state is unchanged and the next run re-sends — a duplicate
     notification is a far smaller cost than a missed appointment, which is
     the entire product. */
  await setState(srv, 'appointments', state);
  return { statusCode: 200,
    body: 'sent ' + sent + ' for ' + news.length + ' appointment change(s), pruned ' + gone };
};

module.exports.appointmentNews = appointmentNews;
module.exports.watchedIn = watchedIn;
module.exports.alertText = alertText;

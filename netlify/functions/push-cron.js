/* Bookings Desk — referee appointment alerts (Netlify Scheduled Function).
 *
 * TWO ALERTS, ONE JOB. Both are things the desk already knew and could only
 * tell you if you happened to open the page:
 *
 *   1. A referee has been appointed to a fixture involving a watchlisted
 *      player.
 *   2. A watchlisted player is ONE CAUTION from a ban.
 *
 * THE FIRST ALERT. PGMOL publish appointments
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
/* The suspension ladder is NOT reimplemented here. PLDCore.nextSuspension is
   the rule the page itself prices with, it is already unit-tested, and the
   part that is easy to get wrong is not the arithmetic — it is that an
   English rung EXPIRES. Five cautions is a ban only if reached by the club's
   19th match, so a player on four after that match is not one from a ban at
   all, and a `cards === 4` check would notify about a suspension that cannot
   happen. Requiring the real function is the only way to be sure the alert
   and the page agree. */
const PLDCore = require('../../assets/core.js');

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
function watchedIn(watch, fixture, league) {
  return PLDCore.watchedFor(watch, fixture, league || 'PL');
}

/* ── pure: one caution from a ban ──────────────────────────────────────
   `played` maps club short code -> league matches that club has completed,
   which is what the English gates count. Returns one entry per player who is
   exactly one caution away from a rung that is still reachable.

   NO MINUTES FLOOR, deliberately, and unlike the on-page watch strip. That
   strip ranks the whole league and has to keep fringe players out of a list
   nobody can read. This fires only for a player somebody explicitly starred,
   and "he barely plays" is the subscriber's judgement to have already made.

   Players the feed reports as gone (status 'u') are skipped: a ban is not
   news for someone who has left. */
function banWatch(elements, teamShort, played, scheme) {
  const out = [];
  for (const e of elements || []) {
    if (!e || e.id == null) continue;
    if (e.status === 'u') continue;
    const club = teamShort[e.team];
    if (!club) continue;
    const next = PLDCore.nextSuspension(Number(e.yellow_cards) || 0, played[club] || 0, scheme);
    if (!next || next.dead || next.need !== 1) continue;
    out.push({
      el: e.id,
      name: e.web_name,
      club,
      cards: Number(e.yellow_cards) || 0,
      at: next.at,
      ban: next.ban,
      by: next.by,
      /* Matches left before the gate closes. null = no gate on this rung.
         It is the difference between "one away, and he has 9 matches to
         avoid it" and "one away, with 1 match left" — the same fact and a
         completely different decision. */
      left: next.by != null ? Math.max(0, next.by - (played[club] || 0)) : null,
    });
  }
  return out;
}

/* Which of these are worth telling anyone about. Keyed on the RUNG, not on a
   boolean: a player who is one from the 5-rung, gets booked, serves the ban
   and later comes one from the 10-rung is news twice, and a flag would only
   ever fire once. */
function banNews(prev, watch) {
  const out = [];
  for (const w of watch || []) {
    if (prev && prev[w.el] === w.at) continue;
    out.push(w);
  }
  return out;
}

/* Club short code -> completed league matches, from the FPL fixture feed.
   The gates count the CLUB's match number rather than the gameweek, which
   differ the moment a game is postponed — and a postponement is exactly when
   a gate is about to matter. */
function playedByClub(fixtures, teamShort) {
  const n = {};
  for (const f of fixtures || []) {
    if (!f || !f.finished) continue;
    const h = teamShort[f.team_h], a = teamShort[f.team_a];
    if (h) n[h] = (n[h] || 0) + 1;
    if (a) n[a] = (n[a] || 0) + 1;
  }
  return n;
}

function banText(w) {
  const gate = w.left == null
    ? 'no cut-off on this one'
    : w.left === 1 ? 'his club\'s last match before the cut-off'
      : w.left + ' matches left before the cut-off';
  return {
    title: w.name + ' is one booking from a ban',
    body: w.cards + ' of ' + w.at + ' (' + w.club + ') — the next one costs '
      + w.ban + ' match' + (w.ban === 1 ? '' : 'es') + '. ' + gate + '.',
  };
}

/* ── pure: the words ───────────────────────────────────────────────────
   PLDCore.refAlertText, shared and unit-tested: the official's yellow cards a
   game with the league figure beside it, so the number is a comparison. */
function alertText(news, names, ypg, leagueYpg) {
  return PLDCore.refAlertText(news, names, ypg, leagueYpg);
}

/* ── the four leagues ───────────────────────────────────────────────────
   Each league reads its own deployed fixture and referee files and keeps its
   own memory of who was appointed, so one league's first run (which records
   and sends nothing) never replays another's. The Premier League keeps the
   state key it has always had. */
const LEAGUES = [
  { code: 'PL', fixtures: ['/data/pl_fixtures.js', 'PL_FIXTURES'], refs: ['/data/pl_data.js', 'REFS'],
    state: 'appointments', url: '/#p=gameweek', tag: (id) => 'appointment-' + id },
  { code: 'EFLC', fixtures: ['/data/eflc_fixtures.js', 'EFLC_FIXTURES'], refs: ['/data/eflc_data.js', 'REFS'],
    state: 'appointments_EFLC', url: '/eflc.html', tag: (id) => 'appointment-EFLC-' + id },
  { code: 'LL', fixtures: ['/data/laliga_fixtures.js', 'LALIGA_FIXTURES'], refs: ['/data/laliga_data.js', 'REFS'],
    state: 'appointments_LL', url: '/laliga.html', tag: (id) => 'appointment-LL-' + id },
  { code: 'SA', fixtures: ['/data/seriea_fixtures.js', 'SERIEA_FIXTURES'], refs: ['/data/seriea_data.js', 'REFS'],
    state: 'appointments_SA', url: '/seriea.html', tag: (id) => 'appointment-SA-' + id },
];

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

  /* ── ALERT 1: appointments, per league ───────────────────────────────
     An unreachable fixture file skips THAT league and leaves its state where
     it was: advancing it would mark unseen appointments as already-told and
     lose them for good. The referee file is optional; without it the alert
     says the official has no card record yet. */
  const leagues = [];
  for (const L of LEAGUES) {
    let fixtures;
    try { fixtures = await loadDataFile(origin, L.fixtures[0], L.fixtures[1]); } catch (_) { continue; }
    let refs = [];
    try { refs = await loadDataFile(origin, L.refs[0], L.refs[1]) || []; } catch (_) { refs = []; }
    const leagueYpg = refs.length ? PLDCore.leagueRates(refs).avgYpg : null;
    const state = {};
    (fixtures || []).forEach((f) => { if (f && f.id != null && f.ref) state[f.id] = f.ref; });
    leagues.push({ L, fixtures, refs, leagueYpg, state, prev: await getState(srv, L.state) });
  }

  /* ── ALERT 2: one caution from a ban ───────────────────────────────────
     Needs this season's cautions and each club's completed match count, both
     from the official FPL feed. Best-effort: if that feed is down the
     appointment alert still runs, because one source failing should not
     silence the other. */
  let banNow = [], scheme = null;
  try { scheme = await loadDataFile(origin, '/data/pl_data.js', 'SUSPENSION'); } catch (_) { /* no ladder, no watch */ }
  if (scheme) {
    try {
      const boot = await (await fetch('https://fantasy.premierleague.com/api/bootstrap-static/',
        { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
      const fx = await (await fetch('https://fantasy.premierleague.com/api/fixtures/',
        { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
      const teamShort = {};
      (boot.teams || []).forEach((t) => { teamShort[t.id] = t.short_name; });
      banNow = banWatch(boot.elements, teamShort, playedByClub(fx, teamShort), scheme);
    } catch (_) { banNow = []; }
  }
  const prevBan = await getState(srv, 'banwatch');
  const banState = {};
  banNow.forEach((w) => { banState[w.el] = w.at; });

  /* FIRST RUN SENDS NOTHING. With no previous state every appointed fixture
     and every player already on the edge looks new, and the first thing this
     feature would ever do is notify every subscriber about all of them.
     Seeded per alert, so switching the second one on later does not replay
     the first. */
  const seeded = [];
  for (const g of leagues) {
    if (g.prev) continue;
    await setState(srv, g.L.state, g.state);
    seeded.push(g.L.code + ' ' + Object.keys(g.state).length + ' appointments');
  }
  const banSeeded = !!(scheme && !prevBan);
  if (banSeeded) { await setState(srv, 'banwatch', banState); seeded.push(banNow.length + ' on the ban edge'); }

  const live = leagues.filter((g) => g.prev);
  const apptNews = [];
  for (const g of live) {
    for (const n of appointmentNews(g.prev, g.fixtures)) apptNews.push({ g, n });
  }
  const banNewsList = (scheme && !banSeeded) ? banNews(prevBan, banNow) : [];

  const advance = async () => {
    for (const g of live) await setState(srv, g.L.state, g.state);
    if (scheme && !banSeeded) await setState(srv, 'banwatch', banState);
  };

  if (!apptNews.length && !banNewsList.length) {
    await advance();
    return { statusCode: 200, body: seeded.length ? 'seeded ' + seeded.join(', ') + ', nothing new elsewhere' : 'nothing new' };
  }

  const sr = await fetch(SUPABASE_URL + '/rest/v1/plb_push_subs?select=endpoint,p256dh,auth,watch,els,prefs',
    { headers: srvHeaders(srv) });
  const subs = sr.ok ? await sr.json() : [];

  let sent = 0, gone = 0;
  const dead = [];
  const deliver = async (s, payload) => {
    try {
      const res = await webpush.send(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { publicKey: pub, privateKey: priv, subject },
        { ttl: 6 * 60 * 60, urgency: 'normal' }
      );
      if (res.ok) sent++;
      else if (res.gone) { gone++; dead.push(s.endpoint); }
    } catch (_) { /* one bad endpoint must not stop the round */ }
  };

  for (const { g, n } of apptNews) {
    const targets = (subs || []).filter((s) => !s.prefs || s.prefs.appointment !== false);
    const ypg = PLDCore.refRateFor(n.ref, g.refs);
    await Promise.allSettled(targets.map(async (s) => {
      const names = watchedIn(s.watch, n, g.L.code);
      if (!names.length) return;                     /* not their fixture */
      const { title, body } = alertText(n, names, ypg, g.leagueYpg);
      await deliver(s, { title, body, url: g.L.url, tag: g.L.tag(n.id) });
    }));
  }

  for (const w of banNewsList) {
    const targets = (subs || []).filter((s) => !s.prefs || s.prefs.ban !== false);
    await Promise.allSettled(targets.map(async (s) => {
      /* Element ids, not names: this targets a PLAYER, and the id is the only
         identity shared with the FPL feed. A subscriber whose client has
         never seen the live feed has no ids yet and simply does not match. */
      if (!Array.isArray(s.els) || s.els.indexOf(w.el) < 0) return;
      const { title, body } = banText(w);
      await deliver(s, { title, body, url: '/#p=gameweek', tag: 'ban-' + w.el });
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
  await advance();
  return { statusCode: 200,
    body: 'sent ' + sent + ' for ' + apptNews.length + ' appointment change(s) and '
      + banNewsList.length + ' ban-edge change(s), pruned ' + gone };
};

module.exports.LEAGUES = LEAGUES;
module.exports.appointmentNews = appointmentNews;
module.exports.watchedIn = watchedIn;
module.exports.alertText = alertText;
module.exports.banWatch = banWatch;
module.exports.banNews = banNews;
module.exports.playedByClub = playedByClub;
module.exports.banText = banText;

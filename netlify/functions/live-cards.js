/* Live card events for the divisions FPL does not cover.
 *
 * WHY THIS EXISTS. assets/livecards.js says it plainly: "a bookings desk
 * saying a carded player is a 52% chance of being carded is the worst
 * sentence this product can produce." It has said that since it was written —
 * and it has only ever been loaded on index.html, because its source is the
 * official Fantasy Premier League live feed and FPL is the Premier League and
 * nothing else. At 4.30pm on a Saturday the Championship and La Liga desks
 * still showed a booked player as a 52% chance of being booked.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY IT IS NOT SHAPED LIKE netlify/functions/fpl.js
 * ═══════════════════════════════════════════════════════════════════════
 * That proxy sets `Cache-Control: no-store` on the live endpoints, and it is
 * right to: the FPL API is free, keyless and unmetered, so the only cost of a
 * poll is a moment of latency, and holding a live feed for five minutes is
 * five minutes of being wrong.
 *
 * API-Football is metered. Every request spends a call against a daily
 * allowance, and this function is called by BROWSERS — one per reader per
 * poll. `no-store` here would mean a hundred readers polling once a minute
 * costs a hundred calls a minute, which empties a 7,500 allowance in about an
 * hour of one busy Saturday. So this function is CACHED AT THE EDGE, and the
 * cache is the cost control: however many people are watching, the upstream
 * sees one refresh per TTL.
 *
 * The TTL is the whole trade-off. Too long and the page says "not booked"
 * about a man who was booked; too short and a popular afternoon costs the
 * week's quota. 60 seconds is the compromise, and it is stated on the page:
 * a card reaches a reader within a minute of the feed carrying it.
 *
 * WHAT IT SPENDS, PER REFRESH. One /fixtures?live= call for all the requested
 * divisions at once, plus — only if that response does not already carry the
 * events — one /fixtures/events per in-play fixture. Whether the live payload
 * inlines events is NOT something this repository has been able to verify (see
 * data/harvest_extra.py: the module was written without a key), so the code
 * takes the cheap path when it can and the expensive one when it must, and
 * REPORTS which in `upstream`. That number is the answer to "what is this
 * costing", and it is in the response rather than a log so it can be read from
 * the page.
 *
 * MAX_FIXTURES is the hard stop. An unbounded fan-out is how a metered
 * endpoint behind a public URL becomes a bill.
 */

const HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const KEY = process.env.API_FOOTBALL_KEY || '';

/* The divisions this may be asked about, and their API-Football ids. An
   allowlist and not a passthrough: the league id arrives in a query string a
   reader controls, and without this the function is an open, authenticated
   proxy to somebody else's metered API. */
const LEAGUES = { EFLC: 40, LL: 140, PL: 39 };

/* Cards only. Every other event type is noise for this desk, and dropping
   them at the edge keeps the payload small enough to poll. */
const CARD = 'card';
const SECOND_YELLOW = 'second yellow card';

/* One busy Saturday across two divisions is about a dozen in-play fixtures.
   Twice that is a stop, not a target. */
const MAX_FIXTURES = 24;
const TTL = 60;

/* THE TTL THE EXPENSIVE PATH GETS, and the reason there are two.
 *
 * The cheap path is one call a refresh: at 60s that is 60 calls an hour, which
 * is nothing. The fan-out path is one call PER LIVE MATCH, and at 60s across a
 * Saturday's twenty in-play fixtures it is 1,200 an hour — 7,200 over a day of
 * football, against an allowance of 7,500. data/api_budget.py carries both
 * branches precisely because the gap between them is the whole risk.
 *
 * So the path that costs twenty times as much refreshes three times as slowly,
 * and the response says which TTL it was given. This is self-regulating: no
 * ceiling to breach, no state to keep, and the day the live payload starts
 * inlining events the function speeds back up on its own.
 *
 * WHY NOT SKIP THE FAN-OUT ON SOME REFRESHES INSTEAD. Because a response
 * assembled without it carries `cards: []`, which is indistinguishable on the
 * page from a match in which nobody has been booked. A slower complete answer
 * is safe; a fast empty one that reads as "not booked" is not.
 */
const FANOUT_TTL = 180;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

function headers(extra) {
  return { ...CORS, 'Content-Type': 'application/json', ...(extra || {}) };
}

async function get(path, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://${HOST}/${path}?${qs}`, {
    headers: HOST.indexOf('rapidapi') > -1
      ? { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST }
      : { 'x-apisports-key': KEY },
  });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

/* A card event as the ticker wants it. Exported shape:
   {c: club name as the feed spells it, n: player, k: Y|Y2|R, m: minute}

   THE CLUB IS NOT RESOLVED HERE. The desks each hold their own name map and
   the function does not; sending the feed's spelling and letting the page
   resolve it keeps one club-name join per desk instead of a fourth one in a
   serverless function nobody would think to look in. */
function cardsOf(events) {
  const out = [];
  for (const e of (events || [])) {
    if (String((e && e.type) || '').toLowerCase() !== CARD) continue;
    const detail = String(e.detail || '').toLowerCase();
    const k = detail === SECOND_YELLOW ? 'Y2'
      : detail.indexOf('red') === 0 ? 'R'
        : detail.indexOf('yellow') === 0 ? 'Y' : null;
    /* An unrecognised card label is CARRIED, not dropped, marked with its own
       text. Dropping it would quietly shrink a live count that the reader is
       watching change; the page can show "1 card" it cannot name more
       honestly than it can show none. */
    const t = e.time || {};
    out.push({
      c: ((e.team || {}).name || '').trim(),
      n: ((e.player || {}).name || '').trim(),
      k: k || ('?' + (e.detail || '')),
      m: t.elapsed == null ? null : Number(t.elapsed) + (Number(t.extra) || 0),
    });
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: headers(), body: 'Method Not Allowed' };
  }
  if (!KEY) {
    /* NOT AN ERROR THE PAGE SHOULD SHOW AS BROKEN. A desk without a key is a
       desk with no live layer, which is exactly where the other two have been
       all along — the forecast view is still correct. */
    return { statusCode: 200, headers: headers({ 'Cache-Control': 'public, max-age=300' }),
      body: JSON.stringify({ live: false, reason: 'no key configured', fixtures: {} }) };
  }

  const q = (event.queryStringParameters || {});
  const codes = String(q.leagues || 'EFLC,LL')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const ids = codes.map((c) => LEAGUES[c]).filter(Boolean);
  if (!ids.length) {
    return { statusCode: 400, headers: headers(),
      body: JSON.stringify({ error: 'no division this function serves', asked: codes }) };
  }

  let upstream = 0;
  try {
    /* ONE CALL FOR EVERY DIVISION ASKED FOR. The endpoint takes a dash-joined
       list, so two divisions cost the same as one. */
    const live = await get('fixtures', { live: ids.join('-') });
    upstream++;
    const rows = (live && live.response) || [];

    const fixtures = {};
    let inlined = 0;
    const needEvents = [];
    for (const r of rows.slice(0, MAX_FIXTURES)) {
      const fx = r.fixture || {}, tm = r.teams || {};
      const id = String(fx.id);
      fixtures[id] = {
        h: ((tm.home || {}).name || '').trim(),
        a: ((tm.away || {}).name || '').trim(),
        minute: ((fx.status || {}).elapsed == null) ? null : Number(fx.status.elapsed),
        status: ((fx.status || {}).short || '').trim(),
        cards: [],
      };
      if (Array.isArray(r.events)) {
        fixtures[id].cards = cardsOf(r.events);
        inlined++;
      } else {
        needEvents.push(id);
      }
    }

    /* THE EXPENSIVE PATH, taken only for what the cheap one did not answer.
       Whether /fixtures?live= inlines events is not something this repository
       could verify without a key; both branches are live code and `upstream`
       says which ran. */
    for (const id of needEvents) {
      try {
        const ev = await get('fixtures/events', { fixture: id });
        upstream++;
        fixtures[id].cards = cardsOf((ev && ev.response) || []);
      } catch (e) {
        /* One fixture's events failing is not the whole ticker failing. It
           shows as a fixture with no cards yet, which is also what a clean
           first half looks like — so it is marked. */
        fixtures[id].partial = true;
      }
    }

    /* WHAT THIS REFRESH ACTUALLY COST decides how long it is cached. A refresh
       that fanned out spent `upstream` calls instead of one, so it is held
       three times as long; one that got its events inlined stays on the fast
       TTL. The choice is made from what happened, not from what we assumed
       would happen — which matters because which branch runs is the thing
       this repository has never been able to verify. */
    const ttl = needEvents.length ? FANOUT_TTL : TTL;

    return {
      statusCode: 200,
      headers: headers({
        /* THE COST CONTROL. One upstream refresh per TTL however many readers
           are watching. stale-while-revalidate so a reader never waits on the
           upstream call, and never sees a blank ticker while it runs. */
        'Cache-Control': `public, max-age=${ttl}, stale-while-revalidate=${ttl * 3}`,
      }),
      body: JSON.stringify({
        live: true,
        fetched: new Date().toISOString(),
        ttl,
        /* WHAT THIS REFRESH COST, in the response rather than a log, because
           the question "what is the live layer spending" should be answerable
           from the page. */
        upstream,
        inlined,
        truncated: rows.length > MAX_FIXTURES ? rows.length - MAX_FIXTURES : 0,
        fixtures,
      }),
    };
  } catch (e) {
    /* A FAILED POLL IS NOT NEWS THAT THE CARDS WERE RESCINDED. The client
       keeps its previous index; this must not be cached long enough to
       outlive the outage. */
    return { statusCode: 502, headers: headers({ 'Cache-Control': 'public, max-age=15' }),
      body: JSON.stringify({ live: false, error: 'upstream fetch failed', upstream }) };
  }
};

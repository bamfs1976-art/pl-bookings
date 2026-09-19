// What does a free BSD (sports.bzzoiro.com) token actually return? A read-only probe.
//
// Same shape and same reasoning as scripts/probe-football-data.mjs: the agent
// proxy denies sports.bzzoiro.com, so nothing about this API can be verified
// from a Claude Code session. CI is not restricted — the fixtures job already
// reaches API-Football from there — so this script is how a claim in the BSD
// marketing copy becomes a measurement in a log.
//
// WHY THIS API IS WORTH A PROBE AT ALL — and what is NOT the reason.
//
// docs/free-data-sources.md (August 2026) lists six gaps. Four of them have
// since been closed and that note was not updated, so DO NOT probe against it.
// Re-measured on 19 September 2026 from the repository itself:
//
//   availability  CLOSED — data/*_injuries.js, four leagues, daily
//   photographs   CLOSED — check-photos reports PL 424/661, other three 100%
//   card odds     CLOSED — data/*_odds.js carries bookmakers' CARD lines
//   live cards    CLOSED — livecards.js polls /api/live-cards on every desk
//
// What is actually left, and what this probe is therefore for:
//
//   1. COVERAGE. Does one free token see Premier League, Championship, La Liga
//      and Serie A? Nothing else matters if the answer is Premier League only,
//      because that is the one desk already served by a free feed.
//
//   2. SUPPLIER CONCENTRATION — the real finding. Every item in the CLOSED
//      list above comes from ONE paid supplier, API-Football: injuries, odds,
//      lineups, live cards, standings, transfers and referee appointments all
//      ride the same key and the same 7,500-a-day allowance. That is not a
//      data gap, it is a single point of failure over the whole desk, and
//      docs/referee-sourcing.md §"Then consider a second source" already says
//      so about the referee number alone. A free second source would be worth
//      having even if it carried nothing new.
//
//   3. THE UNCAPPED COST TERM. data/api_budget.py puts observed usage at 2,128
//      calls on a peak day — comfortable — but 4,768 worst case, and the term
//      that moves is live-cards.js, a browser-facing function whose cost
//      scales with READERS rather than with matches. It is the one line on the
//      bill nobody controls. Moving it to a free feed removes it. That makes
//      the live and incident rows below the highest-value answers in this run.
//
//   4. GENUINELY NEW DATA. BSD advertises xG, shotmaps and per-player match
//      statistics, none of which this repository has. The one that would pay
//      for itself is FOULS PER PLAYER: docs/decisions.md records the promoted
//      clubs' fouls-drawn figure being entered BY HAND because no permitted
//      free source carries it.
//
//   5. LINEUPS BEFORE KICK-OFF. Harvested today by lineups.yml at about 84
//      calls a day. Not a gap, but a second free source would take those calls
//      off the metered key. An API returning lineups only for finished games
//      is a post-match record and prices nothing, so this is asked both ways.
//
//   6. WHAT IT COSTS. Rate-limit headers, and what a free token is refused.
//
// DISCOVERY, NOT ASSUMPTION. The published docs are unreachable from the
// session that wrote this, so the exact sub-resource paths are not known here.
// Rather than hard-code guesses that would fail as opaque 404s, the probe
// walks a ladder — root, leagues, a season, events, then one event of each
// status — and tries a list of CANDIDATE paths at each rung, reporting which
// answered. A 404 is a finding, not a crash. Field names are printed as they
// arrive so the next session can write a real client against observed shapes.
//
// It WRITES NOTHING and commits nothing. Every call is a GET.
//
// Run:  BSD_API_KEY=... node scripts/probe-bsd.mjs
// or dispatch .github/workflows/probe-bsd.yml with the key in Actions secrets.

const TOKEN = process.env.BSD_API_KEY || '';
const BASE = 'https://sports.bzzoiro.com/api/v2';

/* No published free-tier limit was readable when this was written, so the
   pacing is deliberately conservative and the probe reports whatever
   X-RateLimit headers come back. ~40 calls at 1.2s is under a minute; if the
   real limit turns out to be looser, lower it, and if a 429 arrives the
   handler below backs off once and says so rather than filing it as a refusal. */
const MIN_INTERVAL_MS = 1200;

/* Slugs and names are both tried because a league index may key on either.
   `desk` is what this repository would actually gain, which is the only
   reason any of these are on the list. */
const LEAGUES = [
  { key: 'premier-league',  names: ['Premier League'],                 desk: 'index.html — live via the free FPL proxy' },
  { key: 'championship',    names: ['Championship', 'EFL Championship'], desk: 'eflc.html — every feed on the metered key' },
  { key: 'laliga',          names: ['LaLiga', 'La Liga', 'Primera División'], desk: 'laliga.html — every feed on the metered key' },
  { key: 'serie-a',         names: ['Serie A'],                        desk: 'seriea.html — every feed on the metered key' }
];

if (!TOKEN) {
  console.log('::error::BSD_API_KEY is not set — nothing can be probed.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
let calls = 0;
let rateLimitSeen = null;

/* Returns a result object rather than throwing. A 403 or a 404 IS the finding
   when the question is "what is this token entitled to and what exists", so
   neither may abort the run. */
async function api(path) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);

  for (let attempt = 0; attempt < 2; attempt++) {
    lastCall = Date.now();
    calls++;
    let res;
    try {
      res = await fetch(BASE + path, {
        headers: { Authorization: `Token ${TOKEN}`, Accept: 'application/json' }
      });
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }

    /* Worth capturing once. The free tier's real ceiling decides whether this
       API can sit behind a browser-facing function at all — which is the
       whole question for the live ticker — and the headers are the only
       honest source for it. */
    if (!rateLimitSeen) {
      const limit = res.headers.get('x-ratelimit-limit') || res.headers.get('ratelimit-limit');
      const remaining = res.headers.get('x-ratelimit-remaining') || res.headers.get('ratelimit-remaining');
      if (limit || remaining) rateLimitSeen = { limit, remaining };
    }

    if (res.status === 429 && attempt === 0) {
      const after = Number(res.headers.get('retry-after')) || 30;
      console.log(`   … rate limited, waiting ${after}s`);
      await sleep(after * 1000);
      continue;
    }

    let body = null;
    let text = null;
    try {
      text = await res.text();
      body = JSON.parse(text);
    } catch { /* HTML error pages and empty bodies both land here */ }

    return {
      ok: res.ok,
      status: res.status,
      json: body,
      // A REST framework explains refusals in prose. It is the most useful
      // thing in a 401/403 and worth surfacing verbatim.
      message: (body && (body.detail || body.message || body.error)) ||
        (!body && text ? text.slice(0, 120).replace(/\s+/g, ' ') : null)
    };
  }
  return { ok: false, status: 429, error: 'still rate limited after backoff' };
}

/* Restricted or unpopulated fields commonly come back as [] or null rather
   than missing, so "has the field" and "the field has anything in it" are
   different questions — and only the second one is worth building on. */
const filled = (v) => Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '';
const mark = (b) => b ? 'yes' : 'no';

/* Paginated collections appear under any of these in the wild. Unwrapping by
   shape rather than by a documented key keeps the probe working whichever
   convention BSD picked. */
const listOf = (j) => Array.isArray(j) ? j
  : (j && (j.results || j.data || j.events || j.items || j.records)) || [];

const rows = [];
function record(endpoint, r, note) {
  /* A 403 that explains itself is an entitlement answer. A 403 with no body is
     somebody else's — a corporate proxy or the agent proxy refusing the
     tunnel — and filing that as "free tier restricted" would answer the
     entitlement question with a network fault. */
  const state = r.ok ? 'ok'
    : r.status === 404 ? 'not found'
    : r.status === 401 ? 'UNAUTHORISED'
    : r.status === 403 && r.message ? 'RESTRICTED'
    : r.status === 403 ? 'BLOCKED'
    : r.status === 0 ? 'NO ANSWER'
    : `HTTP ${r.status}`;
  rows.push({ endpoint, state, note: note || r.message || '' });
  console.log(`  ${state.padEnd(13)} ${endpoint}${note ? ` — ${note}` : (r.message ? ` — ${r.message}` : '')}`);
  return r;
}

/* Printing the keys that arrived is the cheapest possible schema note, and the
   next session needs it: there is no readable documentation from here, so the
   log IS the reference for whatever gets built against this API. */
const keysOf = (o, n = 14) => o && typeof o === 'object'
  ? Object.keys(o).slice(0, n).join(', ') + (Object.keys(o).length > n ? ', …' : '')
  : '(not an object)';

/* Tries several candidate paths and returns the first that answered, because
   the sub-resource naming is unknown here. Every attempt is still recorded —
   which spelling is wrong is itself information for the next run. */
async function firstThatWorks(label, paths, note) {
  for (const p of paths) {
    const r = await api(p);
    record(`${p}${label ? `  ${label}` : ''}`, r, r.ok ? (note ? note(r) : null) : null);
    if (r.ok) return { path: p, res: r };
  }
  return null;
}

// ---------------------------------------------------------------------------

console.log('BSD / sports.bzzoiro.com v2 — what a free token can actually see\n');

// 1. Does the token authenticate at all, and what is the league index called?
console.log('Reach and authentication');
const index = await firstThatWorks('', ['/leagues/', '/tournaments/', '/competitions/'],
  (r) => `${listOf(r.json).length} entries · keys: ${keysOf(listOf(r.json)[0])}`);

if (!index) {
  const unauth = rows.some((r) => r.state === 'UNAUTHORISED');
  const blocked = rows.some((r) => r.state === 'BLOCKED' || r.state === 'NO ANSWER');
  console.log(blocked
    ? '\n::error::The API never answered. That is a blocked network, not a plan limit — ' +
      'the agent proxy denies sports.bzzoiro.com, which is why this script exists as a ' +
      'workflow. Run it from CI or from a machine with open egress.'
    : unauth
      ? '\n::error::The token was rejected. Check BSD_API_KEY is the token from the BSD ' +
        'account page and that the header form is `Authorization: Token <key>`.'
      : '\n::error::No league index answered on any candidate path. Read the published ' +
        'reference at sports.bzzoiro.com/docs and add the real path to this probe.');
  process.exit(1);
}

// 2. COVERAGE — the gate. A Premier-League-only token changes nothing here,
//    because that is the one desk already served by a free live feed.
console.log('\nLeague coverage (the gate — the three frozen desks are the prize)');
const all = listOf(index.res.json);
const found = [];
for (const want of LEAGUES) {
  const hit = all.find((l) => {
    const name = String(l?.name || l?.title || l?.slug || '');
    return want.names.some((n) => name.toLowerCase() === n.toLowerCase()) ||
      String(l?.slug || '').toLowerCase() === want.key;
  });
  if (hit) found.push({ ...want, id: hit.id ?? hit.pk ?? hit.slug, raw: hit });
  console.log(`  ${hit ? 'ok           ' : 'ABSENT       '} ${want.names[0].padEnd(18)} ` +
    `${hit ? `id ${hit.id ?? hit.pk ?? hit.slug}` : 'not in the index'} · ${want.desk}`);
}

if (!found.length) {
  console.log('\n::error::None of the four leagues appear in the index under the names this ' +
    'probe knows. They may be listed under other spellings — print the index and widen ' +
    'LEAGUES before concluding the coverage is absent.');
  process.exit(1);
}

// 3. Events. Scheduled first, live second, finished third: the three statuses
//    answer three different questions and must not be collapsed.
console.log('\nEvents');
const sample = { scheduled: null, live: null, finished: null };

const live = await firstThatWorks('live now', ['/events/live/', '/events/?status=live'],
  (r) => `${listOf(r.json).length} matches in play · keys: ${keysOf(listOf(r.json)[0])}`);
if (live) sample.live = listOf(live.res.json)[0] || null;

const lead = found[0];
const upcoming = await firstThatWorks(`scheduled · ${lead.names[0]}`,
  [`/events/?league=${lead.id}&status=notstarted`, `/events/?league=${lead.id}&status=scheduled`,
   `/events/?tournament=${lead.id}`, `/events/?league=${lead.id}`],
  (r) => `${listOf(r.json).length} returned · keys: ${keysOf(listOf(r.json)[0])}`);
if (upcoming) {
  const list = listOf(upcoming.res.json);
  sample.scheduled = list.find((e) => !filled(e?.homeScore ?? e?.home_score)) || list[0] || null;
  sample.finished = list.find((e) => filled(e?.homeScore ?? e?.home_score)) || null;
}

/* The referee question is asked on the EVENT object before any sub-resource,
   because if the appointment rides along with the fixture list it is free —
   one call a round rather than one call a match. */
console.log('\nReferee on the fixture object (a cross-check for the single supplier)');
for (const [status, ev] of Object.entries(sample)) {
  if (!ev) { console.log(`  skipped       no ${status} event sampled`); continue; }
  const ref = ev.referee ?? ev.referee_name ?? ev.official ?? null;
  console.log(`  ${(filled(ref) ? 'ok' : 'empty').padEnd(13)} ${status.padEnd(9)} referee ` +
    `${filled(ref) ? `= ${typeof ref === 'object' ? (ref.name || JSON.stringify(ref).slice(0, 60)) : ref}` : 'absent'}`);
}

// 4. THE SUB-RESOURCES. This is the section that decides what gets built.
const eventId = (e) => e?.id ?? e?.pk ?? e?.event_id ?? null;

for (const [status, ev] of Object.entries(sample)) {
  const id = eventId(ev);
  if (!id) { console.log(`\nSub-resources — ${status}: skipped, none sampled`); continue; }
  console.log(`\nSub-resources — ${status} event ${id}`);

  // 4a. LINEUPS. Deferred feature #1. Pre-match presence is the whole question.
  const lu = await firstThatWorks('lineups',
    [`/events/${id}/lineups/`, `/events/${id}/lineup/`],
    (r) => {
      const j = r.json || {};
      const home = j.home?.players || j.home || listOf(j)[0]?.players || [];
      const confirmed = j.confirmed ?? j.is_confirmed ?? null;
      return `home XI ${Array.isArray(home) ? home.length : '?'} · confirmed flag ` +
        `${filled(confirmed) ? confirmed : 'absent'} · player keys: ${keysOf(home[0])}`;
    });

  // 4b. INCIDENTS. Deferred feature #2 — the in-play card ticker, and the one
  //     term on the API-Football bill that scales with readers.
  await firstThatWorks('incidents',
    [`/events/${id}/incidents/`, `/events/${id}/events/`],
    (r) => {
      const items = listOf(r.json);
      const cards = items.filter((i) => /card/i.test(JSON.stringify(i?.incidentType ?? i?.type ?? i?.incident_type ?? '')));
      return `${items.length} incidents · ${cards.length} card-like · ` +
        `keys: ${keysOf(items[0])}` +
        (cards[0] ? ` · card sample: ${JSON.stringify(cards[0]).slice(0, 160)}` : '');
    });

  // 4c. STATISTICS — fouls. The primary pricing input on every desk.
  await firstThatWorks('statistics',
    [`/events/${id}/statistics/`, `/events/${id}/stats/`],
    (r) => {
      const blob = JSON.stringify(r.json || {});
      return `fouls mentioned ${mark(/foul/i.test(blob))} · ` +
        `cards mentioned ${mark(/card|yellow/i.test(blob))} · xG ${mark(/xg|expected/i.test(blob))} · ` +
        `keys: ${keysOf(r.json)}`;
    });

  // 4d. PLAYER STATISTICS — per-player fouls is the number bought today.
  await firstThatWorks('player stats',
    [`/events/${id}/player-statistics/`, `/events/${id}/lineups/statistics/`, `/events/${id}/players/`],
    (r) => {
      const blob = JSON.stringify(r.json || {});
      return `per-player fouls ${mark(/foul/i.test(blob))} · keys: ${keysOf(listOf(r.json)[0] || r.json)}`;
    });

  // 4e. ODDS. Closes "market benchmark, Premier League only" if it spans the
  //     other three leagues — see docs/free-data-sources.md §2.1.
  await firstThatWorks('odds',
    [`/events/${id}/odds/`, `/odds/?event=${id}`],
    (r) => {
      const items = listOf(r.json);
      const blob = JSON.stringify(r.json || {});
      return `${items.length} markets · bookmakers named ${mark(/bookmaker|bet365|pinnacle/i.test(blob))} · ` +
        `card market ${mark(/card|booking/i.test(blob))} · keys: ${keysOf(items[0] || r.json)}`;
    });

  if (status === 'scheduled' && lu) {
    console.log('  note          a populated XI on a SCHEDULED event is the finding that ' +
      'unblocks docs/lineup-pricing.md');
  }
}

// 5. AVAILABILITY. Already served by data/*_injuries.js off the metered key,
//    so this is asked as a SECOND source, not as a gap to fill.
console.log('\nAvailability (already covered by API-Football — worth having twice)');
await firstThatWorks(`injuries · ${lead.names[0]}`,
  [`/injuries/?league=${lead.id}`, `/leagues/${lead.id}/injuries/`, `/events/${eventId(sample.scheduled) || 0}/injuries/`],
  (r) => `${listOf(r.json).length} rows · keys: ${keysOf(listOf(r.json)[0])}`);

// 6. IMAGES. Largely solved already — check-photos reports 424/661 on the
//    Premier League and 100% on the other three — so this is only worth
//    anything if it fills the remaining Premier League third.
console.log('\nImages (only the missing Premier League third is still worth having)');
{
  const blob = JSON.stringify(sample.scheduled || sample.live || {});
  const hasUrl = /logo|image|photo|avatar|crest/i.test(blob);
  console.log(`  ${(hasUrl ? 'ok' : 'empty').padEnd(13)} image-like fields on the event object: ${mark(hasUrl)}`);
  await firstThatWorks('images', ['/images/', '/media/'], (r) => `keys: ${keysOf(r.json)}`);
}

// ---------------------------------------------------------------------------
// The verdict, stated plainly, because this exists to settle whether to build
// on BSD at all — not to produce a wall of statuses.

console.log(`\n${'='.repeat(72)}\nVerdict\n${'='.repeat(72)}`);

const answered = (frag) => rows.some((r) => r.state === 'ok' && r.endpoint.includes(frag));

console.log(`\nLeagues seen: ${found.map((f) => f.names[0]).join(', ')}` +
  ` (of ${LEAGUES.map((l) => l.names[0]).join(', ')})`);
for (const want of LEAGUES) {
  if (!found.some((f) => f.key === want.key)) {
    console.log(`::warning::${want.names[0]} is NOT in the index — ${want.desk} gains nothing here.`);
  }
}

const siblings = found.filter((f) => f.key !== 'premier-league');
if (!siblings.length) {
  console.log('\n  → Premier League only. That desk already has a free live feed through the ' +
    'FPL proxy, so this API would replace something that works and relieve nothing. Stop here.');
} else {
  console.log(`\n  → ${siblings.length} of the three metered desks are covered. Those are the ` +
    'ones whose every feed currently rides the API-Football key.');
}

console.log('\nThe uncapped cost term (the highest-value answer in this run):');
console.log(`  incidents  ${answered('incidents') ? 'endpoint answered' : 'no endpoint answered'}` +
  ' — check the card-like count on the LIVE event. A free in-play card feed takes' +
  '\n             live-cards.js off the metered key, and that is the one line on the' +
  '\n             bill that scales with readers rather than with matches.');

console.log('\nAs a second source for what one paid key carries alone:');
console.log(`  fouls per player  ${answered('player-statistics') || answered('/players/') ? 'reachable' : 'not reached'}` +
  ' — the only one that is genuinely NEW data (entered by hand today)');
console.log(`  availability      ${answered('injur') ? 'reachable' : 'not reached'}`);
console.log(`  odds              ${answered('odds') ? 'reachable' : 'not reached'}`);
console.log(`  lineups           ${answered('lineup') ? 'reachable' : 'not reached'}`);

/* The caveat the numbers cannot carry. Run this out of season, or midweek with
   nothing kicking off, and "0 live matches" and "no XI" are what a perfectly
   healthy feed looks like. Saying so here stops a Tuesday run being filed as a
   negative result — the same trap docs/referee-sourcing.md fell into once. */
if (!sample.live) {
  console.log('\n  Caveat: nothing was in play when this ran, so the live and incident rows ' +
    'above prove nothing either way. Re-run during a round.');
}
if (sample.scheduled && !answered('lineup')) {
  console.log('  Caveat: an XI publishes about an hour before kick-off. A run earlier than ' +
    'that reads identically to an API that has no lineups at all.');
}

const refused = rows.filter((r) => r.state === 'RESTRICTED' || r.state === 'UNAUTHORISED');
if (refused.length) {
  console.log(`\nRefused to this token (${refused.length}):`);
  for (const r of refused) console.log(`  ${r.endpoint}${r.note ? ` — ${r.note}` : ''}`);
}

console.log(`\nRate limit: ${rateLimitSeen
  ? `${rateLimitSeen.remaining ?? '?'} remaining of ${rateLimitSeen.limit ?? '?'}`
  : 'no X-RateLimit headers returned — the ceiling is unknown, so do not put this ' +
    'behind a browser-facing function until it is'}`);
console.log(`${calls} requests used.`);

#!/usr/bin/env node
/* Recommended accas: log them before kick-off, settle them from real results.
 *
 * WHY THIS EXISTS. An acca "recommended" by a page is whatever the browser
 * computed while somebody was looking at it. That cannot be graded — there is
 * no record of what was advised, when, or at what price, so any claim about
 * performance afterwards is unfalsifiable. So the recommendation is made HERE,
 * server-side, from the shipped model, and written down before the first ball
 * is kicked. What the site later shows as "how we did" is that written record
 * settled against real cards, not a re-derivation.
 *
 * ONE ACCA PER LEAGUE PER MATCHDAY, plus one across all three. Five legs is a
 * lottery ticket and three is the shape the share cards already build, so the
 * acca is the three highest-probability players in the round, at most one per
 * fixture — legs from the same match are heavily correlated (one flashpoint,
 * one strict referee, three bookings) and pricing them as independent is the
 * single most flattering mistake an acca tracker can make.
 *
 * PRICED, NOT FAIR. Stake is 50p. Fair odds are 1/p with no margin, which no
 * bookmaker offers; the priced odds shade each leg by the card-market margin
 * the app already models (PLDCore.TYPICAL_CARD_MARGIN). On a treble that
 * margin compounds three times, which is precisely why accas are poor value
 * and precisely why a tracker that ignores it reports profit that was never
 * available. Both numbers are stored; P/L uses the priced one.
 *
 * THE MATHS IS NOT REIMPLEMENTED. Every probability comes from PLDCore, the
 * same module the desks run, evaluated from the same file the browser loads.
 * The shrinkage, priors and hazard steps below mirror the desks' own — and
 * `verify` exists to prove that claim rather than assert it: it re-derives the
 * legs and compares them to what the desk would show.
 *
 * Usage:
 *   node scripts/accas.mjs build          # write the next matchday's accas
 *   node scripts/accas.mjs settle         # fill in results, close finished accas
 *   node scripts/accas.mjs verify         # print the legs without writing anything
 *   node scripts/accas.mjs predict        # log every player forecast for the round
 *   node scripts/accas.mjs grade          # settle those against real team sheets
 *   node scripts/accas.mjs match-predict  # log every MATCH forecast for the round
 *   node scripts/accas.mjs match-grade    # settle those against real card counts
 *   node scripts/accas.mjs matches        # print the match record without writing
 *
 * THREE UNITS OF RECORD, ONE PRICING PATH. An acca is a recommendation, a
 * player forecast is a probability, and a match forecast is the board a
 * fixture card leads with — different rows, different tables, but every one of
 * them priced by the same functions in this file so they cannot disagree with
 * each other or with the desk.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_FOOTBALL_KEY.
 * Without them `verify` still works; build and settle no-op with a message
 * rather than half-writing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = require(join(root, 'assets', 'core.js'));

const SEASON = '2026-27';
const STAKE = 0.50;
const LEGS = 3;
const SHRINK_MATCHES = 6;          // matches the desks' own constant

/* WHICH MODEL MADE THE FORECAST, stamped on every row this file writes.
 *
 * Without it plb_card_predictions records what was predicted and what happened
 * but not what did the predicting, so the first refit pools two models and any
 * reliability curve over the lot reports the average of two different things as
 * one. Cheap to add at one matchday; unrecoverable at twenty thousand rows.
 *
 * DERIVED FROM THE CONSTANT, not written out as a literal. Shrinkage strength
 * is the first thing the calibration work will tune — it is a guess at 6 — so
 * tuning it must bump the version automatically. A hand-maintained string is
 * one someone forgets, and forgetting silently re-creates the bug.
 *
 * This desk prices from PLDCore's hazard directly and does NOT read
 * data/model.js (which is Premier-League-only), so the version names what this
 * file actually does rather than borrowing a model it never loads. */
const MODEL_VERSION = `desk-hazard/k${SHRINK_MATCHES}`;
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AF_KEY = process.env.API_FOOTBALL_KEY || '';

const LEAGUES = [
  { code: 'PL', data: 'data/pl_data.js', players: 'PL_PLAYERS', fixtures: 'data/pl_fixtures.js', fx: 'PL_FIXTURES' },
  { code: 'EFLC', data: 'data/eflc_data.js', players: 'EFLC_PLAYERS', fixtures: 'data/eflc_fixtures.js', fx: 'EFLC_FIXTURES' },
  { code: 'LL', data: 'data/laliga_data.js', players: 'LALIGA_PLAYERS', fixtures: 'data/laliga_fixtures.js', fx: 'LALIGA_FIXTURES' }
];

/* The data files declare bare `const`s, which are lexical and never become
   properties of anything, so they cannot be read off any object — they are
   captured out of the function scope instead. */
function loadConsts(rel, names) {
  const txt = readFileSync(join(root, rel), 'utf8');
  const ret = names.map((n) => `${n}: typeof ${n}!=="undefined"?${n}:null`).join(',');
  return new Function(`${txt}\n;return {${ret}};`)();
}

/* ---- the desks' own pricing, step for step ----------------------------- */

function priors(players) {
  const acc = {};
  for (const p of players) {
    const m = Number(p.min) || 0;
    if (!(m > 0)) continue;
    const a = acc[p.p] || (acc[p.p] = { yw: 0, ym: 0 });
    if (p.y != null) { a.yw += p.y * m; a.ym += m; }
  }
  let allY = 0, allYm = 0;
  const out = {};
  for (const k of Object.keys(acc)) {
    out[k] = acc[k].ym ? acc[k].yw / acc[k].ym : null;
    allY += acc[k].yw; allYm += acc[k].ym;
  }
  out._league = allYm ? allY / allYm : 0.15;
  return out;
}

function shrunk(p, pr) {
  const m = Number(p.min) || 0;
  if (!(m > 0) || p.yc == null) return null;
  const prior = pr[p.p] == null ? pr._league : pr[p.p];
  return C.shrinkRate(p.yc, m, prior, SHRINK_MATCHES);
}

/* League averages the referee factor is measured against — the same weighting
   the desks use, matches-weighted so a single appointment does not move the
   baseline as far as a season's work. */
function leagueAverages(refs) {
  let yW = 0, cW = 0, m = 0, mc = 0;
  for (const r of refs || []) {
    const k = Number(r.matches) || 0;
    if (r.ypg != null) { yW += r.ypg * k; m += k; }
    if (r.cpf != null) { cW += r.cpf * k; mc += k; }
  }
  return { avgYpg: m ? yW / m : null, avgCpf: mc ? cW / mc : null };
}

/* The four likeliest bookings for one side of one fixture, exactly as the
   fixture card computes them: minutes-weighted expected minutes into the
   hazard model.
 *
 * THE REFEREE FACTOR IS APPLIED WHEN THERE IS ONE. The previous version passed
 * ref: 1 unconditionally, with a comment saying no official is appointed when
 * an acca is recommended. That was true while nothing fetched appointments; it
 * stopped being true when fixtures.yml started harvesting them three times a
 * day. An acca that ignores a published appointment prices a match at a
 * neutral official the desk beside it does not — and the referee is the
 * largest single multiplier either of them applies.
 */
function sideTop(players, short, refFactor) {
  const squad = players.filter((p) => p.c === short && p._y90 != null);
  if (!squad.length) return [];
  const rf = refFactor == null ? 1 : refFactor;
  const w = C.minuteWeights(squad.map((p) => p.min), 11);
  return squad
    .map((p, i) => ({
      p,
      prob: C.pCardFromLambda(C.cardLambda(p._y90, Math.max(0, w[i]) * 90, { ref: rf })) || 0
    }))
    .sort((a, b) => b.prob - a.prob);
}

function nextRound(fixtures) {
  const rounds = [...new Set(fixtures.map((f) => f.r).filter((r) => r != null))].sort((a, b) => a - b);
  for (const r of rounds) {
    const inRound = fixtures.filter((f) => f.r === r);
    if (inRound.some((f) => f.st === 'NS' || !f.st)) return r;
  }
  return null;
}

/* One candidate per fixture, ranked. At most one leg per match: legs from the
   same game share a referee and a flashpoint, so treating them as independent
   multiplies a correlation the model does not carry. */
function candidatesFor(league) {
  const d = loadConsts(league.data, [league.players, 'REFS']);
  const f = loadConsts(league.fixtures, [league.fx]);
  const players = d[league.players] || [];
  const fixtures = f[league.fx] || [];
  if (!players.length || !fixtures.length) return { round: null, cands: [] };
  const pr = priors(players);
  for (const p of players) p._y90 = shrunk(p, pr);

  const round = nextRound(fixtures);
  if (round == null) return { round: null, cands: [] };

  const refs = d.REFS || [];
  const avgs = leagueAverages(refs);
  /* THROUGH THE SHARED RESOLVER. The appointment overlay and the card table
     are different feeds and spell the same official differently — eleven of
     the Championship's twelve opening appointments arrived as "F. Hallam"
     against a table holding "Farai Hallam". An exact lookup prices them all at
     factor 1, and because these rows are the LOGGED record they would go into
     the calibration set as "referee named, no card record" for a whole round:
     a fact about a string comparison, permanently recorded as a fact about
     football. */
  const refName = (n) => (n ? C.matchRefName(n, refs.map((r) => r.n)) : null);
  const refByName = (n) => {
    const hit = refName(n);
    return hit ? refs.find((r) => r.n === hit) || null : null;
  };

  const cands = [];
  const pool = [];
  for (const fx of fixtures.filter((x) => x.r === round)) {
    /* An appointed official we have no card record for gets factor 1 and is
       still RECORDED. "Priced without a referee" and "priced with a referee we
       know nothing about" are different failures, and the settled record has
       to be able to tell them apart later. */
    const ref = fx.ref ? refByName(fx.ref) : null;
    const rf = ref ? C.refCardFactor(ref, avgs, {}) : 1;
    const home = sideTop(players, fx.h, rf), away = sideTop(players, fx.a, rf);
    /* THE CALIBRATION POOL. Eight a side is what the fixture card ranks, and
       it is the set the desk actually shows — so grading it grades what a
       reader saw, not a private shortlist. The acca takes the single best of
       these; everything else is thrown away today. */
    for (const c of [...home.slice(0, 8), ...away.slice(0, 8)]) {
      if (!(c.prob > 0)) continue;
      pool.push({
        season: SEASON, league: league.code, md: round,
        fixture_id: fx.id, kickoff: fx.d,
        player: c.p.n, club: c.p.c,
        prob: Math.round(c.prob * 10000) / 10000,
        referee: fx.ref || null, ref_factor: Math.round(rf * 10000) / 10000,
        model_version: MODEL_VERSION
      });
    }
    const best = [...home, ...away].sort((a, b) => b.prob - a.prob)[0];
    if (best && best.prob > 0) {
      cands.push({
        league: league.code, player: best.p.n, club: best.p.c,
        fixture_id: fx.id, kickoff: fx.d, prob: best.prob,
        referee: fx.ref || null, ref_factor: Math.round(rf * 10000) / 10000
      });
    }
  }
  cands.sort((a, b) => b.prob - a.prob);
  return { round, cands, pool };
}

/* ---- the MATCH-level record -------------------------------------------
 *
 * plb_card_predictions grades the desk on players. The numbers a fixture card
 * LEADS with are not player numbers — booking heat, the over lines, both teams
 * carded, booking points — and none of them was written down anywhere, so none
 * could be checked against a real match. These build that record.
 *
 * PRICED THE WAY THE PAGE PRICES, or the record grades something nobody saw:
 *   - the referee factor, from the appointed official's own card rate;
 *   - the derby boost, which the pages apply per player and keep OUT of the
 *     displayed referee ×figure;
 *   - the FULL squad probability vector, not the eight the card lists —
 *     teamCardMarkets is a Poisson-binomial over everyone who might play.
 *
 * THE DERBY LIST IS READ OUT OF THE PAGE. Each desk declares its own DERBIES
 * inline (eflc.html, laliga.html; the Premier League's live in
 * assets/plmodel.js), and a second copy here would be a second copy: the pages
 * are the published source, so this extracts theirs rather than restating it.
 * A page whose block cannot be found is a loud failure, not a quiet zero.
 */
const DERBY_PAGE = { EFLC: 'eflc.html', LL: 'laliga.html', PL: 'assets/plmodel.js' };
const DERBY_BOOST = { EFLC: 1.08, LL: 1.08, PL: 1.15 };   /* as each page applies */

function derbySet(code) {
  const rel = DERBY_PAGE[code];
  if (!rel) return new Set();
  const src = readFileSync(join(root, rel), 'utf8');
  const i = src.indexOf('DERBIES = [');
  if (i < 0) throw new Error(`${rel}: no DERBIES block — the derby boost cannot be reproduced`);
  const end = src.indexOf('];', i);
  if (end < 0) throw new Error(`${rel}: DERBIES block is unterminated`);
  const body = src.slice(src.indexOf('[', i), end + 1);
  let pairs;
  try { pairs = new Function(`return ${body};`)(); }
  catch (e) { throw new Error(`${rel}: DERBIES did not parse (${e.message})`); }
  return new Set(pairs.map((d) => d.slice().sort().join('|')));
}

/* One forecast row per fixture in the next round, in the shape the table
   stores. Pure: no network, no writes — `matches` prints exactly this. */
function matchesFor(league) {
  const d = loadConsts(league.data, [league.players, 'REFS']);
  const f = loadConsts(league.fixtures, [league.fx]);
  const players = d[league.players] || [];
  const fixtures = f[league.fx] || [];
  if (!players.length || !fixtures.length) return { round: null, rows: [] };
  const pr = priors(players);
  for (const p of players) p._y90 = shrunk(p, pr);

  const round = nextRound(fixtures);
  if (round == null) return { round: null, rows: [] };

  const refs = d.REFS || [];
  const avgs = leagueAverages(refs);
  const leagueRed = C.leagueRedRate(refs);
  const derbies = derbySet(league.code);
  const boost = DERBY_BOOST[league.code] || 1;

  const rows = [];
  for (const fx of fixtures.filter((x) => x.r === round)) {
    const hit = fx.ref ? C.matchRefName(fx.ref, refs.map((r) => r.n)) : null;
    const ref = hit ? refs.find((r) => r.n === hit) || null : null;
    /* An official appointed but absent from the card table prices at 1 — the
       same as no official. `ref_carded` is what tells the two apart later,
       and they are different findings for a refit. */
    const rf = ref ? C.refCardFactor(ref, avgs, {}) : 1;
    const derby = derbies.has([fx.h, fx.a].sort().join('|'));
    const factor = rf * (derby ? boost : 1);
    const home = sideTop(players, fx.h, factor).map((c) => c.prob);
    const away = sideTop(players, fx.a, factor).map((c) => c.prob);
    if (!home.length && !away.length) continue;          // no rated squad either side

    /* The desk's own two calls, with the desk's own lines (eflc.html:1096-1103).
       Not re-derived from the underlying distribution functions: going through
       the same entry points is what stops the record and the page drifting. */
    const m = C.teamCardMarkets(home, away, [3.5, 4.5, 5.5]);
    /* Reds come from the appointed official's own rate where there is one and
       the match-weighted league rate where there is not — the rule both pages
       follow, so the yellow and red halves of a points line agree. */
    const lamRed = (ref && ref.red != null) ? Number(ref.red) : leagueRed;
    const bp = C.bookingPointsMarkets(home, away, lamRed, [35.5, 45.5, 55.5]);
    rows.push({
      season: SEASON, league: league.code, fixture_id: fx.id, matchday: round,
      kickoff: fx.d || null, home: fx.h, away: fx.a,
      exp_cards: m.expected, exp_cards_home: m.expectedHome, exp_cards_away: m.expectedAway,
      p_over_3_5: r4(m.over[3.5]), p_over_4_5: r4(m.over[4.5]), p_over_5_5: r4(m.over[5.5]),
      p_both_carded: r4(m.bothCarded), p_both_two: r4(m.bothTwo),
      exp_points: bp.expected,
      p_points_over_35_5: r4(bp.over[35.5]),
      p_points_over_45_5: r4(bp.over[45.5]),
      p_points_over_55_5: r4(bp.over[55.5]),
      referee: fx.ref || null, ref_factor: r4(rf), ref_carded: !!ref, derby,
      rated_home: home.length, rated_away: away.length,
      model_version: MODEL_VERSION
    });
  }
  return { round, rows };
}

/* Card counts per side for one finished fixture, or null while it is still
 * being played. Deliberately NOT afEvents(): that returns the set of booked
 * NAMES, which answers "was this player booked" and cannot answer "how many
 * cards did the home side get" — the question every match-level line asks.
 *
 * A second yellow is counted on its own. API-Football spells it "Second
 * Yellow card"; under the desk's own convention (10 a yellow, 25 a red) the
 * dismissal scores the red and the first yellow has already scored, so it must
 * not also count as a fresh yellow. Feeds that emit a plain Yellow followed by
 * a plain Red for the same dismissal will read as 10 + 25 either way, which is
 * the same number — the raw counts are stored so any of this can be recomputed
 * later without going back to the API.
 */
async function afCards(fixtureId) {
  const res = await fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, {
    headers: { 'x-apisports-key': AF_KEY }
  });
  if (!res.ok) throw new Error(`API-Football ${res.status}`);
  const j = await res.json();
  const errs = j && j.errors;
  if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) {
    throw new Error(`API-Football refused: ${JSON.stringify(errs)}`);
  }
  const fx = (j.response || [])[0];
  if (!fx) return null;
  const st = ((fx.fixture || {}).status || {}).short;
  if (!['FT', 'AET', 'PEN'].includes(st)) return null;
  const homeId = ((fx.teams || {}).home || {}).id;
  const out = {
    yellows_home: 0, yellows_away: 0, reds_home: 0, reds_away: 0,
    second_yellows_home: 0, second_yellows_away: 0
  };
  for (const e of fx.events || []) {
    if (e.type !== 'Card') continue;
    const detail = String(e.detail || '');
    const side = ((e.team || {}).id === homeId) ? 'home' : 'away';
    if (/second\s*yellow/i.test(detail)) out['second_yellows_' + side]++;
    else if (/yellow/i.test(detail)) out['yellows_' + side]++;
    else if (/red/i.test(detail)) out['reds_' + side]++;
  }
  return out;
}

/* The outcome, on the desk's own terms. A dismissal is a red however it was
   earned, so a second yellow counts towards both the card count and the red
   points — the first yellow has already been counted as a yellow. */
function outcomeTotals(c) {
  const yellows = c.yellows_home + c.yellows_away;
  const reds = c.reds_home + c.reds_away + c.second_yellows_home + c.second_yellows_away;
  return {
    cards_total: yellows + reds,
    points_total: C.YELLOW_POINTS * yellows + C.RED_POINTS * reds
  };
}

const fair = (p) => 1 / p;
const priced = (p) => fair(p) * (1 - C.TYPICAL_CARD_MARGIN);
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

function buildAcca(id, code, round, cands) {
  const legs = cands.slice(0, LEGS);
  if (legs.length < 2) return null;         // a single is not an acca
  const fairOdds = legs.reduce((a, l) => a * fair(l.prob), 1);
  const pricedOdds = legs.reduce((a, l) => a * priced(l.prob), 1);
  const kicks = legs.map((l) => l.kickoff).filter(Boolean).sort();
  return {
    acca: {
      id, league: code, season: SEASON, matchday: round,
      kickoff_first: kicks[0] || null, kickoff_last: kicks[kicks.length - 1] || null,
      legs: legs.length, stake: STAKE,
      fair_odds: r2(fairOdds), priced_odds: r2(pricedOdds), status: 'open'
    },
    legs: legs.map((l, i) => ({
      /* The LEG's league, not the acca's. For a single-division acca they are
         the same; for the cross-league one they are the whole point, and
         without this column its share card could only show three club codes
         and leave the reader to guess which division each came from. */
      acca_id: id, leg: i + 1, league: l.league, player: l.player, club: l.club,
      fixture_id: l.fixture_id, kickoff: l.kickoff,
      /* The referee AT THE TIME OF THE PREDICTION, and the multiplier it
         produced. Without these a settled loss cannot be read: a leg priced
         with no official and one priced under the league's strictest referee
         are the same row afterwards. */
      referee: l.referee, ref_factor: l.ref_factor, model_version: MODEL_VERSION,
      prob: Math.round(l.prob * 10000) / 10000,
      fair_odds: r2(fair(l.prob)), priced_odds: r2(priced(l.prob))
    }))
  };
}

function collect() {
  const out = [];
  const all = [];
  for (const L of LEAGUES) {
    const { round, cands } = candidatesFor(L);
    if (round == null || !cands.length) continue;
    const a = buildAcca(`${L.code}:${SEASON}:${round}`, L.code, round, cands);
    if (a) out.push(a);
    all.push(...cands);
  }
  /* The cross-league acca: the best legs on ONE DATE, not the best legs
     anywhere. Taking the three highest probabilities across all three
     divisions produced legs on 15, 22 and 22 August — a treble spanning a
     week, which is not the card /today offers and not something anyone would
     place. The divisions do not share a matchday calendar (Premier League
     round 1 is a week after the Championship's), so the cross-league acca is
     keyed by date and built only from a date where more than one league
     plays. If no such date exists in the upcoming rounds, there is no
     cross-league acca that week, and none is invented. */
  const byDay = new Map();
  for (const c of all) {
    const day = String(c.kickoff || '').slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(c);
  }
  const days = [...byDay.entries()]
    .filter(([, cs]) => new Set(cs.map((c) => c.league)).size > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length) {
    const [day, cs] = days[0];
    cs.sort((a, b) => b.prob - a.prob);
    const a = buildAcca(`ALL:${SEASON}:${day}`, 'ALL', null, cs);
    if (a) out.push(a);
  }
  return out;
}

/* ---- Supabase over PostgREST, no client library ------------------------ */
const rest = (t) => `${SUPABASE_URL}/rest/v1/${t}`;
const H = {
  apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json'
};

async function upsert(table, rows, onConflict) {
  if (!rows.length) return 0;
  const res = await fetch(`${rest(table)}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
  return rows.length;
}

async function cmdBuild() {
  const built = collect();
  if (!built.length) { console.log('No open matchday to build an acca for.'); return; }
  for (const b of built) {
    console.log(`${b.acca.id.padEnd(22)} ${b.acca.legs} legs  fair ${b.acca.fair_odds}  priced ${b.acca.priced_odds}`);
    for (const l of b.legs) console.log(`    ${l.player} (${l.club}) ${(l.prob * 100).toFixed(1)}% @ ${l.priced_odds}`);
  }
  if (!SERVICE_KEY) { console.log('\nNo SUPABASE_SERVICE_ROLE_KEY — nothing written.'); return; }
  /* Accas first: the legs reference them. And ONLY new ones — an acca already
     written is the record of what was advised, and rewriting it after some of
     its matches have kicked off would be revising the prediction. */
  const have = await fetch(`${rest('plb_accas')}?select=id&id=in.(${built.map((b) => `"${b.acca.id}"`).join(',')})`, { headers: H });
  const existing = new Set((have.ok ? await have.json() : []).map((r) => r.id));
  const fresh = built.filter((b) => !existing.has(b.acca.id));
  if (!fresh.length) { console.log('\nAlready logged; not rewritten.'); return; }
  await upsert('plb_accas', fresh.map((b) => b.acca), 'id');
  await upsert('plb_acca_legs', fresh.flatMap((b) => b.legs), 'acca_id,leg');
  console.log(`\nLogged ${fresh.length} acca(s).`);
}

/* ---- settlement -------------------------------------------------------- */

async function afEvents(fixtureId) {
  const res = await fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, {
    headers: { 'x-apisports-key': AF_KEY }
  });
  if (!res.ok) throw new Error(`API-Football ${res.status}`);
  const j = await res.json();
  const errs = j && j.errors;
  /* API-Football answers 200 with an `errors` object for a refusal — a bad
     key, an exhausted quota, a season the plan does not cover. Reading that as
     "no events" would settle every leg as NOT booked, which is a loss the
     model never earned. */
  if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) {
    throw new Error(`API-Football refused: ${JSON.stringify(errs)}`);
  }
  const fx = (j.response || [])[0];
  if (!fx) return null;
  const st = ((fx.fixture || {}).status || {}).short;
  if (!['FT', 'AET', 'PEN'].includes(st)) return null;   // not finished
  const booked = new Set();
  for (const e of fx.events || []) {
    if (e.type === 'Card' && /Yellow|Red/i.test(e.detail || '')) {
      const n = (e.player || {}).name;
      if (n) booked.add(String(n));
    }
  }
  return booked;
}

/* Feed names and dataset names are not the same string. Compared on the
   normalised form PLDCore already uses everywhere else, then on surname,
   because a feed's "J. Cooper" and a dataset's "Jack Cooper" are one player. */
function wasBooked(playerName, booked) {
  const want = C.normName(playerName);
  for (const b of booked) if (C.normName(b) === want) return true;
  const surname = want.split(' ').filter(Boolean).pop();
  if (!surname || surname.length < 4) return false;
  let hits = 0;
  for (const b of booked) if (C.normName(b).split(' ').pop() === surname) hits++;
  if (hits === 1) return true;
  /* NULL, not false. Two Silvas booked and we cannot say which is ours — and
     the previous version returned false, which is not "we do not guess", it is
     guessing "not booked". On three acca legs a month that was survivable; as
     the calibration set it would bias every ambiguous match toward the model
     looking over-confident. Callers must leave an unknown unsettled. */
  if (hits > 1) return null;
  return false;
}

async function cmdSettle() {
  if (!SERVICE_KEY || !AF_KEY) {
    console.log('Need SUPABASE_SERVICE_ROLE_KEY and API_FOOTBALL_KEY to settle. Nothing done.');
    return;
  }
  const open = await (await fetch(`${rest('plb_acca_legs')}?carded=is.null&select=acca_id,leg,player,fixture_id`, { headers: H })).json();
  if (!open.length) { console.log('Nothing open to settle.'); return; }
  const byFixture = new Map();
  for (const l of open) {
    if (!byFixture.has(l.fixture_id)) byFixture.set(l.fixture_id, []);
    byFixture.get(l.fixture_id).push(l);
  }
  let settled = 0;
  for (const [fixtureId, legs] of byFixture) {
    let booked;
    try { booked = await afEvents(fixtureId); }
    catch (e) { console.log(`  fixture ${fixtureId}: ${e.message} — left open`); continue; }
    if (!booked) continue;                       // not finished yet
    for (const l of legs) {
      const hit = wasBooked(l.player, booked);
      /* Ambiguous stays OPEN and is named. Writing `false` here would record a
         loss the match record does not actually support, and an acca tracker
         that invents losses is no more honest than one that hides them. */
      if (hit === null) {
        console.log(`  ::warning:: ${l.player} (fixture ${fixtureId}): more than one booked ` +
          `player shares that surname — left open for a human to resolve.`);
        continue;
      }
      const res = await fetch(`${rest('plb_acca_legs')}?acca_id=eq.${encodeURIComponent(l.acca_id)}&leg=eq.${l.leg}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ carded: hit, settled_at: new Date().toISOString() })
      });
      if (res.ok) { settled++; console.log(`  ${l.player}: ${hit ? 'BOOKED' : 'no card'}`); }
    }
  }

  /* Close any acca whose legs are all in. A single lost leg settles it
     immediately — the rest cannot rescue it — which is also why a lost acca
     must not wait on a fixture that never reports. */
  const accas = await (await fetch(`${rest('plb_accas')}?status=eq.open&select=id,stake,priced_odds`, { headers: H })).json();
  for (const a of accas) {
    const legs = await (await fetch(`${rest('plb_acca_legs')}?acca_id=eq.${encodeURIComponent(a.id)}&select=carded`, { headers: H })).json();
    const lost = legs.some((l) => l.carded === false);
    const allIn = legs.every((l) => l.carded !== null);
    if (!lost && !allIn) continue;
    const won = !lost && allIn;
    const returns = won ? Number(a.stake) * Number(a.priced_odds) : 0;
    await fetch(`${rest('plb_accas')}?id=eq.${encodeURIComponent(a.id)}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: won ? 'won' : 'lost',
        returns: Math.round(returns * 100) / 100,
        pl: Math.round((returns - Number(a.stake)) * 100) / 100,
        settled_at: new Date().toISOString()
      })
    });
    console.log(`${a.id}: ${won ? 'WON' : 'LOST'}`);
  }
  console.log(`\n${settled} leg(s) settled.`);
}

function cmdVerify() {
  for (const b of collect()) {
    console.log(`${b.acca.id}  matchday ${b.acca.matchday ?? '-'}  `
      + `fair ${b.acca.fair_odds}  priced ${b.acca.priced_odds}  `
      + `(returns ${(STAKE * b.acca.priced_odds).toFixed(2)} from ${STAKE.toFixed(2)})`);
    for (const l of b.legs) {
      console.log(`   ${l.leg}. ${l.player.padEnd(24)} ${l.club}  ${(l.prob * 100).toFixed(1)}%  `
        + `fair ${l.fair_odds}  priced ${l.priced_odds}  fx ${l.fixture_id}`);
    }
  }
}

/* The same rows `build` would POST, as SQL. For applying the record by hand
   when the settlement job's key is not yet in place — one code path, so the
   hand-applied rows cannot differ from the scheduled ones. */
function cmdSql() {
  const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  for (const b of collect()) {
    const a = b.acca;
    console.log(`insert into plb_accas (id,league,season,matchday,kickoff_first,kickoff_last,`
      + `legs,stake,fair_odds,priced_odds,status) values (${q(a.id)},${q(a.league)},${q(a.season)},`
      + `${a.matchday == null ? 'null' : a.matchday},${q(a.kickoff_first)},${q(a.kickoff_last)},`
      + `${a.legs},${a.stake},${a.fair_odds},${a.priced_odds},'open') on conflict (id) do nothing;`);
    for (const l of b.legs) {
      console.log(`insert into plb_acca_legs (acca_id,leg,league,player,club,fixture_id,kickoff,prob,`
        + `fair_odds,priced_odds,referee,ref_factor) values (${q(l.acca_id)},${l.leg},${q(l.league)},${q(l.player)},${q(l.club)},`
        + `${l.fixture_id},${q(l.kickoff)},${l.prob},${l.fair_odds},${l.priced_odds},${q(l.referee)},${l.ref_factor}) `
        + `on conflict (acca_id,leg) do nothing;`);
    }
  }
}


/* ---- the calibration set ------------------------------------------------
 * Log every candidate the model rated for the upcoming round, in all three
 * leagues, before kick-off. This is the thing that makes the desk gradeable:
 * an acca is three legs a matchday and cannot calibrate anything, while this
 * is roughly twenty thousand forecasts a season across the three divisions.
 *
 * IDEMPOTENT AND WRITE-ONCE. `do nothing` on conflict, not merge: a row is the
 * record of what was forecast, and an hourly job that revised its own earlier
 * prediction as kick-off approached would grade the model on its last guess
 * rather than its published one.
 */
async function cmdPredict() {
  if (!SERVICE_KEY) { console.log('No SUPABASE_SERVICE_ROLE_KEY — nothing written.'); return; }
  let total = 0;
  for (const L of LEAGUES) {
    const { round, pool } = candidatesFor(L);
    if (round == null || !pool.length) { console.log(`${L.code}: no open round.`); continue; }
    /* Never log a fixture that has already kicked off. The round stays "next"
       until every match in it is finished, so without this a Sunday job would
       log a Saturday match as a forecast. */
    const now = Date.now();
    const fresh = pool.filter((r) => !r.kickoff || new Date(r.kickoff).getTime() > now);
    const late = pool.length - fresh.length;
    if (!fresh.length) { console.log(`${L.code}: round ${round} has all kicked off.`); continue; }
    const res = await fetch(`${rest('plb_card_predictions')}?on_conflict=season,league,fixture_id,player`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(fresh)
    });
    if (!res.ok) throw new Error(`plb_card_predictions: ${res.status} ${await res.text()}`);
    total += fresh.length;
    console.log(`${L.code}: round ${round} — ${fresh.length} forecasts logged`
      + (late ? ` (${late} skipped, already kicked off)` : ''));
  }
  console.log(`\n${total} forecast(s) offered.`);
}

/* Grade them from the same match records the accas settle on. Separate from
 * cmdSettle only because it reads a different table; the identification is the
 * SAME wasBooked(), so a leg and a forecast for the same player in the same
 * match can never disagree about whether he was booked. */
async function cmdGrade() {
  if (!SERVICE_KEY || !AF_KEY) {
    console.log('Need SUPABASE_SERVICE_ROLE_KEY and API_FOOTBALL_KEY to grade. Nothing done.');
    return;
  }
  const q = `?carded=is.null&kickoff=lt.${encodeURIComponent(new Date().toISOString())}`
    + '&select=season,league,fixture_id,player&limit=5000';
  const open = await (await fetch(`${rest('plb_card_predictions')}${q}`, { headers: H })).json();
  if (!open.length) { console.log('Nothing to grade.'); return; }
  const byFixture = new Map();
  for (const r of open) {
    if (!byFixture.has(r.fixture_id)) byFixture.set(r.fixture_id, []);
    byFixture.get(r.fixture_id).push(r);
  }
  let graded = 0, unknown = 0, pending = 0;
  for (const [fixtureId, rows] of byFixture) {
    let booked;
    try { booked = await afEvents(fixtureId); }
    catch (e) { console.log(`  fixture ${fixtureId}: ${e.message} — left open`); continue; }
    if (!booked) { pending++; continue; }             // not finished yet
    const stamp = new Date().toISOString();
    for (const r of rows) {
      const hit = wasBooked(r.player, booked);
      /* Ambiguous stays null and is COUNTED. Recording it as "not booked"
         would quietly drag the observed rate below the forecast one and make
         the model look over-confident in exactly the matches where two
         players share a surname. */
      if (hit === null) { unknown++; continue; }
      const key = `season=eq.${encodeURIComponent(r.season)}&league=eq.${encodeURIComponent(r.league)}`
        + `&fixture_id=eq.${r.fixture_id}&player=eq.${encodeURIComponent(r.player)}`;
      const res = await fetch(`${rest('plb_card_predictions')}?${key}`, {
        method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ carded: hit, settled_at: stamp })
      });
      if (res.ok) graded++;
    }
  }
  console.log(`Graded ${graded}${unknown ? `, ${unknown} left unknown (ambiguous surname)` : ''}`
    + `${pending ? `, ${pending} fixture(s) not finished` : ''}.`);
}

/* ---- the match record: write, then settle ------------------------------ */

/* Write-once, exactly like cmdPredict: `ignore-duplicates`, never merge. A row
   is the record of what was PUBLISHED, and an hourly job that revised its own
   forecast as team news landed would grade the model on its last guess. */
async function cmdMatchPredict() {
  if (!SERVICE_KEY) { console.log('No SUPABASE_SERVICE_ROLE_KEY — nothing written.'); return; }
  let total = 0;
  for (const L of LEAGUES) {
    const { round, rows } = matchesFor(L);
    if (round == null || !rows.length) { console.log(`${L.code}: no open round.`); continue; }
    const now = Date.now();
    const fresh = rows.filter((r) => !r.kickoff || new Date(r.kickoff).getTime() > now);
    const late = rows.length - fresh.length;
    if (!fresh.length) { console.log(`${L.code}: round ${round} has all kicked off.`); continue; }
    const res = await fetch(`${rest('plb_match_predictions')}?on_conflict=season,league,fixture_id`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(fresh)
    });
    if (!res.ok) throw new Error(`plb_match_predictions: ${res.status} ${await res.text()}`);
    total += fresh.length;
    console.log(`${L.code}: round ${round} — ${fresh.length} match forecast(s) logged`
      + (late ? ` (${late} skipped, already kicked off)` : ''));
  }
  console.log(`\n${total} match forecast(s) offered.`);
}

/* Settle from the real match record. Only ever writes the outcome columns, so
   it cannot touch a forecast. */
async function cmdMatchGrade() {
  if (!SERVICE_KEY || !AF_KEY) {
    console.log('Need SUPABASE_SERVICE_ROLE_KEY and API_FOOTBALL_KEY to grade matches. Nothing done.');
    return;
  }
  const q = `?settled_at=is.null&kickoff=lt.${encodeURIComponent(new Date().toISOString())}`
    + '&select=season,league,fixture_id,home,away&limit=2000';
  const open = await (await fetch(`${rest('plb_match_predictions')}${q}`, { headers: H })).json();
  if (!open.length) { console.log('No match to grade.'); return; }
  let graded = 0, pending = 0;
  for (const r of open) {
    let counts;
    try { counts = await afCards(r.fixture_id); }
    catch (e) { console.log(`  fixture ${r.fixture_id}: ${e.message} — left open`); continue; }
    if (!counts) { pending++; continue; }                    // not finished yet
    const totals = outcomeTotals(counts);
    const key = `season=eq.${encodeURIComponent(r.season)}&league=eq.${encodeURIComponent(r.league)}`
      + `&fixture_id=eq.${r.fixture_id}`;
    const res = await fetch(`${rest('plb_match_predictions')}?${key}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ ...counts, ...totals, settled_at: new Date().toISOString() })
    });
    if (res.ok) {
      graded++;
      console.log(`  ${r.home} v ${r.away}: ${totals.cards_total} cards, ${totals.points_total} points`);
    }
  }
  console.log(`\nGraded ${graded} match(es)${pending ? `, ${pending} not finished` : ''}.`);
}

/* Print the record that WOULD be written, without writing it — the match-level
   twin of `verify`, and the thing to run before trusting a first refit. */
function cmdMatches() {
  for (const L of LEAGUES) {
    const { round, rows } = matchesFor(L);
    if (round == null || !rows.length) { console.log(`${L.code}: no open round.\n`); continue; }
    console.log(`${L.code} — matchday ${round}, ${rows.length} fixtures`);
    for (const r of rows) {
      console.log(`  ${r.home} v ${r.away.padEnd(4)} heat ${String(r.exp_cards).padStart(5)}  `
        + `o3.5 ${pctStr(r.p_over_3_5)}  o4.5 ${pctStr(r.p_over_4_5)}  BTC ${pctStr(r.p_both_carded)}  `
        + `pts ${String(r.exp_points).padStart(5)}  `
        + (r.referee ? `${r.referee} x${r.ref_factor}` : 'no referee')
        + (r.derby ? '  derby' : ''));
    }
    console.log('');
  }
}
const pctStr = (p) => (p * 100).toFixed(0).padStart(3) + '%';

/* Exported so guards can RUN this file rather than pattern-match it. Several
   assertions in scripts/check-referees.mjs have been satisfied by the wrong
   text; executing the real function is the only way that cannot happen. */
export {
  candidatesFor, collect, buildAcca, wasBooked, LEAGUES, MODEL_VERSION, SHRINK_MATCHES,
  matchesFor, outcomeTotals, derbySet, sideTop, priors, shrunk, leagueAverages, loadConsts
};
/* Exported as a lookup rather than the object, so a guard has to ask about a
   league that exists instead of reading `undefined` off a typo and passing. */
export function DERBY_BOOST_FOR(code) {
  if (!(code in DERBY_BOOST)) throw new Error(`no derby boost declared for ${code}`);
  return DERBY_BOOST[code];
}

/* Only run a command when invoked as a script. Importing it must not fire the
   CLI — a guard that imported this file would otherwise execute `verify`, or
   worse, whatever argv[2] happened to be. */
const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const cmd = process.argv[2] || 'verify';
  if (cmd === 'build') await cmdBuild();
  else if (cmd === 'settle') await cmdSettle();
  else if (cmd === 'predict') await cmdPredict();
  else if (cmd === 'grade') await cmdGrade();
  else if (cmd === 'match-predict') await cmdMatchPredict();
  else if (cmd === 'match-grade') await cmdMatchGrade();
  else if (cmd === 'matches') cmdMatches();
  else if (cmd === 'sql') cmdSql();
  else cmdVerify();
}

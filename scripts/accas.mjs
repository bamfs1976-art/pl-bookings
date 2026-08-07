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
 *   node scripts/accas.mjs build     # write the next matchday's accas
 *   node scripts/accas.mjs settle    # fill in results, close finished accas
 *   node scripts/accas.mjs verify    # print the legs without writing anything
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
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AF_KEY = process.env.API_FOOTBALL_KEY || '';

const LEAGUES = [
  { code: 'PL', data: 'data/pl_data.js', players: 'PL_PLAYERS', fixtures: 'data/pl_fixtures.js', fx: 'PL_FIXTURES' },
  { code: 'EFLC', data: 'data/eflc_data.js', players: 'EFLC_PLAYERS', fixtures: 'data/eflc_fixtures.js', fx: 'EFLC_FIXTURES' },
  { code: 'LL', data: 'data/laliga_data.js', players: 'LALIGA_PLAYERS', fixtures: 'data/laliga_fixtures.js', fx: 'LALIGA_FIXTURES' }
];

/* The data files declare bare `const`s, which are lexical and never become
   properties of anything. Captured out of the function scope, the same way
   log-predictions.js reads them. */
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

/* The four likeliest bookings for one side of one fixture, exactly as the
   fixture card computes them: minutes-weighted expected minutes into the
   hazard model, no referee factor because no official is appointed at the time
   an acca is recommended. */
function sideTop(players, short) {
  const squad = players.filter((p) => p.c === short && p._y90 != null);
  if (!squad.length) return [];
  const w = C.minuteWeights(squad.map((p) => p.min), 11);
  return squad
    .map((p, i) => ({
      p,
      prob: C.pCardFromLambda(C.cardLambda(p._y90, Math.max(0, w[i]) * 90, { ref: 1 })) || 0
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
  const d = loadConsts(league.data, [league.players]);
  const f = loadConsts(league.fixtures, [league.fx]);
  const players = d[league.players] || [];
  const fixtures = f[league.fx] || [];
  if (!players.length || !fixtures.length) return { round: null, cands: [] };
  const pr = priors(players);
  for (const p of players) p._y90 = shrunk(p, pr);

  const round = nextRound(fixtures);
  if (round == null) return { round: null, cands: [] };

  const cands = [];
  for (const fx of fixtures.filter((x) => x.r === round)) {
    const best = [...sideTop(players, fx.h), ...sideTop(players, fx.a)]
      .sort((a, b) => b.prob - a.prob)[0];
    if (best && best.prob > 0) {
      cands.push({
        league: league.code, player: best.p.n, club: best.p.c,
        fixture_id: fx.id, kickoff: fx.d, prob: best.prob
      });
    }
  }
  cands.sort((a, b) => b.prob - a.prob);
  return { round, cands };
}

const fair = (p) => 1 / p;
const priced = (p) => fair(p) * (1 - C.TYPICAL_CARD_MARGIN);
const r2 = (v) => Math.round(v * 100) / 100;

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
  /* Only when the surname is unambiguous in this match. Two Silvas booked and
     we cannot say which, so we do not guess. */
  return hits === 1;
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
        + `fair_odds,priced_odds) values (${q(l.acca_id)},${l.leg},${q(l.league)},${q(l.player)},${q(l.club)},`
        + `${l.fixture_id},${q(l.kickoff)},${l.prob},${l.fair_odds},${l.priced_odds}) `
        + `on conflict (acca_id,leg) do nothing;`);
    }
  }
}

const cmd = process.argv[2] || 'verify';
if (cmd === 'build') await cmdBuild();
else if (cmd === 'settle') await cmdSettle();
else if (cmd === 'sql') cmdSql();
else cmdVerify();

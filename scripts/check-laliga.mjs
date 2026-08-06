// Guard the La Liga dataset and the page that reads it.
//
// Same job as check-eflc.mjs: the desk has no build step, so nothing else
// stands between a bad laliga_data.js and a published page of wrong numbers.
// It asserts the shape the page depends on and, more importantly, re-derives
// the prices the same way the page does and checks they land where a bookings
// market could actually contain them.
//
// Two things here are NOT in the Championship guard, because they are the two
// ways this league can fail that the English ones cannot:
//
//   1. The division is DISCOVERED rather than declared, so the club registry
//      and the dataset can disagree. They are checked against each other.
//   2. The referee names are JOINED ON from a paid feed onto free match
//      records. A join that half-works produces a referee table that looks
//      complete and is built on a fraction of the season, so the referees'
//      match counts are checked against a full division.
//
// Skips cleanly when laliga_data.js has not been generated: it is produced by
// the refresh workflow, and CI on a fresh clone should not fail for its
// absence.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'data', 'laliga_data.js');

if (!existsSync(dataPath)) {
  console.log('check-laliga: data/laliga_data.js not built yet — skipping.');
  process.exit(0);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(dataPath, 'utf8'), ctx);
const { CLUBS, LALIGA_PLAYERS, REFS, PLDCore: C } =
  vm.runInContext('({CLUBS, LALIGA_PLAYERS, REFS, PLDCore})', ctx);

const CLUB_COUNT = 20;
const SEASON_MATCHES = 380;

/* ---- shape ------------------------------------------------------------- */
assert.equal(CLUBS.length, CLUB_COUNT, `expected ${CLUB_COUNT} clubs, got ${CLUBS.length}`);
assert.ok(LALIGA_PLAYERS.length > 400, `only ${LALIGA_PLAYERS.length} players`);

const shorts = new Set(CLUBS.map((c) => c.short));
assert.equal(shorts.size, CLUBS.length, 'two clubs share a short code');
const orphan = [...new Set(LALIGA_PLAYERS.map((p) => p.c))].filter((c) => !shorts.has(c));
assert.equal(orphan.length, 0, `players at clubs not in CLUBS: ${orphan.join(', ')}`);

/* The discovered division and the dataset must be the same division. Nothing
   else notices if they drift: the page reads CLUBS, the harvest reads the
   registry, and a club in one and not the other simply has no players. */
const regPath = join(root, 'data', 'laliga_clubs.json');
if (existsSync(regPath)) {
  const reg = JSON.parse(readFileSync(regPath, 'utf8')).clubs || {};
  const regShorts = new Set(Object.values(reg).map((d) => d.short));
  assert.equal(regShorts.size, CLUB_COUNT,
    `laliga_clubs.json holds ${regShorts.size} clubs, not ${CLUB_COUNT}`);
  const missing = [...regShorts].filter((s) => !shorts.has(s));
  const extra = [...shorts].filter((s) => !regShorts.has(s));
  assert.equal(missing.length + extra.length, 0,
    `the club registry and the dataset disagree — only in registry: ` +
    `${missing.join(', ') || 'none'}; only in dataset: ${extra.join(', ') || 'none'}`);
}

/* Every club a real squad. This is the failure this repo has already shipped
   once, in the Premier League desk, as six forwards and no defenders. */
for (const c of CLUBS) {
  const squad = LALIGA_PLAYERS.filter((p) => p.c === c.short);
  assert.ok(squad.length >= 15, `${c.short}: only ${squad.length} players`);
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    assert.ok(squad.some((p) => p.p === pos), `${c.short}: no ${pos}`);
  }
}

const dupes = new Set();
const seen = new Set();
for (const p of LALIGA_PLAYERS) {
  const k = `${p.c}|${p.n}`;
  if (seen.has(k)) dupes.add(k);
  seen.add(k);
}
assert.equal(dupes.size, 0, `duplicate rows: ${[...dupes].slice(0, 5).join(', ')}`);

/* A club's `img` is its BADGE. Two of the three harvesters once filled it with
   the player's photograph, which is wrong on screen and well-formed in every
   other respect. */
const faces = CLUBS.filter((c) => c.img && /\/(players|photos)\//.test(c.img))
  .map((c) => `${c.short} -> ${c.img}`);
assert.equal(faces.length, 0,
  `clubs whose crest is a player photo, not a badge:\n  ${faces.join('\n  ')}`);

/* ---- the referee join -------------------------------------------------- */
/* The one thing this league buys. A join that matched half the season yields
   a referee table that looks complete and rates everyone on half their work,
   and nothing downstream can tell. So the total matches officiated is checked
   against the size of a season. */
let refNote = 'no referees yet';
if (REFS.length) {
  assert.ok(REFS.length >= 8, `only ${REFS.length} referees — the join is thin`);
  const refMatches = REFS.reduce((s, r) => s + (Number(r.matches) || 0), 0);
  assert.ok(refMatches >= SEASON_MATCHES * 0.6,
    `referees account for ${refMatches} matches out of a ${SEASON_MATCHES}-match ` +
    `season — the referee join is only partly landing, which produces a table ` +
    `that looks complete and is not`);
  assert.ok(refMatches <= SEASON_MATCHES * 1.05,
    `referees account for ${refMatches} matches in a ${SEASON_MATCHES}-match ` +
    'season — matches are being counted twice');
  const leagueYpg = REFS.reduce(
    (s, r) => s + (Number(r.ypg) || 0) * (Number(r.matches) || 0), 0) / refMatches;

  /* HOW MANY OFFICIALS, not just how many matches. The feed names the same
     referee two ways — "Mateo Busquets Ferrer" and "M. Busquets" — and before
     build_refs merged them this table carried 40 officials for a 380-match
     season at nine matches each, instead of 27 at fourteen. Every rate was
     computed on half a career and the strictest-to-most-lenient spread was
     inflated by the small samples. The total match count was RIGHT throughout,
     which is why the existing check passed it. */
  assert.ok(REFS.length <= 32,
    `${REFS.length} officials for a ${SEASON_MATCHES}-match season — a top ` +
    'division uses roughly 20-28. This is what a feed naming the same referee ' +
    'in two spellings looks like: see build_refs.canonical_referees');
  const perRef = refMatches / REFS.length;
  assert.ok(perRef >= 10,
    `officials average ${perRef.toFixed(1)} matches each — too few for a ` +
    `${SEASON_MATCHES}-match season, so the referee identities are split`);

  /* And no two rows may be the same person under two spellings. */
  const seenRef = new Map();
  for (const r of REFS) {
    const flat = String(r.n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\./g, ' ').split(/\s+/).filter(Boolean);
    if (flat.length < 2) continue;
    const k = flat[0][0] + '|' + flat.slice(1).join(' ');
    if (seenRef.has(k)) {
      assert.fail(`two referee rows look like one official: ` +
        `"${seenRef.get(k)}" and "${r.n}"`);
    }
    seenRef.set(k, r.n);
  }
  /* Spain is the most card-heavy of the big five: 4.71 yellows a game over the
     six seasons to 2025-26. A figure down at the Premier League's 3.6 means
     the wrong division's records were read. */
  assert.ok(leagueYpg > 3.5 && leagueYpg < 7,
    `league yellow rate came out at ${leagueYpg.toFixed(2)} a game — that is ` +
    'not a Spanish top-flight season');
  refNote = `${REFS.length} referees over ${refMatches} matches, ` +
    `league ${leagueYpg.toFixed(2)} yellows a game`;
}

/* ---- the prices the page will actually show ---------------------------- */
/* Mirrors laliga.html: shrink the yellow rate toward a positional prior, then
   a hazard model over a full match. If these drift apart the page is lying,
   so the duplication here is deliberate and its whole purpose. */
const SHRINK_MATCHES = 6;
const acc = {};
for (const p of LALIGA_PLAYERS) {
  const m = Number(p.min) || 0;
  if (!(m > 0) || p.y == null) continue;
  const a = (acc[p.p] ||= { w: 0, m: 0 });
  a.w += p.y * m;
  a.m += m;
}
const prior = (pos) => (acc[pos] && acc[pos].m ? acc[pos].w / acc[pos].m : 0.15);

const probs = [];
for (const p of LALIGA_PLAYERS) {
  const m = Number(p.min) || 0;
  if (!(m > 0) || p.yc == null) continue;
  const y = C.shrinkRate(p.yc, m, prior(p.p), SHRINK_MATCHES);
  const prob = C.pCardFromLambda(C.cardLambda(y, 90, {}));
  assert.ok(prob > 0 && prob < 1, `${p.n}: impossible probability ${prob}`);
  probs.push(prob);
}
probs.sort((a, b) => b - a);
const max = probs[0];
const median = probs[Math.floor(probs.length / 2)];

assert.ok(max < 0.65, `top P(card) is ${(max * 100).toFixed(1)}% — model off its leash`);
assert.ok(max > 0.25, `top P(card) is only ${(max * 100).toFixed(1)}% — model too flat`);
assert.ok(median > 0.05 && median < 0.4,
  `median P(card) is ${(median * 100).toFixed(1)}% — implausible for a league`);

/* ---- the page reads what the data provides ----------------------------- */
const page = readFileSync(join(root, 'laliga.html'), 'utf8');
for (const need of ['data/laliga_data.js', 'assets/core.js', 'LALIGA_PLAYERS',
                    'cardLambda', 'shrinkRate']) {
  assert.ok(page.includes(need), `laliga.html no longer references ${need}`);
}
/* Storage keys, read off the constants rather than by searching for a
   substring. Three desks now share an origin, and a shared key would mean
   three different players with the same name sharing a watchlist entry. */
const keys = [...page.matchAll(/KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
assert.ok(keys.length >= 2, `expected localStorage key constants, found ${keys.length}`);
for (const k of keys) {
  assert.ok(k.startsWith('laliga_'),
    `localStorage key ${k} is not laliga-scoped — the desks would share state ` +
    'across players who are different people with the same names');
}

/* ---- the suspension strip ---------------------------------------------- */
/* RFEF art. 112 accumulation does not carry between seasons, so the strip has
   to read THIS season's count. The dataset carries it as `sc`, separate from
   `yc`, which is last season's total. Confusing the two would tell a reader a
   player is one booking from a ban when the rules have him on zero — a
   confident, specific and completely wrong claim, and the kind that gets
   acted on. */
const codeOnlyPage = page
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const strip = /function suspRows\(\)([\s\S]*?)\n  \}/.exec(codeOnlyPage);
assert.ok(strip, 'laliga.html has no suspRows() — the suspension strip is gone');
assert.ok(/\bp\.sc\b/.test(strip[1]),
  'the suspension strip does not read `sc` (this season\'s cautions)');
assert.ok(!/\bp\.yc\b/.test(strip[1]),
  'the suspension strip reads `yc` — that is LAST season\'s total, and RFEF ' +
  'art. 112 accumulation does not carry between seasons');
assert.ok(/suspensionCycle/.test(codeOnlyPage) && /pCardsAtLeast/.test(codeOnlyPage),
  'the strip no longer uses the shared suspension maths in core.js');
/* Five, and only five. Spain has no ladder; a 10 or 15 here would be the
   English thresholds imported to the wrong country. */
const banAt = /BAN_AT\s*=\s*(\d+)/.exec(codeOnlyPage);
assert.ok(banAt && banAt[1] === '5',
  `the strip bans at ${banAt && banAt[1]} cautions — RFEF art. 112 says five`);

/* Every `sc` is either unknown or a plausible in-season count. A value equal
   to the player's whole previous season would mean the two fields have been
   crossed somewhere upstream. */
const withSc = LALIGA_PLAYERS.filter((p) => p.sc != null);
for (const p of withSc) {
  assert.ok(Number.isFinite(p.sc) && p.sc >= 0 && p.sc <= 30,
    `${p.n}: implausible season caution count ${p.sc}`);
}
if (withSc.length) {
  const identical = withSc.filter((p) => p.yc != null && p.sc === p.yc && p.yc > 3).length;
  assert.ok(identical < withSc.length * 0.5,
    `${identical} of ${withSc.length} players have this season's cautions exactly ` +
    "equal to last season's — the two fields look crossed");
}
const scNote = withSc.length
  ? `${withSc.length} players with this season's cautions`
  : 'season cautions not harvested yet (pre-season)';

/* ---- fixtures, when they have been harvested --------------------------- */
let fxNote = 'no fixture list yet';
const fxPath = join(root, 'data', 'laliga_fixtures.js');
if (existsSync(fxPath)) {
  vm.runInContext(readFileSync(fxPath, 'utf8'), ctx);
  const FX = vm.runInContext('LALIGA_FIXTURES', ctx);
  assert.ok(Array.isArray(FX) && FX.length > 0, 'laliga_fixtures.js has no fixtures');

  for (const f of FX) {
    assert.ok(shorts.has(f.h) && shorts.has(f.a),
      `fixture ${f.id}: ${f.h} v ${f.a} — a club not in CLUBS`);
    assert.notEqual(f.h, f.a, `fixture ${f.id} has a club playing itself`);
    if (f.d) assert.ok(!isNaN(new Date(f.d)), `fixture ${f.id}: unparseable date ${f.d}`);
  }

  const byClub = {};
  for (const p of LALIGA_PLAYERS) (byClub[p.c] ||= []).push(p);
  const sideExpected = (short) => {
    const squad = (byClub[short] || []).filter((p) => (Number(p.min) || 0) > 0 && p.yc != null);
    if (!squad.length) return null;
    const w = C.minuteWeights(squad.map((p) => p.min), 11);
    return squad.reduce((sum, p, i) => {
      const y = C.shrinkRate(p.yc, p.min, prior(p.p), SHRINK_MATCHES);
      return sum + (C.pCardFromLambda(C.cardLambda(y, Math.max(0, w[i]) * 90, {})) || 0);
    }, 0);
  };
  const cache = {};
  const exp = FX.map((f) => (cache[f.h] ??= sideExpected(f.h)) + (cache[f.a] ??= sideExpected(f.a)))
    .filter((x) => isFinite(x));
  const meanExp = exp.reduce((s, v) => s + v, 0) / exp.length;

  if (REFS.length) {
    const refMatches = REFS.reduce((s, r) => s + (Number(r.matches) || 0), 0);
    const leagueYpg = REFS.reduce(
      (s, r) => s + (Number(r.ypg) || 0) * (Number(r.matches) || 0), 0) / refMatches;
    const ratio = meanExp / leagueYpg;
    assert.ok(ratio > 0.7 && ratio < 1.3,
      `fixtures price ${meanExp.toFixed(2)} cards a match against a league that ` +
      `produced ${leagueYpg.toFixed(2)} (ratio ${ratio.toFixed(2)}) — the model has drifted`);
    fxNote = `${FX.length} fixtures, ${FX.filter((f) => f.ref).length} with a referee, ` +
      `pricing ${meanExp.toFixed(2)} a match against the league's ${leagueYpg.toFixed(2)}`;
  } else {
    fxNote = `${FX.length} fixtures, pricing ${meanExp.toFixed(2)} a match ` +
      '(no referees yet to calibrate against)';
  }
}

const rated = CLUBS.filter((c) => c.ca != null).length;
console.log(
  `check-laliga OK: ${CLUBS.length} clubs, ${LALIGA_PLAYERS.length} players, ` +
  `${rated} clubs with a measured card rate; ` +
  `P(card) max ${(max * 100).toFixed(1)}%, median ${(median * 100).toFixed(1)}%; ` +
  `${scNote}; ` +
  `${refNote}; ${fxNote}`
);

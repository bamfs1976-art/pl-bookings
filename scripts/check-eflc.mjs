// Guard the Championship dataset and the page that reads it.
//
// The desk has no build step, so nothing else stands between a bad
// eflc_data.js and a published page of wrong numbers. This asserts the shape
// the page depends on and, more importantly, re-derives the prices the same
// way the page does and checks they are in a range a bookings market could
// actually contain — a model that quietly starts printing 80% is the failure
// that matters, and it is not a syntax error.
//
// Skips cleanly when eflc_data.js has not been generated: it is produced by
// the refresh workflow, and CI on a fresh clone should not fail for its
// absence.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'data', 'eflc_data.js');

if (!existsSync(dataPath)) {
  console.log('check-eflc: data/eflc_data.js not built yet — skipping.');
  process.exit(0);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(dataPath, 'utf8'), ctx);
const { CLUBS, EFLC_PLAYERS, REFS, PLDCore: C } =
  vm.runInContext('({CLUBS, EFLC_PLAYERS, REFS, PLDCore})', ctx);

/* ---- shape ------------------------------------------------------------- */
assert.equal(CLUBS.length, 24, `expected 24 clubs, got ${CLUBS.length}`);
assert.ok(EFLC_PLAYERS.length > 600, `only ${EFLC_PLAYERS.length} players`);
assert.ok(REFS.length >= 15, `only ${REFS.length} referees`);

const shorts = new Set(CLUBS.map((c) => c.short));
const orphan = [...new Set(EFLC_PLAYERS.map((p) => p.c))].filter((c) => !shorts.has(c));
assert.equal(orphan.length, 0, `players at clubs not in CLUBS: ${orphan.join(', ')}`);

/* A club's `img` is its BADGE. The API-Football harvest once mapped the
   player's photo into it, so every club on this desk carried a squad member's
   face where its crest belongs — wrong on screen, and nothing else here would
   have noticed, because a photo URL is a perfectly well-formed string. */
const faces = CLUBS.filter((c) => c.img && /\/(players|photos)\//.test(c.img))
  .map((c) => `${c.short} -> ${c.img}`);
assert.equal(faces.length, 0,
  `clubs whose crest is a player photo, not a badge:\n  ${faces.join('\n  ')}`);

/* Every club a real squad. This is the failure this repo has already shipped
   once, in the Premier League desk, as six forwards and no defenders. */
for (const c of CLUBS) {
  const squad = EFLC_PLAYERS.filter((p) => p.c === c.short);
  assert.ok(squad.length >= 15, `${c.short}: only ${squad.length} players`);
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    assert.ok(squad.some((p) => p.p === pos), `${c.short}: no ${pos}`);
  }
}

const dupes = new Set();
const seen = new Set();
for (const p of EFLC_PLAYERS) {
  const k = `${p.c}|${p.n}`;
  if (seen.has(k)) dupes.add(k);
  seen.add(k);
}
assert.equal(dupes.size, 0, `duplicate rows: ${[...dupes].slice(0, 5).join(', ')}`);

/* ---- the prices the page will actually show ---------------------------- */
/* Mirrors eflc.html: shrink the yellow rate toward a positional prior, then
   a hazard model over a full match. If these drift apart the page is lying,
   so the duplication here is deliberate and its whole purpose. */
const SHRINK_MATCHES = 6;
const acc = {};
for (const p of EFLC_PLAYERS) {
  const m = Number(p.min) || 0;
  if (!(m > 0) || p.y == null) continue;
  const a = (acc[p.p] ||= { w: 0, m: 0 });
  a.w += p.y * m;
  a.m += m;
}
const prior = (pos) => (acc[pos] && acc[pos].m ? acc[pos].w / acc[pos].m : 0.15);

const probs = [];
for (const p of EFLC_PLAYERS) {
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

/* A player is not more likely than not to be booked in a single match. The
   most-carded player in a league sits around 40%; anything past 60 means the
   model has come off its calibration, which is exactly what happened when
   this page priced off the foul-heavy risk score instead of the card rate. */
assert.ok(max < 0.6, `top P(card) is ${(max * 100).toFixed(1)}% — model off its leash`);
assert.ok(max > 0.25, `top P(card) is only ${(max * 100).toFixed(1)}% — model too flat`);
assert.ok(median > 0.05 && median < 0.35,
  `median P(card) is ${(median * 100).toFixed(1)}% — implausible for a league`);

/* ---- the page reads what the data provides ----------------------------- */
const page = readFileSync(join(root, 'eflc.html'), 'utf8');
for (const need of ['data/eflc_data.js', 'assets/core.js', 'EFLC_PLAYERS', 'cardLambda', 'shrinkRate']) {
  assert.ok(page.includes(need), `eflc.html no longer references ${need}`);
}
/* Storage keys, read off the constants rather than by searching the file for
   a substring — the first version of this check failed on a COMMENT in
   eflc.html explaining why the key is not shared. */
const keys = [...page.matchAll(/KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
assert.ok(keys.length >= 2, `expected localStorage key constants, found ${keys.length}`);
for (const k of keys) {
  assert.ok(k.startsWith('eflc_'),
    `localStorage key ${k} is not eflc-scoped — the two desks would share state ` +
    'across players who are different people with the same names');
}

/* ---- the suspension ladder ---------------------------------------------- */
/* England's rungs are CUMULATIVE, ESCALATING and GATED by the club's match
   number, and Spain's are a repeating ungated cycle. Both desks read their
   rule from the dataset rather than hardcoding one, because getting the two
   the wrong way round is silent: Spain's cycle applied here would forgive a
   player who has spent his 5- and 10-rungs, and this ladder applied to Spain
   would invent bans nobody serves. */
const SUSP = vm.runInContext("typeof SUSPENSION !== 'undefined' ? SUSPENSION : null", ctx);
let suspNote = 'no suspension scheme in the dataset yet';
if (SUSP) {
  assert.equal(SUSP.kind, 'ladder',
    `the Championship scheme is "${SUSP.kind}" — England uses a ladder, not a cycle`);
  assert.equal(SUSP.cumulative, true,
    'the English ladder does not reset when a ban is served');
  const at = SUSP.rungs.map((r) => r.at);
  assert.deepEqual(at, [5, 10, 15], `rungs are ${at.join('/')}, expected 5/10/15`);
  assert.deepEqual(SUSP.rungs.map((r) => r.ban), [1, 2, 3],
    'the bans are 1, 2 and 3 matches — the ten-rung is TWO, not one');
  /* 46-game season: the gates are the 19th and 37th match. The Premier
     League's are 19 and 32, and using those here would price a cut-off five
     matches early for every player in the division. */
  assert.deepEqual(SUSP.rungs.map((r) => r.by), [19, 37, null],
    `gates are ${SUSP.rungs.map((r) => r.by).join('/')} — a 46-game season ` +
    'cuts off at 19 and 37, not the Premier League 19 and 32');
  suspNote = `ladder ${at.join('/')} banning ${SUSP.rungs.map((r) => r.ban).join('/')}`;
}

const pageCode = page
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
if (SUSP) {
  assert.ok(/PLDSuspension/.test(pageCode),
    'eflc.html does not use the shared suspension module');
  assert.ok(/\bSUSPENSION\b/.test(pageCode),
    'eflc.html does not read the shipped scheme — it must not hardcode rungs');
  /* Thresholds must come from the data. A literal 5/10/15 in the page is the
     drift this whole arrangement exists to prevent. */
  assert.ok(!/rungs\s*:/.test(pageCode),
    'eflc.html defines its own rungs instead of reading SUSPENSION');
  /* And the strip counts THIS season. */
  const strip = /function renderSuspension\(\)([\s\S]*?)\n  \}/.exec(pageCode);
  assert.ok(strip, 'eflc.html has no renderSuspension()');
  assert.ok(!/\bp\.yc\b/.test(strip[1]),
    'the strip reads `yc` — that is last season, and the ladder counts only this one');
}

/* ---- fixtures, when they have been harvested --------------------------- */
let fxNote = 'no fixture list yet';
const fxPath = join(root, 'data', 'eflc_fixtures.js');
if (existsSync(fxPath)) {
  vm.runInContext(readFileSync(fxPath, 'utf8'), ctx);
  const FX = vm.runInContext('EFLC_FIXTURES', ctx);
  assert.ok(Array.isArray(FX) && FX.length > 0, 'eflc_fixtures.js has no fixtures');

  for (const f of FX) {
    assert.ok(shorts.has(f.h) && shorts.has(f.a),
      `fixture ${f.id}: ${f.h} v ${f.a} — a club not in CLUBS`);
    assert.notEqual(f.h, f.a, `fixture ${f.id} has a club playing itself`);
    if (f.d) assert.ok(!isNaN(new Date(f.d)), `fixture ${f.id}: unparseable date ${f.d}`);
  }

  /* Calibration. Re-prices every fixture with NO referee — the neutral case —
     the same way the page does, and checks the average lands near the card
     rate the league actually produced. A model that drifts here shows nothing
     on screen: the cards still render, the numbers are just wrong. */
  const byClub = {};
  for (const p of EFLC_PLAYERS) (byClub[p.c] ||= []).push(p);
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

  /* What the division actually produced. The shipped REFS carry a rate and a
     match count, not raw totals, so it is the match-weighted mean of ypg —
     reading a `yellows` field that the emit does not write gave a league
     average of zero and an infinite ratio. */
  const refMatches = REFS.reduce((s, r) => s + (Number(r.matches) || 0), 0);
  const leagueYpg = REFS.reduce(
    (s, r) => s + (Number(r.ypg) || 0) * (Number(r.matches) || 0), 0) / refMatches;
  assert.ok(leagueYpg > 1 && leagueYpg < 8,
    `league card rate came out at ${leagueYpg.toFixed(2)} — REFS shape has changed`);
  const ratio = meanExp / leagueYpg;
  assert.ok(ratio > 0.7 && ratio < 1.3,
    `fixtures price ${meanExp.toFixed(2)} cards a match against a league that ` +
    `produced ${leagueYpg.toFixed(2)} (ratio ${ratio.toFixed(2)}) — the model has drifted`);
  fxNote = `${FX.length} fixtures, ${FX.filter((f) => f.ref).length} with a referee, ` +
    `pricing ${meanExp.toFixed(2)} a match against the league's ${leagueYpg.toFixed(2)}`;
}

const rated = CLUBS.filter((c) => c.ca != null).length;
console.log(
  `check-eflc OK: ${CLUBS.length} clubs, ${EFLC_PLAYERS.length} players, ` +
  `${REFS.length} refs, ${rated} clubs with a measured card rate; ${suspNote}; ` +
  `P(card) max ${(max * 100).toFixed(1)}%, median ${(median * 100).toFixed(1)}%; ` +
  fxNote
);

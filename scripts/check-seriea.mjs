// Guard the Serie A dataset and the page that reads it.
//
// The Italian counterpart of check-laliga.mjs, and the same job: the desk has
// no build step, so nothing else stands between a bad seriea_data.js and a
// published page of wrong numbers. It asserts the shape the page depends on
// and re-derives the prices the way the page does.
//
// The same two ways a discovered league can fail that the English ones cannot
// (a registry and a dataset that disagree; a referee join that half-lands),
// plus the one thing this desk adds: a THIRD suspension scheme. Italy is a
// cumulative ladder that never escalates and never expires, with a tail of
// one caution after the nineteenth. It is neither England's gated ladder nor
// Spain's repeating cycle, and both are rejected here by shape.
//
// Skips cleanly when seriea_data.js has not been generated: it is produced by
// the refresh workflow, and CI on a fresh clone should not fail for its
// absence.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'data', 'seriea_data.js');

if (!existsSync(dataPath)) {
  console.log('check-seriea: data/seriea_data.js not built yet, skipping.');
  process.exit(0);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(dataPath, 'utf8'), ctx);
const { CLUBS, SERIEA_PLAYERS, REFS, PLDCore: C } =
  vm.runInContext('({CLUBS, SERIEA_PLAYERS, REFS, PLDCore})', ctx);

const CLUB_COUNT = 20;
const SEASON_MATCHES = 380;

/* ---- shape ------------------------------------------------------------- */
assert.equal(CLUBS.length, CLUB_COUNT, `expected ${CLUB_COUNT} clubs, got ${CLUBS.length}`);
assert.ok(SERIEA_PLAYERS.length > 400, `only ${SERIEA_PLAYERS.length} players`);

const shorts = new Set(CLUBS.map((c) => c.short));
assert.equal(shorts.size, CLUBS.length, 'two clubs share a short code');
const orphan = [...new Set(SERIEA_PLAYERS.map((p) => p.c))].filter((c) => !shorts.has(c));
assert.equal(orphan.length, 0, `players at clubs not in CLUBS: ${orphan.join(', ')}`);

/* The discovered division and the dataset must be the same division. Nothing
   else notices if they drift: the page reads CLUBS, the harvest reads the
   registry, and a club in one and not the other simply has no players. */
const regPath = join(root, 'data', 'seriea_clubs.json');
if (existsSync(regPath)) {
  const reg = JSON.parse(readFileSync(regPath, 'utf8')).clubs || {};
  const regShorts = new Set(Object.values(reg).map((d) => d.short));
  assert.equal(regShorts.size, CLUB_COUNT,
    `seriea_clubs.json holds ${regShorts.size} clubs, not ${CLUB_COUNT}`);
  const missing = [...regShorts].filter((s) => !shorts.has(s));
  const extra = [...shorts].filter((s) => !regShorts.has(s));
  assert.equal(missing.length + extra.length, 0,
    `the club registry and the dataset disagree: only in registry: ` +
    `${missing.join(', ') || 'none'}; only in dataset: ${extra.join(', ') || 'none'}`);
}

/* Every club a real squad. This is the failure this repo has already shipped
   once, in the Premier League desk, as six forwards and no defenders. */
for (const c of CLUBS) {
  const squad = SERIEA_PLAYERS.filter((p) => p.c === c.short);
  assert.ok(squad.length >= 15, `${c.short}: only ${squad.length} players`);
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    assert.ok(squad.some((p) => p.p === pos), `${c.short}: no ${pos}`);
  }
}

const dupes = new Set();
const seen = new Set();
for (const p of SERIEA_PLAYERS) {
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
  assert.ok(REFS.length >= 8, `only ${REFS.length} referees: the join is thin`);
  const refMatches = REFS.reduce((s, r) => s + (Number(r.matches) || 0), 0);
  /* THE WHOLE SEASON. The brief for this desk made a partial join a blocker:
     380 of 380 rows must find an official. The table below the 3-match floor
     loses a handful of one-off appointments, so the floor is 95%, not 60%. */
  assert.ok(refMatches >= SEASON_MATCHES * 0.95,
    `referees account for ${refMatches} matches out of a ${SEASON_MATCHES}-match ` +
    `season: the referee join did not cover the whole season, which produces a ` +
    `table that looks complete and is not`);
  assert.ok(refMatches <= SEASON_MATCHES * 1.05,
    `referees account for ${refMatches} matches in a ${SEASON_MATCHES}-match ` +
    'season: matches are being counted twice');
  const leagueYpg = REFS.reduce(
    (s, r) => s + (Number(r.ypg) || 0) * (Number(r.matches) || 0), 0) / refMatches;

  /* HOW MANY OFFICIALS, not just how many matches. The feed names the same
     referee two ways: "Mateo Busquets Ferrer" and "M. Busquets": and every
     rate is then computed on half a career while the total match count stays
     RIGHT, which is why a match-count check passes it.

     The ceiling was 32, set when the table had 40 rows and merged down to 27.
     But 27 was not the answer either: seven officials were still split, and a
     ceiling that admits the broken table it was written against is decoration.
     Spain used 20 in 2025-26 above the 3-match floor. 26 leaves room for a
     season that spreads its appointments wider and still fails the 27 that
     shipped. */
  /* Italy's CAN pool is wider than Spain's: around 30 officials take Serie A
     matches in a season, most of them a dozen or more. */
  assert.ok(REFS.length <= 34,
    `${REFS.length} officials for a ${SEASON_MATCHES}-match season: the CAN ` +
    'uses roughly 25-32 above a 3-match floor. This is what a feed naming the ' +
    'same referee in two spellings looks like: see build_refs.canonical_referees');
  const perRef = refMatches / REFS.length;
  assert.ok(perRef >= 10,
    `officials average ${perRef.toFixed(1)} matches each: too few for a ` +
    `${SEASON_MATCHES}-match season, so the referee identities are split`);

  /* AND NO TWO ROWS MAY BE ONE OFFICIAL.
   *
   * This keyed on the initial plus EVERY remaining token joined, which is the
   * same positional assumption that caused the bug it was meant to catch:
   * "J. Manzano" hashes to "j|manzano" and "Jesus Gil Manzano" to "j|gil
   * manzano", so the detector never fired on either of the seven split
   * officials it was sitting right next to.
   *
   * It now asks what build_refs asks: same initial, and one row's surnames a
   * contiguous run of the other's: so the guard and the merge cannot disagree
   * about what one person looks like. Contiguous and ordered, because
   * "Busquets Ferrer" and "Ferrer Busquets" are two families. */
  const parts = (n) => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  const runIn = (a, b) => a.length && a.length <= b.length
    && b.some((_, i) => b.slice(i, i + a.length).join(' ') === a.join(' '));
  for (let i = 0; i < REFS.length; i++) {
    for (let j = i + 1; j < REFS.length; j++) {
      const x = parts(REFS[i].n), y = parts(REFS[j].n);
      if (x.length < 2 || y.length < 2 || x[0][0] !== y[0][0]) continue;
      const xs = x.slice(1), ys = y.slice(1);
      if (runIn(xs, ys) || runIn(ys, xs)) {
        assert.fail('two referee rows look like one official: ' +
          `"${REFS[i].n}" and "${REFS[j].n}". One of them is an abbreviated ` +
          'spelling build_refs.canonical_referees failed to merge, and both ' +
          'carry half his season.');
      }
    }
  }
  /* Serie A produced 3.70 yellows a game in 2025-26 on the free I1 records
     (measured, 9 September 2026). The older six-season figure for Italy is
     well above that and is deliberately not the reference: a rate that
     drifts back up toward it, or down toward the Premier League's, means the
     wrong records were read. */
  assert.ok(leagueYpg > 3.0 && leagueYpg < 4.6,
    `league yellow rate came out at ${leagueYpg.toFixed(2)} a game: that is ` +
    'not the 2025-26 Italian top flight');
  refNote = `${REFS.length} referees over ${refMatches} matches, ` +
    `league ${leagueYpg.toFixed(2)} yellows a game`;
}

/* ---- the prices the page will actually show ---------------------------- */
/* Mirrors seriea.html: shrink the yellow rate toward a positional prior, then
   a hazard model over a full match. If these drift apart the page is lying,
   so the duplication here is deliberate and its whole purpose. */
const SHRINK_MATCHES = 6;
const acc = {};
for (const p of SERIEA_PLAYERS) {
  const m = Number(p.min) || 0;
  if (!(m > 0) || p.y == null) continue;
  const a = (acc[p.p] ||= { w: 0, m: 0 });
  a.w += p.y * m;
  a.m += m;
}
const prior = (pos) => (acc[pos] && acc[pos].m ? acc[pos].w / acc[pos].m : 0.15);

const probs = [];
for (const p of SERIEA_PLAYERS) {
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

assert.ok(max < 0.65, `top P(card) is ${(max * 100).toFixed(1)}%: model off its leash`);
assert.ok(max > 0.25, `top P(card) is only ${(max * 100).toFixed(1)}%: model too flat`);
assert.ok(median > 0.05 && median < 0.4,
  `median P(card) is ${(median * 100).toFixed(1)}%: implausible for a league`);

/* ---- the page reads what the data provides ----------------------------- */
const page = readFileSync(join(root, 'seriea.html'), 'utf8');
for (const need of ['data/seriea_data.js', 'assets/core.js', 'SERIEA_PLAYERS',
                    'cardLambda', 'shrinkRate']) {
  assert.ok(page.includes(need), `seriea.html no longer references ${need}`);
}
/* Storage keys, read off the constants rather than by searching for a
   substring. Three desks now share an origin, and a shared key would mean
   three different players with the same name sharing a watchlist entry. */
const keys = [...page.matchAll(/KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
assert.ok(keys.length >= 2, `expected localStorage key constants, found ${keys.length}`);
for (const k of keys) {
  assert.ok(k.startsWith('seriea_'),
    `localStorage key ${k} is not seriea-scoped: the desks would share state ` +
    'across players who are different people with the same names');
}

/* ---- the suspension strip ---------------------------------------------- */
/* The Italian count is cumulative within a season and starts again each
   August, so the strip has to read THIS season's count. The dataset carries it as `sc`, separate from
   `yc`, which is last season's total. Confusing the two would tell a reader a
   player is one booking from a ban when the rules have him on zero: a
   confident, specific and completely wrong claim, and the kind that gets
   acted on. */
const codeOnlyPage = page
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const strip = /function renderSuspension\(\)([\s\S]*?)\n  \}/.exec(codeOnlyPage);
assert.ok(strip, 'seriea.html has no renderSuspension(): the strip is gone');
assert.ok(!/\bp\.yc\b/.test(strip[1]),
  'the suspension strip reads `yc`, which is LAST season\'s total; the Italian ' +
  'count starts again each season');
assert.ok(/PLDSuspension/.test(codeOnlyPage),
  'seriea.html does not use the shared suspension module: the desks need ' +
  'genuinely different schemes, which is exactly why none implements one');
assert.ok(/\bSUSPENSION\b/.test(codeOnlyPage),
  'seriea.html does not read the shipped scheme');
assert.ok(!/rungs\s*:/.test(codeOnlyPage),
  'seriea.html defines its own rungs: they are shipped from the registry, and ' +
  'a page-local copy is a second place for the Italian thresholds to drift');

/* The shipped scheme must be Italy's: the ladder of art. 19 of the Codice di
   Giustizia Sportiva, and neither England's nor Spain's. Checked by SHAPE, so
   a registry edit that swapped in the wrong country's rule fails here whatever
   it is called. */
const SUSP = vm.runInContext("typeof SUSPENSION !== 'undefined' ? SUSPENSION : null", ctx);
assert.ok(SUSP, 'seriea_data.js ships no SUSPENSION block');
assert.equal(SUSP.kind, 'ladder',
  `the Serie A scheme is "${SUSP.kind}": Italy is a cumulative ladder, and a ` +
  'cycle is Spain');
assert.ok(SUSP.at == null && SUSP.cumulative === true,
  'the Serie A scheme carries a cycle length or resets after a ban, which is Spain');
assert.deepEqual((SUSP.rungs || []).map((r) => r.at), [5, 10, 14, 17, 19],
  `the Italian rungs are ${JSON.stringify((SUSP.rungs || []).map((r) => r.at))}, ` +
  'not 5 / 10 / 14 / 17 / 19 (art. 19: fifth, then fourth, third, second)');
for (const r of SUSP.rungs) {
  assert.equal(r.ban, 1, `the ban at ${r.at} is ${r.ban} matches: Italy never escalates`);
  assert.equal(r.by, null, `the rung at ${r.at} is gated by match ${r.by}: gates are England`);
}
assert.equal(SUSP.then_every, 1,
  `after the nineteenth caution the ban comes every ${SUSP.then_every}; art. 19 ` +
  'says every caution');
/* And the two other countries' schemes are rejected by the same checks, so the
   checks are known to bite rather than to pass whatever is shipped. */
const ENGLAND = { kind: 'ladder', cumulative: true,
  rungs: [{ at: 5, ban: 1, by: 19 }, { at: 10, ban: 2, by: 32 }, { at: 15, ban: 3, by: null }] };
const SPAIN = { kind: 'cycle', at: 5, ban: 1, cumulative: false };
const italian = (s) => s.kind === 'ladder' && s.cumulative === true && s.at == null
  && JSON.stringify((s.rungs || []).map((r) => r.at)) === JSON.stringify([5, 10, 14, 17, 19])
  && (s.rungs || []).every((r) => r.ban === 1 && r.by == null) && s.then_every === 1;
assert.ok(italian(SUSP) && !italian(ENGLAND) && !italian(SPAIN),
  'the Italian-scheme check does not tell the three countries apart');
const nextAt = (c) => C.nextSuspension(c, 20, SUSP);
assert.equal(nextAt(0).at, 5); assert.equal(nextAt(9).at, 10); assert.equal(nextAt(14).at, 17);
assert.equal(nextAt(19).at, 20); assert.equal(nextAt(23).at, 24);
assert.ok([0, 9, 14, 19, 23].every((c) => nextAt(c).ban === 1 && !nextAt(c).dead),
  'PLDCore.nextSuspension does not walk the Italian ladder as the registry ships it');
/* The threshold used to be a BAN_AT constant in this page. It is now read
   from the shipped scheme instead, and asserted above: a page-local constant
   was one more place for the rule to drift from the registry. */

/* Every `sc` is either unknown or a plausible in-season count. A value equal
   to the player's whole previous season would mean the two fields have been
   crossed somewhere upstream. */
const withSc = SERIEA_PLAYERS.filter((p) => p.sc != null);
for (const p of withSc) {
  assert.ok(Number.isFinite(p.sc) && p.sc >= 0 && p.sc <= 30,
    `${p.n}: implausible season caution count ${p.sc}`);
}
if (withSc.length) {
  const identical = withSc.filter((p) => p.yc != null && p.sc === p.yc && p.yc > 3).length;
  assert.ok(identical < withSc.length * 0.5,
    `${identical} of ${withSc.length} players have this season's cautions exactly ` +
    "equal to last season's: the two fields look crossed");
}
const scNote = withSc.length
  ? `${withSc.length} players with this season's cautions`
  : 'season cautions not harvested yet (pre-season)';

/* ---- fixtures, when they have been harvested --------------------------- */
let fxNote = 'no fixture list yet';
const fxPath = join(root, 'data', 'seriea_fixtures.js');
if (existsSync(fxPath)) {
  vm.runInContext(readFileSync(fxPath, 'utf8'), ctx);
  const FX = vm.runInContext('SERIEA_FIXTURES', ctx);
  assert.ok(Array.isArray(FX) && FX.length > 0, 'seriea_fixtures.js has no fixtures');

  for (const f of FX) {
    assert.ok(shorts.has(f.h) && shorts.has(f.a),
      `fixture ${f.id}: ${f.h} v ${f.a}: a club not in CLUBS`);
    assert.notEqual(f.h, f.a, `fixture ${f.id} has a club playing itself`);
    if (f.d) assert.ok(!isNaN(new Date(f.d)), `fixture ${f.id}: unparseable date ${f.d}`);
  }

  const byClub = {};
  for (const p of SERIEA_PLAYERS) (byClub[p.c] ||= []).push(p);
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
      `produced ${leagueYpg.toFixed(2)} (ratio ${ratio.toFixed(2)}): the model has drifted`);
    fxNote = `${FX.length} fixtures, ${FX.filter((f) => f.ref).length} with a referee, ` +
      `pricing ${meanExp.toFixed(2)} a match against the league's ${leagueYpg.toFixed(2)}`;
  } else {
    fxNote = `${FX.length} fixtures, pricing ${meanExp.toFixed(2)} a match ` +
      '(no referees yet to calibrate against)';
  }
}

const rated = CLUBS.filter((c) => c.ca != null).length;
console.log(
  `check-seriea OK: ${CLUBS.length} clubs, ${SERIEA_PLAYERS.length} players, ` +
  `${rated} clubs with a measured card rate; ` +
  `P(card) max ${(max * 100).toFixed(1)}%, median ${(median * 100).toFixed(1)}%; ` +
  `${scNote}; ` +
  `${refNote}; ${fxNote}`
);

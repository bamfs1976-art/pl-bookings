#!/usr/bin/env node
/* Pricing off a confirmed XI — the guard that comes BEFORE the feature.
 *
 * THE ONE THAT MATTERS MOST IS THE NEGATIVE. A feature that silently re-prices
 * the fixtures it has NO new information about is not this feature, it is a
 * regression wearing its name. Most of a round has no published lineup at any
 * given moment — the XI lands about an hour before kick-off — so the common
 * case is the untouched one, and it has to be untouched to the digit the page
 * prints, not merely close.
 *
 * That is asserted here by pricing every fixture in a real round through the
 * real path twice: once as the code stands, once with the lineup layer present
 * but given nothing. Byte-identical or it fails.
 *
 * THE SECOND THING IS ARITHMETIC, and it is the one the intuitive numbers get
 * wrong. A team plays 990 player-minutes. `minuteWeights(mins, 11)` already
 * spreads exactly that (10.95-11.00 per club on the shipped data), so an XI
 * weighting that does not land on the same total makes every fixture the desk
 * knows MOST about drift away from every fixture it knows less about — an
 * artefact of having the team sheet rather than of anything on it.
 *
 *   90 for a starter, 20 for a sub  ->  13.0. Eighteen per cent too much.
 *   90 for a starter,  0 for a sub  ->  11.0, but a named sub cannot be booked.
 *
 * Both are checked below, because both are what someone will reach for when
 * they next touch this.
 *
 * Every assertion has been mutation-tested; see MUTATIONS at the foot.
 *
 *     node scripts/check-lineup-pricing.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = require(join(root, 'assets', 'core.js'));

function load(file, konst) {
  const c = {};
  vm.createContext(c);
  vm.runInContext(readFileSync(join(root, file), 'utf8'), c);
  return vm.runInContext(konst, c);
}

let passed = 0;
const ok = (what) => { console.log('  ok - ' + what); passed++; };
const group = (t) => console.log(t);

/* ---- 1. the negative: no lineup changes nothing ------------------------ */
group('a fixture with no known lineup prices exactly as it did');

const EFLC = load('data/eflc_data.js', 'EFLC_PLAYERS');
const CLUBS = load('data/eflc_data.js', 'CLUBS');
const REFS = load('data/eflc_data.js', 'REFS');
const FIX = load('data/eflc_fixtures.js', 'EFLC_FIXTURES');

/* The desks' own pricing path, reduced to the part a lineup would touch: the
   minute weighting and the board built on it. Not a mock — the same PLDCore
   entry points eflc.html calls, in the same order, so a change to either
   shows up here. */
function sideProbs(club, factor, roles) {
  const squad = EFLC.filter((p) => p.c === club && !p.ls && p.min > 0 && p.y != null);
  if (!squad.length) return null;
  const mins = squad.map((p) => p.min);
  /* THE BRANCH THIS GUARD EXISTS FOR. With no roles the weighting is the one
     that has always run; with roles it is the XI one. Anything that makes the
     first branch depend on the second is the bug. */
  const w = roles ? C.xiWeights(squad.map((p) => roles[p.n] || null))
                  : C.minuteWeights(mins, 11);
  const ps = squad.map((p, i) => {
    const y90 = C.shrinkRate(p.y, Math.max(1, Math.round(p.min / 90)), 0.25, 6);
    return C.pCardFromLambda(C.cardLambda(y90, w[i] * 90, { ref: factor }));
  });
  return ps.filter((x) => x != null && isFinite(x));
}

function board(fx, roles) {
  const ref = fx.ref ? REFS.find((r) => C.matchRefName(fx.ref, REFS.map((x) => x.n)) === r.n) : null;
  const factor = ref ? C.refCardFactor(ref, { avgYpg: 4.0, avgCpf: 0.25 }, {}) : 1;
  const h = sideProbs(fx.h, factor, roles && roles[fx.h]);
  const a = sideProbs(fx.a, factor, roles && roles[fx.a]);
  if (!h || !a) return null;
  return C.teamCardMarkets(h, a, [2.5, 3.5, 4.5, 5.5]);
}

{
  /* EVERY fixture in the round, not a convenient one. The round the desks are
     actually serving, priced with the lineup layer absent and then present-
     but-empty. */
  const round1 = FIX.filter((f) => f.r === 1);
  assert.ok(round1.length >= 10, `only ${round1.length} fixtures to compare`);
  let compared = 0, drift = [];
  for (const fx of round1) {
    const before = board(fx, null);
    const after = board(fx, {});            // the layer is there; it knows nothing
    if (!before || !after) continue;
    compared++;
    /* Serialised and compared as strings: "to the decimal the page prints" is
       the claim, and a tolerance would quietly permit the drift this exists to
       forbid. */
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      drift.push(`${fx.h} v ${fx.a}: ${before.expected} -> ${after.expected}`);
    }
  }
  assert.ok(compared >= 10, `only ${compared} fixtures actually priced`);
  assert.equal(drift.length, 0,
    `${drift.length} fixture(s) re-priced with no lineup known: ` + drift.slice(0, 3).join('; '));
  ok(`all ${compared} fixtures in the round price byte-identically with no lineup`);
}

{
  /* And a lineup that resolves to NOBODY must be the same as no lineup. A
     feed that answers with names the squad does not contain is the realistic
     failure — a January signing, a spelling the join misses — and the desk
     must fall back rather than price a team of nobody. */
  const fx = FIX.filter((f) => f.r === 1)[0];
  const before = board(fx, null);
  const nobody = board(fx, { [fx.h]: { 'Nobody At All': 'start' }, [fx.a]: {} });
  assert.notEqual(before, null);
  assert.notEqual(JSON.stringify(before), JSON.stringify(nobody),
    'a lineup naming nobody in the squad priced the same as a real one — which ' +
    'would mean the roles are not reaching the weighting at all, and every ' +
    'assertion in this file is vacuous');
  ok('an unresolvable lineup is distinguishable — the roles do reach the weighting');
}

/* ---- 2. the arithmetic: conserve the eleven ---------------------------- */
group('an XI weighting spreads the same football as a squad weighting');

{
  /* What the squad weighting actually sums to, measured rather than assumed,
     because that is the number the XI one has to match. */
  const clubs = [...new Set(EFLC.filter((p) => !p.ls && p.min > 0).map((p) => p.c))];
  const sums = clubs.map((c) => {
    const mins = EFLC.filter((p) => p.c === c && !p.ls && p.min > 0).map((p) => p.min);
    return C.minuteWeights(mins, 11).reduce((a, b) => a + b, 0);
  });
  const lo = Math.min(...sums), hi = Math.max(...sums);
  assert.ok(lo > 10.9 && hi <= 11.0001,
    `squad weights sum to ${lo.toFixed(2)}-${hi.toFixed(2)} per club, not ~11 — the ` +
    'target the XI weighting is matched against has moved');
  ok(`squad weighting spreads ${lo.toFixed(2)}-${hi.toFixed(2)} per club across ${clubs.length} clubs`);

  /* THE XI WEIGHTING MUST LAND THERE TOO, at every bench size a real lineup
     can have — a Championship seven and a Premier League nine divide the same
     pool of substitute minutes by different denominators. */
  for (let bench = 0; bench <= 12; bench++) {
    const roles = [...Array(11).fill('start'), ...Array(bench).fill('sub')];
    const total = C.xiWeights(roles).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 11) < 1e-9,
      `an XI with a bench of ${bench} spreads ${total.toFixed(3)} elevens, not 11`);
  }
  ok('the XI weighting spreads exactly 11 at every bench size from 0 to 12');

  /* CONSERVATION IS NOT ENOUGH ON ITS OWN, which the mutation testing found:
     dropping the five-substitution cap still spreads exactly 11 at every bench
     size — it just moves minutes from the starters to the bench and quietly
     asserts that all nine substitutes come on. Conservation is a property of
     the arithmetic; the cap is a fact about football, and only this catches it.

     Total substitute minutes must therefore stop growing once the bench is
     larger than the permitted substitutions. */
  const benchTotal = (n) => {
    const w = C.xiWeights([...Array(11).fill('start'), ...Array(n).fill('sub')]);
    return w.slice(11).reduce((a, b) => a + b, 0) * 90;
  };
  /* PINNED TO THE LITERAL, because asserting against C.SUBS_USED is circular —
     raising the constant moves both sides and the check passes on a desk that
     now believes seven substitutions are allowed. Five is a competition rule in
     all three divisions, so changing it is a rules change and should have to
     come here and say so. */
  assert.equal(C.SUBS_USED, 5,
    'SUBS_USED is not 5 — that is a competition rule, not a model parameter; if ' +
    'the laws changed, change this line deliberately');
  assert.equal(C.SUB_MINUTES, 20,
    'SUB_MINUTES moved — it is the one free parameter here, so it may well be ' +
    'right to move it, but it re-prices every fixture with a known lineup');
  const capped = C.SUBS_USED * C.SUB_MINUTES;
  assert.ok(Math.abs(benchTotal(C.SUBS_USED) - capped) < 1e-9,
    `a bench of exactly ${C.SUBS_USED} shares ${benchTotal(C.SUBS_USED).toFixed(1)} minutes, not ${capped}`);
  for (const n of [C.SUBS_USED + 1, 7, 9, 12]) {
    assert.ok(Math.abs(benchTotal(n) - capped) < 1e-9,
      `a bench of ${n} shares ${benchTotal(n).toFixed(1)} substitute minutes — only ` +
      `${C.SUBS_USED} substitutions are permitted, so the pool cannot grow past ${capped}`);
  }
  /* And a bench SHORTER than the allowance cannot supply minutes it has not
     got — that half of the same rule. */
  assert.ok(Math.abs(benchTotal(3) - 3 * C.SUB_MINUTES) < 1e-9,
    'a bench of 3 supplied more than three substitutes\' worth of minutes');
  ok(`the bench shares at most ${capped} minutes however many are named — ${C.SUBS_USED} substitutions`);
}

{
  /* THE TWO WRONG ANSWERS, pinned as wrong. Whoever next edits this will reach
     for one of them; the numbers say why not. */
  const naive = 11 * 1 + 9 * (20 / 90);
  assert.ok(naive > 12.9,
    'the 90-and-20 rule no longer overshoots, so this note is stale');
  const real = C.xiWeights([...Array(11).fill('start'), ...Array(9).fill('sub')])
    .reduce((a, b) => a + b, 0);
  assert.ok(naive - real > 1.9,
    `90-and-20 would spread ${naive.toFixed(2)} against the correct ${real.toFixed(2)} — ` +
    'if that gap has closed, the constants have drifted');
  ok(`90-and-20 would price ${((naive / real - 1) * 100).toFixed(0)}% more football than is played`);

  /* A named substitute must carry real exposure. Zero is the other wrong
     answer and it is the one that looks tidy. */
  const m = C.lineupMinutes(11, 9);
  assert.ok(m.sub > 5 && m.sub < 30,
    `a named substitute is priced at ${m.sub.toFixed(1)} minutes, which is not a bench`);
  assert.ok(m.starter > 70 && m.starter < 90,
    `a starter is priced at ${m.starter.toFixed(1)} minutes, which is not a start`);
  ok(`starter ${m.starter.toFixed(1)} min, named substitute ${m.sub.toFixed(1)} min`);
}

{
  /* Degenerate shapes return something safe rather than throwing on a feed
     that half-answered. */
  assert.equal(C.lineupMinutes(0, 9), null, 'a lineup with no starters is not a lineup');
  assert.deepStrictEqual(C.xiWeights([]), []);
  assert.deepStrictEqual(C.xiWeights(null), []);
  assert.deepStrictEqual(C.xiWeights(['sub', 'sub']), [0, 0],
    'a bench with no starters priced something');
  /* A player not in the lineup at all is not at the ground. */
  const w = C.xiWeights(['start', 'sub', null, 'unused', undefined]);
  assert.equal(w[2], 0); assert.equal(w[3], 0); assert.equal(w[4], 0);
  ok('a half-answered feed prices nothing rather than throwing');
}

/* ---- 3. one join, not a fourth ----------------------------------------- */
group('the player-name join is the one that already exists');

{
  /* THE TWO EXISTING JOINS ARE COMPLEMENTARY, and assuming otherwise is how
     this feature failed once already. joinLooksRight absorbs a TRAILING
     abbreviation; the two-stage key absorbs an abbreviated FORENAME, which is
     what API-Football publishes. Each misses what the other catches, so both
     tiers must survive — a future tidy-up that drops either as redundant is
     exactly what this pins. */
  assert.equal(typeof C.joinLooksRight, 'function');
  assert.ok(C.joinLooksRight('Bruno Guimarães', 'Bruno G.'),
    'joinLooksRight stopped absorbing a trailing abbreviation');
  assert.ok(!C.joinLooksRight('Christian Nørgaard', 'C. Nørgaard'),
    'joinLooksRight now matches an abbreviated forename — if that is deliberate ' +
    'the second tier below may be redundant, but it is not what it documents');
  assert.ok(!C.joinLooksRight('Rice', 'Maurice'),
    'the comparator matched a substring — it is documented as prefix-only');

  /* Both tiers, through the one entry point the lineup layer uses. Every pair
     here is a real shape from a real feed; the last two are the names a
     previous attempt at this feature lost. */
  const squad = ['Christian Nørgaard', 'Bruno Guimarães', 'Toti Gomes',
                 'Andri Guðjohnsen', 'João Gomes', 'Jørgen Strand Larsen', 'Declan Rice'];
  for (const [published, expect] of [
    ['C. Nørgaard', 'Christian Nørgaard'],
    ['Bruno G.', 'Bruno Guimarães'],
    ['J. Gomes', 'João Gomes'],
    ['J. Strand Larsen', 'Jørgen Strand Larsen'],
    ['Toti', 'Toti Gomes'],                 // single token — joinLooksRight only
    ['A. Guðjohnsen', 'Andri Guðjohnsen'],  // ð survives NFD — foldLetters only
  ]) {
    assert.equal(C.matchSquadName(published, squad), expect,
      `${published} did not resolve to ${expect}`);
  }
  assert.equal(C.matchSquadName('Maurice', squad), null,
    'a substring matched a different player');
  /* Ambiguity refuses, like every other join here. */
  assert.equal(C.matchSquadName('J. Gomes', ['João Gomes', 'Jorge Gomes']), null,
    'two players sharing an initial and surname resolved to one of them');
  /* foldLetters had to be exported for a caller outside core.js to normalise
     the same way. Letters that ARE their own character — ø, ð, ł — survive
     NFD, so normName alone is not enough and a second copy of this list is
     how two files start disagreeing about Guðjohnsen. */
  assert.equal(typeof C.foldLetters, 'function', 'foldLetters is not exported');
  assert.equal(C.foldLetters('Guðjohnsen'), 'Gudjohnsen');
  assert.equal(C.foldLetters('Højbjerg'), 'Hojbjerg');
  assert.equal(C.normName(C.foldLetters('Guðjohnsen')), 'gudjohnsen');
  ok('joinLooksRight and foldLetters are exported and behave as documented');
}

{
  /* THE ROUND TRIP, over every squad name on all three desks rather than a
     handful I picked. API-Football's convention is forename-to-an-initial,
     surname in full; apply that to a real squad name and join it back, and
     anything that does not return to itself is a player the lineup layer would
     silently drop from his own team sheet.

     A hand-picked list of six names cannot find that. 1,700 can. */
  const abbrev = (n) => {
    const p = String(n).split(' ').filter(Boolean);
    return p.length < 2 ? n : p[0][0] + '. ' + p.slice(1).join(' ');
  };
  let total = 0, lost = [];
  for (const [file, konst] of [
    ['data/eflc_data.js', 'EFLC_PLAYERS'],
    ['data/laliga_data.js', 'LALIGA_PLAYERS'],
    ['data/pl_data.js', 'PL_PLAYERS'],
  ]) {
    const players = load(file, konst).filter((p) => !p.ls);
    const clubs = [...new Set(players.map((p) => p.c))];
    for (const club of clubs) {
      const squad = players.filter((p) => p.c === club).map((p) => p.n);
      for (const n of squad) {
        total++;
        if (C.matchSquadName(abbrev(n), squad) !== n) lost.push(`${konst} ${club} ${n}`);
      }
    }
  }
  /* 1,400 is the floor, not the count: squads change size through a window and
     the Premier League desk's baked set is the smallest of the three. Set below
     what the three currently carry, high enough that a desk dropping out of the
     loop entirely fails here. */
  assert.ok(total > 1300, `only ${total} squad names round-tripped — a desk looks empty`);
  /* Some loss is legitimate: two players at one club who share an initial and
     a surname collapse to the same key, and the join REFUSES rather than pick
     one. That is the designed behaviour and it is why this is a ceiling, not
     zero. It is a handful, not a tenth. */
  assert.ok(lost.length <= total * 0.01,
    `${lost.length}/${total} squad names do not survive the feed's own ` +
    `abbreviation: ${lost.slice(0, 5).join('; ')}`);
  ok(`${total - lost.length}/${total} squad names across three desks survive the feed's abbreviation`);
}

console.log(`\n${passed} checks passed`);

/* ---- MUTATIONS -----------------------------------------------------------
 * Applied to a clean tree; the check named on the right is the one that failed.
 *
 *  core.js
 *    xiWeights returns minuteWeights when roles are empty
 *                                    -> "an unresolvable lineup is
 *                                        distinguishable" (the vacuity check)
 *    SUB_MINUTES 20 -> 45            -> "spreads 11 at every bench size" holds
 *                                       (the split moves, the total does not),
 *                                       but "a named substitute is priced at
 *                                       22.5 minutes, which is not a bench"
 *                                       fails — which is why BOTH are asserted
 *    benchPool not subtracted from the starters' share
 *                                    -> "an XI with a bench of 9 spreads
 *                                        12.111 elevens, not 11"
 *    Math.min(SUBS_USED, nb) -> nb   -> "a bench of 12 spreads ... not 11"
 *    starter share divided by 11 rather than ns
 *                                    -> conservation holds at ns=11 only; the
 *                                       bench-0..12 sweep still passes, so this
 *                                       one is caught by the byte-identical
 *                                       check instead once wired
 *    foldLetters unexported          -> "foldLetters is not exported"
 *
 *  the guard's own vacuity
 *    board() ignoring `roles`        -> "an unresolvable lineup is
 *                                        distinguishable" — without that case
 *                                        every byte-identical assertion here
 *                                        would pass on a function that does
 *                                        nothing, which is the failure mode a
 *                                        negative guard is most prone to
 */

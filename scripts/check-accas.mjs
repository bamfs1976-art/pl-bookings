#!/usr/bin/env node
/* The round's two nine-folds: the allocation, the goals markets, the wiring.
 *
 * WHAT THIS IS PROTECTING. Two accas on the Premier League desk, nine legs
 * each, every leg a different match. Three of the things that could go wrong
 * would not throw, would not look wrong, and would flatter the numbers:
 *
 *   1. A FIXTURE APPEARING TWICE. Filling each market's quota independently is
 *      the natural way to write it, and the fixture that tops the over-lines
 *      is usually the fixture that tops both-teams-carded — so the obvious
 *      implementation repeats a match and prices one distribution as two
 *      independent events. Nothing on the page would look amiss.
 *   2. BOTH SIDES OF THE MATCH ODDS. Home-win and away-win cannot both land.
 *      An acca carrying both is a guaranteed loser priced as ~35%.
 *   3. A SHORT ACCA LABELLED AS A NINE-FOLD. When the board cannot fill nine
 *      distinct matches, returning what it managed is worse than returning
 *      nothing, because the caption still says nine.
 *
 * RUN, DON'T READ. Everything here that can be executed is executed —
 * against the real match model and the real fixture list, not a fixture I
 * invented to agree with me. The source assertions at the end cover only the
 * page wiring, which has no feed in this environment to run against.
 *
 * Every assertion below has been mutation-tested: the thing it names was
 * broken, and it failed. See MUTATIONS at the foot of this file.
 *
 *     node scripts/check-accas.mjs
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

/* ---- 1. the allocator, against brute force ----------------------------- */
group('accaAllocate: distinct fixtures, and the best set of them');

/* The optimum by exhaustive enumeration. Deliberately a DIFFERENT algorithm
   from the one under test — a slow, obviously-correct one — because a guard
   that re-implements the same branch-and-bound would agree with it about a
   shared mistake. */
function brute(buckets) {
  const bs = buckets.map((b) => ({ ...b, options: b.options.slice() }));
  let bestS = -Infinity, best = null;
  const used = new Set(), pick = bs.map(() => []);
  (function bucket(i, s) {
    if (i === bs.length) {
      if (s > bestS) { bestS = s; best = pick.map((a) => a.slice()); }
      return;
    }
    (function combo(from, s2) {
      if (pick[i].length === bs[i].need) { bucket(i + 1, s2); return; }
      for (let j = from; j < bs[i].options.length; j++) {
        const o = bs[i].options[j];
        if (used.has(o.id)) continue;
        used.add(o.id); pick[i].push(o);
        combo(j + 1, s2 + Math.log(o.prob));
        pick[i].pop(); used.delete(o.id);
      }
    })(0, s);
  })(0, 0);
  return { score: bestS, best };
}

/* mulberry32. A seeded generator so a failure is reproducible, and a real one
   — the obvious `(seed * 1103515245 + 12345) & 0x7fffffff` overflows 2^53 in
   JS and degenerates into a short cycle, which silently turns 20,000 random
   boards into a few dozen repeated ones. That happened while writing this. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

{
  const rnd = mulberry32(20260815);
  let ran = 0, subopt = 0, dup = 0, wrongNull = 0, missedNull = 0, short = 0, inexact = 0;
  for (let t = 0; t < 6000; t++) {
    const nf = 2 + Math.floor(rnd() * 10);
    const nb = 1 + Math.floor(rnd() * 4);
    const buckets = [];
    for (let b = 0; b < nb; b++) {
      const need = 1 + Math.floor(rnd() * 3);
      const options = [];
      for (let f = 0; f < nf; f++) {
        if (rnd() < 0.35) continue;                 // this market cannot price that fixture
        options.push({ id: 'F' + f, prob: 0.02 + rnd() * 0.95 });
      }
      buckets.push({ key: 'B' + b, need, options });
    }
    const need = buckets.reduce((a, b) => a + b.need, 0);
    const got = C.accaAllocate(buckets);
    const exp = brute(buckets);
    const feasible = isFinite(exp.score);
    ran++;
    if (!got) { if (feasible) wrongNull++; continue; }
    if (!feasible) { missedNull++; continue; }
    if (!got.exact) inexact++;
    const ids = got.picks.map((o) => o.id);
    if (new Set(ids).size !== ids.length) dup++;
    if (ids.length !== need) short++;
    const s = got.picks.reduce((a, o) => a + Math.log(o.prob), 0);
    if (Math.abs(s - exp.score) > 1e-9) subopt++;
  }
  assert.equal(dup, 0, `${dup}/${ran} allocations used one fixture twice`);
  ok(`no fixture used twice, over ${ran} random boards`);
  assert.equal(short, 0, `${short}/${ran} allocations came back short of the quota`);
  ok('every returned allocation fills every quota exactly');
  assert.equal(subopt, 0, `${subopt}/${ran} allocations were beaten by exhaustive search`);
  ok('the allocation matches the brute-force optimum every time');
  assert.equal(wrongNull, 0, `${wrongNull}/${ran} solvable boards came back null`);
  assert.equal(missedNull, 0, `${missedNull}/${ran} unsolvable boards came back with an answer`);
  ok('null exactly when no assignment exists — greedy stranding itself is not "unsolvable"');
  /* Not a performance note: `exact:false` is the flag the page would have to
     stop trusting, so a board this size reaching the node cap would mean the
     bound is broken rather than that the board is hard. */
  assert.equal(inexact, 0, `${inexact} boards hit the node cap at this size`);
  ok('the search closes inside its node budget at board sizes the app ships');
}

{
  /* The specific stranding case, pinned on its own rather than left to the
     random sweep to stumble over: two buckets can price F1 and F2, only one
     can price F3. Greedy hands F1 and F2 to the first bucket and leaves the
     second with nothing, and an early version of accaAllocate returned null
     here — reporting a solvable board as impossible. */
  const got = C.accaAllocate([
    { key: 'A', need: 2, options: [{ id: 'F1', prob: 0.9 }, { id: 'F2', prob: 0.8 }, { id: 'F3', prob: 0.5 }] },
    { key: 'B', need: 1, options: [{ id: 'F1', prob: 0.7 }, { id: 'F2', prob: 0.6 }] },
  ]);
  assert.ok(got, 'a board greedy cannot fill in one pass was reported unfillable');
  assert.equal(got.picks.length, 3);
  assert.equal(new Set(got.picks.map((o) => o.id)).size, 3);
  ok('a board that strands greedy is still solved, not declared impossible');
}

{
  /* Short is not an answer. Two buckets needing three fixtures between them
     when only two exist must be null — a two-leg reply to a three-leg
     question is the substitution the caller cannot see. */
  assert.equal(C.accaAllocate([
    { key: 'A', need: 2, options: [{ id: 'F1', prob: 0.9 }, { id: 'F2', prob: 0.8 }] },
    { key: 'B', need: 1, options: [{ id: 'F1', prob: 0.7 }, { id: 'F2', prob: 0.6 }] },
  ]), null);
  ok('a board too small for the quota returns null, never a short acca');
}

/* ---- 2. the goals markets, off the real fitted grid -------------------- */
group('simOutcomes: BTTS and the goal lines come off the grid, not beside it');

const SIM = load('data/sim_model.js', 'SIM_MODEL');
const PL_FIXTURES = load('data/pl_fixtures.js', 'PL_FIXTURES');
const round1 = PL_FIXTURES.filter((f) => f.r === 1);
assert.ok(round1.length >= 8, `only ${round1.length} fixtures in PL round 1 — the fixture file is not what this guard assumes`);

{
  /* Recount every market straight off simScoreGrid, independently of
     simOutcomes' own walk. If the two ever disagree, the fold has drifted
     from the distribution it claims to summarise. */
  let checked = 0;
  for (const f of round1) {
    const lam = C.simLambdas(f.h, f.a, SIM);
    assert.ok(lam, `${f.h} v ${f.a} is unrated by the match model`);
    const n = C.SIM_MAX_GOALS, G = n + 1;
    const grid = C.simScoreGrid(lam.lh, lam.la, SIM.constants.DC_RHO, n);
    const o = C.simOutcomes(grid, n);
    let btts = 0, o15 = 0, o25 = 0, tot = 0, home = 0;
    for (let h = 0; h < G; h++) {
      for (let a = 0; a < G; a++) {
        const p = grid[h * G + a];
        tot += p;
        if (h >= 1 && a >= 1) btts += p;
        if (h + a > 1.5) o15 += p;
        if (h + a > 2.5) o25 += p;
        if (h > a) home += p;
      }
    }
    assert.ok(Math.abs(tot - 1) < 1e-9, 'the score grid is not a distribution');
    assert.ok(Math.abs(o.btts - btts) < 1e-12, `${f.h} v ${f.a}: BTTS ${o.btts} != recount ${btts}`);
    assert.ok(Math.abs(o.over[1.5] - o15) < 1e-12, `${f.h} v ${f.a}: over 1.5 disagrees with the grid`);
    assert.ok(Math.abs(o.over[2.5] - o25) < 1e-12, `${f.h} v ${f.a}: over 2.5 disagrees with the grid`);
    assert.ok(Math.abs(o.home - home) < 1e-12, `${f.h} v ${f.a}: the result probabilities moved`);
    checked++;
  }
  ok(`BTTS and every goal line match an independent recount of the grid, on all ${checked} fixtures`);
}

{
  /* Over-lines must fall as the line rises, and BTTS must sit under over 1.5:
     both teams scoring IS at least two goals, so BTTS can never be the more
     likely of the two. A sign error or an off-by-one in the comparison shows
     up here and nowhere else. */
  for (const f of round1) {
    const s = C.simFixture(f.h, f.a, SIM);
    assert.ok(s.over[0.5] > s.over[1.5] && s.over[1.5] > s.over[2.5] && s.over[2.5] > s.over[3.5],
      `${f.h} v ${f.a}: the goal over-lines are not monotone`);
    assert.ok(s.btts <= s.over[1.5] + 1e-12,
      `${f.h} v ${f.a}: BTTS ${s.btts} exceeds over 1.5 ${s.over[1.5]}, which is impossible`);
    assert.ok(Math.abs(s.home + s.draw + s.away - 1) < 1e-9, 'the three results do not sum to one');
  }
  ok('over-lines fall as the line rises, and BTTS never exceeds over 1.5');
}

{
  /* AN INTEGER LINE, which nothing shipped uses and which is exactly why this
     is here. Every line the app prices is a half-line, and against a half-line
     `tot > l` and `tot >= l` are the same function — a goal total is an
     integer, so no scoreline ever sits on the line. Mutating the comparison
     therefore changed no shipped number and escaped every check above.
     simOutcomes' docstring nonetheless promises that an integer line settles
     the way a book settles it (2 goals does NOT win "over 2"), so the promise
     gets a test at the only place it is observable. */
  const f = round1[0];
  const lam = C.simLambdas(f.h, f.a, SIM);
  const grid = C.simScoreGrid(lam.lh, lam.la, SIM.constants.DC_RHO, C.SIM_MAX_GOALS);
  const o = C.simOutcomes(grid, C.SIM_MAX_GOALS, [2, 2.5]);
  /* "More than 2 goals" and "more than 2.5 goals" are the SAME event — both
     need three. So the two must come out identical. Under `>=`, over 2 would
     swallow every 2-goal draw and 2-0 as well, and come out larger. */
  assert.ok(Math.abs(o.over[2] - o.over[2.5]) < 1e-12,
    `over 2 (${o.over[2]}) and over 2.5 (${o.over[2.5]}) differ — an integer line is ` +
    'settling on >= and paying 2-goal games out as "over 2"');
  assert.ok(o.over[2] > 0 && o.over[2] < 1, 'the integer line did not compute at all');
  ok('an integer line settles strictly over, so a 2-goal game does not win "over 2"');
}

group('simLegOptions: one side of the match odds, never both');

{
  let winLegs = 0;
  for (const f of round1) {
    const s = C.simFixture(f.h, f.a, SIM);
    const opts = C.simLegOptions(s, f.h, f.a);
    const wins = opts.filter((o) => o.market === 'WIN');
    assert.equal(wins.length, 1, `${f.h} v ${f.a} offered ${wins.length} win legs`);
    /* And it must be the STRONGER side: offering the underdog would be
       correct-by-the-rule and wrong-by-the-point. */
    assert.ok(Math.abs(wins[0].prob - Math.max(s.home, s.away)) < 1e-12,
      `${f.h} v ${f.a} offered the weaker side to win`);
    assert.ok(wins[0].label.includes(s.home >= s.away ? f.h : f.a),
      `${f.h} v ${f.a}: the win leg names the wrong club`);
    assert.ok(!opts.some((o) => o.market === 'DRAW'), 'the draw is being offered as a leg');
    /* Sorted descending, like matchLegOptions, so "[0]" means "the best". */
    for (let i = 1; i < opts.length; i++) {
      assert.ok(opts[i - 1].prob >= opts[i].prob, 'simLegOptions is not sorted by probability');
    }
    winLegs++;
  }
  ok(`exactly one win leg per fixture, always the stronger side, across ${winLegs} fixtures`);
  assert.deepStrictEqual(C.simLegOptions(null, 'A', 'B'), []);
  ok('an unrated fixture offers no legs rather than a guess');
}

/* ---- 3. the two accas actually build, on the real round ---------------- */
group('the round accas: nine legs, nine matches, on real data');

{
  /* The page's own leg pool, rebuilt from the same primitives. The CARD legs
     cannot be reached here — they need the live FPL squad feed — so this
     covers the goals acca end to end and the card acca's win legs, and the
     source assertions below cover the wiring that carries the rest. */
  const pool = new Map();
  for (const f of round1) {
    const s = C.simFixture(f.h, f.a, SIM);
    for (const o of C.simLegOptions(s, f.h, f.a)) {
      if (!pool.has(o.market)) pool.set(o.market, []);
      pool.get(o.market).push({ id: String(f.id), prob: o.prob, label: o.label, fx: f.h + ' v ' + f.a });
    }
  }
  const got = C.accaAllocate([
    { key: 'WIN', need: 3, options: pool.get('WIN') },
    { key: 'BTTS', need: 3, options: pool.get('BTTS') },
    { key: 'OG1.5', need: 3, options: pool.get('OG1.5') },
  ]);
  assert.ok(got, 'the goals nine-fold could not be built from the real round');
  assert.equal(got.picks.length, 9);
  assert.equal(new Set(got.picks.map((o) => o.id)).size, 9,
    'the goals nine-fold used a fixture twice');
  assert.ok(got.exact, 'the goals allocation did not close inside the node budget');
  ok('the goals nine-fold builds from PL round 1: nine legs, nine different matches');

  const price = C.accaPrice(got.picks, C.TYPICAL_GOAL_MARGIN);
  assert.ok(price && price.legs === 9, 'the nine-fold did not price as nine legs');
  /* The joint probability is the product and nothing else — a helpful
     "adjustment" for correlation would be a number with no fit behind it. */
  const prod = got.picks.reduce((a, o) => a * o.prob, 1);
  assert.ok(Math.abs(price.prob - prod) < 1e-12, 'the acca price is not the product of its legs');
  assert.ok(price.prob > 0 && price.prob < 0.25,
    `a nine-fold priced at ${(price.prob * 100).toFixed(1)}% is not a nine-fold`);
  /* Nine legs of margin is the point of printing the drag, so it has to be
     substantially worse than one leg of it. */
  const one = 1 - (1 - C.TYPICAL_GOAL_MARGIN);
  assert.ok(price.marginDrag > 5 * one,
    `nine legs dragged ${(price.marginDrag * 100).toFixed(0)}% — the compounding is not being shown`);
  ok('priced as the product, and the margin drag compounds across all nine legs');
}

{
  /* The two margins are different numbers and the goals acca must use the
     goals one. Reusing the card margin would overstate the drag on the most
     competitively priced markets on the board. */
  assert.notEqual(C.TYPICAL_GOAL_MARGIN, C.TYPICAL_CARD_MARGIN);
  assert.ok(C.TYPICAL_GOAL_MARGIN < C.TYPICAL_CARD_MARGIN,
    'goals markets are cut finer than card markets — the constants say otherwise');
  const legs = [0.6, 0.6, 0.6];
  assert.ok(C.accaPrice(legs, C.TYPICAL_GOAL_MARGIN).pricedOdds
          > C.accaPrice(legs, C.TYPICAL_CARD_MARGIN).pricedOdds,
    'the two margins price identically — one of them is not being applied');
  ok('goals and cards carry their own margins, and both reach the price');
}

/* ---- 4. the page wiring, which has no feed to run against here --------- */
group('index.html: the wiring the guards above cannot execute');

const page = readFileSync(join(root, 'index.html'), 'utf8');
const fn = (name) => {
  const i = page.indexOf('function ' + name + '(');
  assert.ok(i > -1, `index.html no longer defines ${name}`);
  /* To the next top-level `function ` or `/* ---` banner — enough to scope an
     assertion to one body rather than to the whole 5,000-line file, which is
     how a check ends up satisfied by a comment three screens away. */
  const j = page.indexOf('\nfunction ', i + 1);
  return page.slice(i, j > -1 ? j : i + 4000);
};

{
  const body = fn('renderGameweek');
  assert.ok(/renderGwStats\(fx\);[\s\S]{0,400}renderRoundAccas\(fx\)/.test(body),
    'renderRoundAccas is not called with the same unfiltered round renderGwStats gets — ' +
    'the nine-folds would change when somebody types a club name into the search box');
  ok('the accas are built from the full round, not the filtered fixture list');
}

{
  const body = fn('buildRoundAcca');
  assert.ok(/PLDCore\.accaAllocate\(/.test(body),
    'buildRoundAcca no longer goes through PLDCore.accaAllocate — if the page picks ' +
    'each market\'s top three itself, nothing stops one fixture appearing twice');
  assert.ok(/PLDCore\.accaPrice\(/.test(body), 'buildRoundAcca no longer prices through accaPrice');
  assert.ok(/TYPICAL_GOAL_MARGIN[\s\S]{0,80}TYPICAL_CARD_MARGIN/.test(body),
    'buildRoundAcca no longer chooses between the goal and card margins');
  ok('the page allocates and prices through core, rather than re-deriving either');
}

{
  const body = fn('renderRoundAccas');
  assert.ok(/built\.length\s*!==\s*ROUND_ACCAS\.length[\s\S]{0,120}hidden\s*=\s*true/.test(body),
    'renderRoundAccas no longer hides the card when an acca cannot be built — ' +
    'a partial answer under a "nine-fold" caption is worse than no answer');
  ok('an acca that cannot be filled hides the card rather than shipping short');
}

{
  const body = fn('roundLegPool');
  assert.ok(/board\s*&&\s*!board\.thin/.test(body),
    'card legs are no longer gated on a non-thin board — an over-line leg IS the tail, ' +
    'and a thin board\'s tail is guesswork');
  assert.ok(/PLDCore\.simLegOptions\(/.test(body),
    'the goals legs no longer come from simLegOptions — a hand-rolled win leg is how ' +
    'both sides of the match odds end up on one slip');
  ok('thin card boards contribute no leg, and goal legs go through simLegOptions');
}

{
  /* The 2.5 card line exists only for this acca, and teamCardBoard has to be
     the thing that produces it — a second board builder would be a second
     minute-weighting, which is the drift this repo keeps paying for. */
  assert.ok(/function teamCardBoard\(h,a,ref,derby,lines\)/.test(page),
    'teamCardBoard no longer takes a lines parameter');
  assert.ok(/lines\|\|\[3\.5,4\.5,5\.5\]/.test(page),
    'teamCardBoard no longer defaults to the three lines the fixture strip prints — ' +
    'every existing caller must get the board it got before');
  assert.ok(/ACCA_CARD_LINES=\[2\.5,3\.5,4\.5,5\.5\]/.test(page),
    'the acca card lines no longer include 2.5');
  ok('the 2.5 line comes from teamCardBoard itself, and the strip\'s lines are unchanged');
}

console.log(`\n${passed} checks passed`);

/* ---- MUTATIONS -----------------------------------------------------------
 * Each of these was applied to a clean tree, this file was run, and the check
 * named on the right is the one that failed. Quoted text is what it printed.
 *
 *  core.js accaAllocate
 *    return greedy, skip the branch-and-bound  -> "631/6000 allocations were beaten
 *                                                  by exhaustive search"
 *    drop the `used.has(o.id)` test            -> "1552/6000 allocations used one
 *                                                  fixture twice"
 *    null out when greedy comes up short       -> "407/6000 solvable boards came
 *                                                  back null"
 *    return the partial allocation, not null   -> the stranding case throws on a
 *                                                 short `picks`
 *
 *  core.js simOutcomes
 *    `h >= 1 || a >= 1` for btts               -> "ARS v COV: BTTS 0.944... !=
 *                                                  recount 0.501..."
 *    `tot >= l` instead of `tot > l`           -> "over 2 (0.813...) and over 2.5
 *                                                  (0.584...) differ"
 *      NOTE this one ESCAPED the first time round, and the integer-line check
 *      above exists because of it: every line the app prices is a half-line, so
 *      `>` and `>=` agree on all of them and the mutation changed no shipped
 *      number. Only a line an integer total can sit on can tell them apart.
 *    omit `over` from simFixture's return      -> TypeError, not an assertion:
 *                                                 the monotonicity check reads
 *                                                 `s.over[0.5]` of undefined
 *
 *  core.js simLegOptions
 *    push both sides of the match odds         -> "ARS v COV offered 2 win legs"
 *    push the weaker side                      -> "ARS v COV offered the weaker
 *                                                  side to win"
 *    drop the sort                             -> "not sorted by probability"
 *
 *  core.js constants
 *    TYPICAL_GOAL_MARGIN = TYPICAL_CARD_MARGIN -> "Expected actual to be strictly
 *                                                  unequal to: 0.06"
 *
 *  index.html
 *    renderRoundAccas(fx.slice(0,5))           -> "not called with the same
 *                                                  unfiltered round"
 *    take each market's top three inline       -> "no longer goes through
 *                                                  PLDCore.accaAllocate"
 *    hide only when NOTHING built              -> "no longer hides the card"
 *    drop the !board.thin gate                 -> "no longer gated on a non-thin
 *                                                  board"
 *    bake 2.5 in, drop the lines parameter     -> "no longer takes a lines
 *                                                  parameter"
 *    hand-roll the goal legs, both win sides   -> "no longer come from
 *                                                  simLegOptions"
 *    one margin for both accas                 -> "no longer chooses between the
 *                                                  goal and card margins"
 */

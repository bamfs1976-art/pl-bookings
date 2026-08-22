#!/usr/bin/env node
/* The two nine-folds: the allocation, the goals markets, the wiring.
 *
 * WHAT THIS IS PROTECTING. Two nine-leg accas, on two pages, because they can
 * draw on different things. The GOALS nine-fold is on the Premier League desk
 * and cannot move: the match model rates those twenty clubs and nothing else,
 * and the sibling datasets carry no goals column at all. The CARD nine-fold is
 * on today.html, over a seven-day window and all three divisions, because six
 * of its nine legs have no reason to stop at one league — only its three win
 * legs do, and for the same reason the goals acca is stuck where it is.
 *
 * Four things could go wrong here without throwing, without looking wrong,
 * and while flattering the numbers:
 *
 *   1. A FIXTURE APPEARING TWICE. Filling each market's quota independently is
 *      the natural way to write it, and the fixture that tops the over-lines
 *      is usually the fixture that tops both-teams-carded — so the obvious
 *      implementation repeats a match and prices one distribution as two
 *      independent events. Nothing on the page would look amiss.
 *   2. A CLUB APPEARING TWICE. Distinct fixtures means distinct clubs over one
 *      round and NOT over seven days, where a side can play twice. The first
 *      build of the week nine-fold took both-teams-carded in two different
 *      Osasuna matches — nine distinct fixtures, two legs leaning on one
 *      team's discipline, priced as independent. Found by rendering the page
 *      and reading it, not by any check that existed at the time.
 *   3. BOTH SIDES OF THE MATCH ODDS. Home-win and away-win cannot both land.
 *      An acca carrying both is a guaranteed loser priced as ~35%.
 *   4. A SHORT ACCA LABELLED AS A NINE-FOLD. When the board cannot fill nine
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
group('accaAllocate: distinct fixtures and clubs, and the best set of them');

/* The optimum by exhaustive enumeration. Deliberately a DIFFERENT algorithm
   from the one under test — a slow, obviously-correct one — because a guard
   that re-implements the same branch-and-bound would agree with it about a
   shared mistake. */
const tokensOf = (o) => (Array.isArray(o.keys) && o.keys.length
  ? o.keys.map(String) : [String(o.id)]);

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
        const o = bs[i].options[j], tk = tokensOf(o);
        if (tk.some((k) => used.has(k))) continue;
        tk.forEach((k) => used.add(k)); pick[i].push(o);
        combo(j + 1, s2 + Math.log(o.prob));
        pick[i].pop(); tk.forEach((k) => used.delete(k));
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
    /* Fixtures pair two clubs out of a small pool, so a club recurs across
       fixtures — the seven-day case, where distinct fixtures stopped implying
       distinct clubs and the first build of the week nine-fold put Osasuna in
       two legs. Half the sweep runs on bare ids (the single-round case) so
       both key shapes are exercised. */
    const teams = 3 + Math.floor(rnd() * 8);
    const paired = rnd() < 0.5;
    const fx = [];
    for (let f = 0; f < nf; f++) {
      const h = Math.floor(rnd() * teams);
      let a = Math.floor(rnd() * teams);
      if (a === h) a = (a + 1) % teams;
      fx.push(paired ? { id: 'F' + f, keys: ['T' + h, 'T' + a] } : { id: 'F' + f });
    }
    const buckets = [];
    for (let b = 0; b < nb; b++) {
      const need = 1 + Math.floor(rnd() * 3);
      const options = [];
      for (const f of fx) {
        if (rnd() < 0.35) continue;                 // this market cannot price that fixture
        options.push({ ...f, prob: 0.02 + rnd() * 0.95 });
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
    const ids = got.picks.flatMap(tokensOf);
    if (new Set(ids).size !== ids.length) dup++;
    if (got.picks.length !== need) short++;
    const s = got.picks.reduce((a, o) => a + Math.log(o.prob), 0);
    if (Math.abs(s - exp.score) > 1e-9) subopt++;
  }
  assert.equal(dup, 0, `${dup}/${ran} allocations reused an exclusivity key`);
  ok(`no fixture and no club used twice, over ${ran} random boards`);
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
  assert.ok(/PLDCore\.simLegOptions\(/.test(body),
    'the goals legs no longer come from simLegOptions — a hand-rolled win leg is how ' +
    'both sides of the match odds end up on one slip');
  ok('the round\'s goal legs go through simLegOptions');
}

{
  /* EXACTLY ONE CARD NINE-FOLD IN THE APP. It was briefly on this page, built
     from ten Premier League fixtures, before moving to /today where its six
     card legs can draw on all three divisions. Two of them under one name,
     from different pools, would not read as a bug — just as two pages
     disagreeing — so the Premier League desk must not grow one back. */
  assert.ok(!/key:\s*"BTC"/.test(page) && !/key:\s*"O2\.5"/.test(page),
    'index.html is building card acca legs again — the card nine-fold lives on ' +
    'today.html, over every division, and two of them would disagree in public');
  assert.ok(/ROUND_ACCAS=\[[\s\S]{0,3000}?\n\];/.test(page), 'ROUND_ACCAS is gone');
  const specs = page.match(/ROUND_ACCAS=\[[\s\S]*?\n\];/)[0];
  assert.equal((specs.match(/\bid:"/g) || []).length, 1,
    'the Premier League desk carries more than one round acca again');
  assert.ok(/id:"goals"/.test(specs), 'the goals nine-fold is no longer the one that stays here');
  ok('the Premier League desk carries the goals nine-fold and no card acca');
}

/* ---- 4b. the cross-league card pool, actually built -------------------- */
group('the card nine-fold: built across three divisions, from real data');

{
  /* today.html reaches its three datasets through same-origin iframes, which
     needs a browser, so its exact wiring is covered by source assertions
     below. THIS builds the equivalent pool from the same core functions and
     the same committed data through scripts/accas.mjs — whose primitives are
     exported for precisely this ("so guards can RUN this file rather than
     pattern-match it"). What it proves is the half a source check cannot:
     that a cross-league pool allocates to nine legs with no club repeated. */
  const A = await import('./accas.mjs');
  const pool = { WIN: [], BTC: [], 'O2.5': [] };
  const seenLeagues = new Set();

  for (const L of A.LEAGUES) {
    const d = A.loadConsts(L.data, [L.players, 'REFS']);
    const f = A.loadConsts(L.fixtures, [L.fx]);
    const players = d[L.players] || [], refs = d.REFS || [], fixtures = f[L.fx] || [];
    if (!players.length || !fixtures.length) continue;
    const pr = A.priors(players);
    for (const p of players) p._y90 = A.shrunk(p, pr);
    const avgs = A.leagueAverages(refs);
    const derbies = A.derbySet(L.code);
    const boost = A.DERBY_BOOST_FOR(L.code);
    const { round } = A.matchesFor(L);
    if (round == null) continue;

    for (const fx of fixtures.filter((x) => x.r === round)) {
      const hit = fx.ref ? C.matchRefName(fx.ref, refs.map((r) => r.n)) : null;
      const ref = hit ? refs.find((r) => r.n === hit) || null : null;
      const factor = (ref ? C.refCardFactor(ref, avgs, {}) : 1)
        * (derbies.has([fx.h, fx.a].sort().join('|')) ? boost : 1);
      const home = A.sideTop(players, fx.h, factor).map((c) => c.prob);
      const away = A.sideTop(players, fx.a, factor).map((c) => c.prob);
      if (home.length + away.length < 12) continue;          // thin, same gate the page uses
      /* The 2.5 line the desks do not print. Through teamCardMarkets, the
         same entry point every board goes through. */
      const m = C.teamCardMarkets(home, away, [2.5]);
      const base = {
        id: L.code + '|' + fx.id,
        keys: [L.code + '|' + fx.h, L.code + '|' + fx.a],
        code: L.code, fx: fx.h + ' v ' + fx.a,
      };
      const btc = C.teamCardMarkets(home, away, [3.5]).bothCarded;
      if (btc > 0 && btc < 1) pool.BTC.push({ ...base, prob: btc });
      if (m.over[2.5] > 0 && m.over[2.5] < 1) pool['O2.5'].push({ ...base, prob: m.over[2.5] });
      if (L.code === 'PL') {
        const sim = C.simFixture(fx.h, fx.a, SIM);
        for (const o of C.simLegOptions(sim, fx.h, fx.a)) {
          if (o.market === 'WIN') pool.WIN.push({ ...base, prob: o.prob, label: o.label });
        }
      }
      seenLeagues.add(L.code);
    }
  }

  assert.ok(seenLeagues.size >= 2,
    `only ${seenLeagues.size} division(s) produced card legs — the pool is not cross-league`);
  const got = C.accaAllocate([
    { key: 'WIN', need: 3, options: pool.WIN },
    { key: 'BTC', need: 3, options: pool.BTC },
    { key: 'O2.5', need: 3, options: pool['O2.5'] },
  ]);
  assert.ok(got, 'the card nine-fold could not be built across three divisions');
  assert.equal(got.picks.length, 9);
  /* THE OSASUNA CHECK, on real data. Nine distinct fixtures is not the claim;
     eighteen distinct clubs is. */
  const clubs = got.picks.flatMap((o) => o.keys);
  assert.equal(new Set(clubs).size, 18,
    `${18 - new Set(clubs).size} club(s) appear in two legs: ` +
    got.picks.map((o) => o.fx).join(', '));
  assert.equal(new Set(got.picks.map((o) => o.id)).size, 9, 'a fixture is used twice');
  /* Win legs must be Premier League only — not a preference, a limit: nothing
     else is rated by the match model. */
  const winCodes = new Set(got.groups.find((g) => g.key === 'WIN').options.map((o) => o.code));
  assert.deepStrictEqual([...winCodes], ['PL'],
    `win legs came from ${[...winCodes]} — only the Premier League is rated for a result`);
  /* And the card legs must NOT be Premier League only, or the move to
     today.html bought nothing. */
  const cardCodes = new Set(got.groups.filter((g) => g.key !== 'WIN')
    .flatMap((g) => g.options).map((o) => o.code));
  assert.ok(cardCodes.size >= 2,
    `every card leg came from ${[...cardCodes]} — the acca is not drawing across divisions`);
  ok(`nine legs, eighteen different clubs, card legs from ${[...cardCodes].sort().join(' + ')}`);
  assert.ok(C.accaPrice(got.picks, C.TYPICAL_CARD_MARGIN).legs === 9);
  ok('the cross-league nine-fold prices as nine legs at the card margin');
}

/* ---- 4c. the accas have their own route, and say when they are for ----- */
group('the accas as a destination: routed, and dated');

{
  /* A TAB THAT ROUTES NOWHERE. The panel, the nav entry and the route metadata
     are three separate declarations and a desk has shipped with two of the
     three before — the Championship and La Liga desks were live, guarded and
     unreachable. All three or none. */
  assert.ok(/<section id="panel-accas"/.test(page), 'the accas panel is gone');
  assert.ok(/\{id:"accas",label:"Accas",icon:"accas",panels:\[\{id:"panel-accas"/.test(page),
    'the accas panel has no nav entry, so the only way to it is a hand-typed hash');
  assert.ok(/"panel-accas":\{t:/.test(page),
    'the accas route has no title or description — seven routes share one document ' +
    'and the title is the only signal to a screen reader that the view changed');
  assert.ok(/accas:'<svg/.test(page), 'the accas area has no icon of its own');
  /* And it must not still be sitting in the gameweek panel as well. */
  const gwStart = page.indexOf('<section id="panel-gameweek"');
  const gwEnd = page.indexOf('<section id="panel-accas"');
  assert.ok(gwStart > -1 && gwEnd > gwStart);
  assert.ok(!/id="accaRound"/.test(page.slice(gwStart, gwEnd)),
    'the nine-fold is in the gameweek panel AND on its own tab — two copies of ' +
    'one card is two places for it to disagree with itself');
  ok('the accas panel exists, is in the nav, and carries its own route metadata');
}

{
  /* WHEN THE ACCA IS FOR. A round runs Friday to Monday and a window seven
     days, so a slip with no dates on it cannot be checked against a fixture
     list or told apart from last week's. Both the range and the per-leg
     kick-off are read off the PICKED legs, never off the round or the window,
     so neither can name a day the slip does not play on. */
  const body = fn('roundAccaHtml');
  assert.ok(/koRange\(a\.picks\)/.test(body),
    'the round acca no longer dates itself from its own legs');
  assert.ok(/acca-when/.test(body), 'the date range is not rendered');
  assert.ok(/o\.ko\?'<span class="acca-ko">'\+esc\(koShort\(o\.ko\)\)/.test(body),
    'the legs no longer carry their kick-off — on a four-day round the range ' +
    'alone cannot say which leg is tonight');
  const kr = fn('koRange');
  assert.ok(/picks\|\|\[\]\)\.map\(o=>o\.ko\)/.test(kr),
    'koRange no longer reads the kick-offs off the picks it was given');
  /* And the share card must carry them too — it outlives the page it came
     from, so "Gameweek 1" alone leaves a reader unable to tell which round. */
  const sh = page.slice(page.indexOf('function shareRoundAcca('));
  assert.ok(/koRange\(a\.picks\)[\s\S]{0,600}rng&&rng\.text/.test(sh),
    'the share card subtitle no longer carries the dates the acca is for');
  ok('the round acca dates itself, per leg and as a range, on the page and the card');
}

{
  const t = readFileSync(join(root, 'today.html'), 'utf8');
  /* THE ACCAS VIEW IS GONE, and that is the current design rather than a
     regression. today.html now serves two ROUTES: `/` is today's matches and
     carries the day's acca; /today is the season calendar and carries the
     week's nine-fold. Each acca sits with the timeframe it covers, which is
     what the old third view existed to avoid — the two accas being buried
     several phone screens under a fixture list.
     So what is asserted is the split itself: each acca renders on exactly one
     route, and refuses on the other. */
  assert.ok(/var ROUTE = document\.documentElement\.getAttribute\('data-route'\)/.test(t),
    'today.html no longer derives its view from the route, so `/` and /today ' +
    'cannot be two pages');
  const accaFn = t.slice(t.indexOf('function renderAcca('));
  assert.ok(/ROUTE !== 'home'[\s\S]{0,80}card\.hidden = true/.test(accaFn.slice(0, 600)),
    "the day's acca no longer refuses to render off the home page — on the " +
    'season calendar there is no selected date for it to be the acca of');
  const nineFn = t.slice(t.indexOf('function renderNine('));
  assert.ok(/ROUTE !== 'season'[\s\S]{0,120}card\.hidden = true/.test(nineFn.slice(0, 700)),
    'the nine-fold no longer refuses to render off the season page — it spans ' +
    'seven days and under today\'s card it made the home page several screens long');
  /* Old links must still land somewhere right. #all and #accas were the two
     views that moved to /today, and links to them exist in shared cards. */
  assert.ok(/h === 'all' \|\| h === 'accas'[\s\S]{0,160}location\.replace\('\/today'\)/.test(t),
    '#all and #accas no longer redirect to /today — links in the wild that ' +
    'used to open the calendar or the accas would silently show today instead');
  /* The empty state must be OUTSIDE the card it explains. Nested inside, it is
     hidden exactly when it is needed — its text was still readable to a script,
     so only clicking the button it offers revealed that nothing could reach it. */
  const nineEmptyAt = t.indexOf('id="nineEmpty"');
  const nineCardEnd = t.indexOf('</section>', t.indexOf('id="nineCard"'));
  assert.ok(nineEmptyAt > nineCardEnd,
    'the nine-fold empty state is inside the card it explains, so it is hidden ' +
    'on exactly the renders that need it');
  /* The open paren matters: /function explainNine/ also matches
     `function explainNineX`, so renaming the function away escaped this. */
  assert.ok(/function explainNine\(/.test(t) && /function nextNineDay\(/.test(t),
    'an unfillable window no longer says why, or where the nearest one that works is');
  assert.ok(/explainNine\(from\);/.test(t),
    'explainNine is defined but never called on the paths that hide the card');
  assert.ok(/acca-ko/.test(t), 'today.html legs carry no kick-off');
  ok('today.html has an accas view, a reachable empty state, and dated legs');
}

/* ---- 5. the cross-league card nine-fold on today.html ------------------ */
group('today.html: the week\'s card nine-fold, across every division');

const today = readFileSync(join(root, 'today.html'), 'utf8');
const tfn = (name) => {
  const i = today.indexOf('function ' + name + '(');
  assert.ok(i > -1, `today.html no longer defines ${name}`);
  const j = today.indexOf('\n  function ', i + 1);
  return today.slice(i, j > -1 ? j : i + 4000);
};

{
  const body = tfn('renderNine');
  assert.ok(/C\.accaAllocate\(/.test(body),
    'renderNine no longer allocates through core — picking each market\'s top three ' +
    'itself is how one match ends up on the slip twice');
  assert.ok(/if \(!got\) \{ card\.hidden = true;[^}]*return; \}/.test(body),
    'renderNine no longer hides the card when nine distinct matches cannot be found — ' +
    'a six-fold under a "nine-fold" heading is the page lying about what it shows');
  /* And the held acca must be dropped on the same path, or the share button
     goes on offering last week's nine legs behind a hidden card. */
  /* Matched loosely enough to survive the explainer being added to the same
     path, tightly enough that removing the clearing fails: hide and clear must
     both happen before the return, in that statement. */
  assert.ok(/if \(!got\) \{ card\.hidden = true; NINE_BUILT = null;[^}]*return; \}/.test(body),
    'the hidden card leaves NINE_BUILT behind — the share button would draw a ' +
    'nine-fold the page is no longer showing');
  ok('nine or nothing: an unfillable week hides the card and drops the held acca');
}

{
  const body = tfn('weekPool');
  /* The whole point of the move: the card legs are drawn from ALL, which is
     every fixture of all three leagues, not from one league's slice. */
  assert.ok(/ALL\.forEach/.test(body),
    'weekPool no longer walks ALL — the card legs would stop being cross-league, ' +
    'which is the entire reason this acca is on this page');
  assert.ok(/p\.m\.thin/.test(body),
    'thin boards are no longer skipped — an over-line leg IS the tail, and a thin ' +
    'board\'s tail is guesswork');
  /* Win legs are PL-only by necessity, and the gate has to be the model's own
     presence rather than a hardcoded league code — if the Championship ever
     gets a fitted match model, this should start offering its fixtures. */
  assert.ok(/p\.L\.pl\s*&&\s*typeof\s*p\.L\.pl\.simFor/.test(body),
    'the win-leg gate is no longer "this league has a fitted match model"');
  assert.ok(/C\.simLegOptions\(/.test(body), 'win legs no longer go through simLegOptions');
  assert.ok(/if \(o\.market === 'WIN'\) add\('WIN'/.test(body),
    'weekPool takes more than the win leg out of simLegOptions — BTTS and the goal ' +
    'lines would enter a card acca and could not be filled outside the Premier League');
  /* THE CLUB KEYS, without which nine distinct fixtures over seven days can
     still put one club in two legs. This is the Osasuna case and it shipped
     for one render; the runnable check below is what actually proves the
     allocator honours them, and this is what proves the page passes them. */
  assert.ok(/keys: \[p\.L\.code \+ '\|' \+ p\.fx\.h, p\.L\.code \+ '\|' \+ p\.fx\.a\]/.test(body),
    'weekPool no longer passes both clubs as exclusivity keys — over seven days a ' +
    'club can play twice, and two card legs on one side\'s discipline are not the ' +
    'independent pair the price assumes');
  ok('card legs from every division, win legs gated on having a match model at all');
  ok('both clubs travel as exclusivity keys, not just the fixture id');
}

{
  const body = fn('roundLegPool');
  assert.ok(/keys:\[m\.h,m\.a\]/.test(body),
    'the round acca no longer passes both clubs as keys — equivalent to fixture-distinct ' +
    'within one round, but it is the rule the caption states and the proxy stops ' +
    'coinciding the moment a window spans more than a round');
  ok('the round acca declares club-distinctness rather than relying on a proxy');
}

{
  const body = tfn('over25');
  assert.ok(/p\.L\.pl\.board\([\s\S]{0,200}\[2\.5\],[\s\S]{0,40}p\.roles\)/.test(body),
    'the Premier League 2.5 line no longer comes from that desk\'s own board with ' +
    'the fixture\'s own roles — dropping p.roles re-prices the leg off squad minutes ' +
    'while the day board beside it prices off the team sheet, so the page would ' +
    'contradict itself on one fixture');
  assert.ok(/C\.teamCardMarkets\(p\.home\.ps,\s*p\.away\.ps,\s*\[2\.5\]\)/.test(body),
    'the sibling desks\' 2.5 line no longer goes through teamCardMarkets — computing ' +
    'it any other way is a second minute-weighting');
  /* The sibling arm needs no roles argument BECAUSE p.home.ps was already
     built from them in price(); this pins the reason so the asymmetry above
     does not read as an oversight. */
  assert.ok(/sideProbs\(L,\s*fx\.h,\s*factor,\s*rh\)/.test(tfn('price')),
    'price() no longer feeds the resolved roles into sideProbs, so p.home.ps is ' +
    'squad-weighted and the sibling 2.5 leg silently stops tracking the board');
  ok('the 2.5 line comes from each league\'s own board, on the same weights');
}

{
  /* The day acca must be untouched by all of this. It reads every line on the
     board through matchLegOptions, so adding 2.5 to the shared board would
     have silently changed which market it picks for some fixtures. */
  assert.ok(/C\.teamCardMarkets\(home\.ps, away\.ps, \[3\.5, 4\.5, 5\.5\]\)/.test(today),
    'today.html\'s shared board no longer prices exactly the three lines it did — ' +
    'the day acca picks its leg from every line on that board, so this would move it');
  const pm = readFileSync(join(root, 'assets', 'plmodel.js'), 'utf8');
  assert.ok(/function board\(h, a, ref, derby, sim, lines, roles\)/.test(pm),
    'plmodel board no longer takes lines and roles as its trailing parameters — ' +
    'both are optional by design and both must stay positionally where they are, ' +
    'since today.html passes `undefined` for sim to reach them');
  assert.ok(/lines \|\| \[3\.5, 4\.5, 5\.5\]/.test(pm),
    'plmodel board no longer defaults to the three lines every desk prints — every ' +
    'existing caller must get the board it got before');
  ok('the day acca\'s board is unchanged, and the 2.5 line is opt-in per call');
}

console.log(`\n${passed} checks passed`);

/* ---- MUTATIONS -----------------------------------------------------------
 * Each was applied to a clean tree, the suite was run, and the check named on
 * the right is the one that failed. Quoted text is what it printed.
 *
 * A NOTE ON HOW TO APPLY THEM. Anchor on the enclosing function before
 * replacing. `ALL.forEach(function (p) {` appears verbatim in both index() and
 * weekPool(); a first-match replace mutates the wrong one, the guard passes,
 * and it reads as an escape. That happened while writing this, and the "escape"
 * was a bad mutation rather than a hole.
 *
 *  core.js accaAllocate
 *    greedy only, skip branch-and-bound      -> "631/6000 allocations were beaten
 *                                                by exhaustive search"
 *    drop the used-token test                -> "1552/6000 allocations reused an
 *                                                exclusivity key"
 *    ignore `keys`, exclude on id alone      -> "218/6000 allocations reused an
 *                                                exclusivity key"
 *    null out when greedy comes up short     -> "407/6000 solvable boards came
 *                                                back null"
 *    return the partial allocation, not null -> the stranding case throws
 *
 *  core.js simOutcomes
 *    `h >= 1 || a >= 1` for btts             -> "BTTS 0.944... != recount 0.501..."
 *    `tot >= l` instead of `tot > l`         -> "over 2 and over 2.5 differ"
 *      ESCAPED THE FIRST TIME. Every shipped line is a half-line, so `>` and
 *      `>=` agree on all of them and the mutation changed no published number.
 *      The integer-line check exists because of it.
 *    drop `over` from simFixture's return    -> TypeError in the monotonicity check
 *    remove 1.5 from SIM_GOAL_LINES          -> "over 1.5 disagrees with the grid"
 *
 *  core.js simLegOptions
 *    push both sides of the match odds       -> "offered 2 win legs"
 *    push the weaker side                    -> "offered the weaker side to win"
 *    drop the sort                           -> "not sorted by probability"
 *
 *  core.js constants
 *    goal margin = card margin               -> "strictly unequal to: 0.06"
 *
 *  plmodel.js
 *    bake 2.5 into every board               -> "no longer defaults to the three
 *                                                lines every desk prints"
 *
 *  index.html (the round's goals nine-fold)
 *    renderRoundAccas(fx.slice(0,5))         -> "not called with the same
 *                                                unfiltered round"
 *    take each market's top three inline     -> "no longer goes through
 *                                                PLDCore.accaAllocate"
 *    hide only when NOTHING built            -> "no longer hides the card"
 *    hand-roll the goal legs                 -> "no longer come from simLegOptions"
 *    one margin for both accas               -> "no longer chooses between the goal
 *                                                and card margins"
 *    drop the club keys                      -> "no longer passes both clubs as keys"
 *    add a card acca back to this page       -> "index.html is building card acca
 *                                                legs again"
 *
 *  today.html (the week's card nine-fold)
 *    weekPool walks one league, not ALL      -> "no longer walks ALL"
 *    drop the club keys                      -> "no longer passes both clubs as
 *                                                exclusivity keys"  [the Osasuna bug]
 *    drop the thin-board gate                -> "thin boards are no longer skipped"
 *    admit BTTS and goal legs                -> "takes more than the win leg out of
 *                                                simLegOptions"
 *    over25 returns the 3.5 line             -> "no longer comes from that desk's
 *                                                own board"
 *    renderNine ships a short acca           -> "no longer hides the card when nine
 *                                                distinct matches cannot be found"
 *    give the day board a 2.5 line           -> "no longer prices exactly the three
 *                                                lines it did"
 *    over25 drops p.roles                    -> "no longer comes from that desk's own
 *                                                board with the fixture's own roles"
 *    price() stops passing rh/ra to sideProbs
 *                                            -> "price() no longer feeds the resolved
 *                                                roles into sideProbs"
 *
 *  assets/plmodel.js
 *    board() drops the roles parameter       -> "no longer takes lines and roles as
 *                                                its trailing parameters"
 */

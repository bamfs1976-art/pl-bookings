// Unit tests for PLDCore (assets/core.js) — run with: node tests/test-core.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const core = require('../assets/core.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

/* ---- risk formula ---- */
console.log('riskScore');
t('weights yellows double and adds fouls', () => {
  assert.equal(core.riskScore(0.3, 1.5), 2.1);
  assert.equal(core.riskScore(0, 0), 0);
  assert.equal(core.riskScore(0.5, 0), 1);
});
t('rounds to 3 decimals', () => {
  assert.equal(core.riskScore(0.428, 1.92), 2.776);
  assert.equal(core.riskScore(1 / 3, 1 / 3), 1.0);
});
t('null when either rate is missing or non-finite', () => {
  assert.equal(core.riskScore(null, 1.2), null);
  assert.equal(core.riskScore(0.4, null), null);
  assert.equal(core.riskScore(undefined, undefined), null);
  assert.equal(core.riskScore(NaN, 1), null);
});

/* ---- name normalisation ---- */
console.log('normName');
t('strips accents', () => {
  assert.equal(core.normName('Saša Lukić'), 'sasa lukic');
  assert.equal(core.normName('Kanté'), 'kante');
  assert.equal(core.normName('Müller'), 'muller');
  assert.equal(core.normName('Antonín Kinský'), 'antonin kinsky');
});
t('collapses hyphens, apostrophes and extra whitespace to single spaces', () => {
  assert.equal(core.normName('Trent Alexander-Arnold'), 'trent alexander arnold');
  assert.equal(core.normName("N'Golo Kanté"), 'n golo kante');
  assert.equal(core.normName('  Jun’ai   Byfield '), 'jun ai byfield');
});
t('lowercases and handles empty/nullish input', () => {
  assert.equal(core.normName('VAN DIJK'), 'van dijk');
  assert.equal(core.normName(''), '');
  assert.equal(core.normName(null), '');
  assert.equal(core.normName(undefined), '');
});
t('is idempotent', () => {
  const once = core.normName('José Sá');
  assert.equal(core.normName(once), once);
});

/* ---- pick P/L and ROI ---- */
console.log('pickPL / summarisePicks');
t('won pays stake x (odds - 1)', () => {
  assert.equal(core.pickPL({ status: 'won', odds: 2.5, stake: 10 }), 15);
});
t('lost loses the stake', () => {
  assert.equal(core.pickPL({ status: 'lost', odds: 2.5, stake: 10 }), -10);
});
t('void and pending return zero', () => {
  assert.equal(core.pickPL({ status: 'void', odds: 3, stake: 20 }), 0);
  assert.equal(core.pickPL({ status: 'pending', odds: 3, stake: 20 }), 0);
  assert.equal(core.pickPL(null), 0);
});
t('handles string and missing numbers', () => {
  assert.equal(core.pickPL({ status: 'won', odds: '2.00', stake: '5' }), 5);
  assert.equal(core.pickPL({ status: 'won', stake: 5 }), -5); // no odds: 0-1 = -1 per unit
  assert.equal(core.pickPL({ status: 'lost' }), -0);
});
t('summarisePicks: hit rate on settled only, void excluded from staked', () => {
  const picks = [
    { status: 'won', odds: 3, stake: 10 },   // +20
    { status: 'lost', odds: 2, stake: 10 },  // -10
    { status: 'void', odds: 5, stake: 50 },  // 0, not staked
    { status: 'pending', odds: 2, stake: 10 }
  ];
  const s = core.summarisePicks(picks);
  assert.equal(s.count, 4);
  assert.equal(s.settled, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.hit, 50);
  assert.equal(s.staked, 20);
  assert.equal(s.pl, 10);
  assert.equal(s.roi, 50);
});
t('summarisePicks: empty and non-array input', () => {
  const s = core.summarisePicks([]);
  assert.equal(s.hit, null);
  assert.equal(s.roi, null);
  assert.equal(s.pl, 0);
  assert.equal(core.summarisePicks(null).count, 0);
});

/* ---- implied probability ---- */
console.log('impliedProb / calibrate');
const players = [
  { min: 900, yc: 2, r: 1.0 },
  { min: 1800, yc: 4, r: 1.5 },
  { min: 2700, yc: 3, r: 0.8 },
  { min: 450, yc: 1, r: 2.4 }
];
const calib = core.calibrate(players);
t('calibration anchors the average player on the base rate', () => {
  assert.ok(Math.abs(core.impliedProb(calib.avgRisk, calib) - calib.baseRate) < 1e-9,
    `p(avgRisk)=${core.impliedProb(calib.avgRisk, calib)} vs baseRate=${calib.baseRate}`);
});
t('base rate is total yellows per player-match', () => {
  const matches = (900 + 1800 + 2700 + 450) / 90;
  assert.ok(Math.abs(calib.baseRate - 10 / matches) < 1e-9);
});
t('probability is strictly monotonic in risk', () => {
  let prev = -1;
  for (let r = 0; r <= 3.6; r += 0.2) {
    const p = core.impliedProb(r, calib);
    assert.ok(p > prev, `p(${r.toFixed(1)})=${p} not > ${prev}`);
    prev = p;
  }
});
t('probability stays in sensible bounds and handles bad input', () => {
  assert.ok(core.impliedProb(0, calib) >= 0.005);
  assert.ok(core.impliedProb(100, calib) <= 0.95);
  assert.equal(core.impliedProb(null, calib), null);
  assert.equal(core.impliedProb(1.5, null), null);
});
t('calibrates on the real shipped dataset', () => {
  const src = readFileSync(join(root, 'data', 'pl_data.js'), 'utf8');
  const ctx = {}; vm.createContext(ctx);
  const { PL_PLAYERS } = vm.runInContext(src + ';({PL_PLAYERS})', ctx);
  const c = core.calibrate(PL_PLAYERS);
  assert.ok(c.baseRate > 0.05 && c.baseRate < 0.4, `base rate ${c.baseRate} implausible`);
  assert.ok(Math.abs(core.impliedProb(c.avgRisk, c) - c.baseRate) < 1e-9);
});

/* ---- fair odds and edge ---- */
console.log('fairOdds / edgePct');
t('fair odds are the probability inverse', () => {
  assert.equal(core.fairOdds(0.25), 4);
  assert.equal(core.fairOdds(0.5), 2);
  assert.equal(core.fairOdds(null), null);
  assert.equal(core.fairOdds(0), null);
});
t('edge is positive above fair odds, negative below, zero at fair', () => {
  assert.ok(Math.abs(core.edgePct(4, 0.25)) < 1e-9);
  assert.ok(core.edgePct(4.4, 0.25) > 0);
  assert.ok(core.edgePct(3.6, 0.25) < 0);
  assert.equal(core.edgePct(1, 0.25), null);   // decimal odds must exceed 1
  assert.equal(core.edgePct('x', 0.25), null);
  assert.equal(core.edgePct(2, null), null);
});

/* ---- Tier 1a: shrinkage ---- */
console.log('shrinkRate (empirical-Bayes)');
t('pulls a low-exposure rate toward the prior mean', () => {
  // 1 yellow in 500 mins = 0.18/90 raw; with a 0.25/90 prior and k=6 it shrinks up toward the mean
  const raw = 1 / (500 / 90);
  const s = core.shrinkRate(1, 500, 0.25, 6);
  assert.ok(s > raw && s < 0.25, `shrunk ${s} should sit between raw ${raw} and prior 0.25`);
});
t('a heavy-minutes player barely moves', () => {
  const raw = 8 / (3000 / 90); // 0.24/90 over ~33 matches
  const s = core.shrinkRate(8, 3000, 0.15, 6);
  assert.ok(Math.abs(s - raw) < 0.02, `${s} should stay near raw ${raw}`);
});
t('zero exposure returns the prior mean', () => {
  assert.equal(core.shrinkRate(0, 0, 0.2, 6), 0.2);
});

/* ---- Tier 1b: log-odds context ---- */
console.log('scaleOdds / contextProb (referee on the odds scale)');
t('scaleOdds multiplies odds not probability', () => {
  // p=0.5 -> odds 1 -> ×1.3 -> odds 1.3 -> 0.565, NOT 0.65
  assert.ok(Math.abs(core.scaleOdds(0.5, 1.3) - 1.3 / 2.3) < 1e-9);
  assert.equal(core.scaleOdds(0.5, 1), 0.5);
});
t('log-odds ref keeps high picks below the probability-multiply blow-up', () => {
  const ctx = core.contextProb(0.72, 1.3, 1);
  assert.ok(ctx < 0.80 && ctx > 0.72, `72% under ×1.3 ref should be ~0.77, got ${ctx}`);
  assert.ok(ctx < 0.72 * 1.3); // strictly less than the naive multiply (0.936)
});
t('chains ref and derby and clamps', () => {
  assert.ok(core.contextProb(0.4, 1.2, 1.08) > 0.4);
  assert.ok(core.contextProb(0.9, 1.3, 1.1) <= 0.95);
  assert.equal(core.contextProb(null, 1.3, 1), null);
});
t('invLogit/logit round-trip', () => {
  for (const p of [0.05, 0.3, 0.72]) assert.ok(Math.abs(core.invLogit(core.logit(p)) - p) < 1e-12);
});

/* ---- Tier 1c: calibration metrics ---- */
console.log('brier / logLoss / reliability');
t('brier and logLoss reward calibrated confident-correct predictions', () => {
  const good = [{ p: 0.9, y: 1 }, { p: 0.1, y: 0 }];
  const bad = [{ p: 0.1, y: 1 }, { p: 0.9, y: 0 }];
  assert.ok(core.brier(good) < core.brier(bad));
  assert.ok(core.logLoss(good) < core.logLoss(bad));
  assert.ok(Math.abs(core.brier([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }]) - 0.25) < 1e-9);
});
t('metrics ignore malformed rows and empty input', () => {
  assert.equal(core.brier([]), null);
  assert.equal(core.logLoss([{ p: null, y: 1 }]), null);
  assert.equal(core.brier([{ p: 0.5 }, { p: 0.5, y: 1 }]), (0.5 - 1) ** 2);
});
t('reliability bins predictions and reports observed frequency', () => {
  const rows = [{ p: 0.05, y: 0 }, { p: 0.05, y: 0 }, { p: 0.95, y: 1 }, { p: 0.95, y: 1 }];
  const rel = core.reliability(rows, 10);
  assert.equal(rel[0].n, 2); assert.equal(rel[0].obs, 0);
  assert.equal(rel[9].n, 2); assert.equal(rel[9].obs, 1);
});

/* ---- Tier 2: logistic GLM ---- */
console.log('glmProb');
t('reproduces a known logistic', () => {
  const coef = { intercept: -3.03, weights: { yc90: 2.2, foul90: 1.1 } };
  const z = -3.03 + 2.2 * 0.2 + 1.1 * 1.3;
  assert.ok(Math.abs(core.glmProb({ yc90: 0.2, foul90: 1.3 }, coef) - core.invLogit(z)) < 1e-9);
});
t('missing features contribute zero; bad coef returns null', () => {
  const coef = { intercept: 0, weights: { a: 1, b: 2 } };
  assert.ok(Math.abs(core.glmProb({ a: 1 }, coef) - core.invLogit(1)) < 1e-9);
  assert.equal(core.glmProb({}, null), null);
});

/* ---- Tier 3: fouls forecast + two-stage card ---- */
console.log('expectedFouls / nbTailProb / cardProbFromFouls');
t('expected fouls scale with expected minutes', () => {
  assert.ok(Math.abs(core.expectedFouls(2.0, 90) - 2.0) < 1e-12);
  assert.ok(Math.abs(core.expectedFouls(2.0, 45) - 1.0) < 1e-12);
  assert.equal(core.expectedFouls(null, 90), null);
});
t('NB tail: higher mean lifts P(over), and a valid probability results', () => {
  const lo = core.nbTailProb(1.2, 8, 1); // P(>1.5) with mean 1.2
  const hi = core.nbTailProb(2.6, 8, 1); // P(>1.5) with mean 2.6
  assert.ok(hi > lo, `${hi} should exceed ${lo}`);
  assert.ok(lo > 0 && hi < 1);
});
t('NB approaches Poisson as size grows; sums are consistent', () => {
  // With large r the NB(mean=2) P(>0) ≈ 1-e^-2 = 0.8647
  const p = core.nbTailProb(2, 1e6, 0);
  assert.ok(Math.abs(p - (1 - Math.exp(-2))) < 1e-3, `got ${p}`);
});
t('two-stage card rises with expected fouls and hazard', () => {
  const a = core.cardProbFromFouls(1.5, 0.15);
  const b = core.cardProbFromFouls(3.0, 0.15);
  assert.ok(b > a);
  assert.ok(Math.abs(core.cardProbFromFouls(2, 0.2) - (1 - Math.exp(-0.4))) < 1e-9);
  assert.equal(core.cardProbFromFouls(null, 0.2), null);
});
t('gammaln matches known factorials', () => {
  assert.ok(Math.abs(core.gammaln(5) - Math.log(24)) < 1e-6);  // (5-1)! = 24
  assert.ok(Math.abs(core.gammaln(1)) < 1e-6);                 // 0! = 1 -> ln 1 = 0
});

/* ---- referee card factor (ypg + cards-per-foul) ---- */
console.log('refCardFactor');
t('an average referee is neutral', () => {
  const f = core.refCardFactor({ypg:4, cpf:0.15}, {avgYpg:4, avgCpf:0.15});
  assert.ok(Math.abs(f - 1) < 1e-12, `got ${f}`);
});
t('separates a strict whistle from a busy one at equal yellows/game', () => {
  const L = {avgYpg:4, avgCpf:0.176};
  const strict = core.refCardFactor({ypg:3.94, cpf:0.219}, L);   // fewer fouls, quicker card
  const busy   = core.refCardFactor({ypg:4.00, cpf:0.133}, L);   // foul-heavy games, slower card
  assert.ok(strict > busy, `strict ${strict} should exceed busy ${busy}`);
  assert.ok(strict > 1 && busy < 1);
});
t('falls back to ypg-only when cards-per-foul is missing', () => {
  const L = {avgYpg:4, avgCpf:0.15};
  assert.equal(core.refCardFactor({ypg:5, cpf:null}, L), core.refCardFactor({ypg:5}, L));
  assert.ok(Math.abs(core.refCardFactor({ypg:5, cpf:null}, L) - 1.25) < 1e-12);
});
t('clamps hard and handles junk input', () => {
  const L = {avgYpg:4, avgCpf:0.15};
  assert.equal(core.refCardFactor({ypg:99, cpf:99}, L), 1.3);
  assert.equal(core.refCardFactor({ypg:0.01, cpf:0.0001}, L), 0.75);
  assert.equal(core.refCardFactor(null, L), 1);            // no referee assigned
  assert.equal(core.refCardFactor({ypg:4}, {}), 1);        // no league baseline
  assert.equal(core.refCardFactor({ypg:0, cpf:0}, L), 1);  // zero/invalid rates
});
t('cpfWeight moves the blend between the two signals', () => {
  const L = {avgYpg:4, avgCpf:0.2};
  const r = {ypg:4, cpf:0.24};                             // neutral ypg, strict cpf (inside the clamp)
  const none = core.refCardFactor(r, L, {cpfWeight:0});
  const half = core.refCardFactor(r, L, {cpfWeight:0.5});
  const full = core.refCardFactor(r, L, {cpfWeight:1});
  assert.ok(Math.abs(none - 1) < 1e-12, `got ${none}`);
  assert.ok(Math.abs(full - 1.2) < 1e-12, `got ${full}`);
  assert.ok(Math.abs(half - Math.sqrt(1.2)) < 1e-12, `got ${half}`);
  assert.ok(half > none && half < full);
});

/* ---- recency weight (GLM fit decay) ---- */
console.log('recencyWeight');
t('most-recent gameweek keeps full weight; older decays', () => {
  assert.equal(core.recencyWeight(0, 0.97), 1);
  assert.ok(Math.abs(core.recencyWeight(1, 0.97) - 0.97) < 1e-12);
  assert.ok(Math.abs(core.recencyWeight(2, 0.97) - 0.9409) < 1e-12);
  assert.ok(core.recencyWeight(10, 0.97) < core.recencyWeight(3, 0.97));
});
t('decay defaults to 0.97 and clamps degenerate inputs', () => {
  assert.ok(Math.abs(core.recencyWeight(1) - 0.97) < 1e-12);   // default decay
  assert.equal(core.recencyWeight(5, 1), 1);                    // no decay
  assert.equal(core.recencyWeight(5, 0), 1);                    // invalid -> uniform
  assert.equal(core.recencyWeight(-3, 0.9), 1);                 // future/neg clamps to 0 ago
});

/* ---- hazard model (forecast-branch structure) ---- */
console.log('hazard model');
t('venue factor prices away above home, neutral when unknown', () => {
  assert.equal(core.venueFactor(true), core.HOME_FACTOR);
  assert.equal(core.venueFactor(false), core.AWAY_FACTOR);
  assert.equal(core.venueFactor(null), 1);
  assert.ok(core.AWAY_FACTOR > core.HOME_FACTOR, 'away sides are carded more');
});
t('chase factor lifts underdogs, damps favourites, clamps hard', () => {
  assert.equal(core.chaseFactor(0.5), 1);                    // even game, neutral
  assert.ok(core.chaseFactor(0.1) > 1, 'a heavy underdog chases');
  assert.ok(core.chaseFactor(0.9) < 1, 'a heavy favourite does not');
  assert.ok(core.chaseFactor(0) <= 1.20 && core.chaseFactor(1) >= 0.85, 'clamped');
  assert.equal(core.chaseFactor(1.5), 1);                    // nonsense input
  // Number(null) and Number('') are both 0, which would read a missing
  // simulator input as a certain loss and mark up every unwired fixture.
  assert.equal(core.chaseFactor(null), 1);
  assert.equal(core.chaseFactor(undefined), 1);
  assert.equal(core.chaseFactor(''), 1);
  assert.equal(core.chaseFactor(false), 1);
});
t('card lambda scales with rate, minutes and every factor', () => {
  const base = core.cardLambda(0.3, 90);
  assert.ok(Math.abs(base - 0.3) < 1e-12, `full 90 at 0.3/90 is 0.3, got ${base}`);
  assert.ok(Math.abs(core.cardLambda(0.3, 45) - 0.15) < 1e-12, 'half the minutes, half the risk');
  const withRef = core.cardLambda(0.3, 90, { ref: 1.2 });
  assert.ok(Math.abs(withRef - 0.36) < 1e-12, `got ${withRef}`);
  // factors compose multiplicatively
  const all = core.cardLambda(0.3, 90, { ref: 1.2, venue: 1.08, derby: 1.15 });
  assert.ok(Math.abs(all - 0.3 * 1.2 * 1.08 * 1.15) < 1e-12, `got ${all}`);
  // missing/degenerate factors are ignored, not treated as zero
  assert.equal(core.cardLambda(0.3, 90, { ref: null, venue: 0 }), 0.3);
  assert.equal(core.cardLambda(-1, 90), null);
  assert.equal(core.cardLambda(0.3, 0), null);
});
t('p(card) from lambda stays in [0,1) and is monotonic', () => {
  assert.equal(core.pCardFromLambda(0), 0);
  const a = core.pCardFromLambda(0.2), b = core.pCardFromLambda(0.5), c = core.pCardFromLambda(3);
  assert.ok(a < b && b < c, 'monotonic in lambda');
  assert.ok(c < 1, 'can never reach certainty');
  // 1 - exp(-l) rounds to exactly 1 past l ~= 37, which would give the
  // value layer fair odds of 1.00 and an infinite edge. Capped below that.
  assert.ok(core.pCardFromLambda(50) < 1, 'never returns exact certainty');
  assert.ok(core.fairOdds(core.pCardFromLambda(50)) > 1, 'fair odds stay above evens');
  // a small lambda approximates itself, the sanity check of the form
  assert.ok(Math.abs(core.pCardFromLambda(0.01) - 0.01) < 1e-4);
  assert.equal(core.pCardFromLambda(-1), null);
});
t('venue reaches contextProb without disturbing the neutral case', () => {
  const base = 0.2;
  assert.equal(core.contextProb(base, 1, 1, 1), core.contextProb(base, 1, 1));
  const home = core.contextProb(base, 1, 1, core.venueFactor(true));
  const away = core.contextProb(base, 1, 1, core.venueFactor(false));
  assert.ok(away > base && base > home, `expected ${home} < ${base} < ${away}`);
});

/* ---- team card markets (Poisson-binomial) ---- */
console.log('teamCardMarkets');
t('card count distribution is exact and sums to 1', () => {
  const d = core.cardCountDist([0.5, 0.5]);
  assert.equal(d.length, 3);
  assert.ok(Math.abs(d[0] - 0.25) < 1e-12);   // neither booked
  assert.ok(Math.abs(d[1] - 0.50) < 1e-12);   // exactly one
  assert.ok(Math.abs(d[2] - 0.25) < 1e-12);   // both
  const big = core.cardCountDist([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
  assert.ok(Math.abs(big.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});
t('probOverCards matches a hand-computed case', () => {
  // three players at 0.5: P(0)=1/8, P(1)=3/8, P(2)=3/8, P(3)=1/8
  const ps = [0.5, 0.5, 0.5];
  assert.ok(Math.abs(core.probOverCards(ps, 0.5) - 7 / 8) < 1e-12);  // 1 or more
  assert.ok(Math.abs(core.probOverCards(ps, 1.5) - 4 / 8) < 1e-12);  // 2 or more
  assert.ok(Math.abs(core.probOverCards(ps, 2.5) - 1 / 8) < 1e-12);  // 3 or more
  assert.equal(core.probOverCards(ps, 3.5), 0);                      // impossible
});
t('over-line probability is monotonically decreasing in the line', () => {
  const ps = [0.4, 0.3, 0.25, 0.2, 0.18, 0.15, 0.12, 0.1];
  const a = core.probOverCards(ps, 1.5), b = core.probOverCards(ps, 2.5), c = core.probOverCards(ps, 3.5);
  assert.ok(a > b && b > c, `expected decreasing, got ${a} ${b} ${c}`);
});
t('expected cards is the sum of probabilities', () => {
  assert.ok(Math.abs(core.expectedCards([0.25, 0.25, 0.5]) - 1) < 1e-12);
  assert.equal(core.expectedCards([]), 0);
  assert.equal(core.expectedCards(null), 0);
});
t('both teams carded is the product of each side not staying clean', () => {
  // one player each at 0.5 -> 0.5 * 0.5
  assert.ok(Math.abs(core.probBothCarded([0.5], [0.5]) - 0.25) < 1e-12);
  // an empty side can never be carded
  assert.equal(core.probBothCarded([0.5], []), 0);
  assert.ok(core.probBothCarded([0.3, 0.3], [0.3, 0.3]) > core.probBothCarded([0.3], [0.3]));
});
/* BOTH TEAMS TO N+ CARDS.
 *
 * The n = 1 case has a closed form the desk has been shipping for months
 * (1 minus the product of every man staying clean, per side), and the general
 * case walks the Poisson-binomial count distribution instead. If the two ever
 * disagree at n = 1 one of them is wrong, and the tail is the half nobody
 * would notice — so the agreement is asserted, not assumed. */
t('both teams to n+ cards agrees with the closed form at n = 1', () => {
  const home = [0.31, 0.24, 0.18, 0.12], away = [0.27, 0.22, 0.16, 0.09];
  const closed = core.probBothCarded(home, away);
  const walked = core.probBothAtLeast(home, away, 1);
  assert.ok(Math.abs(closed - walked) < 1e-12,
    `n=1 should reproduce probBothCarded exactly, got ${walked} vs ${closed}`);
  // a hand-checkable case: one man each at 0.5, both needing two cards, is
  // impossible — a single player cannot be booked twice in this model
  assert.equal(core.probBothAtLeast([0.5], [0.5], 2), 0);
  // two men each at 0.5 -> each side needs both booked -> 0.25 * 0.25
  assert.ok(Math.abs(core.probBothAtLeast([0.5, 0.5], [0.5, 0.5], 2) - 0.0625) < 1e-12);
});
t('both teams to n+ cards falls as the bar rises', () => {
  const home = [0.4, 0.35, 0.3, 0.25, 0.2], away = [0.38, 0.3, 0.28, 0.22, 0.18];
  const one = core.probBothAtLeast(home, away, 1);
  const two = core.probBothAtLeast(home, away, 2);
  const three = core.probBothAtLeast(home, away, 3);
  assert.ok(one > two && two > three, `should be monotone, got ${one}, ${two}, ${three}`);
  assert.ok(two > 0 && two < 1, `two should be a live probability, got ${two}`);
  // an empty side can never reach any bar
  assert.equal(core.probBothAtLeast(home, [], 2), 0);
  // asking for fewer than one card is asking for one
  assert.equal(core.probBothAtLeast(home, away, 0), one);
});
t('teamCardMarkets assembles the board consistently', () => {
  const home = [0.3, 0.25, 0.2], away = [0.28, 0.2, 0.15];
  const m = core.teamCardMarkets(home, away);
  assert.ok(Math.abs(m.expected - (m.expectedHome + m.expectedAway)) < 1e-9);
  assert.ok(m.over[3.5] < m.over[4.5] === false);           // 4.5 must be the harder line
  assert.ok(m.over[4.5] < m.over[3.5]);
  assert.ok(m.bothCarded > 0 && m.bothCarded < 1);
  // the board's BTC2 is the same walk, not a second implementation
  assert.ok(Math.abs(m.bothTwo - core.probBothAtLeast(home, away, 2)) < 1e-12);
  assert.ok(m.bothTwo < m.bothCarded, 'two cards each cannot beat one card each');
});
t('minute weights spread an XI across the squad', () => {
  const w = core.minuteWeights([3000, 3000, 3000, 300], 11);
  const sum = w.reduce((a, b) => a + b, 0);
  assert.ok(sum <= 11 + 1e-9, `weights should not exceed the XI, got ${sum}`);
  assert.ok(w[0] > w[3], 'a regular starter must outweigh a fringe player');
  assert.ok(w.every((v) => v >= 0 && v <= 1), 'no weight may exceed one full match');
  // an even squad of 11 gives everyone a full match
  const even = core.minuteWeights(new Array(11).fill(2000), 11);
  assert.ok(even.every((v) => Math.abs(v - 1) < 1e-9), 'an even XI should each weight 1');
});
t('minute weights survive missing or zero minutes', () => {
  assert.deepEqual(core.minuteWeights([], 11), []);
  assert.deepEqual(core.minuteWeights([0, 0], 11), [0, 0]);
  assert.ok(core.minuteWeights([null, 100], 11)[0] === 0);
});
t('expected cards land in a realistic range once minutes are applied', () => {
  // 25-man squads, season-average P(card|90) about 0.19 each
  const probs = new Array(25).fill(0.19);
  const mins = new Array(25).fill(0).map((_, i) => (i < 11 ? 3000 : 600));
  const side = core.matchLambdas(probs, mins, 11);
  const m = core.teamCardMarkets(side, side);
  assert.ok(m.expected > 2.5 && m.expected < 6,
    `a match should price near the ~4-card league average, got ${m.expected}`);
  assert.ok(m.over[4.5] > 0.1 && m.over[4.5] < 0.75,
    `O4.5 should be a real market price, got ${m.over[4.5]}`);
});
t('degenerate inputs cannot produce NaN', () => {
  const m = core.teamCardMarkets([null, undefined, NaN, -1], []);
  assert.equal(m.expected, 0);
  assert.equal(m.bothCarded, 0);
  assert.ok(isFinite(m.over[4.5]));
});


console.log('value chart — market side');
/* ── the market side of the value chart ──────────────────────────────
   The chart compares our probability with a bookmaker's price. Everything
   here is about not manufacturing value out of the bookmaker's margin. */
t('marketProb turns a decimal price into its raw implied chance', () => {
  assert.ok(Math.abs(core.marketProb(2.0) - 0.5) < 1e-12);
  assert.ok(Math.abs(core.marketProb(4.0) - 0.25) < 1e-12);
  /* Prices that are not prices. An "evens or shorter than certain" input
     would otherwise read as a probability above 1. */
  assert.equal(core.marketProb(1), null);
  assert.equal(core.marketProb(0.5), null);
  assert.equal(core.marketProb(-2), null);
  assert.equal(core.marketProb('abc'), null);
  assert.equal(core.marketProb(null), null);
});

t('the de-vigged price is always below the raw one', () => {
  const raw = core.marketProb(2.5);
  const fair = core.marketProbDeVig(2.5);
  assert.ok(fair < raw, 'removing margin lowers the implied chance');
  assert.ok(Math.abs(fair - raw * (1 - core.TYPICAL_CARD_MARGIN)) < 1e-12);
  /* A zero margin is a no-op, and a nonsense margin falls back to raw
     rather than producing a negative probability. */
  assert.ok(Math.abs(core.marketProbDeVig(2.5, 0) - raw) < 1e-12);
  assert.ok(Math.abs(core.marketProbDeVig(2.5, 1.5) - raw) < 1e-12);
  assert.ok(Math.abs(core.marketProbDeVig(2.5, -0.2) - raw) < 1e-12);
});

t('valuePoint separates beating the price from beating the bookmaker', () => {
  /* 2.50 implies 40% raw, 37.6% after a 6% margin. The band between them is
     where a model "beats the bookmaker" and still loses money — the exact
     mistake this chart is built to make visible. */
  const inBand = core.valuePoint(0.38, 2.5);
  assert.ok(inBand.edge < 0, 'inside the band the bet is still -EV');
  assert.equal(inBand.beatsPrice, false, '0.38 does not clear the 40% it must beat');
  assert.equal(inBand.insideMargin, true, 'but it does beat the bookmaker’s own 37.6%');

  const below = core.valuePoint(0.36, 2.5);
  assert.equal(below.beatsPrice, false);
  assert.equal(below.insideMargin, false, 'below the de-vigged line there is no disagreement at all');

  const real = core.valuePoint(0.50, 2.5);
  assert.equal(real.beatsPrice, true, 'clearing the raw price is the bar that pays');
  assert.equal(real.insideMargin, false, 'and it is past the band, not in it');
  assert.ok(real.edge > 20, 'a real disagreement shows a large edge');

  /* The two flags are mutually exclusive by construction — a point cannot
     both pay and sit inside the cut. */
  for (const p of [0.30, 0.36, 0.376, 0.38, 0.40, 0.55]) {
    const v = core.valuePoint(p, 2.5);
    assert.ok(!(v.beatsPrice && v.insideMargin), 'flags never both set at p=' + p);
  }
  /* And the edge sign agrees with beatsPrice at every one of them, so the
     chart's colouring and its numbers cannot tell different stories. */
  for (const p of [0.30, 0.39, 0.41, 0.60]) {
    const v = core.valuePoint(p, 2.5);
    assert.equal(v.beatsPrice, v.edge > 0, 'edge sign matches beatsPrice at p=' + p);
  }

  assert.equal(core.valuePoint(null, 2.5), null);
  assert.equal(core.valuePoint(0.4, null), null);
  assert.equal(core.valuePoint(0.4, 1), null);
});

t('valuePoint carries both probabilities so the chart can plot them', () => {
  const v = core.valuePoint(0.42, 2.0);
  assert.ok(Math.abs(v.model - 0.42) < 1e-12);
  assert.ok(Math.abs(v.market - 0.5) < 1e-12);
  assert.ok(v.fair < v.market, 'the fair line sits below the raw market line');
  /* The edge agrees with the existing single-price check, so the chart and
     the row-level value check can never disagree. */
  assert.ok(Math.abs(v.edge - core.edgePct(2.0, 0.42)) < 1e-12);
});

/* ---- the match model (Plsimulator's ratings, ported) ---- */
console.log('match model');

/* A deliberately lopsided toy model: HOME is much the better side, EVEN
   pairs with itself for the symmetry checks. Ratings are the bundle's own
   shape (attack/defence multipliers, per-club home advantage). */
const TOY = {
  constants: { BASE_H: 1.62, BASE_A: 1.32, DC_RHO: -0.0855 },
  teams: {
    HOME: { attack: 1.4, defence: 0.75, home: 1.05 },
    AWAY: { attack: 0.8, defence: 1.25, home: 1.0 },
    EVEN: { attack: 1.0, defence: 1.0, home: 1.0 },
    NOHA: { attack: 1.0, defence: 1.0 },              // no home rating
    BAD: { attack: 0, defence: 1.0 },                 // unusable
  },
};

t('lambdas reproduce the bundle formula, including the one-sided home term', () => {
  const l = core.simLambdas('HOME', 'AWAY', TOY);
  assert.ok(Math.abs(l.lh - 1.62 * 1.4 * 1.25 * 1.05) < 1e-12, `got ${l.lh}`);
  assert.ok(Math.abs(l.la - 1.32 * 0.8 * 0.75) < 1e-12, `got ${l.la}`);
  // The home-advantage rating multiplies the HOME side's rate only — the
  // away side has no equivalent term in the source model.
  const rev = core.simLambdas('AWAY', 'HOME', TOY);
  assert.ok(Math.abs(rev.la - 1.32 * 1.4 * 1.25) < 1e-12, 'away rate carries no home term');
  // A missing home rating is neutral, not zero.
  assert.ok(Math.abs(core.simLambdas('NOHA', 'EVEN', TOY).lh - 1.62) < 1e-12);
});

t('an unrated or unusable club yields null, never an average team', () => {
  assert.equal(core.simLambdas('HOME', 'NOTACLUB', TOY), null);
  assert.equal(core.simLambdas('NOTACLUB', 'HOME', TOY), null);
  assert.equal(core.simLambdas('HOME', 'BAD', TOY), null);
  assert.equal(core.simLambdas('HOME', 'AWAY', null), null);
  assert.equal(core.simLambdas('HOME', 'AWAY', { teams: TOY.teams }), null, 'no constants');
  assert.equal(core.simFixture('HOME', 'NOTACLUB', TOY), null);
});

t('the score grid is a proper distribution, Dixon-Coles or not', () => {
  for (const rho of [0, -0.0855, -0.2]) {
    const g = core.simScoreGrid(1.6, 1.3, rho);
    const sum = g.reduce((s, p) => s + p, 0);
    assert.ok(Math.abs(sum - 1) < 1e-12, `rho ${rho} sums to ${sum}`);
    assert.ok(g.every((p) => p >= 0), `rho ${rho} produced a negative cell`);
  }
  assert.equal(core.simScoreGrid(0, 1.3, -0.0855), null);
  assert.equal(core.simScoreGrid(1.6, -1, -0.0855), null);
});

t('Dixon-Coles lifts the drawn low scores and trims the 1-0s', () => {
  const G = core.SIM_MAX_GOALS + 1;
  const plain = core.simScoreGrid(1.6, 1.3, 0);
  const dc = core.simScoreGrid(1.6, 1.3, -0.0855);
  // Negative rho: 0-0 and 1-1 up, 1-0 and 0-1 down. This is the whole
  // point of the correction and the direction is easy to flip by accident.
  assert.ok(dc[0] > plain[0], '0-0 should rise');
  assert.ok(dc[G + 1] > plain[G + 1], '1-1 should rise');
  assert.ok(dc[G] < plain[G], '1-0 should fall');
  assert.ok(dc[1] < plain[1], '0-1 should fall');
  // ...and nothing outside the 2x2 corner is touched beyond renormalising.
  const ratio = dc[3 * G + 2] / plain[3 * G + 2];
  for (const [h, a] of [[2, 2], [3, 0], [0, 4], [5, 5]]) {
    assert.ok(Math.abs(dc[h * G + a] / plain[h * G + a] - ratio) < 1e-12,
      `${h}-${a} was adjusted, only the four low scores should be`);
  }
});

t('outcome probabilities sum to one and rank the sides correctly', () => {
  const r = core.simFixture('HOME', 'AWAY', TOY);
  assert.ok(Math.abs(r.home + r.draw + r.away - 1) < 1e-12);
  assert.ok(r.home > r.away, 'the stronger side at home should be favourite');
  assert.ok(r.close > 0 && r.close < 1);
  /* Expected goals come back out of the grid near the input rates but not
     exactly on them. The gap is the 10-goal cap, which the source model
     has too: the discarded tail is renormalised across the grid, so the
     recovered mean sits a little under the rate. It is ~1e-7 at lambda 1,
     ~2e-4 at 2.3 and ~2e-3 at 3 — the last being this toy's deliberately
     extreme home rate, and still above anything the real bundle produces
     (max ~2.99, P(11+ goals) ~3e-4). Asserted as a bound rather than an
     equality so a genuine arithmetic slip still fails. */
  assert.ok(Math.abs(r.expH - r.lh) < 0.005, `expH ${r.expH} vs lh ${r.lh}`);
  assert.ok(Math.abs(r.expA - r.la) < 0.005, `expA ${r.expA} vs la ${r.la}`);
  const tame = core.simScoreGrid(1.0, 1.0, 0);
  const G0 = core.SIM_MAX_GOALS + 1;
  let mean = 0;
  for (let h = 0; h < G0; h++) for (let a = 0; a < G0; a++) mean += h * tame[h * G0 + a];
  assert.ok(Math.abs(mean - 1) < 1e-6, `truncation should vanish at low rates, got ${mean}`);
});

t('an evenly matched pair is symmetric apart from home advantage', () => {
  const r = core.simFixture('EVEN', 'EVEN', TOY);
  // Same ratings both sides, but BASE_H > BASE_A, so home is still ahead.
  assert.ok(r.home > r.away, 'home advantage survives equal ratings');
  const flat = core.simFixture('EVEN', 'EVEN',
    { constants: { BASE_H: 1.4, BASE_A: 1.4, DC_RHO: 0 }, teams: TOY.teams });
  assert.ok(Math.abs(flat.home - flat.away) < 1e-12, 'no home edge -> perfectly symmetric');
});

t('closeness is P(margin <= 1), not P(draw)', () => {
  const r = core.simFixture('EVEN', 'EVEN', TOY);
  assert.ok(r.close > r.draw, 'a one-goal win is close too');
  // A mismatch projects less tight than a level game.
  const mismatch = core.simFixture('HOME', 'AWAY', TOY);
  assert.ok(mismatch.close < r.close, 'a lopsided fixture is less likely to stay tight');
});

t('result share is win plus half the draw, and the two sides sum to one', () => {
  const r = core.simFixture('HOME', 'AWAY', TOY);
  const sh = core.simResultShare(r, true), sa = core.simResultShare(r, false);
  assert.ok(Math.abs(sh - (r.home + r.draw / 2)) < 1e-12);
  assert.ok(Math.abs(sh + sa - 1) < 1e-12, 'shares must sum to 1 or the factor drifts');
  assert.equal(core.simResultShare(null, true), null);
  assert.equal(core.simResultShare(r, null), null);
});

t('the chase factor reads the right side of the fixture', () => {
  const r = core.simFixture('HOME', 'AWAY', TOY);
  // The favourite's players are damped, the underdog's marked up. Getting
  // these the wrong way round is the one bug that would look plausible.
  assert.ok(core.chaseFactor(core.simResultShare(r, true)) < 1, 'favourite damped');
  assert.ok(core.chaseFactor(core.simResultShare(r, false)) > 1, 'underdog marked up');
});

t('an even fixture is neutral and no fixture drifts the league total', () => {
  /* The bug this exists to prevent: a raw win probability averages ~0.37
     across a three-way market, so feeding it marks up BOTH sides of an
     even game and lifts every player's number league-wide on no evidence.
     Result share is 0.5 on a level fixture and mirrored on any other. */
  const even = core.simFixture('EVEN', 'EVEN',
    { constants: { BASE_H: 1.4, BASE_A: 1.4, DC_RHO: -0.0855 }, teams: TOY.teams });
  assert.ok(Math.abs(core.simResultShare(even, true) - 0.5) < 1e-12, 'level game is 0.5');
  assert.equal(core.chaseFactor(core.simResultShare(even, true)), 1);
  assert.equal(core.chaseFactor(core.simResultShare(even, false)), 1);
  // The raw win probability would NOT have been neutral here.
  assert.ok(core.chaseFactor(even.home) > 1 && core.chaseFactor(even.away) > 1,
    'sanity: raw win probabilities really do mark up both sides');
  // Mirror images about 1.0 on a mismatch, so the sides trade risk rather
  // than the fixture gaining any.
  const r = core.simFixture('HOME', 'AWAY', TOY);
  const ch = core.chaseFactor(core.simResultShare(r, true));
  const ca = core.chaseFactor(core.simResultShare(r, false));
  assert.ok(Math.abs((ch - 1) + (ca - 1)) < 1e-12, `${ch} and ${ca} are not mirrored`);
});

t('contextProb takes the chase factor and stays backward compatible', () => {
  const base = 0.4;
  // A caller that predates the wiring gets exactly the old answer.
  assert.equal(core.contextProb(base, 1.1, 1, 1.08),
    core.contextProb(base, 1.1, 1, 1.08, null));
  assert.equal(core.contextProb(base, 1.1, 1, 1.08),
    core.contextProb(base, 1.1, 1, 1.08, 1));
  const up = core.contextProb(base, 1, 1, 1, 1.2);
  const down = core.contextProb(base, 1, 1, 1, 0.85);
  assert.ok(up > base && down < base);
  // It multiplies the ODDS, so it cannot run away with the probability.
  assert.ok(up < 0.5, `odds-scale, not probability-scale: got ${up}`);
  assert.ok(Math.abs(up - core.scaleOdds(base, 1.2)) < 1e-12);
});

/* The port is only worth having if it agrees with the thing it ported.
   These ratings and expectations are a FROZEN snapshot: the ratings are
   Arsenal's and Manchester City's from bundle 2026-08-03, and the expected
   numbers were produced by running Plsimulator's own plsim/models.py over
   them (score_grid + outcome_probs, Dixon-Coles on). Frozen deliberately —
   the shipped bundle is refitted weekly, so pinning against live ratings
   would fail every refresh and prove nothing. If this test breaks, the
   arithmetic diverged from the source model. */
t('reproduces Plsimulator\'s own output to floating point', () => {
  const FROZEN = {
    constants: { BASE_H: 1.62, BASE_A: 1.32, DC_RHO: -0.0855 },
    teams: {
      ARS: { attack: 1.1776, defence: 0.7208, home: 0.9813 },
      MCI: { attack: 1.2418, defence: 0.8448, home: 1.0333 },
    },
  };
  const EXPECTED = {
    lh: 1.5814975212748799,
    la: 1.1815180608000002,
    home: 0.45607721539757345,
    draw: 0.26912931485177327,
    away: 0.2747934697506538,
    close: 0.6456233260289104,
  };
  const r = core.simFixture('ARS', 'MCI', FROZEN);
  for (const [k, want] of Object.entries(EXPECTED)) {
    assert.ok(Math.abs(r[k] - want) < 1e-12,
      `${k}: got ${r[k]}, plsim/models.py gives ${want}`);
  }
});

/* The shipped bundle, not a toy: catches a rekeyed or truncated data file
   as well as arithmetic. */
console.log('shipped sim model');
const simSrc = readFileSync(join(root, 'data', 'sim_model.js'), 'utf8');
const simCtx = {};
vm.createContext(simCtx);
vm.runInContext(simSrc, simCtx);
const SIM_MODEL = vm.runInContext('SIM_MODEL', simCtx);

t('data/sim_model.js rates every club with sane ratings', () => {
  assert.ok(SIM_MODEL && SIM_MODEL.teams, 'no teams in the bundle');
  const codes = Object.keys(SIM_MODEL.teams);
  assert.equal(codes.length, 20, `expected 20 rated clubs, got ${codes.length}`);
  for (const c of codes) {
    const t2 = SIM_MODEL.teams[c];
    assert.ok(t2.attack > 0.3 && t2.attack < 3, `${c} attack ${t2.attack} out of range`);
    assert.ok(t2.defence > 0.3 && t2.defence < 3, `${c} defence ${t2.defence} out of range`);
    assert.ok(t2.home > 0.5 && t2.home < 2, `${c} home ${t2.home} out of range`);
  }
  assert.ok(SIM_MODEL.constants.BASE_H > SIM_MODEL.constants.BASE_A,
    'home scoring base should exceed away');
  assert.ok(SIM_MODEL.constants.DC_RHO < 0, 'fitted Dixon-Coles rho is negative');
});

t('every club pair prices, and every fixture stays inside the clamps', () => {
  const codes = Object.keys(SIM_MODEL.teams);
  let n = 0;
  for (const h of codes) {
    for (const a of codes) {
      if (h === a) continue;
      const r = core.simFixture(h, a, SIM_MODEL);
      assert.ok(r, `${h} v ${a} did not price`);
      assert.ok(Math.abs(r.home + r.draw + r.away - 1) < 1e-9, `${h} v ${a} probabilities`);
      const cf = core.chaseFactor(core.simResultShare(r, true));
      assert.ok(cf >= 0.85 && cf <= 1.20, `${h} v ${a} chase factor ${cf} escaped the clamp`);
      assert.ok(r.lh > 0.2 && r.lh < 5, `${h} v ${a} home rate ${r.lh} implausible`);
      assert.ok(r.la > 0.2 && r.la < 5, `${h} v ${a} away rate ${r.la} implausible`);
      n++;
    }
  }
  assert.equal(n, 380, `expected 380 ordered pairs, priced ${n}`);
});


/* ---- suspension watch ---------------------------------------------------- */
console.log('suspension watch');

t('a cycle position is the total MODULO the threshold, not the total', () => {
  /* The load-bearing one. A player on ten cautions has served two bans and is
     on zero again — not eight tenths of the way to a third. Reading the raw
     total would put him at the top of a watchlist he is not on. */
  assert.deepEqual(core.suspensionCycle(0, 5), { inCycle: 0, need: 5, served: 0 });
  assert.deepEqual(core.suspensionCycle(4, 5), { inCycle: 4, need: 1, served: 0 });
  assert.deepEqual(core.suspensionCycle(5, 5), { inCycle: 0, need: 5, served: 1 });
  assert.deepEqual(core.suspensionCycle(9, 5), { inCycle: 4, need: 1, served: 1 });
  assert.deepEqual(core.suspensionCycle(12, 5), { inCycle: 2, need: 3, served: 2 });
  /* Spain has no ladder: every cycle needs the same five and costs the same
     one match, so `need` never depends on how many have been served. */
  for (const total of [0, 5, 10, 15, 20]) {
    assert.equal(core.suspensionCycle(total, 5).need, 5);
  }
});

t('cycle rejects junk rather than inventing a position', () => {
  for (const bad of [[null, 5], [-1, 5], [3, 0], [3, null], ['x', 5]]) {
    assert.equal(core.suspensionCycle(bad[0], bad[1]), null, JSON.stringify(bad));
  }
});

t('P(reaching the next ban) rises with rate, minutes and horizon', () => {
  const base = core.pCardsAtLeast(0.30, 90, 3, 1);
  assert.ok(base > 0 && base < 1, base);
  assert.ok(core.pCardsAtLeast(0.60, 90, 3, 1) > base, 'a higher rate must be likelier');
  assert.ok(core.pCardsAtLeast(0.30, 90, 6, 1) > base, 'a longer horizon must be likelier');
  assert.ok(core.pCardsAtLeast(0.30, 45, 3, 1) < base, 'half a match must be less likely');
  assert.ok(core.pCardsAtLeast(0.30, 90, 3, 3) < base, 'needing three must be less likely than one');
});

t('needing none is certain, and a rateless player is never at risk', () => {
  assert.equal(core.pCardsAtLeast(0.3, 90, 3, 0), 1);
  assert.equal(core.pCardsAtLeast(0, 90, 38, 1), 0);
  for (const bad of [[null, 90, 3, 1], [0.3, 0, 3, 1], [0.3, 90, 0, 1], [-1, 90, 3, 1]]) {
    assert.equal(core.pCardsAtLeast(...bad), null, JSON.stringify(bad));
  }
});

t('P matches the Poisson tail by hand', () => {
  /* lambda = 0.5 x 1 match. P(at least one) = 1 - e^-0.5 = 0.393469... */
  assert.ok(Math.abs(core.pCardsAtLeast(0.5, 90, 1, 1) - (1 - Math.exp(-0.5))) < 1e-12);
  /* Needing two at lambda 2: 1 - e^-2(1 + 2) = 0.593994... */
  const want = 1 - Math.exp(-2) * (1 + 2);
  assert.ok(Math.abs(core.pCardsAtLeast(2, 90, 1, 2) - want) < 1e-12);
});

t('a full season makes a ban near-certain for a regular starter', () => {
  /* Spain bans at every fifth caution with no matchday gate, so a regular on
     a typical defender's rate should be odds-on across a season. If this ever
     reads low the strip is not worth showing. */
  const p = core.pCardsAtLeast(0.30, 90, 38, 5);
  assert.ok(p > 0.9, `a season-long ban chance of ${p} is implausibly low`);
});


console.log('suspension schemes');

const LADDER = { kind: 'ladder', cumulative: true, review: 20,
  rungs: [{ at: 5, ban: 1, by: 19 }, { at: 10, ban: 2, by: 37 },
          { at: 15, ban: 3, by: null }] };
const CYCLE = { kind: 'cycle', at: 5, ban: 1 };

t('a ladder escalates and a cycle does not', () => {
  assert.equal(core.nextSuspension(4, 10, LADDER).ban, 1);
  assert.equal(core.nextSuspension(9, 30, LADDER).ban, 2, 'the ten-rung is TWO matches');
  assert.equal(core.nextSuspension(14, 40, LADDER).ban, 3);
  /* Spain never escalates, whatever the total. */
  for (const total of [4, 9, 14, 19]) {
    assert.equal(core.nextSuspension(total, 40, CYCLE).ban, 1);
    assert.equal(core.nextSuspension(total, 40, CYCLE).need, 1);
  }
});

t('a passed gate kills its rung and the watch moves on', () => {
  /* Four cautions before the club's 19th match is one booking from a ban. */
  const early = core.nextSuspension(4, 10, LADDER);
  assert.equal(early.at, 5);
  assert.equal(early.need, 1);
  /* The same four cautions AFTER the 19th cannot reach that rung at all, so
     the target becomes ten — six away, for two matches. Counting him toward
     five would be a ban that cannot happen. */
  const late = core.nextSuspension(4, 22, LADDER);
  assert.equal(late.at, 10);
  assert.equal(late.need, 6);
  assert.equal(late.ban, 2);
});

t('the ladder is cumulative — a served ban does not reset it', () => {
  /* Spain resets: ten cautions means two bans served and five to go again. */
  assert.equal(core.nextSuspension(10, 30, CYCLE).need, 5);
  assert.equal(core.nextSuspension(10, 30, CYCLE).served, 2);
  /* England does not: ten means the 5- and 10-rungs are spent and fifteen is
     next, five away. Resetting here would forgive a player mid-ladder. */
  const eng = core.nextSuspension(10, 30, LADDER);
  assert.equal(eng.at, 15);
  assert.equal(eng.need, 5);
  assert.equal(eng.served, 2);
});

t('past every rung, a player is dead to accumulation rather than mispriced', () => {
  const done = core.nextSuspension(16, 44, LADDER);
  assert.equal(done.dead, true);
  assert.equal(done.need, null, 'a dead player must not carry a threshold');
  /* And a cycle is never dead — there is always another five. */
  assert.equal(core.nextSuspension(40, 44, CYCLE).dead, false);
});

t('unknown counts and missing schemes yield null, never a default', () => {
  assert.equal(core.nextSuspension(null, 10, LADDER), null);
  assert.equal(core.nextSuspension(4, 10, null), null);
  assert.equal(core.nextSuspension(-1, 10, LADDER), null);
});

/* ---- booking points ----------------------------------------------------
 * The market bookmakers actually price for cards: 10 a yellow, 25 a red.
 * These check the ARITHMETIC and the SHAPE, not just that a number comes
 * back — a points market that is merely "10 times the cards" would pass a
 * smoke test and be wrong the moment a red is possible. */

t('points are 10 a yellow and 25 a red, and reds are priced from the referee', () => {
  const ps = [0.5, 0.5, 0.5, 0.5];           // exactly 2 expected yellows
  assert.equal(core.expectedPoints(ps, 0), 20, 'no reds: 2 yellows is 20 points');
  /* A red rate of 0.4 adds 25 x 0.4 = 10. If this returns 20 the referee's
     red rate is being ignored, which is the whole point of the market. */
  assert.equal(core.expectedPoints(ps, 0.4), 30);
  assert.equal(core.expectedPoints(ps, null), 20, 'no rate is no reds, not NaN');
});

t('the points distribution is a real distribution and lands only on 10s and 25s', () => {
  const d = core.bookingPointsDist([0.5, 0.5], 0.3);
  const total = d.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `points distribution sums to ${total}, not 1`);
  /* Every reachable total is 10y + 25r, so nothing may land on a value that
     cannot be made from yellows and reds — 5 and 15 are impossible. */
  for (let k = 0; k < d.length; k++) {
    if (d[k] <= 1e-12) continue;
    let ok = false;
    for (let y = 0; y <= 2 && !ok; y++) {
      for (let r = 0; r <= 6 && !ok; r++) if (10 * y + 25 * r === k) ok = true;
    }
    assert.ok(ok, `points distribution puts mass on ${k}, which no yellow/red combination makes`);
  }
});

t('the mean of the distribution equals the closed-form expectation', () => {
  /* Independent check: if the convolution is wrong, these disagree. */
  const ps = [0.6, 0.4, 0.35, 0.2, 0.15], lam = 0.25;
  const d = core.bookingPointsDist(ps, lam);
  const mean = d.reduce((s, v, k) => s + v * k, 0);
  /* Tolerance 1e-4, not 1e-9. The closed form uses the exact rate; the
     distribution uses the Poisson truncated at six reds and normalised, so
     the two differ by the mass past that point — 1.6e-6 at this rate, which
     is the truncation working, not a defect. Kept tight enough to matter: a
     genuinely wrong convolution is out by whole points, not millionths. */
  assert.ok(Math.abs(mean - core.expectedPoints(ps, lam)) < 1e-4,
    `distribution mean ${mean} vs closed form ${core.expectedPoints(ps, lam)}`);
});

t('over lines fall as the line rises, and a red rate can only push them up', () => {
  const ps = [0.5, 0.45, 0.4, 0.35, 0.3, 0.25];
  const a = core.probOverPoints(ps, 0.2, 35.5);
  const b = core.probOverPoints(ps, 0.2, 45.5);
  const c = core.probOverPoints(ps, 0.2, 55.5);
  assert.ok(a > b && b > c, `over lines not monotonic: ${a}, ${b}, ${c}`);
  assert.ok(core.probOverPoints(ps, 0.6, 45.5) > core.probOverPoints(ps, 0, 45.5),
    'a higher red rate must raise the chance of clearing a points line');
});

t('a .5 line reads against the real granularity, not as a smooth quantity', () => {
  /* Two certain yellows and no reds is exactly 20 points. Over 15.5 must be
     certain and over 20.5 impossible — a naive continuous treatment would
     put mass either side of 20. */
  const certain = [0.999, 0.999];
  assert.ok(core.probOverPoints(certain, 0, 15.5) > 0.99);
  assert.ok(core.probOverPoints(certain, 0, 20.5) < 0.01);
});

t('a whole-number line is strictly greater, so an exact hit is not a win', () => {
  /* Same convention as probOverCards. It matters here more than there,
     because points land on multiples of 5 and hitting a line EXACTLY is
     common — two yellows is exactly 20. "Over 20" must not pay on 20.
     Rounding the line instead of flooring-and-adding-one gets .5 lines
     right and every whole line wrong, which no .5-only test would catch. */
  const certain = [0.999, 0.999];                       // exactly 20 points
  assert.ok(core.probOverPoints(certain, 0, 20) < 0.01,
    'over 20 paid out on exactly 20 points');
  assert.ok(core.probOverPoints(certain, 0, 19) > 0.99,
    'over 19 must be won by 20 points');
});

t('the league red rate is weighted by matches, so a 3-game referee cannot swing it', () => {
  const refs = [{ matches: 30, red: 0.1 }, { matches: 3, red: 2.0 }];
  const w = core.leagueRedRate(refs);
  const unweighted = (0.1 + 2.0) / 2;
  assert.ok(w < 0.35, `weighted rate ${w} looks unweighted`);
  assert.ok(Math.abs(w - unweighted) > 0.5, 'weighting made no difference');
  assert.equal(core.leagueRedRate([]), 0);
  assert.equal(core.leagueRedRate(null), 0);
});

t('the board reports the rate it priced with, so the number can be checked', () => {
  const m = core.bookingPointsMarkets([0.5, 0.5], [0.5, 0.5], 0.24, [35.5]);
  assert.equal(m.lambdaRed, 0.24);
  assert.equal(m.expected, 26);                 // 4 x 0.5 = 2 yellows = 20, + 25 x 0.24 = 6
  assert.ok(m.over[35.5] > 0 && m.over[35.5] < 1);
});

/* ---- the two-stage hazard, one definition for three desks --------------- */
/* build-model.mjs bakes this into data/model.js for the Premier League; the
   Championship and La Liga have no model file and derive it at runtime from
   the same function. Two implementations of one line is how the three desks
   would go back to pricing different things. */
t('the shared hazard reproduces the Premier League constant it was lifted from', () => {
  const model = require('../data/model.js');
  const g = {};
  new Function('globalThis', readFileSync(join(root, 'data', 'pl_data.js'), 'utf8')
    + ';globalThis.P=PL_PLAYERS;')(g);
  const rated = g.P.filter((p) => p.y != null && p.f != null);
  const cal = core.calibrate(g.P);
  const foulLeague = core.leagueRate90(rated, 'f');
  const hz = core.twoStageHazard(cal.baseRate, foulLeague);
  /* Within a thousandth: build-model.mjs rounds to 4dp and filters `rated`
     the same way, so anything wider means the two have drifted apart. */
  assert.ok(Math.abs(hz - model.twoStage.baseHazard) < 0.001,
    `shared hazard ${hz.toFixed(4)} vs shipped ${model.twoStage.baseHazard} — ` +
    'the runtime derivation and the baked one no longer agree, so the ' +
    'Championship and La Liga are pricing fouls on a different definition ' +
    'from the Premier League');
});

t('the hazard refuses inputs that would make it meaningless', () => {
  assert.equal(core.twoStageHazard(0, 1), null);        // no base rate
  assert.equal(core.twoStageHazard(1, 1), null);        // certainty -> infinite
  assert.equal(core.twoStageHazard(0.17, 0), null);     // no foul exposure
  assert.equal(core.twoStageHazard(0.17, null), null);
  /* And it is monotonic in the way the maths requires: more fouls for the
     same card rate means each foul carries LESS hazard. */
  assert.ok(core.twoStageHazard(0.17, 2) < core.twoStageHazard(0.17, 1));
});

t('leagueRate90 weights by minutes, not by heads', () => {
  const rows = [{ min: 3000, f: 1.0 }, { min: 90, f: 9.0 }];
  const w = core.leagueRate90(rows, 'f');
  assert.ok(w < 1.3, `minutes-weighted mean ${w} looks like a per-player mean`);
  assert.equal(core.leagueRate90([], 'f'), null);
  assert.equal(core.leagueRate90(null, 'f'), null);
  /* A missing rate is skipped, not read as nought — the whole reason fouls
     won was null rather than zero on 456 rows. */
  assert.equal(core.leagueRate90([{ min: 900, fw: null }, { min: 900, fw: 2 }], 'fw'), 2);
});

/* ---- match fouls: a sum of player Negative Binomials ------------------- */
t('summing player fouls tightens the match total, it does not widen it', () => {
  const mus = Array(22).fill(1.0);
  const s = core.sumNegBin(mus, 6);
  assert.equal(Math.round(s.mu), 22);
  const sd = Math.sqrt(s.mu + (s.mu * s.mu) / s.size);
  /* Reusing the PLAYER-level dispersion at match level would give sd ~10 on a
     22-foul match, which prices the tails at about twice their real width.
     Twenty-odd fouls from twenty-two players is a much tighter thing than one
     player's two. */
  const naive = Math.sqrt(22 + (22 * 22) / 6);
  assert.ok(sd < naive / 1.5,
    `match sd ${sd.toFixed(2)} is not meaningfully tighter than the naive ` +
    `${naive.toFixed(2)} — the moment match is not being applied`);
  assert.ok(sd > 3 && sd < 7, `match sd ${sd.toFixed(2)} is outside anything plausible`);
});

t('the match total is exact in the mean whatever the split', () => {
  /* Moment matching is approximate in SHAPE and exact in mean and variance.
     The mean is the one a reader can check against a league average, so it
     must not drift with how the fouls are distributed between players. */
  const even = core.sumNegBin(Array(20).fill(1.1), 6);
  const lumpy = core.sumNegBin([8, 5, 3, 2, 2, 1, 1].concat(Array(13).fill(0)), 6);
  assert.ok(Math.abs(even.mu - 22) < 1e-9);
  assert.ok(Math.abs(lumpy.mu - 22) < 1e-9);
  /* And the lumpier split IS wider — same mean, more variance. */
  const sd = (d) => Math.sqrt(d.mu + (d.mu * d.mu) / d.size);
  assert.ok(sd(lumpy) > sd(even),
    'a total concentrated in a few players should be more variable, not less');
});

t('sumNegBin refuses input it cannot describe', () => {
  assert.equal(core.sumNegBin([], 6), null);
  assert.equal(core.sumNegBin(null, 6), null);
  assert.equal(core.sumNegBin([0, 0], 6), null);
  /* Under-dispersed input falls back to Poisson rather than a negative size,
     which would make every tail probability NaN. */
  const d = core.sumNegBin([2], Infinity);
  assert.ok(d.size === Infinity || d.size > 1e6, `size ${d.size} is not Poisson-like`);
  assert.ok(core.nbTailProb(d.mu, d.size, 2) > 0);
});

console.log(`\n${passed} tests passed`);

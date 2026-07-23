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

console.log(`\n${passed} tests passed`);

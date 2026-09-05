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

/* ---- this season's rates ----
   The rule that decides whether a displayed rate is 2026-27 or 2025-26. It
   governs BOTH halves of the risk score, which is the point: the desk spent a
   season with live yellows and frozen fouls, and nothing on the page said so. */
console.log('liveRate');
t('below the minutes floor the baked rate is returned untouched', () => {
  assert.deepEqual(core.liveRate(1.92, 3, 300), { rate: 1.92, live: false });
  assert.deepEqual(core.liveRate(1.92, 0, 0), { rate: 1.92, live: false });
});
t('at or past the floor it switches to the rate this season has produced', () => {
  const r = core.liveRate(1.92, 10, 450);
  assert.equal(r.live, true);
  assert.equal(r.rate, 2);                       // 10 fouls in 5 full matches
  assert.equal(core.liveRate(1.92, 21, 900).rate, 2.1);
});
t('the floor is the same 450 the yellow half uses', () => {
  assert.equal(core.MIN_LIVE_MINUTES, 450);
  assert.equal(core.liveRate(1, 5, 449).live, false);
  assert.equal(core.liveRate(1, 5, 450).live, true);
});
t('a genuine zero this season is kept, not read as no data', () => {
  // A goalkeeper with 3330 minutes and no fouls is the shipped case: player
  // id 1 in the 2025-26 harvest. Falling back to a baked rate here would
  // invent fouls he did not commit.
  assert.deepEqual(core.liveRate(0.4, 0, 3330), { rate: 0, live: true });
});
t('no baked rate and too few minutes stays null rather than becoming zero', () => {
  // The promoted-club case: a player the 2025-26 harvest never saw. An unknown
  // rate must not enter the risk score as a clean one.
  assert.deepEqual(core.liveRate(null, 2, 120), { rate: null, live: false });
});
t('no baked rate but enough minutes IS a rate — this is how promoted clubs fill', () => {
  assert.deepEqual(core.liveRate(null, 12, 900), { rate: 1.2, live: true });
});

console.log('per90');
t('converts a count and minutes to a per-90 rate', () => {
  assert.equal(core.per90(9, 900), 0.9);
  assert.equal(core.per90(0, 900), 0);
});
t('refuses zero, negative or non-finite exposure instead of dividing by it', () => {
  assert.equal(core.per90(5, 0), null);
  assert.equal(core.per90(5, null), null);
  assert.equal(core.per90(5, -90), null);
});

/* ---- the id join ----
   core_insights.js is keyed by FPL player id and so is the bootstrap, so the
   join is an integer lookup and there is no shape guard that can see "correct
   data about the wrong person". The vendored web name is the check. */
console.log('joinLooksRight');
t('accepts the same player written two ways', () => {
  assert.equal(core.joinLooksRight('Bruno G.', 'Bruno G.'), true);
  assert.equal(core.joinLooksRight('Gabriel', 'Gabriel'), true);
  assert.equal(core.joinLooksRight('Saliba', 'Saliba'), true);
  // Punctuation and accents differ between the two feeds.
  assert.equal(core.joinLooksRight('Nørgaard', 'Norgaard'), true);
  assert.equal(core.joinLooksRight("O'Riley", 'O Riley'), true);
});
t('accepts an abbreviation of the same name, either way round', () => {
  assert.equal(core.joinLooksRight('Bruno G.', 'Bruno Guimarães'), true);
  assert.equal(core.joinLooksRight('Alexander-Arnold', 'Alexander'), true);
});
t('rejects two different players, which is the whole job', () => {
  assert.equal(core.joinLooksRight('Gabriel', 'Saliba'), false);
  assert.equal(core.joinLooksRight('Saka', 'Martinelli'), false);
  // Same club, same position, similar length — a renumbering by one would
  // look exactly like this and must not pass.
  assert.equal(core.joinLooksRight('Raya', 'Rice'), false);
});
t('a missing name on either side is not a match', () => {
  assert.equal(core.joinLooksRight('', 'Saka'), false);
  assert.equal(core.joinLooksRight('Saka', ''), false);
  assert.equal(core.joinLooksRight(null, undefined), false);
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
  /* A REAL SQUAD, which this fixture was not. It used to be four players —
     three regulars and a fringe — and asserted the fringe weighed less. With
     only four men to cover eleven places every one of them plays the whole
     match, so once the cap redistributes what it clips they all weigh 1 and
     the ordering is gone. That is the correct answer to a degenerate input,
     not a regression: the old code returned 3.355 players' worth of football
     for a club that plainly fields four. The ordering claim needs a squad
     where the fringe player has somewhere to sit. */
  const mins = [3000, 3000, 3000, 2900, 2800, 2700, 2600, 2400, 2200, 2000, 1800, 300];
  const w = core.minuteWeights(mins, 11);
  const sum = w.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 11) < 1e-9, `a squad of twelve spreads exactly 11, got ${sum}`);
  assert.ok(w[0] > w[11], 'a regular starter must outweigh a fringe player');
  assert.ok(w.every((v) => v >= 0 && v <= 1), 'no weight may exceed one full match');
  // an even squad of 11 gives everyone a full match
  const even = core.minuteWeights(new Array(11).fill(2000), 11);
  assert.ok(even.every((v) => Math.abs(v - 1) < 1e-9), 'an even XI should each weight 1');
});
t('the cap redistributes what it clips instead of dropping it', () => {
  /* THE BUG THIS EXISTS FOR. Clipping anyone over a full match is right;
     throwing away the football they gave up is not. It made the desks price
     clubs off less than eleven players' worth of a match — Bournemouth at
     9.667, live, for months — and it stayed invisible while squads carried
     forty players, because no share reached the cap. */
  const hog = core.minuteWeights([3420, 100, 100, 100, 100, 100, 100, 100,
                                  100, 100, 100, 100], 11);
  assert.ok(Math.abs(hog.reduce((a, b) => a + b, 0) - 11) < 1e-9,
    'one dominant player must not cost the club the football he could not play');
  assert.ok(Math.abs(hog[0] - 1) < 1e-9, 'and he still plays at most one match');

  /* FEWER RATED PLAYERS THAN PLACES is arithmetic, not a fault: four men
     cannot cover eleven, and the honest answer is four full matches. */
  const thin = core.minuteWeights([3000, 3000, 3000, 300], 11);
  assert.ok(Math.abs(thin.reduce((a, b) => a + b, 0) - 4) < 1e-9,
    'a four-man squad spreads four full matches, not three and a third');
  assert.ok(thin.every((v) => Math.abs(v - 1) < 1e-9));
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

/* ---- accas over match markets ------------------------------------------ */

t('a board offers its markets as legs, most likely first', () => {
  const board = core.teamCardMarkets([0.32, 0.26, 0.2, 0.15], [0.3, 0.24, 0.18, 0.12]);
  const legs = core.matchLegOptions(board);
  assert.ok(legs.length >= 4, `expected the four card markets, got ${legs.length}`);
  for (let i = 1; i < legs.length; i++) {
    assert.ok(legs[i - 1].prob >= legs[i].prob,
      `legs are out of order at ${i}: ${legs[i - 1].prob} then ${legs[i].prob}`);
  }
  /* Every leg names a market and reads a live probability — a leg at 0 cannot
     be won and a leg at 1 pays nothing, and either would poison the product. */
  for (const l of legs) {
    assert.ok(l.market && l.label, 'a leg with no market or no label');
    assert.ok(l.prob > 0 && l.prob < 1, `leg ${l.market} is at ${l.prob}`);
  }
  /* The markets are the board's own numbers, not a second derivation. */
  const btc = legs.find((l) => l.market === 'BTC');
  assert.equal(btc.prob, board.bothCarded);
  assert.equal(legs.find((l) => l.market === 'BTC2').prob, board.bothTwo);
  assert.equal(legs.find((l) => l.market === 'O3.5').prob, board.over[3.5]);
  assert.deepStrictEqual(core.matchLegOptions(null), []);
  /* A certainty and an impossibility are both dropped rather than shipped. */
  assert.deepStrictEqual(
    core.matchLegOptions({ bothCarded: 1, bothTwo: 0, over: { 3.5: 0.4 } })
      .map((l) => l.market), ['O3.5']);
});

t('an acca multiplies its legs and the margin compounds', () => {
  const p = core.accaPrice([0.8, 0.5], 0);
  assert.ok(Math.abs(p.prob - 0.4) < 1e-12);
  assert.ok(Math.abs(p.fairOdds - 2.5) < 1e-12, `fair odds should be 1/0.4, got ${p.fairOdds}`);
  // with no margin the priced odds ARE the fair odds
  assert.ok(Math.abs(p.pricedOdds - p.fairOdds) < 1e-12);
  assert.ok(Math.abs(p.marginDrag) < 1e-12);
  // and with one, the drag is 1 - (1-m)^legs, compounding per leg
  const m = 0.06;
  const two = core.accaPrice([0.8, 0.5], m);
  const three = core.accaPrice([0.8, 0.5, 0.5], m);
  assert.ok(Math.abs(two.marginDrag - (1 - Math.pow(1 - m, 2))) < 1e-12,
    `two-leg drag should be ${1 - Math.pow(1 - m, 2)}, got ${two.marginDrag}`);
  assert.ok(Math.abs(three.marginDrag - (1 - Math.pow(1 - m, 3))) < 1e-12);
  assert.ok(three.marginDrag > two.marginDrag,
    'the argument against a fourth leg is that the drag grows — if it does ' +
    'not, the page is telling the reader something untrue');
  // a longer acca is longer odds and less likely, always
  assert.ok(three.prob < two.prob && three.fairOdds > two.fairOdds);
});

t('an acca refuses to be a single, and reads legs or bare numbers', () => {
  assert.equal(core.accaPrice([0.8]), null, 'one leg is a single, not an acca');
  assert.equal(core.accaPrice([]), null);
  assert.equal(core.accaPrice(null), null);
  // a certainty and an impossibility are dropped, so two legs can become one
  assert.equal(core.accaPrice([0.8, 1]), null);
  assert.equal(core.accaPrice([0.8, 0]), null);
  // objects with a prob and bare numbers price identically
  const a = core.accaPrice([{ prob: 0.7 }, { prob: 0.6 }]);
  const b = core.accaPrice([0.7, 0.6]);
  assert.deepStrictEqual(a, b);
  // the default margin is the app's, not zero — a page that forgets to pass
  // one must not silently advertise fair odds as available
  assert.ok(core.accaPrice([0.7, 0.6]).marginDrag > 0);
  assert.ok(Math.abs(core.accaPrice([0.7, 0.6]).marginDrag
    - (1 - Math.pow(1 - core.TYPICAL_CARD_MARGIN, 2))) < 1e-12);
});

t('the goals markets come off the same grid as the result', () => {
  /* A toy fixture, so the expected numbers can be recounted by hand rather
     than copied from what the code happened to print. */
  const grid = core.simScoreGrid(1.6, 1.2, -0.0855, core.SIM_MAX_GOALS);
  const o = core.simOutcomes(grid, core.SIM_MAX_GOALS);
  const G = core.SIM_MAX_GOALS + 1;
  let btts = 0, o15 = 0;
  for (let h = 0; h < G; h++) {
    for (let a = 0; a < G; a++) {
      const p = grid[h * G + a];
      if (h >= 1 && a >= 1) btts += p;
      if (h + a > 1.5) o15 += p;
    }
  }
  assert.ok(Math.abs(o.btts - btts) < 1e-12, `btts ${o.btts} != ${btts}`);
  assert.ok(Math.abs(o.over[1.5] - o15) < 1e-12);
  /* Both teams scoring IS at least two goals, so BTTS can never be the more
     likely of the two. Catches a sign error in either. */
  assert.ok(o.btts < o.over[1.5]);
  /* The default lines are the constant, not a literal repeated per call site.
     On its own this is circular — moving the constant moves both sides — so
     the lines the app actually depends on are named below rather than left to
     it. */
  assert.deepStrictEqual(Object.keys(o.over).map(Number), core.SIM_GOAL_LINES);
  /* 1.5 is what the Premier League desk's goals nine-fold is built on and 2.5
     is the standard total; dropping either from the constant would leave
     simLegOptions unable to offer the leg and the acca unbuildable, which the
     page answers by hiding itself — a silent disappearance, not an error. */
  assert.ok(core.SIM_GOAL_LINES.includes(1.5), 'the goals acca prices an over 1.5 leg');
  assert.ok(core.SIM_GOAL_LINES.includes(2.5));
  /* An integer line settles strictly over: three goals win "over 2", two do
     not. Every shipped line is a half-line, where `>` and `>=` agree, so this
     is the only place the distinction is observable at all. */
  const int = core.simOutcomes(grid, core.SIM_MAX_GOALS, [2, 2.5]);
  assert.ok(Math.abs(int.over[2] - int.over[2.5]) < 1e-12,
    'a 2-goal game is being paid out as "over 2"');
});

t('a fixture offers one side of the match odds, never both', () => {
  const model = {
    constants: { BASE_H: 1.5, BASE_A: 1.2, DC_RHO: -0.08 },
    teams: {
      BIG: { attack: 1.4, defence: 0.8 },
      SMALL: { attack: 0.8, defence: 1.3 },
    },
  };
  const sim = core.simFixture('BIG', 'SMALL', model);
  const legs = core.simLegOptions(sim, 'BIG', 'SMALL');
  const wins = legs.filter((l) => l.market === 'WIN');
  assert.equal(wins.length, 1, 'home-win and away-win cannot both land');
  assert.equal(wins[0].prob, Math.max(sim.home, sim.away), 'the weaker side was offered');
  assert.ok(wins[0].label.includes('BIG'));
  /* The underdog's win is not merely unlisted — it must be unreachable, or a
     caller filtering on market alone can still find it. */
  assert.ok(!legs.some((l) => Math.abs(l.prob - Math.min(sim.home, sim.away)) < 1e-12));
  assert.ok(!legs.some((l) => l.market === 'DRAW'));
  assert.ok(legs.some((l) => l.market === 'BTTS' && l.prob === sim.btts));
  assert.ok(legs.some((l) => l.market === 'OG1.5' && l.prob === sim.over[1.5]));
  for (let i = 1; i < legs.length; i++) assert.ok(legs[i - 1].prob >= legs[i].prob);
  // the away side, when it is the stronger one
  const flip = core.simLegOptions(core.simFixture('SMALL', 'BIG', model), 'SMALL', 'BIG');
  assert.ok(flip.find((l) => l.market === 'WIN').label.includes('BIG'));
  assert.deepStrictEqual(core.simLegOptions(null, 'A', 'B'), []);
});

t('an acca across markets never uses one fixture twice', () => {
  /* F1 is the best option in BOTH buckets. Taking each bucket's top pick
     independently puts it on the slip twice — one distribution priced as two
     independent events, which is the mistake this function exists to stop. */
  const got = core.accaAllocate([
    { key: 'A', need: 1, options: [{ id: 'F1', prob: 0.9 }, { id: 'F2', prob: 0.5 }] },
    { key: 'B', need: 1, options: [{ id: 'F1', prob: 0.8 }, { id: 'F2', prob: 0.7 }] },
  ]);
  assert.equal(got.picks.length, 2);
  assert.equal(new Set(got.picks.map((o) => o.id)).size, 2);
  /* And it resolves the clash the way that costs least overall: F1 goes to
     bucket A (0.9 x 0.7 = 0.63), not to B (0.8 x 0.5 = 0.40). */
  assert.equal(got.groups.find((g) => g.key === 'A').options[0].id, 'F1');
  assert.equal(got.groups.find((g) => g.key === 'B').options[0].id, 'F2');
  assert.ok(got.exact);
});

t('a club cannot appear in two legs, even in two different matches', () => {
  /* THE OSASUNA CASE, and it shipped for one render. Over a single round each
     club plays once, so excluding on the fixture id is the same as excluding
     on the clubs. Over a seven-day window it is not: OSA v LEV and CEL v OSA
     are two distinct fixtures, and taking both-teams-carded in each puts one
     side's discipline behind two legs that are then multiplied as if
     independent. `keys` is how a caller says what must not repeat. */
    const got = core.accaAllocate([
    { key: 'BTC', need: 2, options: [
      { id: 'F1', keys: ['OSA', 'LEV'], prob: 0.80 },
      { id: 'F2', keys: ['CEL', 'OSA'], prob: 0.79 },   // shares OSA with F1
      { id: 'F3', keys: ['BET', 'RSO'], prob: 0.77 },
    ] },
  ]);
  assert.equal(got.picks.length, 2);
  const clubs = got.picks.flatMap((o) => o.keys);
  assert.equal(new Set(clubs).size, clubs.length, 'a club is in two legs');
  /* And it takes the best PAIR, not the best two ranked singly: F1+F3, not
     the higher-scoring-looking F1+F2 that collides. */
  assert.deepStrictEqual(got.picks.map((o) => o.id), ['F1', 'F3']);

  /* Two legs on the SAME match collide on the first club, so keys subsume
     fixture-distinctness rather than sitting alongside it. */
  assert.equal(core.accaAllocate([
    { key: 'A', need: 1, options: [{ id: 'F1', keys: ['ARS', 'COV'], prob: 0.7 }] },
    { key: 'B', need: 1, options: [{ id: 'F1', keys: ['ARS', 'COV'], prob: 0.6 }] },
  ]), null, 'one match filled two buckets');

  /* No keys means the id is the key, which is what a single-round caller
     wants and what every earlier caller passed. */
  const bare = core.accaAllocate([
    { key: 'A', need: 1, options: [{ id: 'F1', prob: 0.9 }] },
    { key: 'B', need: 1, options: [{ id: 'F1', prob: 0.8 }, { id: 'F2', prob: 0.5 }] },
  ]);
  assert.deepStrictEqual(bare.picks.map((o) => o.id), ['F1', 'F2']);
});

t('an acca that cannot be filled is null, never short', () => {
  const short = core.accaAllocate([
    { key: 'A', need: 2, options: [{ id: 'F1', prob: 0.9 }, { id: 'F2', prob: 0.8 }] },
    { key: 'B', need: 1, options: [{ id: 'F1', prob: 0.7 }, { id: 'F2', prob: 0.6 }] },
  ]);
  assert.equal(short, null, 'three legs were asked for and two fixtures exist');
  assert.equal(core.accaAllocate([]), null);
  assert.equal(core.accaAllocate(null), null);
  /* A bucket needing more than it can price is unfillable even if the board
     is large — the shortage is in the market, not the round. */
  assert.equal(core.accaAllocate([
    { key: 'A', need: 3, options: [{ id: 'F1', prob: 0.9 }, { id: 'F2', prob: 0.8 }] },
  ]), null);
  /* Legs at 0 and 1 are dropped before the count, so a bucket padded with
     certainties is still short rather than quietly filled with them. */
  assert.equal(core.accaAllocate([
    { key: 'A', need: 2, options: [{ id: 'F1', prob: 0.9 }, { id: 'F2', prob: 1 }] },
  ]), null);
});

t('greedy stranding itself is not the same as unfillable', () => {
  /* Both buckets can price F1 and F2; only A can price F3. Greedy hands F1
     and F2 to A and leaves B empty — but swapping fills both, so the answer
     exists and must be found. An early version returned null here. */
  const got = core.accaAllocate([
    { key: 'A', need: 2, options: [{ id: 'F1', prob: 0.9 }, { id: 'F2', prob: 0.8 }, { id: 'F3', prob: 0.5 }] },
    { key: 'B', need: 1, options: [{ id: 'F1', prob: 0.7 }, { id: 'F2', prob: 0.6 }] },
  ]);
  assert.ok(got, 'a solvable board was reported unfillable');
  assert.equal(new Set(got.picks.map((o) => o.id)).size, 3);
  /* The options come back untouched, so a caller's own fields survive. */
  const tagged = core.accaAllocate([
    { key: 'A', need: 1, options: [{ id: 'F1', prob: 0.9, fx: 'ARS v COV', ko: '2026-08-21' }] },
  ]);
  assert.equal(tagged.picks[0].fx, 'ARS v COV');
  assert.equal(tagged.picks[0].ko, '2026-08-21');
});


/* ---- one official, two feeds ------------------------------------------- */
/*
 * The appointment overlay and the card table are different sources. On the
 * Championship's opening round the overlay named all twelve officials and an
 * exact lookup matched ONE — "Andrew Kitchen", because that feed happened to
 * write him in full. The rest arrived abbreviated, and an appointment the desk
 * cannot resolve is priced at refFactor = 1, which on the page is
 * indistinguishable from no official being named.
 */
t('an appointment resolves to the card table it is spelt differently from', () => {
  // The real Championship round-one table and the real overlay spellings.
  const known = ['Farai Hallam', 'A Herczeg', 'Lewis Smith', 'B Speedie', 'R Madley',
    'Tim Robinson', 'W Finnie', 'O Langford', 'G Ward', 'Matthew Donohue',
    'Josh Smith', 'Andrew Kitchen'];
  const want = {
    'F. Hallam': 'Farai Hallam',      // abbreviation -> full name
    'A. Herczeg': 'A Herczeg',        // same abbreviation, differing by a stop
    'L. Smith': 'Lewis Smith',        // and it must not reach Josh
    'J. Smith': 'Josh Smith',         // nor Lewis
    'M. Donohue': 'Matthew Donohue',
    'T. Robinson': 'Tim Robinson',
    'W. Finnie': 'W Finnie',
    'Andrew Kitchen': 'Andrew Kitchen',   // already exact, never reinterpreted
  };
  for (const [appt, expected] of Object.entries(want)) {
    assert.equal(core.matchRefName(appt, known), expected,
      `${appt} resolved to ${core.matchRefName(appt, known)}, not ${expected}`);
  }
  // A normalised exact match WINS over an ambiguous run. "A. Herczeg" against
  // a table holding both "A Herczeg" and "Adam Herczeg" is not ambiguous: one
  // of them is that string with a full stop. Without this the run rule finds
  // two candidates and refuses, and the desk prices at a neutral referee.
  assert.equal(core.matchRefName('A. Herczeg', ['A Herczeg', 'Adam Herczeg']),
    'A Herczeg');
  // But two rows that BOTH normalise to it is a genuine tie, and stays refused.
  assert.equal(core.matchRefName('A. Herczeg', ['A Herczeg', 'A. Herczeg ']), null);
  // An object keyed by name works too — that is what the desks hold.
  const byName = {}; known.forEach((n) => { byName[n] = { n }; });
  assert.equal(core.matchRefName('F. Hallam', byName), 'Farai Hallam');
});

t('an ambiguous appointment resolves to nothing, never to a guess', () => {
  // Two Smiths sharing an initial is not a lookup. Pricing a match off the
  // wrong referee is worse than pricing it off none, because the desk shows
  // his name beside numbers computed from someone else's record.
  assert.equal(core.matchRefName('J. Smith', ['Josh Smith', 'Jarred Smith']), null);
  // Surname ORDER is identity: two families, not one man written two ways.
  assert.equal(core.matchRefName('M. Ferrer Busquets', ['Mateo Busquets Ferrer']), null);
  // A different initial is a different person, however well the surname fits.
  assert.equal(core.matchRefName('A. Madley', ['Robert Madley']), null);
  // Nothing to go on.
  assert.equal(core.matchRefName('', ['Josh Smith']), null);
  assert.equal(core.matchRefName('Smith', ['Josh Smith']), null);
  assert.equal(core.matchRefName('J. Smith', []), null);
  assert.equal(core.matchRefName('J. Smith', null), null);
});

t('the resolver agrees with the merge about what one person looks like', () => {
  // Same rule as build_refs.canonical_referees, in the other direction, so the
  // two cannot disagree. These are the Spanish cases that broke the merge: a
  // second surname cited, and a compound given name.
  const spain = ['Jesus Gil Manzano', 'Miguel Angel Ortiz Arias',
    'Alejandro Muñiz Ruiz', 'Juan Martinez Munuera', 'José Luis Munuera Montero'];
  assert.equal(core.matchRefName('J. Manzano', spain), 'Jesus Gil Manzano');
  assert.equal(core.matchRefName('M. Ortiz', spain), 'Miguel Angel Ortiz Arias');
  assert.equal(core.matchRefName('A. Ruiz', spain), 'Alejandro Muñiz Ruiz');
  // And the one no name rule can settle stays unsettled here too.
  assert.equal(core.matchRefName('J. Munuera', spain), null);
});



/* ---- live card ticker (assets/livecards.js) ----
   The forecast, once the event is known. Everything here is about one
   failure: the desk telling a reader that a player booked in the twentieth
   minute has a 52% chance of being booked. Every number was computed
   correctly and the sentence was false. */
const lc = require('../assets/livecards.js');

console.log('livecards: reading the feed');
t('indexes yellows, reds and minutes by element id', () => {
  const idx = lc.indexLive({ elements: [
    { id: 4, stats: { yellow_cards: 1, red_cards: 0, minutes: 67 } },
    { id: 9, stats: { yellow_cards: 0, red_cards: 1, minutes: 34 } },
  ] });
  assert.deepEqual(idx[4], { yc: 1, rc: 0, min: 67 });
  assert.deepEqual(idx[9], { yc: 0, rc: 1, min: 34 });
});
t('an element with no stats is absent, not clean', () => {
  // Absent and clean are different claims. Reading "not reported on" as
  // "reported as uncarded" is how a booking goes missing from the page.
  const idx = lc.indexLive({ elements: [{ id: 4 }, { id: 5, stats: {} }] });
  assert.equal(idx[4], undefined);
  assert.deepEqual(idx[5], { yc: 0, rc: 0, min: 0 });
});
t('survives a feed that returns nothing at all', () => {
  assert.deepEqual(lc.indexLive(null), {});
  assert.deepEqual(lc.indexLive({}), {});
});

console.log('livecards: the settled state');
t('a booked player is no longer a probability', () => {
  const idx = { 7: { yc: 1, rc: 0, min: 30 } };
  assert.equal(lc.playerState(idx, 7), 'booked');
});
t('a red outranks a yellow — a second-yellow sending off is not just a booking', () => {
  assert.equal(lc.playerState({ 7: { yc: 1, rc: 1, min: 30 } }, 7), 'sent-off');
  assert.equal(lc.playerState({ 7: { yc: 0, rc: 1, min: 30 } }, 7), 'sent-off');
});
t('on the pitch and uncarded is "clean" — the forecast still stands', () => {
  assert.equal(lc.playerState({ 7: { yc: 0, rc: 0, min: 12 } }, 7), 'clean');
});
t('an unused substitute has no state, so his row is untouched', () => {
  assert.equal(lc.playerState({ 7: { yc: 0, rc: 0, min: 0 } }, 7), null);
  assert.equal(lc.playerState({}, 7), null);
  assert.equal(lc.playerState(null, 7), null);
});

console.log('livecards: the fixture ticker');
const clubs = { 1: 'ARS', 2: 'ARS', 3: 'CHE', 4: 'CHE', 5: 'TOT' };
t('totals both sides and keeps them separable', () => {
  const idx = { 1: { yc: 1, rc: 0, min: 90 }, 2: { yc: 1, rc: 0, min: 90 },
    3: { yc: 2, rc: 1, min: 90 }, 5: { yc: 3, rc: 0, min: 90 } };
  const tk = lc.fixtureTicker(idx, clubs, 'ARS', 'CHE', {});
  assert.equal(tk.home.yc, 2);
  assert.equal(tk.away.yc, 2);
  assert.equal(tk.away.rc, 1);
  assert.equal(tk.yellows, 4);
  assert.equal(tk.reds, 1);
  // A third club's cards are not this fixture's, however live the feed is.
  assert.equal(tk.yellows + tk.reds, 5);
});
t('nothing to say before a ball is kicked', () => {
  assert.equal(lc.fixtureTicker({ 1: { yc: 0, rc: 0, min: 0 } }, clubs, 'ARS', 'CHE', {}), null);
  assert.equal(lc.fixtureTicker(null, clubs, 'ARS', 'CHE', {}), null);
});
t('the minute is the longest anyone has been on', () => {
  const idx = { 1: { yc: 0, rc: 0, min: 62 }, 2: { yc: 0, rc: 0, min: 71 } };
  assert.equal(lc.fixtureTicker(idx, clubs, 'ARS', 'CHE', {}).minute, 71);
});
t('a double gameweek relabels itself rather than guessing', () => {
  // stats is a ROUND total. With two fixtures it cannot be split between
  // them, and a wrong attribution here would be invisible on the page.
  const idx = { 1: { yc: 1, rc: 0, min: 90 } };
  const one = lc.fixtureTicker(idx, clubs, 'ARS', 'CHE', { fixturesFor: () => 1 });
  const two = lc.fixtureTicker(idx, clubs, 'ARS', 'CHE', { fixturesFor: (c) => (c === 'ARS' ? 2 : 1) });
  assert.equal(one.scope, 'match');
  assert.equal(two.scope, 'gameweek');
});

console.log('livecards: when to poll');
t('polls inside the match window and not outside it', () => {
  const ko = Date.parse('2026-08-15T14:00:00Z');
  const fx = [{ kickoff_time: '2026-08-15T14:00:00Z', finished: false }];
  assert.equal(lc.anyLive(fx, ko - 60000), false);     // a minute before kick-off
  assert.equal(lc.anyLive(fx, ko), true);
  assert.equal(lc.anyLive(fx, ko + 60 * 60000), true); // an hour in
  assert.equal(lc.anyLive(fx, ko + lc.WINDOW_MS + 1), false);
});
t('a finished fixture is never polled for, and a scheduleless one cannot be', () => {
  const ko = Date.parse('2026-08-15T14:00:00Z');
  assert.equal(lc.anyLive([{ kickoff_time: '2026-08-15T14:00:00Z', finished: true }], ko + 1000), false);
  assert.equal(lc.anyLive([{ finished: false }], ko), false);
  assert.equal(lc.anyLive([], ko), false);
  assert.equal(lc.anyLive(null, ko), false);
});



/* ---- charts (assets/charts.js) ----
   Pure SVG string builders, so they are testable without a DOM. What is
   pinned here is not the geometry — it is the refusals. A chart drawn from
   too little data is worse than no chart, because a chart asserts a shape. */
const ch = require('../assets/charts.js');

console.log('charts: refusing to draw what is not there');
t('a sparkline needs two points before it is a trend', () => {
  assert.equal(ch.sparkline([]), '');
  assert.equal(ch.sparkline([{ k: 'GW1', v: 1 }]), '');
  assert.ok(ch.sparkline([{ k: 'GW1', v: 1 }, { k: 'GW2', v: 2 }]).startsWith('<svg'));
});
t('a reliability curve needs a populated bucket', () => {
  assert.equal(ch.reliability([]), '');
  assert.equal(ch.reliability([{ pMean: 0.3, oFreq: 0.3, n: 0 }]), '');
  assert.equal(ch.reliability([{ pMean: null, oFreq: 0.3, n: 9 }]), '');
});
t('a strip needs a spread — identical officials are not a distribution', () => {
  const same = [{ n: 'A', ypg: 3.5 }, { n: 'B', ypg: 3.5 }, { n: 'C', ypg: 3.5 }];
  assert.equal(ch.strip(same), '');
  assert.ok(ch.strip([{ n: 'A', ypg: 2 }, { n: 'B', ypg: 3.5 }, { n: 'C', ypg: 5 }]).startsWith('<svg'));
});
t('a trend needs three seasons', () => {
  assert.equal(ch.trend([{ k: '1', v: 1 }, { k: '2', v: 2 }]), '');
});

console.log('charts: every chart carries its own words');
t('the reliability curve says which way it is wrong, not just how much', () => {
  // Model says 20%, reality 40% — under-confident, twice over.
  const svg = ch.reliability([{ pMean: 0.2, oFreq: 0.4, n: 100 }, { pMean: 0.6, oFreq: 0.62, n: 50 }]);
  assert.match(svg, /role="img"/);
  assert.match(svg, /under-confident/);
  assert.match(svg, /150 graded forecasts/);
});
t('an over-confident model is described as over-confident', () => {
  const svg = ch.reliability([{ pMean: 0.6, oFreq: 0.2, n: 80 }]);
  assert.match(svg, /over-confident/);
});
t('the strip names the appointed officials in its summary', () => {
  const svg = ch.strip([{ n: 'C Kavanagh', ypg: 3.51, on: true },
    { n: 'M Oliver', ypg: 3.19 }, { n: 'J Brooks', ypg: 4.32 }]);
  assert.match(svg, /Appointed this round: C Kavanagh at 3\.51/);
  assert.match(svg, /class="chart-pt on"/);
});
t('the season trend names its peak', () => {
  const svg = ch.trend([{ k: '92/93', v: 1.63 }, { k: '23/24', v: 4.17 }, { k: '25/26', v: 3.75 }]);
  assert.match(svg, /highest 4\.17 in 23\/24/);
});
t('escapes anything that came from data', () => {
  const svg = ch.strip([{ n: '<script>x</script>', ypg: 2, on: true },
    { n: 'B', ypg: 3 }, { n: 'C', ypg: 4 }]);
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;/);
});

console.log('charts: the step line');
t('cumulative cautions step, they do not interpolate', () => {
  // A player on 1 card who picks up a second must not be drawn passing
  // through 1.5 — the diagonal would say he was booked gradually.
  const svg = ch.sparkline([{ k: 'GW1', v: 1 }, { k: 'GW2', v: 2 }]);
  assert.match(svg, /H[\d.]+V[\d.]+/);          // horizontal then vertical
  assert.ok(!/L\d/.test(svg), 'no straight diagonal segment');
});
t('a flat series still draws and reports no change', () => {
  const svg = ch.sparkline([{ k: 'GW1', v: 0 }, { k: 'GW2', v: 0 }]);
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /0 cautions/);
});

/* ---- fatigue: rest days ------------------------------------------------
   The failure these exist for is a NULL RESULT ARRIVED AT BY ARITHMETIC. Rest
   days computed from the league fixture list alone put 74.2% of the 2025-26
   team-fixtures in the "fresh" bucket, and the clubs that mislabels are the
   European ones — so a fatigue factor measured that way is pushed toward zero
   by the data rather than by football, and the null then gets recorded as a
   finding. */
console.log('fatigue: rest days');
const EURO_THU = { d: '2026-09-17T19:00:00+00:00', comp: 'UEL', v: 'A' };
const LEAGUE_SUN = { d: '2026-09-13T14:00:00+00:00', comp: 'PL', v: 'H' };
const NEXT = '2026-09-20T15:30:00+00:00';

t('counts days since the last COMPETITIVE match, not the last league one', () => {
  assert.equal(core.restDays([EURO_THU, LEAGUE_SUN], NEXT), 2);
  // The same fixture, with Europe invisible: seven days and "fresh". This is
  // the whole reason data/pl_other_fixtures.js is harvested.
  assert.equal(core.restDays([LEAGUE_SUN], NEXT), 7);
});
t('buckets on the brief\'s boundaries, and they do not overlap', () => {
  assert.equal(core.restBucket(6), 'fresh');
  assert.equal(core.restBucket(7), 'fresh');
  assert.equal(core.restBucket(5), 'normal');
  assert.equal(core.restBucket(4), 'normal');
  assert.equal(core.restBucket(3), 'congested');
  assert.equal(core.restBucket(0), 'congested');
});
t('no previous match is null, never fresh', () => {
  // A side's opening fixture is not a well-rested side, it is a side with no
  // evidence. Scoring it fresh would put all twenty in the bucket once a year
  // and drag the fresh average toward the league mean.
  assert.equal(core.restDays([], NEXT), null);
  assert.equal(core.restBucket(null), null);
  assert.equal(core.restBucket(undefined), null);
});
t('a fixture is never its own predecessor', () => {
  assert.equal(core.restDays([{ d: NEXT, comp: 'PL', v: 'H' }], NEXT), null);
});
t('the away leg in Europe inside 72 hours is derived, not declared', () => {
  assert.equal(core.euroAway72h([EURO_THU], NEXT), true);
  // Home in Europe is a different journey and does not raise the flag.
  assert.equal(core.euroAway72h([{ ...EURO_THU, v: 'H' }], NEXT), false);
  // Away, but a domestic cup — the flag is about the trip, not the midweek.
  assert.equal(core.euroAway72h([{ ...EURO_THU, comp: 'LCUP' }], NEXT), false);
  // Away in Europe but a week earlier.
  assert.equal(core.euroAway72h([{ ...EURO_THU, d: '2026-09-10T19:00:00+00:00' }], NEXT), false);
});

console.log('fatigue: derbies');
t('a derby is the same fixture whichever way round it is written', () => {
  assert.equal(core.isDerby('LIV', 'EVE'), true);
  assert.equal(core.isDerby('EVE', 'LIV'), true);
  assert.equal(core.isDerby('MCI', 'MUN'), true);
  assert.equal(core.isDerby('AVL', 'COV'), true);
});
t('and an ordinary fixture is not one', () => {
  assert.equal(core.isDerby('ARS', 'BOU'), false);
  assert.equal(core.isDerby('', ''), false);
  assert.equal(core.isDerby(null, undefined), false);
});
t('every derby names two clubs this division actually contains', () => {
  // A pair naming a relegated club is a control that silently excludes
  // nothing, which is worse than no control at all.
  const src = readFileSync(join(root, 'data', 'pl_data.js'), 'utf8');
  const codes = new Set([...src.matchAll(/short:"([A-Z]{3})"/g)].map((m) => m[1]));
  const stray = core.DERBIES.flat().filter((c) => !codes.has(c));
  assert.deepEqual(stray, [], `derby pairs name clubs not in the division: ${stray}`);
});

console.log('rotation risk');
const ROT = require('../data/rotation_model.js');
const EURO_AWAY = { d: '2026-09-17T19:00:00+00:00', comp: 'UEL', v: 'A' };
const LAST_SUN = { d: '2026-09-13T14:00:00+00:00', comp: 'PL', v: 'H' };
const SAT = '2026-09-20T15:30:00+00:00';

t('a congested side is expected to change more than the same side rested', () => {
  const tired = core.rotationRisk(ROT, 'CHE', [EURO_AWAY, LAST_SUN], SAT);
  const rested = core.rotationRisk(ROT, 'CHE', [LAST_SUN], SAT);
  assert.ok(tired.expected > rested.expected,
    `congested ${tired.expected} should exceed rested ${rested.expected}`);
  assert.equal(tired.bucket, 'congested');
  assert.equal(rested.bucket, 'fresh');
});
t('the club baseline carries the level, and it differs by club', () => {
  // Chelsea changed 3.27 a match in 2025-26 and Everton 1.57. A model without
  // this term would rediscover squad depth and call it fatigue.
  const che = core.rotationRisk(ROT, 'CHE', [LAST_SUN], SAT);
  const eve = core.rotationRisk(ROT, 'EVE', [LAST_SUN], SAT);
  assert.ok(che.expected > eve.expected + 1,
    `two clubs at identical rest should still differ by their own habit: ` +
    `${che.expected} vs ${eve.expected}`);
});
t('the BAND is cut on the lift, not the level', () => {
  // The whole point: a club that always rotates must not be permanently
  // flagged, and a settled side facing three games in seven days must be.
  const cheRested = core.rotationRisk(ROT, 'CHE', [LAST_SUN], SAT);
  assert.equal(cheRested.band, 'settled',
    'the heaviest rotator in the league, well rested, is not a rotation risk');
  const eveTired = core.rotationRisk(ROT, 'EVE', [EURO_AWAY, LAST_SUN], SAT);
  assert.ok(['raised', 'high'].includes(eveTired.band),
    `the most settled side in the league, congested, is: ${eveTired.band}`);
});
t('the European away trip adds on top, and only inside the congested bucket', () => {
  const withEuro = core.rotationRisk(ROT, 'CHE', [EURO_AWAY, LAST_SUN], SAT);
  const domestic = core.rotationRisk(ROT, 'CHE',
    [{ ...EURO_AWAY, comp: 'LCUP' }, LAST_SUN], SAT);
  assert.ok(withEuro.expected > domestic.expected,
    'an away leg in Europe is a longer trip than a midweek cup tie at home');
  assert.equal(withEuro.euroAway72h, true);
  assert.equal(domestic.euroAway72h, false);
});
t('no previous match says so rather than claiming a rested side', () => {
  // Opening weekend. Scoring it "fresh" would apply the fresh discount to all
  // twenty clubs once a year on no evidence at all.
  const r = core.rotationRisk(ROT, 'ARS', [], '2026-08-21T19:00:00+00:00');
  assert.equal(r.known, false);
  assert.equal(r.bucket, null);
  assert.equal(r.lift, 0);
  // Rounded to two places for display; the point is that it IS the baseline
  // and nothing has been added or taken away.
  assert.equal(r.expected, Math.round(ROT.clubBaseline.ARS * 100) / 100);
});
t('an unknown club falls back to the league mean rather than returning nothing', () => {
  const r = core.rotationRisk(ROT, 'ZZZ', [LAST_SUN], SAT);
  assert.ok(r && r.baseline === ROT.leagueMean);
});

/* ---- the under-dispersed tail ------------------------------------------- */
t('the binomial fit matches the mean exactly and the dispersion closely', () => {
  /* THE MEAN IS THE ONE THAT MUST BE EXACT. n is a whole number of trials, so
     the moment match cannot honour both; p is re-solved as mu/n afterwards,
     which puts the mean back to the digit and leaves the dispersion within a
     couple of thousandths. Calibration lives on the mean. */
  const f = core.udBinomFit(1.874, 0.888);
  assert.ok(f, 'a mean of 1.874 at dispersion 0.888 must be representable');
  assert.ok(Math.abs(f.n * f.p - 1.874) < 1e-12, 'mean is exact');
  const disp = (f.n * f.p * (1 - f.p)) / (f.n * f.p);
  assert.ok(Math.abs(disp - 0.888) < 0.005, `dispersion ${disp}`);
  assert.ok(f.n > 1 && Number.isInteger(f.n) && f.p > 0 && f.p < 1);
});
t('an under-dispersed tail prices ABOVE Poisson in the body, which is the whole point', () => {
  /* Poisson over-weights nought and one when the counts are tighter than
     Poisson, so P(2 or more) comes out low. That is the calibration bias this
     replaces, and its direction is the assertion. */
  const mu = 1.874, line = 1;               // line 1 => "2 or more"
  const poisson = core.udTailProb(mu, 1.5, line);   // >=1 dispersion => Poisson
  const binom = core.udTailProb(mu, 0.888, line);
  assert.ok(binom > poisson, `${binom} should exceed ${poisson}`);
  assert.ok(binom - poisson > 0.005 && binom - poisson < 0.05, 'a nudge, not a lurch');
});
t('dispersion at or above one falls through to Poisson rather than pretending', () => {
  /* A binomial cannot represent variance >= mean. Clamping would be a lie
     about the input, so the function hands back the Poisson tail and says so
     by construction — the same three-outcome discipline the probes use. */
  const mu = 2.0;
  const viaPoisson = 1 - Math.exp(-mu) * (1 + mu);
  for (const phi of [1, 1.4, 0, -1, null]) {
    const got = core.udTailProb(mu, phi, 1);
    assert.ok(Math.abs(got - viaPoisson) < 1e-12 || phi === null,
      `dispersion ${phi} should give the Poisson tail, got ${got}`);
  }
  assert.equal(core.udBinomFit(mu, 1.2), null, 'no fit exists above dispersion 1');
});
t('the tail is a real probability, monotone in the line and in the mean', () => {
  const p = (mu, line) => core.udTailProb(mu, 0.888, line);
  for (const mu of [0.4, 1.2, 1.874, 3.5]) {
    for (let line = 0; line < 5; line++) {
      const v = p(mu, line);
      assert.ok(v >= 0 && v <= 1, `out of range at mu=${mu} line=${line}: ${v}`);
      if (line) assert.ok(v <= p(mu, line - 1) + 1e-12, 'falls as the line rises');
    }
    assert.ok(p(mu, 1) < p(mu + 0.5, 1), 'rises with the mean');
  }
  assert.equal(core.udTailProb(0, 0.888, 1), null, 'no mean, no answer');
  assert.equal(core.udTailProb(null, 0.888, 1), null);
});

console.log(`\n${passed} tests passed`);

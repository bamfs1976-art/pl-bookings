// Walk-forward backtest of the card model — the proof that a change helps.
//
//   node scripts/backtest.mjs [data/match_history.json]
//
// For each gameweek R (after a warm-up), fit the logistic GLM on every match
// row from rounds < R and score its predictions on round R, accumulating
// out-of-sample Brier score and log-loss. Compares three models:
//   base      the league base rate for everyone (a naive baseline)
//   prior     the shipped season-prior GLM (data/model.js)
//   fit       a GLM refit each week on prior rounds (what a live model would do)
// Lower Brier / log-loss is better. Needs data/match_history.json from
// data/harvest_history.py; without it, prints how to produce it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const core = require('../assets/core.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = process.argv[2] || join(root, 'data', 'match_history.json');

let rows;
try { rows = JSON.parse(readFileSync(path, 'utf8')); }
catch {
  console.error('No match history at ' + path + '.\n' +
    'Produce it where the FPL API is reachable:\n' +
    '  python3 data/harvest_history.py\n' +
    'then re-run: node scripts/backtest.mjs');
  process.exit(1);
}

const model = require('../data/model.js');
const feats = (r) => ({ yc90: r.yc90, foul90: r.foul90, DF: r.pos === 'DF' ? 1 : 0, MF: r.pos === 'MF' ? 1 : 0, FW: r.pos === 'FW' ? 1 : 0 });

// minimal IRLS (mirrors scripts/build-model.mjs) for the weekly refit.
// `sw` (optional) is a per-row recency weight so recent rounds count for more.
function irls(X, y, iters = 40, sw = null) {
  const k = X[0].length, beta = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      let z = 0; for (let j = 0; j < k; j++) z += beta[j] * X[i][j];
      const p = 1 / (1 + Math.exp(-z)), swi = sw ? sw[i] : 1, w = swi * Math.max(1e-6, p * (1 - p));
      for (let a = 0; a < k; a++) { g[a] += swi * (y[i] - p) * X[i][a]; for (let b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b]; }
    }
    for (let a = 0; a < k; a++) H[a][a] += 1e-6;
    const A = H.map((r, i) => [...r, g[i]]);
    for (let c = 0; c < k; c++) {
      let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; const d = A[c][c] || 1e-9;
      for (let j = c; j <= k; j++) A[c][j] /= d;
      for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
    }
    let mv = 0; for (let j = 0; j < k; j++) { beta[j] += A[j][k]; mv += Math.abs(A[j][k]); }
    if (mv < 1e-8) break;
  }
  return beta;
}
const design = (r) => [1, r.yc90 || 0, r.foul90 || 0, r.pos === 'DF' ? 1 : 0, r.pos === 'MF' ? 1 : 0, r.pos === 'FW' ? 1 : 0];
const glmFromBeta = (b) => ({ intercept: b[0], weights: { yc90: b[1], foul90: b[2], DF: b[3], MF: b[4], FW: b[5] } });

const rounds = [...new Set(rows.map((r) => r.round))].filter((x) => x != null).sort((a, b) => a - b);
const WARMUP = Math.max(rounds[0] + 3, rounds[Math.min(4, rounds.length - 1)]);
const preds = { base: [], prior: [], fit: [] };
const base = model.baseRate;

for (const R of rounds) {
  if (R < WARMUP) continue;
  const train = rows.filter((r) => r.round < R);
  const test = rows.filter((r) => r.round === R);
  if (train.length < 200 || !test.length) continue;
  let fitCoef = null;
  // Recency-weight the weekly refit (0.97^gameweeks-ago), mirroring build-model.
  const decay = model.recencyDecay || 0.97;
  const sw = train.map((r) => Math.pow(decay, Math.max(0, (R - 1) - (Number(r.round) || 0))));
  try { fitCoef = glmFromBeta(irls(train.map(design), train.map((r) => r.y), 40, sw)); } catch { fitCoef = model.glm; }
  for (const r of test) {
    preds.base.push({ p: base, y: r.y });
    preds.prior.push({ p: core.glmProb(feats(r), model.glm), y: r.y });
    preds.fit.push({ p: core.glmProb(feats(r), fitCoef), y: r.y });
  }
}

if (!preds.base.length) { console.error('Not enough rounds to backtest (need history spanning several gameweeks).'); process.exit(1); }
const fmt = (x) => x == null ? '  —  ' : x.toFixed(4);
console.log(`Walk-forward backtest — ${preds.base.length} out-of-sample predictions over ${rounds.length} gameweeks\n`);
console.log('model            Brier     logLoss');
for (const m of ['base', 'prior', 'fit']) console.log(m.padEnd(14), fmt(core.brier(preds[m])), '  ', fmt(core.logLoss(preds[m])));
console.log('\nLower is better. "fit" refits each week on prior rounds; "prior" is the shipped season model; "base" is the league rate for everyone.');

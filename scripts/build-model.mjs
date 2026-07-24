// Build data/model.js — the card/fouls model parameters the app consumes.
//
// Two modes:
//   node scripts/build-model.mjs            season-prior (default): derive every
//     parameter from the shipped season data in data/pl_data.js. Reproducible,
//     no network, runs in CI. This is what ships until a real fit is available.
//   node scripts/build-model.mjs --fit data/match_history.json
//     match-level fit: re-estimate the logistic GLM coefficients by IRLS on
//     per-match booking outcomes harvested with data/harvest_history.py, and
//     write basis:"match-fit". Everything else (shrinkage priors, two-stage
//     hazard, NB dispersion) is still derived from the season aggregates.
//
// The model is intentionally small: a handful of numbers the pure functions in
// assets/core.js turn into probabilities. See docs/modelling-review.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLOPE = 1.1;             // logistic slope, kept from the shipped model
const SHRINK_K = 6;            // empirical-Bayes prior strength, in matches
const NB_DISPERSION = 6;       // NegBin size for match fouls (prior; refined on fit)
const RECENCY_DECAY = 0.97;    // per-gameweek weight decay for the match fit (recent form counts more)
const POS = ['GK', 'DF', 'MF', 'FW'];

function loadData() {
  const src = readFileSync(join(root, 'data', 'pl_data.js'), 'utf8');
  const ctx = {}; vm.createContext(ctx);
  return vm.runInContext(src + ';({CLUBS, PL_PLAYERS, REFS})', ctx);
}

// Minutes-weighted mean of a per-90 rate over a set of players.
function wmean(players, rate) {
  let sw = 0, sv = 0;
  players.forEach((p) => { const m = Number(p.min) || 0, v = rate(p); if (m > 0 && v != null && isFinite(v)) { sw += m; sv += v * m; } });
  return sw > 0 ? sv / sw : null;
}

function round(x, d = 4) { const f = 10 ** d; return x == null ? null : Math.round(x * f) / f; }

// Newton-Raphson (IRLS) logistic regression. X: n×k with a leading 1 column
// baked in by the caller; y in {0,1}. Returns the coefficient vector.
// `sw` (optional) is a per-row sample weight (recency); defaults to 1 each.
function irls(X, y, iters = 50, sw = null) {
  const n = X.length, k = X[0].length;
  const beta = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0);
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      let z = 0; for (let j = 0; j < k; j++) z += beta[j] * X[i][j];
      const p = 1 / (1 + Math.exp(-z)), swi = sw ? sw[i] : 1, w = swi * Math.max(1e-6, p * (1 - p));
      for (let a = 0; a < k; a++) {
        g[a] += swi * (y[i] - p) * X[i][a];
        for (let b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b];
      }
    }
    for (let a = 0; a < k; a++) H[a][a] += 1e-6; // ridge for stability
    const step = solve(H, g);
    let move = 0; for (let j = 0; j < k; j++) { beta[j] += step[j]; move += Math.abs(step[j]); }
    if (move < 1e-8) break;
  }
  return beta;
}
// Gaussian elimination solve H x = g.
function solve(H, g) {
  const k = g.length, A = H.map((r, i) => [...r, g[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c] || 1e-9;
    for (let j = c; j <= k; j++) A[c][j] /= d;
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((r) => r[k]);
}

function main() {
  const { PL_PLAYERS, REFS } = loadData();
  const rated = PL_PLAYERS.filter((p) => p.y != null && p.f != null);

  // ---- shrinkage priors: minutes-weighted position means ----
  const ycMean = {}, foulMean = {};
  POS.forEach((pos) => {
    const g = rated.filter((p) => p.p === pos);
    ycMean[pos] = round(wmean(g, (p) => p.y), 4);
    foulMean[pos] = round(wmean(g, (p) => p.f), 4);
  });
  const ycLeague = round(wmean(rated, (p) => p.y), 4);
  const foulLeague = round(wmean(rated, (p) => p.f), 4);
  // fill empty position buckets (e.g. GK) with the league mean
  POS.forEach((pos) => { if (ycMean[pos] == null) ycMean[pos] = ycLeague; if (foulMean[pos] == null) foulMean[pos] = foulLeague; });

  // ---- base rate (yellows per player-match) and the logistic anchor on SHRUNK risk ----
  let yc = 0, matches = 0;
  rated.forEach((p) => { const m = Number(p.min) || 0; if (m > 0 && p.yc != null) { yc += Number(p.yc) || 0; matches += m / 90; } });
  const baseRate = Math.min(0.9, Math.max(0.01, yc / matches));
  const shrink = (events, mins, mean) => { const ex = (mins || 0) / 90; return ex > 0 ? (events + mean * SHRINK_K) / (ex + SHRINK_K) : mean; };
  const avgShrunkRisk = wmean(rated, (p) => {
    const sy = shrink((p.yc || 0), p.min, ycMean[p.p] || ycLeague);
    const sf = shrink((p.f || 0) * (p.min / 90), p.min, foulMean[p.p] || foulLeague);
    return 2 * sy + sf;
  });
  const intercept = Math.log(baseRate / (1 - baseRate)) - SLOPE * avgShrunkRisk;
  const glm = { intercept: round(intercept, 4), weights: { yc90: round(2 * SLOPE, 4), foul90: round(SLOPE, 4), DF: 0, MF: 0, FW: 0 } };

  // ---- two-stage hazard: cards-per-foul anchored so the average player hits baseRate ----
  const baseHazard = -Math.log(1 - baseRate) / (foulLeague || 1);
  const refYpg = REFS.map((r) => r.ypg).filter((x) => x != null);
  const refPivotYpg = refYpg.length ? refYpg.reduce((a, b) => a + b, 0) / refYpg.length : 3.7;

  let basis = 'season-prior', fitN = 0;
  // ---- optional match-level GLM fit ----
  const fitArg = process.argv.indexOf('--fit');
  if (fitArg > -1 && process.argv[fitArg + 1]) {
    try {
      const rows = JSON.parse(readFileSync(process.argv[fitArg + 1], 'utf8')); // [{round,yc90,foul90,pos,y}]
      // Recency weighting: weight each match by 0.97^(gameweeks in the past),
      // so recent form counts for more than early-season noise. Keyed on the
      // row's gameweek (round); uniform if no gameweek is present.
      const gws = rows.map((r) => Number(r.round ?? r.gw)).filter((n) => Number.isFinite(n));
      const latestGw = gws.length ? Math.max(...gws) : null;
      const X = [], y = [], sw = [];
      rows.forEach((r) => {
        if (r.y !== 0 && r.y !== 1) return;
        X.push([1, r.yc90 || 0, r.foul90 || 0, r.pos === 'DF' ? 1 : 0, r.pos === 'MF' ? 1 : 0, r.pos === 'FW' ? 1 : 0]);
        y.push(r.y);
        const gw = Number(r.round ?? r.gw);
        const ago = (latestGw != null && Number.isFinite(gw)) ? Math.max(0, latestGw - gw) : 0;
        sw.push(Math.pow(RECENCY_DECAY, ago));
      });
      if (X.length >= 200) {
        const b = irls(X, y, 50, sw);
        glm.intercept = round(b[0], 4);
        glm.weights = { yc90: round(b[1], 4), foul90: round(b[2], 4), DF: round(b[3], 4), MF: round(b[4], 4), FW: round(b[5], 4) };
        basis = 'match-fit'; fitN = X.length;
      } else {
        console.warn(`--fit: only ${X.length} match rows (<200) — keeping the season prior.`);
      }
    } catch (e) { console.warn('--fit failed, keeping season prior:', e.message); }
  }

  const model = {
    basis, fitRows: fitN, slope: SLOPE, baseRate: round(baseRate, 4),
    recencyDecay: RECENCY_DECAY,
    shrink: { strengthMatches: SHRINK_K, ycMean, foulMean, ycLeague, foulLeague },
    glm,
    twoStage: { baseHazard: round(baseHazard, 4), refPivotYpg: round(refPivotYpg, 3) },
    nbFouls: { dispersion: NB_DISPERSION },
  };

  const out = [
    '// Auto-generated by scripts/build-model.mjs. Card/fouls model parameters.',
    `// basis:"${basis}" — ${basis === 'match-fit' ? fitN + ' match rows fitted by IRLS' : 'derived from data/pl_data.js season aggregates (prior)'}.`,
    '// The pure functions in assets/core.js turn these into probabilities. See docs/modelling-review.md.',
    'const CARD_MODEL = ' + JSON.stringify(model, null, 2) + ';',
    "if (typeof module !== 'undefined' && module.exports) module.exports = CARD_MODEL;",
    "if (typeof window !== 'undefined') window.CARD_MODEL = CARD_MODEL;",
    '',
  ].join('\n');
  writeFileSync(join(root, 'data', 'model.js'), out);
  console.log(`data/model.js written (basis=${basis}). baseRate=${(baseRate * 100).toFixed(1)}% ` +
    `avgShrunkRisk=${avgShrunkRisk.toFixed(3)} intercept=${glm.intercept} baseHazard=${model.twoStage.baseHazard} refPivot=${model.twoStage.refPivotYpg}`);
}

main();

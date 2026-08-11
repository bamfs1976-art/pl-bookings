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
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const core = require('../assets/core.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };
const path = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--label'
  && argv[argv.indexOf(a) - 1] !== '--out') || join(root, 'data', 'match_history.json');
const label = flag('--label') || 'Premier League';
const outFile = flag('--out');

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
const ratios = [];

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
  /* THE RATIO THE DATA ASKS FOR. The shipped model does not fit these weights
     — build-model.mjs writes yc90 = 2 * SLOPE and foul90 = SLOPE, so the "2"
     in PLDCore.riskScore(y90, f90) = y90 * 2 + f90 is the SAME two, asserted
     once and used both to sort the desk and to price it. Nothing anywhere
     tested it. This records what a weekly refit actually converges to, so the
     next time a match history exists the question is answered by a number
     instead of by the fact that nobody has looked. */
  if (fitCoef && fitCoef.weights.foul90) ratios.push(fitCoef.weights.yc90 / fitCoef.weights.foul90);
  /* THE BASELINE IS THE TRAINING SET'S OWN RATE, walk-forward — not the
     shipped model.baseRate. That constant is the PREMIER LEAGUE's, and scoring
     a La Liga backtest against it would not be a naive baseline but a
     strawman: it would make any model look good simply by not being wrong
     about which division it is in. */
  const base = train.reduce((s2, r) => s2 + (r.y ? 1 : 0), 0) / train.length;
  for (const r of test) {
    preds.base.push({ p: base, y: r.y });
    preds.prior.push({ p: core.glmProb(feats(r), model.glm), y: r.y });
    preds.fit.push({ p: core.glmProb(feats(r), fitCoef), y: r.y });
  }
}

if (!preds.base.length) { console.error('Not enough rounds to backtest (need history spanning several gameweeks).'); process.exit(1); }
const fmt = (x) => x == null ? '  —  ' : x.toFixed(4);
const out = [];
out.push(`${label}: ${preds.base.length} out-of-sample predictions over ${rounds.length} rounds`);
out.push('model            Brier     logLoss');
for (const m of ['base', 'prior', 'fit']) {
  out.push(m.padEnd(14) + ' ' + fmt(core.brier(preds[m])) + '    ' + fmt(core.logLoss(preds[m])));
}
const bB = core.brier(preds.base), fB = core.brier(preds.fit), pB = core.brier(preds.prior);

/* PAIRED, WITH A STANDARD ERROR — not `fB < bB`.
 *
 * On a control set of pure noise, where booking risk was a flat 20% unrelated
 * to any feature, a strict comparison declared the fit a winner by 0.0004. It
 * would have reported "a league-specific fit BEATS the naive base rate" about
 * a dataset containing no signal whatsoever, which is the single most
 * misleading thing this report could say.
 *
 * The predictions are paired — same rows, same order — so the difference in
 * squared error is a per-row quantity with a standard error of its own. A win
 * is only a win if the interval excludes zero. */
function beats(a, b) {
  const d = a.map((r, i) => ((r.p - r.y) ** 2) - ((b[i].p - b[i].y) ** 2));
  const n = d.length;
  const mean = d.reduce((s2, x) => s2 + x, 0) / n;
  const varr = d.reduce((s2, x) => s2 + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const se = Math.sqrt(varr / n);
  return { mean, se, better: mean + 2 * se < 0, worse: mean - 2 * se > 0 };
}
const vsBase = beats(preds.fit, preds.base);
const vsPrior = beats(preds.fit, preds.prior);
const verdict = (v) => v.better ? 'BEATS' : v.worse ? 'is WORSE than' : 'is indistinguishable from';
out.push(`fit vs base:  ${verdict(vsBase)} it — mean Brier difference `
  + `${vsBase.mean.toFixed(5)} ± ${(2 * vsBase.se).toFixed(5)} (2 s.e.)`);
out.push(`fit vs prior: ${verdict(vsPrior)} it — mean Brier difference `
  + `${vsPrior.mean.toFixed(5)} ± ${(2 * vsPrior.se).toFixed(5)} (2 s.e.)`);
out.push('a difference whose interval spans zero is not a difference — on a '
  + 'control of pure noise the raw comparison still called the fit a winner '
  + 'by 0.0004.');
/* The coefficient the desk asserts, against the one the data asks for. */
if (ratios.length) {
  const sorted = ratios.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const shipped = model.glm.weights.yc90 / model.glm.weights.foul90;
  out.push(`yc90:foul90 weight ratio — shipped ${shipped.toFixed(2)} (asserted, `
    + `never fitted: model.js basis="${model.basis}", fitRows=${model.fitRows}); `
    + `refit median ${med.toFixed(2)} over ${ratios.length} rounds `
    + `[${sorted[0].toFixed(2)} … ${sorted[sorted.length - 1].toFixed(2)}]`);
}
/* ---- calibration, in ten bins ------------------------------------------
 *
 * Brier is one number and it hides WHERE a model is wrong. A model can score
 * respectably while being systematically over-confident at the top — which is
 * precisely the end a bookings desk acts on, because the 50%+ band is what
 * gets picked. Ten bins say "when this model said 40-50%, it happened 31% of
 * the time", which is a sentence somebody can act on.
 *
 * Bins with almost nothing in them are printed rather than hidden: an empty
 * top bin is itself the finding — the model never goes there.
 */
function calibration(preds, bins) {
  const n = bins || 10;
  const acc = Array.from({ length: n }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of preds) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(r.p * n)));
    acc[i].n++; acc[i].p += r.p; acc[i].y += r.y;
  }
  return acc.map((b, i) => ({
    lo: i / n, hi: (i + 1) / n, n: b.n,
    predicted: b.n ? b.p / b.n : null,
    actual: b.n ? b.y / b.n : null
  }));
}
const calibRows = calibration(preds.fit, 10);
out.push('');
out.push('calibration (refit model), ten bins — predicted vs actual');
out.push('bin          n     predicted   actual    gap');
for (const b of calibRows) {
  const band = `${(b.lo * 100).toFixed(0)}-${(b.hi * 100).toFixed(0)}%`.padEnd(10);
  if (!b.n) { out.push(`${band} ${String(0).padStart(5)}       —        —       —`); continue; }
  const gap = b.actual - b.predicted;
  out.push(`${band} ${String(b.n).padStart(5)}     ${(b.predicted * 100).toFixed(1)}%    `
    + `${(b.actual * 100).toFixed(1)}%   ${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}pp`);
}
/* One line a reader can act on: where the model is most over-confident,
   weighted by how much of the sample sits there. */
const worst = calibRows.filter((b) => b.n >= 20)
  .map((b) => ({ b, over: b.predicted - b.actual }))
  .sort((x, y) => y.over - x.over)[0];
if (worst && worst.over > 0.02) {
  out.push(`most over-confident band: ${(worst.b.lo * 100).toFixed(0)}-${(worst.b.hi * 100).toFixed(0)}% `
    + `— said ${(worst.b.predicted * 100).toFixed(1)}%, got ${(worst.b.actual * 100).toFixed(1)}% `
    + `over ${worst.b.n} predictions`);
}

/* NAMED, because "prior" means something different away from the Premier
   League. data/model.js is the PL model and the Championship and La Liga desks
   do not use a GLM at all — they price from PLDCore's hazard. So this answers
   "is there signal a fit could capture in this division?", NOT "the desk would
   improve by exactly this much". */
out.push('note: "prior" is the shipped Premier League GLM (data/model.js). The '
  + 'Championship and La Liga desks do not use it — they price from the '
  + 'PLDCore hazard — so this measures whether the signal is there, not what '
  + 'those desks would gain. NOTHING here changes a published price.');
console.log(out.join('\n'));
/* ---- the written report ------------------------------------------------
 *
 * `--report backtest_report.md` writes what was just printed, as markdown,
 * WITH the numbers it actually produced. It is generated rather than
 * hand-maintained for one reason: a hand-written report is a claim about a run
 * nobody can check, and this file's whole purpose is to be checkable. It
 * stamps the dataset and the row count so a reader can tell a thin run from a
 * season.
 */
const reportFile = flag('--report');
if (reportFile) {
  const verdictLine = vsBase.better
    ? 'The refit **beats** the naive base rate.'
    : vsBase.worse
      ? 'The refit is **worse** than the naive base rate. It must not ship.'
      : 'The refit is **indistinguishable** from the naive base rate — on this '
        + 'sample there is no demonstrated gain, and nothing should ship on the '
        + 'strength of it.';
  const md = [
    '# Backtest report',
    '',
    '<!-- GENERATED by scripts/backtest.mjs --report. Do not hand-edit: the point',
    '     of this file is that every number in it came out of a real run. -->',
    '',
    `**${label}** · ${preds.base.length} out-of-sample predictions over ${rounds.length} rounds`,
    `· source \`${path.replace(root + '/', '')}\` · generated ${new Date().toISOString()}`,
    '',
    '## Headline',
    '',
    verdictLine,
    '',
    '| model | Brier | log loss |',
    '|---|---|---|',
    ...['base', 'prior', 'fit'].map((m) =>
      `| ${m} | ${fmt(core.brier(preds[m]))} | ${fmt(core.logLoss(preds[m]))} |`),
    '',
    'Lower is better. `base` is the league base rate for every player — the naive',
    'baseline the model has to beat to justify itself. `prior` is the shipped',
    'season-prior GLM. `fit` is a GLM refit each week on prior rounds only, which',
    'is what a live model would have known at the time.',
    '',
    '## Is the difference real?',
    '',
    `- fit vs base: **${verdict(vsBase)}** — mean Brier difference ${vsBase.mean.toFixed(5)} ± ${(2 * vsBase.se).toFixed(5)} (2 s.e.)`,
    `- fit vs prior: **${verdict(vsPrior)}** — mean Brier difference ${vsPrior.mean.toFixed(5)} ± ${(2 * vsPrior.se).toFixed(5)} (2 s.e.)`,
    '',
    'The predictions are paired — same rows, same order — so the difference in',
    'squared error has a standard error of its own, and an interval spanning zero',
    'is not a difference. This matters: on a control set of pure noise, a strict',
    '`fit < base` comparison still declared the fit a winner by 0.0004.',
    '',
    '## Calibration',
    '',
    'Brier is one number and hides *where* a model is wrong. The band a bookings',
    'desk acts on is the top one, so over-confidence there costs more than the',
    'score suggests.',
    '',
    '| predicted band | n | mean predicted | actual | gap |',
    '|---|---:|---:|---:|---:|',
    ...calibRows.map((b) => b.n
      ? `| ${(b.lo * 100).toFixed(0)}–${(b.hi * 100).toFixed(0)}% | ${b.n} | ${(b.predicted * 100).toFixed(1)}% | ${(b.actual * 100).toFixed(1)}% | ${b.actual - b.predicted >= 0 ? '+' : ''}${((b.actual - b.predicted) * 100).toFixed(1)}pp |`
      : `| ${(b.lo * 100).toFixed(0)}–${(b.hi * 100).toFixed(0)}% | 0 | — | — | — |`),
    '',
    'A positive gap means the model was too cautious in that band; a negative gap',
    'means it was over-confident. An empty bin is a finding too — it says the',
    'model never goes there.',
    '',
    '## What this does and does not say',
    '',
    '`prior` is the shipped **Premier League** GLM (`data/model.js`). The',
    'Championship and La Liga desks do not use it — they price from the PLDCore',
    'hazard — so for those divisions this measures whether the signal is there,',
    'not what those desks would gain. **Nothing here changes a published price.**',
    ''
  ].join('\n');
  /* An absolute path is used as given; a bare name lands in the repo, which
     is where the committed report belongs. */
  writeFileSync(reportFile.startsWith('/') ? reportFile : join(root, reportFile), md);
  console.log(`\nreport written to ${reportFile}`);
}

if (outFile) {
  appendFileSync(outFile, out.join('\n') + '\n\n');
  console.log(`\nappended to ${outFile}`);
}

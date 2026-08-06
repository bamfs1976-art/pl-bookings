// Are the desks pricing the same thing?
//
// Three competitions now appear on one page (/today) and in one share card, so
// a player's percentage on one desk is read against a player's percentage on
// another. That only means anything if the desks agree about what a percentage
// IS — and for a year they did not:
//
//   the Premier League priced through a logistic over yellows, fouls and
//   position; the Championship and La Liga through a Poisson hazard over the
//   shrunk yellow rate alone.
//
// Run over the SAME squads, those two produced a mean of 20.2% against 16.0%
// and a top end of 62% against 40%. Nothing was broken and nothing looked
// wrong; the two desks simply answered different questions, and putting them
// side by side invited a comparison neither supported.
//
// This guard pins the convergence. It is a CALIBRATION check, not a
// same-numbers check: the desks are allowed to differ because their leagues
// differ, and are not allowed to differ because their code does.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = readFileSync(join(root, 'assets', 'core.js'), 'utf8');
const model = (await import('file://' + join(root, 'data', 'model.js'))).default;

function load(file, playersKey) {
  const path = join(root, 'data', file);
  if (!existsSync(path)) return null;
  const c = {};
  vm.createContext(c);
  vm.runInContext(core, c);
  vm.runInContext(readFileSync(path, 'utf8'), c);
  const got = vm.runInContext(`({P: ${playersKey}, R: REFS})`, c);
  return { C: c.PLDCore, players: got.P, refs: got.R };
}

const DESKS = [
  { code: 'PL', name: 'Premier League', file: 'pl_data.js', key: 'PL_PLAYERS' },
  { code: 'EFLC', name: 'EFL Championship', file: 'eflc_data.js', key: 'EFLC_PLAYERS' },
  { code: 'LL', name: 'La Liga', file: 'laliga_data.js', key: 'LALIGA_PLAYERS' }
];

const S = model.shrink;
const mpick = (o, k, fb) => (o && o[k] != null ? o[k] : fb);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const quant = (a, x) => {
  const s = a.slice().sort((u, v) => u - v);
  return s[Math.floor(x * (s.length - 1))];
};

const seen = [];
for (const d of DESKS) {
  const got = load(d.file, d.key);
  if (!got) { console.log(`check-models: ${d.file} not built yet — skipping ${d.code}.`); continue; }
  const { C, players } = got;
  assert.ok(typeof C.pCardSeason === 'function',
    'assets/core.js no longer exports pCardSeason — the desks have no shared ' +
    'definition of a booking probability');

  const rows = players.filter((p) => (Number(p.min) || 0) > 0 && p.yc != null);
  assert.ok(rows.length > 100, `${d.code}: only ${rows.length} rated players`);

  const probs = [];
  let yc = 0, mins = 0;
  for (const p of rows) {
    const y = C.shrinkRate(p.yc || 0, p.min || 0,
      mpick(S.ycMean, p.p, S.ycLeague), S.strengthMatches);
    probs.push(C.pCardSeason(y));
    yc += p.yc || 0;
    mins += p.min || 0;
  }
  /* What the division ACTUALLY produced, as a probability: cards per 90 is a
     rate, and P(at least one) is 1 - exp(-rate). Comparing a mean probability
     to a mean rate is the mistake that makes a calibrated model look 8% low. */
  const rate = yc / (mins / 90);
  const observed = 1 - Math.exp(-rate);
  const got_ = mean(probs);

  /* Within a tenth of the league's own observed rate. Loose enough for
     shrinkage and squad composition, tight enough that a model answering a
     different question cannot pass — the logistic sat 26% high here. */
  const ratio = got_ / observed;
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `${d.name}: the desk prices a mean ${(got_ * 100).toFixed(1)}% against a ` +
    `division that produced ${(observed * 100).toFixed(1)}% ` +
    `(ratio ${ratio.toFixed(2)}) — it is not calibrated to its own league`);

  /* No player is booked in most of his matches. The most-carded player in a
     top division picks up about twelve yellows in thirty-eight games, which
     is a third of them. The logistic reached 62-70% here. */
  const max = Math.max(...probs);
  assert.ok(max < 0.55,
    `${d.name}: top P(card) is ${(max * 100).toFixed(1)}% — no player is ` +
    'booked in half his matches; the most-carded manage about a third');

  seen.push({ code: d.code, mean: got_, observed, max, median: quant(probs, 0.5) });
}

assert.ok(seen.length >= 2,
  'fewer than two desks are built, so nothing was actually compared');

/* THE POINT OF THE FILE. Every desk must be calibrated to its OWN league, and
   the leagues genuinely differ — Spain cards more than England. So this does
   not demand equal means; it demands that each desk's error against its own
   league is small and in the same direction. Two desks that are each within a
   tenth of their own division are comparable to each other by construction. */
for (const s of seen) {
  const err = s.mean / s.observed;
  assert.ok(err > 0.9 && err < 1.1, `${s.code} drifted: ratio ${err.toFixed(2)}`);
}
const spread = Math.max(...seen.map((s) => s.mean / s.observed))
             - Math.min(...seen.map((s) => s.mean / s.observed));
assert.ok(spread < 0.08,
  `the desks' calibration errors differ by ${(spread * 100).toFixed(1)} points — ` +
  'they are answering different questions again, which is what makes a ' +
  'cross-league percentage misleading:\n  ' +
  seen.map((s) => `${s.code} ${(s.mean / s.observed).toFixed(3)}`).join('\n  '));

/* The Premier League desk must not have quietly gone back to the logistic. */
const pm = readFileSync(join(root, 'assets', 'plmodel.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
assert.ok(/pCardSeason/.test(pm),
  'assets/plmodel.js no longer prices through PLDCore.pCardSeason');
assert.ok(!/glmProb\s*\(/.test(pm),
  'assets/plmodel.js is calling glmProb again — that is the model that sat 26% ' +
  'high and topped out at 62%, and it is what made the Premier League ' +
  'incomparable with the other two desks');

/* And neither has index.html. It keeps its own copy of pModelBase — the desk
   is a single-file app and that is not changing today — so the convergence has
   to be pinned in BOTH places or the desk and /today drift apart again, which
   is exactly what happened for one commit while this change was being made:
   the shared module was converged and the desk was not. */
const deskCode = readFileSync(join(root, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const deskBase = /function pModelBase\(p\)\{([\s\S]*?)\n\}/.exec(deskCode);
assert.ok(deskBase, 'could not find pModelBase in index.html');
assert.ok(/pCardSeason/.test(deskBase[1]),
  'index.html prices through something other than PLDCore.pCardSeason — the ' +
  'desk and /today would show different numbers for the same player');
assert.ok(!/glmProb/.test(deskBase[1]),
  'index.html is pricing through glmProb again — that is the model that sat ' +
  '26% high and made this desk incomparable with the other two');

console.log(
  'check-models OK: ' + seen.map((s) =>
    `${s.code} prices ${(s.mean * 100).toFixed(1)}% against ` +
    `${(s.observed * 100).toFixed(1)}% observed ` +
    `(max ${(s.max * 100).toFixed(0)}%)`).join('; ')
);

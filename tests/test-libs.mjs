// Unit tests for the four library-backed modules — run with:
//   node tests/test-libs.mjs
//
// The libraries themselves (Tabulator, jStat, simple-statistics, PapaParse)
// are vendored INTO index.html rather than installed, so there is nothing to
// require. Each is extracted from the page here and evaluated, which has a
// second use beyond making the tests runnable: it proves the embedded blocks
// are loadable JavaScript that defines the global the app then calls. A
// vendored block that is subtly truncated throws nothing at build time and
// takes a view down at runtime.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

/* ---- the vendored libraries, out of the page ---------------------------- */
const page = read('index.html');
function vendored(id) {
  const a = page.indexOf(`<!-- VENDOR:${id} START -->`);
  const b = page.indexOf(`<!-- VENDOR:${id} END -->`);
  assert.ok(a > -1 && b > a, `index.html has no VENDOR:${id} block`);
  const chunk = page.slice(a, b);
  const open = chunk.indexOf('<script>');
  const close = chunk.lastIndexOf('</script>');
  assert.ok(open > -1 && close > open, `VENDOR:${id} carries no <script>`);
  return chunk.slice(open + 8, close);
}

/* One sandbox, loaded in the page's own order, because that is the thing being
   tested: these files are siblings in one global and they must not collide. */
const sandbox = { console, module: undefined, exports: undefined, define: undefined };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
for (const id of ['jstat', 'simple-statistics', 'papaparse']) {
  vm.runInContext(vendored(id), sandbox, { filename: `vendor:${id}` });
}
const { jStat, ss, Papa } = sandbox;

console.log('vendored libraries');
t('every vendored block evaluates and defines its global', () => {
  assert.equal(typeof jStat, 'function', 'jStat');
  assert.equal(typeof ss, 'object', 'simple-statistics');
  assert.equal(typeof Papa, 'object', 'PapaParse');
  /* Tabulator's factory reaches for a real DOM, so it is not run here — the
     browser is where it is actually exercised. What IS checked is the failure
     this test exists for: a vendored block that is truncated or mangled.
     Compiling it proves it is whole JavaScript, and the UMD tail proves the
     bytes that install the constructor are still on the end of it. A file cut
     short throws nothing at build time and empties a view at runtime. */
  const tab = vendored('tabulator-js');
  new vm.Script(tab, { filename: 'vendor:tabulator' });
  assert.match(tab, /\.Tabulator=/, 'the UMD global assignment is missing');
  assert.match(tab.trimEnd(), /\)\);$/, 'the block does not end on a closed call');
});
t('no vendored block points at a source map', () => {
  /* A map reference is a request to a file this page does not ship, on a page
     whose whole claim is that it makes none. Checked on the PAYLOAD, past the
     licence header — the header is allowed to mention the removal, and an
     earlier version of this test was satisfied by its own comment. */
  for (const id of ['tabulator-css', 'tabulator-js', 'jstat', 'simple-statistics', 'papaparse']) {
    const a = page.indexOf(`<!-- VENDOR:${id} START -->`);
    const b = page.indexOf(`<!-- VENDOR:${id} END -->`);
    const block = page.slice(a, b);
    const payload = block.slice(block.indexOf('\n */\n') + 5);
    assert.ok(!/sourceMappingURL/.test(payload), `${id} still points at a source map`);
  }
});
t('every vendored block names its package, version and licence', () => {
  for (const [id, needle] of [
    ['tabulator-js', 'tabulator-tables v6.3.1'],
    ['jstat', 'jstat v1.9.6'],
    ['simple-statistics', 'simple-statistics v7.8.8'],
    ['papaparse', 'papaparse v5.4.1'],
  ]) {
    const a = page.indexOf(`<!-- VENDOR:${id} START -->`);
    const b = page.indexOf(`<!-- VENDOR:${id} END -->`);
    const block = page.slice(a, b);
    assert.ok(block.includes(needle), `${id} does not name ${needle}`);
    assert.ok(block.includes('MIT licence'), `${id} does not name its licence`);
  }
});

/* ---- the shipped data --------------------------------------------------- */
const dataCtx = {};
vm.createContext(dataCtx);
vm.runInContext(read('data/pl_data.js') + ';globalThis.out={CLUBS,PL_PLAYERS,REFS};', dataCtx);
const { CLUBS, PL_PLAYERS, REFS } = dataCtx.out;
const RECORD = require('../data/pl_backtest_2526.js');

const PLCardModel = require('../assets/cardmodel.js');
const PLBacktest = require('../assets/backtest.js');
const PLAdminImport = require('../assets/adminimport.js');
const model = PLCardModel.create({ jStat, players: PL_PLAYERS, clubs: CLUBS, refs: REFS, record: RECORD });

/* ---- the card model ----------------------------------------------------- */
console.log('\ncard model — the referee leg');
t('an official with 10+ matches prices off his own rate', () => {
  const strict = REFS.find((r) => r.matches >= 10 && r.ypg > 4.2);
  const c = model.refereeContext(strict.n);
  assert.equal(c.qualified, true);
  assert.equal(c.ypg, strict.ypg);
  assert.equal(c.source, 'referee');
  assert.ok(c.factor > 1, 'a strict official should mark a player up');
});
t('an official under 10 matches is priced at the 3.71 pivot, not his own rate', () => {
  /* This is the guard that matters. A referee with three strict games is not
     a strict referee, and pricing him as one is a confident number built on
     nothing — which is indistinguishable, on screen, from a real signal. */
  const thin = REFS.find((r) => r.matches != null && r.matches < 10);
  assert.ok(thin, 'the shipped table should contain at least one thin official');
  const c = model.refereeContext(thin.n);
  assert.equal(c.qualified, false);
  assert.equal(c.ypg, 3.71);
  assert.equal(c.source, 'pivot');
  assert.equal(c.factor, 1, 'the pivot must be exactly neutral');
});
t('no appointment is neutral, and says so rather than guessing', () => {
  const c = model.refereeContext(null);
  assert.equal(c.factor, 1);
  assert.equal(c.source, 'unassigned');
});
t('a single official cannot swamp the model', () => {
  const wild = PLCardModel.create({ jStat, players: PL_PLAYERS, clubs: CLUBS,
    refs: [{ n: 'Mad', matches: 40, ypg: 20 }, { n: 'Meek', matches: 40, ypg: 0.1 }], record: RECORD });
  assert.equal(wild.refereeContext('Mad').factor, 1.3);
  assert.equal(wild.refereeContext('Meek').factor, 0.75);
});

console.log('\ncard model — the venue leg');
t('a club with its own home/away split is priced on it', () => {
  const c = CLUBS.find((x) => x.basis === 'PL' && x.caH != null && x.caA != null);
  const h = model.venueContext(c.short, true), a = model.venueContext(c.short, false);
  assert.equal(h.source, 'club');
  assert.equal(a.source, 'club');
  assert.ok(Math.abs(h.factor - c.caH / c.ca) < 1e-9 || h.factor === 0.8 || h.factor === 1.25);
  assert.notEqual(h.factor, a.factor, 'the two venues must not price the same');
});
t('a promoted club with no split falls back to the league factors, flagged', () => {
  const c = CLUBS.find((x) => x.basis !== 'PL');
  assert.ok(c, 'the shipped clubs should include a promoted side');
  const h = model.venueContext(c.short, true), a = model.venueContext(c.short, false);
  assert.equal(h.source, 'league');
  assert.equal(h.factor, 0.95);
  assert.equal(a.factor, 1.08);
});
t('away is dearer than home across the league, which is what the record shows', () => {
  const pl = CLUBS.filter((c) => c.basis === 'PL');
  const gap = pl.filter((c) => model.venueContext(c.short, false).factor
    > model.venueContext(c.short, true).factor).length;
  assert.ok(gap >= pl.length * 0.6, `only ${gap}/${pl.length} clubs price away above home`);
});

console.log('\ncard model — the opponent leg');
t('a club in the 2025/26 record is priced on its own fouls drawn', () => {
  const c = model.opponentContext('CHE');
  assert.equal(c.source, 'record');
  assert.ok(c.drawn > 5 && c.drawn < 20, `implausible fouls drawn: ${c.drawn}`);
});
t('a promoted club has no record, and gets a neutral factor rather than an average', () => {
  /* The licence rule in the flesh: the 2025/26 Premier League record cannot
     cover a club that was not in it, and the honest answer is "no data", not
     the league mean wearing a club's name. */
  const c = model.opponentContext('COV');
  assert.equal(c.source, 'none');
  assert.equal(c.factor, 1);
  assert.equal(c.drawn, null);
});
t('a hand-entered figure is used, and is labelled as hand-entered', () => {
  const m = PLCardModel.create({ jStat, players: PL_PLAYERS, clubs: CLUBS, refs: REFS, record: RECORD });
  assert.equal(m.setManualFoulsDrawn('COV', 12.5), true);
  const c = m.opponentContext('COV');
  assert.equal(c.source, 'manual');
  assert.equal(c.drawn, 12.5);
  assert.ok(c.factor > 1);
  m.setManualFoulsDrawn('COV', null);
  assert.equal(m.opponentContext('COV').source, 'none');
});

console.log('\ncard model — the probability');
t('P(card) is the Poisson complement of the expected count', () => {
  const p = PL_PLAYERS.find((x) => x.min > 1000 && x.y > 0.2);
  const r = model.playerFixture(p, { isHome: true, ref: null, opponent: null });
  assert.ok(r.rated);
  assert.ok(Math.abs(r.p - (1 - Math.exp(-r.lambda))) < 1e-9,
    'the hazard and jStat must agree — they are the same distribution');
});
t('the working multiplies out to the lambda it reports', () => {
  const p = PL_PLAYERS.find((x) => x.min > 1000 && x.y > 0.2);
  const w = model.playerFixture(p, { isHome: false, ref: 'Anthony Taylor', opponent: 'CHE' }).working;
  const rebuilt = w.shrunkRate * w.minuteShare * w.venue.factor * w.referee.factor * w.opponent.factor;
  assert.ok(Math.abs(rebuilt - w.lambda) < 1e-12,
    'the explanation on screen must be the arithmetic that ran');
});
t('a player with no card record is refused rather than priced', () => {
  const p = PL_PLAYERS.find((x) => x.y == null);
  if (!p) return;                      // the shipped set may carry none
  const r = model.playerFixture(p, { isHome: true });
  assert.equal(r.rated, false);
  assert.equal(r.p, null);
});
t('the whole league prices near the rate the division actually produces', () => {
  /* 16% cards per player-match is the figure assets/core.js pins the desk's
     other models to. A model that drifts off it is not a rounding difference,
     it is a different product. */
  const ps = PL_PLAYERS.filter((x) => x.min >= 450)
    .map((x) => model.playerFixture(x, { isHome: true }).p).filter((x) => x != null);
  const mean = ss.mean(ps);
  assert.ok(mean > 0.11 && mean < 0.21, `league mean P(card) is ${mean.toFixed(3)}`);
  assert.ok(Math.max(...ps) < 0.5, 'no player in this division is a coin flip to be booked');
});

console.log('\ncard model — conviction');
t('conviction rises with minutes and is exactly half at the floor', () => {
  const at = { c: 'ARS', n: 'x', p: 'MF', min: 450, y: 0.2, f: 1.5, b: 'PL' };
  const lots = { ...at, min: 3150 };
  assert.equal(model.conviction(at), 50);
  assert.equal(model.conviction(lots), 88);
  assert.ok(model.conviction(lots) > model.conviction(at));
});
t('a Championship rate is discounted, not discarded', () => {
  /* Championship data is a WIDE-ERROR PRIOR, not an absence. It has to score
     below a Premier League rate on the same minutes and above nothing at all,
     or the standing rule is not implemented, only written down. */
  const mins = 1800;
  const pl = model.conviction({ c: 'ARS', n: 'a', p: 'MF', min: mins, y: 0.2, b: 'PL' });
  const efl = model.conviction({ c: 'COV', n: 'b', p: 'MF', min: mins, y: 0.2, b: 'EFL' });
  const none = model.conviction({ c: 'COV', n: 'c', p: 'MF', min: mins, y: null, b: 'NEW' });
  assert.ok(efl < pl, 'Championship minutes must not score as Premier League minutes');
  assert.ok(efl > 0, 'Championship minutes are evidence, not an absence');
  assert.equal(none, 0, 'no record at all must score nothing');
});

console.log('\ncard model — the venue split column');
t('the split is the venue factor and nothing else', () => {
  const p = PL_PLAYERS.find((x) => x.c === 'ARS' && x.min > 900 && x.y > 0.2);
  const s = model.venueSplit(p);
  assert.ok(s.home != null && s.away != null);
  assert.ok(s.away > s.home, 'Arsenal concede more cards away; the split must show it');
  assert.ok(Math.abs(s.spread - (s.away - s.home)) < 1e-12);
});

/* ---- the backtest ------------------------------------------------------- */
console.log('\nbacktest');
const bt = PLBacktest.run({ ss, jStat, data: RECORD, threshold: 2 });
t('it runs over the shipped 2025/26 record', () => {
  assert.equal(RECORD.matches.length, 380);
  assert.ok(bt.n > 500, `only ${bt.n} scored forecasts`);
  assert.equal(bt.level, 'team-match');
});
t('nothing about a match reaches its own forecast', () => {
  /* The whole test is worthless if it leaks. Re-run over a copy with every
     card count doubled from a chosen date onward: forecasts BEFORE that date
     must be bit-identical, because none of them may have seen a later match. */
  const cut = RECORD.matches[200].d;
  const tampered = {
    ...RECORD,
    matches: RECORD.matches.map((m) => (m.d > cut ? { ...m, hy: m.hy * 2, ay: m.ay * 2 } : m)),
  };
  const other = PLBacktest.run({ ss, jStat, data: tampered, threshold: 2 });
  const before = bt.rows.filter((r) => r.date <= cut);
  const otherBefore = other.rows.filter((r) => r.date <= cut);
  assert.equal(before.length, otherBefore.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(before[i].model, otherBefore[i].model,
      `forecast on ${before[i].date} moved when a LATER match changed — the backtest leaks`);
  }
});
t('Brier is the mean squared error, on both models', () => {
  const manual = ss.mean(bt.rows.map((r) => (r.model - r.actual) ** 2));
  assert.ok(Math.abs(manual - bt.model.brier) < 1e-12);
});
t('the baseline knows nothing about the two sides, only the season so far', () => {
  /* It is a RUNNING season average, so it moves as the season accumulates —
     but within any one match both sides must get the identical number, because
     that is the definition of "no adjustments". The moment a baseline can tell
     Arsenal from Burnley it has stopped being the thing the model has to beat. */
  const byMatch = new Map();
  for (const r of bt.rows) {
    const key = r.date + '|' + [r.team, r.opponent].sort().join('|');
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key).push(r);
  }
  let pairs = 0, modelDiffers = 0;
  for (const [key, rs] of byMatch) {
    if (rs.length !== 2) continue;
    pairs++;
    assert.equal(rs[0].baseline, rs[1].baseline, `the baseline split the two sides of ${key}`);
    if (rs[0].model !== rs[1].model) modelDiffers++;
  }
  assert.ok(pairs > 200, `only ${pairs} complete matches to compare`);
  assert.equal(modelDiffers, pairs, 'the model must price the two sides of a match differently');
  /* And the spread. The baseline cannot discriminate at all; the model must. */
  const spread = (xs) => ss.max(xs) - ss.min(xs);
  assert.ok(spread(bt.rows.map((r) => r.model)) > 8 * spread(bt.rows.map((r) => r.baseline)));
  const first = bt.rows[0];
  assert.ok(Math.abs(first.baseline - (1 - Math.exp(-first.baseLambda) * (1 + first.baseLambda))) < 1e-9);
});
t('the deciles hold every scored row exactly once', () => {
  const n = bt.model.calibration.reduce((s, b) => s + b.n, 0);
  assert.equal(n, bt.n);
  assert.equal(bt.model.calibration.length, 10);
});
t('a verdict of "better" requires the interval to clear zero', () => {
  /* The rule this project runs on: a point estimate on the right side of
     nothing is not a finding. On a control set of pure noise the strict
     comparison declares a winner about half the time. */
  assert.ok(['model-better', 'model-worse', 'indistinguishable'].includes(bt.verdict));
  if (bt.verdict === 'model-better') assert.ok(bt.diff.hi < 0);
  if (bt.verdict === 'model-worse') assert.ok(bt.diff.lo > 0);
  if (bt.verdict === 'indistinguishable') assert.ok(bt.diff.lo <= 0 && bt.diff.hi >= 0);
});
t('the shipped record does not let the model claim a win', () => {
  /* Pinned deliberately. This is the result as it stands — the adjustments do
     not measurably beat a season average on this test, at any of the three
     thresholds — and if a change to the model ever flips it, that is a finding
     that deserves a failing test and a fresh look, not a quiet green tick. */
  for (const th of [1, 2, 3]) {
    const r = PLBacktest.run({ ss, jStat, data: RECORD, threshold: th });
    assert.equal(r.verdict, 'indistinguishable',
      `threshold ${th} now reports "${r.verdict}" — re-read the Methodology view`);
  }
});
t('a model given the answer would be caught', () => {
  /* The leak test above proves this test can fail. Fed perfect foresight the
     Brier score collapses; if it did not, the harness would be measuring
     nothing and every other assertion here would be decoration. */
  const perfect = bt.rows.map((r) => (r.actual ? 0.999 : 0.001));
  const actual = bt.rows.map((r) => r.actual);
  assert.ok(PLBacktest.brier(ss, perfect, actual) < 0.001);
});

/* ---- the import --------------------------------------------------------- */
console.log('\nCSV import');
function parse(csv, opts) {
  let out = null;
  PLAdminImport.parse(csv, { Papa, ...(opts || {}) }, (r) => { out = r; });
  assert.ok(out, 'PapaParse did not call back synchronously');
  return out;
}
const HEAD = 'club,name,position,minutes,yellows,reds,fouls,fouls_won,basis';
t('a clean file produces a pl_data.js block that parses back', () => {
  const r = parse(`${HEAD}\nARS,Declan Rice,MF,3150,7,0,38,44,PL\n`);
  assert.equal(r.ok, true);
  assert.equal(r.summary.accepted, 1);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(r.output + ';globalThis.n=PL_PLAYERS.length;globalThis.p=PL_PLAYERS[0];', ctx);
  assert.equal(ctx.n, 1);
  assert.equal(ctx.p.n, 'Declan Rice');
  assert.equal(ctx.p.y, 0.2);            // 7 yellows in 35 nineties
  assert.equal(ctx.p.f, 1.09);           // 38 fouls in 35 nineties, at the file's precision
  /* Computed from the numbers the file actually carries, not from unrounded
     intermediates — a reader recomputing the risk score from the y and f in
     front of them has to get the r in front of them. */
  assert.equal(ctx.p.r, 1.49);
  assert.equal(ctx.p.ls, false);
});
t('a name with a quote in it cannot break the literal', () => {
  const r = parse(`${HEAD}\nARS,"O'Neill, Sam ""Doc""",DF,900,3,0,20,,PL\n`);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(r.output + ';globalThis.p=PL_PLAYERS[0];', ctx);
  assert.equal(ctx.p.n, 'O\'Neill, Sam "Doc"');
});
t('column aliases are accepted; a missing required column is fatal', () => {
  assert.equal(parse('team,player,pos,mins,yc,fouls\nARS,A B,MF,900,2,20\n').ok, true);
  const bad = parse('team,player,pos,yc,fouls\nARS,A B,MF,2,20\n');
  assert.equal(bad.ok, false);
  assert.match(bad.fatal, /minutes/);
});
t('a row under the floor is flagged, emitted, and marked ls:true', () => {
  const r = parse(`${HEAD}\nARS,Thin,DF,300,2,0,10,,PL\n`);
  assert.equal(r.summary.belowFloor, 1);
  assert.equal(r.summary.accepted, 1);
  assert.match(r.output, /ls:true/);
});
t('a blank fouls cell is null, never nought', () => {
  /* Read as nought it fits the player as the most disciplined in the
     division, and nothing on screen would say why. */
  const r = parse(`${HEAD}\nARS,No Fouls,DF,900,2,0,,,PL\n`);
  assert.match(r.output, /f:null/);
  assert.ok(!/f:0[,}]/.test(r.output));
  assert.ok(r.summary.warnings.some((w) => /fouls/.test(w.msg)));
});
t('an unknown club is rejected when the club list is supplied', () => {
  const r = parse(`${HEAD}\nZZZ,Nobody,MF,900,2,0,20,,PL\n`, { clubs: CLUBS.map((c) => c.short) });
  assert.equal(r.summary.accepted, 0);
  assert.equal(r.summary.rejected, 1);
  assert.ok(r.summary.errors.some((e) => /ZZZ/.test(e.msg)));
});
t('a rejected row does not bury its errors under advice', () => {
  const r = parse(`${HEAD}\nARS,Broken,QQ,-1,,0,,,PL\n`);
  assert.equal(r.summary.rejected, 1);
  assert.equal(r.summary.belowFloor, 0, 'a row that is not shipping has no floor status');
  assert.equal(r.summary.warnings.length, 0);
  assert.ok(r.summary.errors.length >= 3);
});
t('the emitted risk score is the standing formula, not a new one', () => {
  const r = parse(`${HEAD}\nARS,Formula,MF,900,3,0,15,,PL\n`);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(r.output + ';globalThis.p=PL_PLAYERS[0];', ctx);
  assert.equal(ctx.p.y, 0.3);
  assert.equal(ctx.p.f, 1.5);
  assert.equal(ctx.p.r, require('../assets/core.js').riskScore(0.3, 1.5));
});

console.log(`\n${passed} tests passed`);

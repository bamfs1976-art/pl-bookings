#!/usr/bin/env node
/* Guard the derby list — the one list, and the route that shows it.
 *
 * WHY THIS EXISTS. Which fixtures are derbies was written down in FOUR places:
 * assets/core.js, assets/plmodel.js, and inline in eflc.html and laliga.html.
 * Each was reachable only from inside its own page, so nothing could draw the
 * set across the three divisions — which is why /derbies could not be built
 * until they were folded together.
 *
 * They had also already disagreed, silently and for a long time. core.js
 * carried thirteen Premier League pairs and plmodel.js twelve; the odd one was
 * Brentford v Fulham. core.js called it a West London derby, so the backtest
 * EXCLUDED both fixtures from its rest-effect control as card-heavy; plmodel.js
 * did not, so the desk priced them with no derby boost and drew no chip. Two
 * answers to one question, neither of them flagged, from two lists nobody had
 * reason to compare.
 *
 * So this asserts, in order:
 *   1. core.js is the ONLY place pairs are written down.
 *   2. plmodel.js — and through it index.html — resolves to exactly core's set.
 *   3. every short code is a real club in that league's own shipped dataset.
 *   4. every pair names its rivalry, because the name is what the page prints.
 *   5. every pair produces exactly two fixtures, so a code that is valid but
 *      belongs to a club that does not play is caught too.
 *   6. the /derbies route is wired end to end.
 *
 *     node scripts/check-derbies.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

const coreSrc = read('assets', 'core.js');
const coreCtx = {};
vm.createContext(coreCtx);
vm.runInContext(coreSrc, coreCtx);
const C = vm.runInContext('PLDCore', coreCtx);

const LEAGUES = [
  { code: 'PL', name: 'Premier League',
    data: 'pl_data.js', fixtures: 'pl_fixtures.js', fxGlobal: 'PL_FIXTURES' },
  { code: 'EFLC', name: 'Championship',
    data: 'eflc_data.js', fixtures: 'eflc_fixtures.js', fxGlobal: 'EFLC_FIXTURES' },
  { code: 'LL', name: 'La Liga',
    data: 'laliga_data.js', fixtures: 'laliga_fixtures.js', fxGlobal: 'LALIGA_FIXTURES' },
];

/* ---- 1. one list, and only one ------------------------------------------ */
/*
 * A pair list looks the same wherever it is written: a DERB-something binding
 * whose array holds a two-code literal. Matching the SHAPE rather than a file
 * list is deliberate — a fifth copy will be written by someone solving a
 * different problem, and they will not think to add their file here.
 */
const PAIR_LIST = /DERB[A-Z_]*\s*(?:=|:)\s*(?:\{[\s\S]{0,400}?)?\[[\s\S]{0,240}?\[\s*'[A-Z]{2,4}'\s*,\s*'[A-Z]{2,4}'\s*[,\]]/;
const sources = [
  ...readdirSync(join(root, 'assets')).filter((f) => f.endsWith('.js'))
    .map((f) => ['assets', f]),
  ...readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => [f]),
];
const withList = sources.filter((p) => PAIR_LIST.test(read(...p)))
  .map((p) => p.join('/'));
assert.deepEqual(withList, ['assets/core.js'],
  `derby pairs are written down in more than one place: ${withList.join(', ')}. ` +
  'They belong in assets/core.js only — see the note there. Four copies is ' +
  'how core.js and plmodel.js came to disagree about Brentford v Fulham.');

/* ---- 2. everything downstream resolves to core's set -------------------- */
/*
 * Not "does plmodel.js contain a literal" — it does not any more, and asserting
 * on the source would pass a file that reads the wrong global. This RUNS it and
 * compares the set it actually publishes, which is what index.html reads.
 */
const key = (d) => [d[0], d[1]].sort().join('|');
/* Both files into ONE context, in the order the pages load them, so plmodel
   finds core exactly the way it does in a browser rather than through a
   handwritten stub of the global it expects. */
const pmCtx = {};
vm.createContext(pmCtx);
vm.runInContext(coreSrc, pmCtx);
vm.runInContext(read('assets', 'plmodel.js'), pmCtx);
const PM = vm.runInContext('PLModel', pmCtx);
assert.ok(PM && PM.DERBIES, 'assets/plmodel.js publishes no DERBIES');
assert.deepEqual(
  PM.DERBIES.map(key).sort(), C.DERBIES.map(key).sort(),
  'assets/plmodel.js and assets/core.js disagree about which Premier League ' +
  'fixtures are derbies. That is the exact drift this guard exists for: the ' +
  'desk prices off plmodel and the backtest controls off core.');

/* index.html and the two other desks must READ the shared list rather than
   rebuild one. A local `function isDerby` that closes over a local array is
   the shape that reintroduces the problem, so check they route through it. */
for (const [file, needle] of [
  ['index.html', 'PLModel.DERBIES'],
  ['eflc.html', 'C.isDerby(h, a, DERBY_LEAGUE)'],
  ['laliga.html', 'C.isDerby(h, a, DERBY_LEAGUE)'],
]) {
  assert.ok(read(file).includes(needle),
    `${file} no longer reads the shared derby list (looked for ${needle})`);
}

/* ---- 3-5. the pairs themselves ------------------------------------------ */
let checked = 0, total = 0;
const report = [];
for (const L of LEAGUES) {
  const pairs = C.derbyPairs(L.code);
  assert.ok(pairs.length > 0, `${L.name} has no derby pairs at all`);

  /* Every pair names its rivalry. The names were COMMENTS in all four copies,
     which is why every desk printed the same bare word "derby" — a name no
     code can read is a name the reader never sees. */
  const unnamed = pairs.filter((p) => !p.name || !p.name.trim());
  assert.equal(unnamed.length, 0,
    `${L.name} pairs with no rivalry name: ` +
    unnamed.map((p) => `${p.a}/${p.b}`).join(', '));

  const seen = new Set();
  for (const p of pairs) {
    assert.notEqual(p.a, p.b, `${L.name}: ${p.a} is listed against itself`);
    const k = [p.a, p.b].sort().join('|');
    assert.ok(!seen.has(k), `${L.name}: ${p.a}/${p.b} is listed twice`);
    seen.add(k);
  }

  /* The dataset is produced by the refresh workflow; CI on a fresh clone must
     not fail for its absence. Everything above this point is source-only and
     always runs. */
  const dataPath = join(root, 'data', L.data);
  const fxPath = join(root, 'data', L.fixtures);
  if (!existsSync(dataPath) || !existsSync(fxPath)) {
    report.push(`${L.name}: ${pairs.length} pairs (dataset not built — ` +
                'club and fixture checks skipped)');
    continue;
  }
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(dataPath, 'utf8'), ctx);
  vm.runInContext(readFileSync(fxPath, 'utf8'), ctx);
  const CLUBS = vm.runInContext('CLUBS', ctx);
  const FX = vm.runInContext(L.fxGlobal, ctx);
  const shorts = new Set(CLUBS.map((c) => c.short));

  /* A GUESSED SHORT CODE PRODUCES A DERBY THAT DOES NOT EXIST — it simply
     never matches a fixture, so the pair is silently inert and the rivalry is
     missing from the page with nothing to say so. */
  const ghosts = pairs.flatMap((p) => [p.a, p.b]).filter((s) => !shorts.has(s));
  assert.equal(ghosts.length, 0,
    `${L.name} derby pairs name clubs that are not in the division: ` +
    `${[...new Set(ghosts)].join(', ')}`);

  /* EXACTLY TWO FIXTURES A PAIR. All three ship a full double round-robin, so
     a pair that produces one or none is a code that is valid for a club that
     does not play — which the check above cannot see. */
  const count = new Map();
  for (const fx of FX) {
    const k = [fx.h, fx.a].sort().join('|');
    if (seen.has(k)) count.set(k, (count.get(k) || 0) + 1);
  }
  const wrong = [...seen].filter((k) => count.get(k) !== 2);
  assert.equal(wrong.length, 0,
    `${L.name} derby pairs without exactly two fixtures: ` +
    wrong.map((k) => `${k} has ${count.get(k) || 0}`).join(', '));

  const n = [...count.values()].reduce((a, b) => a + b, 0);
  total += n;
  checked += 1;
  report.push(`${L.name}: ${pairs.length} rivalries, ${n} fixtures`);
}

/* ---- 6. the route is wired end to end ----------------------------------- */
/*
 * Every one of these has been the thing that was forgotten on a previous route:
 * the redirect (a pretty path that 404s), the precache (a route that works on
 * wifi and is blank on the Underground), the nav item on all four pages (a page
 * nobody can reach), and the CSS (every route's blocks on every route).
 */
const redirects = read('_redirects');
assert.ok(/^\/derbies\s+\/today\.html\s+200/m.test(redirects),
  '_redirects has no /derbies rule, so the path falls through to the ' +
  'catch-all and serves the Premier League desk');
/* BEFORE THE CATCH-ALL, which is the half of the rule that is easy to get
   wrong: Netlify takes the first match, so a rule written below `/*` is a rule
   that never runs, and /derbies would serve the Premier League desk with a 200
   and no sign anything was wrong. */
/* THE CATCH-ALL IS A LINE THAT STARTS WITH `/*`, not the first `/*` in the
   file — the first is inside `/api/fpl/*` on line one, which made this pass
   for a reason that had nothing to do with the catch-all. */
const catchAll = /^\/\*\s/m.exec(redirects);
assert.ok(catchAll, '_redirects has no catch-all rule at all');
assert.ok(redirects.indexOf('/derbies') < catchAll.index,
  '_redirects lists /derbies after the catch-all, so the catch-all wins and ' +
  'the route silently serves the Premier League desk');
assert.ok(read('sw.js').includes("'/derbies'"),
  'sw.js does not precache /derbies, so it is blank with no connection');
for (const f of ['index.html', 'eflc.html', 'laliga.html', 'today.html']) {
  assert.ok(read(f).includes('class="lb-item lb-derbies" href="/derbies"'),
    `${f} has no league-bar link to /derbies`);
}
const today = read('today.html');
assert.ok(today.includes("'derbies'") && today.includes('data-for="derbies"'),
  'today.html does not stamp or mark the derbies route');
/* BOTH RULES BY NAME, not "does the route appear anywhere in the stylesheet".
   The loose version passed with the block that hides the fixture list still
   present and the one that hides the other routes' heroes deleted — a guard
   satisfied by a line it was not written about, which is no guard. */
const css = read('assets', 'tw.css');
assert.ok(css.includes('[data-route="derbies"] [data-for]:not([data-for~="derbies"])'),
  'assets/tw.css no longer hides the other routes\' blocks on /derbies, so the ' +
  'page shows every route\'s hero at once');
assert.ok(/\[data-route="derbies"\]\s*#listCard/.test(css),
  'assets/tw.css no longer hides the fixture list on /derbies');
/*
 * THE ROUTE GATES MUST BE INCLUSIONS. Written the other way — each card naming
 * the routes it is absent from — a new route matches none of the exclusions and
 * inherits every card. That is not hypothetical: /derbies drew the day's acca
 * and the week's nine-fold under the derby list on its first run, because both
 * gates read `if (ROUTE === 'season')` and `if (ROUTE === 'home')`.
 */
assert.ok(/function onRoute\(/.test(today),
  'today.html no longer has onRoute(), the inclusion gate its cards share');
const exclusions = today.match(/if \(ROUTE [!=]==? '(home|season|accas|derbies)'\)\s*\{\s*card\.hidden/g);
assert.equal(exclusions, null,
  `today.html has route gates written as direct ROUTE comparisons: ` +
  `${(exclusions || []).join(' / ')}. Use onRoute('a b'), which names the ` +
  'routes a card BELONGS to — an exclusion silently admits the next route.');

console.log(`check-derbies OK: one list in assets/core.js, ${report.length} ` +
  `divisions${checked ? `, ${total} derby fixtures` : ''}\n  ` +
  report.join('\n  '));

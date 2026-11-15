// Guard for referee appointment alerts on all four desks: `node scripts/check-alerts.mjs`.
//
// Against the committed data of every league:
//   1. the sender's league table names files that exist and define what it
//      reads, and each league's memory, page and tag are its own;
//   2. every fixture with a named referee, past or future, produces an alert
//      with a real number or an honest "no card record yet", the league
//      figure beside it, and no broken values;
//   3. one browser starring players on four desks keeps all four lists:
//      each desk's re-sync replaces only its own league;
//   4. the desks offer the card, under their own league code, re-sync on
//      every star, and the sign-up is a button press with no account.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const C = require('../assets/core.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const cron = require('../netlify/functions/push-cron.js');

const load = (path, name) => {
  const ctx = Object.create(null);
  vm.createContext(ctx);
  vm.runInContext(read(path.replace(/^\//, '')), ctx);
  return vm.runInContext(name, ctx);
};

/* 1. The league table. */
assert.deepEqual(cron.LEAGUES.map((L) => L.code), ['PL', 'EFLC', 'LL', 'SA'], 'the sender does not cover all four desks');
assert.equal(new Set(cron.LEAGUES.map((L) => L.state)).size, 4, 'two leagues share one memory, so one would replay the other');
assert.equal(cron.LEAGUES[0].state, 'appointments', 'the Premier League lost the state key existing subscribers rely on');
let alerts = 0, rated = 0;
for (const L of cron.LEAGUES) {
  for (const [path, name] of [L.fixtures, L.refs]) {
    assert.ok(existsSync(join(root, path.slice(1))), `${L.code}: ${path} does not exist`);
    assert.ok(load(path, name), `${L.code}: ${path} does not define ${name}`);
  }
  assert.ok(existsSync(join(root, L.url === '/#p=gameweek' ? 'index.html' : L.url.slice(1))), `${L.code}: alert link ${L.url} goes nowhere`);
  const fixtures = load(...L.fixtures), refs = load(...L.refs);
  const leagueYpg = C.leagueRates(refs).avgYpg;
  assert.ok(leagueYpg > 2 && leagueYpg < 7, `${L.code}: league figure ${leagueYpg} is not a yellow-cards-a-game number`);

  /* 2. Every named referee becomes a clean sentence. */
  let named = 0, withRate = 0;
  for (const f of fixtures) {
    if (!f.ref) continue;
    named++;
    const ypg = C.refRateFor(f.ref, refs);
    if (ypg != null) withRate++;
    const m = C.refAlertText({ h: f.h, a: f.a, ref: f.ref, changed: false }, ['A Player'], ypg, leagueYpg);
    assert.ok(!/undefined|NaN|null|Infinity/.test(m.title + m.body), `${L.code} ${f.id}: "${m.body}"`);
    assert.ok(ypg == null ? /no card record yet/.test(m.body)
      : new RegExp(ypg.toFixed(2) + ' yellow cards a game \\(league ' + leagueYpg.toFixed(2)).test(m.body),
    `${L.code} ${f.id}: the alert does not carry the official's rate beside the league's: "${m.body}"`);
    alerts++;
  }
  assert.ok(named > 0, `${L.code}: no fixture has ever named a referee, so the alert could never fire`);
  assert.ok(withRate / named >= 0.7, `${L.code}: only ${withRate} of ${named} named referees resolve to a card record`);
  rated += withRate;
}

/* 3. One browser, four desks. */
let stored = [];
const desks = { PL: ['ARS|Gabriel'], EFLC: ['MIL|Jenson Metcalfe'], LL: ['RMA|Valverde'], SA: ['INT|Barella'] };
for (const [lg, keys] of Object.entries(desks)) stored = C.mergeWatch(stored, keys.map((k) => C.watchKeyFor(lg, k)), lg);
assert.equal(stored.length, 4, 'a desk sign-up overwrote another desk\'s stars');
stored = C.mergeWatch(stored, [], 'EFLC');
assert.deepEqual(stored.map(C.watchLeague).sort(), ['LL', 'PL', 'SA'], 'unstarring on one desk cleared another');
assert.deepEqual(cron.watchedIn(stored, { h: 'RMA', a: 'BAR' }, 'LL'), ['Valverde']);
assert.deepEqual(cron.watchedIn(stored, { h: 'RMA', a: 'BAR' }, 'PL'), [], 'a La Liga star fired on a Premier League code');

/* 4. The wiring. */
const sub = read('netlify/functions/push-subscribe.js');
assert.ok(/PLDCore\.mergeWatch\(/.test(sub), 'the subscription save no longer merges by league');
assert.ok(/Could not read subscription/.test(sub), 'a failed read no longer refuses the save, so it could wipe other desks\' stars');
assert.ok(/league === 'PL' \? cleanEls\(b\.els\) : cleanEls\(prior && prior\.els\)/.test(sub),
  'another desk\'s sync could clear the Premier League ban-alert ids');
assert.ok(/league: o\.league/.test(read('assets/push.js')), 'the client does not say which desk is speaking');
for (const [page, code] of [['eflc.html', 'EFLC'], ['laliga.html', 'LL'], ['seriea.html', 'SA']]) {
  const html = read(page);
  assert.ok(html.includes('<script src="assets/push.js"></script>') && html.includes('<script src="assets/refalerts.js"></script>'),
    `${page} does not load the alerts`);
  assert.ok(new RegExp(`league: '${code}'`).test(html), `${page} signs up without its league code ${code}`);
  assert.ok(/id="refAlerts"/.test(html), `${page} has nowhere to show the alerts card`);
  assert.ok(/if \(REF_ALERTS\) REF_ALERTS\.sync\(\);/.test(html), `${page} does not re-sync when a star changes`);
}
assert.ok(/no appointment sheet/.test(read('seriea.html')), 'the Serie A desk lost its timing caveat');
const card = read('assets/refalerts.js');
assert.ok(/No account/.test(card) && /18\+ research, not advice/.test(card), 'the alerts card lost its no-account or 18+ line');
assert.ok(!/requestPermission/.test(card) && /addEventListener\('click'/.test(card),
  'the card asks for permission itself instead of after a button press');
assert.ok(read('sw.js').includes("'/assets/refalerts.js'"), 'the service worker does not precache the alerts card');

console.log(`check-alerts OK: 4 leagues, each with its own files, memory, page and tag; ${alerts} named referees `
  + `(${rated} with a card record) all produce a clean alert with the league figure beside it; four desks' stars `
  + 'survive each other\'s re-syncs; every desk offers the card under its own league code, button-first, no account');

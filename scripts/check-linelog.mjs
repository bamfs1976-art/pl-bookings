// Guard for model v line, the comparison log: `node scripts/check-linelog.mjs`.
//
// The log is only worth keeping if it settles correctly, so this settles
// comparisons against the REAL bookings ledger of every division: a player
// the ledger has booked in a round must settle "booked", one who played that
// round without a card "not booked", and a fixture the ledger has not
// recorded must stay pending. It also holds the wiring: every desk logs
// through the price check with its own league code and the feed's fixture
// ids, the log stores no money, sends nothing anywhere, and carries the 18+
// research line.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const C = require('../assets/core.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const obj = (file, name) => {
  const s = read(file);
  const at = s.indexOf('const ' + name);
  assert.ok(at >= 0, `${file} has no ${name}`);
  const start = s.indexOf(s[s.indexOf('=', at) + 2] === '[' ? '[' : '{', at);
  const end = s.lastIndexOf(s[start] === '[' ? ']' : '}');
  return Function('"use strict";return (' + s.slice(start, end + 1) + ');')();
};

const LEAGUES = [
  ['PL', 'data/pl_bookings.js', 'PL_BOOKINGS', 'data/pl_fixtures.js', 'PL_FIXTURES'],
  ['EFLC', 'data/eflc_bookings.js', 'EFLC_BOOKINGS', 'data/eflc_fixtures.js', 'EFLC_FIXTURES'],
  ['LL', 'data/laliga_bookings.js', 'LALIGA_BOOKINGS', 'data/laliga_fixtures.js', 'LALIGA_FIXTURES'],
  ['SA', 'data/seriea_bookings.js', 'SERIEA_BOOKINGS', 'data/seriea_fixtures.js', 'SERIEA_FIXTURES'],
];

let booked = 0, clean = 0;
for (const [code, lf, lname, ff, fname] of LEAGUES) {
  const L = obj(lf, lname), F = obj(ff, fname);
  const recorded = new Set((L.fixtures || []).map(String));
  const fxOf = (club, r) => F.find((x) => x.r === Number(r) && (x.h === club || x.a === club)
    && recorded.has(String(x.id)));
  const entry = (n, c, fx) => C.lineEntry({ ts: 1, league: code, fixture: fx, player: { n, c }, prob: 0.3, odds: 4 });

  /* Every carded round in the ledger settles "booked". */
  let b = 0;
  for (const p of (L.players || []).slice(0, 60)) {
    for (const r of Object.keys(p.rds || {})) {
      const fx = fxOf(p.c, r);
      if (!fx) continue;
      const s = C.settleLine(entry(p.n, p.c, fx), L);
      assert.equal(s.status, 'booked', `${code}: ${p.n} (${p.c}) was booked in round ${r} but settled "${s.status}"`);
      b++;
    }
  }
  /* A recent appearance with no card in that round settles "not booked". */
  let nb = 0;
  for (const a of (L.apps || []).slice(0, 120)) {
    const pl = (L.players || []).find((p) => p.c === a.c && p.n === a.n);
    for (const r of a.r || []) {
      if (pl && pl.rds && Number(pl.rds[String(r)]) > 0) continue;
      const fx = fxOf(a.c, r);
      if (!fx) continue;
      const s = C.settleLine(entry(a.n, a.c, fx), L);
      assert.equal(s.status, 'not booked', `${code}: ${a.n} (${a.c}) played round ${r} uncarded but settled "${s.status}"`);
      nb++;
    }
  }
  /* An unplayed fixture stays pending, whoever it names. */
  const ahead = F.find((x) => !recorded.has(String(x.id)));
  if (ahead) {
    const p = (L.players || [])[0];
    assert.equal(C.settleLine(entry(p.n, ahead.h, ahead), L).status, 'pending',
      `${code}: a fixture the ledger has not recorded did not stay pending`);
  }
  assert.ok(b > 0 && nb > 0, `${code}: nothing settled (booked ${b}, not booked ${nb}) — the ledger shape changed`);
  booked += b; clean += nb;
}

/* The wiring on every desk. */
const DESKS = [['index.html', 'PL'], ['eflc.html', 'EFLC'], ['laliga.html', 'LL'], ['seriea.html', 'SA']];
for (const [page, code] of DESKS) {
  const html = read(page);
  assert.ok(html.includes('<script src="assets/linelog.js"></script>'), `${page} does not load the line log`);
  assert.ok(/onLog\s*:/.test(html) && /PLDLineLog\.add\(/.test(html), `${page}'s price check does not log`);
  assert.ok(new RegExp(`league\\s*:\\s*['"]${code}['"]`).test(html), `${page} logs without its league code ${code}`);
  assert.ok(/>Model v line</.test(html) && /PLDLineLog\.open\(/.test(html), `${page} has no way to open the log`);
}
assert.ok(/plLineMeta[\s\S]{0,300}PL_FIXTURES/.test(read('index.html')),
  'the Premier League desk logs FPL fixture ids, which the ledger (API-Football ids) cannot settle');

const log = read('assets/linelog.js');
const code = log.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(/18\+ research, not advice/.test(log), 'the line log view lost its 18+ research line');
assert.ok(!/\bstake\b/i.test(code), 'the line log records a stake; it is meant to be stake-free');
assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|supabase/i.test(code), 'the line log sends data off the device');
const price = read('assets/price.js');
assert.ok(/logOn \? '<button class="px-log"/.test(price) && /held == null \|\| !m \? ' disabled'/.test(price),
  'the Log button is not conditional on a typed price and a known fixture');

console.log(`check-linelog OK: ${booked} carded rounds settle "booked" and ${clean} uncarded appearances `
  + '"not booked" across all four ledgers, unplayed fixtures stay pending, every desk logs through its '
  + 'price check with its own league code (the PL desk with the feed’s fixture ids), and the log is '
  + 'stake-free, on-device and labelled 18+ research');

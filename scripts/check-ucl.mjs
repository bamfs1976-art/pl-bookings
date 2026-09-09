// Guard the Champions League tie list and the /europe view that reads it.
//
// A European tie is priceable here only when BOTH clubs sit on a desk this app
// holds players for. docs/champions-league-feasibility.md states the rule and
// index.html's teamCardBoard() enforces it for domestic matches:
//
//   BOTH SIDES OR NEITHER: the match total is the sum of the two halves, and
//   pricing one off its real XI and the other off last season's minutes would
//   make them answer different questions.
//
// Europe is where that rule is easiest to break, because the file is generated
// from a competition of thirty-six clubs and this app holds ten of them. So
// this guard re-derives the rule from the DATASETS rather than trusting the
// harvest: every club code in the tie list must actually be present in the
// data file of the desk the row names.
//
// It also guards the thing the feed gets wrong every August. API-Football
// creates the league-phase fixtures as soon as the draw is made and, until it
// ingests UEFA's calendar, stamps them all with one provisional instant. That
// has shipped from this repository before as fabricated congestion. A tie in
// such a block must carry a null date, never the stamp.
//
// Skips cleanly when data/ucl_ties.js has not been generated: it comes from
// the refresh workflow, and CI on a fresh clone should not fail for its
// absence.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tiesPath = join(root, 'data', 'ucl_ties.js');

if (!existsSync(tiesPath)) {
  console.log('check-ucl: data/ucl_ties.js not built yet, skipping.');
  process.exit(0);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(tiesPath, 'utf8'), ctx);
const TIES = vm.runInContext('UCL_TIES', ctx);

assert.ok(Array.isArray(TIES), 'data/ucl_ties.js declares no UCL_TIES array');

/* WHICH CLUBS EACH DESK ACTUALLY HOLDS, read from the shipped data files
   rather than from the registry. The registry says which clubs a desk is FOR;
   the data file says which it has players for, and only the second can price
   a card. A desk whose file has not been generated is skipped rather than
   failed, for the same reason as above. */
const DESKS = {
  PL: ['pl_data.js', 'CLUBS'],
  LL: ['laliga_data.js', 'CLUBS'],
  SA: ['seriea_data.js', 'CLUBS'],
};
const held = {};
for (const [code, [file, name]] of Object.entries(DESKS)) {
  const p = join(root, 'data', file);
  if (!existsSync(p)) continue;
  const c = {};
  vm.createContext(c);
  vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), c);
  vm.runInContext(readFileSync(p, 'utf8'), c);
  const clubs = vm.runInContext(`typeof ${name} !== 'undefined' ? ${name} : null`, c);
  if (!clubs) continue;
  held[code] = new Set(Array.isArray(clubs) ? clubs.map((x) => x.s || x.short || x)
                                            : Object.keys(clubs));
}

let checked = 0;
for (const t of TIES) {
  const where = `${t.h} v ${t.a} (${t.r || 'no round'})`;
  for (const [side, code, league] of [['home', t.h, t.hl], ['away', t.a, t.al]]) {
    assert.ok(code, `${where}: the ${side} club has no short code`);
    assert.ok(DESKS[league],
      `${where}: the ${side} club is filed under desk "${league}", which is ` +
      'not one this app has. A tie may only name PL, LL or SA');
    if (held[league]) {
      assert.ok(held[league].has(code),
        `${where}: ${code} is filed under ${league}, whose data file does not ` +
        'carry it. BOTH SIDES OR NEITHER: a tie with one side unheld must be ' +
        'dropped by the harvest, not shipped half-built');
      checked += 1;
    }
  }
  /* The two sides must come from different desks. UEFA does not pair two clubs
     of one country in the league phase, so a same-desk row is a resolution
     fault, not a fixture. */
  assert.notEqual(t.hl, t.al,
    `${where}: both clubs are filed under ${t.hl}. UEFA does not pair two ` +
    'clubs from the same country in the league phase, so this is a club ' +
    'resolved to the wrong desk');
  /* A date is either absent or a real instant. Never a bare day, which is what
     a hand-edit looks like. */
  if (t.d !== null) {
    assert.ok(typeof t.d === 'string' && !Number.isNaN(Date.parse(t.d)),
      `${where}: the kick-off "${t.d}" is not a date. Unknown is null`);
  }
}

/* THE PLACEHOLDER BLOCK. A club cannot play two ties at the same instant, so
   any date shared by two of one club's ties is a draw-pending stamp and every
   row in it must have been nulled by the harvest. Checked here as well as
   there because the harvest runs where the API key is and this runs
   everywhere, so a regression in the harvest is caught by CI rather than by a
   reader looking at a card with a made-up kick-off on it. */
const slots = new Map();
for (const t of TIES) {
  if (!t.d) continue;
  for (const code of [t.h, t.a]) {
    const key = `${code}@${t.d}`;
    slots.set(key, (slots.get(key) || 0) + 1);
  }
}
for (const [key, n] of slots) {
  assert.equal(n, 1,
    `${key.split('@')[0]} has ${n} ties at ${key.split('@')[1]}. A club cannot ` +
    'play two matches at one instant: this is the feed having the draw but ' +
    'not the calendar, and the harvest should have written these ties with ' +
    'no date at all');
}

/* THE FILE MUST SAY WHAT IT IS. The card prices each side off its DOMESTIC
   season, which is the honest approach and the one the header commits to in
   writing. A header that stops saying so is a file somebody has started
   trusting for the wrong thing. */
const head = readFileSync(tiesPath, 'utf8').split('const ')[0];
for (const phrase of ['DOMESTIC', 'No referee rate', 'suspension ladder']) {
  assert.ok(head.includes(phrase),
    `data/ucl_ties.js no longer states "${phrase}" in its header: the file's ` +
    'own account of what it does and does not carry has drifted');
}

const dated = TIES.filter((t) => t.d).length;
const pairs = [...new Set(TIES.map((t) => `${t.hl}v${t.al}`))].sort();
console.log(`check-ucl OK: ${TIES.length} priceable ties (${pairs.join(', ') || 'none'}), ` +
  `${checked} club references confirmed against the desks' own data files, ` +
  `${dated} with a kick-off, ${TIES.length - dated} awaiting UEFA's calendar`);

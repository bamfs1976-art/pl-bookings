#!/usr/bin/env node
/* Every clock in this app reads 24-hour, for every reader, from one rule.
 *
 * WHAT WAS WRONG. Eleven call sites across four pages formatted a kick-off and
 * they did not agree. Six passed `undefined` as the locale — which hands the
 * choice of clock to THE READER'S machine, so the same 15:30 fixture rendered
 * "16:30" in London and "04:30 PM" in New York. The other five hardcoded
 * "en-GB" and were 24-hour by accident of that locale rather than by decision.
 * Nothing in the repository stated which was intended, so nothing could be
 * wrong, and both kept working.
 *
 * WHY A BEHAVIOURAL CHECK AND NOT A GREP. A guard that greps for `hourCycle`
 * proves a string is present in a file. It does not prove the function returns
 * "16:30", and it certainly does not prove the pages call it. So this runs the
 * real helpers over real values, including the ones that are not dates at all,
 * and separately checks that no page has grown a clock of its own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const C = require_(join(root, 'assets', 'core.js'));
const read = (p) => readFileSync(join(root, p), 'utf8');

/* CODE, NOT PROSE. The first version of section 6 failed on core.js's own
   comment explaining why hour12 is NOT used — a guard that greps a file
   cannot tell an option from a sentence about that option. Stripping block
   and line comments is crude (it would also blank a "//" inside a string
   literal) but it errs toward reading LESS as code, which for a "this must
   not appear" check means a false pass rather than a false failure — and the
   behavioural checks above are what actually prove the clock. */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

const PAGES = ['index.html', 'today.html', 'eflc.html', 'laliga.html'];
const KO = '2026-08-30T16:30:00+00:00';   // a 16:30 kick-off, i.e. 4.30pm

/* ── 1. the helpers exist and read 24-hour ─────────────────────────────── */
for (const fn of ['clock', 'dayClock', 'dateClock']) {
  ok(typeof C[fn] === 'function', `PLDCore.${fn} is missing`);
}

/* THE LOCALE THAT WOULD BETRAY US. en-US is 12-hour by default, so if the
   hour cycle were ever dropped this is the locale that would show it. Checking
   only en-GB would pass on a completely unpinned implementation. */
for (const loc of ['en-US', 'en-GB', 'es-ES', 'de-DE', 'ja-JP', undefined]) {
  const t = C.clock(KO, loc);
  const label = loc || '(the reader\'s own)';
  ok(/\b16[:.]30\b/.test(t),
    `clock() returns "${t}" in ${label} — a 16:30 kick-off must read 16:30, ` +
    'not 4:30. This is the failure the whole file exists to prevent');
  ok(!/[ap]\.?m/i.test(t),
    `clock() returns "${t}" in ${label}, which carries an am/pm marker`);
  ok(!/^24[:.]/.test(t),
    `clock() returns "${t}" in ${label} — h24 counts midnight as 24:00; the ` +
    'app wants h23, which is why hourCycle is set rather than hour12:false');
}

/* Midnight is the hour that separates h23 from h24, and it is the one a
   12-hour clock renders as "12:00 AM" — so it is worth its own case. */
for (const loc of ['en-US', 'en-GB', 'ja-JP']) {
  const t = C.clock('2026-08-30T00:05:00+00:00', loc);
  ok(/\b00[:.]05\b/.test(t),
    `midnight renders as "${t}" in ${loc}; it must be 00:05`);
}

/* ── 2. the shapes the pages actually use ──────────────────────────────── */
ok(/^Sun 16:30$/.test(C.dayClock(KO, 'en-GB')),
  `dayClock gives "${C.dayClock(KO, 'en-GB')}", expected "Sun 16:30"`);
ok(/^SUN 16:30$/.test(C.dayClock(KO, 'en-GB', true)),
  `dayClock upper gives "${C.dayClock(KO, 'en-GB', true)}", expected "SUN 16:30"`);
ok(/^Sun 30 Aug, 16:30$/.test(C.dateClock(KO, 'en-GB')),
  `dateClock gives "${C.dateClock(KO, 'en-GB')}", expected "Sun 30 Aug, 16:30"`);
/* The acca fixture line has always joined with a space rather than a comma.
   Keeping that is the reason dateClock builds from parts instead of making one
   toLocaleString call — if the separator stops being ours, that shape is gone
   and the change was never asked for. */
ok(/^Sun 30 Aug 16:30$/.test(C.dateClock(KO, 'en-GB', ' ')),
  `dateClock with a space separator gives "${C.dateClock(KO, 'en-GB', ' ')}"`);

/* ── 3. what is not a date must render as nothing ──────────────────────── */
/* new Date(null) IS THE EPOCH, not an error — a valid Thursday in 1970 that
   sails past isNaN. A fixture with no kick-off would print "Thu, Jan 1,
   00:00", which reads as a real fixture at a real time. This is the same
   shape as every other failure in this repository: absence rendering as
   plausible data. */
for (const empty of [null, undefined, '', 0, 'not a date', NaN, {}, []]) {
  for (const fn of ['clock', 'dayClock', 'dateClock']) {
    const got = C[fn](empty);
    ok(got === '',
      `${fn}(${JSON.stringify(empty) ?? String(empty)}) returned ` +
      `"${got}" instead of nothing — a missing kick-off must render blank, ` +
      'never as a date somebody could believe');
  }
}
/* But a Date somebody passed ON PURPOSE is an instruction, not an absence. */
ok(C.clock(new Date(KO), 'en-GB') === '16:30',
  'a Date object passed directly must still format');

/* ── 4. no page keeps a clock of its own ───────────────────────────────── */
for (const page of PAGES) {
  const src = codeOnly(read(page));
  for (const [re, what] of [
    [/toLocaleTimeString/, 'toLocaleTimeString'],
    [/hour:\s*['"]2-digit['"]/, "an hour:'2-digit' option"],
    [/hour12/, 'an hour12 option'],
    [/hourCycle/, 'an hourCycle option'],
  ]) {
    ok(!re.test(src),
      `${page} formats a clock itself (${what}). The hour cycle is decided in ` +
      'assets/core.js and nowhere else — six pages once chose it separately ' +
      'and half of them let the reader\'s locale decide');
  }
}

/* ── 5. and every page that shows a kick-off goes through the helpers ──── */
for (const page of PAGES) {
  const src = read(page);
  ok(/PLDCore\.(clock|dayClock|dateClock)\(/.test(src),
    `${page} renders no time through PLDCore. Either it lost its kick-offs or ` +
    'it found another way to print one');
}

/* ── 6. the rule is stated where it is decided ─────────────────────────── */
const clockDecl = (read('assets/core.js').match(/const CLOCK = \{[^}]*\}/) || [''])[0];
ok(/hourCycle:\s*'h23'/.test(clockDecl),
  `the CLOCK options in assets/core.js do not pin hourCycle:'h23' (found: ` +
  `${clockDecl || 'no CLOCK declaration at all'})`);
ok(!/hour12/.test(clockDecl),
  'the CLOCK options set hour12 as well as hourCycle. The two conflict — ' +
  'hour12 wins where both are given, and it permits h24, which renders ' +
  'midnight as 24:00');

if (problems.length) {
  console.error('check-clock FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const sites = PAGES.reduce(
  (n, p) => n + (read(p).match(/PLDCore\.(clock|dayClock|dateClock)\(/g) || []).length, 0);
console.log(
  `check-clock OK: ${sites} kick-off render(s) across ${PAGES.length} pages, all ` +
  'through one helper; 16:30 reads 16:30 in en-US, es-ES, de-DE and ja-JP as ' +
  'well as en-GB, midnight is 00:05 rather than 12:05 AM or 24:05, no page ' +
  'keeps a clock of its own, and nothing that is not a date renders as one');

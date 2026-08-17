#!/usr/bin/env node
/* Which matchday the sibling desks open on, and the rule being ONE rule.
 *
 * THE BUG THIS EXISTS FOR. eflc.html and laliga.html each carried two answers
 * to one question. The "This Matchday" tab took the lowest round with a
 * fixture whose CALENDAR DAY had not passed; the "Fixtures" dropdown took the
 * first round with a fixture whose KICK-OFF was still ahead. Four
 * implementations of one rule across two pages, and for several hours of every
 * matchday they disagreed:
 *
 *   17 Aug 2026, Cardiff v Wrexham 19:00, the last game of Matchday 1
 *     18:00 UTC   This Matchday 1   Fixtures 1
 *     20:00 UTC   This Matchday 1   Fixtures 2   <- mid-match, and disagreeing
 *     23:00 UTC   This Matchday 1   Fixtures 2
 *     00:30 UTC   This Matchday 2   Fixtures 2
 *
 * The dropdown moved on AT KICK-OFF — while the match was being played. A desk
 * that drops a fixture people are watching is the failure the live-ticker
 * docstring calls the worst this product can produce.
 *
 * Day granularity won. Both tabs on both desks now call PLDCore.currentRound.
 *
 * WHAT IS ASSERTED, and why each is here rather than a description of it:
 *   1. the rule itself, walked hour by hour across a real boundary
 *   2. never mid-match — the strong form, over every fixture in the file
 *   3. no local rule survives on either page (the anti-drift one)
 *   4. the OLD rule fails these, so none of the above is vacuous
 *
 * Every assertion has been mutation-tested; see MUTATIONS at the foot.
 *
 *     node scripts/check-matchday.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = require(join(root, 'assets', 'core.js'));

function load(file, konst) {
  const c = {};
  vm.createContext(c);
  vm.runInContext(readFileSync(join(root, file), 'utf8'), c);
  return vm.runInContext(konst, c);
}

let passed = 0;
const ok = (what) => { console.log('  ok - ' + what); passed++; };
const group = (t) => console.log(t);

const DESKS = [
  { page: 'eflc.html', file: 'data/eflc_fixtures.js', konst: 'EFLC_FIXTURES', name: 'Championship' },
  { page: 'laliga.html', file: 'data/laliga_fixtures.js', konst: 'LALIGA_FIXTURES', name: 'La Liga' },
];

const HOUR = 3600 * 1000;
const dayOf = (f) => String(f.d).slice(0, 10);

/* The rule the dropdown used to apply, kept so the checks below can be shown
   to bite. If a future edit makes the real rule equal to this one again, the
   assertions that compare against it start failing — which is the point. */
function oldKickoffRule(fixtures, now) {
  const rs = [...new Set(fixtures.map((f) => f.r))].sort((a, b) => a - b);
  for (const r of rs) {
    if (fixtures.some((f) => f.r === r && f.d && Date.parse(f.d) > now)) return r;
  }
  return rs[0];
}

/* ---- 1. the rule, walked across a real boundary ------------------------ */
group('the matchday advances when the day is over, not when the last ball is kicked');

for (const desk of DESKS) {
  const FIX = load(desk.file, desk.konst).filter((f) => f.r != null && f.d);
  assert.ok(FIX.length > 100, `${desk.name}: only ${FIX.length} dated fixtures`);

  /* THE PROPERTY, not a hardcoded expectation: walking the whole season an
     hour at a time, the answer may only change when the UTC DATE changes.
     That is day-granularity stated exactly, and it is what the old kick-off
     rule violated.

     Written as a property rather than "round 1, then round 2" because the
     first draft asserted the latter and La Liga failed it — correctly.
     Jornada 1 carries postponed fixtures on 25-27 August, AFTER the whole of
     jornada 2 (20-24 August), so the rounds genuinely overlap and the desk
     rightly sits on jornada 1 for a fortnight. Rounds are not a partition of
     the calendar and a guard must not assume they are. */
  const first = Math.min(...FIX.map((f) => Date.parse(f.d)));
  const last = Math.max(...FIX.map((f) => Date.parse(f.d)));
  let prev = null, prevDay = null, jumps = [], midDayChanges = [];
  for (let t = first - 24 * HOUR; t <= last + 48 * HOUR; t += HOUR) {
    const r = C.currentRound(FIX, t);
    const day = new Date(t).toISOString().slice(0, 10);
    if (prev != null) {
      if (r < prev) jumps.push(`${new Date(t).toISOString()} went ${prev} -> ${r}`);
      if (r !== prev && day === prevDay) {
        midDayChanges.push(`${new Date(t).toISOString()} changed ${prev} -> ${r} mid-day`);
      }
    }
    prev = r; prevDay = day;
  }
  assert.equal(midDayChanges.length, 0,
    `${desk.name}: the matchday changed part-way through a day, which is ` +
    `kick-off granularity: ${midDayChanges.slice(0, 3).join('; ')}`);
  ok(`${desk.name}: over the whole season the matchday only ever changes at 00:00 UTC`);

  assert.equal(jumps.length, 0,
    `${desk.name}: the matchday went backwards: ${jumps.slice(0, 3).join('; ')}`);
  ok(`${desk.name}: the matchday never goes backwards as time moves forward`);

  /* And the concrete case that prompted all this, named so it stays legible. */
  const r1 = FIX.filter((f) => f.r === 1);
  const lastKo = Math.max(...r1.map((f) => Date.parse(f.d)));

  /* THE POINT OF THE FIX, stated as its own assertion: an hour after the last
     kick-off — a time when the match is still being played — the desk is
     still on that match's round. This is exactly where the old rule broke. */
  const during = lastKo + HOUR;
  assert.equal(C.currentRound(FIX, during), 1,
    `${desk.name}: an hour after the last kick-off of Matchday 1 the desk had ` +
    'already moved on, which is the mid-match rollover this fix removed');
  assert.notEqual(oldKickoffRule(FIX, during), 1,
    `${desk.name}: the OLD kick-off rule no longer moves on mid-match either, so ` +
    'the assertion above proves nothing — the boundary in the data has shifted ' +
    'and this check needs re-aiming');
  ok(`${desk.name}: still on the round an hour into its last match (the old rule was not)`);
}

/* ---- 2. never mid-match, over every fixture ---------------------------- */
group('no fixture is ever dropped while it is being played');

for (const desk of DESKS) {
  const FIX = load(desk.file, desk.konst).filter((f) => f.r != null && f.d);
  let checked = 0;
  const bad = [];
  for (const f of FIX) {
    const ko = Date.parse(f.d);
    /* Kick-off, half time, and a generous full time. A match is not over at
       90 minutes and the desk must not think it is. */
    for (const mins of [0, 45, 105]) {
      const t = ko + mins * 60 * 1000;
      checked++;
      const r = C.currentRound(FIX, t);
      /* The desk shows the LOWEST unplayed round, so during a fixture it must
         be on that fixture's round or an earlier one still outstanding —
         never past it. */
      if (r > f.r) bad.push(`${desk.name} r${f.r} ${f.d} +${mins}m showed r${r}`);
    }
  }
  assert.equal(bad.length, 0,
    `${bad.length}/${checked} in-play moments showed a later round: ` + bad.slice(0, 3).join('; '));
  ok(`${desk.name}: ${checked} in-play moments across ${FIX.length} fixtures, none dropped`);
}

/* ---- 3. one rule, not four (the anti-drift assertion) ------------------ */
group('both tabs on both desks go through the one implementation');

for (const desk of DESKS) {
  const src = readFileSync(join(root, desk.page), 'utf8');

  /* The This Matchday tab. */
  const nr = src.match(/function nextRound\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(nr, `${desk.page}: nextRound() not found`);
  assert.ok(/C\.currentRound\(/.test(nr[1]),
    `${desk.page}: nextRound() no longer calls C.currentRound — it has grown its ` +
    'own rule again, which is how these two tabs came to disagree');

  /* The Fixtures dropdown. */
  const ir = src.match(/function initRounds\(\)\s*\{([\s\S]*?)\n  \}\)\(\);/);
  assert.ok(ir, `${desk.page}: initRounds() not found`);
  assert.ok(/C\.currentRound\(/.test(ir[1]),
    `${desk.page}: initRounds() no longer calls C.currentRound`);

  /* And neither may compare kick-off TIMESTAMPS to pick a round, which is the
     specific shape of the rule that was wrong. Checked as a ban rather than
     only as a positive, because a page could call currentRound and then
     override it. */
  for (const [what, body] of [['nextRound', nr[1]], ['initRounds', ir[1]]]) {
    assert.ok(!/getTime\(\)|Date\.parse|Date\.now\(\)/.test(body),
      `${desk.page}: ${what}() is comparing timestamps again — the rollover is a ` +
      'question about the DAY, and kick-off granularity moves the desk on ' +
      'mid-match');
  }
}
ok(`${DESKS.length} desks x 2 tabs all resolve the matchday through PLDCore.currentRound`);

/* ---- 4. the two desks cannot answer differently either ----------------- */
{
  /* Same fixture list through both pages' entry point is trivially equal now
     they share a function — so this asserts the thing that would actually
     regress: that the shared function is deterministic given (fixtures, now)
     and carries no hidden dependency on the real clock. */
  const FIX = load(DESKS[0].file, DESKS[0].konst).filter((f) => f.r != null && f.d);
  const t = Date.parse('2026-08-17T20:00:00Z');
  const a = C.currentRound(FIX, t), b = C.currentRound(FIX, t);
  assert.equal(a, b);
  assert.notEqual(C.currentRound(FIX, t), C.currentRound(FIX, t + 30 * HOUR),
    'the round is the same 30 hours apart across a boundary — currentRound is ' +
    'ignoring its `now` argument, which would make every check above vacuous');
  ok('currentRound is a pure function of (fixtures, now) and does read now');
}

console.log(`\n${passed} checks passed`);

/* ---- MUTATIONS -----------------------------------------------------------
 * Applied to a clean tree; the check named on the right is the one that failed.
 *
 *  assets/core.js
 *    currentRound compares `> now` on Date.parse(f.d) (the old rule restored)
 *                                    -> "changed part-way through a day, which
 *                                        is kick-off granularity: 2026-08-17
 *                                        T19:00 changed 1 -> 2 mid-day" — the
 *                                        exact Cardiff v Wrexham case above
 *    `>= today` -> `> today`         -> "an hour after the last kick-off of
 *                                        Matchday 1 the desk had already moved
 *                                        on" (it advances a day early)
 *    season-end falls back to the LOWEST round again (the old behaviour)
 *                                    -> "the matchday went backwards:
 *                                        2027-05-02 went 46 -> 1"
 *    ignore `now`, use Date.now()    -> "currentRound is a pure function of
 *                                        (fixtures, now) and does read now"
 *
 *  eflc.html / laliga.html
 *    nextRound() given back its local body
 *                                    -> "nextRound() no longer calls
 *                                        C.currentRound"
 *    initRounds() given back the kick-off loop
 *                                    -> "initRounds() is comparing timestamps
 *                                        again"
 *
 *  NOTE ON CHECK 1's second half. `assert.notEqual(oldKickoffRule(...), 1)` is
 *  there so that a fixture refresh which moved the boundary — say every round-1
 *  fixture landing on one day at one time — could not leave the mid-match
 *  assertion passing for the wrong reason. It fails loudly and asks to be
 *  re-aimed rather than going quiet.
 */

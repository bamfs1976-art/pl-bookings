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
     first draft asserted the latter and La Liga failed it. Jornada 1 carries
     postponed fixtures on 25-27 August, AFTER the whole of jornada 2 (20-24
     August), so the rounds genuinely overlap. Rounds are not a partition of
     the calendar and a guard must not assume they are.

     THIS NOTE USED TO END "and the desk rightly sits on jornada 1 for a
     fortnight". That was wrong, and it is the reason the bug survived being
     looked at: on 24 August the desk showed "Matchday 1, Sat Aug 15 - Thu Aug
     27" with six played fixtures in it, while the two La Liga matches kicking
     off that evening were jornada 2 and appeared nowhere on the page. A
     matchday view whose round has nothing on today is not "rightly" anything.
     What the overlap actually means is that the matchday can go BACKWARDS,
     which is asserted below as a bounded exception rather than forbidden. */
  const first = Math.min(...FIX.map((f) => Date.parse(f.d)));
  const last = Math.max(...FIX.map((f) => Date.parse(f.d)));
  /* The soonest day on or after `day` that has any fixture — the day the
     division's next football is on. Everything below is stated against it. */
  const allDays = [...new Set(FIX.map(dayOf))].sort();
  const nextDayWithFootball = (day) => allDays.find((d) => d >= day) || null;
  const roundsOn = (day) => new Set(FIX.filter((f) => dayOf(f) === day).map((f) => f.r));

  let prev = null, prevDay = null, midDayChanges = [];
  const unjustified = [], emptyMatchday = [];
  for (let t = first - 24 * HOUR; t <= last + 48 * HOUR; t += HOUR) {
    const r = C.currentRound(FIX, t);
    const day = new Date(t).toISOString().slice(0, 10);
    if (prev != null) {
      if (r !== prev && day === prevDay) {
        midDayChanges.push(`${new Date(t).toISOString()} changed ${prev} -> ${r} mid-day`);
      }
      /* A DECREASE IS ALLOWED ONLY WHEN THE FOOTBALL WENT BACKWARDS. Rounds
         overlap, so the matchday must be able to follow a postponed fixture
         down — but only to a round that actually has the next match. A drop to
         a round with nothing imminent is the season-end bug (falling back to
         Matchday 1 with the whole calendar behind you), and it still fails
         here, because a spent list has no next day at all. */
      if (r < prev) {
        const nd = nextDayWithFootball(day);
        if (!nd || !roundsOn(nd).has(r)) {
          unjustified.push(`${day} went ${prev} -> ${r}, but the next football `
            + `is ${nd ? `${nd} (round${roundsOn(nd).size > 1 ? 's' : ''} `
              + `${[...roundsOn(nd)].join(', ')})` : 'nowhere — the list is spent'}`);
        }
      }
    }
    /* THE BUG THIS REPLACED, AS A PROPERTY. If the division plays today, the
       matchday on screen must be one that HAS a fixture today. The desk sat on
       jornada 1 while jornada 2 kicked off in front of it, and every guard was
       green. */
    const on = roundsOn(day);
    if (on.size && !on.has(r)) {
      emptyMatchday.push(`${day}: showing round ${r}, but the round${on.size > 1 ? 's' : ''} `
        + `playing today ${on.size > 1 ? 'are' : 'is'} ${[...on].join(', ')}`);
    }
    prev = r; prevDay = day;
  }
  assert.equal(midDayChanges.length, 0,
    `${desk.name}: the matchday changed part-way through a day, which is ` +
    `kick-off granularity: ${midDayChanges.slice(0, 3).join('; ')}`);
  ok(`${desk.name}: over the whole season the matchday only ever changes at 00:00 UTC`);

  assert.equal(emptyMatchday.length, 0,
    `${desk.name}: the desk showed a matchday with nothing on while the ` +
    `division was playing: ${emptyMatchday.slice(0, 3).join('; ')}`);
  ok(`${desk.name}: on every day the division plays, the matchday shown is one that is playing`);

  assert.equal(unjustified.length, 0,
    `${desk.name}: the matchday went backwards to a round with no imminent ` +
    `football: ${unjustified.slice(0, 3).join('; ')}`);
  ok(`${desk.name}: the matchday only ever moves back to follow a postponed fixture`);

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

  /* ---- the tie-break, on a list built for it ----------------------------- */
  /*
   * NO DAY IN ANY OF THE THREE SHIPPED SEASONS CARRIES TWO ROUNDS, so the
   * tie-break inside currentRound is unreachable from the real fixture files
   * and every mutation to it passed the checks above in silence. It is not a
   * far-fetched state — a postponed midweek fixture rescheduled onto the next
   * round's Friday opener produces it — so it is pinned here on a list written
   * for the purpose rather than left to whichever season first hits it.
   *
   * The tie goes to the HIGHER round: on a day carrying both a straggler and
   * the new round, the desk is about the new round. The alternative drags it
   * back to a matchday that is otherwise finished.
   */
  const tie = [
    { r: 1, d: '2026-08-15T14:00:00+00:00' },
    { r: 1, d: '2026-08-27T19:00:00+00:00' },   // postponed, on a day of its own
    { r: 1, d: '2026-08-28T19:00:00+00:00' },   // postponed onto round 3's opener
    { r: 3, d: '2026-08-28T19:00:00+00:00' },
    { r: 3, d: '2026-08-29T14:00:00+00:00' },
  ];
  const onTheDay = Date.parse('2026-08-28T09:00:00Z');
  assert.equal(C.currentRound(tie, onTheDay), 3,
    'with a postponed round 1 fixture sharing a day with round 3, the desk ' +
    'reads as round 1 — the tie-break is dragging it back to a matchday that ' +
    'is otherwise over');
  /* And the day before, when only the straggler is next, it IS round 1 —
     otherwise the assertion above would pass for a rule that simply always
     returns the highest round. */
  assert.equal(C.currentRound(tie, Date.parse('2026-08-16T09:00:00Z')), 1,
    'the day after round 1\'s opener, with its postponed fixture the next ' +
    'thing to be played, the desk is not on round 1');
  ok('a day carrying two rounds reads as the higher one, and a straggler alone reads as its own');

  /* ---- what is still to play comes first -------------------------------- */
  /*
   * The matchday view ranks by booking heat, which is the product. It did so
   * without asking whether a match had been played, and a round is not over
   * the moment it starts: on 24 August the La Liga desk showed jornada 2 with
   * the two fixtures kicking off that evening at the BOTTOM of the list, under
   * eight that had already finished. A settled result cannot be researched or
   * backed, so it must not outrank one that can.
   *
   * Asserted on the SOURCE of both desks rather than by re-deriving a price,
   * because what can regress here is the comparator — the sort silently losing
   * its first term and going back to heat alone.
   */
  for (const [file, name] of [['eflc.html', 'Championship'], ['laliga.html', 'La Liga']]) {
    const src = readFileSync(join(root, file), 'utf8');
    const at = src.indexOf('function renderMatchday(');
    assert.ok(at >= 0, `${file} has no renderMatchday()`);
    const body = src.slice(at, src.indexOf('\n  }', at));
    assert.ok(/C\.isPlayed\(/.test(body),
      `${name}: renderMatchday no longer asks whether a fixture has been ` +
      'played, so finished matches rank above the ones still to kick off');
    assert.ok(/b\.m\.expected - a\.m\.expected/.test(body),
      `${name}: renderMatchday no longer ranks by booking heat within the ` +
      'group, which is what the note under the list tells the reader it does');
    /* The played test must come FIRST, or it is decoration on a heat sort. */
    assert.ok(body.indexOf('C.isPlayed(') < body.indexOf('b.m.expected - a.m.expected'),
      `${name}: renderMatchday compares heat before it compares whether the ` +
      'match has been played, so the played test never decides anything');
  }
  /* And the rule itself is one implementation, not a status list per desk. */
  assert.ok(C.isPlayed({ st: 'FT' }) && C.isPlayed({ st: 'AET' }) && C.isPlayed({ st: 'PEN' }),
    'PLDCore.isPlayed does not recognise a finished match');
  assert.ok(!C.isPlayed({ st: 'NS' }) && !C.isPlayed({ st: '1H' }) && !C.isPlayed({ st: 'HT' })
         && !C.isPlayed({ st: 'PST' }) && !C.isPlayed(null) && !C.isPlayed({}),
    'PLDCore.isPlayed files a live, postponed or unknown fixture as played — ' +
    'a match in progress has not been played, and an unrecognised status must ' +
    'keep its fixture visible rather than hiding it');
  for (const f of ['eflc.html', 'laliga.html']) {
    assert.ok(!/\['FT', 'AET', 'PEN'\]/.test(readFileSync(join(root, f), 'utf8')),
      `${f} carries its own list of finished statuses again — it is one rule ` +
      'in core.js, and the copy in playedFor() counts toward a suspension ' +
      'ladder where a disagreement bans the wrong player');
  }
  ok('the matchday lists what is still to play first, and one rule decides what "played" means');
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

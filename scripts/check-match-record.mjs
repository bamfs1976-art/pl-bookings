// Guard the match-level record — the row that says what the desk forecast for
// a fixture and what the fixture actually produced.
//
// WHY IT NEEDS A GUARD OF ITS OWN. plb_match_predictions is the only evidence
// a refit will ever have about the match-level model, and it is written once,
// before kick-off, and never revised. Every way it can go wrong is silent:
//
//   1. IT DRIFTS FROM THE PAGE. If the record prices with different lines, a
//      different shrinkage or a missing derby boost, it grades a model nobody
//      was shown. Nothing errors — the numbers are simply not the published
//      ones, and by the time anyone checks there is a season of them.
//   2. THE DERBY LIST STOPS PARSING. The pages declare DERBIES inline and this
//      reads theirs rather than keeping a second copy. A rename would leave
//      every fixture priced as a non-derby, which is a plausible-looking
//      number rather than an error.
//   3. THE OUTCOME IS COUNTED WRONG. A second yellow is a dismissal that
//      follows a booking; counting it as a fresh yellow, or not counting the
//      red, moves every points total in the table by a fixed amount and would
//      calibrate the model against a rule no bookmaker uses.
//
// So this runs the real functions on the real data and checks the arithmetic
// by hand where the convention is a choice.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(join(root, 'scripts', 'accas.mjs'));
const require_ = createRequire(import.meta.url);
const C = require_(join(root, 'assets', 'core.js'));

/* The same shipped-file loader every other guard in scripts/ uses. Needed
   because accas.mjs exposes its fixture source as a FILENAME, not as rows. */
function load(file, konst) {
  const c = {};
  vm.createContext(c);
  vm.runInContext(readFileSync(join(root, file), 'utf8'), c);
  return vm.runInContext(konst, c);
}

/* ---- 1. the record is priced with the page's own constants -------------- */
/* Asserted against the page source rather than restated here: a constant this
   file declared would agree with itself forever. */
const DESKS = { EFLC: 'eflc.html', LL: 'laliga.html' };
for (const [code, page] of Object.entries(DESKS)) {
  const src = readFileSync(join(root, page), 'utf8');

  const shrink = /var SHRINK_MATCHES = (\d+)/.exec(src);
  assert.ok(shrink, `${page}: no SHRINK_MATCHES`);
  assert.equal(Number(shrink[1]), A.SHRINK_MATCHES,
    `${page} shrinks to ${shrink[1]} matches, the record to ${A.SHRINK_MATCHES} — ` +
    'the record would grade a model the page does not run');

  const bp = /var BP_LINES = \[([^\]]+)\]/.exec(src);
  assert.ok(bp, `${page}: no BP_LINES`);
  assert.equal(bp[1].replace(/\s/g, ''), '35.5,45.5,55.5',
    `${page} prices booking points at [${bp[1]}] — the record stores 35.5/45.5/55.5`);

  /* The card lines the page passes to teamCardMarkets. */
  assert.ok(/teamCardMarkets\([^)]*\[3\.5,\s*4\.5,\s*5\.5\]\)/.test(src),
    `${page} no longer prices over 3.5/4.5/5.5 — the record's columns are those lines`);

  /* The derby boost is applied per player and kept out of the displayed ref
     factor. The record has to do the same or every derby is mispriced. */
  const boost = /var DERBY_BOOST = ([\d.]+)/.exec(src);
  assert.ok(boost, `${page}: no DERBY_BOOST`);
  assert.equal(Number(boost[1]), A.DERBY_BOOST_FOR(code),
    `${page} boosts a derby by ${boost[1]}, the record by ${A.DERBY_BOOST_FOR(code)}`);
}

/* ---- 1a. ALL THREE DESKS PRICE BOOKING POINTS, the same way ------------- */
/*
 * The Premier League desk did not, for as long as it existed. The market lived
 * on the two younger desks, so the division with the deepest referee record
 * was the one that could not answer the question a bookmaker actually posts.
 *
 * It matters most exactly where the cards line is quietest. Andy Madley is
 * 17th of 22 for yellows and THIRD for reds at nearly double the median, so
 * Crystal Palace v Manchester City prices cool on cards and carries a
 * dismissal risk the cards line cannot express — a red is 25 points and a
 * yellow 10, and points is where that shows up.
 *
 * Checked across all three, and tolerant of const/var and spacing, because
 * what must hold is that the market is priced the same way everywhere — not
 * which keyword a page happens to declare it with. The loop above deliberately
 * stays on the two desks whose CONSTANTS are graded against the record.
 */
for (const page of ['index.html', 'eflc.html', 'laliga.html']) {
  const src = readFileSync(join(root, page), 'utf8');
  const flat = src.replace(/\s+/g, '');
  const bp = /(?:var|const)BP_LINES=\[([^\]]+)\]/.exec(flat);
  assert.ok(bp, `${page} does not price booking points — the market a bookmaker ` +
    'posts for cards is missing from a desk that prices cards');
  assert.equal(bp[1], '35.5,45.5,55.5',
    `${page} prices booking points at [${bp[1]}] — the three desks must post ` +
    'the same lines or a reader comparing two divisions is comparing nothing');
  assert.ok(/bookingPointsMarkets\(/.test(flat),
    `${page} declares BP_LINES and never prices with them`);
  /* AND THE RED HALF COMES FROM THE APPOINTED OFFICIAL. A constant here would
     price every fixture at the league's dismissal rate, which is the whole
     fact this market exists to carry — and it would do it silently, because a
     points line built on the league red rate looks entirely reasonable. */
  assert.ok(/red!=null\)\?Number\([a-z.]*red\):LEAGUE_RED/.test(flat),
    `${page} does not price reds off the appointed referee's own rate, ` +
    'falling back to the league — every fixture would carry the same ' +
    'dismissal risk, which is the one thing this market is for');
}

/* ---- 2. the derby list still parses out of each page -------------------- */
for (const code of ['EFLC', 'LL', 'PL']) {
  const set = A.derbySet(code);
  assert.ok(set.size > 0,
    `${code}: no derbies parsed — every fixture would price as a non-derby, ` +
    'which looks like a number rather than a failure');
  for (const k of set) {
    assert.ok(/^[A-Z]{2,4}\|[A-Z]{2,4}$/.test(k), `${code}: derby key ${k} is not a club pair`);
  }
}

/* ---- 3. the record itself, on the real data ---------------------------- */
let checked = 0;
for (const L of A.LEAGUES) {
  const { round, rows } = A.matchesFor(L);
  if (round == null || !rows.length) continue;      // no open round is not a failure
  for (const r of rows) {
    checked++;
    const where = `${L.code} ${r.home} v ${r.away}`;

    for (const k of ['p_over_3_5', 'p_over_4_5', 'p_over_5_5', 'p_both_carded', 'p_both_two',
      'p_points_over_35_5', 'p_points_over_45_5', 'p_points_over_55_5']) {
      assert.ok(r[k] >= 0 && r[k] <= 1, `${where}: ${k} = ${r[k]} is not a probability`);
    }
    /* Monotonic by construction — a higher line cannot be likelier. A record
       that violates this is not a slightly wrong number, it is a broken
       distribution, and it would poison every calibration built on it. */
    assert.ok(r.p_over_3_5 >= r.p_over_4_5 && r.p_over_4_5 >= r.p_over_5_5,
      `${where}: over-line probabilities are not monotonic (${r.p_over_3_5} / ${r.p_over_4_5} / ${r.p_over_5_5})`);
    assert.ok(r.p_points_over_35_5 >= r.p_points_over_45_5
      && r.p_points_over_45_5 >= r.p_points_over_55_5,
      `${where}: points-line probabilities are not monotonic`);

    /* A bookings market that prices a match at 12 cards, or at none, is not a
       market — it is a broken squad list arriving as a plausible number. */
    assert.ok(r.exp_cards > 0.5 && r.exp_cards < 9, `${where}: expected cards ${r.exp_cards}`);
    assert.ok(Math.abs(r.exp_cards - (r.exp_cards_home + r.exp_cards_away)) < 0.05,
      `${where}: home + away expected cards do not add up to the heat number`);
    assert.ok(r.rated_home > 0 && r.rated_away > 0, `${where}: a side with no rated players was priced`);

    /* The context a refit needs to tell two different wrongnesses apart. */
    assert.ok(typeof r.derby === 'boolean', `${where}: derby is not recorded`);
    assert.ok(r.ref_factor > 0, `${where}: no referee factor recorded`);
    assert.equal(r.ref_carded, !!(r.referee && r.ref_factor !== 1) || r.ref_carded,
      `${where}: ref_carded disagrees with the recorded referee`);
    if (!r.referee) {
      assert.equal(r.ref_factor, 1, `${where}: priced with a referee factor but no referee named`);
      assert.equal(r.ref_carded, false, `${where}: claims a card record for no referee`);
    }
    assert.ok(r.model_version, `${where}: no model version stamped`);
  }
}

/* THE END OF THE CHAIN that starts at data/appointments.json: an appointment
   the fixture file carries must reach the match record.
 *
 * ASSERTED AGAINST THE FIXTURE FILE, not against the calendar. This used to
 * open "The Championship's appointments are in, so its record must carry
 * them" and require at least one referee outright — which was true the day it
 * was written, for matchday 1, and false the moment the division rolled to
 * matchday 2. The EFL publishes a few days out, so EVERY new round begins with
 * a window where no fixture has an official yet; the guard failed for three
 * days at a time, on main, for the world being in an ordinary state.
 * A guard that fails on a legitimate state trains people to ignore it, which
 * costs more than the check is worth. So: if the fixture file has referees in
 * the round, the record must carry them. If it has none, there is nothing to
 * carry and that is reported rather than failed. */
const eflcFx = load('data/eflc_fixtures.js', 'EFLC_FIXTURES');
const eflc = A.matchesFor(A.LEAGUES.find((l) => l.code === 'EFLC'));
if (eflc.rows.length) {
  /* THE ROUND THE RECORD WAS ACTUALLY BUILT FOR, which is not necessarily the
     one currentRound names. matchesFor builds rows for nextRound — the first
     round with a fixture still unplayed — while this counted appointments in
     currentRound. The two agree for most of a week and diverge the moment the
     last fixture of a round kicks off: nextRound rolls forward to a round the
     EFL has not published officials for yet, currentRound stays put, and the
     guard compared twelve appointments in one round against zero referees in
     another. It failed on a mid-morning rollover, for the world being in an
     ordinary state — the exact failure the note above says this was rewritten
     to stop. Comparing like with like is the whole fix. */
  const openRound = eflc.round;
  const appointedInFile = eflcFx.filter((f) => f.r === openRound && f.ref).length;
  const withRef = eflc.rows.filter((r) => r.referee).length;
  if (appointedInFile > 0) {
    assert.ok(withRef > 0,
      `${appointedInFile} fixture(s) in Championship round ${openRound} carry a ` +
      'referee in the fixture file, but none reached the match record — the ' +
      'appointments overlay is not reaching the end of the chain');
  } else {
    console.log(`  note: Championship round ${openRound} has no published ` +
      'appointments yet — nothing for the match record to carry');
  }
  const priced = eflc.rows.filter((r) => r.referee && r.ref_carded).length;
  assert.ok(priced * 2 >= withRef,
    `${priced} of ${withRef} appointed officials have a card record — the name ` +
    'join is broken, and those fixtures are recorded as priced at a neutral referee');
}

/* ---- 4. the outcome convention, worked by hand ------------------------- */
/* 10 a yellow, 25 a red, which is what PLDCore.bookingPointsDist prices. Each
   case below is a real scoreline shape, not a random vector. */
const cases = [
  { name: 'a quiet match',
    c: { yellows_home: 1, yellows_away: 1, reds_home: 0, reds_away: 0, second_yellows_home: 0, second_yellows_away: 0 },
    cards: 2, points: 20 },
  { name: 'four yellows and a straight red',
    c: { yellows_home: 2, yellows_away: 2, reds_home: 1, reds_away: 0, second_yellows_home: 0, second_yellows_away: 0 },
    cards: 5, points: 65 },
  { name: 'a second yellow counts as a dismissal, not a fresh booking',
    c: { yellows_home: 3, yellows_away: 2, reds_home: 0, reds_away: 0, second_yellows_home: 0, second_yellows_away: 1 },
    cards: 6, points: 75 },
  { name: 'a goalless, cardless match',
    c: { yellows_home: 0, yellows_away: 0, reds_home: 0, reds_away: 0, second_yellows_home: 0, second_yellows_away: 0 },
    cards: 0, points: 0 }
];
for (const t of cases) {
  const got = A.outcomeTotals(t.c);
  assert.equal(got.cards_total, t.cards, `${t.name}: ${got.cards_total} cards, expected ${t.cards}`);
  assert.equal(got.points_total, t.points, `${t.name}: ${got.points_total} points, expected ${t.points}`);
}

/* The second yellow is the case a refit would never notice being wrong: it
   moves a points total by a fixed 10 and leaves everything looking sane. */
const withSecond = A.outcomeTotals(
  { yellows_home: 2, yellows_away: 2, reds_home: 0, reds_away: 0, second_yellows_home: 1, second_yellows_away: 0 });
const asPlainRed = A.outcomeTotals(
  { yellows_home: 2, yellows_away: 2, reds_home: 1, reds_away: 0, second_yellows_home: 0, second_yellows_away: 0 });
assert.deepEqual(withSecond, asPlainRed,
  'a second yellow and a straight red score differently — the two feeds spell ' +
  'the same dismissal both ways, so they must total the same');

console.log(`check-match-record OK: ${checked} fixtures priced with the pages' own ` +
  'constants, derby lists parse for all three desks, over-lines monotonic, and the ' +
  'outcome convention (10/25, second yellow = dismissal) holds by hand');

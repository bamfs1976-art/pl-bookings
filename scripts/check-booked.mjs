// Guard /booked — the cards actually shown, and the three tables that count them.
//
// Everything else on this site is a forecast, and a forecast that is wrong is
// an opinion. This page states FACTS about named players, which makes its
// failure modes different in kind: a leaderboard that miscounts is a public
// claim that a particular man has been booked more often than he has.
//
// Four ways it goes wrong, and none of them looks wrong on the page.
//
//   1. A SECOND YELLOW COUNTED TWICE. The feed reports a sending-off as two
//      yellows and a red. Count all three and a dismissal is worth three
//      cards — and it inflates exactly the players a leaderboard puts at the
//      top. The convention lives in data/build_bookings.py and is pinned by
//      data/test_bookings.py; what is checked here is that the PAGE does not
//      recount anything, because a second implementation is how the two would
//      come to disagree.
//   2. THE THREE TABLES DISAGREE. Season, last five rounds and per club are
//      one ledger sliced three ways. A player's total in the club table has
//      to be his total in the league table.
//   3. THE RECENT WINDOW SLIDES ON DATES. "The last five games" is a question
//      about a league, and a league plays a round at a time.
//   4. THE LEDGER IS ABSENT AND THE PAGE LOOKS BROKEN. Before the first
//      harvest there is no file, and "no bookings recorded yet" is a state,
//      not a fault.
//
//     node scripts/check-booked.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const today = read('today.html');

/* ---- 1. the page counts nothing of its own ------------------------------ */
/* The ledger already stores cards per round with a second yellow counted
   once. A page that reached for `yc` or `rc` would be re-deriving a total
   from the raw feed fields under a different convention. */
assert.ok(!/\.yc\b[\s\S]{0,40}\+[\s\S]{0,40}\.rc\b/.test(today),
  'today.html adds a yellow count to a red count — the ledger has already ' +
  'resolved a dismissal, and adding them again counts a second yellow twice');
assert.ok(/p\.rds/.test(today),
  'today.html no longer reads the ledger\'s per-round map, so whatever it is ' +
  'counting is not what the ledger recorded');

/* ---- 2. the window is rounds, not dates -------------------------------- */
const recent = /function recentFrom\(L\)[\s\S]*?\n  \}/.exec(today);
assert.ok(recent, 'today.html no longer computes the recent window');
assert.ok(/led\.rounds/.test(recent[0]),
  'the last-five window is no longer computed from the ledger\'s round count');
assert.ok(!/Date|kickoff|getTime/.test(recent[0]),
  'the last-five window slides on DATES — a league plays a round at a time, ' +
  'and a date window puts a Friday fixture and the following Monday\'s in ' +
  'different weeks depending on when the page happened to be opened');
const span = /var RECENT_ROUNDS = (\d+);/.exec(today);
assert.ok(span && Number(span[1]) === 5,
  `the page's recent window is ${span ? span[1] : 'missing'} rounds, and the ` +
  'section is headed "the last five"');

/* ---- 3. the three tables slice ONE list -------------------------------- */
/* bookedRows is the only thing that turns a ledger into rows; all three
   sections call it. A second row builder is how the club table would come to
   count differently from the league table above it. */
const builders = (today.match(/function booked(Rows|Table)\(/g) || []).length;
assert.equal(builders, 2,
  `today.html has ${builders} booking row/table builders, expected exactly ` +
  'two (one that slices the ledger, one that draws a table) — a third is a ' +
  'second convention waiting to disagree with the first');
for (const section of ['#bookedLeagues', '#bookedRecent', '#bookedClubs']) {
  assert.ok(today.includes(section), `today.html has no ${section} section`);
}

/* ---- 4. and the arithmetic, over the shipped ledgers -------------------- */
/* Run against the real files where they exist. This is the assertion that
   would have caught a merge bug in the ledger builder AFTER it shipped, which
   the Python tests cannot: they test the builder, this tests the artefact. */
const LEDGERS = [
  ['data/pl_bookings.js', 'PL_BOOKINGS', 'PL'],
  ['data/eflc_bookings.js', 'EFLC_BOOKINGS', 'EFLC'],
  ['data/laliga_bookings.js', 'LALIGA_BOOKINGS', 'LL'],
];
let seen = 0, players = 0, cards = 0;
for (const [file, konst, code] of LEDGERS) {
  if (!existsSync(join(root, file))) continue;
  const c = {};
  vm.createContext(c);
  vm.runInContext(read(file), c);
  const led = vm.runInContext(konst, c);
  seen++;
  assert.ok(led && Array.isArray(led.players),
    `${file} does not hold a players list`);
  assert.ok(Number(led.rounds) >= 1, `${file} records no rounds`);
  assert.ok(Array.isArray(led.fixtures) && led.fixtures.length,
    `${file} records no fixtures — the harvest would re-walk the season and ` +
    'the merge would have nothing to protect against double counting');
  const ids = new Set(led.fixtures);
  assert.equal(ids.size, led.fixtures.length,
    `${file} lists a fixture twice, so a re-walk would double its cards`);

  const namesSeen = new Set();
  for (const p of led.players) {
    assert.ok(p.n && p.c, `${file} has a row with no name or club`);
    const key = p.c + '|' + p.n;
    assert.ok(!namesSeen.has(key),
      `${file} lists ${p.n} (${p.c}) twice — two rows for one man split his ` +
      'total and neither is right');
    namesSeen.add(key);
    const rds = Object.keys(p.rds || {});
    assert.ok(rds.length, `${file}: ${p.n} is in the ledger with no rounds`);
    for (const r of rds) {
      assert.ok(Number(r) >= 1 && Number(r) <= led.rounds,
        `${file}: ${p.n} is booked in round ${r}, but the ledger has only ` +
        `reached round ${led.rounds}`);
      assert.ok(Number(p.rds[r]) >= 1,
        `${file}: ${p.n} has a round with no cards in it — a player who was ` +
        'not booked should not be in the ledger at all');
    }
    players++;
    cards += rds.reduce((a, r) => a + Number(p.rds[r]), 0);
  }

  /* SORTED BY CARDS, most first. The page re-sorts, so this is not what the
     reader sees — but a ledger that arrives unsorted means the builder's
     ordering has been lost, and the top of the file is what anyone reading
     the data by hand will trust. */
  const totals = led.players.map((p) =>
    Object.values(p.rds).reduce((a, b) => a + Number(b), 0));
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i] <= totals[i - 1],
      `${file} is not ordered by cards: row ${i} has ${totals[i]} after ` +
      `${totals[i - 1]}`);
  }
  /* AND NOBODY HAS MORE CARDS THAN ROUNDS PLAYED TIMES TWO. Two in a match is
     a dismissal; three is the second yellow counted twice, which is the one
     arithmetic error this whole file exists to catch. */
  for (const p of led.players) {
    for (const r of Object.keys(p.rds)) {
      assert.ok(Number(p.rds[r]) <= 2,
        `${file}: ${p.n} is recorded with ${p.rds[r]} cards in round ${r}. ` +
        'Two is a booking and a dismissal; more than two means a second ' +
        'yellow has been counted as a yellow AND a red');
    }
  }
}

/* ---- 4a. and WHICH round, not only how many ---------------------------- */
/* The recent table's whole point is the shape of a run: two cards is a total,
   "booked in the last round and the one before" is form. Both the table and
   its share card have to carry the per-round cells, and they have to come
   from the SAME row — deriving them twice is how the card would come to
   disagree with the table it was exported from. */
/* Two assertions, not one with an `||`. Written as an alternation it passed
   with either half deleted, which is the one thing it was there to prevent:
   the row builder and the card each need their own. */
assert.ok(/cells: cells/.test(today),
  'bookedRows no longer attaches the per-round cells to a row, so the ' +
  'last-five table and its card can only show a total');
assert.ok(/bookedTable\(rows, 10, \{ rounds: heads \}\)/.test(today),
  'the last-five table is drawn without its round columns');
assert.ok(/cells: r\.cells/.test(today),
  'the last-five share card is built without the per-round cells the table shows');
assert.ok(/r\.cells\.forEach/.test(read('assets/share.js')),
  'assets/share.js no longer draws the per-round cells, so the card and the ' +
  'page show different things');

/* ---- 5. an absent ledger is a state, not a fault ----------------------- */
assert.ok(/No bookings have been/.test(today),
  'today.html no longer says anything when no ledger has been built — a blank ' +
  'page is indistinguishable from a broken one');
assert.ok(/bookings: d\.bookings \|\| null/.test(read('today.html')),
  'today.html no longer tolerates a league without a ledger');
assert.ok(/bookings:/.test(read('data-frame.html')),
  'data-frame.html does not publish the ledger, so no league can have one');

/* ---- 6. every section can be shared ------------------------------------ */
for (const kind of ['league', 'recent', 'clubs']) {
  assert.ok(today.includes(`data-book-share="${kind}"`),
    `the ${kind} section has no share button`);
}
assert.ok(/S\.rankCard\(/.test(today), 'today.html never builds a rank card');
const share = read('assets/share.js');
assert.ok(/rankCard: rankCard/.test(share), 'assets/share.js does not export rankCard');
/* One builder for all three cards, for the same reason the page has one row
   builder: three card functions is three places for the count to differ. */
assert.equal((share.match(/function rankCard\(/g) || []).length, 1,
  'there is more than one rank-card builder');

/* ---- 7. exactly ONE workflow builds the ledger, and it commits it ------- */
/* It was in two: the daily refresh and the three-times-a-day fixture job. Two
   copies of a build step is this repository's most reliable way of producing
   two that disagree, and the daily one was redundant the moment the frequent
   one existed. The ledger is only interesting once matches have FINISHED, so
   it belongs with the job that runs after them. */
const wf = join(root, '.github', 'workflows');
const flows = readdirSync(wf).filter((f) => /\.ya?ml$/.test(f));
const ledgerJobs = flows.filter((f) =>
  /build_bookings\.py/.test(readFileSync(join(wf, f), 'utf8')));
assert.equal(ledgerJobs.length, 1,
  `${ledgerJobs.length} workflow(s) build the bookings ledger (${ledgerJobs.join(', ')}) — ` +
  'one owner, or the two will drift and the page will show whichever ran last');
const owner = readFileSync(join(wf, ledgerJobs[0]), 'utf8');
for (const f of ['pl_bookings.js', 'eflc_bookings.js', 'laliga_bookings.js']) {
  assert.ok(owner.includes('data/' + f),
    `${ledgerJobs[0]} builds the ledger but never stages data/${f} — the file is ` +
    'written on the runner, reported in the log, and discarded when it is torn down');
}
/* AND IT RUNS AFTER THE FOOTBALL, not once a day. A leaderboard of cards
   shown is stale the moment a match finishes. */
const crons = [...owner.matchAll(/cron:\s*'(\d+)\s+(\d+)/g)].map((m) => Number(m[2]));
assert.ok(crons.length >= 5,
  `the ledger is rebuilt ${crons.length} time(s) a day, which cannot follow a ` +
  'round of football — matches finish through the afternoon and the evening');
assert.ok(crons.some((h) => h >= 16 && h <= 18),
  'nothing runs in the hour after an English afternoon kick-off finishes');
assert.ok(crons.some((h) => h >= 21 || h <= 1),
  'nothing runs after a Spanish evening kick-off finishes');

console.log(`check-booked OK: ${seen} ledger(s), ${players} booked player(s), ` +
  `${cards} card(s); no player recorded with more than two in a match, the ` +
  'recent window slices on rounds, one row builder feeds all three tables, ' +
  `every section shares through one card, and ${ledgerJobs[0]} rebuilds it ` +
  `${crons.length} times a day`);

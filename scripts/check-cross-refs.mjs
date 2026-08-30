// Guard the borrowed referee records — the arithmetic, and who is allowed to
// see them.
//
// data/cross_refs.py fills a division's referee table with an official who has
// a record in a NEIGHBOURING competition and none here: Josh Smith took a
// Premier League fixture with 27 Championship matches on record and nothing in
// the Premier League table, so that match priced at the league rate while the
// number it needed was one file away. data/test_cross_refs.py tests the rule;
// this tests the ARTEFACT and the PAGES, which the Python cannot.
//
// Three ways it goes wrong, and none of them looks wrong on the page.
//
//   1. THE BORROWED ROW MOVES THE AVERAGE IT IS MEASURED AGAINST. His matches
//      were refereed in the other league and are already in that league's
//      baseline. Count them here too and this division's average shifts —
//      which shifts the factor his borrowed rate is turned into. Circular, and
//      a ×0.91 and a ×1.00 look equally plausible on a fixture card.
//      The loop that computes the average existed FOUR times, once per desk
//      plus leagueRedRate. Three are now one call; the fourth is checked here.
//   2. THE PAGE DOESN'T SAY. A row reading "Tony Harrington · 11 matches ·
//      2.97 yellows" inside the Championship desk is a factual claim that he
//      took eleven Championship matches. He took none.
//   3. THE RATE IS COPIED RATHER THAN SCALED. 3.37 a game means something
//      different in a division averaging 3.71 from one averaging 4.41.
//
//     node scripts/check-cross-refs.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

const core = {};
vm.createContext(core);
vm.runInContext(read('assets/core.js'), core);
const C = core.PLDCore;

const LEAGUES = [
  ['PL', 'data/pl_data.js', 'Premier League'],
  ['EFLC', 'data/eflc_data.js', 'EFL Championship'],
  ['LL', 'data/laliga_data.js', 'La Liga'],
];

/* ---- 1. the average is over what the division actually refereed --------- */
/* Exercised as a function, on a set built here, so it fails for the reason it
   names rather than because today's data happens to have no borrowed rows. */
{
  const own = [
    { n: 'A One', matches: 10, ypg: 4, red: 0.1, cpf: 0.2 },
    { n: 'B Two', matches: 10, ypg: 4, red: 0.1, cpf: 0.2 },
  ];
  const lent = { n: 'C Three', matches: 100, ypg: 1, red: 9, cpf: 9, borrowed: 'EFLC' };
  assert.equal(C.leagueRates(own).avgYpg, 4);
  assert.equal(C.leagueRates(own.concat(lent)).avgYpg, 4,
    'PLDCore.leagueRates counts a borrowed official into the division average. ' +
    'His matches were refereed in another league and are already in that ' +
    'league\'s baseline; counting them here moves the number his borrowed rate ' +
    'is then measured against.');
  assert.equal(C.leagueRates(own.concat(lent)).avgRed, 0.1,
    'the red rate counts borrowed matches');
  assert.equal(C.leagueRates(own.concat(lent)).avgCpf, 0.2,
    'cards-per-foul counts borrowed matches');
  assert.equal(C.leagueRedRate(own.concat(lent)), 0.1,
    'leagueRedRate no longer goes through leagueRates, so the two can now ' +
    'disagree about what a division averages');
  /* WEIGHTED, not a mean of rates — the property that was in three desks. */
  assert.equal(C.leagueRates([
    { n: 'A', matches: 30, ypg: 4 }, { n: 'B', matches: 10, ypg: 1 },
  ]).avgYpg, 3.25, 'the league average is no longer weighted by matches');
}

/* ---- 2. and every page's average goes through it ------------------------ */
/* Three desks call it. The fourth — index.html — keeps its own UNWEIGHTED mean
   deliberately (changing it moves every price on that desk), so what is
   required of it is only the exclusion. */
for (const page of ['today.html', 'eflc.html', 'laliga.html']) {
  const src = read(page);
  assert.ok(/(C|PLDCore)\.leagueRates\(/.test(src),
    `${page} computes its own league average instead of calling ` +
    'PLDCore.leagueRates — a fourth copy of the loop, and one more place to ' +
    'forget that a borrowed official is not part of this division');
  assert.ok(!/forEach\(function \(r\) \{[\s\S]{0,200}Number\(r\.matches\)[\s\S]{0,200}r\.ypg/.test(src),
    `${page} still has an inline match-weighted referee average beside the ` +
    'shared one; two of them is how they come to disagree');
}
{
  const idx = read('index.html');
  const avgs = idx.match(/const REF_AVG_(YPG|CPF)=[^\n]*/g) || [];
  assert.equal(avgs.length, 2, 'index.html no longer declares both referee averages');
  for (const line of avgs) {
    assert.ok(/filter\(r=>!r\.borrowed\)/.test(line),
      'index.html averages the referee table without excluding borrowed rows:\n' +
      `  ${line.slice(0, 110)}\n` +
      'An official borrowed from another division would then move the very ' +
      'baseline his borrowed rate is measured against.');
  }
}

/* ---- 3. the shipped tables, and the arithmetic that produced them ------- */
const tables = {};
for (const [code, file] of LEAGUES) {
  if (!existsSync(join(root, file))) continue;
  const c = {};
  vm.createContext(c);
  vm.runInContext(read(file), c);
  tables[code] = vm.runInContext('REFS', c);
}
assert.ok(Object.keys(tables).length, 'no league dataset could be read');

let borrowed = 0;
for (const [code, file] of LEAGUES) {
  const refs = tables[code];
  if (!refs) continue;
  const native = refs.filter((r) => !r.borrowed);
  const lent = refs.filter((r) => r.borrowed);
  borrowed += lent.length;
  const mine = C.leagueRates(native).avgYpg;

  for (const r of lent) {
    assert.ok(tables[r.borrowed],
      `${file}: ${r.n} is borrowed from ${r.borrowed}, which is not a ` +
      'division this app models');
    assert.notEqual(r.borrowed, code,
      `${file}: ${r.n} is marked as borrowed from his own division`);
    /* NOT ALSO A REAL ROW. Two rows for one official split the dropdown and
       one of them is priced off another league. */
    assert.equal(native.filter((n) => n.n === r.n).length, 0,
      `${file}: ${r.n} appears BOTH as a measured official and as a borrowed ` +
      'one — a measured record must always win');
    assert.ok(Number(r.matches) > 0,
      `${file}: ${r.n} is borrowed with no match count, so the page cannot ` +
      'say how much evidence is behind his number');
    assert.ok(r.ypg != null, `${file}: ${r.n} is borrowed with no card rate`);

    /* THE SCALING, RECOMPUTED. This is the assertion the Python tests cannot
       make: it checks the shipped file against the shipped files it was
       derived from, so a build that silently stopped scaling is caught after
       it has shipped rather than never. */
    const src = tables[r.borrowed].find((x) => x.n === r.n && !x.borrowed);
    assert.ok(src,
      `${file}: ${r.n} is borrowed from ${r.borrowed}, whose table has no ` +
      'measured row for him — the record it points at is gone');
    const theirs = C.leagueRates(tables[r.borrowed].filter((x) => !x.borrowed)).avgYpg;
    const want = Math.round(src.ypg * (mine / theirs) * 100) / 100;
    assert.ok(Math.abs(r.ypg - want) < 0.011,
      `${file}: ${r.n} carries ${r.ypg} yellows a game, but ${src.ypg} in the ` +
      `${r.borrowed} scaled from that division's ${theirs.toFixed(3)} to this ` +
      `one's ${mine.toFixed(3)} is ${want}. A rate COPIED rather than scaled ` +
      'reads as this official being stricter or softer than he is.');
  }
}

/* ---- 4. and the page says so -------------------------------------------- */
const lbl = C.refLabel({ ref: { n: 'Josh Smith', ypg: 3.4, matches: 27, borrowed: 'EFLC' } });
assert.equal(lbl.state, 'borrowed',
  'PLDCore.refLabel shows an official priced off another division as an ' +
  'ordinary rating, which passes one league\'s evidence off as another\'s');
assert.ok(/†/.test(lbl.text), 'the borrowed fixture label carries no marker');
assert.ok(/EFL Championship/.test(lbl.title || ''),
  'the borrowed tooltip does not name the competition the record came from — ' +
  '"27 matches in the EFLC" tells a reader nothing');
assert.equal(C.refLabel({ ref: { n: 'Samuel Barrott', ypg: 3.71 } }).state, 'rated',
  'a measured official is now labelled as borrowed');
assert.equal(C.refLabel({ name: 'Carlos Muniz Munoz' }).state, 'unrated',
  'an official with no record anywhere is no longer labelled unrated');

const note = C.refBorrowNote({ n: 'X', matches: 11, borrowed: 'PL' });
assert.ok(note && /11 match/.test(note.title) && /Premier League/.test(note.title),
  'PLDCore.refBorrowNote does not say how many matches, or where');
assert.equal(C.refBorrowNote({ n: 'X', matches: 11 }), null,
  'refBorrowNote marks a measured official as borrowed');

/* ALL THREE REFEREE TABLES, not the fixture line only. The fixture card and
   the table are two views of one row, and a marker on one of them is how the
   page comes to contradict itself. */
for (const page of ['index.html', 'eflc.html', 'laliga.html']) {
  assert.ok(/refBorrowNote\(/.test(read(page)),
    `${page}'s referee table does not mark a borrowed row, so it states a ` +
    'match count in this division for an official who has none here');
}
/* And the two desks with a table footer must not caption the average with a
   population it was not taken over. */
for (const page of ['eflc.html', 'laliga.html']) {
  assert.ok(/nOwn/.test(read(page)),
    `${page} captions the league average with REFLIST.length, which now counts ` +
    'borrowed officials the average deliberately excludes');
}

/* ---- 5. one owner, and it runs after the tables it reads ---------------- */
const wf = join(root, '.github', 'workflows');
const flows = readdirSync(wf).filter((f) => /\.ya?ml$/.test(f));
/* The COMMAND, not the filename. Matching `cross_refs.py` alone also matched
   ci.yml, which runs data/test_cross_refs.py — so adding the test to CI made
   this guard report two owners of the build step. Caught by mutation-testing
   the guard itself, which is the only reason it was caught at all: it fired
   with a message about the wrong thing. */
const RUNS = /python3\s+data\/cross_refs\.py/;
const owners = flows.filter((f) => RUNS.test(readFileSync(join(wf, f), 'utf8')));
assert.equal(owners.length, 1,
  `${owners.length} workflow(s) borrow referee records (${owners.join(', ')}) — ` +
  'this rewrites the same league data files build_refs.py patches, and two ' +
  'owners of one file is this repository\'s most reliable way of producing two ' +
  'that disagree');
const owner = readFileSync(join(wf, owners[0]), 'utf8');
assert.ok(owner.lastIndexOf('build_refs.py') < owner.indexOf('cross_refs.py'),
  `${owners[0]} runs cross_refs.py BEFORE the last build_refs.py step. ` +
  'build_refs rewrites the whole REFS block from its own computation, so every ' +
  'borrowed row it did not know about is erased on that run.');

console.log(`check-cross-refs OK: ${borrowed} borrowed record(s) across ` +
  `${Object.keys(tables).length} division(s), each scaled by the two leagues' ` +
  'own averages, none counted into the average it is measured against, all ' +
  `four averaging sites excluding them, marked on the fixture line and in all ` +
  `three referee tables, and rebuilt by ${owners[0]} after build_refs`);

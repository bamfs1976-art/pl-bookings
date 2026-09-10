#!/usr/bin/env node
/* No desk may ship a dataset that has lost its faces.
 *
 * WHAT THIS CATCHES. On 10 September 2026 data/eflc_data.js went from 575
 * photographs in 763 rows to 126 in 761 in a single refresh. Nothing reported
 * it. The refresh passed its own guards and committed, the desk rendered, the
 * pricing was untouched, and the only symptom was several hundred monograms
 * where there had been faces. It surfaced six hours later, in a DIFFERENT
 * workflow, when check-booked.mjs refused a bookings ledger with 15 faces in
 * 85 rows and took the fixtures job down with it. By then the bad data was
 * already on main and referee appointments had stopped being committed.
 *
 * So this is the same test one step earlier, on the datasets themselves, where
 * the refresh will see it BEFORE it pushes rather than after.
 *
 * WHY A FLOOR AND NOT A COMPARISON. A guard cannot see the previous build. The
 * floor is set well under every healthy desk and well over the failure: the
 * four desks sit between 56% and 76%, and the broken Championship was 17%.
 * Anything in between is a judgement call nobody has had to make yet.
 *
 * WHY NOT 100%. A player with no photograph is ordinary and must stay
 * ordinary. Every desk carries rows on the NEW basis, filled from a roster for
 * players the statistics feed has nothing on, and some of those have no face
 * anywhere. They draw a monogram, which is correct.
 *
 * Skips a desk whose data file has not been generated: they come from the
 * refresh workflow, and CI on a fresh clone should not fail for their absence.
 *
 *     node scripts/check-photos.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* file, the global it declares, and the name to report it under. */
const DESKS = [
  ['pl_data.js', 'PL_PLAYERS', 'Premier League'],
  ['eflc_data.js', 'EFLC_PLAYERS', 'EFL Championship'],
  ['laliga_data.js', 'LALIGA_PLAYERS', 'La Liga'],
  ['seriea_data.js', 'SERIEA_PLAYERS', 'Serie A'],
];

/* Measured 10 September 2026 with every desk healthy: PL 56%, Championship
   75%, La Liga 76%, Serie A 71%. The Championship's collapse was 17%. */
const FLOOR = 0.40;

const lines = [];
let checked = 0;
for (const [file, global_, label] of DESKS) {
  const path = join(root, 'data', file);
  if (!existsSync(path)) continue;
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(path, 'utf8'), ctx);
  const players = vm.runInContext(
    `typeof ${global_} !== 'undefined' ? ${global_} : null`, ctx);
  if (!players || !players.length) continue;

  checked += 1;
  const withPhoto = players.filter((p) => p && p.ph).length;
  const rate = withPhoto / players.length;
  lines.push(`${label} ${withPhoto}/${players.length} (${(rate * 100).toFixed(0)}%)`);

  assert.ok(rate >= FLOOR,
    `data/${file}: only ${withPhoto} of ${players.length} players ` +
    `(${(rate * 100).toFixed(0)}%) carry a photograph, under the ${FLOOR * 100}% ` +
    'floor every desk has cleared since faces were added.\n' +
    'A photograph is a fact about a PERSON and must not depend on which ' +
    'season the form came from. It is filled in the builder from the ' +
    'roster harvest (/players/squads), which takes no season, so a ' +
    'collapse here means either that roster did not harvest or the fill ' +
    'stopped running.\n' +
    'Do NOT lower this floor to make the build pass: the desk renders ' +
    'perfectly well with monograms, which is exactly why nobody noticed ' +
    'the last time this happened.');

  /* AND THE FACES MUST BE REAL. A row carrying something that is not a URL on
     the host the CSP allows draws a broken image, which is worse than a
     monogram because it looks like a fault in the page rather than a gap in
     the data. */
  /* strictEqual on the COUNT, not deepStrictEqual on the array. These rows
     come out of a vm context, so an array derived from them carries that
     realm's Array.prototype and deepStrictEqual fails on the prototype even
     when both sides are empty. The names go in the message instead. */
  const bad = players.filter((p) => p && p.ph && !/^https:\/\/[\w.-]+\//.test(p.ph));
  assert.strictEqual(bad.length, 0,
    `data/${file}: ${bad.length} photograph(s) are not an https URL, so the ` +
    'page draws a broken image rather than a monogram: ' +
    bad.slice(0, 5).map((p) => `${p.n} -> ${JSON.stringify(p.ph)}`).join(', '));
}

if (!checked) {
  console.log('check-photos: no desk dataset is built yet, skipping.');
  process.exit(0);
}

console.log(`check-photos OK: ${checked} desk(s) above the ${FLOOR * 100}% floor, ` +
  `every face an https URL. ${lines.join(', ')}`);

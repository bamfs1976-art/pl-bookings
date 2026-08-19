#!/usr/bin/env node
/* The rotation model says what the data says, and keeps saying it.
 *
 * WHAT THIS IS. Congestion does not move a team's card count — the 2025-26
 * record excludes an effect the size of the desk's 0.2 gate. It does move
 * SELECTION: a congested side changed 2.55 of its eleven against a fresh
 * side's 1.94, and +0.346 above that club's own average (95% CI 0.11 to 0.58,
 * z = 2.90). That last number is the one that matters, because club habit
 * alone spans 1.57 to 3.27 changes a match and would otherwise explain the
 * whole thing.
 *
 * THE TWO FAILURES THIS GUARDS.
 *
 *   1. THE MODEL DRIFTING FROM ITS EVIDENCE. data/rotation_model.js is
 *      generated; a hand-edit, or a re-harvest that changes the record without
 *      a rebuild, leaves coefficients that no longer describe any season. So
 *      the fit is re-derived here from the committed data and compared.
 *
 *   2. THE LIFT QUIETLY EVAPORATING. If a future season's fit cannot separate
 *      rest from club habit, the model is squad depth wearing a fatigue label
 *      and must not be published as anything else. The interval has to exclude
 *      zero.
 *
 *     node scripts/check-rotation.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const ctx = { console };
vm.createContext(ctx);
for (const f of ['assets/core.js', 'data/rotation_model.js',
                 'data/pl_other_fixtures_2526.js', 'data/pl_lineups_2526.js']) {
  vm.runInContext(read(f), ctx);
}
const C = vm.runInContext('PLDCore', ctx);
const M = vm.runInContext('PL_ROTATION_MODEL', ctx);
const LINEUPS = vm.runInContext('PL_LINEUPS_2526', ctx);

/* ---- 1. the evidence is all there ---------------------------------------- */
assert.equal(LINEUPS.length, 760,
  `${LINEUPS.length} team sheets, not 760 — a 38-game season for twenty clubs. ` +
  'The first backfill returned 544 because three relegated clubs did not ' +
  'resolve and the both-sides rule then dropped their fixtures entirely');
const clubs = new Set(LINEUPS.map((r) => r.c));
assert.equal(clubs.size, 20, `${clubs.size} clubs in the team sheets, not 20`);
assert.ok(LINEUPS.every((r) => Array.isArray(r.xi) && r.xi.length === 11),
  'a starting eleven that is not eleven is a sheet caught mid-publication');

/* ---- 2. the shipped model is the one the data produces ------------------- */
/* Re-run the builder and compare, rather than trusting the file. */
execFileSync('node', [join(root, 'scripts', 'build-rotation-model.mjs')], { cwd: root });
const rebuiltCtx = { console };
vm.createContext(rebuiltCtx);
vm.runInContext(read('data/rotation_model.js'), rebuiltCtx);
const rebuilt = vm.runInContext('PL_ROTATION_MODEL', rebuiltCtx);
assert.deepEqual(rebuilt.rest, M.rest,
  'data/rotation_model.js does not match what the committed record produces — ' +
  'either it was hand-edited or the data moved without a rebuild');
assert.equal(rebuilt.euroAwayExtra, M.euroAwayExtra, 'the European increment has drifted');
assert.equal(rebuilt.fitted, M.fitted, 'the model was fitted on a different number of rows');

/* ---- 3. rest beats club habit, or it is not a model ---------------------- */
assert.ok(M.liftCi95 && M.liftCi95[0] > 0,
  `the lift above the club baseline is ${M.lift} with a 95% interval of ` +
  `${JSON.stringify(M.liftCi95)}, which includes zero. Rest days would then be ` +
  'adding nothing a club average does not already carry, and this must not be ' +
  'published as a rotation signal');
assert.ok(M.rest.congested > M.rest.fresh,
  `congested (${M.rest.congested}) does not exceed fresh (${M.rest.fresh}) — ` +
  'the sign has flipped and the model would be advising the opposite');

/* ---- 4. the band reads the lift, not the level --------------------------- */
/* Otherwise the heaviest rotator in the league is flagged every week whatever
   its schedule, and the most settled side never is — which is a table of club
   identity, not a forecast. */
const heavy = Object.entries(M.clubBaseline).sort((a, b) => b[1] - a[1])[0][0];
const light = Object.entries(M.clubBaseline).sort((a, b) => a[1] - b[1])[0][0];
const rested = [{ d: '2026-09-13T14:00:00+00:00', comp: 'PL', v: 'H' }];
const tired = [{ d: '2026-09-17T19:00:00+00:00', comp: 'UEL', v: 'A' }, ...rested];
const when = '2026-09-20T15:30:00+00:00';
assert.equal(C.rotationRisk(M, heavy, rested, when).band, 'settled',
  `${heavy} rotates most in the league and must still read "settled" when rested`);
assert.ok(['raised', 'high'].includes(C.rotationRisk(M, light, tired, when).band),
  `${light} rotates least and must still raise a flag when congested`);

/* ---- 5. and it is not being used to price cards -------------------------- */
/* The card question was asked and answered: no effect at the 0.2 gate. A
   rotation model sitting next to a card model is one import away from being
   mistaken for one. */
const cardModel = read('assets/cardmodel.js');
assert.ok(!/rotationRisk|rotation_model|PL_ROTATION_MODEL/.test(cardModel),
  'assets/cardmodel.js reads the rotation model. Rest days do not move a card ' +
  'count — that was measured, and the interval excludes an effect the size of ' +
  'the gate. This model predicts selection and nothing else');

console.log(`check-rotation OK: fitted on ${M.fitted} team-fixtures of ${M.season}; ` +
  `rest effect fresh ${M.rest.fresh}, normal ${M.rest.normal}, ` +
  `congested ${M.rest.congested}, European away extra ${M.euroAwayExtra}; ` +
  `lift ${M.lift} above club habit (CI ${M.liftCi95[0]} to ${M.liftCi95[1]}, ` +
  `z ${M.liftZ}); bands cut on lift, and no card model reads it`);

#!/usr/bin/env node
/* The fatigue factor is computed, shown, and NOT scored — and stays that way
 * until the evidence says otherwise.
 *
 * THE RESULT, on the 2025-26 record, 740 team-fixtures with a rest figure:
 *
 *   derbies excluded, raw      fresh 1.889   congested 1.795   spread -0.093
 *     home                     fresh 1.703   congested 1.587   spread -0.116
 *     away                     fresh 2.067   congested 2.000   spread -0.067
 *   derbies included           fresh 1.909   congested 1.842   spread -0.067
 *   referee-normalised         fresh +0.016  congested -0.075  spread -0.092
 *   differential (congested v fresh opponent, and the reverse)      -0.037
 *
 * Every cut points the same way and none of them clears the 0.2 gate. The
 * congested side takes FEWER yellows, by about a tenth of a card — the
 * opposite sign to the hypothesis, and small enough to be a tired side sitting
 * deeper and fouling less rather than anything about cards.
 *
 * WHY THIS GUARD EXISTS RATHER THAN A NOTE IN A COMMIT. A factor that is
 * computed and displayed is one line away from being multiplied in, and the
 * line is easy to add in good faith six months from now by someone reading the
 * bucket table and assuming it feeds something. So the exclusion is asserted:
 * the scoring path must not read the fatigue fields, and the gate must be
 * evaluated on the controlled run rather than on whichever of the six numbers
 * happens to be largest.
 *
 * IF A LATER SEASON CLEARS THE BAR, this guard fails loudly and tells you to
 * change it deliberately. That is the intended way in.
 *
 *     node scripts/check-fatigue.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const ctx = { console };
vm.createContext(ctx);
for (const f of ['assets/core.js', 'data/pl_backtest_2526.js',
                 'data/pl_other_fixtures_2526.js', 'assets/backtest.js']) {
  vm.runInContext(read(f), ctx);
}
const C = vm.runInContext('PLDCore', ctx);
const B = vm.runInContext('PLBacktest', ctx);
const record = vm.runInContext('PL_BACKTEST_2526', ctx);
const other = vm.runInContext('PL_OTHER_FIXTURES_2526', ctx);
const shortOf = vm.runInContext(
  'typeof PL_OTHER_FIXTURES_2526_CLUBS === "undefined" ? null : PL_OTHER_FIXTURES_2526_CLUBS', ctx);

assert.ok(shortOf && Object.keys(shortOf).length >= 20,
  'data/pl_other_fixtures_2526.js carries no club map. The backtest walks a ' +
  'record naming clubs in full and the cup dates key on short codes; without ' +
  'the bridge every club is unmapped, which reads exactly like a season in ' +
  'which nobody played midweek');

const r = B.fatigue({ core: C, data: record, other, shortOf });
assert.ok(r, 'the fatigue analysis returned nothing');

/* ---- 1. the measurement is made on everything, not on a convenient slice -- */
assert.equal(r.unmapped.length, 0,
  `clubs the bridge could not name: ${r.unmapped.join(', ')} — an unmapped ` +
  'club looks identical to one that never played midweek, and that is how ' +
  'West Ham, Burnley and Wolves went missing from the first run');
assert.ok(r.teamFixtures >= 760,
  `only ${r.teamFixtures} team-fixtures — a 38-game season for twenty clubs is 760`);
assert.ok(r.withRest >= 720,
  `only ${r.withRest} team-fixtures carry a rest figure; 20 openers have no ` +
  'previous match and the rest should');

/* ---- 2. the cup and European dates are actually present ------------------ */
/* The whole argument for harvesting them is that league-only rest days put
   three quarters of the season in "fresh". If that is what the buckets look
   like again, the extra dates have stopped arriving and the factor is being
   judged on a season that did not happen. */
const congested = r.primary.congested.n;
const total = r.primary.fresh.n + r.primary.normal.n + congested;
assert.ok(congested / total > 0.2,
  `only ${(100 * congested / total).toFixed(1)}% of team-fixtures are congested. ` +
  'On league dates alone it is 11.8% and with the cups and Europe 34.7%, so ' +
  'this says the midweek dates are missing again');

/* ---- 3. the gate is judged on the CONTROLLED run ------------------------- */
assert.equal(r.measured, r.refNormalised.spread,
  'the gate is being read off a different run from the referee-normalised, ' +
  'derby-excluded one. A threshold you may choose the input to is not a ' +
  'threshold');
assert.equal(r.threshold, 0.2, `the gate has moved to ${r.threshold}`);

/* ---- 4. and it does not pass, so nothing may score it -------------------- */
assert.equal(r.passes, false,
  `the fatigue factor now measures ${r.measured} against a gate of ` +
  `${r.threshold}. That is the intended way in — but it is a decision, not a ` +
  'side effect: wire it into the scoring path deliberately and update this ' +
  'guard in the same commit');

/* The exclusion, asserted rather than trusted. A displayed factor is one line
   away from being multiplied in.
   PRECISELY: the fatigue identifiers may appear only where they are DEFINED
   and where they are EXPORTED. Anywhere else in core.js is a call site, and a
   call site inside this file is the pricing path. The first version of this
   check sliced "everything after contextProb" and fired on the definitions
   themselves — a guard that fails on the code it is guarding teaches people to
   weaken it. */
{
  const src = read('assets/core.js');
  const from = src.indexOf('/* ---- fatigue: rest days');
  const to = src.indexOf('const PLDCore = {');
  assert.ok(from > 0 && to > from, 'the fatigue block in core.js has moved');
  const exportLine = src.slice(to, src.indexOf('\n', src.indexOf('restDays, restBucket', to)));
  const elsewhere = (src.slice(0, from) + src.slice(to).replace(exportLine, ''));
  const hits = [...elsewhere.matchAll(/restBucket|restDays|euroAway72h/g)];
  assert.equal(hits.length, 0,
    `assets/core.js calls a fatigue field ${hits.length} time(s) outside its own ` +
    'definition while the factor is below its gate — it is measured and shown, ' +
    'not priced');
}
{
  /* cardmodel.js is the per-player pricing library and has no business
     knowing about rest at all yet. */
  const src = read('assets/cardmodel.js');
  assert.ok(!/restBucket|restDays|euroAway72h/.test(src),
    'assets/cardmodel.js reads a fatigue field while the factor is below its gate');
}

console.log('check-fatigue OK: rest days computed from ' +
  `${other.length} cup and European dates plus the league record; ` +
  `${r.withRest} team-fixtures bucketed, ${(100 * congested / total).toFixed(1)}% congested; ` +
  `measured ${r.measured.toFixed(3)} against a gate of ${r.threshold} — ` +
  'below it in every cut, so the factor is computed and not scored');

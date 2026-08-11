// Guard the pipeline front door against the pipeline.
//
// scripts/build_data.py is a RUNNER, not a second pipeline: it shells out to
// the same scripts that .github/workflows/data-refresh.yml already calls, in
// the order that workflow established. The value is that a regeneration by
// hand is one command instead of twenty copied out of a YAML file.
//
// The risk is the obvious one. Two lists of the same steps drift, and this
// repository has paid for that shape of mistake more than once. A front door
// that has quietly lost a step does not fail — it produces a dataset that
// looks complete and is missing a column, which is the failure nobody notices
// until a number is wrong in public.
//
// So: every script build_data.py runs must be a script the workflow runs, and
// the one ordering constraint that is load-bearing must hold in both.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runner = readFileSync(join(root, 'scripts', 'build_data.py'), 'utf8');
const flow = readFileSync(join(root, '.github', 'workflows', 'data-refresh.yml'), 'utf8');

/* Only the STEPS table — GUARDS run checks, which the refresh calls under
   different step names and which are not part of the build order. */
const stepsBlock = runner.slice(runner.indexOf('STEPS = ['), runner.indexOf('GUARDS = ['));
assert.ok(stepsBlock.length > 200, 'build_data.py: the STEPS table has moved or been renamed');

const scripts = [...new Set(
  [...stepsBlock.matchAll(/"(data\/[a-z_]+\.py|scripts\/[a-z-]+\.mjs)"/g)].map((m) => m[1])
)];
assert.ok(scripts.length >= 8,
  `build_data.py only runs ${scripts.length} scripts — the front door has lost steps`);

for (const s of scripts) {
  assert.ok(flow.includes(s),
    `build_data.py runs ${s}, which data-refresh.yml never calls. Either the ` +
    'front door invented a step, or the workflow dropped one — and the ' +
    'workflow is the one that actually produces what ships.');
}

/* THE ORDER THAT MATTERS. build_pl_data.py regenerates CLUBS without the
   home/away card splits; build_club_splits.py puts them back. Reversed, the
   splits are computed and then overwritten, and caH/caA ship as null — a
   silent loss of the venue split the fixture heat is built on. */
/* Scoped to the code, not the file. Both sources DISCUSS these two scripts in
   prose above the steps that run them — build_data.py's own docstring names
   build_club_splits.py first, in a sentence explaining that it must come
   second — so a whole-file indexOf reads the explanation and calls it a bug.
   The first version of this check did exactly that and failed on correct
   code, which is the other way a guard can be useless. */
for (const [name, src] of [['build_data.py', stepsBlock], ['data-refresh.yml', flow]]) {
  const build = src.indexOf('build_pl_data.py');
  const splits = src.indexOf('build_club_splits.py');
  assert.ok(build > -1 && splits > -1, `${name} no longer calls both build steps`);
  assert.ok(build < splits,
    `${name} runs build_club_splits.py BEFORE build_pl_data.py — the splits ` +
    'would be regenerated away and caH/caA would ship null');
}

/* A keyed step must declare the variable it needs. One that does not would run
   without a key, fail inside the harvest, and be reported as a broken step
   rather than an absent credential. */
const keyed = [...stepsBlock.matchAll(/needs="([A-Z_]+)"/g)].map((m) => m[1]);
assert.ok(keyed.length >= 4, 'no keyed steps declare their credential');
for (const k of new Set(keyed)) {
  assert.ok(flow.includes(k), `build_data.py needs ${k}, which the workflow never sets`);
}

/* And the guards it runs afterwards must exist, or the run reports a clean
   dataset it never checked. */
const guards = [...runner.slice(runner.indexOf('GUARDS = [')).matchAll(/"(scripts\/[a-z-]+\.mjs)"/g)]
  .map((m) => m[1]);
assert.ok(guards.length >= 3, 'build_data.py runs almost no guards after building');
for (const g of guards) {
  assert.ok(readFileSync(join(root, g), 'utf8').length > 0, `${g} does not exist`);
}

console.log(`check-build-data OK: ${scripts.length} pipeline steps, all called by ` +
  `data-refresh.yml, splits after the rebuild in both, ${guards.length} guards wired`);

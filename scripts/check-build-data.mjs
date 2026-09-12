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
import { readFileSync, existsSync } from 'node:fs';
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

/* THE BUILD AND THE HARVEST MUST AGREE WHICH SEASON THE FORM IS.
   build_pl_data.FORM_SEASON was a literal with a comment telling the next
   person to move it when the form moved — and the form moves on its own, at
   round six, when scripts/form-season.mjs flips form_pl. It now comes from
   PL_FORM_SEASON, which the workflow must set on the build step from exactly
   the expression it harvests at. Not "an expression": the same one. A build
   that thinks the form is 2025-26 while the harvest fetched 2026-27 joins one
   season's fouls won onto another season's players and every number on the
   page looks right, which is the failure fill_fouls_won exists to refuse and
   the reason it has anything to compare against at all. */
const seasonOf = (re, what) => {
  const m = re.exec(flow);
  assert.ok(m, `data-refresh.yml no longer sets a season on ${what} — the ` +
    'Premier League build and its form harvest can no longer be shown to agree');
  return m[1].trim();
};
const harvestSeason = seasonOf(
  /API_FOOTBALL_SEASON:([^\n]*)\n\s*run: python3 data\/harvest_apifootball\.py --league PL --out pl_af_players\.json/,
  'the Premier League form harvest');
const buildSeason = seasonOf(
  /PL_FORM_SEASON:([^\n]*)\n\s*run: python3 data\/build_pl_data\.py/,
  'the Premier League build');
assert.equal(buildSeason, harvestSeason,
  'the Premier League build and its form harvest read different season ' +
  `expressions:\n  harvest ${harvestSeason}\n  build   ${buildSeason}\n` +
  'They must be identical, or the build will guard the fouls-won join ' +
  'against a season the harvest did not fetch.');
assert.ok(/steps\.form\.outputs\.form_pl/.test(buildSeason),
  'the Premier League build no longer takes its season from ' +
  'scripts/form-season.mjs, so nothing moves it when the league reaches ' +
  'round six and the form flips');

/* A GENERATED FILE MUST STATE THE BASIS IT WAS GENERATED FROM.
   laliga_data.js and seriea_data.js carried "on 2025-26 form" in their header
   from a literal in the desk config, and form-season.mjs flips a division's
   form to the season being played at round six. La Liga crossed that on
   12 September 2026 and the file went on describing itself as 2025-26 while
   every rate in it came from 2026-27 — a shipped artefact misdescribing its
   own contents, which is the kind of wrong that survives because it is in a
   comment nobody diffs. Both desks now generate the line from the stamps on
   the files they read, and ship the same fact as FORM for anything that wants
   to render it. This checks the two agree, on both desks — a header taken
   from one basis while FORM says another is the same failure in a new place. */
for (const [file, desk] of [['laliga_data.js', 'La Liga'], ['seriea_data.js', 'Serie A']]) {
  const path = join(root, 'data', file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  const head = /^\/\/ .+\n(\/\/ .+)/.exec(text);
  assert.ok(head, `${file} has no headline under the generated-by line`);
  const form = /^const FORM = (\{.*\});$/m.exec(text);
  assert.ok(form, `${file} no longer ships FORM, so nothing can render the ` +
    'desk\'s basis and the header is the only claim about it');
  const seasons = JSON.parse(form[1]);
  const bases = Object.entries(seasons).filter(([b]) => b !== 'NEW');
  assert.ok(bases.length >= 2, `${file}: FORM names ${bases.length} bases`);
  /* THE CLAUSE AFTER ", on ", never the whole line. The desk's name carries
     the season being PLAYED — "Serie A 2026-27, on 2025-26 form" is two
     different seasons and only the second says anything about the basis.
     Read whole, the line contains "2026-27" no matter what the form is, so a
     header left behind by the flip matched itself and this guard passed on
     precisely the file it was written to catch. */
  const claim = head[1].slice(head[1].indexOf(', on '));
  for (const [basis, season] of bases) {
    if (season == null) continue;   // not stamped — the header says so instead
    assert.ok(claim.includes(season),
      `${desk}: the file says "${head[1].trim()}" but its ${basis} rows are ` +
      `${season} form. A dataset that misdescribes its own basis is read as ` +
      'fact by the next person to open it.');
  }
  /* And no season the data does NOT rest on. Catching a stale header needs
     both directions: the flip leaves the old season behind, not absent. */
  for (const stale of claim.match(/\d{4}-\d{2}/g) || []) {
    assert.ok(bases.some(([, s]) => s === stale),
      `${desk}: the header claims ${stale} form, which no basis in FORM is in ` +
      `(${bases.map(([b, s]) => `${b}=${s}`).join(', ')})`);
  }
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

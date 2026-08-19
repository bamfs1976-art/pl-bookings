#!/usr/bin/env node
/* The guards are only worth what runs them.
 *
 * THE FAILURE THIS EXISTS FOR is not a broken check — it is a correct check
 * that nothing invokes. Two of those happened at once:
 *
 *   1. THREE WORKFLOWS COMMIT TO MAIN and each ran a hand-picked subset of the
 *      guards before pushing: six, four, one. check-match-record.mjs was in
 *      none of them, went red when the Championship rolled to matchday 2, and
 *      stayed red on main for three days.
 *   2. A PUSH MADE WITH THE DEFAULT GITHUB_TOKEN DOES NOT TRIGGER WORKFLOWS —
 *      GitHub's guard against recursive runs. So none of those bot commits ran
 *      CI either. Five landed between 17 and 19 August; the last CI run on main
 *      predated all of them. Nothing anywhere said main was broken.
 *
 * Both holes are now closed — check-all.mjs before each commit, workflow_run on
 * CI afterwards — and this checks the wiring, because wiring is exactly the
 * kind of thing that is edited by someone solving a different problem.
 *
 *     node scripts/check-ci-wiring.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wfDir = join(root, '.github', 'workflows');
const read = (f) => readFileSync(join(wfDir, f), 'utf8');
const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));

/* The workflow's `name:`, which is what workflow_run matches on — NOT the
   filename, which is what a reader reaches for. Getting this wrong makes the
   trigger silently never fire, which is indistinguishable from working until
   something breaks and nothing reports it. It was wrong in the first draft of
   this very change: "Refresh data + model" is data-refresh.yml's COMMIT
   MESSAGE, not its name. */
const nameOf = (src) => (/^name:\s*(.+?)\s*$/m.exec(src) || [])[1];
const byName = new Map(files.map((f) => [nameOf(read(f)), f]));

/* ---- 1. every workflow that pushes runs every guard first --------------- */
const pushers = files.filter((f) => /git push/.test(read(f)) && f !== 'ci.yml');
assert.ok(pushers.length >= 3,
  `only ${pushers.length} workflow(s) appear to push — if one stopped, this ` +
  'check has lost track of what it is protecting');

for (const f of pushers) {
  const src = read(f);
  assert.ok(/node scripts\/check-all\.mjs/.test(src),
    `${f} pushes to main but does not run scripts/check-all.mjs first — it is ` +
    'back to a hand-picked subset, which is how check-match-record.mjs went ' +
    'unrun by all three of them');
  /* BEFORE the push, not after. A guard that runs afterwards reports a commit
     that has already deployed. */
  assert.ok(src.indexOf('check-all.mjs') < src.indexOf('git push'),
    `${f} runs the guards AFTER pushing, so a bad commit is already live`);
}

/* ---- 2. check-all really is every guard -------------------------------- */
/* A glob is the point: it cannot fall behind. This pins that it stays a glob
   rather than quietly becoming a list. */
const all = readFileSync(join(root, 'scripts', 'check-all.mjs'), 'utf8');
assert.ok(/readdirSync\(here\)/.test(all) && /check-.+\\\.mjs/.test(all),
  'check-all.mjs no longer discovers guards by globbing scripts/ — a written ' +
  'list is the thing it was built to replace');
assert.ok(/check-all\.mjs'/.test(all),
  'check-all.mjs no longer excludes itself, which would recurse');

/* ---- 2b. and CI itself runs all of them -------------------------------- */
/* ci.yml names every guard in its own step, each with a comment saying what
   the guard is for. That is worth keeping — the comments are the only place
   the failures are described — but a written list is a written list, and this
   is the check that keeps it from falling behind the directory. The tests are
   in the same position: nothing but ci.yml runs tests/, so a test file nobody
   invokes is a test file that does not exist. */
const ciSrc = read('ci.yml');
const missing = [
  ...readdirSync(join(root, 'scripts'))
    .filter((f) => /^check-.+\.mjs$/.test(f) && f !== 'check-all.mjs'),
  ...readdirSync(join(root, 'tests')).filter((f) => /^test-.+\.mjs$/.test(f)),
].filter((f) => !ciSrc.includes(f));
assert.equal(missing.length, 0,
  `ci.yml does not run ${missing.join(', ')} — it lists its steps by hand, so ` +
  'a new guard or test is only run by whoever remembers to add it here');

/* ---- 3. CI is triggered by the workflows that commit -------------------- */
const ci = read('ci.yml');
assert.ok(/workflow_run:/.test(ci),
  'ci.yml has no workflow_run trigger, so commits made by the refresh ' +
  'workflows run no CI at all — a push with the default GITHUB_TOKEN does ' +
  'not trigger workflows');
const watched = (/workflows:\s*\[([^\]]+)\]/.exec(ci) || [])[1] || '';
const names = [...watched.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
assert.ok(names.length >= 3, `ci.yml watches only ${names.length} workflow(s)`);

for (const n of names) {
  assert.ok(byName.has(n),
    `ci.yml's workflow_run watches "${n}", which is not the name: of any ` +
    `workflow. It never fires. Names present: ${[...byName.keys()].join(', ')}`);
}
/* And every pusher is watched — one that is not gets no CI at all. */
for (const f of pushers) {
  const n = nameOf(read(f));
  assert.ok(names.includes(n),
    `${f} ("${n}") commits to main but ci.yml's workflow_run does not watch ` +
    'it, so its commits run no CI');
}

console.log(`check-ci-wiring OK: ${pushers.length} committing workflows all run ` +
  `check-all.mjs before pushing, CI watches all ${names.length} of them ` +
  `(${pushers.map((f) => basename(f)).join(', ')}), and ci.yml itself runs ` +
  'every guard in scripts/ and every test in tests/');

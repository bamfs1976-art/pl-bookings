#!/usr/bin/env node
/* Run every guard in scripts/, and fail if any of them does.
 *
 * WHY THIS EXISTS. Three workflows commit to main — data-refresh, fixtures and
 * lineups — and each ran a HAND-PICKED subset of the guards before pushing:
 * six, four and one respectively. Every one of those lists was written by
 * someone thinking about the files their own workflow touches, which is the
 * wrong question: the guards re-derive PRICES from the data, so a refresh can
 * break a check that has nothing to do with the file it edited.
 *
 * That is not hypothetical. check-match-record.mjs was in none of the three
 * lists. It went red when the Championship rolled to matchday 2 and stayed red
 * on main for three days, through five bot commits, because no workflow ran it
 * and — see below — the bot commits did not run CI either.
 *
 * THE LIST IS A GLOB, deliberately. A guard written next month is included by
 * existing rather than by somebody remembering to add it to three YAML files.
 *
 * Guards are run in SERIES, not in parallel: several load the same multi-
 * megabyte datasets, and the point of this script is a clear first failure
 * rather than the fastest possible wall-clock.
 *
 *     node scripts/check-all.mjs            # every guard
 *     node scripts/check-all.mjs --list     # name them without running
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* Every guard, in a stable order so two runs are comparable. `check-all`
   itself is excluded for the obvious reason. */
const guards = readdirSync(here)
  .filter((f) => /^check-.+\.mjs$/.test(f) && f !== 'check-all.mjs')
  .sort();

if (process.argv.includes('--list')) {
  guards.forEach((g) => console.log(g));
  process.exit(0);
}

if (!guards.length) {
  console.error('check-all: no guards found in scripts/ — that is not a pass');
  process.exit(1);
}

const started = Date.now();
const failed = [];
for (const g of guards) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(here, g)], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  if (!ok) {
    failed.push(g);
    console.log(`\n=== FAIL ${g} (${ms}ms) ===`);
    /* The whole of both streams. A guard's message is the entire value of it
       failing, and a truncated one sends the reader to re-run it by hand. */
    if (r.stdout) console.log(r.stdout.trimEnd());
    if (r.stderr) console.error(r.stderr.trimEnd());
  } else {
    /* The last line of a passing guard is its own summary, and those summaries
       carry counts worth seeing — "20 clubs, 783 players" is how a silently
       emptied dataset gets noticed. */
    const last = String(r.stdout || '').trimEnd().split('\n').pop() || '(no output)';
    console.log(`ok   ${g.padEnd(28)} ${last}`);
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length) {
  console.error(`\ncheck-all: ${failed.length} of ${guards.length} guards FAILED in ${secs}s — `
    + failed.join(', '));
  process.exit(1);
}
console.log(`\ncheck-all: all ${guards.length} guards passed in ${secs}s`);

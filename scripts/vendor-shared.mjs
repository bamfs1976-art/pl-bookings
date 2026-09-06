#!/usr/bin/env node
/* Pin the shared modules' bytes, the way the vendored libraries are pinned.
 *
 *   node scripts/vendor-shared.mjs           # re-record the hashes
 *   node scripts/vendor-shared.mjs --check   # verify what is committed (offline)
 *
 * WHY THESE THREE AND NOT THE REST OF assets/. shared/ holds the modules that
 * are not this product's opinions — they are its plumbing, loaded verbatim by
 * four pages and by a sibling app that shares this account. share.js draws
 * every card that leaves the site; save.js is the only thing that hands a file
 * to a phone; suspension.js decides whether a player is one booking from a
 * ban. Nothing in any of them is league-specific, and all three are things
 * another app would want whole rather than adapted.
 *
 * WHY PIN THE BYTES AT ALL, when they are not fetched from anywhere. Two
 * reasons, and neither is supply chain.
 *
 * The first is COPIES. A module that four pages load is a module somebody will
 * one day duplicate rather than import — that is exactly how La Liga shipped
 * wearing the Championship's purple, and how index.html and eflc.html each
 * ended up with their own acca arithmetic. A recorded hash gives the guard
 * something to compare a suspected copy against, and check-shared fails the
 * build on one.
 *
 * The second is the VERSION. shared/package.json carries one, and a version
 * only means anything if it moves when the contents move. The hashes are what
 * make that checkable: change a byte without touching the version and this
 * says so.
 *
 * WHAT IT IS NOT. It is not a build step and it produces no artefact. The
 * files in shared/ are the files the browser loads, unminified and readable,
 * exactly as they were in assets/. Moving them changed their path and nothing
 * else, which is the property check-shared asserts hardest.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'shared');
const manifest = join(root, 'scripts', 'vendor-shared.sha256.json');
const check = process.argv.includes('--check');

/* Read from package.json rather than repeated here. A second list is a second
   thing to forget, and the one in package.json is the one npm would use. */
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const FILES = pkg.files.slice().sort();

if (!FILES.length) {
  console.error('vendor-shared: shared/package.json lists no files — that is not a pass');
  process.exit(1);
}

const sha = (f) => createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
const now = { version: pkg.version };
for (const f of FILES) now[f] = sha(f);

if (!check) {
  writeFileSync(manifest, JSON.stringify(now, null, 2) + '\n');
  console.log(`vendor-shared: recorded ${FILES.length} file(s) at v${pkg.version}`);
  for (const f of FILES) console.log(`  ${f.padEnd(16)} ${now[f]}`);
  process.exit(0);
}

let was;
try {
  was = JSON.parse(readFileSync(manifest, 'utf8'));
} catch (e) {
  console.error(`vendor-shared --check: ${manifest} is missing or unreadable. `
    + 'Run `node scripts/vendor-shared.mjs` to record it.');
  process.exit(1);
}

const problems = [];
if (was.version !== pkg.version) {
  problems.push(`the manifest records v${was.version} and package.json says v${pkg.version}`);
}
for (const f of FILES) {
  if (!was[f]) problems.push(`${f} is not in the manifest`);
  else if (was[f] !== now[f]) {
    problems.push(`${f} has changed:\n      recorded ${was[f]}\n      actual   ${now[f]}`);
  }
}
for (const k of Object.keys(was)) {
  if (k !== 'version' && !FILES.includes(k)) {
    problems.push(`${k} is in the manifest but not in shared/package.json's files`);
  }
}

if (problems.length) {
  console.error('vendor-shared --check FAILED:');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nIf the change is intended: bump the version in shared/package.json,');
  console.error('then run `node scripts/vendor-shared.mjs` to re-record.');
  process.exit(1);
}

console.log(`vendor-shared --check OK: ${FILES.length} file(s) match the manifest at `
  + `v${pkg.version}`);

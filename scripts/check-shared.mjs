#!/usr/bin/env node
/* shared/ is the plumbing, and there must be exactly one of each piece.
 *
 * Three modules moved out of assets/ because they are not this product's
 * opinions. share.js draws every card that leaves the site; save.js is the
 * only thing that hands a file to a phone; suspension.js decides whether a
 * player is one booking from a ban. None of them is league-specific, all three
 * are loaded verbatim by four pages, and a sibling app that shares this
 * account would want them whole rather than adapted.
 *
 * THE FAILURE THIS EXISTS FOR IS THE COPY, and this repository has had it
 * twice. La Liga was built by copying the Championship's page, the copy
 * included its <style>, and La Liga shipped wearing the Championship's purple
 * — three places named the league's colour and only two agreed. The acca
 * arithmetic was written three times: once in share.js and twice inline. Both
 * were invisible: every page passed its own checks, because no check had ever
 * asked whether two files said the same thing.
 *
 * So a second copy of any of these three fails the build, wherever it is and
 * whatever it is called. Matched on CONTENT, not on filename — a copy named
 * `share-v2.js` or pasted into a page's <script> block is the copy that
 * actually happens, and a filename check would miss both.
 *
 * IT ALSO PINS THE BYTES. shared/package.json carries a version, and a version
 * only means anything if it moves when the contents move. scripts/
 * vendor-shared.mjs records the hashes; this runs its --check.
 *
 *     node scripts/check-shared.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const pkg = JSON.parse(read('shared/package.json'));
const FILES = pkg.files.slice();

/* ---- 1. the module exists, is declared, and is loaded ------------------ */
ok(FILES.length === 3, `shared/package.json lists ${FILES.length} files; expected 3`);
ok(/^\d+\.\d+\.\d+$/.test(pkg.version),
  `shared/package.json has no semantic version ("${pkg.version}") — the hash manifest ` +
  'records one and check-shared compares them');

const DESKS = ['index.html', 'eflc.html', 'laliga.html', 'today.html'];
/* Not every desk loads every module — today.html has no suspension strip —
   but every module must be loaded by SOMEBODY from shared/, or it has been
   orphaned by the move rather than relocated by it. */
for (const f of FILES) {
  const loaders = DESKS.filter((d) => read(d).includes('shared/' + f));
  ok(loaders.length > 0,
    `nothing loads shared/${f}. The move renamed a path that no page follows, ` +
    'which is a module deleted with extra steps.');
}
for (const d of DESKS) {
  ok(!/assets\/(share|save|suspension)\.js/.test(read(d)),
    `${d} still loads one of the shared modules from assets/ — that path no longer ` +
    'exists, so the script 404s and the page loses the feature silently');
}

/* ---- 2. the bytes are pinned, and the version tracks them --------------- */
{
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'vendor-shared.mjs'), '--check'],
    { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0,
    'scripts/vendor-shared.mjs --check failed:\n' + (r.stdout || '') + (r.stderr || ''));
  checks++;
}

/* ---- 3. THE ONE WITH TEETH: no second copy, anywhere -------------------
 *
 * Matched on content rather than on name. A copy called share-v2.js, or one
 * pasted into a page's inline <script>, is the copy that actually happens —
 * and a filename check would miss both of those while feeling thorough.
 *
 * The test is a distinctive run of each module's own source: long enough that
 * it cannot collide by accident, and taken from the middle so a copy that
 * dropped the licence header still trips it.
 */
{
  const SKIP = new Set(['.git', 'node_modules', 'shared', 'icons', '.github']);
  const walk = (d, out = []) => {
    for (const e of readdirSync(d)) {
      if (SKIP.has(e)) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(js|mjs|html|cjs)$/.test(e)) out.push(p);
    }
    return out;
  };
  const files = walk(root);
  ok(files.length > 20, `only ${files.length} files scanned — the walk is not reaching the repo`);

  for (const f of FILES) {
    const src = read('shared/' + f);
    /* A fingerprint from the middle of the file, normalised for whitespace so
       a reformatted copy is still a copy. 400 characters is far past anything
       two independent authors would write identically. */
    const body = src.replace(/\s+/g, ' ');
    const probe = body.slice(Math.floor(body.length / 2), Math.floor(body.length / 2) + 400);
    ok(probe.length === 400, `shared/${f} is too short to fingerprint`);

    const hits = files.filter((p) => {
      /* The guards read these files on purpose; a script that loads the module
         is not a copy of it. Only the CONTENT counts, and a guard holds a
         path. */
      const txt = readFileSync(p, 'utf8').replace(/\s+/g, ' ');
      return txt.includes(probe);
    }).map((p) => relative(root, p));

    assert.deepStrictEqual(hits, [],
      `shared/${f} has been copied into ${hits.join(', ')}. There is one of each of ` +
      'these modules. A second copy is how La Liga shipped in the Championship\'s ' +
      'purple and how the acca arithmetic came to exist three times — both invisible, ' +
      'because every page passed its own checks and nothing asked whether two files ' +
      'said the same thing. Load it from shared/ instead.');
    checks++;
  }
}

/* ---- 4. and assets/ has not kept a stale twin --------------------------- */
for (const f of FILES) {
  let stale = false;
  try { statSync(join(root, 'assets', f)); stale = true; } catch (e) { /* good */ }
  ok(!stale,
    `assets/${f} exists again alongside shared/${f}. Two files, one name, and the ` +
    'pages load whichever path they happen to name — which is the drift this move ' +
    'was made to end.');
}

/* ---- 5. the cache and the offline shell followed the move --------------- */
{
  const sw = read('sw.js');
  for (const f of FILES) {
    ok(sw.includes('/shared/' + f),
      `sw.js does not precache /shared/${f}, so the installed app loses it offline`);
    ok(!sw.includes('/assets/' + f),
      `sw.js still precaches /assets/${f}, a path that 404s — one bad entry rejects ` +
      'the whole addAll() and the app installs with no offline shell at all');
  }
  ok(/\/shared\/\*/.test(read('_headers')),
    '_headers has no /shared/* cache rule, so the three modules fall back to the ' +
    'default while every other asset is explicitly cached');
}

console.log(`check-shared OK: ${FILES.length} modules at v${pkg.version}, bytes pinned, `
  + `loaded from shared/ on every desk, precached, and no copy anywhere in the repo `
  + `(${checks} checks)`);

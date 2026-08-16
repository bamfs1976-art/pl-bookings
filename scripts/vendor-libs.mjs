#!/usr/bin/env node
/* Vendor the four MIT libraries into index.html — and prove the bytes.
 *
 *   node scripts/vendor-libs.mjs            # fetch from npm and re-embed
 *   node scripts/vendor-libs.mjs --check    # verify what is committed (offline)
 *
 * WHY VENDOR AT ALL. A CDN <script> is a third party on the critical path of
 * a page that has to work on a phone at a ground with no signal, and it is an
 * external request the Content-Security-Policy then has to allow. Inlining the
 * minified source removes both: nothing on this page fetches anything to
 * render, and the CSP does not have to name a host it cannot vouch for.
 *
 * WHY IT IS A SCRIPT AND NOT A PASTE. Half a megabyte of minified JavaScript
 * pasted into an HTML file is, from that moment on, unreviewable — nobody can
 * tell a genuine Tabulator from one with a line changed in the middle. So the
 * embed is generated, each block is delimited by markers naming its package
 * and version, and every block's SHA-256 is recorded HERE. `--check` runs
 * offline in CI and fails if a single byte of vendored code has moved.
 *
 * That is the property worth having: the licence header says what the code is,
 * and the hash proves the code is what the header says.
 *
 * WHAT IT COSTS. Tabulator is 432 KB minified and it dominates the page
 * weight; the other three come to 114 KB between them. Gzipped on the wire
 * that is roughly 130 KB, paid once per deploy. It is a real cost and it buys
 * a page with no third-party requests at all.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(root, 'index.html');
const check = process.argv.includes('--check');

/* Pinned. A range here would mean the committed bytes and the recorded hash
   could disagree the next time anybody ran this, which is the whole point of
   recording the hash. */
const LIBS = [
  {
    id: 'tabulator-css',
    pkg: 'tabulator-tables', version: '6.3.1',
    file: 'dist/css/tabulator.min.css', kind: 'css',
    licence: 'MIT', author: 'Oliver Folkerd',
    home: 'https://github.com/olifolkerd/tabulator',
    sha256: '',
  },
  {
    id: 'tabulator-js',
    pkg: 'tabulator-tables', version: '6.3.1',
    file: 'dist/js/tabulator.min.js', kind: 'js',
    licence: 'MIT', author: 'Oliver Folkerd',
    home: 'https://github.com/olifolkerd/tabulator',
    sha256: '',
  },
  {
    id: 'jstat',
    pkg: 'jstat', version: '1.9.6',
    file: 'dist/jstat.min.js', kind: 'js',
    licence: 'MIT', author: 'jStat contributors',
    home: 'https://github.com/jstat/jstat',
    sha256: '',
  },
  {
    id: 'simple-statistics',
    pkg: 'simple-statistics', version: '7.8.8',
    file: 'dist/simple-statistics.min.js', kind: 'js',
    licence: 'MIT', author: 'Tom MacWright',
    home: 'https://github.com/simple-statistics/simple-statistics',
    sha256: '',
  },
  {
    id: 'papaparse',
    pkg: 'papaparse', version: '5.4.1',
    file: 'papaparse.min.js', kind: 'js',
    licence: 'MIT', author: 'Matthew Holt',
    home: 'https://github.com/mholt/PapaParse',
    sha256: '',
  },
];

/* Recorded on the last successful fetch. `--check` compares against these. */
const HASHES = JSON.parse(readFileSync(join(root, 'scripts', 'vendor-libs.sha256.json'), 'utf8'));

const START = (id) => `<!-- VENDOR:${id} START -->`;
const END = (id) => `<!-- VENDOR:${id} END -->`;

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

/* A sourceMappingURL points at a .map this page will never ship, so every
   browser that honours it issues a 404 on a page whose entire selling point is
   that it makes no requests. Stripped, and stripped LAST so the hash recorded
   is the hash of what is actually embedded. */
function clean(src) {
  return src
    .replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm, '')
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '')
    .replace(/\s+$/, '') + '\n';
}

function header(lib, hash) {
  return [
    `/*! ${lib.pkg} v${lib.version} — ${lib.file}`,
    ` *  ${lib.licence} licence. (c) ${lib.author}. ${lib.home}`,
    ` *  Vendored verbatim by scripts/vendor-libs.mjs; source-map comment removed.`,
    ` *  sha256 ${hash}`,
    ` *  Full licence text: the Sources & licences view in this app.`,
    ' */',
  ].join('\n');
}

function block(lib, body, hash) {
  const tag = lib.kind === 'css' ? 'style' : 'script';
  return [
    START(lib.id),
    `<${tag}>`,
    header(lib, hash),
    body,
    `</${tag}>`,
    END(lib.id),
  ].join('\n');
}

function slice(html, id) {
  const a = html.indexOf(START(id));
  const b = html.indexOf(END(id));
  if (a === -1 || b === -1) throw new Error(`index.html has no VENDOR:${id} markers`);
  return { a, b: b + END(id).length, body: html.slice(a, b + END(id).length) };
}

/* The embedded payload, without the wrapper — what the hash is taken over. */
function embedded(html, lib) {
  const s = slice(html, lib.id);
  const tag = lib.kind === 'css' ? 'style' : 'script';
  const open = s.body.indexOf(`<${tag}>`);
  const close = s.body.lastIndexOf(`</${tag}>`);
  if (open === -1 || close === -1) throw new Error(`VENDOR:${lib.id} carries no <${tag}> block`);
  const inner = s.body.slice(open + tag.length + 2, close);
  /* Drop the licence header comment we generated; the hash is of the library
     and nothing else, so re-wording the attribution can never look like
     tampered code. The final character is the newline block() puts between the
     payload and the closing tag — not part of what was downloaded. */
  const end = inner.indexOf('\n */\n');
  const out = end === -1 ? inner : inner.slice(end + 5);
  return out.endsWith('\n') ? out.slice(0, -1) : out;
}

function doCheck() {
  const html = readFileSync(PAGE, 'utf8');
  let bad = 0;
  for (const lib of LIBS) {
    const got = sha256(embedded(html, lib));
    const want = HASHES[lib.id];
    if (!want) { console.error(`no recorded hash for ${lib.id}`); bad++; continue; }
    if (got !== want) {
      console.error(`${lib.id} (${lib.pkg}@${lib.version}) embedded bytes do not match the `
        + `recorded sha256.\n  recorded ${want}\n  embedded ${got}\n`
        + '  Vendored library code must be the published release, byte for byte. '
        + 'Re-run: node scripts/vendor-libs.mjs');
      bad++;
      continue;
    }
    /* The header must name the thing the hash covers, or the provenance is
       a comment rather than a claim. */
    const s = slice(html, lib.id).body;
    for (const need of [`${lib.pkg} v${lib.version}`, `${lib.licence} licence`, want]) {
      if (!s.includes(need)) {
        console.error(`${lib.id} licence header does not carry "${need}"`);
        bad++;
      }
    }
  }
  if (bad) process.exit(1);
  const bytes = LIBS.reduce((n, l) => n + embedded(html, l).length, 0);
  console.log(`vendor-libs --check OK: ${LIBS.length} MIT libraries, `
    + `${(bytes / 1024).toFixed(0)} KB, every sha256 matching`);
}

function fetchLib(lib, dir) {
  execFileSync('npm', ['pack', `${lib.pkg}@${lib.version}`, '--silent'], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  const tgz = `${lib.pkg.replace(/^@/, '').replace(/\//g, '-')}-${lib.version}.tgz`;
  execFileSync('tar', ['xzf', tgz, '-C', dir], { cwd: dir });
  return clean(readFileSync(join(dir, 'package', lib.file), 'utf8'));
}

function doVendor() {
  const dir = mkdtempSync(join(tmpdir(), 'plb-vendor-'));
  try {
    let html = readFileSync(PAGE, 'utf8');
    const hashes = {};
    for (const lib of LIBS) {
      const body = fetchLib(lib, dir);
      if (/<\/script/i.test(body) || /<!--/.test(body)) {
        throw new Error(`${lib.id} contains a sequence that would break the HTML it is `
          + 'embedded in. It cannot be inlined as-is.');
      }
      const hash = sha256(body);
      hashes[lib.id] = hash;
      const s = slice(html, lib.id);
      html = html.slice(0, s.a) + block(lib, body, hash) + html.slice(s.b);
      console.log(`  ${lib.id.padEnd(18)} ${(body.length / 1024).toFixed(0).padStart(4)} KB  ${hash.slice(0, 16)}…`);
    }
    writeFileSync(PAGE, html);
    writeFileSync(join(root, 'scripts', 'vendor-libs.sha256.json'),
      JSON.stringify(hashes, null, 2) + '\n');
    console.log('index.html re-vendored; scripts/vendor-libs.sha256.json updated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  if (check) doCheck(); else doVendor();
} catch (e) {
  console.error(String((e && e.message) || e));
  process.exit(1);
}

// Syntax-check every inline <script> body in each single-file app with
// node --check. Guards against a broken deploy: these pages have no build
// step, so a syntax error ships.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'plb-inline-'));
const PAGES = ['index.html', 'eflc.html', 'laliga.html', 'today.html', 'data-frame.html'];
let total = 0;
for (const page of PAGES) {
  const html = readFileSync(join(root, page), 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0;
  while ((m = re.exec(html))) {
    const f = join(dir, `${page.replace(/\W/g, '_')}${i}.js`);
    writeFileSync(f, m[1]);
    execFileSync('node', ['--check', f], { stdio: 'inherit' });
    i++;
  }
  if (i === 0) throw new Error(`no inline scripts found in ${page}`);
  total += i;
  console.log(`  ${page}: ${i} inline script${i === 1 ? '' : 's'} OK`);
}
console.log(`inline script check OK (${total} across ${PAGES.length} pages)`);

// Syntax-check every inline <script> body in index.html with node --check.
// Guards against a broken deploy of the single-file app.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'plb-inline-'));
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0;
while ((m = re.exec(html))) {
  const f = join(dir, `inline${i}.js`);
  writeFileSync(f, m[1]);
  execFileSync('node', ['--check', f], { stdio: 'inherit' });
  i++;
}
if (i === 0) throw new Error('no inline scripts found in index.html');
console.log(`inline script check OK (${i} script${i === 1 ? '' : 's'})`);

#!/usr/bin/env node
/* The security headers must not break the site they protect.
 *
 * Both of these shipped, and both were invisible to every other guard and to
 * every local test, because `python -m http.server` does not send _headers.
 * The site was healthy on localhost and wrong on the only machine that
 * matters — so these assertions read the header files themselves.
 *
 * 1. img-src did not list media.api-sports.io, the host for all 47 Championship
 *    and La Liga crests. The browser refused every one: 448 CSP violations on
 *    a single page load, and a broken-image glyph beside every club. Nothing
 *    was wrong with the host or the URLs; the site was blocking itself.
 *
 * 2. X-Frame-Options was DENY, which refuses ALL framing including first-party.
 *    /today is built from three same-origin iframes — each dataset declares
 *    `const CLUBS`, so three in one document is a redeclaration error and a
 *    frame is the separate scope that avoids it. WebKit enforces DENY on
 *    same-origin subframes; Chromium does not, so this reproduced ONLY on
 *    Safari, and reproduced there even with the real headers replayed locally
 *    in Chromium. The combined view was empty on every iPhone and iPad.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';
import { readdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const headers = read('_headers');
const toml = read('netlify.toml');

/* ---- 1. every image host the data references must be allowed ------------ */
const csp = (headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1] || '';
const imgSrc = (csp.match(/img-src([^;]*)/) || [])[1] || '';

const hosts = new Set();
for (const f of readdirSync(join(root, 'data'))) {
  if (!f.endsWith('.js')) continue;
  for (const m of read(join('data', f)).matchAll(/https:\/\/([a-z0-9.-]+)\/[^"']*\.(?:png|jpg|jpeg|svg|webp)/gi)) {
    hosts.add(m[1]);
  }
}
assert.ok(hosts.size > 0, 'no image hosts found in data/ — this guard has stopped guarding');
for (const h of hosts) {
  assert.ok(imgSrc.includes(h),
    `CSP img-src does not allow "${h}", which the shipped datasets reference. ` +
    'Every crest from that host is refused by the browser and renders as a ' +
    `broken image. img-src is currently:${imgSrc}`);
}

/* ---- 2. framing: SAMEORIGIN, never DENY -------------------------------- */
for (const [file, src, pat] of [
  ['_headers', headers, /X-Frame-Options:\s*(\S+)/],
  ['netlify.toml', toml, /X-Frame-Options\s*=\s*"([^"]+)"/]
]) {
  const v = (src.match(pat) || [])[1];
  assert.ok(v, `${file} does not set X-Frame-Options at all`);
  assert.notStrictEqual(v.toUpperCase(), 'DENY',
    `${file} sets X-Frame-Options: DENY. That refuses first-party framing too, ` +
    'and /today reads three same-origin iframes — WebKit blocks them, the ' +
    'reads throw SecurityError, and the combined view renders empty on every ' +
    'iPhone and iPad while Chromium shows nothing wrong. Use SAMEORIGIN.');
  assert.strictEqual(v.toUpperCase(), 'SAMEORIGIN',
    `${file} sets X-Frame-Options: ${v}; it must be SAMEORIGIN`);
}

/* Both files are applied by Netlify. Disagreeing on one header is worse than
   either value alone, so they are checked against each other, not just
   individually — fixing one and forgetting the other is the likely mistake. */
const a = (headers.match(/X-Frame-Options:\s*(\S+)/) || [])[1];
const b = (toml.match(/X-Frame-Options\s*=\s*"([^"]+)"/) || [])[1];
assert.strictEqual(a.toUpperCase(), b.toUpperCase(),
  `_headers says X-Frame-Options: ${a} but netlify.toml says ${b}. Both are ` +
  'applied; they must agree.');

/* frame-ancestors is the modern equivalent and wins where both are read. It
   must not contradict the header above by forbidding first-party framing. */
const fa = (csp.match(/frame-ancestors([^;]*)/) || [])[1];
assert.ok(fa && /'self'/.test(fa),
  "CSP frame-ancestors must include 'self' — without it, browsers that " +
  'prefer CSP over X-Frame-Options block /today\'s own data frames again.');
assert.ok(!/'none'/.test(fa || ''),
  "CSP frame-ancestors 'none' forbids first-party framing and re-breaks /today");

console.log(`check-headers OK: ${hosts.size} image host(s) allowed by CSP ` +
  `(${[...hosts].join(', ')}); framing SAMEORIGIN and consistent across both files`);

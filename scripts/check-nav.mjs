// Guard that every desk can be reached from every desk.
//
// This exists because two of the four were, in practice, unreachable. The
// Championship and La Liga desks were built, tested, guarded, deployed and
// live — and the home page's only link to anything else was the phrase
// "Today's Card" inside a paragraph of prose on the Guide tab. Someone opening
// the site saw the Premier League and had no way to discover that two other
// divisions existed, short of typing a URL.
//
// Nothing caught it. Every page passed its own guards, every URL resolved, the
// sitemap was complete, and the deploy was green. "Is it linked from anywhere"
// was simply not a question anything asked, so it is asked here.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

/* file -> the public URL it is served at, and the label that must be current
   on it. The redirects are what make the pretty URLs work, so they are checked
   too: a bar full of links to /eflc is worth nothing if /eflc 404s. */
const DESKS = [
  { file: 'index.html', url: '/', label: 'Premier League' },
  { file: 'eflc.html', url: '/eflc', label: 'Championship' },
  { file: 'laliga.html', url: '/laliga', label: 'La Liga' },
  { file: 'today.html', url: '/today', label: 'Today' }
];

/* ---- 1. every desk links to every desk ---------------------------------- */
for (const from of DESKS) {
  const src = read(from.file);
  const bar = /<nav class="leaguebar"[\s\S]*?<\/nav>/.exec(src);
  assert.ok(bar, `${from.file} has no league switcher — the other desks are ` +
    'unreachable from it');
  for (const to of DESKS) {
    assert.ok(new RegExp(`href="${to.url === '/' ? '/' : to.url}"`).test(bar[0]),
      `${from.file} does not link to ${to.url} (${to.label})`);
  }
  /* Exactly one current item, and it must be this page. Marking none loses the
     "you are here"; marking two is worse, because both look authoritative. */
  const current = [...bar[0].matchAll(/aria-current="page"[\s\S]{0,220}?<\/a>/g)];
  assert.equal(current.length, 1,
    `${from.file}'s switcher marks ${current.length} items as current, expected 1`);
  assert.ok(current[0][0].includes(from.label),
    `${from.file} marks the wrong desk as current — expected ${from.label}`);
}

/* ---- 2. the pretty URLs actually resolve --------------------------------- */
/* A link to /eflc is only a link if Netlify rewrites it. The catch-all at the
   bottom of _redirects serves index.html for everything, so a desk whose rule
   is missing does not 404 — it silently serves the PREMIER LEAGUE PAGE at the
   Championship's URL, which looks like the switcher is broken rather than the
   routing. */
const rd = read('_redirects');
const lines = rd.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const catchAll = lines.findIndex((l) => l.startsWith('/*'));
assert.ok(catchAll > -1, '_redirects has no catch-all');
for (const d of DESKS) {
  if (d.url === '/') continue;
  const i = lines.findIndex((l) => l.split(/\s+/)[0] === d.url);
  assert.ok(i > -1, `_redirects has no rule for ${d.url} — the catch-all would ` +
    `serve the Premier League page at the ${d.label} URL`);
  assert.ok(i < catchAll,
    `${d.url} is routed AFTER the catch-all in _redirects, so it never matches`);
  assert.ok(lines[i].includes(d.file),
    `${d.url} does not route to ${d.file}`);
}

/* ---- 3. the switcher's styles ship --------------------------------------- */
/* It lives in the shared stylesheet so four pages cannot disagree about it —
   which is how one of them would quietly lose an entry again. */
const css = read('assets/tw.css');
assert.ok(/\.leaguebar\{/.test(css), 'the league switcher has no styles in tw.css');
assert.ok(/position:sticky/.test(/\.leaguebar\{[^}]*\}/.exec(css)[0]),
  'the switcher is not sticky — index.html restores its scroll position on ' +
  'load, so a bar in normal flow is already off screen when the page appears');
for (const d of DESKS) {
  assert.ok(read(d.file).includes('assets/tw.css'),
    `${d.file} does not load tw.css, so its switcher would be unstyled`);
}
/* All four labels must FIT on a phone. At full length the row needs 625px and
   the widest iPhone is 430, so two entries sat off the right edge on every
   handset — the two desks the bar exists to expose. */
assert.ok(/\.lb-abbr/.test(css) && /@media \(max-width:560px\)/.test(css),
  'the switcher has no short labels for narrow screens, so its last entries ' +
  'sit off the edge of every iPhone behind a swipe nobody discovers');
for (const d of DESKS) {
  assert.ok(/<span class="lb-abbr">/.test(read(d.file)),
    `${d.file}'s switcher has no abbreviated labels`);
}

console.log(
  `check-nav OK: ${DESKS.length} desks, each linking to all ${DESKS.length} and ` +
  'marking itself current, all routed before the catch-all'
);

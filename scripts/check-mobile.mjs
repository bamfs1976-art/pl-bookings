// Guard the phone.
//
// Everything here failed SILENTLY on an iPhone. That is the common thread and
// the reason these are assertions rather than a checklist someone re-reads:
// none of them threw, logged, or looked wrong in a desktop browser, and the
// desks were shipped and deployed for weeks with the site's headline feature
// dead on the one device most people would open it on.
//
//   The share buttons. iOS Safari ignores `download` on a blob: URL, so every
//   card button on every desk was inert — the card rendered, the tap did
//   nothing, no error anywhere.
//
//   The layout viewport. A control wider than the screen does not overflow on
//   Safari; it makes Safari widen the layout viewport and shrink the entire
//   page to fit. A 428px date picker silently zoomed /today out.
//
//   The offline shell. addAll is atomic, so one renamed file took the whole
//   PWA offline rather than costing it one page.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'today.html', 'eflc.html', 'laliga.html'];
const read = (f) => readFileSync(join(root, f), 'utf8');

/* Comments stripped before scanning for code patterns — this file has been
   fooled by its own explanatory prose before. */
function codeOnly(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* ---- 1. nothing saves a file through a bare anchor ----------------------- */
assert.ok(existsSync(join(root, 'assets', 'save.js')),
  'assets/save.js is missing — nothing routes a phone to the share sheet');
/* codeOnly, NOT the raw source. save.js explains AbortError at length in a
   comment, so the assertion below passed with the actual check renamed away —
   the guard was reading the prose about the behaviour instead of the
   behaviour. Third time this file's own comments have satisfied one of its
   assertions. */
const save = codeOnly(read('assets/save.js'));
assert.ok(/navigator\.canShare/.test(save) && /navigator\.share\(/.test(save),
  'save.js does not use the Web Share API, which is the only way an iPhone ' +
  'can save a generated file');
assert.ok(/AbortError/.test(save),
  'save.js does not special-case AbortError — dismissing the share sheet ' +
  'would fall through and download the file the user just declined');

for (const p of PAGES) {
  const code = codeOnly(read(p));
  /* The exact idiom that is dead on iOS. It is allowed in save.js, which owns
     the fallback, and nowhere else. */
  const anchors = code.match(/\.download\s*=/g) || [];
  assert.equal(anchors.length, 0,
    `${p} sets a.download directly (${anchors.length} site(s)) instead of going ` +
    'through PLDSave — that button does nothing on an iPhone, with no error');
  assert.ok(/assets\/save\.js/.test(read(p)),
    `${p} does not load assets/save.js`);
}
/* share.js keeps an inline anchor as its fallback, because the guard's VM
   loads it with no DOM modules — but it must PREFER PLDSave. */
const shareSrc = codeOnly(read('assets/share.js'));
assert.ok(/PLDSave/.test(shareSrc),
  'share.js does not delegate to PLDSave, so every desk card is inert on iOS');

/* ---- 2. installable, on every desk -------------------------------------- */
for (const p of PAGES) {
  const src = read(p);
  for (const [needle, why] of [
    ['rel="manifest"', 'cannot be installed to a home screen'],
    ['apple-touch-icon', 'installs with a screenshot thumbnail instead of an icon'],
    ['name="theme-color"', 'gets a default browser chrome colour'],
    ['viewport-fit=cover', 'is letterboxed instead of using the full screen'],
    ['serviceWorker', 'launches into a Safari tab rather than the installed app']
  ]) {
    assert.ok(src.includes(needle), `${p} has no ${needle} — it ${why}`);
  }
  /* viewport-fit=cover puts content under the notch and the home indicator.
     Opting in without padding back out is worse than not opting in. */
  /* BOTH ends, checked separately. `safe-area-inset` alone was satisfied by
     the left/right insets while the top padding was deleted — and top and
     bottom are the two that matter, because those are the notch and the home
     indicator. Left and right are only non-zero in landscape. */
  /* The bottom inset moved into the SHARED footer rule, so reading the page
     alone reported it missing on today.html — a guard aimed at a file the rule
     has left. Widened to the CSS the page loads, but NAMED: `src + tw.css`
     would be satisfied by the bottom-nav's own inset, so deleting the footer
     padding on every desk at once still passed. A rule is not a substitute for
     a different rule just because both mention the same property. */
  assert.ok(/env\(safe-area-inset-top/.test(src),
    `${p} opts into the full screen with viewport-fit=cover but never pads ` +
    'the top — content sits under the status bar and notch');
  const footer = read('assets/tw.css').match(/(^|\})\s*footer\s*\{([^}]*)\}/);
  assert.ok(footer && /env\(safe-area-inset-bottom/.test(footer[2]),
    'the shared footer rule in assets/tw.css no longer pads the bottom inset, ' +
    'so on every desk the last line of the page sits under the home indicator');
}

/* ---- 3. touch targets ---------------------------------------------------- */
for (const p of PAGES) {
  const src = read(p);
  assert.ok(/@media \(pointer: coarse\)/.test(src),
    `${p} has no coarse-pointer block — its controls stay at mouse size on a phone`);
  /* 16px on form controls is what stops iOS zooming the page on focus; a
     select then sizes to its longest option, which is what widened the layout
     viewport, so the cap has to travel with the font size. */
  const coarse = (/@media \(pointer: coarse\)\{([\s\S]*?)\n  \}/.exec(src) || [])[1] || '';
  assert.ok(/font-size:\s*16px/.test(coarse),
    `${p} does not raise form controls to 16px, so iOS zooms the page when ` +
    'one takes focus');
  assert.ok(/select\{[^}]*max-width:\s*100%/.test(coarse),
    `${p} raises the control font without capping select width — a select ` +
    'sizes to its longest option and Safari shrinks the whole page to fit it');
}

/* ---- 4. the offline shell ------------------------------------------------ */
const sw = read('sw.js');
const shell = (/const SHELL = \[([\s\S]*?)\];/.exec(sw) || [])[1] || '';
const paths = [...shell.matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.ok(paths.length > 10, 'the service worker shell looks truncated');
/* PRETTY ROUTES ARE NOT FILES. The shell precaches `/pl` and `/today` as well
   as the .html behind them, because caches.match() matches on URL and a
   rewrite never fetched at install time is a miss offline. So a path counts as
   real if it is a file OR a rewrite in _redirects — and resolving it through
   _redirects rather than allow-listing it means a precached route whose rule
   is deleted still fails here. */
const rules = read('_redirects').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split(/\s+/));
const rewritten = (p) => {
  const hit = rules.find((r) => r[0] === p && /^2\d\d$/.test(r[2] || '200'));
  return hit ? existsSync(join(root, hit[1])) : false;
};
const missing = paths.filter((p) => p !== '/'
  && !existsSync(join(root, p)) && !rewritten(p));
assert.equal(missing.length, 0,
  `the service worker precaches paths that are neither files nor rewrites: ${missing.join(', ')}`);
for (const p of PAGES) {
  assert.ok(paths.includes('/' + p),
    `${p} is not in the offline shell — installed on a phone it is a blank ` +
    'screen with no connection');
}
/* EVERY ASSET A PAGE LOADS IS IN THE SHELL. The existing check runs the other
   way — that nothing precached is missing from disk — and that direction
   cannot see a NEW module which no one added. assets/metric.js shipped
   unlisted, and because marketStripHtml() calls PLDMetric.label() directly, an
   installed app offline would not have degraded: it would have thrown a
   ReferenceError and taken the whole fixture card render with it. */
for (const p of PAGES) {
  const loaded = [...read(p).matchAll(/<script src="(assets\/[^"]+)"/g)].map((m) => '/' + m[1]);
  const unshelled = loaded.filter((a) => !paths.includes(a));
  assert.deepStrictEqual(unshelled, [],
    `${p} loads ${unshelled.join(', ')} but the service worker does not ` +
    'precache it. Installed and offline, the script 404s — and a module the ' +
    'page calls directly takes the render down with it rather than degrading.');
}

/* addAll is atomic: one 404 rejects the install and the app has NO offline
   shell rather than one page fewer. With four desks in the list that stopped
   being an acceptable failure mode. */
assert.ok(!/\.addAll\(/.test(sw),
  'the service worker installs its shell with addAll — a single missing file ' +
  'then takes the entire PWA offline instead of costing it one page');
assert.ok(/\.add\([^)]*\)\.catch/.test(sw),
  'the service worker does not tolerate an individual precache miss');

console.log(
  `check-mobile OK: ${PAGES.length} pages installable and share-sheet capable, ` +
  `no bare download anchors, ${paths.length} shell entries all present`
);

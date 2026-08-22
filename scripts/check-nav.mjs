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
/* Comments stripped before scanning for code patterns. Four assertions in this
   repo have now been satisfied by prose describing the thing they were meant
   to check, so scanning raw source is treated as a defect. */
const codeOnly = (src) => src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/* file -> the public URL it is served at, and the label that must be current
   on it. The redirects are what make the pretty URLs work, so they are checked
   too: a bar full of links to /eflc is worth nothing if /eflc 404s. */
/* FIVE ENTRIES ACROSS FOUR FILES. today.html serves two of them: `/` is
   today's matches and /today is the season calendar. They are one file on
   purpose — a second copy would have forked the pricing, the confirmed-XI join
   and both card builders — so the bar has more entries than there are pages,
   and one page's current item depends on which route it was opened at.
   `runtime: true` marks those: their aria-current cannot be in the markup,
   because the markup is shared between both routes. */
const LINKS = [
  { file: 'today.html', url: '/', label: 'Today', runtime: true },
  { file: 'index.html', url: '/pl', label: 'Premier League' },
  { file: 'eflc.html', url: '/eflc', label: 'Championship' },
  { file: 'laliga.html', url: '/laliga', label: 'La Liga' },
  { file: 'today.html', url: '/today', label: 'Season calendar', runtime: true }
];
/* The distinct files, for the per-page checks. */
const DESKS = LINKS.filter((d, i) => LINKS.findIndex((x) => x.file === d.file) === i);

/* ---- 1. every desk links to every desk ---------------------------------- */
for (const from of DESKS) {
  const src = read(from.file);
  const bar = /<nav class="leaguebar"[\s\S]*?<\/nav>/.exec(src);
  assert.ok(bar, `${from.file} has no league switcher — the other desks are ` +
    'unreachable from it');
  for (const to of LINKS) {
    assert.ok(new RegExp(`href="${to.url}"`).test(bar[0]),
      `${from.file} does not link to ${to.url} (${to.label})`);
  }
  const current = [...bar[0].matchAll(/aria-current="page"[\s\S]{0,220}?<\/a>/g)];
  if (from.runtime) {
    /* One file, two routes: marking either in the markup would mark it on BOTH
       routes, which is the "two look authoritative" failure by another name.
       It is set at boot from the route instead, and that is what is checked —
       both arms, so a page cannot lose its "you are here" on one route only. */
    assert.equal(current.length, 0,
      `${from.file} hardcodes a current item, but it serves two routes — it ` +
      'would claim to be the current page on both of them');
    const code = codeOnly(read(from.file));
    assert.ok(/\.lb-season['"]?\s*:\s*['"]\.lb-today/.test(code)
      || /lb-season[\s\S]{0,60}lb-today/.test(code),
      `${from.file} does not choose a current league-bar item from its route`);
    assert.ok(/setAttribute\('aria-current', 'page'\)/.test(code),
      `${from.file} never marks any league-bar item as current, so neither of ` +
      'its two routes says "you are here"');
  } else {
    /* Exactly one current item, and it must be this page. Marking none loses
       the "you are here"; marking two is worse, because both look
       authoritative. */
    assert.equal(current.length, 1,
      `${from.file}'s switcher marks ${current.length} items as current, expected 1`);
    assert.ok(current[0][0].includes(from.label),
      `${from.file} marks the wrong desk as current — expected ${from.label}`);
  }
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
/* `/` IS A RULE NOW, and is checked like the rest. It used to fall through to
   the catch-all and serve the Premier League desk; it serves today's matches,
   and if that rule ever goes missing the catch-all silently restores the old
   home page — the exact failure this block was written for, at the one URL
   that used to be exempt from it. */
for (const d of LINKS) {
  const i = lines.findIndex((l) => l.split(/\s+/)[0] === d.url);
  assert.ok(i > -1, `_redirects has no rule for ${d.url} — the catch-all would ` +
    `serve the Premier League page at the ${d.label} URL`);
  assert.ok(i < catchAll,
    `${d.url} is routed AFTER the catch-all in _redirects, so it never matches`);
  assert.ok(lines[i].includes(d.file),
    `${d.url} does not route to ${d.file}`);
}

/* ---- 2a. a rewrite shadowed by a real file must be FORCED ---------------- */
/* NETLIFY SERVES A MATCHING STATIC FILE BEFORE IT CONSULTS REDIRECTS. So a
   200 rewrite whose source path already resolves to a file is silently
   ignored — no error, no warning, the rule simply never fires.
   That shipped. `/ -> /today.html 200` was shadowed by index.html serving as
   the directory index, so `/` kept returning the Premier League desk and
   tapping "Today's matches" moved you from the PL desk to the PL desk. It
   looked like a dead link and was a routing rule that could not fire.
   The bang (`200!`) forces the rewrite ahead of the file. This checks every
   2xx rule for the collision, so the next one cannot ship the same way — and
   no local server reproduces it, because the precedence belongs to Netlify. */
{
  const staticFor = (src) => {
    if (src.includes('*') || src.includes(':')) return null;   // wildcards never shadow
    if (src === '/') return existsSync(join(root, 'index.html')) ? '/index.html' : null;
    if (existsSync(join(root, src))) return src;
    if (existsSync(join(root, src + '.html'))) return src + '.html';
    if (existsSync(join(root, src, 'index.html'))) return src + '/index.html';
    return null;
  };
  for (const line of lines) {
    const [src, target, code] = line.split(/\s+/);
    if (!code || !/^2\d\d!?$/.test(code)) continue;
    const shadow = staticFor(src);
    if (!shadow || shadow === target) continue;   // nothing serves it, or the same thing
    assert.ok(code.endsWith('!'),
      `_redirects: "${src} -> ${target} ${code}" is shadowed by the static file ` +
      `${shadow}, which Netlify serves first. The rule never fires and ${src} ` +
      `silently returns ${shadow}. Add the force flag: ${code}!`);
  }
}

/* ---- 2b. a missing optional data file must 404, not become HTML ---------- */
/* Three script tags carry onerror="void 0" for files that may legitimately not
   exist — data/lineups.js above all, which appears only once a harvest has
   landed a team sheet. THE GUARD IS WORTHLESS WITHOUT A 404. Netlify serves
   static files ahead of redirects, so a file that exists is unaffected; one
   that does not used to fall through to the catch-all and come back as
   index.html with HTTP 200, and a browser does not fire `error` on a 200 — it
   throws `SyntaxError: Unexpected token '<'` parsing HTML as JavaScript, on
   every page load of all four desks.
   Invisible to `python3 -m http.server`, which returns a real 404, which is
   why every local run looked clean while production threw. */
{
  const optional = [...read('today.html').matchAll(/src="(data\/[^"]+)"[^>]*onerror/g)]
    .concat([...read('index.html').matchAll(/src="(data\/[^"]+)"[^>]*onerror/g)])
    .concat([...read('eflc.html').matchAll(/src="(data\/[^"]+)"[^>]*onerror/g)])
    .concat([...read('laliga.html').matchAll(/src="(data\/[^"]+)"[^>]*onerror/g)])
    .map((m) => m[1]);
  assert.ok(optional.length > 0,
    'no data file is loaded with an onerror guard any more — if that is ' +
    'deliberate this check and the /data/* rule can go, but not silently');
  const i = lines.findIndex((l) => l.split(/\s+/)[0] === '/data/*');
  assert.ok(i > -1,
    `_redirects has no /data/* rule, so a missing optional file (${optional[0]}) ` +
    'comes back as index.html with a 200 and every desk throws a SyntaxError');
  assert.ok(i < catchAll,
    '/data/* is routed AFTER the catch-all, so it never matches and missing ' +
    'data files still return HTML');
  assert.ok(/\s404\s*$/.test(lines[i]),
    `the /data/* rule does not return 404 (${lines[i]}) — any 2xx leaves the ` +
    'onerror guards dead');
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

/* ---- 3b. the current item must be reachable on a phone ------------------- */
/* The bar shows FULL labels and scrolls: 723px of content in a 390px viewport.
   tw.css says outright that "the active item is scrolled into view on load so
   you can always see where you are" — and for as long as that sentence has
   existed, nothing did it. The season calendar's entry is last and measured at
   559..717px with scrollLeft still 0: the one page the bar would not show you
   was the page you were on.
   A COMMENT IS NOT AN IMPLEMENTATION. This checks for the code. */
{
  assert.ok(existsSync(join(root, 'assets', 'leaguebar.js')),
    'assets/leaguebar.js is gone — nothing scrolls the current league-bar item ' +
    'into view, and on a phone it is off screen behind a swipe nobody discovers');
  const lb = read('assets/leaguebar.js');
  assert.ok(/\[aria-current="page"\]/.test(lb),
    'leaguebar.js no longer looks for the current item');
  assert.ok(/scrollWidth <= .*clientWidth/.test(lb),
    'leaguebar.js no longer leaves a bar that already fits alone — scrolling ' +
    'one shifts a row the reader can see all of');
  for (const d of DESKS) {
    assert.ok(/src="assets\/leaguebar\.js"/.test(read(d.file)),
      `${d.file} does not load leaguebar.js, so its current item stays off ` +
      'screen on a phone');
  }
  /* today.html marks its current item at boot, after the module's own
     DOMContentLoaded pass has already run and found nothing to centre. */
  assert.ok(/PLDLeagueBar\.center\(\)/.test(codeOnly(read('today.html'))),
    'today.html sets its current item at boot but never asks the league bar to ' +
    're-centre, so the module has already run and found nothing');
}

/* ---- 4. the combined views are advertised, not merely linked ------------- */
/* A link to /today is not the same as knowing what is on it. The two things
   that make it worth opening — the cross-league card for one date, and the
   whole-season calendar behind the "Every date" toggle — are a level down from
   the page itself, so each league desk says so explicitly. */
for (const d of DESKS) {
  /* Skipped by FILE, not by url: today.html's entry in the deduped list now
     carries `/`, so a url test silently stopped skipping it and demanded the
     combined-views note on the page that IS the combined view. */
  if (d.file === 'today.html') continue;
  const src = read(d.file);
  /* Either container. The Premier League desk used to carry a `.combined-note`
     block stacked under a separate "New here?" paragraph; the pair pushed the
     gameweek hero off a 390px screen, so they were collapsed into one
     `.gw-intro` card that carries the same two links. What matters is that
     each desk advertises the combined views somewhere — not which element
     does it, which is what this used to pin. */
  const note = /<p class="(?:combined-note|gw-intro)"[^>]*>[\s\S]*?<\/p>/.exec(src);
  assert.ok(note, `${d.file} never points at the combined views`);
  assert.ok(/href="\/"/.test(note[0]),
    `${d.file}'s combined-view note does not link today's matches at /`);
  assert.ok(/href="\/today"/.test(note[0]),
    `${d.file} does not link the whole-season calendar — it is a page of its own ` +
    'at /today and is otherwise advertised nowhere');
}
assert.ok(/\.combined-note\{/.test(css),
  'the combined-view note has no styles in tw.css');

/* today.html must actually honour the deep link the others send people to. */
/* Scoped to the block that READS the hash. A bare search for "=== 'all'"
   matched `mode() === 'all'` in the renderer, so deleting the deep-link
   handling entirely still passed — the assertion was reading the wrong
   comparison against the same string. */
const today = read('today.html');
/* Anchored on String(location.hash — the READ. Matching bare `location.hash`
   found the WRITE in render() first, which sets the hash to 'all' or 'd=…',
   so both strings were present there and deleting the entire deep-link
   handler still passed. Two different sites, same two literals. */
/* Widened from 500 when #accas got a route of its own: the two deep links are
   now two branches with a note between them, and the second literal sat past
   the old window — which reads exactly like the handler having been deleted. */
const hashBlock = /String\(location\.hash[\s\S]{0,900}/.exec(today);
assert.ok(hashBlock, 'today.html never reads location.hash, so the deep links ' +
  'the other desks point at do nothing');
assert.ok(/'all'/.test(hashBlock[0]),
  "today.html no longer handles the #all deep link, so every 'whole-season " +
  "calendar' link on the other desks opens the single-date view instead");
assert.ok(/d=\\d\{4\}|d=/.test(hashBlock[0]),
  'today.html no longer handles the #d=YYYY-MM-DD deep link');

/* ---- 5. the first-run tour names the other leagues ----------------------- */
/* The tour is what a new visitor reads before anything else, and all three of
   its steps used to be about the Premier League desk. Someone could finish the
   introduction to the site without learning that two thirds of it existed. */
const tour = /const TOUR=\[([\s\S]*?)\n\];/.exec(read('index.html'));
assert.ok(tour, 'index.html has no guided tour');
assert.ok(/leaguebar/.test(tour[1]),
  'the tour never spotlights the league switcher, so a new visitor is ' +
  'introduced to the site without being told the other leagues exist');
for (const word of ['Championship', 'La Liga']) {
  assert.ok(tour[1].includes(word), `the tour never mentions ${word}`);
}

/* ---- 6. the app shell is on the desks that need it ----------------------- */
/* The two newer desks navigated with a single tab strip while the Premier
   League desk had a sidebar, a breadcrumb and a mobile bottom bar. That is
   felt before a number is read. */
for (const f of ['eflc.html', 'laliga.html']) {
  const src = read(f);
  assert.ok(/assets\/shell\.js/.test(src), `${f} does not load the app shell`);
  assert.ok(/PLDShell\.build\(/.test(src), `${f} never builds the app shell`);
  for (const area of ['matchday', 'desk', 'fixtures', 'guide']) {
    assert.ok(new RegExp(`id: '${area}'`).test(src), `${f}'s shell has no ${area} area`);
  }
  /* The landing view. Opening on a table of several hundred players is a
     different product from opening on the fixtures, not a different skin. */
  assert.ok(/id="panel-matchday"/.test(src), `${f} has no This Matchday landing`);
  assert.ok(/function renderMatchday/.test(src), `${f} never renders the matchday view`);
  /* ONE band(). A second declaration in the same scope hoists over the first
     and silently replaced the fixture cards' High/Watch pills with a class
     called "<" — the cards kept rendering and nothing threw. */
  const decls = (codeOnly(src).match(/function band\(/g) || []).length;
  assert.equal(decls, 1, `${f} declares band() ${decls} times — a duplicate hoists ` +
    'over the fixture cards\' banding and replaces it with garbage that still renders');
  /* shareRound must take the round: This Matchday shares a round that is not
     the one selected on the Fixtures tab. */
  assert.ok(/function shareRound\(round, btn\)/.test(src),
    `${f}'s shareRound reads a control instead of taking the round, so This ` +
    'Matchday would export whatever the Fixtures tab has selected');
}
assert.ok(/\.as-main\{[^}]*min-width:0/.test(css),
  '.as-main can no longer shrink — the players table then forces the page ' +
  'wider than the phone and the browser zooms the whole app out');
assert.ok(!/\.as-main\{[^}]*display:flex/.test(css),
  '.as-main is a flex container again: main.wrap has margin:0 auto, and auto ' +
  'cross-axis margins disable stretch, so it sizes to its content and the ' +
  'page grows to ~912px on a 390px screen');


/* ---- 7. the tables show the same columns on every desk ------------------- */
/* The club and referee tables had diverged in BOTH directions from identical
   data — each desk showing a subset the other did not. One agreed set now, so
   a reader moving between divisions is not re-learning the table. */
const CLUB_COLS = ['Club', 'Form basis', 'Cards/game', 'Home', 'Away',
                   'Fouls/game', 'Tier', 'Squad', 'Top booking risk'];
const REF_COLS = ['Referee', 'Matches', 'Yellows', 'Fouls', 'Cards/foul',
                  'Reds', 'Pens', '×factor', 'Strictness'];
for (const [f, clubId, refId] of [
  ['index.html', 'panel-clubs', 'panel-refs'],
  ['eflc.html', 'panel-clubs', 'panel-referees'],
  ['laliga.html', 'panel-clubs', 'panel-referees']]) {
  const src = read(f);
  const seg = (id) => {
    const i = src.indexOf(`id="${id}"`);
    return i < 0 ? '' : src.slice(i, i + 4000);
  };
  /* The LABELS, not the raw HTML. Searching the markup matched
     id="clubSquadTh" for the column called "Squad", so renaming the header to
     "Sq" still passed — the assertion was reading an attribute name. */
  const labels = (head) => [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  const clubHead = /<thead>[\s\S]*?<\/thead>/.exec(seg(clubId));
  assert.ok(clubHead, `${f} has no club table head`);
  const clubLabels = labels(clubHead[0]);
  for (const c of CLUB_COLS) {
    assert.ok(clubLabels.some((l) => l.includes(c)),
      `${f}'s club table has no "${c}" column — it shows [${clubLabels.join(', ')}]`);
  }
  const refHead = /<thead>[\s\S]*?<\/thead>/.exec(seg(refId));
  assert.ok(refHead, `${f} has no referee table head`);
  const refLabels = labels(refHead[0]);
  for (const c of REF_COLS) {
    assert.ok(refLabels.some((l) => l.includes(c)),
      `${f}'s referee table has no "${c}" column — it shows [${refLabels.join(', ')}]`);
  }
}
/* One tier vocabulary. "Target" and "Fade" are instructions; the desk says
   research, not a tip, on every other line. */
for (const f of ['index.html', 'eflc.html', 'laliga.html']) {
  assert.ok(/Card-heavy/.test(read(f)), `${f} uses a different tier vocabulary`);
}


/* ---- 8. tour, palette, glossary and density on the newer desks ----------- */
/* The Premier League desk has had all four since it was built. A reader
   arriving at the Championship was dropped into a 974-row table with no
   explanation of what a percentage on it meant, and no way to find a referee
   without first knowing which tab he lived on. */
for (const f of ['eflc.html', 'laliga.html']) {
  const src = read(f);
  for (const [asset, why] of [
    ['assets/tour.js', 'has no first-run tour'],
    ['assets/palette.js', 'has no command palette']]) {
    assert.ok(src.includes(asset), `${f} ${why}`);
  }
  /* offer(), not maybe(). maybe() opened the tour on a 600ms timer, so a
     first-time visitor met a dimmed page and "Step 1 of 4" before seeing a
     number — and the spotlight's scroll left the desk sitting past its own
     heading on a phone. The tour is pressed now; scripts/check-firstrun.mjs
     holds the rest of that, including the mobile path. */
  assert.ok(/PLDTour\.offer\(/.test(src), `${f} never wires up its tour`);
  assert.ok(/PLDPalette\.init\(/.test(src), `${f} never initialises the palette`);
  assert.ok(/glossary: \[/.test(src), `${f} ships no glossary terms`);
  /* One source of steps. Two copies is two tours teaching different things. */
  assert.equal((src.match(/tour: \[/g) || []).length, 1,
    `${f} defines its tour steps more than once`);
}
/* Both the guard and the call. Matching only the call left `if (false)
   root.PLDTour.run(...)` passing — the text was still there, unreachable.
   A static assertion cannot see dead code in general; pinning the condition is
   the closest it gets, and the realistic regressions (the asset dropped, the
   listener removed) are caught by the checks above regardless. */
{
  const shellCode = codeOnly(read('assets/shell.js'));
  assert.ok(/if \(root\.PLDTour && cfg\.tour\)/.test(shellCode)
    && /root\.PLDTour\.run\(/.test(shellCode),
    'the shell\'s "?" button no longer re-runs the tour');
}
/* The three added controls must collapse on a phone. Adding them pushed both
   desks to 512px on a 390px screen, and the browser zoomed the whole page out
   rather than overflowing. */
assert.ok(/\.as-help\{display:none\}/.test(css) && /\.as-den-lab\{display:none\}/.test(css),
  'the topbar controls do not collapse on a narrow screen, so the page is ' +
  'wider than the phone and renders zoomed out');


/* ---- 9. head-to-head and derbies on the newer desks ---------------------- */
/* Both were Premier-League-only. H2H comes from the same public-domain match
   records already behind the referee figures and the venue splits, so this
   added a signal without adding a source, a login or a key. */
for (const [f, dataFile, varName] of [
  ['eflc.html', 'data/eflc_h2h.js', 'EFLC_H2H'],
  ['laliga.html', 'data/laliga_h2h.js', 'LALIGA_H2H']]) {
  const src = read(f);
  assert.ok(existsSync(join(root, dataFile)), `${dataFile} is missing`);
  assert.ok(src.includes(dataFile), `${f} does not load its head-to-head history`);
  assert.ok(/function h2hFor/.test(src), `${f} has no head-to-head lookup`);
  /* Under three meetings is anecdote, not history. */
  assert.ok(/p\.n >= 3/.test(src),
    `${f} shows a head-to-head built on fewer than three meetings`);

  /* Every derby code must be a club that is IN the division. A guessed short
     code produces a derby that does not exist — the first list flagged
     Bristol City v Millwall, which is not one. */
  const derbies = /var DERBIES = \[([\s\S]*?)\n  \];/.exec(src);
  assert.ok(derbies, `${f} has no derby list`);
  const pairs = [...derbies[1].matchAll(/\['([A-Z]{2,4})','([A-Z]{2,4})'\]/g)]
    .map((m) => [m[1], m[2]]);
  assert.ok(pairs.length >= 8, `${f} lists only ${pairs.length} derbies`);
  const clubsSrc = readFileSync(join(root, 'data',
    f === 'eflc.html' ? 'eflc_data.js' : 'laliga_data.js'), 'utf8');
  const block = /const CLUBS = \[([\s\S]*?)\n\];/.exec(clubsSrc);
  const valid = new Set([...block[1].matchAll(/short:"([^"]+)"/g)].map((m) => m[1]));
  for (const [a, b] of pairs) {
    assert.ok(valid.has(a) && valid.has(b),
      `${f} lists a derby between ${a} and ${b}, and ` +
      `${valid.has(a) ? b : a} is not a club in this division`);
    assert.notEqual(a, b, `${f} lists a club as its own derby`);
  }

  /* The derby must PRICE, not merely label. The Premier League desk applies
     1.08 per player; a tag with no effect on the number is decoration. */
  assert.ok(/DERBY_BOOST = 1\.08/.test(src),
    `${f} does not apply the derby boost to its pricing`);
  assert.ok(/factor \* \(derby \? DERBY_BOOST : 1\)/.test(codeOnly(src)),
    `${f} computes a derby flag but never multiplies it into the price`);
  /* …and it must stay out of the displayed referee factor, or an official
     reads as stricter than he is because of who is playing. */
  assert.ok(/factor: factor,/.test(src),
    `${f} reports the derby-boosted factor as the referee's ×figure`);
}
assert.ok(!existsSync(join(root, 'scripts', 'build-h2h.mjs')),
  'scripts/build-h2h.mjs is back — data/build_h2h.py replaced it and ' +
  'reproduces its output exactly; two builders for one file is how they drift');

/* A build step whose output is never staged is a no-op that LOOKS like a
   success: the file is written, the step passes, the summary is cheerful, and
   the runner is torn down with the work inside it. That is not hypothetical —
   the head-to-head step shipped in exactly that state, and the only reason it
   was caught is that someone read the commit step afterwards. So: every data
   file the refresh workflow builds must also appear in the block that stages
   it. Checked by name rather than by eye, because the two are ~290 lines apart.
   Note the workflow is the ONLY place the Championship file can be built — the
   mirror does not carry that division and the origin is unreachable from a
   development machine — so losing its output loses it entirely. */
const wf = read('.github/workflows/data-refresh.yml');
const staged = wf.slice(wf.indexOf('Commit and push if changed'));
for (const f of ['data/h2h.js', 'data/eflc_h2h.js', 'data/laliga_h2h.js']) {
  assert.ok(staged.includes(f),
    `data-refresh.yml builds ${f} but never stages it for commit — the run ` +
    'would rebuild it and throw it away');
}
assert.ok(/python3 data\/build_h2h\.py --league EFLC/.test(wf),
  'data-refresh.yml no longer builds the Championship head-to-head, which is ' +
  'the one division that can only be built there');


/* The combined view's boot must announce its own failure. Reported from an
   iPad: heading and controls rendered, the date picker offered "No Options",
   and there were no fixtures, no stats and no empty-state message — a state
   only reachable if the boot threw partway, since both of its branches write
   something visible. It could not be reproduced in Chromium and there is no
   WebKit in this sandbox, so the fix is not a guess at the cause: it is that
   the page can never again fail silently. Reuses `today`, read further up. */
assert.ok(/function bootFailed/.test(today),
  'today.html lost bootFailed() — a throw in its boot renders a page that ' +
  'looks deliberate and is simply empty, with nothing to diagnose from');
assert.ok(/catch \(err\) \{\s*\n\s*bootFailed\(err\);/.test(today),
  'today.html catches its boot error without calling bootFailed(), so the ' +
  'failure is swallowed and the page still goes blank');
assert.ok(/desks are unaffected/.test(today),
  'the boot failure message must point at the individual desks, which keep ' +
  'working when only the combined view breaks');


/* ---- a club row opens that club's players, on every desk ---------------- */
/* The club table answers "which sides are card-heavy" and the next question is
   always WHICH PLAYERS. The Premier League desk has opened the filtered player
   list on a row tap since it was built; the Championship and La Liga shipped
   the same table, sorted the same way, with the row inert — so the answer was
   two tabs and a select away on two desks out of three and one tap on the
   third. Nothing failed: an inert row throws nothing and looks identical.

   Keyboard as well as pointer, because a row is not a link element: without
   tabindex and a key handler this is a drill-through that exists only for a
   mouse. */
/* THE ROW EMIT AND THE BINDING ARE CHECKED SEPARATELY, because a file-wide
   search for "data-club" is answered by the HANDLER'S OWN SELECTOR. Stripping
   the attribute off every row left all four of these green on the first
   attempt: the code that looks for the rows was vouching for the rows. Same
   shape as the data-open-tour hole, found the same way — by mutation. */
/* The CLUB ROW's own markup, sliced out first. A file-wide search for
   tabindex="0" is answered by the PLAYER rows, which have carried it all
   along — so the club row could lose it while the check stayed green. Every
   attribute is asserted against this slice and nothing else. */
const CLUB_ROWS = [
  { page: 'index.html', table: 'clubRows', bind: 'clubRows',
    /* built with createElement: the marks are property assignments, from the
       data-club line to the point the row's cells are written */
    slice: /tr\.dataset\.club\s*=[\s\S]{0,400}?tr\.innerHTML\s*=/,
    marks: { focusable: /tabIndex\s*=\s*0/, link: /"role"\s*,\s*"link"/ } },
  { page: 'eflc.html', table: 'tblClubs', bind: 'tblClubs',
    /* built as an HTML string: attributes inside one template, from the
       opening tag to the first cell */
    slice: /<tr data-club="[\s\S]{0,400}?<td>/,
    marks: { focusable: /tabindex="0"/, link: /role="link"/ } },
  { page: 'laliga.html', table: 'tblClubs', bind: 'tblClubs',
    slice: /<tr data-club="[\s\S]{0,400}?<td>/,
    marks: { focusable: /tabindex="0"/, link: /role="link"/ } }
];
for (const d of CLUB_ROWS) {
  const src = read(d.page);
  const row = d.slice.exec(src);
  assert.ok(row,
    `${d.page} does not EMIT data-club on its club rows. A search of the file ` +
    "finds the handler's selector; this looks at what is rendered.");
  assert.ok(d.marks.focusable.test(row[0]),
    `${d.page} club rows are not focusable — the drill-through works for a ` +
    'mouse and does not exist for a keyboard. (The player rows carry ' +
    'tabindex too, so this is checked on the club row alone.)');
  assert.ok(d.marks.link.test(row[0]),
    `${d.page} club rows do not announce themselves as a link, so a screen ` +
    'reader reads a table cell and no affordance');
  /* WIRED, and both events. A passing pointer path is exactly what hides a
     missing key handler — the row still says role="link" to a screen reader
     while Enter does nothing. */
  for (const ev of ['click', 'keydown']) {
    const bound = new RegExp('[("\'#]' + d.bind + '["\')\\]]*\\s*\\)?\\s*\\.addEventListener\\(\\s*["\']' + ev);
    assert.ok(bound.test(src),
      `${d.page} never binds ${ev} on #${d.bind} — its club rows are marked up ` +
      'as links and do nothing');
  }
  /* The DEFINITION. `/openClubPlayers\(/` over the file is matched by the
     handler's CALL, so renaming the function out from under it left this
     green while every row threw on click. */
  assert.ok(/function openClubPlayers\s*\(/.test(src),
    `${d.page} has no openClubPlayers() definition — the rows call a function ` +
    'that does not exist and throw on the first tap');
}

/* ---- 6. today's matches must be clickable too ---------------------------- */
/* `/` lists every match on the card with its likeliest bookings. Until this
   was added it listed them and did NOTHING when tapped — the rows even carried
   a hover tint and a focus ring in tw.css, styled for an interaction that did
   not exist. It went unnoticed while the page was a level down; it is the home
   page now and a player row is the obvious thing to tap.
   Asserted the same way as the desks above: the definition, both activations,
   and the affordance. */
{
  const src = read('today.html');
  const code = codeOnly(src);
  assert.ok(/function openCand\s*\(/.test(code),
    'today.html has no openCand() — a candidate row is a button that calls a ' +
    'function that does not exist, and throws on the first tap');
  assert.ok(/class="cand cand-open"[\s\S]{0,120}role="button"/.test(code),
    'candidate rows are no longer buttons, so nothing on the home page can be ' +
    'tapped to open a player');
  assert.ok(/tabindex="0"/.test(code),
    'candidate rows are not focusable, so the keyboard cannot reach them');
  assert.ok(/addEventListener\('click'[\s\S]{0,400}cand-open/.test(code),
    'no click handler reaches .cand-open');
  /* BOTH ACTIVATIONS. A row reachable by Tab that Enter does not open is worse
     than one that was never focusable. */
  assert.ok(/addEventListener\('keydown'[\s\S]{0,300}cand-open/.test(code),
    'no keydown handler reaches .cand-open — the rows take focus but Enter ' +
    'does nothing');
  /* Both keys, whichever way the test is spelled — the handler early-returns
     with !== and an assertion pinned to === passed only by accident of style.
     Scoped to the keydown handler so a stray 'Enter' elsewhere cannot satisfy
     it. */
  const kd = /addEventListener\('keydown'[\s\S]{0,400}?\n    \}\);/.exec(code);
  assert.ok(kd, 'today.html has no keydown handler to inspect');
  assert.ok(/'Enter'/.test(kd[0]) && /' '|'Spacebar'/.test(kd[0]),
    'the keyboard handler no longer accepts both Enter and Space');
  assert.ok(/PLDProfile\.open\(/.test(code),
    'openCand no longer opens a profile card');
  /* And the fixture heading links to the division's own desk. */
  assert.ok(/<a class="fx-teams" href="/.test(code),
    'the fixture heading is not a link, so there is no way from a match on the ' +
    "home page to the desk that prices it");
  assert.ok(/\.cand-open\{cursor:pointer\}/.test(read('assets/tw.css')),
    'clickable candidate rows have no pointer cursor, so nothing suggests they ' +
    'can be tapped');
}

console.log(
  `check-nav OK: ${LINKS.length} entries across ${DESKS.length} pages, each ` +
  `linking to all ${LINKS.length} and marking itself current, all routed ` +
  'before the catch-all; combined views ' +
  'advertised from every desk and named in the tour; a club row opens its ' +
  'players on all three league desks, by pointer and by keyboard'
);

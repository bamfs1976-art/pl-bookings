#!/usr/bin/env node
/* One palette, four desks — and nowhere else for a colour to be written down.
 *
 * WHY THIS EXISTS. The La Liga desk was built by copying the Championship's
 * page. That copy included its <style>, and its <style> included the whole
 * palette, so La Liga shipped wearing the Championship's purple. Its nav dot
 * was orange, its share cards were orange, and its buttons, links, focus rings
 * and progress bars were the wrong league's. Three places named the league's
 * colour and only two agreed. Nothing failed: every page passed its own
 * checks, because no check had ever asked whether the four desks were painted
 * from one tin.
 *
 * The same copy-paste left the four :root blocks disagreeing about which
 * tokens EXIST. --target, --mid and --fade were declared on the Premier League
 * desk alone, so any rule using them was simply silent on the other three —
 * a colour that resolves to nothing renders as unset, not as an error.
 *
 * So this asserts four things, and the last is the one with teeth:
 *
 *   1. No page declares colour tokens. tw.css is the only source.
 *   2. Each page wears exactly one lg-* class, and the right one.
 *   3. assets/share.js — which draws to a canvas and so CANNOT read a
 *      stylesheet — carries the same colours the stylesheet does.
 *   4. Every --token any page REFERENCES is defined in tw.css, in both
 *      themes. This is what catches a Premier League component being
 *      propagated to another desk while the token behind it is not.
 *
 *     node scripts/check-palette.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const css = read('assets/tw.css');

const PAGES = {
  'index.html': 'lg-pl',
  'eflc.html': 'lg-eflc',
  'laliga.html': 'lg-ll',
  'today.html': 'lg-all'
};

/* ---- the token blocks in tw.css ----------------------------------------- */

/* Index just past the `{` a selector opens, or -1. Tolerates the whitespace
   the sheet uses to line the four league blocks up in a column — matching on
   `selector + '{'` reported "assets/tw.css defines no html.lg-eflc" about a
   rule that was right there, one space away. */
function openerOf(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* Anchored to the start of a line: every palette rule in the sheet begins in
     column 0, and anchoring keeps `html[data-theme="dark"]` from matching the
     four `html[data-theme="dark"].lg-*` overrides that follow it. */
  const m = css.match(new RegExp('^' + esc + '\\s*\\{', 'm'));
  return m ? m.index + m[0].length : -1;
}

/* A brace-balanced read of the block a selector opens. A lazy [^}]* would stop
   at the first `}` — fine for these flat blocks today, and wrong the moment
   somebody puts a color-mix() or a nested rule in one. */
function block(selector) {
  const open = openerOf(selector);
  assert.notStrictEqual(open, -1,
    `assets/tw.css has no "${selector}{...}" block. The palette must live in ` +
    'the shared sheet; if it has moved back into the pages, put it back.');
  let depth = 1, i = open;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(open, i - 1);
}

function tokensIn(text) {
  const out = new Map();
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) out.set(m[1], m[2].trim());
  return out;
}

const LIGHT = tokensIn(block(':root'));
const DARK = tokensIn(block('html[data-theme="dark"]'));

/* Every token the light theme defines must be redefined dark, or that one
   colour stays at its light value on a dark ground — a single #0c1322 label on
   #141b2c, which is unreadable and which nothing else would report. Layout and
   type tokens are theme-independent by nature and named here explicitly rather
   than inferred, so a genuinely missing colour cannot hide behind a heuristic. */
const THEME_FREE = new Set(['--mono', '--sidebar-w', '--topbar-h', '--bottomnav-h']);
{
  /* A token defined as a bare var(--other) does not need a dark value of its
     own: it is an indirection, and it resolves through whatever --other holds
     in the current theme. --efl aliases --eflc that way, and --accent-2 rides
     on the league marks. Followed rather than whitelisted, so an alias to a
     token that is ITSELF light-only is still reported. */
  const themed = (t, seen) => {
    if (DARK.has(t)) return true;
    const v = LIGHT.get(t) || '';
    const m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (!m || seen.has(m[1])) return false;
    seen.add(m[1]);
    return themed(m[1], seen);
  };
  const unthemed = [...LIGHT.keys()]
    .filter((t) => !THEME_FREE.has(t) && !themed(t, new Set([t])));
  assert.deepStrictEqual(unthemed, [],
    `assets/tw.css defines ${unthemed.join(', ')} for the light theme only. ` +
    'In dark mode those keep their light value — a near-black label on a ' +
    'near-black card — which renders as illegible rather than as broken.');
}

/* ---- 1 + 2: the pages declare a league, and nothing else ---------------- */

const COLOUR_TOKENS = new Set(
  [...LIGHT.keys()].filter((t) => !THEME_FREE.has(t) || t === '--efl'));

for (const [page, cls] of Object.entries(PAGES)) {
  const src = read(page);
  const inline = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

  /* The declaration, not the mention. Both the shared sheet and every page
     carry prose about the palette, and a bare search for "--accent" is
     satisfied by a comment explaining why it must not be redeclared here. */
  const redeclared = [...COLOUR_TOKENS].filter((t) => {
    const decl = new RegExp('(^|[{;\\s])' + t + '\\s*:', 'm');
    return decl.test(inline);
  });
  assert.deepStrictEqual(redeclared, [],
    `${page} redeclares ${redeclared.join(', ')} in its own <style>. That is ` +
    'how La Liga came to wear the Championship purple: the page was copied, ' +
    'the palette came with it, and the copy stopped tracking the original. ' +
    'Delete the declaration — assets/tw.css already defines it.');

  const html = src.match(/<html[^>]*>/)[0];
  const classes = (html.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/).filter(Boolean);
  const leagues = classes.filter((c) => c.startsWith('lg-'));
  assert.deepStrictEqual(leagues, [cls],
    `${page} should carry exactly one league class, ${cls}, on <html>; it ` +
    `carries [${leagues.join(', ')}]. Without it the desk falls back to the ` +
    'combined view\'s teal and stops looking like the competition it covers.');
  assert.ok(openerOf('html.' + cls) !== -1,
    `assets/tw.css defines no "html.${cls}" palette, so ${page} asks for an ` +
    'identity that does not exist and silently keeps the :root default');
}

/* ---- 3: share.js carries the same colours ------------------------------- */

/* Read the THEMES literal out of the source. Importing it would need a DOM,
   and the file is a browser IIFE — but the object is a plain literal, so the
   fields can be pulled directly and the values compared. */
const share = read('assets/share.js');
function shareTheme(code) {
  const at = share.indexOf('\n    ' + code + ': {');
  assert.notStrictEqual(at, -1, `assets/share.js has no THEMES.${code}`);
  const body = share.slice(at, share.indexOf('\n    }', at));
  const field = (k) => {
    const m = body.match(new RegExp(k + ":\\s*'([^']*)'"));
    assert.ok(m, `THEMES.${code} has no ${k}`);
    return m[1];
  };
  return { to: field('to'), ink: field('ink'), lg: field('lg') };
}

/* code -> [the league's own mark token, the class its desk wears] */
const DESKS = {
  PL: ['--pl', 'lg-pl'],
  EFLC: ['--eflc', 'lg-eflc'],
  LL: ['--ll', 'lg-ll'],
  ALL: ['--all', 'lg-all']
};

for (const [code, [mark, cls]] of Object.entries(DESKS)) {
  const th = shareTheme(code);
  const wanted = LIGHT.get(mark);
  assert.ok(wanted, `assets/tw.css defines no ${mark}`);
  assert.strictEqual(th.to, wanted,
    `share.js draws the ${code} card in ${th.to} while tw.css paints the ${code} ` +
    `nav dot ${wanted}. The card is the one artefact that leaves the site — ` +
    'nobody who sees one can hold it up against the page it came from.');

  const accent = tokensIn(block('html.' + cls)).get('--accent');
  assert.ok(accent, `assets/tw.css html.${cls} sets no --accent`);
  assert.strictEqual(th.ink, accent,
    `share.js inks the ${code} card ${th.ink} while the ${cls} desk runs on ` +
    `${accent}. Two shades of the same idea is how this drifts: near enough ` +
    'to look deliberate, far enough to be wrong.');

  assert.strictEqual(th.lg, cls,
    `THEMES.${code}.lg says "${th.lg}" but the desk wears "${cls}"`);
}

/* The browser chrome the installed app paints behind the status bar. It is a
   hex literal in a <meta> — no stylesheet reaches it — and it is the FIRST
   colour anyone sees, before a byte of CSS has been parsed. Pinned to the
   share card's deep end so the splash, the status bar and the card that gets
   posted are one family. */
const FROM = {
  'index.html': 'PL', 'eflc.html': 'EFLC', 'laliga.html': 'LL', 'today.html': 'ALL'
};
for (const [page, code] of Object.entries(FROM)) {
  const src = read(page);
  const m = src.match(/<meta name="theme-color" content="([^"]*)"/);
  assert.ok(m, `${page} declares no theme-color`);
  const at = share.indexOf('\n    ' + code + ': {');
  const from = share.slice(at, share.indexOf('\n    }', at)).match(/from:\s*'([^']*)'/)[1];
  assert.strictEqual(m[1], from,
    `${page} paints the iOS status bar ${m[1]} while its share card opens on ` +
    `${from} — the installed app and the card it produces are different products`);
}

/* The dot rules must read the tokens, not repeat them. Four hex literals in
   the switcher were the third copy of the palette and the only one that had
   La Liga right — so the desk it pointed at looked like a different product
   from the bar pointing at it. */
for (const [, [mark, cls]] of Object.entries(DESKS)) {
  if (cls === 'lg-all') continue;  /* the combined dot is a gradient of all three */
  const bar = cls.replace('lg-', 'lb-');
  const m = css.match(new RegExp('\\.' + bar + ' \\.lb-dot\\{background:([^}]*)\\}'));
  assert.ok(m, `assets/tw.css has no ".${bar} .lb-dot" rule`);
  assert.strictEqual(m[1].trim(), `var(${mark})`,
    `.${bar} .lb-dot is painted "${m[1].trim()}" rather than var(${mark}) — a ` +
    'literal here is a copy of the palette that no rebrand will ever reach');
}

/* ---- 4: every token a page uses actually exists ------------------------- */

let refs = 0;
const missing = [];
for (const page of Object.keys(PAGES)) {
  const src = read(page);
  /* Uses, not declarations: var(--x) anywhere in the page — inline <style>,
     style="" attributes and the strings the renderers build. */
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    refs++;
    const token = m[1];
    /* var(--x, fallback) carries its own answer and cannot render as nothing. */
    if (m[2] === ',') continue;
    if (token.startsWith('--tw-')) continue;          /* Tailwind's own */
    if (LIGHT.has(token)) continue;
    /* A page may still define non-colour helpers of its own. */
    const inline = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((x) => x[1]).join('\n');
    if (new RegExp('(^|[{;\\s])' + token + '\\s*:', 'm').test(inline)) continue;
    missing.push(`${page}: var(${token})`);
  }
}
assert.deepStrictEqual(missing, [],
  `${missing.length} unfallback-ed var() reference(s) resolve to nothing:\n  ` +
  missing.join('\n  ') + '\nAn undefined custom property is not an error and ' +
  'not a warning — the declaration is simply dropped, so the element renders ' +
  'with no colour at all. This is what happens when a component is carried ' +
  'from the Premier League desk to another one and its token is left behind.');

console.log(
  `check-palette OK: ${LIGHT.size} tokens shared, ${DARK.size} themed dark, ` +
  `${Object.keys(PAGES).length} desks each declaring one league and no palette, ` +
  `${Object.keys(DESKS).length} share themes matching the stylesheet, ` +
  `${refs} var() references all resolvable`);

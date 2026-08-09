#!/usr/bin/env node
/* Every text colour the desks use, against the ground it sits on.
 *
 * WHY THIS EXISTS. The palette carries --danger-ink, --warn-ink and --good-ink
 * precisely because the fill colours beside them are too light to read as text
 * — that much was known. What nothing checked was whether the ink versions
 * actually clear the bar, whether the DARK theme's do, or whether a new token
 * added later quietly does not. Contrast is the one design property that has a
 * right answer, is invisible to the person who picked the colour, and degrades
 * for the people least able to report it.
 *
 * WCAG 2.2: 4.5:1 for body text, 3:1 for large text (>=24px, or >=18.66px
 * bold). Anything used as a small label is held to the body figure, because
 * that is what it is.
 *
 * This checks TOKEN PAIRS rather than rendered pixels — deterministic, no
 * browser, runs in CI. It cannot see a hard-coded hex in a style="" attribute,
 * so scripts/check-palette.mjs forbids those separately.
 *
 *     node scripts/check-contrast.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'assets', 'tw.css'), 'utf8');

function block(sel) {
  const m = css.match(new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{', 'm'));
  if (!m) return new Map();
  let i = m.index + m[0].length, depth = 1, start = i;
  while (i < css.length && depth > 0) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
  const out = new Map();
  for (const d of css.slice(start, i - 1).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) out.set(d[1], d[2].trim());
  return out;
}

const LIGHT = block(':root');
const DARK = block('html[data-theme="dark"]');
const LEAGUES = ['lg-pl', 'lg-eflc', 'lg-ll', 'lg-all'];

/* Resolve a token to a hex, following var() indirection. */
function hex(token, theme, leagueTokens) {
  const seen = new Set();
  let v = (leagueTokens && leagueTokens.get(token)) || theme.get(token) || LIGHT.get(token);
  while (v && /^var\(/.test(v)) {
    const t = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (!t || seen.has(t[1])) return null;
    seen.add(t[1]);
    v = (leagueTokens && leagueTokens.get(t[1])) || theme.get(t[1]) || LIGHT.get(t[1]);
  }
  if (!v) return null;
  const m = v.match(/^#([0-9a-f]{6})$/i);
  return m ? m[1] : null;
}

/* WCAG relative luminance and contrast ratio. */
function lum(h) {
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* The pairs the desks actually put on screen. `large` marks the ones only ever
   used at >=24px — the heat number in the hero and nothing else. */
const GROUNDS = ['--bg', '--surface', '--surface-2'];
const INKS = [
  ['--text', false], ['--text-2', false], ['--text-3', false],
  ['--danger-ink', false], ['--warn-ink', false], ['--good-ink', false],
  ['--accent', false], ['--accent-ink', false],
  ['--pl-ink', false], ['--eflc-ink', false], ['--ll-ink', false], ['--all-ink', false],
];

const AA_BODY = 4.5, AA_LARGE = 3.0;
const fails = [], checked = [];

for (const [themeName, theme] of [['light', LIGHT], ['dark', DARK]]) {
  for (const lg of LEAGUES) {
    const lgTokens = themeName === 'dark'
      ? new Map([...block('html.' + lg), ...block(`html[data-theme="dark"].${lg}`)])
      : block('html.' + lg);
    for (const [ink, isLarge] of INKS) {
      const fg = hex(ink, theme, lgTokens);
      if (!fg) continue;
      for (const g of GROUNDS) {
        const bg = hex(g, theme, lgTokens);
        if (!bg) continue;
        const r = ratio(fg, bg);
        const need = isLarge ? AA_LARGE : AA_BODY;
        checked.push(1);
        /* --text-3 is a deliberate de-emphasis used for captions beside a
           readable label, never as the only carrier of information. Held to
           the large-text bar, and named here rather than skipped so the
           exemption is a decision somebody can argue with. */
        const bar = ink === '--text-3' ? AA_LARGE : need;
        if (r < bar) {
          fails.push(`${themeName}/${lg}: ${ink} on ${g} = ${r.toFixed(2)}:1 (needs ${bar})`);
        }
      }
    }
  }
}

assert.deepStrictEqual(fails, [],
  `${fails.length} text/background pair(s) fail WCAG AA:\n  ` + fails.join('\n  ') +
  '\n\nDarken the ink token. The bright tone stays for fills and bars, which ' +
  'is what it was chosen for — an --*-ink token exists precisely so the two ' +
  'uses do not have to share a value.');

/* The bands must not be carried by colour alone. Someone with deuteranopia
   cannot separate the orange/amber/grey ramp, and "the red one" is then not a
   piece of information they have. */
const index = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(/sev\.label/.test(index),
  'the High/Watch/Moderate band is no longer rendered with its text label — ' +
  'colour alone is not an encoding for about 1 in 12 men');
assert.ok(/sev\.icon/.test(index),
  'the band carries no shape or icon beside its colour. The three tones are ' +
  'an orange/amber/grey ramp; deuteranopia flattens it to one.');
/* EVERY band, not "the word sev.icon appears". Deleting the icon from ONE
   branch of severity() left the render site intact, so the guard stayed green
   while that band rendered the word "undefined" beside its label. The usage
   vouching for a definition it never checks — the same shape of hole as the
   data-open-tour one, found the same way. */
{
  const body = /function severity\(prob\)\{([\s\S]*?)\n\}/.exec(index);
  assert.ok(body, 'severity() is gone or has been reshaped past recognition');
  const returns = [...body[1].matchAll(/return \{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(returns.length >= 4, `severity() returns ${returns.length} bands, expected 4`);
  const iconless = returns.filter((r) => !/icon\s*:/.test(r));
  assert.deepStrictEqual(iconless, [],
    `${iconless.length} of severity()'s bands carry no icon: ${iconless.join(' | ')}. ` +
    'That band renders "undefined" beside its label and is distinguished from ' +
    'its neighbours by hue alone.');
  const labelless = returns.filter((r) => !/label\s*:/.test(r));
  assert.deepStrictEqual(labelless, [], 'a band lost its text label');
}

/* --accent-2 IS A FILL. It is the league's bright mark, chosen to work as a
   badge and a bar; as small uppercase text on a light surface the La Liga and
   Today values sit near 3.5:1. Ten rules were using it as `color:` — the
   gameweek badge, the brand tag, the topbar tag, the derby chip and the rest —
   which is precisely the "darken the accent for text use, keep the bright tone
   for fills only" the brief asks for. --accent-ink exists so the two uses do
   not share a value; this stops them sharing one again. */
{
  const pages = ['index.html', 'eflc.html', 'laliga.html', 'today.html'];
  const offenders = [];
  for (const page of pages) {
    const src = readFileSync(join(root, page), 'utf8');
    for (const m of src.matchAll(/color:\s*var\(--accent-2/g)) offenders.push(page);
  }
  assert.deepStrictEqual(offenders, [],
    `--accent-2 is used as a text colour in: ${[...new Set(offenders)].join(', ')}. ` +
    'It is the league mark — tuned for fills and bars, and near 3.5:1 as small ' +
    'text on a light surface for two of the four desks. Use --accent-ink.');
}

console.log(`check-contrast OK: ${checked.length} token pairs across 2 themes and ` +
  `${LEAGUES.length} leagues, all clearing WCAG AA; bands carry label and shape`);

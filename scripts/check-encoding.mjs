#!/usr/bin/env node
/* No shipped file may carry a double-encoded name.
 *
 * WHAT THIS CATCHES. UTF-8 bytes read as Latin-1, which renders a name as
 * "Dani MartÃ­nez" instead of "Dani Martínez". It reached production on four
 * files and nothing reported it: the page renders, the pricing is unaffected,
 * every guard passes, and the only symptom is a player's name spelled wrong on
 * a desk and on a share card that leaves the site.
 *
 * WHOSE FAULT IT WAS. Not this repository's. scripts/probe-encoding.py asked
 * API-Football on 9 September 2026 and printed the bytes: /players/squads
 * returned "C. Inao OulaÃ¯" as 43 2E 20 49 6E 61 6F 20 4F 75 6C 61 C3 83 C2 AF,
 * which is an i-diaeresis encoded twice, at the wire. harvest_apifootball
 * .unmangle_all now repairs it as the payload is decoded. This guard is the
 * other half: the harvest runs where the API key is, this runs everywhere, so
 * a regression in the repair fails in CI rather than on a reader's screen.
 *
 * TWO STEPS, AND THE SECOND IS WHAT MAKES IT USABLE. The first is a pattern:
 * a character in U+00C0..U+00FF, which is what a UTF-8 lead byte looks like
 * when read as Latin-1, followed by one or more in U+0080..U+00BF, which is
 * what its continuation bytes look like. That pattern alone has false
 * positives. The second step confirms by actually undoing the encoding and
 * checking the result differs, so every hit reported here is real and comes
 * with the correct spelling beside it.
 *
 *     node scripts/check-encoding.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The mojibake signature, as characters rather than bytes: a Latin-1 view of a
   UTF-8 lead byte, then at least one continuation byte. */
const SUSPECT = /[À-ÿ][-¿]+/;

/* Undo one round of UTF-8-read-as-Latin-1, or null when the string is not
   that. Mirrors harvest_apifootball.unmangle exactly, and the mirror is the
   point: if the two ever disagree, one of them is wrong about what a mangled
   string is. */
function repaired(s) {
  const codes = [...s].map((ch) => ch.codePointAt(0));
  /* Latin-1 encodable, or there is nothing to reinterpret. */
  if (codes.some((c) => c > 0xff)) return null;
  let out;
  try {
    out = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codes));
  } catch {
    return null;                       // not valid UTF-8, so not double-encoded
  }
  return out === s ? null : out;       // ASCII decodes to itself: unchanged
}

/* Every string literal in a file, decoded. Reading tokens rather than the
   whole text keeps the report specific: a file name on its own would leave
   somebody grepping a two-megabyte generated file by hand. */
const LITERAL = /"(?:[^"\\]|\\.)*"/g;

function offenders(text) {
  const out = [];
  for (const m of text.match(LITERAL) || []) {
    let val;
    try {
      val = JSON.parse(m);
    } catch {
      continue;                        // not a JSON-shaped literal
    }
    if (typeof val !== 'string' || !SUSPECT.test(val)) continue;
    const fix = repaired(val);
    if (fix) out.push([val, fix]);
  }
  return out;
}

/* WHAT IS SCANNED. Everything generated from a feed, which is where this can
   arrive, plus the pages and the shared modules, where it would arrive as a
   typo. The four desks' datasets are the ones that matter and the ones that
   were wrong, but the transfer feeds carried it too and nobody was looking at
   those, which is the argument for scanning the lot rather than a list. */
const files = [];
const dataDir = join(root, 'data');
for (const f of readdirSync(dataDir).sort()) {
  if (/\.(js|json)$/.test(f)) files.push(join('data', f));
}
for (const f of ['index.html', 'eflc.html', 'laliga.html', 'seriea.html',
                 'today.html', 'data-frame.html']) {
  if (existsSync(join(root, f))) files.push(f);
}
for (const f of readdirSync(join(root, 'assets')).sort()) {
  if (/\.(js|css)$/.test(f)) files.push(join('assets', f));
}

let scanned = 0;
let strings = 0;
const bad = [];
for (const rel of files) {
  const text = readFileSync(join(root, rel), 'utf8');
  scanned += 1;
  strings += (text.match(LITERAL) || []).length;
  for (const [was, fix] of offenders(text)) bad.push({ rel, was, fix });
}

if (bad.length) {
  const lines = bad.slice(0, 20).map(
    (b) => `  ${b.rel}\n      is  ${JSON.stringify(b.was)}\n      want ${JSON.stringify(b.fix)}`);
  assert.fail(
    `${bad.length} double-encoded string(s) in shipped files:\n${lines.join('\n')}\n\n` +
    'These are UTF-8 bytes read as Latin-1. API-Football serves a few names ' +
    'that way and data/harvest_apifootball.py repairs them on arrival in ' +
    'unmangle_all(), so a hit here means either that repair regressed or a ' +
    'new source bypassed _get. Do NOT hand-edit the generated file: it is ' +
    'rewritten by the next refresh and the correction would vanish with it.');
}

console.log(`check-encoding OK: ${scanned} files, ${strings} string literals, ` +
  'no double-encoded names');

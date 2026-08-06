#!/usr/bin/env node
/* Every class the markup emits must have a rule behind it.
 *
 * WHY THIS EXISTS. renderMatchday() was ported from today.html to the two
 * newer desks without the five rules that make it a layout — .row, .teams,
 * .top, .heat, .when — which live in today.html's inline <style> and nowhere
 * else. The markup was correct and completely unstyled: .teams and .top are
 * spans, so with no flex container they flowed inline and ran together. The
 * Championship fixture list read
 *
 *     Charlton Athletic v Derby CountyL. Travis 19% · M. Clarke 17% ...
 *
 * as one wrapping paragraph. .btn.primary went the same way in the same port,
 * so "Share matchday" — marked up as the primary action — rendered as an
 * ordinary outlined button.
 *
 * Nothing failed. A missing CSS rule has no console error, no exception and no
 * failing selector; the page renders, just wrongly, and every existing guard
 * passed because they check behaviour and content rather than appearance. It
 * took a screenshot from a phone to find it. That is the gap this closes.
 *
 * The check is deliberately dumb: collect the classes each page can emit, and
 * assert a rule exists in the CSS that page actually loads (its own inline
 * <style> plus the shared sheet). It cannot prove a page LOOKS right — only
 * that nothing is referencing styling that does not exist. That is the
 * specific failure mode that shipped, and it is worth catching cheaply.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const shared = read('assets/tw.css');

/* Classes that are legitimately unstyled: JS hooks used only as querySelector
   targets, and state flags toggled by script. Each must say why, so this list
   cannot quietly become a dumping ground for the bug it is meant to catch. */
const NO_RULE_NEEDED = new Set([
  'fxref',      // select hook: $$('.fxref') wires the per-fixture referee picker
  'cls',        // not a class — a JS variable interpolated into class="..."
  'c',          // ditto, today.html's per-row builder
  'card',       // index.html: styled by .fx-card/.pk-card variants, never alone
  'val-btn', 'val-odds', 'val-out',   // index.html value-check hooks, script-only
  'linklike', 'pk-status', 'pk-del', 'ref-sel', 'fx-simrow', 'mk-h2h'
]);

const PAGES = ['index.html', 'today.html', 'eflc.html', 'laliga.html'];
let checked = 0;

for (const page of PAGES) {
  const src = read(page);
  /* The CSS this page really loads. Every page links the shared sheet; the
     inline block is what differs, and is where the drift happened. */
  const inline = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const css = inline + '\n' + shared;

  /* Only literal class="..." values — no ${...} or ' + x + ' interpolation,
     which cannot be resolved without running the page. */
  const used = new Set();
  for (const m of src.matchAll(/class="([^"$<>]*)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c && /^[a-zA-Z][\w-]*$/.test(c)) used.add(c);
    }
  }

  const missing = [...used]
    .filter((c) => !NO_RULE_NEEDED.has(c))
    /* A rule for `.foo` — but not a prefix match, or .row would be satisfied
       by .rowgroup and the original bug would still pass. */
    .filter((c) => !new RegExp('\\.' + c.replace(/-/g, '\\-') + '(?![\\w-])').test(css));

  assert.deepStrictEqual(missing, [],
    `${page} emits ${missing.length} class(es) with no CSS rule in its own ` +
    `<style> or assets/tw.css: ${missing.join(', ')}. Either add the rule ` +
    '(shared sheet if more than one page needs it) or, if it is a script-only ' +
    'hook, add it to NO_RULE_NEEDED with a reason.');
  checked += used.size;
}

/* The specific rules whose absence broke the Matchday list. Named explicitly
   because the sweep above only proves SOMETHING matches — these are the ones
   that must be in the SHARED sheet, or the next desk built from this pattern
   inherits the same silent breakage. */
for (const sel of ['#mdList .row', '#mdList .teams', '#mdList .top',
  '#mdList .heat', '#mdList .when', '.btn.primary']) {
  /* Matched as a COMPLETE selector opening a rule — the name, then optional
     whitespace, then `{` or `,`. Not with includes(): "#mdList .row" is a
     substring of "#mdList .rowgroup", so a rename would have satisfied it
     while the layout rule was gone. Requiring the brace also stops
     "#mdList .row:last-child" — a border tweak — from standing in for the
     display:flex rule that actually does the work. Both of those escaped the
     first version of this guard. */
  const decl = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[{,]');
  assert.ok(decl.test(shared),
    `assets/tw.css has no rule opening with "${sel}" — the Matchday fixture ` +
    'list renders as one unstyled paragraph without it, and nothing else in ' +
    'the suite notices');
}

/* .row/.top/.heat are generic. They are scoped to #mdList precisely so that
   fixing two desks cannot restyle a third — index.html styles its own
   class="heat" chip in the fixtures list. */
for (const sel of ['.row', '.teams', '.top', '.heat']) {
  const bare = new RegExp('^\\s*\\' + sel + '\\s*[,{]', 'm');
  assert.ok(!bare.test(shared),
    `assets/tw.css defines "${sel}" unscoped. It must stay under #mdList — ` +
    'index.html uses class="heat" for a fixtures chip and would be restyled.');
}

console.log(`check-styles OK: ${PAGES.length} pages, ${checked} class references, ` +
  'every one backed by a rule; matchday rules present and scoped');

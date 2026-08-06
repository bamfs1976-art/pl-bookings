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

/* ---- crests must degrade, and players must be openable ------------------
 * Reported from an iPad: every club showed the browser's broken-image glyph.
 * The desks emitted a bare <img> with no error handling, so a crest host that
 * does not answer left 400 broken icons in the players table. The fallback is
 * invisible when the host IS answering, which is exactly why it needs a guard
 * — nobody will notice it rotting until the next outage. */
for (const page of ['eflc.html', 'laliga.html']) {
  const src = read(page);
  assert.ok(!/<img class="crest"/.test(src),
    `${page} still emits a bare <img class="crest">. Route it through ` +
    'PLDProfile.crest(club) so a dead image host degrades to a monogram chip ' +
    'instead of the browser broken-image glyph.');
  /* Counted, not merely present. There are four crest sites per desk — two
     club-table cells and both sides of the fixture card — and reverting any
     ONE of them puts broken images back on that view while the other three
     keep the bare-<img> check quiet. A substring test passes a 3-of-4 revert. */
  const calls = (src.match(/PLDProfile\.crest\(/g) || []).length;
  assert.ok(calls >= 4,
    `${page} calls PLDProfile.crest ${calls} time(s); all 4 crest sites must ` +
    'use it (2 club-table cells, 2 fixture-card sides)');
  assert.ok(/PLDProfile\.wire\(\)/.test(src),
    `${page} never calls PLDProfile.wire() — the crest fallback listens for ` +
    'the image error event, so without it the chips never appear');
  assert.ok(/assets\/profile\.js/.test(src), `${page} does not load assets/profile.js`);
  /* The record itself. tr[data-pk] is what the delegated handler looks for. */
  assert.ok(/tr class="rowlink" data-pk=/.test(src),
    `${page} player rows are not openable — no tr.rowlink[data-pk]`);
  assert.ok(/function playerRecord/.test(src) && /function openPlayer/.test(src),
    `${page} is missing the player record builder`);
  /* The star sits inside the row. Without stopPropagation one tap toggles the
     watchlist AND opens the profile, which is how it behaved first time. */
  assert.ok(/e\.stopPropagation\(\)/.test(src),
    `${page} watchlist star does not stop propagation, so tapping it also ` +
    'opens the player record');
}

/* error does not bubble — a delegated listener MUST use capture, or the
   fallback silently never fires and every crest stays broken. */
const prof = read('assets/profile.js');
/* 1200, not 400: the listener body plus its comment is 517 characters, and the
   first bound silently failed the assertion rather than the code. Still bounded
   — an unbounded [\s\S]* would match a `}, true)` anywhere later in the file
   and pass whatever the listener actually does. */
assert.ok(/addEventListener\('error',[\s\S]{0,1200}?\},\s*true\)/.test(prof),
  'assets/profile.js registers the crest error listener without capture. ' +
  'The error event does not bubble; without `true` the handler never runs.');
assert.ok(/crest-failed/.test(prof) && /crest-failed::after/.test(shared),
  'the crest fallback chip is not wired: profile.js must add .crest-failed ' +
  'and tw.css must render its data-mono through ::after');

/* ---- booking points, and the player's face ----------------------------- */
for (const page of ['eflc.html', 'laliga.html']) {
  const src = read(page);
  /* Booking points is the market a bookmaker actually posts for cards. The
     red half must come from the APPOINTED referee where there is one — a
     points market priced off a flat league red rate is not wrong so much as
     pointless, since it would move for no fixture. */
  assert.ok(/C\.bookingPointsMarkets\(/.test(src),
    `${page} does not price booking points`);
  assert.ok(/r\.ref && r\.ref\.red != null/.test(src),
    `${page} prices booking points without using the appointed referee's own ` +
    'red rate, so the market would be identical for every fixture');
  assert.ok(/C\.leagueRedRate\(REFLIST\)/.test(src),
    `${page} has no league red-rate fallback for unappointed fixtures`);
  assert.ok(/function bookingPointsChips/.test(src),
    `${page} computes booking points but never shows them`);
  /* The player's face and availability. Both ride on p.ph / p.inj, which stay
     absent until a refresh — the guard is that the desk READS them, not that
     the shipped data has them yet. */
  assert.ok(/photo: p\.ph \|\| null/.test(src),
    `${page} player record drops the photo the harvest now carries`);
  assert.ok(/injured: p\.inj === true/.test(src),
    `${page} must treat availability as strictly true, so an absent flag ` +
    'reads as "not known" rather than "fit"');
}

/* The face uses the crest's fallback, not a second mechanism. */
assert.ok(/function avatar\(/.test(prof) && /crest-img/.test(prof),
  'assets/profile.js must render the player photo through the same ' +
  'crest-img/crest-failed path as the badge, or a dead photo host produces ' +
  'a broken-image glyph that nothing handles');
assert.ok(/rec\.injured === true/.test(prof),
  'profile.js must show availability only on an explicit true — an absent ' +
  'flag is "not known", and rendering it as fit invents news about a player');

console.log(`check-styles OK: ${PAGES.length} pages, ${checked} class references, ` +
  'every one backed by a rule; matchday scoped; crests degrade; records open');

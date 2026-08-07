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

/* .btn.primary must stay in the SHARED sheet. It was ported to two desks
   without it and "Share matchday" — marked up as the primary action —
   rendered as an ordinary outlined button. */
{
  const decl = new RegExp('\\.btn\\.primary\\s*[{,]');
  assert.ok(decl.test(shared),
    'assets/tw.css has no rule opening with ".btn.primary" — the primary ' +
    'action on both newer desks renders as an ordinary outlined button');
}

/* The Matchday panel lands on the same fixture-card GRID the Premier League
   desk does. It used to be a plain single-column text list carrying the same
   numbers, which is what made the two desks read as different applications.
   Asserted on both the renderer and the grid, because either alone regresses
   silently: cards outside a grid stack one-up, and a grid with the old list
   inside it is still a list. */
for (const page of ['eflc.html', 'laliga.html']) {
  const src = read(page);
  assert.ok(/function fixtureCard\(/.test(src),
    `${page} has no shared fixtureCard() — the Matchday and Fixtures panels ` +
    'must draw the same card rather than two that drift');
  const grids = (src.match(/class="fx-grid"/g) || []).length;
  assert.ok(grids >= 2,
    `${page} wraps ${grids} panel(s) in .fx-grid; both Matchday and Fixtures ` +
    'must use it or one of them stacks single-column');
  /* 2600, measured, not guessed: renderMatchday's body reaches fixtureCard at
     ~2040 characters. A bound set by eye failed the assertion rather than the
     code the first time, which is the second time that has happened in this
     file. Still bounded — unbounded would match a fixtureCard call anywhere
     later in the page and pass whatever renderMatchday actually draws. */
  assert.ok(/renderMatchday[\s\S]{0,2600}?fixtureCard\(/.test(src),
    `${page} renderMatchday does not draw fixture cards — it has regressed ` +
    'to the plain text list the Premier League desk never had');
  /* The old list's classes must not come back with it. */
  assert.ok(!/class="teams"/.test(src) && !/class="row"/.test(src),
    `${page} still emits the retired Matchday list markup`);
}

/* The grid rule itself, not merely the STRING ".fx-grid" somewhere in the
   sheet. Deleting `.fx-grid{display:grid;...}` left `.fx-grid > .fx{...}`
   behind, which kept the class-is-styled sweep quiet while every card stacked
   one-up — the same decoy that let a :last-child border stand in for the
   Matchday list's display:flex. Pin the declaration that does the work. */
assert.ok(/\.fx-grid\s*\{[^}]*display:\s*grid/.test(shared),
  'assets/tw.css has no ".fx-grid{...display:grid...}" rule — the fixture ' +
  'cards stack one per row instead of the grid the Premier League desk uses');
assert.ok(/\.fx-grid\s*\{[^}]*minmax\(330px/.test(shared),
  'the .fx-grid column minimum no longer matches index.html\'s 330px, so the ' +
  'three desks wrap to one column at different widths');

/* minmax(0,1fr), never a bare 1fr, for the side columns inside a card. `1fr`
   is minmax(auto,1fr) and auto floors at min-content, which pushed the page
   27px past the viewport the moment the candidate rows grew a face and a pip
   meter — and Safari answers that by zooming the whole page out. */
/* Checked in the SHARED sheet, which is where .fx-sides now lives. Left
   pointing at the desks' inline CSS this assertion would pass because the rule
   is not there at all — a guard satisfied by absence, which is worse than no
   guard: it reports green on a file it is no longer looking at. */
assert.ok(/\.fx-sides\s*\{/.test(shared), 'assets/tw.css has lost .fx-sides');
assert.ok(!/\.fx-sides\s*\{[^}]*grid-template-columns:\s*1fr 1fr/.test(shared),
  '.fx-sides uses a bare "1fr 1fr", which cannot shrink below its min-content ' +
  'width and overflows the viewport — Safari answers that by zooming out');

/* /today draws the SAME card as the three desks. It is the page most likely
   to fork, because it is the only one that is cross-league and the only one
   that never had the card to begin with — and a fork is how the Matchday
   styles came to exist on one page and neither of the others. */
{
  const t = read('today.html');
  assert.ok(/class="fx-grid"/.test(t),
    'today.html does not use .fx-grid — the combined view has gone back to a ' +
    'text list while the three desks it combines all draw cards');
  assert.ok(/class="fx-cands"/.test(t) && /class="cand"/.test(t),
    'today.html no longer draws the shared candidate rows');
  assert.ok(/assets\/profile\.js/.test(t),
    'today.html does not load profile.js, so its crests cannot degrade');
  assert.ok(/PLDProfile\.crest\(/.test(t), 'today.html emits crests without the shared helper');
}

/* The card CSS lives in the SHARED sheet, not in any page's inline <style>.
   Four pages draw this card; the moment one keeps its own copy they drift. */
for (const sel of ['.fx-teams', '.fx-heat', '.cand', '.cbadge', '.mkts', '.band']) {
  const decl = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[{,]');
  assert.ok(decl.test(shared),
    `assets/tw.css has no "${sel}" rule — the fixture card is drawn by four ` +
    'pages and its styling must be shared, not copied into each');
  for (const page of ['eflc.html', 'laliga.html']) {
    const inline = [...read(page).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    assert.ok(!decl.test(inline),
      `${page} keeps its own "${sel}" rule, which shadows the shared one and ` +
      'is where the copies start to differ');
  }
}

/* The candidate pip meter must stay scoped to .cand. Unscoped it overrode the
   suspension strip's own .pips/.pip — card-shaped counters of real bookings —
   and silently turned them into thin grey rate bars. */
assert.ok(/\.cand \.pip\s*\{/.test(shared),
  'the card pip meter is not scoped to .cand; unscoped it overrides the ' +
  "suspension strip's pips, which are a different thing entirely");

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

/* ---- the smaller parity items ------------------------------------------ */
for (const page of ['eflc.html', 'laliga.html']) {
  const src = read(page);
  /* Notes: offered only where they can be STORED. A textarea with nowhere to
     write to is worse than no textarea — it accepts what you type and forgets
     it, and you find out later. */
  assert.ok(/NOTE_KEY/.test(src) && /onNote:/.test(src),
    `${page} offers no player notes, or offers them with nowhere to store them`);
  assert.ok(/has-note/.test(src),
    `${page} stores notes but does not mark which players have one, so a note ` +
    'on 1 of 974 players is unfindable');
  /* The calendar export needs the RAW kick-off, not the formatted one — an ICS
     DTSTART cannot be parsed back out of "Sat, Aug 15, 05:30 PM". */
  assert.ok(/iso: fx\.d/.test(src),
    `${page} passes only a formatted kick-off to the record, so the calendar ` +
    'export has no parsable start time');
  /* All players: the same rows through a different presentation. If it built
     its own list the two views could disagree about who is in the league. */
  /* The CALL, not the definition. `renderPlayerCards(list)` is also the text of
     `function renderPlayerCards(list) {`, so the obvious assertion is satisfied
     by the function declaring itself while the call site feeds it something
     else entirely — which is exactly what a mutation swapping the argument for
     the unfiltered squad proved. Pin the line inside renderPlayers. */
  assert.ok(/function renderPlayerCards/.test(src),
    `${page} has no card view`);
  assert.ok(/playerView === 'cards'\) renderPlayerCards\(list\);/.test(src),
    `${page} card view is not fed renderPlayers' own filtered list, so the two ` +
    'views can disagree about who is in the league');
  assert.ok(/data-view="cards"/.test(src), `${page} has no All players toggle`);
}

/* Skip link, on every page that has a shell to skip past. */
for (const page of ['eflc.html', 'laliga.html', 'today.html']) {
  const src = read(page);
  assert.ok(/<a href="#main" class="skip">/.test(src), `${page} has no skip link`);
  assert.ok(/id="main"/.test(src), `${page} skip link points at #main, which does not exist`);
}
assert.ok(/\.skip\s*\{[^}]*left:\s*-999px/.test(shared) && /\.skip:focus\s*\{[^}]*left:\s*0/.test(shared),
  'the skip link must be off-screen until focused and on-screen when it is; ' +
  'without the :focus rule it is invisible and useless, and without the ' +
  'off-screen rule it is a permanent banner');

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

/* The ICS builder. CRLF is not a nicety — RFC 5545 requires it and Outlook is
   the client that actually rejects LF. */
assert.ok(/join\('\\r\\n'\)/.test(prof),
  'assets/profile.js builds the calendar file with the wrong line endings; ' +
  'RFC 5545 requires CRLF and Outlook enforces it');
assert.ok(/BEGIN:VALARM/.test(prof), 'the calendar event carries no reminder');

console.log(`check-styles OK: ${PAGES.length} pages, ${checked} class references, ` +
  'every one backed by a rule; matchday scoped; crests degrade; records open');

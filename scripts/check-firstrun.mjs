#!/usr/bin/env node
/* The UX brief's structural claims, pinned. Sections 1, 2, 4, 6 and 7.
 *
 * Named for the first thing it guarded and grown since. What it holds:
 * nothing auto-opens over an unseen page (1); every metric on the fixture card
 * is defined where it appears (2); the gameweek toolbar, the two views and the
 * grid density (4); and the mobile chrome, league labels and live pill (6).
 *
 * TAP TARGETS ARE NOT HERE, deliberately. They are a rendered-geometry
 * question — a 20px checkbox inside a 44px label IS a 44px target, and an
 * invisible ::after hit area either works or is painted under its neighbour —
 * so they are measured in a browser (see the mobile probe in the session
 * scratchpad) rather than asserted against source. A source check would have
 * passed the ::after that did not work.
 *
 * Nothing opens itself over a page the visitor has not seen yet.
 *
 * WHY THIS EXISTS. Three desks each opened a guided tour a few hundred
 * milliseconds after load — index.html on a 900ms timer of its own, the
 * Championship and La Liga desks through PLDTour.maybe() at 600ms. A
 * first-time visitor met a dimmed screen and "Step 1 of 4" before seeing a
 * single number. Worse, the tour scrolls its spotlight target into view, so
 * on a phone the page also arrived scrolled past its own heading: the product
 * was below the fold and an overlay explaining it was on top.
 *
 * None of that threw. It was the intended behaviour of code that read
 * perfectly well, and every guard in this repo passed while it shipped.
 *
 * The tour is worth taking and is still there. It is now pressed, not
 * imposed. What this pins:
 *
 *   1. No page schedules a tour on load.
 *   2. PLDTour.maybe — the old auto-opening entry point — does not open.
 *   3. Every desk that HAS a tour still has a way to reach it, at both
 *      widths: hiding the topbar button on a phone without giving the hint
 *      an offer would make the tour unreachable there, which is a worse bug
 *      than the one being fixed and looks like a fix.
 *
 *     node scripts/check-firstrun.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
/* Comments stripped: this file's own prose names every pattern it forbids, and
   a bare search would be satisfied by the explanation of the bug. */
const codeOnly = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const DESKS_WITH_A_TOUR = ['index.html', 'eflc.html', 'laliga.html'];

/* ---- 1. nothing schedules a tour on load -------------------------------- */
for (const page of DESKS_WITH_A_TOUR) {
  const code = codeOnly(read(page));
  assert.ok(!/PLDTour\s*\.\s*maybe\s*\(/.test(code),
    `${page} calls PLDTour.maybe(), which is the auto-opening entry point. ` +
    'Use PLDTour.offer(steps, key, {button}) and wire a control the visitor presses.');
  /* A timer that reaches a tour starter. Bounded rather than unbounded: an
     open-ended [\s\S]* would match a setTimeout at the top of the file and a
     tourStart 2,000 lines below it and fail on code that is fine. */
  assert.ok(!/setTimeout\([^;]{0,200}?tour(Start|At)\s*\(/i.test(code),
    `${page} starts its tour from a timer. The tour must be pressed, not ` +
    'scheduled — a visitor who has not looked at the page yet has not asked ' +
    'for a walkthrough of it.');
}

/* ---- 2. the shared module does not open on its own ---------------------- */
{
  const tour = codeOnly(read('assets/tour.js'));
  assert.ok(/function offer\s*\(/.test(tour),
    'assets/tour.js has no offer() — the press-to-open entry point is gone');
  /* maybe() must still EXIST (an un-migrated caller must not throw) and must
     not open. Checked on the function body, because a check on the file would
     be satisfied by offer()'s own code sitting elsewhere in it. */
  const body = /function maybe\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/.exec(tour);
  assert.ok(body, 'assets/tour.js no longer defines maybe(); an old caller would throw');
  assert.ok(!/setTimeout/.test(body[1]),
    'PLDTour.maybe still opens the tour on a timer. It is kept only so an ' +
    'un-migrated caller does not throw; it must not seize the screen.');
}

/* ---- 3. the tour is still reachable, at BOTH widths --------------------- */
/* The topbar button is hidden under 560px — six controls do not fit a 390px
   bar; forcing it in wrapped the label to four lines and crushed the brand to
   "B…". So a second, inline offer has to exist, or the tour is unreachable on
   exactly the device most first-time visitors use. */
const css = read('assets/tw.css');
assert.ok(/@media \(max-width:560px\)\{ \.tb-tour\{display:none\} \}/.test(css),
  'assets/tw.css no longer hides .tb-tour on a phone — check the topbar still ' +
  'fits at 390px before removing this');
for (const page of DESKS_WITH_A_TOUR) {
  const src = read(page);
  assert.ok(/id="tourBtn"/.test(src),
    `${page} has no #tourBtn — the desktop way into the tour is gone`);
  /* THE ATTRIBUTE, in markup — not the string. A bare /data-open-tour/ is
     satisfied by the querySelectorAll('[data-open-tour]') that binds it, so
     deleting the attribute off the button left the guard green while the
     control it looks for no longer existed. The wiring vouching for the
     element it cannot find is the same "assertion satisfied by the wrong
     text" that has bitten this repo repeatedly; caught here by mutation, not
     by reading. Anchored on a preceding space so the bracketed selector form
     cannot match. */
  assert.ok(/\sdata-open-tour[\s>=]/.test(src),
    `${page} has no [data-open-tour] control in its markup. The topbar button ` +
    'is hidden below 560px, so without an inline offer the tour cannot be ' +
    'opened on a phone at all — unreachable, which is worse than intrusive.');
  /* WIRED, not merely present. An attribute nothing listens to is a button
     that does nothing, and that is precisely the failure this whole change is
     about: an affordance that looks like it works. */
  assert.ok(/\[data-open-tour\]/.test(codeOnly(src)),
    `${page} emits [data-open-tour] but never binds it — the control renders ` +
    'and does nothing when pressed');
}

/* ---- 4. the first-run copy stays bounded -------------------------------- */
/* Two stacked explainer blocks pushed the gameweek hero below the fold on a
   390px screen. One card replaced them, and the height is the whole point of
   the change — so the collapsed pair must not quietly come back. */
{
  const src = read('index.html');
  assert.ok(!/class="beginner-hint">New here\?/.test(src),
    'index.html has the "New here?" explainer back alongside the intro card — ' +
    'the pair is what pushed the gameweek hero off a 390px screen');
  assert.ok(/id="gwHint"/.test(src) && /data-hint-dismiss/.test(src),
    'index.html intro card is missing, or has no dismiss control');
  assert.ok(/HINT_KEY/.test(src),
    'the hint dismissal is not persisted, so it returns on every visit');
}


/* ---- 5. the jargon is defined where it appears -------------------------- */
/* Section 2 of the UX brief. The market strip shipped EXP CARDS, O3.5, O4.5,
   BTC and H2H 10 with no definition anywhere on the page, and a five-dot
   meter carrying aria-hidden — invisible to a screen reader and a pattern to
   everyone else. */
{
  const src = read('index.html');
  const code = codeOnly(src);
  /* EACH CALL SITE, not "the string appears somewhere". A check for
     /PLDMetric.label(/ passed with the Expected-cards label swapped out for a
     hand-rolled span, because the other four calls satisfied it — one site can
     regress while the guard stays green. Pin the site AND the plain label
     together, so neither can drift without the other. */
  for (const [plain, abbr, site] of [
    ['Expected cards', 'EXP', `PLDMetric.label("Expected cards"`],
    ['3.5+ cards', 'O3.5', `cell("3.5+ cards","O3.5"`],
    ['4.5+ cards', 'O4.5', `cell("4.5+ cards","O4.5"`],
    ['Both teams carded', 'BTC', `cell("Both teams carded","BTC"`],
    ['Last n H2H', 'H2H', 'PLDMetric.label(`Last ${h2h.n} H2H`'],
  ]) {
    assert.ok(code.includes(site),
      `index.html no longer labels the market strip "${plain}" through the ` +
      `shared primitive — the raw "${abbr}" was the label with no definition ` +
      'anywhere on the page. Expected to find: ' + site);
  }
  assert.ok(/PLDMetric\.wire\(\)/.test(code),
    'index.html never calls PLDMetric.wire(), so every metric label renders ' +
    'and does nothing when pressed');
  assert.ok(/assets\/metric\.js/.test(src), 'index.html does not load assets/metric.js');
  /* The meter must not go back to being decoration. */
  assert.ok(/PLDMetric\.confidence\(/.test(code),
    'pipMeter no longer goes through PLDMetric.confidence, so the five dots ' +
    'have lost their aria-label and are decoration again');
  assert.ok(!/class="pips" aria-hidden/.test(code),
    'the confidence meter carries aria-hidden again — to a screen reader it ' +
    'is not there at all');
  /* Model internals stay behind the disclosure, and the disclosure stays shut.
     AUTHOR CSS BEATS UA CSS regardless of specificity, so a bare
     `.fx-simrow{display:...}` re-shows a closed <details> — which it did, and
     moving the declaration between stylesheets did not fix it. */
  assert.ok(/<details class="model-detail">/.test(code),
    'the model internals ("tight 66%", "game state EVE ×0.98") are back on the ' +
    'face of the card rather than behind a disclosure');
  assert.ok(/details\.model-detail:not\(\[open\]\) \.fx-simrow\{display:none\}/.test(read('assets/tw.css')),
    'the collapsed model detail is left to the UA stylesheet to hide. Author ' +
    'CSS outranks UA CSS whatever the specificity, so the .fx-simrow display ' +
    'rule re-shows it and the disclosure renders open while its arrow says shut.');
  assert.ok(/id="legendKey"/.test(src) && /id="legendBtn"/.test(src),
    'the legend is gone — High/Watch/Moderate and the meter are undefined on ' +
    'the page again');
}


/* ---- 6. the gameweek toolbar and the two views -------------------------- */
/* Section 4. Ten near-identical cards and the only control was
   ALL/DEF/MID/FWD, which cannot answer "which of these 200 players is the one
   I want". */
{
  const src = read('index.html');
  const code = codeOnly(src);
  const css = read('assets/tw.css');

  for (const id of ['gwSearch', 'gwSort', 'gwMinP', 'gwTeam', 'gwWatchOnly', 'gwViewSeg']) {
    assert.ok(new RegExp(`id="${id}"`).test(src), `index.html has lost the ${id} control`);
  }
  assert.ok(/\.gwt\{position:sticky/.test(css),
    'the gameweek toolbar is no longer sticky — it scrolls away exactly when ' +
    'you start looking through the fixtures it filters');

  /* ONE filter for both views. Two code paths deciding who is in the gameweek
     is two answers to the same question, and the Cards and Table views would
     disagree about it without anything looking wrong. */
  assert.ok(/function gwFilterCands\(/.test(code), 'the shared candidate filter is gone');
  assert.ok(/gwF\.view==="table"[\s\S]{0,80}gwTableHtml\(/.test(code)
    && /gwFilterCands\(gwCandidates/.test(code),
    'the Table view does not go through gwFilterCands — the two views can now ' +
    'disagree about who is in the gameweek');

  /* A REAL table. It is tabular data; a screen reader should navigate it as
     such, and section 8 of the brief asks for exactly this. */
  assert.ok(/<table class="gw-table">/.test(code), 'the Table view is not a real <table>');
  assert.ok(/<th scope="col"/.test(code), 'the Table view headers carry no scope');
  assert.ok(/aria-sort=/.test(code), 'the Table view never reports its sort to assistive tech');

  /* Density, exactly as specified: 3 at 1440, 2 at ~1100, 1 below 768. */
  assert.ok(/@media \(min-width:1101px\)\{ \.fx-grid\{grid-template-columns:repeat\(3,/.test(css),
    'the desktop grid is no longer capped at three columns — auto-fill gave ' +
    'four dense near-identical cards abreast at 1440px');
  assert.ok(/@media \(max-width:767px\)\{ \.fx-grid\{grid-template-columns:1fr\}/.test(css),
    'the grid no longer drops to one column on a phone');

  /* The collapse needs something to collapse. The first cut targeted .fx-body
     when the card had no such wrapper, so the rule matched nothing and a
     "collapsed" card rendered in full. */
  assert.ok(/<div class="fx-body">/.test(code),
    'the fixture card has no .fx-body wrapper, so the collapse rule matches ' +
    'nothing and a folded card renders in full');
  assert.ok(/\.fx-card\.collapsed \.fx-body/.test(css), 'nothing hides a collapsed card body');

  /* "Show 35 more" must say whether any of the 35 are worth it. */
  assert.ok(/above Watch/.test(code),
    'the show-more button no longer says how many hidden candidates clear the ' +
    'Watch band — the only way to answer "is this worth expanding" is to expand it');

  /* A filter that empties the grid must narrow it, not leave empty cards. */
  assert.ok(/gwFiltering\(\)[\s\S]{0,200}fx\.filter\(/.test(code),
    'filtering no longer narrows the fixture list, so searching one club ' +
    'leaves the other nine on screen as empty cards');
}

/* ---- 7. mobile: chrome that moves, labels that survive, targets ---------- */
/* Section 6. Measured at 390x844 before any of this: topbar 60 + league bar 45
   + bottom nav 66 = 171px of permanent chrome, a fifth of the screen; the
   league bar abbreviating "La Liga" and "Today" to fit — the two desks the
   switcher exists to expose being the two that lost their names; and 40
   interactive elements under 44px. */
{
  const src = read('index.html');
  const code = codeOnly(src);
  const css = read('assets/tw.css');

  assert.ok(/html\.nav-hidden \.topbar\{transform:translateY\(-100%\)\}/.test(css),
    'the topbar no longer collapses on scroll — 171px of permanent chrome on ' +
    'an 844px screen is a fifth of it');
  assert.ok(/nav-hidden/.test(code),
    'nothing toggles nav-hidden, so the collapse rule can never fire');
  /* Back at the top, always. A header that can be left stranded off-screen is
     worse than one that never moves. */
  assert.ok(/y<=0[\s\S]{0,80}remove\("nav-hidden"\)/.test(code),
    'the topbar is not restored at scroll position 0 — it can be left ' +
    'stranded off-screen with no way to bring it back');

  /* Full labels. The abbreviation swap is what hid two desks' names. */
  assert.ok(/@media \(max-width:560px\)\{\s*\.lb-full\{display:inline\}/.test(css),
    'the league bar abbreviates again below 560px, which is where "La Liga" ' +
    'and "Today" lose their names — the two desks the bar exists to expose');
  assert.ok(/\.leaguebar-in\{scroll-snap-type:x/.test(css),
    'the league bar scrolls without snapping, so a half-cut tab is a resting state');
  assert.ok(/aria-current="page"[\s\S]{0,120}scrollIntoView/.test(code),
    'the current desk is not scrolled into view — on a narrow screen the one ' +
    'item that must never be hidden can start off the right-hand edge');

  /* The live pill is a control, not a caption. */
  /* BOTH BRANCHES. The pill is built by a ternary — live/scheduled, and
     offline — and a check for the string was satisfied by whichever branch I
     had not just broken. That is the fourth time in this brief that a presence
     check has been answered by a second copy of the thing it was looking for,
     so this parses the expression and asserts on every branch in it. */
  const pill = /const pill=LIVE([\s\S]*?);\n/.exec(code);
  assert.ok(pill, 'the live pill is no longer built where renderGwHero builds it');
  const branches = pill[1].split('    :');
  assert.ok(branches.length >= 2, 'the live pill lost its offline branch');
  branches.forEach((br, i) => {
    assert.ok(/<button class="live-pill/.test(br),
      `live-pill branch ${i + 1} is not a <button> — it reports state and offers ` +
      'no way to retry, and on a phone the browser chrome is then the only recourse');
    assert.ok(/id="gwRefresh"/.test(br),
      `live-pill branch ${i + 1} carries no id, so the retry is never wired on ` +
      'that path — the control renders and does nothing');
  });
  assert.ok(/\$\("gwRefresh"\)/.test(code), 'nothing wires the retry button');
}

/* ---- 8. the watchlist teaches, follows, and sign-in states its price ----- */
/* Section 7. The panel hid itself entirely when nothing was starred, so the
   one feature that makes the desk yours was invisible to everybody who had not
   already found it — you had to discover the star to discover the watchlist,
   and the watchlist is the reason to press the star. */
{
  const src = read('index.html');
  const code = codeOnly(src);
  const css = read('assets/tw.css');

  assert.ok(!/id="gwWatchWrap"[^>]*\shidden/.test(src),
    'the watchlist panel hides itself when empty again — the feature is then ' +
    'invisible to everyone who has not already found it');
  assert.ok(/class="wl-empty"/.test(code) && /Star a player/.test(code),
    'the empty watchlist no longer explains what starring does');
  assert.ok(/wl-egrow/.test(code), 'the empty state shows no worked example');
  /* Local first, sync second. */
  /* IN THE DIALOG, at the point of action — not merely somewhere on the page.
     The phrase is also the topbar button's title, so a search of the whole
     file was answered by the tooltip while the dialog said nothing. Fifth
     time a presence check has been satisfied by a second copy; pin the block
     that has to carry it. */
  /* 1400, measured: the block runs 966 characters from the heading to the
     reset link, and a bound set by eye failed the assertion rather than the
     code — which is the third time that has happened in this repo. Still
     bounded, because an unbounded [\s\S]* would match the heading here and an
     acctReset anywhere later and vouch for whatever sits between them. */
  const signin = /id="acctTitle"[^']*Sign in to sync[\s\S]{0,1400}?acctReset/.exec(code);
  assert.ok(signin, 'the signed-out account dialog is gone or has been reshaped');
  assert.ok(/Sync your watchlist and tracker across devices/.test(signin[0]),
    'the sign-in dialog no longer states what an account buys. It was a button ' +
    'labelled "Sign in" and nothing else, so the only way to find out was to ' +
    'do it — and everything already works signed out.');
  assert.ok(/works signed out|already works/.test(signin[0]),
    'the dialog does not say the desk works without an account, so sign-in ' +
    'reads as a gate rather than as sync');
  /* The rail and the sheet: two placements, one panel, no DOM move. */
  /* 900, measured against the block as it stands with its comments; bounded
     rather than open so a stray @media and a stray #gwWatchWrap 300 lines
     apart cannot vouch for each other. */
  const rail = /@media \(min-width:1280px\)\{[\s\S]{0,900}?#gwWatchWrap\{([^}]*)\}/.exec(css);
  assert.ok(rail && /grid-column:2/.test(rail[1]),
    'the desktop watchlist rail is gone — comparing a starred player against ' +
    'the round means scrolling away from what you are comparing him to');
  /* THE ROW SPAN, NOT JUST THE COLUMN. `grid-row:1/-1` names the last line of
     the EXPLICIT grid, and #panel-gameweek declares no rows — so -1 resolved
     to line 1, the rail sat in row 1 alone, and row 1 grew to the height of
     the watchlist card. ~170px of dead white space under the page heading on
     every desktop load, from a rule that reads exactly right. */
  assert.ok(!/grid-row:\s*1\s*\/\s*-1/.test(rail[1]),
    'the watchlist rail is back to grid-row:1/-1. This grid has no explicit ' +
    'rows, so -1 resolves to line 1 and the rail occupies row 1 only — which ' +
    'stretches row 1 to the rail\'s height and leaves a column of blank space ' +
    'under the page heading.');
  assert.ok(/grid-row:\s*1\s*\/\s*span\s*\d+/.test(rail[1]),
    'the watchlist rail no longer spans the implicit rows, so it cannot ' +
    'follow the fixture list it exists to sit beside');
  assert.ok(/#gwWatchWrap\.sheet\{position:fixed/.test(css),
    'the mobile watchlist sheet is gone');
  /* The desk's record leads the Tracker. */
  assert.ok(/id="trackerRecord"/.test(src) && /function modelRecordHtml/.test(code),
    "the Tracker no longer leads with the model's own hit rate — a research " +
    "tool's credibility rests on visible calibration, and it opened with the " +
    "user's staking figures");
  assert.ok(/aria-label="Hit rate over the last/.test(code),
    'the track-record sparkline carries no text alternative, so to a screen ' +
    'reader the headline claim has no evidence behind it');
}
/* ---- 9. states, semantics and the focus ring ---------------------------- */
/* Section 8. Everything here is asserted on PARSED STRUCTURE rather than on a
   string appearing somewhere in the file. Five separate guards in this repo
   have now been satisfied by the wrong copy of the text they were looking for
   — a binder vouching for the thing it binds, a render site vouching for a
   definition, a tooltip vouching for a dialog — so a presence check is not an
   assertion here, it is a coincidence waiting to happen. */
{
  const src = read('index.html');
  const code = codeOnly(src);
  const css = read('assets/tw.css');
  /* Body of a top-level function declaration, brace-matched. */
  const fnBody = (name, text) => {
    const m = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{').exec(text);
    if (!m) return null;
    let i = m.index + m[0].length, depth = 1, start = i;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '{') depth++; else if (c === '}') depth--;
      i++;
    }
    return depth === 0 ? text.slice(start, i - 1) : null;
  };

  /* LOADING, ERROR AND EMPTY ARE THREE STATES. renderGameweek() paints the
     landing view before loadLive() has been called, so the single `if(!LIVE)`
     branch it shipped with greeted every cold load with a feed-unreachable
     message for a request that had not been made yet. */
  const rg = fnBody('renderGameweek', code);
  assert.ok(rg, 'renderGameweek() is gone or has been reshaped past recognition');
  const notLive = /if\(!LIVE\)\{([\s\S]*?)\n  \}/.exec(rg);
  assert.ok(notLive, 'renderGameweek() no longer has a no-data branch');
  assert.ok(/LIVE_STATE\s*===?\s*"loading"/.test(notLive[1]),
    'the no-data branch does not distinguish LOADING from FAILED. It runs at ' +
    'boot, before the feed has been asked, so without that test a cold load ' +
    'reports an error for a request that has not been made.');
  assert.ok(/gwSkeletonHtml\(\)/.test(notLive[1]) && /gwErrorHtml\(\)/.test(notLive[1]),
    'the loading and error branches do not render their own states');
  /* The two state renderers, checked on their own bodies — a search of the
     file would be answered by this branch calling them. */
  const skel = fnBody('gwSkeletonHtml', code);
  assert.ok(skel && /skel-card/.test(skel), 'the fixture skeleton renders no cards');
  assert.ok(/aria-hidden="true"/.test(skel),
    'the skeleton bones are exposed to a screen reader, which reads eighteen ' +
    'empty boxes rather than "loading"');
  assert.ok(/role="status"/.test(skel),
    'the skeleton announces nothing — a screen reader gets silence while the ' +
    'page waits');
  const errHtml = fnBody('gwErrorHtml', code);
  assert.ok(errHtml, 'gwErrorHtml() is gone');
  assert.ok(/id="gwRetry"/.test(errHtml),
    'the error state offers no retry, so a whole-page reload is the only way ' +
    'back — and on a phone that also discards the tab');
  assert.ok(/role="alert"/.test(errHtml), 'the error state is not announced');
  assert.ok(/\$\("gwRetry"\)/.test(notLive[1]) && /loadLive\(\)/.test(notLive[1]),
    'nothing wires the retry button to the load path — the control renders ' +
    'and does nothing, which is the exact bug the live pill had');
  /* LIVE_STATE must be MOVED, not merely declared. A tri-state that never
     leaves "loading" is a spinner that never stops. */
  const load = fnBody('loadLive', code);
  assert.ok(load, 'loadLive() is gone or has been reshaped');
  assert.ok(/LIVE_STATE\s*=\s*"error"/.test(load) && /LIVE_STATE\s*=\s*"ok"/.test(load),
    'loadLive() no longer moves LIVE_STATE off "loading" on both paths — the ' +
    'skeleton then animates forever whatever the feed does');

  /* The empty week says how long the wait is. */
  assert.ok(/starts in/.test(rg) && /nextGwStartsIn\(\)/.test(rg),
    '"No fixtures" no longer says when the next gameweek starts. Between ' +
    'rounds the feed knows the next deadline exactly and the reader was told ' +
    'to "check back", which could mean hours or a fortnight.');
  const nx = fnBody('nextGwStartsIn', code);
  assert.ok(nx && /deadline_time/.test(nx),
    'the countdown is not read off the feed\'s own deadline, so it can ' +
    'disagree with the one the hero counts down to');

  /* ONE <h1> PER ROUTE. Seven routes shared one document whose only h1 was the
     wordmark in the topbar, so every route's heading outline began at h2 with
     nothing above it. */
  const h1s = [...src.matchAll(/<h1[^>]*>/g)];
  const pages = [...src.matchAll(/<section id="(panel-[\w-]+)" class="page/g)].map((m) => m[1]);
  assert.equal(h1s.length, pages.length,
    `${h1s.length} <h1> for ${pages.length} routes. Each route owns exactly ` +
    'one; a second visible h1 means two routes are on screen at once.');
  for (const p of pages) {
    const sec = new RegExp('<section id="' + p + '" class="page[\\s\\S]*?<div class="page-head">\\s*<h1>').exec(src);
    assert.ok(sec, `${p} does not open with an <h1> in its page head`);
  }
  assert.ok(!/<h1 class="tb-name"/.test(src),
    'the topbar wordmark is an <h1> again. It is the site name, not the ' +
    "page's heading, and it made every route's real heading an h2 under it.");
  /* THE ROUTING RULE. `.page{display:none}` / `.page.active{display:block}` is
     how this desk routes, and an ID selector setting `display` outranks both.
     The desktop watchlist rail shipped as a bare `#panel-gameweek{display:grid}`
     and kept the entire Gameweek route on screen underneath every other route
     above 1280px — two of everything, including two <h1>s, and nothing threw. */
  for (const m of css.matchAll(/#(panel-[\w-]+)([^{,]*)\{([^}]*display:[^;}]*)/g)) {
    assert.ok(/\.active/.test(m[2]),
      `assets/tw.css sets display on #${m[1]} without requiring .active ` +
      `("${m[0].slice(0, 60)}…"). That outranks .page{display:none} and leaves ` +
      'the route on screen underneath whichever route the reader has opened.');
  }

  /* PER-ROUTE TITLE AND DESCRIPTION, one per panel, none repeated. */
  const meta = fnBody('applyRouteMeta', code);
  assert.ok(meta && /document\.title/.test(meta) && /meta\[name="description"\]/.test(meta),
    'applyRouteMeta() no longer sets both the title and the description');
  const open = fnBody('openPanel', code);
  assert.ok(open && /applyRouteMeta\(/.test(open),
    'openPanel() does not apply the route meta, so seven routes share one tab ' +
    'title, one bookmark and one share preview');
  const rm = /const ROUTE_META=\{([\s\S]*?)\n\};/.exec(code);
  assert.ok(rm, 'ROUTE_META is gone or has been reshaped');
  const keys = [...rm[1].matchAll(/"(panel-[\w-]+)":/g)].map((m) => m[1]);
  const missing = pages.filter((p) => !keys.includes(p));
  assert.deepStrictEqual(missing, [],
    `${missing.join(', ')} have no title or description of their own — those ` +
    'routes keep whichever route was open before them.');
  const titles = [...rm[1].matchAll(/t:"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(titles).size, titles.length,
    'two routes share a title: ' + titles.join(' | '));
  assert.equal(titles.length, keys.length, 'a ROUTE_META entry has no title');

  /* THE FIXTURE CARD IS A SECTION WITH A HEADING. Ten fixtures were ten
     sibling divs, so the heading outline of the busiest page on the desk had
     one entry and jumping between matches by heading was impossible. */
  const card = fnBody('fixtureCardHtml', code);
  assert.ok(card, 'fixtureCardHtml() is gone or has been reshaped');
  assert.ok(/<section class="fx-card/.test(card) && /<\/section>/.test(card),
    'the fixture card is not a <section>, so it carries no landmark for its ' +
    'own heading to name');
  assert.ok(/aria-labelledby="fxh-\$\{f\.id\}"/.test(card) && /<h2 class="visually-hidden" id="fxh-\$\{f\.id\}"/.test(card),
    'the fixture card has no <h2> of its own, or the heading no longer names ' +
    'the section');
  /* The heading must sit OUTSIDE the disclosure control: a heading nested in
     role="button" is consumed into the button's accessible name and exposed
     as no heading at all — which reads as a fix and is not one. */
  const headingAt = card.indexOf('<h2 class="visually-hidden"');
  const buttonAt = card.indexOf('role="button"');
  assert.ok(headingAt >= 0 && buttonAt >= 0 && headingAt < buttonAt,
    "the fixture card's heading has moved inside the role=\"button\" header. " +
    "A heading in a button's subtree is folded into the button's name and " +
    'exposed as no heading, so the outline is back to one entry.');

  /* PLAYER ROWS ARE A REAL LIST. Forty sibling buttons is forty controls with
     no "list of 12" to say how far the thing goes. */
  assert.ok(/<ul class="cand-list"/.test(card) && /<li>'\+candRowHtml/.test(card),
    'the fixture card\'s candidates are no longer a list, or the rows are no ' +
    'longer its items');
  assert.ok(/\.cand-list\{/.test(css), '.cand-list has no rule behind it');
  const wl = fnBody('renderWatchDash', code);
  assert.ok(wl && /<ul class="cand-list"/.test(wl) && /<li><button class="wl-row"/.test(wl),
    'the watchlist rows are no longer a list');

  /* EVERY EMITTED <img> RESERVES ITS BOX. */
  const imgs = [...code.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 2, `only ${imgs.length} <img> found — the renderers moved`);
  const unsized = imgs.filter((i) => !/\bwidth="/.test(i) || !/\bheight="/.test(i));
  assert.deepStrictEqual(unsized, [],
    `${unsized.length} <img> ship without explicit width and height: ` +
    unsized.join(' | '));
  const unlazy = imgs.filter((i) => !/loading="lazy"/.test(i));
  assert.deepStrictEqual(unlazy, [], 'an <img> is no longer lazy-loaded');

  /* THE FOCUS RING IS OPAQUE. A 45% tint of the accent composites to about
     2.7:1 over white on the Premier League desk — under the 3:1 WCAG 2.2 asks
     of a focus indicator, on all four desks in both themes. The ring is the
     only thing telling a keyboard user where they are. */
  const rings = [...css.matchAll(/--ring:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(rings.length >= 4, 'the --ring token has disappeared');
  const tinted = rings.filter((v) => /rgba?\(|color-mix|\/\s*\.?\d/.test(v));
  assert.deepStrictEqual(tinted, [],
    `${tinted.length} --ring value(s) are translucent (${tinted.join(', ')}). ` +
    'A tinted ring reads under 3:1 against the surfaces it lands on, which is ' +
    'the one place on the page contrast cannot be spent on softness.');
  assert.ok(/\.seg-view button\[aria-selected="true"\]:focus-visible\{outline-color:var\(--on-accent\)/.test(css),
    'the selected segmented tab rings in the accent over an accent fill — an ' +
    'invisible focus ring on the one control that is filled with the ring colour');

  /* DYNAMIC CHANGES ARE ANNOUNCED. The tween tells the eye what a referee pick
     moved; without this a screen reader gets nine numbers silently becoming
     nine different numbers. */
  const ann = fnBody('announce', code);
  assert.ok(ann && /aria-live"?,\s*"polite"/.test(ann) && /role"?,\s*"status"/.test(ann),
    'announce() no longer creates a polite status region');
  assert.ok(/textContent\s*=\s*""/.test(ann),
    'announce() does not clear the region first, so setting the same message ' +
    'twice — the same official picked on two cards — is not a change and is ' +
    'therefore silent');
  const applyRef = fnBody('applyRef', code);
  assert.ok(applyRef && /refAnnounce\(/.test(applyRef),
    'a referee pick repaints the card and announces nothing');
  const refAnn = fnBody('refAnnounce', code);
  assert.ok(refAnn && /m\.heat/.test(refAnn) && /m\.rf/.test(refAnn),
    'the referee announcement no longer carries the new expected total and ' +
    'multiplier — "referee changed" is not what the reader asked the control');
  assert.ok(/id="gwCount"[^>]*aria-live="polite"/.test(src),
    'the filter result count is no longer announced, so a filter that empties ' +
    'the page is silent');
}

/* ---- 10. the copy: what this is, and the footer in three named groups --- */
/* Section 9. The framing ran to 108 words of 0.78rem print at the FOOT of the
   gameweek panel, under ten fixture cards, and the age notice was a separate
   paragraph in the footer below that — two halves of one answer, neither
   anywhere a first-time reader would meet them.
 *
 * And the notice only existed on ONE desk. The Championship, La Liga and Today
 * footers were a single sentence ending "Not betting advice": no age
 * statement, no helpline, nothing a reader in trouble could reach. Every check
 * in this repo passed while three of four desks shipped without one, because
 * every check asked about the desk it was pointed at. */
{
  const ALL = ['index.html', 'eflc.html', 'laliga.html', 'today.html'];
  const GROUPS = ['About &amp; method', 'Data sources', 'Responsible gambling'];
  /* Every one of these must sit INSIDE the responsible-gambling group. A search
     of the page would be answered by the sidebar's own BeGambleAware link on
     index.html — the sixth time a presence check in this repo would have been
     satisfied by a second copy of the text it was looking for. */
  const HELP = [
    ['begambleaware.org', 'BeGambleAware'],
    ['gamcare.org.uk', 'GamCare'],
    ['gamstop.co.uk', 'GAMSTOP'],
    ['tel:08088020133', 'the National Gambling Helpline number']
  ];
  for (const page of ALL) {
    const src = read(page);
    const foot = /<footer[^>]*>([\s\S]*?)<\/footer>/.exec(src);
    assert.ok(foot, `${page} has no <footer>`);
    const cols = [...foot[1].matchAll(/<section class="ft-col"([^>]*)>([\s\S]*?)<\/section>/g)];
    assert.equal(cols.length, 3,
      `${page}'s footer has ${cols.length} groups, expected 3. It was one grey ` +
      'paragraph doing three unrelated jobs with the age notice in the middle.');
    const heads = cols.map((c) => (/<h2 class="ft-h"[^>]*>([\s\S]*?)<\/h2>/.exec(c[2]) || [, ''])[1].trim());
    assert.deepStrictEqual(heads, GROUPS,
      `${page}'s footer groups are ${JSON.stringify(heads)} — the three are ` +
      'named identically across the four desks so a reader who learns one ' +
      'footer has learned all of them');
    for (const c of cols) {
      const id = (/aria-labelledby="([^"]+)"/.exec(c[1]) || [])[1];
      assert.ok(id, `${page} has a footer group with no aria-labelledby`);
      assert.ok(new RegExp('id="' + id + '"').test(foot[1]),
        `${page}'s footer group points at #${id}, which is not in the footer`);
    }
    const rg = cols[2][2];
    assert.ok(/class="rg-18"/.test(rg),
      `${page}'s responsible-gambling group carries no 18+ mark`);
    assert.ok(/Over 18s only/.test(rg),
      `${page} no longer states the age restriction in words. The 18+ badge is ` +
      'aria-hidden, so without the sentence there is no age statement at all ' +
      'for anyone not looking at it.');
    for (const [needle, what] of HELP) {
      assert.ok(rg.includes(needle),
        `${page}'s responsible-gambling group is missing ${what}. It must be in ` +
        'THAT group — a check on the whole page is answered by the sidebar ' +
        'notice on index.html and by nothing at all on the other three.');
    }
    /* The three sibling desks shipped for months with "Not betting advice" and
       no notice. That sentence is not a substitute and must not read as one. */
    assert.ok(!/Not betting advice\.\s*<\/footer>/.test(src),
      `${page}'s footer is back to a bare "Not betting advice" line`);
  }

  /* THE FRAMING, SHORTENED AND PAIRED WITH THE AGE NOTICE, ABOVE THE FIXTURES. */
  {
    const src = read('index.html');
    const gw = /<section id="panel-gameweek"[\s\S]*?<\/section>/.exec(src);
    assert.ok(gw, 'the gameweek panel is gone or has been reshaped');
    const dl = /<p class="deskline">([\s\S]*?)<\/p>/.exec(gw[0]);
    assert.ok(dl, 'the gameweek route carries no framing line');
    assert.ok(gw[0].indexOf('class="deskline"') < gw[0].indexOf('id="gwFixtures"'),
      'the framing line has moved below the fixture list, which is where it ' +
      'was buried in the first place');
    assert.ok(/research screen, not a tip/i.test(dl[1]),
      'the framing no longer says what kind of number this is');
    assert.ok(/rg-18/.test(dl[1]) && /Over 18s only|18\+/i.test(dl[1]) && /begambleaware/i.test(dl[1]),
      'the framing is no longer paired with the age notice and a help link — ' +
      'they answer the same question and were in two different places');
    /* SHORTENED IS A LENGTH CLAIM, so it is measured. The trailing paragraph
       ran to 108 words repeating the legend key, the metric popovers and the
       Guide; what is left is the one instruction the page cannot demonstrate.
       50 is a ceiling with room, not the current count.

       EVERYTHING BELOW THE FIXTURE LIST, SUMMED — not the last paragraph. The
       first version of this took the last <p> in the panel and was satisfied
       by re-adding the whole 108-word block ABOVE the short one: the guard
       measured a paragraph while the wall of print it exists to prevent sat
       directly beside it. Seventh time an assertion here has been answered by
       the wrong copy of the text, and the only reason this one was caught is
       that it was mutated rather than read. */
    const below = gw[0].slice(gw[0].indexOf('id="gwFixtures"'));
    const paras = [...below.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
    assert.ok(paras.length, 'the note under the fixture list is gone entirely');
    const words = paras.reduce((n, p) =>
      n + p[1].replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length, 0);
    assert.ok(words <= 50,
      `there are ${words} words of prose below the fixture list across ` +
      `${paras.length} paragraph(s). It is 0.78rem print under ten fixture ` +
      'cards; anything that long there is not read, and every clause it used ' +
      'to carry is now on a control the reader can reach.');
  }
}

/* ---- 11. the Premier League route opens on numbers, like its siblings --- */
/* The Championship and La Liga desks open on a title, a lead and a wall of
   stat tiles. This one opened on four stacked boxes of chrome — a framing
   note, a hint, a referee panel and a legend bar — with the hero SIXTH and the
   first fixture card 1,609px down a 390px screen against their 887px. */
{
  const src = read('index.html');
  const code = codeOnly(src);
  const css = read('assets/tw.css');
  const gw = /<section id="panel-gameweek"[\s\S]*?<\/section>/.exec(src)[0];
  const at = (needle) => gw.indexOf(needle);

  /* THE ORDER. The hero and the round's numbers come before the framing, the
     hint and the controls — everything is still here, below the thing the
     page is for. */
  const order = ['id="gwHero"', 'id="gwStats"', 'class="deskline"', 'class="gw-controls"', 'id="gwFixtures"'];
  for (let i = 0; i < order.length; i++) {
    assert.ok(at(order[i]) >= 0, `${order[i]} is gone from the gameweek route`);
    if (i) assert.ok(at(order[i - 1]) < at(order[i]),
      `${order[i - 1]} now sits below ${order[i]}. The route opens on its ` +
      'numbers; chrome goes under them.');
  }
  /* THE SHARED TILES, not a private copy. .stats/.stat are the primitive both
     sibling desks already open with. */
  assert.ok(/class="stats" id="gwStats"/.test(gw), 'the gameweek stat strip is gone');
  /* The open paren is load-bearing: a bare /function renderGwStats/ is matched
     by `function renderGwStatsX(`, so renaming the definition out from under
     its call sites left the guard green while the route threw on every render.
     Eighth time a check here has been satisfied by text that was not the thing
     it names. Both directions pinned — the definition AND the two calls. */
  assert.ok(/function renderGwStats\s*\(/.test(code),
    'the stat strip renderer is gone or has been renamed away from its calls');
  /* IN renderGameweek's BODY, not anywhere in the file. `/renderGwStats\(fx\)/`
     over the whole source is matched by the DEFINITION — `function
     renderGwStats(fx){` — so deleting the only call left the guard green while
     the strip went stale on every render. The definition vouching for its own
     call site; same hole, one line further on. */
  {
    const m = /function renderGameweek\(\)\{/.exec(code);
    assert.ok(m, 'renderGameweek() is gone');
    let i = m.index + m[0].length, depth = 1;
    const start = i;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === '{') depth++; else if (c === '}') depth--;
      i++;
    }
    const body = code.slice(start, i - 1);
    assert.ok(/renderGwStats\(fx\)/.test(body),
      'renderGameweek() never fills the stat strip, so the round\'s numbers ' +
      'are whatever the last render left there');
    assert.ok(/renderGwStats\(null\)/.test(body),
      'the no-data path never clears the stat strip, so a failed refresh ' +
      'leaves the previous gameweek\'s figures on screen as if they were live');
  }
  assert.ok(/^\.stats\{/m.test(css) && /^\.stat\{/m.test(css),
    'the shared .stats/.stat tiles have gone from tw.css — the Premier League ' +
    'strip would then be styled by nothing and the siblings by nothing');

  /* ONE control row, not two stacked bordered bars. */
  assert.ok(/<div class="gw-controls">[\s\S]{0,900}?id="legendBtn"/.test(gw),
    'the Legend button has left the referee control row — two full-width bars ' +
    'stacked is what .gw-controls exists to replace');
  assert.ok(/\.gw-controls \.ref-global\{flex:1 1 300px/.test(css),
    'the referee panel is back to sizing on its own content, which pushes the ' +
    'Legend button onto a second row — the stacked bars again, in a wrapper');

  /* THE PHONE'S FILTER DISCLOSURE, and specifically NOT a <details>. */
  assert.ok(!/<details class="gwt-filters"/.test(src),
    'the filter row is back inside a <details>. Chromium hides a closed ' +
    "<details>'s content through content-visibility on ::details-content, " +
    'which no author display rule can override — so the desktop lost the ' +
    'position, min-chance, team and watchlist filters entirely while the CSS ' +
    'read exactly right.');
  assert.ok(/id="gwFiltersBtn"[\s\S]{0,200}?aria-controls="gwFilters"/.test(src),
    'the phone filter toggle is gone or no longer names what it controls');
  assert.ok(/class="gwt-row" id="gwFilters"/.test(src),
    'the second filter row has lost the id its toggle points at');
  assert.ok(/\$\("gwFiltersBtn"\)/.test(code),
    'the filter toggle is never wired — it renders and does nothing');
  assert.ok(/matchMedia\("\(max-width:560px\)"\)/.test(code),
    'the filter toggle no longer checks the width, so either the desktop ' +
    'hides its filters or the phone shows all of them');
  /* THE COUNT SURVIVES THE COLLAPSE. It is the answer to whatever the filters
     did, so it must not be inside the thing they hide. */
  assert.ok(at('id="gwCount"') > at('id="gwFilters"'),
    'the result count has moved inside the collapsible filter row — collapsing ' +
    'the filters would then hide the one line saying what they left');
}

console.log(`check-firstrun OK: ${DESKS_WITH_A_TOUR.length} desks, none auto-opens, ` +
  'all reachable at both widths, intro card bounded, jargon defined, ' +
  'toolbar sticky, both views on one filter, mobile chrome yields, ' +
  'watchlist teaches and follows, three load states distinct, one h1 per ' +
  'route with its own title, fixtures are sections and candidates are lists, ' +
  'focus rings opaque, referee simulation announced, four footers in three ' +
  'named groups each carrying the age notice and the helplines, and the ' +
  'Premier League route opening on its numbers like its siblings');

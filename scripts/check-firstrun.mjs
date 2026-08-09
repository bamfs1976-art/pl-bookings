#!/usr/bin/env node
/* The UX brief's structural claims, pinned. Sections 1, 2 and 4.
 *
 * Named for the first thing it guarded and grown since. What it holds:
 * nothing auto-opens over an unseen page (1); every metric on the fixture card
 * is defined where it appears (2); the gameweek toolbar, the two views and the
 * grid density (4).
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
console.log(`check-firstrun OK: ${DESKS_WITH_A_TOUR.length} desks, none auto-opens, ` +
  'all reachable at both widths, intro card bounded, jargon defined, ' +
  'toolbar sticky, both views on one filter');

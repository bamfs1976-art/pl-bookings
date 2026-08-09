#!/usr/bin/env node
/* Nothing opens itself over a page the visitor has not seen yet.
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

console.log(`check-firstrun OK: ${DESKS_WITH_A_TOUR.length} desks, none auto-opens, ` +
  'all reachable at both widths, intro card bounded and dismissible');

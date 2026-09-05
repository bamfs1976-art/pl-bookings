#!/usr/bin/env node
/* A BENCHED PLAYER NEVER SHOWS A PERCENTAGE. That is the whole guard.
 *
 * Once both team sheets are published and matched, a player named on the
 * bench is not going to play ninety minutes, and the number this desk
 * computed for him is a forecast of something that will not happen. Printed
 * beside a starter's it invites a comparison between a forecast and a
 * fiction, and — because the desk's own standing rule is "no pick before the
 * lineup is confirmed" — it does that at exactly the moment a reader is most
 * likely to act on it.
 *
 * THE HARDER HALF IS THE NEGATIVE, and it is the one that would be quietly
 * got wrong. isStarting answers true, false or NULL, and null means the sheet
 * has not landed or would not read. Written as `if (!xi)` — which is what
 * anybody reaches for — the price disappears from every player in every
 * fixture with no team sheet, which is most of them, most of the time. So the
 * three-way answer is exercised here across all three states rather than the
 * two anybody thinks about.
 *
 * THE THIRD STATE MUST ALSO BE VISIBLE. A sheet that arrived and would not
 * join a squad is a broken name-match on a named fixture, fixable today. If
 * it renders as "lineups pending" it looks exactly like a fixture nobody has
 * announced and it sits there for the rest of the season, because nothing on
 * any page ever says otherwise. So pending and unresolved are pinned to
 * different words AND different classes, on every desk.
 *
 * WHY THE DESKS ARE CHECKED BY SOURCE. The behaviour above is asserted for
 * real, by running assets/core.js. What the four single-file apps cannot be
 * asserted on without a browser is that they ROUTE through it — so each is
 * checked for the call, and for the absence of the pattern it replaced.
 *
 *     node scripts/check-lineup-ui.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = require(join(root, 'assets', 'core.js'));
const read = (f) => readFileSync(join(root, f), 'utf8');
const DESKS = ['index.html', 'eflc.html', 'laliga.html', 'today.html'];

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- a fixture, three ways ---------------------------------------------- */
const ELEVEN = ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six',
                'G Seven', 'H Eight', 'I Nine', 'J Ten', 'K Eleven'];
const BENCH = ['L Twelve', 'M Thirteen', 'N Fourteen'];
const SQUAD = { ARS: ELEVEN.concat(BENCH), CHE: ELEVEN.concat(BENCH) };
const XI = (start, sub) => ({ start: start.slice(), sub: sub.slice() });
const SHEET = { 100: { ARS: XI(ELEVEN, BENCH), CHE: XI(ELEVEN, BENCH) } };
/* CHE's first starter is a name no squad carries, so the sheet is there and
   will not read — the third state, and the one this guard exists for. */
const BROKEN = { 100: { ARS: XI(ELEVEN, BENCH),
                        CHE: XI(['Nobody At All'].concat(ELEVEN.slice(1)), BENCH) } };

const confirmed = C.lineupState(SHEET, 100, SQUAD);
const pending = C.lineupState({}, 100, SQUAD);
const unresolved = C.lineupState(BROKEN, 100, SQUAD);
ok(confirmed.state === 'confirmed' && pending.state === 'pending'
  && unresolved.state === 'unresolved', 'the three states no longer resolve as expected');

/* ---- 1. the bench loses its number, and only the bench ------------------ */
/* Exhaustive over the probability range rather than at one value: a guard
   that only tries 0.5 passes a branch keyed on the number itself. */
for (let i = 0; i <= 100; i++) {
  const prob = i / 100;
  const sub = C.candLineup(confirmed, 'ARS', 'L Twelve', prob);
  assert.strictEqual(sub.showProb, false,
    `a benched player would show ${(prob * 100).toFixed(0)}% on a confirmed sheet`);
  assert.strictEqual(sub.prob, null,
    'a benched player still carries a probability for a caller to print');

  const starter = C.candLineup(confirmed, 'ARS', 'A One', prob);
  assert.strictEqual(starter.showProb, true, 'a starter lost his percentage');
  assert.strictEqual(starter.prob, prob, 'a starter\'s percentage was altered');

  /* THE NEGATIVE, at every value. `if (!xi)` here would strip the price off
     every player in every fixture with no sheet — most of a round, most of
     the time — and it is the shape anybody writing this reaches for first. */
  for (const [name, st] of [['pending', pending], ['unresolved', unresolved]]) {
    for (const who of ['A One', 'L Twelve']) {
      const c = C.candLineup(st, 'ARS', who, prob);
      assert.strictEqual(c.xi, null, `${name}: isStarting must answer null, not a boolean`);
      assert.strictEqual(c.showProb, true,
        `${name}: ${who} lost his percentage on a fixture with no readable sheet`);
      assert.strictEqual(c.prob, prob, `${name}: ${who}'s percentage was altered`);
    }
  }
}
checks += 4;

/* An unknown club is unknown, not benched — a join that misses a short code
   must not silently withdraw every price on that side. */
ok(C.candLineup(confirmed, 'ZZZ', 'A One', 0.4).showProb === true,
  'an unrecognised club is treated as benched');

/* ---- 2. starters rise, and nothing moves before the sheets land --------- */
const rows = [
  { c: 'ARS', n: 'L Twelve', prob: 0.91 },      // benched, and top of the ranking
  { c: 'CHE', n: 'A One', prob: 0.55 },
  { c: 'ARS', n: 'B Two', prob: 0.44 },
  { c: 'CHE', n: 'M Thirteen', prob: 0.40 }     // benched
];
const pick = (r) => ({ club: r.c, name: r.n });
const ranked = C.rankByLineup(confirmed, rows, pick);
assert.deepStrictEqual(ranked.map((o) => o.row.n), ['A One', 'B Two', 'L Twelve', 'M Thirteen'],
  'starters must precede the bench, and probability order must survive inside each group');
checks++;
/* Every starter before every non-starter, asserted as the property rather
   than as this one arrangement. */
const flags = ranked.map((o) => o.xi === true);
ok(flags.lastIndexOf(true) < flags.indexOf(false) || flags.indexOf(false) < 0,
  'a benched row appears above a starting one');

for (const [name, st] of [['pending', pending], ['unresolved', unresolved], ['null', null]]) {
  const out = C.rankByLineup(st, rows, pick);
  assert.deepStrictEqual(out.map((o) => o.row.n), rows.map((r) => r.n),
    `${name}: the candidate order moved on a fixture with no confirmed sheet`);
  assert.deepStrictEqual(out.map((o) => o.xi), [null, null, null, null],
    `${name}: rows were flagged as benched without a confirmed sheet`);
  checks += 2;
}

/* ---- 3. pending and unresolved are different sentences ------------------ */
const nP = C.lineupNotice(pending), nU = C.lineupNotice(unresolved);
ok(nP && nU, 'lineupNotice went silent on a fixture with no confirmed sheet');
ok(nP.text !== nU.text,
  `"pending" and "unresolved" print the same words (${nP.text}) — a broken name `
  + 'join would be indistinguishable from a fixture nobody has announced');
ok(nP.tone !== nU.tone, 'the two states share a tone, so they would share a style');
ok(nU.title.includes('CHE'),
  'the unresolved notice does not name the side whose sheet would not read, which is '
  + 'the first thing anybody fixing the join needs');
ok(C.lineupNotice(confirmed) === null, 'a confirmed fixture still carries a caveat');

/* ---- 4. every desk routes through it ------------------------------------ */
for (const f of DESKS) {
  const page = read(f);
  ok(/\.candLineup\(/.test(page),
    `${f} never calls PLDCore.candLineup, so its candidate rows decide for themselves `
    + 'whether a benched player keeps his percentage');
  ok(/\.rankByLineup\(/.test(page),
    `${f} never calls PLDCore.rankByLineup, so a benched candidate can outrank a starter`);
  ok(/\.lineupNotice\(/.test(page),
    `${f} never calls PLDCore.lineupNotice, so it cannot be telling pending from unresolved`);
  /* THE TWO CLASSES, BOTH PRESENT. A desk that renders only one of them has
     collapsed the states back into a boolean somewhere in its own code. */
  ok(page.includes('xi-pending') || /xi-' \+ n\.tone|xi-\$\{note\.tone\}/.test(page),
    `${f} has no way to render the pending state`);
  ok(/xi-unresolved|xi-' \+ n\.tone|xi-\$\{note\.tone\}/.test(page),
    `${f} has no way to render the unresolved state`);
  ok(/cand-benched/.test(page), `${f} never marks a benched row`);
  ok(/cand-bench["'\s]/.test(page),
    `${f} never renders the bench cell that stands in for the percentage`);
}

/* ---- 5. and the stylesheet tells them apart ----------------------------- */
const css = read('assets/tw.css');
for (const cls of ['.cand-benched', '.cand-bench', '.xi-note', '.xi-pending',
                   '.xi-ok', '.xi-unresolved']) {
  ok(css.includes(cls), `assets/tw.css no longer styles ${cls}`);
}
/* Not merely present — DIFFERENT. Two rules with the same declarations would
   pass a presence check and put a broken join and a normal wait side by side
   in the same grey. */
const ruleFor = (sel) => {
  const m = new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1].replace(/\s+/g, '') : null;
};
const rP = ruleFor('.xi-pending'), rU = ruleFor('.xi-unresolved');
ok(rP && rU && rP !== rU,
  '.xi-pending and .xi-unresolved carry identical declarations, so a sheet the desk '
  + 'could not read looks exactly like one that has not been published');

/* ---- 6. the share card drops the bench rather than greying it ----------- */
/* A card is the one artefact that leaves the site and cannot be corrected
   after it does, and an image has no room to explain a dimmed row. */
const idx = read('index.html');
ok(/startingCands\(/.test(idx),
  'index.html no longer filters the confirmed bench out of its exports and totals');
ok(/exportFixturePNG[\s\S]{0,900}startingCands\(/.test(idx),
  'the match share card does not drop benched candidates, so a percentage against a '
  + 'player known not to be starting can leave the site');

/* ---- 7. a pick logged before the sheet is marked as one ----------------- */
ok(/pickXiState\(/.test(idx) && /xi:pickXiState\(/.test(idx),
  'index.html no longer records the team-sheet state when a pick is logged — and it '
  + 'cannot be recovered later, because by Saturday evening every sheet is confirmed');
ok(/preLineupTag\(/.test(idx) && /pre-lineup/.test(idx),
  'the tracker no longer marks a pick made before the lineup was confirmed');
ok(/p\.xi!=="pending"&&p\.xi!=="unresolved"/.test(idx.replace(/\s+/g, '')) ||
   /xi!=="pending"[\s\S]{0,40}xi!=="unresolved"/.test(idx),
  'the pre-lineup tag no longer distinguishes the two pre-lineup states from the rest');

console.log(`check-lineup-ui OK: the bench loses its percentage and only the bench, `
  + `starters outrank it, pending and unresolved read differently on all `
  + `${DESKS.length} desks (${checks} checks)`);

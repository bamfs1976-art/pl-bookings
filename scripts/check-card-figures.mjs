#!/usr/bin/env node
// The number on a fixture card, and the referee behind it.
//
// TWO DESKS PRINTED DIFFERENT NUMBERS FOR THE SAME MATCH. Fulham v Chelsea
// read 4.9 on the Premier League desk and 3.9 on the combined day view, and
// the Premier League card showed 4.9 in its header directly above a strip
// whose first cell, "Expected cards", said 3.9.
//
// They were two different quantities wearing one name:
//
//   BOOKING HEAT     last season's club form — the home side's home
//                    cards-against plus the away side's away cards-against,
//                    scaled by the referee and a derby boost. A RANKING.
//   EXPECTED CARDS   this model's output — every rated available player's own
//                    chance of a booking, added up. A FORECAST.
//
// Heat still orders the fixture list, which is a decision with a backtest
// behind it. What must never happen again is a figure LABELLED expected cards
// being fed by heat — which is what the card header, the accessible heading,
// the share text, the round total and the live pace denominator were all
// doing. The live one was not cosmetic: it divided actual cards by heat, so a
// game exactly on forecast read as comfortably under it.
//
// And the referee: /today priced from its own data file only, so an official
// assigned by hand on a league desk — the entire point of that control, since
// PGMOL publish after the desks ship — never reached the combined view. Part 2
// RUNS that resolution rather than reading it for a pattern.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const today = readFileSync(join(root, 'today.html'), 'utf8');
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

/* ---- 1. nothing labelled "expected cards" is fed by heat --------------- */
{
  /* fixtureMeta is the one place a card's figures are computed, so it is the
     one place they can be kept from drifting. It must carry the priced board. */
  const meta = index.match(/return\s*\{f,h,a,ref,rf,derby,base,heat,cls,lbl,sim[^}]*\}/);
  ok(meta, 'fixtureMeta still returns its meta object');
  ok(/\bboard\b/.test(meta[0]), 'fixtureMeta carries the priced board');
  ok(/\bexpected\b/.test(meta[0]), 'and the expected-cards figure taken from it');

  /* THE DEAD SORT. The toolbar offers "most cards coming", and it compared
     mx.board.expected against a meta that never had a board — so every
     comparison was -1 against -1 and the option did nothing at all. It is
     only alive because fixtureMeta now provides what it reads. */
  const expSort = index.match(/gwF\.sort==="exp"[\s\S]{0,160}/);
  ok(expSort, 'the expected-cards sort is still there');
  ok(/mx&&mx\.board/.test(expSort[0]) && /my&&my\.board/.test(expSort[0]),
    'and reads the board fixtureMeta provides');

  /* The header badge. It sat above the strip printing a different quantity
     under no label; it now shows what the strip's first cell shows. */
  const badge = index.match(/const heatBadge=[\s\S]{0,900}?heatbar-n[^\n]*\n/);
  ok(badge, 'the header badge is still built');
  ok(/\bshown\b/.test(badge[0]), 'the badge renders the shared figure');
  ok(!/heatbar-n[^>]*>\$\{heat\.toFixed/.test(badge[0]),
    'and NOT heat — that is the mislabelling this guard exists for');
  ok(/const shown=\(expected!=null\)\?expected:heat;/.test(index),
    'the shared figure is expected cards, falling back to heat only when the board cannot price');

  /* Every other place that says "expected cards" or "cards". */
  ok(/\$\{shown\.toFixed\(1\)\} expected cards<\/h2>/.test(index),
    'the accessible heading states the model figure, not the ranking');
  ok(/Expected cards \$\{\(m\.expected!=null\?m\.expected:m\.heat\)\.toFixed\(1\)\}/.test(index),
    'the share text states the model figure');
  ok(/gw-hero-heat">\$\{\(m\.expected!=null\?m\.expected:m\.heat\)\.toFixed\(1\)\}<\/span> cards/.test(index),
    'the hero states the model figure');
  ok(/heat\+=\(m\.expected!=null\?m\.expected:m\.heat\);/.test(index),
    "the round's \"cards expected\" tile sums the model figure");
  ok(/const exp=\(M\.expected!=null\)\?M\.expected:M\.heat;/.test(index),
    'and the live pace divides by the forecast, not by the ranking');

  /* Heat is not removed — it still orders the list, which is the one job the
     backtest gave it. A guard that drove heat out entirely would be changing
     the product, not protecting it. */
  ok(/function sortFixturesByHeat/.test(index) && /mp\?mp\.heat:-1/.test(index),
    'booking heat still orders the fixture list');
}

/* ---- 2. a hand-picked referee reaches the combined view ---------------- *
 * RUN, not read. The precedence is the Premier League desk's own: "a hand
 * pick always wins ... not an override of one somebody has."
 */
{
  const src = today.match(/var HAND_REF_STORES = \{[\s\S]*?function refNameFor\(L, fx\) \{[\s\S]*?\n  \}/);
  ok(src, 'the referee resolution is extractable');

  const store = {};
  const ctx = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    Object,
    JSON,
  };
  const PL = { code: 'PL', refBy: { 'J. Brooks': { n: 'J. Brooks', ypg: 4.2 } } };
  const LL = { code: 'LL', refBy: { 'J. Alberola Rojas': { n: 'J. Alberola Rojas', ypg: 5.1 } } };

  /* A pick on each desk, in each desk's own key shape. */
  store.pl_desk_refs_v1 = JSON.stringify({ '2026-27|12345': 'J. Brooks' });
  store.laliga_desk_refs_v1 = JSON.stringify({ 777: 'J. Alberola Rojas' });
  vm.createContext(ctx);
  vm.runInContext(src[0] + '\n;globalThis.__refNameFor=refNameFor;', ctx);
  const refNameFor = ctx.__refNameFor;

  ok(refNameFor(PL, { id: 12345, ref: null }) === 'J. Brooks',
    'a Premier League hand pick reaches the combined view');
  ok(refNameFor(PL, { id: 12345, ref: 'A. Taylor' }) === 'J. Brooks',
    'and beats the published appointment, as the owning desk documents');
  ok(refNameFor(LL, { id: 777, ref: null }) === 'J. Alberola Rojas',
    'a La Liga pick reaches it too, on that desk’s own key shape');
  ok(refNameFor(PL, { id: 999, ref: 'A. Taylor' }) === 'A. Taylor',
    'an unpicked fixture still prices on its appointment');
  ok(refNameFor(PL, { id: 999, ref: null }) === null,
    'and one with neither prices with no referee at all, rather than a guess');

  /* A store outlives a season. A name this league does not know is not a
     referee, and must fall back rather than price the match with nothing. */
  store.pl_desk_refs_v1 = JSON.stringify({ '2026-27|12345': 'Somebody Retired' });
  vm.runInContext(src[0] + '\n;globalThis.__refNameFor=refNameFor;', ctx);
  ok(ctx.__refNameFor(PL, { id: 12345, ref: 'A. Taylor' }) === 'A. Taylor',
    'a stale pick falls back to the appointment');

  /* The season namespace is load-bearing: last season's pick must not price
     this season's fixture just because the id was reused. */
  store.pl_desk_refs_v1 = JSON.stringify({ '2025-26|12345': 'J. Brooks' });
  vm.runInContext(src[0] + '\n;globalThis.__refNameFor=refNameFor;', ctx);
  ok(ctx.__refNameFor(PL, { id: 12345, ref: null }) === null,
    'a pick from another season does not leak into this one');

  /* Read-only. The combined view shows three leagues; writing there would let
     one desk quietly rewrite another desk's assignment. */
  ok(!/HAND_REFS\[[^\]]*\]\[[^\]]*\]\s*=/.test(today) && !/setItem\(\s*HAND_REF_STORES/.test(today),
    'and the combined view never writes an assignment back');
}

console.log(`check-card-figures OK: ${checks} checks — one quantity behind every `
  + 'figure labelled expected cards, heat still ordering the list, and a hand-picked '
  + 'referee reaching the combined view on each desk’s own key shape');

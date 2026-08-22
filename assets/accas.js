/* Combinations: how a list of legs becomes a double and a treble.
 *
 * A STANDALONE FILE, AND A SMALL ONE, because it is the rule three renderers
 * needed and each had written its own. Before this existed the same handful of
 * lines lived in assets/share.js (accaStrip) and TWICE inline in index.html —
 * the same-match builder and the cross-match builder — and only one of the
 * three carried the de-duplication that keeps a player out of his own combo.
 * The other two were correct only because their inputs happened to hold one
 * leg per player; the moment a caller passed a list drawn across dates, the
 * rule they were missing was the one that mattered.
 *
 * That is the failure this repository keeps paying for, and it is why the
 * fourth caller — the /accas page, which renders these as HTML rather than as
 * pixels on a share card — is a call rather than a copy.
 *
 * WHAT IT DOES NOT DO. No pricing, no odds, no card rates. Pricing belongs to
 * PLDCore.accaPrice, which every desk already uses and which knows about the
 * bookmaker margin; a second opinion about what a treble pays is exactly the
 * disagreement this file exists to prevent.
 */
(function (root) {
  'use strict';

  /* THE MOST LEGS A COMBO TAKES. Three, and not a preference: it is the shape
     the share cards have always drawn and the shape scripts/accas.mjs logs and
     settles, so a fourth leg here would silently make the app disagree with
     its own performance record. */
  const MAX_LEGS = 3;

  /* WHO A LEG IS ABOUT, for the purpose of "not twice".
     Player legs carry name and club; match legs carry a fixture and a market.
     A caller with neither gets object identity, which never merges two legs —
     the safe direction, since failing to combine costs a row and wrongly
     combining prices one event as two. */
  function identify(leg) {
    if (!leg || typeof leg !== 'object') return leg;
    /* The share cards' own leg shape. */
    if (leg.name != null || leg.club != null) return 'p:' + leg.name + '|' + leg.club;
    /* THE SHIPPED PLAYER ROW, which is what the desks pass: every dataset in
       data/ spells a player {c: club, n: name, ...} and the canvas builders
       hand those straight in. Recognised here rather than left to each caller
       to describe, because a caller that forgets falls through to object
       identity and silently stops de-duplicating — which is the failure this
       file was extracted to end, not one to re-introduce a level down. */
    if (leg.n != null && leg.c != null) return 'p:' + leg.n + '|' + leg.c;
    if (leg.id != null && leg.market != null) return 'm:' + leg.id + '|' + leg.market;
    if (leg.id != null) return 'f:' + leg.id;
    return leg;
  }

  /* Distinct legs, in the order given, at most MAX_LEGS of them.
   *
   * DE-DUPLICATED BEFORE THE CUT, NEVER AFTER, and the difference is not
   * cosmetic. Slicing to three first and de-duplicating the slice is what the
   * calendar share card did: its four hottest legs were the same player four
   * times, which collapsed to one, and the card printed "not enough rated
   * players for a combo" over a list of eight rated fixtures. Callers pass the
   * whole list and the cut happens here.
   */
  function distinct(legs, identity) {
    const id = typeof identity === 'function' ? identity : identify;
    const seen = new Set();
    const out = [];
    for (const leg of (legs || [])) {
      if (!leg) continue;
      const key = id(leg);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(leg);
      if (out.length === MAX_LEGS) break;
    }
    return out;
  }

  /* The combos a list of legs supports, longest last: [] for fewer than two
     distinct legs, a DOUBLE for two, a DOUBLE and a TREBLE for three or more.
     An empty array is the honest answer to "one rated player" — a single
     dressed as an acca is the page lying about what it is showing. */
  function comboRows(legs, opts) {
    const picked = distinct(legs, opts && opts.identity);
    const rows = [];
    if (picked.length >= 2) rows.push({ tag: 'DOUBLE', legs: picked.slice(0, 2) });
    if (picked.length >= 3) rows.push({ tag: 'TREBLE', legs: picked.slice(0, 3) });
    return rows;
  }

  /* A combo's price, delegated. `prob` reads each leg's probability — legs
     spell it `prob` or `p` depending on which renderer built them — and the
     rest is PLDCore's, margin and all.

     RETURNS NULL rather than guessing when PLDCore is absent or a leg carries
     no usable probability. A combo shown without a price is a row a reader can
     still check; a combo shown with a made-up one is not. */
  function priceCombo(legs, margin, core) {
    const C = core || root.PLDCore
      || (typeof require === 'function' ? require('./core.js') : null);
    if (!C || typeof C.accaPrice !== 'function') return null;
    const ps = (legs || []).map((l) => {
      const v = Number(l && (l.prob != null ? l.prob : l.p));
      return isFinite(v) && v > 0 && v < 1 ? v : null;
    });
    if (!ps.length || ps.some((p) => p == null)) return null;
    return C.accaPrice(ps, margin);
  }

  const api = { MAX_LEGS, identify, distinct, comboRows, priceCombo };
  root.PLDAccas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

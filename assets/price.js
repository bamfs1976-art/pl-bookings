/* Price check — paste a bookmaker's odds, see the edge.
 *
 * THE GAP THIS CLOSES. assets/core.js has carried impliedProb, marketProb,
 * marketProbDeVig, fairOdds, edgePct and valuePoint for as long as the desk
 * has existed, and there was nowhere on any page to type a price into. The
 * whole apparatus for judging whether a market is worth taking was reachable
 * only from a console. So a reader with a strong model number and a bookmaker
 * tab open had to do the arithmetic in their head, which is exactly the sum
 * people get wrong in the direction that costs money.
 *
 * WHAT IT SAYS, AND WHAT IT REFUSES TO SAY. Three numbers, from
 * PLDCore.valuePoint:
 *
 *   the bookmaker's implied probability, as priced;
 *   the same with the card-market margin stripped out (his real opinion);
 *   the edge, if the model is right.
 *
 * And it distinguishes BEATING THE PRICE from merely beating the de-vigged
 * price. A model that reads higher than the fair probability but lower than
 * the priced one is a disagreement that does not pay, and a display that
 * showed a cheerful green number there would be lying about the only thing
 * that matters. That case gets its own words: "inside the margin".
 *
 * NOTHING LEAVES THE BROWSER AND NOTHING IS STORED. A price is true for
 * minutes. Persisting it would mean showing a stale edge tomorrow against a
 * price that has moved, which is worse than showing none — so this is
 * in-memory for the session, deliberately.
 *
 * THE INPUT MUST NOT LOSE FOCUS. The desks redraw their grids with innerHTML,
 * so a keystroke that triggered a re-render would blur the field mid-number.
 * This updates only its own output node and never asks for a redraw.
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var pct = function (p) { return (p * 100).toFixed(1) + '%'; };

  /* Decimal odds only, and only sane ones. 1.0 is not a price, and a "price"
     of 500 on a player being booked is a typo — reading either as real would
     print an edge of several thousand per cent and look like a find. */
  function parseOdds(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(',', '.');
    if (!s) return null;
    /* Fractional, because that is how a British book writes it. */
    var frac = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
    var v = frac ? (Number(frac[1]) / Number(frac[2])) + 1 : Number(s);
    if (!isFinite(v) || v <= 1.01 || v > 200) return null;
    return v;
  }

  function create(opts) {
    var o = opts || {};
    var C = o.core || root.PLDCore;
    var prices = {};                 /* session only, by design */

    function verdict(prob, odds) {
      if (!C || typeof C.valuePoint !== 'function') return null;
      return C.valuePoint(prob, odds, o.margin);
    }

    var api = {
      parseOdds: parseOdds,
      get: function (key) { return prices[String(key)] == null ? null : prices[String(key)]; },
      set: function (key, odds) {
        var v = parseOdds(odds);
        if (v == null) delete prices[String(key)]; else prices[String(key)] = v;
        return v;
      },
      count: function () { return Object.keys(prices).length; },

      /* The words for one priced player. Returns '' when there is no usable
         price — an empty field says nothing rather than "0% edge". */
      readout: function (prob, odds) {
        var v = parseOdds(odds);
        if (v == null || prob == null) return '';
        var r = verdict(prob, v);
        if (!r) return '';
        var edge = r.edge == null ? null : r.edge;
        var head = r.beatsPrice
          ? 'Value +' + edge.toFixed(1) + '%'
          : (r.insideMargin ? 'Inside the margin' : 'No value ' + edge.toFixed(1) + '%');
        return head
          + ' · model ' + pct(r.model)
          + ' · priced ' + pct(r.market)
          + ' · fair ' + pct(r.fair);
      },

      cls: function (prob, odds) {
        var v = parseOdds(odds);
        if (v == null || prob == null) return '';
        var r = verdict(prob, v);
        if (!r) return '';
        return r.beatsPrice ? 'px-good' : (r.insideMargin ? 'px-mid' : 'px-bad');
      },

      /* One row of the price-check block. The output is a live region so the
         edge is announced as it is typed, and it is linked to the input by
         aria-describedby so the field is not just an unlabelled box. */
      row: function (key, label, prob) {
        var k = esc(String(key));
        var held = api.get(key);
        return '<div class="px-row">'
          + '<span class="px-name">' + esc(label) + '</span>'
          + '<span class="px-model">' + (prob == null ? '—' : pct(prob)) + '</span>'
          + '<input class="px-in" type="text" inputmode="decimal" autocomplete="off"'
          + ' data-price="' + k + '" data-prob="' + (prob == null ? '' : prob) + '"'
          + ' value="' + (held == null ? '' : esc(held)) + '"'
          + ' placeholder="odds" aria-label="Bookmaker odds for ' + esc(label) + '"'
          + ' aria-describedby="pxo-' + k + '">'
          + '<span class="px-out ' + esc(api.cls(prob, held)) + '" id="pxo-' + k + '"'
          + ' role="status">' + esc(api.readout(prob, held)) + '</span>'
          + '</div>';
      },

      block: function (rows) {
        if (!rows || !rows.length) return '';
        return '<details class="px-block"><summary>Price check</summary>'
          + '<div class="px-head"><span>Player</span><span>Model</span><span>Your price</span><span>Verdict</span></div>'
          + rows.map(function (r) { return api.row(r.key, r.label, r.prob); }).join('')
          + '<p class="px-note">Decimal or fractional. The fair price strips the '
          + 'card-market margin out of the bookmaker’s number; value means the '
          + 'model beats the price you were actually offered.</p>'
          + '</details>';
      },

      /* Delegated, and it updates ONLY the output beside the field it was
         typed into — no redraw, or the field would lose focus mid-number. */
      wire: function (host) {
        if (!host || host._priceWired) return;
        host._priceWired = true;
        host.addEventListener('input', function (e) {
          var el = e.target;
          if (!el || !el.getAttribute || el.getAttribute('data-price') == null) return;
          var key = el.getAttribute('data-price');
          var prob = parseFloat(el.getAttribute('data-prob'));
          api.set(key, el.value);
          var out = host.querySelector('#pxo-' + cssEscape(key));
          if (!out) return;
          out.textContent = api.readout(isFinite(prob) ? prob : null, el.value);
          out.className = 'px-out ' + api.cls(isFinite(prob) ? prob : null, el.value);
        });
      }
    };
    return api;
  }

  /* Ids are built from fixture ids and indices, but escaping them keeps a
     selector safe whatever a caller passes. */
  function cssEscape(s) {
    if (root.CSS && typeof root.CSS.escape === 'function') return root.CSS.escape(s);
    return String(s).replace(/[^\w-]/g, '\\$&');
  }

  root.PLDPrice = { create: create, parseOdds: parseOdds };
}(typeof window !== 'undefined' ? window : globalThis));

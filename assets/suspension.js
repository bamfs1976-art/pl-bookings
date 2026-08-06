/* The suspension watch, for every desk.
 *
 * Two countries, two genuinely different rules, one implementation — because
 * the difference is easy to get backwards and the failure is silent in both
 * directions.
 *
 *   England (Premier League, Championship). A CUMULATIVE ladder with
 *   escalating bans, each rung gated by the club's match number: five
 *   cautions by the 19th league game is one match, ten by the 32nd (PL) or
 *   37th (EFLC) is TWO, fifteen at any point is three. The count does not
 *   reset when a ban is served, and a gate that has passed kills its rung for
 *   the season.
 *
 *   Spain (La Liga). A REPEATING cycle of five with no gate and no
 *   escalation: one match every time, then the counter restarts.
 *
 * Applying England's ladder to Spain invents bans nobody serves; applying
 * Spain's cycle to England forgives a player who has already used his 5- and
 * 10-rungs. Neither shows up as an error. So the rule is not written here at
 * all — it is shipped in each dataset as SUSPENSION, generated from
 * data/leagues.py, and this file only computes with it.
 *
 * THE FIELD IS `sc`, NEVER `yc`. `yc` is last season's total; `sc` is this
 * season's. In Spain accumulation does not carry between seasons, and in
 * England the ladder counts the current season only, so `yc` is the wrong
 * number in both. `sc` is null until the season has been harvested, and null
 * means "not counted", not "zero".
 */
(function (root) {
  'use strict';
  var C = root.PLDCore;

  /* In season: the questions is a ban in the next match or three. Before a
     ball is kicked everyone needs the full first rung and every short horizon
     reads a fraction of a percent — a column nobody can rank on — so the
     pre-season view prices a quarter, half and whole season instead. */
  var HORIZ_LIVE = [1, 3, 5];

  function seasonKnown(players) {
    return players.some(function (p) { return p.sc != null; });
  }

  /* The share of a match a player takes. A squad player who plays half of
     each match accumulates cautions at half the rate of an ever-present, and
     pricing him as a starter puts him on a watchlist he does not belong on. */
  function playShare(p, known, seasonMatches) {
    if (known) {
      var played = Math.max(1, (p._clubPlayed || 0));
      return p.sm ? Math.min(1, (p.sm / 90) / played) : 0;
    }
    return p.min ? Math.min(1, (p.min / 90) / seasonMatches) : 0;
  }

  /*
   * opts = {
   *   seasonMatches   38 or 46 — the length of a season, for pre-season share
   *   playedFor(short) how many league matches that club has played, for the
   *                    English gates. Returns 0 pre-season.
   *   minShare        ignore fringe players below this (default 0.15)
   * }
   */
  function rows(players, scheme, opts) {
    opts = opts || {};
    var known = seasonKnown(players);
    var seasonMatches = opts.seasonMatches || 38;
    var minShare = opts.minShare == null ? 0.15 : opts.minShare;
    var horizons = known ? HORIZ_LIVE
      : [Math.round(seasonMatches / 4), Math.round(seasonMatches / 2), seasonMatches];

    var out = [];
    players.forEach(function (p) {
      if (p._y90 == null || !scheme) return;
      p._clubPlayed = opts.playedFor ? opts.playedFor(p.c) : 0;
      var share = playShare(p, known, seasonMatches);
      if (!(share > minShare)) return;
      var next = C.nextSuspension(known ? (p.sc || 0) : 0, p._clubPlayed, scheme);
      if (!next) return;
      /* A player who can no longer be suspended by accumulation is OFF the
         watch, not at the bottom of it. Showing him with the last rung's
         numbers would be a ban that cannot happen. */
      if (next.dead || next.need == null) return;
      /* THE HORIZON IS CAPPED AT THE GATE. An English rung expires: five
         cautions is a ban only if reached by the club's 19th match, so the
         chance of that ban over the next 23 matches is not the chance over
         23 matches — it is the chance over however many are left before the
         cut-off. Without this cap the strip showed 99% for a rung that dies
         at match 19, which is not a near-certainty, it is impossible. */
      var left = next.by != null ? Math.max(0, next.by - (p._clubPlayed || 0)) : null;
      var ps = horizons.map(function (k) {
        var eff = left == null ? k : Math.min(k, left);
        if (eff <= 0) return 0;
        return C.pCardsAtLeast(p._y90, share * 90, eff, next.need);
      });
      var per = p._y90 * share;
      var eta = per > 0 ? next.need / per : null;
      out.push({
        p: p, next: next, ps: ps, share: share, eta: eta,
        left: left,
        /* Whether his own rate is projected to get him there before the gate.
           Pre-season this is the useful signal: most Championship regulars
           reach five at around match 19, so who clears it and who does not is
           the whole question. */
        beatsGate: (left == null || eta == null) ? null : (eta <= left)
      });
    });
    /* Ranked by the middle horizon — the chance of a ban over the next few
       matches, which is the question the strip exists to answer. Ranking by
       cards alone puts a benched player on four above a starter on three;
       ranking by rate alone ignores the count entirely. */
    out.sort(function (a, b) { return (b.ps[1] || 0) - (a.ps[1] || 0); });
    return { known: known, horizons: horizons, rows: out };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }

  function render(host, res, scheme, opts) {
    opts = opts || {};
    var known = res.known;
    return res.rows.slice(0, opts.limit || 8).map(function (r) {
      var n = r.next, pips = '';
      /* Pips show progress toward the NEXT rung, not the whole season. On a
         ladder the previous rungs are spent, so filling fifteen boxes would
         say nothing about how close the next ban is. */
      var have = n.at - n.need, from = scheme.kind === 'cycle' ? 0 : prevRung(scheme, n.at);
      var total = n.at - from, filled = Math.max(0, have - from);
      for (var i = 0; i < Math.min(total, 10); i++) {
        pips += '<span class="pip' + (i < filled ? ' on' : '') + '"></span>';
      }
      var label;
      if (!known) {
        if (r.eta == null) {
          label = '—';
        } else if (r.beatsGate === false) {
          /* Projected to arrive after the cut-off. Saying "reaches 5 around
             match 21, by match 19" without this reads as a warning when it
             is the opposite. */
          label = '<span class="faint">5 ≈ match ' + Math.ceil(r.eta)
            + ' — likely misses the cut-off</span>';
        } else {
          label = 'reaches ' + n.at + ' ≈ match ' + Math.ceil(r.eta);
        }
      } else if (n.need === 1) {
        label = '<b>one booking from ' + n.ban + ' match' + (n.ban === 1 ? '' : 'es') + '</b>';
      } else {
        label = n.need + ' more for ' + n.ban + ' match' + (n.ban === 1 ? '' : 'es');
      }
      var gate = (n.by && r.beatsGate !== false)
        ? ' <span class="faint">by match ' + n.by + '</span>' : '';
      return '<div class="susp-row">'
        + '<span class="susp-nm">' + esc(r.p.n)
        + ' <span class="faint">' + esc(r.p.p) + ' · ' + esc(r.p.c) + '</span></span>'
        + '<span class="pips" role="img" aria-label="' + filled + ' of ' + total
        + ' toward ' + n.at + '">' + pips + '</span>'
        + '<span class="susp-need">' + label + gate + '</span>'
        + res.horizons.map(function (k, i) {
            return '<span class="susp-p" title="chance within ' + k
              + ' match' + (k === 1 ? '' : 'es') + '">' + pct(r.ps[i]) + '</span>';
          }).join('')
        + '</div>';
    }).join('');
  }

  /* The rung below `at`, so the pips measure the current stretch rather than
     the whole season. Zero for the first rung and for a cycle. */
  function prevRung(scheme, at) {
    if (scheme.kind === 'cycle') return 0;
    var below = (scheme.rungs || []).filter(function (r) { return r.at < at; })
      .map(function (r) { return r.at; });
    return below.length ? Math.max.apply(null, below) : 0;
  }

  root.PLDSuspension = {
    rows: rows, render: render, prevRung: prevRung,
    HORIZ_LIVE: HORIZ_LIVE, seasonKnown: seasonKnown
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

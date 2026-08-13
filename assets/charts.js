/* Charts — inline SVG, no library, no dependency.
 *
 * WHY NO LIBRARY. This desk is a static single file loaded over a service
 * worker shell. The smallest credible charting library is around 20kB gzipped
 * to draw four pictures, it would have to be precached to keep the app
 * working offline, and every chart here is a handful of coordinates. The
 * share cards are already hand-drawn on a canvas in this repo's own visual
 * language; these are the same decision in SVG.
 *
 * WHAT IS AND IS NOT DRAWN. ENHANCEMENTS.md item 5 asked for three charts.
 * Two are here. The third — a club by referee card heatmap — is not, and the
 * reason is arithmetic rather than effort: 23 officials worked the 2025-26
 * Premier League and a club plays 38 matches, so a club meets a given referee
 * **1.65 times a season**. A twenty-by-twenty-three grid of one-and-two-match
 * cells is a picture of sampling noise with a colour scale on it, and a
 * colour scale is very good at making noise look like a finding. Two charts
 * the data does support have been built instead: how strict this week's
 * actual officials are against the field, and thirty-four seasons of the
 * league's card rate.
 *
 * EVERY CHART CARRIES ITS OWN TEXT. role="img" with a <title>, and a
 * summary sentence a screen reader gets instead of the geometry. A chart
 * nobody can read is decoration.
 *
 * COLOUR. Through CSS custom properties, so both themes work and the palette
 * guard (scripts/check-palette.mjs) governs these the same as everything
 * else. Nothing here hardcodes a hex.
 */
(function (root) {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  var n2 = function (x) { return Math.round(x * 100) / 100; };

  /* Open an <svg> with a viewBox and no fixed width, so it scales to whatever
     column it lands in. preserveAspectRatio is left at the default: these are
     charts, and stretching one changes what it says. */
  function open(w, h, title, desc, cls) {
    return '<svg class="chart' + (cls ? ' ' + cls : '') + '" viewBox="0 0 ' + w + ' ' + h + '" '
      + 'role="img" aria-label="' + esc(desc) + '">'
      + '<title>' + esc(title) + '</title>';
  }

  /* ── Reliability diagram ────────────────────────────────────────────────
     The one chart in this file that draws data nobody was looking at:
     /api/model-calibration has returned a `buckets` array — mean forecast
     against observed frequency, with a count — for as long as the loop has
     run, and the client rendered only the headline Brier score and threw the
     buckets away.

     It is the single most honest picture a forecasting product can publish.
     A point ABOVE the diagonal is a bucket where the model said 30% and
     reality said 45% — under-confident. Below is over-confident, which for a
     bookings desk is the direction that costs money.

     Radius carries the sample size, because a bucket holding nine forecasts
     and one holding nine hundred are not the same claim and drawing them as
     identical dots says they are. */
  function reliability(buckets, opts) {
    var o = opts || {};
    var b = (buckets || []).filter(function (x) {
      return x && x.pMean != null && x.oFreq != null && x.n > 0;
    });
    if (!b.length) return '';
    var W = o.width || 320, H = o.height || 320, P = 34;
    var span = W - P - 12;
    var x = function (v) { return P + v * span; };
    var y = function (v) { return H - P - v * span; };
    var maxN = Math.max.apply(null, b.map(function (d) { return d.n; }));
    var r = function (nn) { return 3 + 6 * Math.sqrt(nn / maxN); };

    /* How far off, overall — the number the picture is a decomposition of. */
    var tot = b.reduce(function (s, d) { return s + d.n; }, 0);
    var gap = b.reduce(function (s, d) { return s + d.n * Math.abs(d.pMean - d.oFreq); }, 0) / tot;
    var lean = b.reduce(function (s, d) { return s + d.n * (d.oFreq - d.pMean); }, 0) / tot;

    var s = open(W, H, 'Reliability of the booking model',
      'Reliability diagram. Over ' + tot + ' graded forecasts the model is on average '
      + (100 * gap).toFixed(1) + ' percentage points from the observed rate, leaning '
      + (lean >= 0 ? 'under-confident' : 'over-confident') + '.', 'chart-rel');

    /* Perfect calibration. Dashed, because it is a reference and not a fit. */
    s += '<line x1="' + x(0) + '" y1="' + y(0) + '" x2="' + x(1) + '" y2="' + y(1)
      + '" class="chart-ref" stroke-dasharray="4 4"/>';
    /* Frame and quarter gridlines. */
    s += '<line x1="' + P + '" y1="' + y(0) + '" x2="' + x(1) + '" y2="' + y(0) + '" class="chart-axis"/>';
    s += '<line x1="' + P + '" y1="' + y(0) + '" x2="' + P + '" y2="' + y(1) + '" class="chart-axis"/>';
    [0.25, 0.5, 0.75, 1].forEach(function (t) {
      s += '<line x1="' + P + '" y1="' + y(t) + '" x2="' + x(1) + '" y2="' + y(t) + '" class="chart-grid"/>';
    });
    [0, 0.5, 1].forEach(function (t) {
      s += '<text x="' + (P - 6) + '" y="' + (y(t) + 4) + '" class="chart-tick" text-anchor="end">' + (t * 100) + '%</text>';
      /* The origin is shared by both axes and labelling it twice puts two
         "0%" a few pixels apart, which reads as a rendering fault. */
      if (t > 0) s += '<text x="' + x(t) + '" y="' + (H - P + 16) + '" class="chart-tick" text-anchor="middle">' + (t * 100) + '%</text>';
    });
    s += '<text x="' + x(0.5) + '" y="' + (H - 4) + '" class="chart-lab" text-anchor="middle">model said</text>';
    s += '<text x="10" y="' + y(0.5) + '" class="chart-lab" text-anchor="middle" transform="rotate(-90 10 ' + y(0.5) + ')">actually happened</text>';

    b.forEach(function (d) {
      s += '<circle cx="' + n2(x(d.pMean)) + '" cy="' + n2(y(d.oFreq)) + '" r="' + n2(r(d.n))
        + '" class="chart-pt"><title>' + esc('Model ' + (100 * d.pMean).toFixed(0) + '%, observed '
        + (100 * d.oFreq).toFixed(0) + '% over ' + d.n + ' forecast' + (d.n === 1 ? '' : 's')) + '</title></circle>';
    });
    return s + '</svg>';
  }

  /* ── Card-form sparkline ───────────────────────────────────────────────
     One player's cumulative cautions across the gameweeks the browser has
     actually recorded. A STEP line, not a smooth one: a booking is an event
     at a moment, and interpolating between two gameweeks draws a player
     collecting two-thirds of a yellow card in midweek.

     Returns '' below two points. One point is not a trend and a chart of it
     implies otherwise. */
  function sparkline(points, opts) {
    var o = opts || {};
    var p = (points || []).filter(function (d) { return d && d.v != null && isFinite(d.v); });
    if (p.length < 2) return '';
    var W = o.width || 168, H = o.height || 34, PAD = 3;
    var lo = 0, hi = Math.max.apply(null, p.map(function (d) { return d.v; })) || 1;
    var x = function (i) { return PAD + (i / (p.length - 1)) * (W - 2 * PAD); };
    var y = function (v) { return H - PAD - ((v - lo) / (hi - lo || 1)) * (H - 2 * PAD); };

    var d = '';
    p.forEach(function (pt, i) {
      if (!i) { d += 'M' + n2(x(i)) + ' ' + n2(y(pt.v)); return; }
      d += 'H' + n2(x(i)) + 'V' + n2(y(pt.v));           /* step: along, then up */
    });
    var last = p[p.length - 1], first = p[0];
    var gained = last.v - first.v;
    var s = open(W, H, 'Cautions by gameweek',
      'Card form: ' + gained + ' caution' + (gained === 1 ? '' : 's') + ' across '
      + p.length + ' recorded gameweeks, ' + last.v + ' in total.', 'chart-spark');
    s += '<path d="' + d + '" class="chart-line' + (gained > 0 ? ' rising' : '') + '" fill="none"/>';
    s += '<circle cx="' + n2(x(p.length - 1)) + '" cy="' + n2(y(last.v)) + '" r="2.6" class="chart-dot"/>';
    return s + '</svg>';
  }

  /* ── Strictness strip ───────────────────────────────────────────────────
     Every official's cards per game on one axis, with the ones actually
     appointed this week picked out. The question a reader has on a Friday is
     not "how strict is Chris Kavanagh" in the abstract — it is "are any of
     this week's officials outliers", and a ranked list of 23 numbers answers
     that arithmetically while a strip answers it at a glance.

     `items` = [{n, ypg, on}] where `on` marks an appointed official. */
  function strip(items, opts) {
    var o = opts || {};
    var it = (items || []).filter(function (d) { return d && d.ypg != null && isFinite(d.ypg); });
    if (it.length < 3) return '';
    var W = o.width || 640, H = o.height || 74, P = 10, TOP = 26;
    var vals = it.map(function (d) { return d.ypg; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 0.01) return '';
    var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    var x = function (v) { return P + ((v - lo) / (hi - lo)) * (W - 2 * P); };
    var marked = it.filter(function (d) { return d.on; });

    var s = open(W, H, 'Referee strictness',
      it.length + ' officials from ' + lo.toFixed(2) + ' to ' + hi.toFixed(2)
      + ' cards a game, league average ' + mean.toFixed(2) + '.'
      + (marked.length ? ' Appointed this round: ' + marked.map(function (d) {
        return d.n + ' at ' + d.ypg.toFixed(2);
      }).join(', ') + '.' : ''), 'chart-strip');

    s += '<line x1="' + P + '" y1="' + TOP + '" x2="' + (W - P) + '" y2="' + TOP + '" class="chart-axis"/>';
    /* The average, labelled. Without it the strip shows spread but not which
       side of normal any given official sits. */
    s += '<line x1="' + n2(x(mean)) + '" y1="' + (TOP - 8) + '" x2="' + n2(x(mean)) + '" y2="' + (TOP + 8) + '" class="chart-ref"/>';
    s += '<text x="' + n2(x(mean)) + '" y="' + (TOP - 12) + '" class="chart-tick" text-anchor="middle">avg ' + mean.toFixed(2) + '</text>';

    it.forEach(function (d) {
      s += '<circle cx="' + n2(x(d.ypg)) + '" cy="' + TOP + '" r="' + (d.on ? 5 : 3)
        + '" class="' + (d.on ? 'chart-pt on' : 'chart-pt') + '"><title>'
        + esc(d.n + ' — ' + d.ypg.toFixed(2) + ' cards a game') + '</title></circle>';
    });
    /* Name only the appointed ones, alternating height so two close together
       do not overprint. Everything else has a tooltip and the summary. */
    marked.sort(function (a, b) { return a.ypg - b.ypg; }).forEach(function (d, i) {
      s += '<text x="' + n2(x(d.ypg)) + '" y="' + (TOP + (i % 2 ? 32 : 20)) + '" class="chart-name" text-anchor="middle">'
        + esc(d.n.split(' ').pop()) + '</text>';
    });
    s += '<text x="' + P + '" y="' + (H - 2) + '" class="chart-tick">' + lo.toFixed(1) + '</text>';
    s += '<text x="' + (W - P) + '" y="' + (H - 2) + '" class="chart-tick" text-anchor="end">' + hi.toFixed(1) + '</text>';
    return s + '</svg>';
  }

  /* ── Season trend ───────────────────────────────────────────────────────
     The league's cards per game, every season on record. This is the context
     every other number on the desk sits in and it was a wall of JSON nobody
     could read: 1.34 in 1993-94 against 4.17 in 2023-24 is the single largest
     fact in the referee dataset. */
  function trend(points, opts) {
    var o = opts || {};
    var p = (points || []).filter(function (d) { return d && d.v != null && isFinite(d.v); });
    if (p.length < 3) return '';
    var W = o.width || 640, H = o.height || 150, P = 30, B = 22;
    var vals = p.map(function (d) { return d.v; });
    var lo = Math.floor(Math.min.apply(null, vals) * 2) / 2;
    var hi = Math.ceil(Math.max.apply(null, vals) * 2) / 2;
    var x = function (i) { return P + (i / (p.length - 1)) * (W - P - 10); };
    var y = function (v) { return H - B - ((v - lo) / (hi - lo || 1)) * (H - B - 12); };

    var peak = p.reduce(function (a, b) { return b.v > a.v ? b : a; }, p[0]);
    var s = open(W, H, 'League cards a game by season',
      p.length + ' seasons from ' + p[0].k + ' to ' + p[p.length - 1].k
      + '. Lowest ' + Math.min.apply(null, vals).toFixed(2) + ', highest '
      + peak.v.toFixed(2) + ' in ' + peak.k + ', latest ' + p[p.length - 1].v.toFixed(2) + '.', 'chart-trend');

    for (var g = lo; g <= hi + 1e-9; g += (hi - lo) / 2) {
      s += '<line x1="' + P + '" y1="' + n2(y(g)) + '" x2="' + (W - 10) + '" y2="' + n2(y(g)) + '" class="chart-grid"/>';
      s += '<text x="' + (P - 6) + '" y="' + n2(y(g) + 4) + '" class="chart-tick" text-anchor="end">' + g.toFixed(1) + '</text>';
    }
    var d = p.map(function (pt, i) { return (i ? 'L' : 'M') + n2(x(i)) + ' ' + n2(y(pt.v)); }).join('');
    s += '<path d="' + d + '" class="chart-line" fill="none"/>';
    /* The peak, named. A line with no annotation makes the reader hunt for
       the thing the line is about. */
    var pi = p.indexOf(peak);
    s += '<circle cx="' + n2(x(pi)) + '" cy="' + n2(y(peak.v)) + '" r="3" class="chart-dot"/>';
    s += '<text x="' + n2(x(pi)) + '" y="' + n2(y(peak.v) - 8) + '" class="chart-name" text-anchor="middle">'
      + esc(peak.k + ' · ' + peak.v.toFixed(2)) + '</text>';
    /* First and last season only: 34 rotated labels is a smear. */
    s += '<text x="' + P + '" y="' + (H - 4) + '" class="chart-tick">' + esc(p[0].k) + '</text>';
    s += '<text x="' + (W - 10) + '" y="' + (H - 4) + '" class="chart-tick" text-anchor="end">' + esc(p[p.length - 1].k) + '</text>';
    return s + '</svg>';
  }

  var api = { reliability: reliability, sparkline: sparkline, strip: strip, trend: trend };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PLDCharts = api;
})(typeof window !== 'undefined' ? window : globalThis);

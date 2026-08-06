/* Share cards, for every desk.
 *
 * The Premier League desk grew a canvas exporter inline — brand band, match
 * card, gameweek card, acca builder — hardwired to that page's globals and its
 * purple. The Championship and La Liga desks had none, and copying 180 lines of
 * canvas into each of them twice would guarantee three cards that drift apart
 * the first time anyone changes a colour.
 *
 * So this is the one implementation, and the desks differ only by a THEME and
 * an ADAPTER:
 *
 *   theme    what it looks like: two gradient stops, an ink colour, the strap
 *            across the top and the wordmark in the corner.
 *   adapter  what it says: the caller hands over a plain object describing one
 *            match or one round, already priced. Nothing in here knows how a
 *            probability was arrived at, which is why the same file can draw a
 *            fixture from a live FPL feed and one from a committed .js file.
 *
 * Everything is drawn on a 1080×1350 canvas — the portrait 4:5 that Instagram,
 * X and WhatsApp all crop kindly.
 *
 * NO NETWORK, NO DEPENDENCIES. It renders from data already on the page and
 * hands back a Blob. A share card that needed a fetch would fail exactly when
 * someone wanted it.
 */
(function (root) {
  'use strict';

  var W = 1080, H = 1350, P = 64;
  var DISP = "'Bricolage Grotesque',sans-serif";
  var BODY = "'Hanken Grotesk',sans-serif";

  /* Per-desk identity. `strap` runs above the title in the brand band and
     `mark` sits bottom-right; both are what makes a card recognisable at
     thumbnail size, so they are the only things a desk MUST supply. */
  var THEMES = {
    PL: {
      from: '#3d195b', to: '#e90052', ink: '#3d195b',
      strap: 'BOOKINGS DESK · PREMIER LEAGUE', mark: 'PL BOOKINGS DESK',
      slug: 'pl-bookings', tag: 'PL'
    },
    EFLC: {
      from: '#1e1b4b', to: '#7c3aed', ink: '#4c1d95',
      strap: 'BOOKINGS DESK · EFL CHAMPIONSHIP', mark: 'CHAMPIONSHIP BOOKINGS',
      slug: 'eflc-bookings', tag: 'EFLC'
    },
    LL: {
      from: '#7f1d1d', to: '#ea580c', ink: '#9a3412',
      strap: 'BOOKINGS DESK · LA LIGA', mark: 'LA LIGA BOOKINGS',
      slug: 'laliga-bookings', tag: 'LL'
    },
    ALL: {
      from: '#0f172a', to: '#0891b2', ink: '#0e7490',
      strap: 'BOOKINGS DESK · ALL LEAGUES', mark: 'BOOKINGS DESK',
      slug: 'bookings-desk', tag: 'ALL'
    }
  };
  function theme(code) { return THEMES[code] || THEMES.ALL; }

  /* ---- primitives ------------------------------------------------------- */

  function roundRect(x, a, b, w, h, r) {
    x.beginPath();
    x.moveTo(a + r, b);
    x.arcTo(a + w, b, a + w, b + h, r);
    x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r);
    x.arcTo(a, b, a + w, b, r);
    x.closePath();
  }

  function textOn(hex) {
    var r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0c1322' : '#ffffff';
  }

  /* Truncates to fit and appends an ellipsis only if it actually cut. A name
     that fits must not gain a "…" — that reads as missing data. */
  function fit(x, text, max) {
    var t = String(text == null ? '' : text);
    if (x.measureText(t).width <= max) return t;
    while (t.length > 3 && x.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  /* The brand mark: a fanned red and yellow card. Drawn rather than loaded,
     so a card never waits on an image that may not arrive. */
  function drawMark(x, cx, cy, h) {
    var w = h * 0.66, rr = h * 0.15;
    x.save(); x.translate(cx, cy);
    x.save(); x.rotate(16 * Math.PI / 180); x.fillStyle = '#e11d48';
    roundRect(x, -w * 0.15, -h / 2, w, h, rr); x.fill(); x.restore();
    x.save(); x.rotate(-10 * Math.PI / 180); x.fillStyle = '#f7c600';
    x.strokeStyle = 'rgba(35,16,58,.55)'; x.lineWidth = 2.5;
    roundRect(x, -w * 0.85, -h / 2, w, h, rr); x.fill(); x.stroke(); x.restore();
    x.restore();
  }

  /* Heat and probability colours. Deliberately the same thresholds the pages
     use for their on-screen chips: a card that colours a fixture differently
     from the page it came from is worse than one with no colour at all. */
  function heatHex(heat, mid, hot) {
    hot = hot == null ? 4.2 : hot;
    mid = mid == null ? 3.5 : mid;
    return heat >= hot ? '#16a34a' : heat >= mid ? '#d97706' : '#64748b';
  }
  function probHex(p) { return p >= 0.50 ? '#dc2626' : p >= 0.30 ? '#d97706' : '#64748b'; }

  /* A club's colour, from a palette the caller supplies. Falls back to the
     desk's ink so a club with no colour still reads as a badge. */
  function clubColour(short, palette, th) {
    return (palette && palette[short]) || th.ink;
  }

  function badge(x, cx, mid, short, palette, th, w, h) {
    w = w || 46; h = h || 32;
    var col = clubColour(short, palette, th);
    x.fillStyle = col;
    roundRect(x, cx, mid - h / 2, w, h, 7); x.fill();
    x.fillStyle = textOn(col);
    x.font = '800 ' + Math.round(h * 0.44) + 'px ' + BODY;
    x.textAlign = 'center';
    x.fillText(short, cx + w / 2, mid + h * 0.16);
    x.textAlign = 'left';
    return cx + w;
  }

  function brandBand(x, th, title, subtitle) {
    var g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, th.from); g.addColorStop(1, th.to);
    x.fillStyle = g; x.fillRect(0, 0, W, 168);
    drawMark(x, W - P - 30, 84, 86);
    x.fillStyle = 'rgba(255,255,255,.82)'; x.font = '700 22px ' + BODY;
    x.fillText(th.strap, P, 66);
    x.fillStyle = '#ffffff'; x.font = '800 46px ' + DISP;
    x.fillText(fit(x, title, W - P - 150), P, 126);
    x.fillStyle = '#586275'; x.font = '600 22px ' + BODY;
    x.fillText(String(subtitle || ''), P, 210);
  }

  function footer(x, th, note) {
    /* MEASURE the wordmark rather than reserving a guessed width for it.
       A fixed 300px reserve was fine for "PL BOOKINGS DESK" and ran straight
       through "CHAMPIONSHIP BOOKINGS" — the note is the piece that must give
       way, since the mark is what identifies the card. */
    /* The 18+ / BeGambleAware line is drawn FIRST and never truncated; the
       explanatory note takes whatever room is left. Putting the note first
       and trimming the tail is what the earlier version did, and it cut
       "begambleaware.org" clean off every card that had a long note — the one
       piece of text on here that is not allowed to be the part that gives
       way. */
    x.font = '800 20px ' + DISP;
    var markW = x.measureText(th.mark).width;
    var fixed = '18+ · begambleaware.org';
    x.fillStyle = '#8b94a5'; x.font = '600 18px ' + BODY;
    x.fillText(fixed, P, H - 50);
    var used = x.measureText(fixed + ' · ').width;
    var room = W - 2 * P - markW - 24 - used;
    if (room > 60) {
      x.fillStyle = '#a8b0be';
      x.fillText(fit(x, note, room), P + used, H - 50);
    }
    x.fillStyle = th.ink; x.font = '800 20px ' + DISP;
    x.textAlign = 'right'; x.fillText(th.mark, W - P, H - 50); x.textAlign = 'left';
  }

  function canvas() {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    return { c: c, x: x };
  }

  function ready() {
    try {
      if (document.fonts && document.fonts.ready) return document.fonts.ready;
    } catch (e) { /* a browser without the font API just draws sooner */ }
    return Promise.resolve();
  }

  function toBlob(c) {
    return new Promise(function (res) { c.toBlob(res, 'image/png'); });
  }

  /* ---- the acca strip --------------------------------------------------- */
  /* Combined chance assumes the legs are independent, which is a research
     estimate rather than a price: two bookings in the SAME match are
     correlated (one flashpoint, two cards), and the note under every card
     says so. Cross-match legs are much closer to genuinely independent, which
     is why the combined and matchday cards can carry the same strip honestly. */
  function accaStrip(x, th, legs, y, heading, rightLabel) {
    x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
    x.fillText(heading, P, y - 18);
    x.textAlign = 'right'; x.fillText(rightLabel, W - P, y - 18); x.textAlign = 'left';

    var rows = [];
    if (legs.length >= 2) rows.push({ tag: 'DOUBLE', legs: legs.slice(0, 2) });
    if (legs.length >= 3) rows.push({ tag: 'TREBLE', legs: legs.slice(0, 3) });
    if (!rows.length) {
      x.fillStyle = '#586275'; x.font = '600 22px ' + BODY;
      x.fillText('Not enough rated players for a combo.', P, y + 34);
      return;
    }
    var rh = 110;
    rows.forEach(function (row, i) {
      var ry = y + i * rh, mid = ry + rh / 2;
      x.fillStyle = '#f6f4fb'; roundRect(x, P - 16, ry + 4, W - 2 * (P - 16), rh - 14, 14); x.fill();
      x.fillStyle = th.ink; roundRect(x, P, mid - 18, 104, 36, 9); x.fill();
      x.fillStyle = '#ffffff'; x.font = '800 18px ' + BODY;
      x.textAlign = 'center'; x.fillText(row.tag, P + 52, mid + 6); x.textAlign = 'left';

      var names = row.legs.map(function (l) { return l.name; }).join(' + ');
      x.fillStyle = '#0c1322'; x.font = '700 26px ' + DISP;
      x.fillText(fit(x, names, W - P - 430), P + 124, mid - 2);
      x.fillStyle = '#586275'; x.font = '600 18px ' + BODY;
      x.fillText(fit(x, row.legs.map(function (l) { return l.club; }).join(' · '),
                     W - P - 430), P + 124, mid + 24);

      var cp = row.legs.reduce(function (s, l) { return s * l.prob; }, 1);
      x.fillStyle = probHex(cp); x.font = '800 38px ' + DISP;
      x.textAlign = 'right'; x.fillText((cp * 100).toFixed(0) + '%', W - P, mid - 4);
      x.fillStyle = '#586275'; x.font = '600 18px ' + BODY;
      x.fillText('~' + (1 / cp).toFixed(1) + ' fair odds', W - P, mid + 24);
      x.textAlign = 'left';
    });
  }

  /* ---- one match -------------------------------------------------------- */
  /*
   * spec = {
   *   league, title, subtitle,
   *   refLine,                        e.g. "Referee: Tim Robinson · 4.86 c/g (×1.12)"
   *   heat, heatLabel, chips: [str],
   *   candidates: [{name, club, sub, prob}],
   *   markets: [{label, value}]       optional, drawn as a strip
   * }
   */
  function matchCard(spec) {
    return ready().then(function () {
      var th = theme(spec.league), k = canvas(), x = k.x;
      brandBand(x, th, spec.title, spec.subtitle);

      var ry = 256;
      x.fillStyle = '#0c1322'; x.font = '700 22px ' + BODY;
      x.fillText(fit(x, spec.refLine || 'Referee: not yet appointed', W - 2 * P - 260), P, ry);

      if (spec.heat != null) {
        var chips = (spec.chips || []).filter(Boolean);
        var ht = spec.heat.toFixed(1) + ' ' + (spec.heatLabel || '')
               + (chips.length ? ' · ' + chips.join(' · ') : '');
        x.font = '800 22px ' + DISP;
        var hw = x.measureText(ht).width + 40;
        x.fillStyle = heatHex(spec.heat, spec.heatMid, spec.heatHot);
        roundRect(x, W - P - hw, ry - 28, hw, 38, 19); x.fill();
        x.fillStyle = '#fff'; x.textAlign = 'center';
        x.fillText(ht, W - P - hw / 2, ry - 1); x.textAlign = 'left';
      }

      var top = 322, cands = (spec.candidates || []).slice(0, 5);
      x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
      x.fillText('MOST LIKELY BOOKED', P, top - 16);
      x.textAlign = 'right'; x.fillText('P(CARD)', W - P, top - 16); x.textAlign = 'left';

      var hasMk = !!(spec.markets && spec.markets.length);
      var listBottom = hasMk ? 780 : 958;
      if (!cands.length) {
        x.fillStyle = '#586275'; x.font = '600 24px ' + BODY;
        x.fillText('No rated players yet.', P, top + 40);
      }
      var rh = Math.min(122, (listBottom - top) / Math.max(1, cands.length));
      cands.forEach(function (cd, i) {
        var y = top + i * rh, mid = y + rh / 2;
        if (i % 2 === 0) {
          x.fillStyle = '#f4f6fa';
          roundRect(x, P - 16, y + 6, W - 2 * (P - 16), rh - 10, 14); x.fill();
        }
        x.fillStyle = i < 3 ? th.ink : '#c2c8d4'; x.font = '800 26px ' + DISP;
        x.textAlign = 'center'; x.fillText(String(i + 1), P + 14, mid + 8); x.textAlign = 'left';
        badge(x, P + 36, mid, cd.club, spec.palette, th, 52, 40);
        x.fillStyle = '#0c1322'; x.font = '700 30px ' + DISP;
        x.fillText(fit(x, cd.name, W - P - 470), P + 108, mid - 2);
        x.fillStyle = '#586275'; x.font = '600 18px ' + BODY;
        x.fillText(fit(x, cd.sub || '', W - P - 470), P + 108, mid + 24);
        var pc = probHex(cd.prob);
        x.fillStyle = pc; x.font = '800 40px ' + DISP;
        x.textAlign = 'right'; x.fillText((cd.prob * 100).toFixed(0) + '%', W - P, mid - 4);
        x.textAlign = 'left';
        var bw = 190, bx = W - P - bw, by = mid + 12;
        x.fillStyle = '#e3e7ee'; roundRect(x, bx, by, bw, 8, 4); x.fill();
        x.fillStyle = pc; roundRect(x, bx, by, bw * Math.min(1, cd.prob), 8, 4); x.fill();
      });

      /* The team card markets, when the desk has them. This is the strip the
         Championship and La Liga desks show under every fixture and the
         Premier League one does not — so it is optional rather than assumed. */
      if (hasMk) {
        var my = 838;
        x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
        x.fillText('TEAM CARD MARKETS', P, my - 18);
        var cols = Math.min(3, spec.markets.length);
        var cw = (W - 2 * P) / cols;
        spec.markets.slice(0, 6).forEach(function (m, i) {
          var cx = P + (i % cols) * cw, cy = my + Math.floor(i / cols) * 74;
          x.fillStyle = '#f4f6fa'; roundRect(x, cx, cy, cw - 14, 62, 12); x.fill();
          x.fillStyle = '#586275'; x.font = '600 17px ' + BODY;
          x.fillText(fit(x, m.label, cw - 40), cx + 16, cy + 26);
          x.fillStyle = th.ink; x.font = '800 26px ' + DISP;
          x.fillText(m.value, cx + 16, cy + 52);
        });
      }

      var legs = cands.filter(function (c) { return c.prob > 0; }).slice(0, 3);
      accaStrip(x, th, legs, 1034, 'ACCA BUILDER · SAME MATCH', 'ALL BOOKED');
      footer(x, th, spec.note ||
        'Same-match combos assume independent bookings · research, not a guarantee');
      return toBlob(k.c);
    });
  }

  /* ---- one round -------------------------------------------------------- */
  /*
   * spec = {
   *   league, title, subtitle,
   *   fixtures: [{home, away, heat, heatLabel, chips, top:{name, prob}, tag}],
   *   legs: [{name, club, sub, prob}]      one per fixture, for the acca strip
   * }
   * `tag` is drawn as a small league flag — used only by the combined card,
   * where a row's league is not implied by the header.
   */
  function roundCard(spec) {
    return ready().then(function () {
      var th = theme(spec.league), k = canvas(), x = k.x;
      brandBand(x, th, spec.title, spec.subtitle);

      var top = 272, rows = (spec.fixtures || []).slice(0, 8);
      x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
      x.fillText('FIXTURE', P + 92, top - 16);
      x.fillText('TOP RISK', P + 430, top - 16);
      x.textAlign = 'right'; x.fillText('HEAT', W - P, top - 16); x.textAlign = 'left';

      if (!rows.length) {
        x.fillStyle = '#586275'; x.font = '600 24px ' + BODY;
        x.fillText('No fixtures to show.', P, top + 40);
      }
      var rh = Math.min(92, (1000 - top) / Math.max(1, rows.length));
      rows.forEach(function (f, i) {
        var y = top + i * rh, mid = y + rh / 2;
        if (i % 2 === 0) {
          x.fillStyle = '#f4f6fa';
          roundRect(x, P - 16, y + 6, W - 2 * (P - 16), rh - 10, 14); x.fill();
        }
        x.fillStyle = '#c2c8d4'; x.font = '800 26px ' + DISP;
        x.textAlign = 'right'; x.fillText(String(i + 1), P + 12, mid + 8); x.textAlign = 'left';
        badge(x, P + 30, mid, f.home, spec.palette, th);
        x.fillStyle = '#586275'; x.font = '600 18px ' + BODY; x.fillText('v', P + 84, mid + 6);
        badge(x, P + 102, mid, f.away, spec.palette, th);
        var nx = P + 158;
        if (f.tag) {
          x.fillStyle = '#eef2f7'; roundRect(x, nx, mid - 13, 58, 26, 6); x.fill();
          x.fillStyle = '#586275'; x.font = '700 14px ' + BODY;
          x.textAlign = 'center'; x.fillText(f.tag, nx + 29, mid + 5); x.textAlign = 'left';
          nx += 66;
        }
        (f.chips || []).slice(0, 1).forEach(function (ch) {
          x.fillStyle = th.to; x.font = '700 14px ' + BODY; x.fillText(ch, nx, mid + 5);
        });
        if (f.top) {
          x.fillStyle = '#0c1322'; x.font = '700 22px ' + DISP;
          x.fillText(fit(x, f.top.name, 250), P + 430, mid - 2);
          x.fillStyle = probHex(f.top.prob); x.font = '700 17px ' + BODY;
          x.fillText((f.top.prob * 100).toFixed(0) + '% card', P + 430, mid + 22);
        } else {
          x.fillStyle = '#8b94a5'; x.font = '600 18px ' + BODY;
          x.fillText('—', P + 430, mid + 6);
        }
        x.fillStyle = heatHex(f.heat, spec.heatMid, spec.heatHot);
        x.font = '800 36px ' + DISP; x.textAlign = 'right';
        x.fillText(f.heat.toFixed(1), W - P, mid - 2);
        x.font = '700 15px ' + BODY; x.fillText(f.heatLabel || '', W - P, mid + 22);
        x.textAlign = 'left';
      });

      accaStrip(x, th, (spec.legs || []).slice(0, 3), 1034,
                spec.accaHeading || 'ACCA BUILDER · CROSS-MATCH', 'ALL BOOKED');
      footer(x, th, spec.note ||
        'Cross-match combos assume independent bookings · research, not a guarantee');
      return toBlob(k.c);
    });
  }

  /* ---- adapters for the committed-data desks ---------------------------- */
  /*
   * The Championship and La Liga desks price a fixture identically — both call
   * the same priceFixture() over the same shapes — so the translation from
   * "what the desk computed" to "what a card draws" lives here once rather
   * than in two near-identical pages that would drift the first time either
   * was touched.
   *
   * ctx = { league, clubBy, whenText, seasonLabel, roundWord }
   * priced = the object priceFixture() returns:
   *   { fx, ref:{ref, name, appointed}, factor, home:{ps,top}, away:{ps,top}, m }
   */
  function refLineOf(priced, n2) {
    var r = priced.ref || {};
    if (r.ref) {
      return 'Referee: ' + r.ref.n
        + (r.ref.ypg != null ? ' · ' + n2(r.ref.ypg) + ' y/g (×' + n2(priced.factor) + ')' : '')
        + (r.appointed ? ' · appointed' : '');
    }
    if (r.appointed && r.name) return 'Referee: ' + r.name + ' · appointed, no card record yet';
    return 'Referee: not yet appointed';
  }

  function candidatesOf(priced, clubBy) {
    var out = [];
    ['home', 'away'].forEach(function (sideKey) {
      var side = priced[sideKey] || {}, short = priced.fx[sideKey === 'home' ? 'h' : 'a'];
      (side.top || []).forEach(function (t) {
        var club = (clubBy && clubBy[short]) || {};
        out.push({
          name: t.p.n, club: short, prob: t.prob,
          sub: (t.p.p || '') + ' · ' + (club.name || short)
             + (t.p.f != null ? ' · ' + t.p.f.toFixed(1) + ' fls/90' : '')
        });
      });
    });
    return out.sort(function (a, b) { return b.prob - a.prob; });
  }

  function deskMatchSpec(priced, ctx) {
    var n1 = function (v) { return v == null ? '—' : Number(v).toFixed(1); };
    var n2 = function (v) { return v == null ? '—' : Number(v).toFixed(2); };
    var f = priced.fx, m = priced.m || {};
    var ch = (ctx.clubBy && ctx.clubBy[f.h]) || {}, ca = (ctx.clubBy && ctx.clubBy[f.a]) || {};
    var over = m.over || {};
    return {
      league: ctx.league,
      title: (ch.name || f.h) + ' v ' + (ca.name || f.a),
      subtitle: [ctx.seasonLabel, f.r ? (ctx.roundWord || 'Matchday') + ' ' + f.r : null,
                 ctx.whenText ? ctx.whenText(f.d) : null].filter(Boolean).join(' · '),
      refLine: refLineOf(priced, n2),
      heat: m.expected, heatLabel: 'cards',
      heatMid: ctx.heatMid, heatHot: ctx.heatHot,
      candidates: candidatesOf(priced, ctx.clubBy),
      palette: ctx.palette,
      markets: [
        { label: 'Home expected', value: n1(m.expectedHome) },
        { label: 'Away expected', value: n1(m.expectedAway) },
        { label: 'Both teams carded', value: m.bothCarded != null
            ? (m.bothCarded * 100).toFixed(0) + '%' : '—' },
        { label: 'Over 3.5', value: over[3.5] != null ? (over[3.5] * 100).toFixed(0) + '%' : '—' },
        { label: 'Over 4.5', value: over[4.5] != null ? (over[4.5] * 100).toFixed(0) + '%' : '—' },
        { label: 'Over 5.5', value: over[5.5] != null ? (over[5.5] * 100).toFixed(0) + '%' : '—' }
      ],
      filename: (theme(ctx.league).slug + '-' + slug(f.h) + '-' + slug(f.a) + '.png')
    };
  }

  function deskRoundSpec(list, ctx) {
    var fixtures = list.map(function (p) {
      var cands = candidatesOf(p, ctx.clubBy);
      return {
        home: p.fx.h, away: p.fx.a,
        heat: (p.m || {}).expected, heatLabel: 'cards',
        top: cands[0] ? { name: cands[0].name, prob: cands[0].prob } : null,
        tag: ctx.rowTag ? ctx.rowTag(p) : null,
        _leg: cands[0] || null
      };
    });
    var legs = fixtures.map(function (r) { return r._leg; })
      .filter(function (l) { return l && l.prob > 0; })
      .sort(function (a, b) { return b.prob - a.prob; });
    return {
      league: ctx.league,
      title: ((ctx.roundWord || 'Matchday') + ' ' + ctx.round) + ' · Booking Heat',
      subtitle: [ctx.seasonLabel, 'Hottest fixtures first'].filter(Boolean).join(' · '),
      fixtures: fixtures, legs: legs, palette: ctx.palette,
      heatMid: ctx.heatMid, heatHot: ctx.heatHot,
      filename: theme(ctx.league).slug + '-'
        + slug((ctx.roundWord || 'matchday') + '-' + ctx.round) + '.png'
    };
  }

  /* ---- download --------------------------------------------------------- */
  function download(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(u); }, 2000);
    return name;
  }

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'card';
  }

  root.PLDShare = {
    W: W, H: H, PAD: P,
    THEMES: THEMES, theme: theme,
    matchCard: matchCard, roundCard: roundCard,
    deskMatchSpec: deskMatchSpec, deskRoundSpec: deskRoundSpec,
    download: download, slug: slug,
    heatHex: heatHex, probHex: probHex, textOn: textOn,
    roundRect: roundRect, fit: fit, drawMark: drawMark
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

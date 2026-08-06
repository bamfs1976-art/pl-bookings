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
    /* CLAMPED. arcTo does not bound its radius: hand it 999 for a pill and it
       sweeps arcs far outside the rectangle, which paints a swirl across the
       whole card rather than failing. Half the shorter side is the largest
       radius a rectangle can actually have, so `999` now means "fully round"
       exactly as a caller would expect. */
    r = Math.max(0, Math.min(r, w / 2, h / 2));
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
    /* ONE LEG PER PLAYER. Multiplying a player's probability by his own is not
       a combo, it is the same event counted twice, and it prices a treble at a
       number no book would ever offer. It cannot arise on a single date — a
       player appears once — but a card drawn across DATES picks the same name
       off several of them, and the first calendar card built a treble reading
       "Lundstram + Cuenca + Lundstram". Deduped here rather than in the
       callers, because no caller ever wants the alternative.

       Deduping BEFORE the cut to three, never after. Slicing first and
       deduping the slice is what the calendar card did at first: its four
       hottest legs were the same player four times, which deduped to one and
       printed "Not enough rated players for a combo" on a card listing eight
       rated fixtures. Callers therefore pass the whole list and the cut
       happens here. */
    var seen = {};
    legs = (legs || []).filter(function (l) {
      var id = (l && l.name) + '|' + (l && l.club);
      if (!l || seen[id]) return false;
      seen[id] = 1; return true;
    }).slice(0, 3);
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

      accaStrip(x, th, (spec.legs || []), 1034,
                spec.accaHeading || 'ACCA BUILDER · CROSS-MATCH', 'ALL BOOKED');
      footer(x, th, spec.note ||
        'Cross-match combos assume independent bookings · research, not a guarantee');
      return toBlob(k.c);
    });
  }

  /* ---- the calendar card ------------------------------------------------- */
  /*
   * The match card is about a fixture, the matchday card about a date. This one
   * is about the whole CALENDAR, which will not fit on a card at any density:
   * ~1,300 fixtures over ~128 dates against room for eight rows. So it does two
   * things — states the calendar's shape in a stat band, then ranks the single
   * hottest fixtures in it, each stamped with the date it falls on.
   *
   * IT DOES NOT RANK DATES, and that was the first attempt. Ranking a date by
   * the cards expected across it sounds like "the biggest booking day" and is
   * really "the day with the most matches scheduled": with per-match
   * expectation nearly constant across a division, the eleven 22-match
   * Saturdays came out at 77.1, 76.9, 76.9, 76.9, 76.8, 76.8 — a top six
   * separated by less than half a card in seventy-seven, which is noise
   * presented as a ranking. Fixture heat has real spread, so that is what gets
   * ranked, and the date rides along as a column.
   *
   * spec = {
   *   league, title, subtitle,
   *   stats: [{ value, label }],
   *   fixtures: [{ date, home, away, tag, heat, top:{name,prob} }],
   *   legs, accaHeading, note, coverage: { dates, matches, shown, filter }
   * }
   */
  var LEAGUE_TINT = {
    PL: '#e90052', EFLC: '#7c3aed', LL: '#ea580c', ALL: '#0891b2'
  };

  function leagueChip(x, cx, mid, code, w) {
    var col = LEAGUE_TINT[code] || '#64748b';
    x.font = '800 15px ' + BODY;
    w = w || x.measureText(code).width + 20;
    x.globalAlpha = 0.14; x.fillStyle = col;
    roundRect(x, cx, mid - 13, w, 26, 13); x.fill();
    x.globalAlpha = 1; x.fillStyle = col;
    x.textAlign = 'center'; x.fillText(code, cx + w / 2, mid + 6); x.textAlign = 'left';
    return cx + w + 6;
  }

  /* The calendar's shape, which is the part a ranked list cannot carry: how
     many dates there are, how many of them stack leagues, how big it all is. */
  function statBand(x, th, stats, y) {
    var n = stats.length; if (!n) return;
    var gap = 12, w = (W - 2 * P - gap * (n - 1)) / n;
    stats.forEach(function (s, i) {
      var cx = P + i * (w + gap);
      x.fillStyle = '#f4f6fa'; roundRect(x, cx, y, w, 76, 13); x.fill();
      x.fillStyle = th.ink; x.font = '800 30px ' + DISP;
      x.textAlign = 'center';
      x.fillText(fit(x, String(s.value), w - 16), cx + w / 2, y + 38);
      x.fillStyle = '#8b94a5'; x.font = '600 14px ' + BODY;
      x.fillText(fit(x, s.label, w - 12), cx + w / 2, y + 60);
      x.textAlign = 'left';
    });
  }

  function calendarCard(spec) {
    return ready().then(function () {
      var th = theme(spec.league), k = canvas(), x = k.x;
      brandBand(x, th, spec.title, spec.subtitle);
      statBand(x, th, (spec.stats || []).slice(0, 4), 232);

      var top = 366, rows = (spec.fixtures || []).slice(0, 8);
      x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
      x.fillText('DATE', P + 34, top - 16);
      x.fillText('FIXTURE', P + 210, top - 16);
      x.fillText('TOP RISK', P + 560, top - 16);
      x.textAlign = 'right'; x.fillText('HEAT', W - P, top - 16); x.textAlign = 'left';

      if (!rows.length) {
        x.fillStyle = '#586275'; x.font = '600 24px ' + BODY;
        x.fillText('No fixtures to show.', P, top + 40);
      }
      var rh = Math.min(76, (944 - top) / Math.max(1, rows.length));
      rows.forEach(function (f, i) {
        var y = top + i * rh, mid = y + rh / 2;
        if (i % 2 === 0) {
          x.fillStyle = '#f4f6fa';
          roundRect(x, P - 16, y + 4, W - 2 * (P - 16), rh - 8, 13); x.fill();
        }
        x.fillStyle = '#c2c8d4'; x.font = '800 22px ' + DISP;
        x.textAlign = 'right'; x.fillText(String(i + 1), P + 8, mid + 7); x.textAlign = 'left';

        x.fillStyle = '#586275'; x.font = '700 17px ' + BODY;
        x.fillText(fit(x, f.date || '', 150), P + 34, mid + 6);

        badge(x, P + 210, mid, f.home, spec.palette, th);
        x.fillStyle = '#586275'; x.font = '600 16px ' + BODY;
        x.fillText('v', P + 264, mid + 5);
        badge(x, P + 282, mid, f.away, spec.palette, th);
        if (f.tag) leagueChip(x, P + 342, mid, f.tag, 62);

        if (f.top) {
          x.fillStyle = '#0c1322'; x.font = '700 20px ' + DISP;
          x.fillText(fit(x, f.top.name, 210), P + 560, mid - 1);
          x.fillStyle = probHex(f.top.prob); x.font = '700 15px ' + BODY;
          x.fillText((f.top.prob * 100).toFixed(0) + '% card', P + 560, mid + 20);
        } else {
          x.fillStyle = '#8b94a5'; x.font = '600 17px ' + BODY;
          x.fillText('—', P + 560, mid + 6);
        }

        x.fillStyle = heatHex(f.heat, spec.heatMid, spec.heatHot);
        x.font = '800 32px ' + DISP; x.textAlign = 'right';
        x.fillText(f.heat.toFixed(1), W - P, mid + 1);
        x.textAlign = 'left';
      });

      /* WHAT IS NOT ON THE CARD, on the card. Eight of 1,312 is a severe cut
         and the reader cannot tell eight-of-eight from eight-of-1,312 by
         looking, so the denominator is drawn rather than left to whoever
         writes the caption. */
      var cov = spec.coverage || {};
      if (cov.matches) {
        x.fillStyle = '#8b94a5'; x.font = '600 17px ' + BODY;
        var line = 'Hottest ' + rows.length + ' of ' + cov.matches + ' match'
          + (cov.matches === 1 ? '' : 'es') + ' across ' + cov.dates + ' date'
          + (cov.dates === 1 ? '' : 's') + (cov.filter ? ' · ' + cov.filter : '');
        x.fillText(fit(x, line, W - 2 * P), P, 966);
      }

      accaStrip(x, th, (spec.legs || []), 1046,
                spec.accaHeading || 'ACCA BUILDER · ACROSS DATES', 'ALL BOOKED');
      footer(x, th, spec.note ||
        'Legs on different days · research, not a guarantee');
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
  /* Delegates to assets/save.js, which routes a phone to the native share
     sheet — iOS Safari ignores `download` on a blob: URL, so the anchor below
     is a dead button on an iPhone and every card on every desk went out
     through it. The inline anchor is KEPT as a fallback rather than made a
     hard dependency: share.js is loaded on its own inside the guard's VM,
     where no DOM module exists. */
  function download(blob, name) {
    if (root.PLDSave) return root.PLDSave.file(blob, name, 'image/png');
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
    matchCard: matchCard, roundCard: roundCard, calendarCard: calendarCard,
    deskMatchSpec: deskMatchSpec, deskRoundSpec: deskRoundSpec,
    download: download, slug: slug,
    heatHex: heatHex, probHex: probHex, textOn: textOn,
    roundRect: roundRect, fit: fit, drawMark: drawMark
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

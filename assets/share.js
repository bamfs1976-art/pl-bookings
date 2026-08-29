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
     thumbnail size, so they are the only things a desk MUST supply.
     ---------------------------------------------------------------------
     THE COLOURS HERE ARE A COPY, and the only copy of the palette that a
     stylesheet cannot supply — this draws to a canvas, where var(--ll) means
     nothing. So they are pinned to assets/tw.css by scripts/check-palette.mjs,
     under two rules it enforces in both directions:

         to  === the league's own mark   (--pl / --eflc / --ll / --all)
         ink === that desk's light --accent
         lg  === the class its page puts on <html>

     Without the guard this file is exactly where a rebrand goes unnoticed: a
     share card is the one artefact that LEAVES the site, so nobody who sees
     one can hold it up against the page it came from. */
  var THEMES = {
    PL: {
      from: '#3d195b', to: '#e90052', ink: '#3d195b',
      strap: 'BOOKINGS DESK · PREMIER LEAGUE', mark: 'PL BOOKINGS DESK',
      slug: 'pl-bookings', tag: 'PL', lg: 'lg-pl'
    },
    EFLC: {
      /* ink was #4c1d95 — a violet a shade off the #4b2e83 the desk itself
         wears. Near enough to look deliberate and far enough to be wrong. */
      from: '#1e1b4b', to: '#7c3aed', ink: '#4b2e83',
      strap: 'BOOKINGS DESK · EFL CHAMPIONSHIP', mark: 'CHAMPIONSHIP BOOKINGS',
      slug: 'eflc-bookings', tag: 'EFLC', lg: 'lg-eflc'
    },
    LL: {
      from: '#7f1d1d', to: '#ea580c', ink: '#9a3412',
      strap: 'BOOKINGS DESK · LA LIGA', mark: 'LA LIGA BOOKINGS',
      slug: 'laliga-bookings', tag: 'LL', lg: 'lg-ll'
    },
    ALL: {
      from: '#0f172a', to: '#0891b2', ink: '#0e7490',
      strap: 'BOOKINGS DESK · ALL LEAGUES', mark: 'BOOKINGS DESK',
      slug: 'bookings-desk', tag: 'ALL', lg: 'lg-all'
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

  /* WIDTH AND HEIGHT ARE ARGUMENTS NOW, defaulting to the portrait card every
     existing caller draws. The stat sheet is landscape, and the alternative —
     its own band and its own footer — would have put a second copy of the 18+
     line on the page. That line is the one piece of text on a share card that
     is not allowed to drift, so there is still exactly one of it. */
  function brandBand(x, th, title, subtitle, w) {
    w = w || W;
    var g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, th.from); g.addColorStop(1, th.to);
    x.fillStyle = g; x.fillRect(0, 0, w, 168);
    drawMark(x, w - P - 30, 84, 86);
    x.fillStyle = 'rgba(255,255,255,.82)'; x.font = '700 22px ' + BODY;
    x.fillText(th.strap, P, 66);
    x.fillStyle = '#ffffff'; x.font = '800 46px ' + DISP;
    x.fillText(fit(x, title, w - P - 150), P, 126);
    x.fillStyle = '#586275'; x.font = '600 22px ' + BODY;
    x.fillText(String(subtitle || ''), P, 210);
  }

  function footer(x, th, note, w, h) {
    w = w || W; h = h || H;
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
    x.fillText(fixed, P, h - 50);
    var used = x.measureText(fixed + ' · ').width;
    var room = w - 2 * P - markW - 24 - used;
    if (room > 60) {
      x.fillStyle = '#a8b0be';
      x.fillText(fit(x, note, room), P + used, h - 50);
    }
    x.fillStyle = th.ink; x.font = '800 20px ' + DISP;
    x.textAlign = 'right'; x.fillText(th.mark, w - P, h - 50); x.textAlign = 'left';
  }

  function canvas(w, h) {
    w = w || W; h = h || H;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
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

  /* ---- faces and badges on the canvas ------------------------------------
   *
   * The one rule that matters here: `crossOrigin = 'anonymous'` IS WHAT MAKES
   * THIS SAFE, and it is not an optimisation. Draw a cross-origin image onto a
   * canvas without it and the canvas becomes TAINTED — every later toBlob()
   * throws SecurityError, so a single unlucky badge does not lose a badge, it
   * loses the whole card, and it does so in a way that looks like the export
   * button is broken. With the attribute set the browser refuses the image
   * unless the host sent Access-Control-Allow-Origin, and a refused image
   * fires `error` and is never drawn. So the canvas cannot be tainted, and the
   * worst case is the monogram this file drew before any of this existed.
   *
   * WHETHER THE HOSTS SEND THAT HEADER IS NOT KNOWN HERE — both are blocked
   * from the sandbox this was written in, so the fallback is not a nicety, it
   * is the branch that was actually tested. Nothing about the card depends on
   * a photograph arriving.
   *
   * AND IT NEVER BLOCKS. A share card that waited on a dead host would fail
   * exactly when someone wanted it (see the file header), so every load is
   * raced against a deadline and a slow image simply loses. Results are cached
   * for the session: the club card asks for the same twenty badges every time.
   */
  var IMG_MS = 2500;
  var imgCache = {};
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (imgCache[url]) return imgCache[url];
    var p = new Promise(function (res) {
      var done = false, img = new Image();
      var settle = function (v) { if (!done) { done = true; res(v); } };
      img.crossOrigin = 'anonymous';
      img.onload = function () { settle(img.naturalWidth ? img : null); };
      img.onerror = function () { settle(null); };
      setTimeout(function () { settle(null); }, IMG_MS);
      img.src = url;
    });
    imgCache[url] = p;
    return p;
  }

  /* Every image a spec asks for, resolved before a pixel is drawn — the draw
     itself stays synchronous, which is what keeps the layout arithmetic in one
     readable pass rather than scattered across callbacks. */
  function loadAll(urls) {
    var want = [];
    (urls || []).forEach(function (u) { if (u && want.indexOf(u) < 0) want.push(u); });
    return Promise.all(want.map(loadImage)).then(function (imgs) {
      var by = {};
      want.forEach(function (u, i) { by[u] = imgs[i]; });
      return by;
    });
  }

  /* A round portrait, or the initials in a coloured disc. The monogram is the
     SAME answer the page gives for the same player (assets/profile.js), which
     is the point: a card that drew a blank where the page draws initials would
     read as a card that failed to load rather than a face nobody has. */
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function hueOf(seed) {
    var s = String(seed || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function face(x, img, name, seed, cx, cy, d) {
    var r = d / 2;
    x.save();
    x.beginPath(); x.arc(cx + r, cy + r, r, 0, Math.PI * 2); x.clip();
    if (img) {
      /* COVER, not fit. The feed's portraits are head-and-shoulders on a wide
         plate, and letterboxing one into a circle puts the face in the middle
         third with grey above and below it. */
      var s = Math.max(d / img.naturalWidth, d / img.naturalHeight);
      var iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      x.drawImage(img, cx + (d - iw) / 2, cy + (d - ih) / 2, iw, ih);
    } else {
      x.fillStyle = 'hsl(' + hueOf(seed || name) + ' 45% 38%)';
      x.fillRect(cx, cy, d, d);
      x.fillStyle = '#ffffff';
      x.font = '800 ' + Math.round(d * 0.4) + 'px ' + BODY;
      x.textAlign = 'center';
      x.fillText(initials(name), cx + r, cy + r + d * 0.14);
      x.textAlign = 'left';
    }
    x.restore();
  }

  /* A club badge, or the code on the club's own colour — the same ladder the
     text badge() already walked, with one rung added on top. */
  function crestOn(x, img, short, palette, th, cx, cy, d) {
    if (!img) return badge(x, cx, cy + d / 2, short, palette, th, d, d);
    var s = Math.min(d / img.naturalWidth, d / img.naturalHeight);
    var iw = img.naturalWidth * s, ih = img.naturalHeight * s;
    /* CONTAIN for a badge, where cover is right for a face: a crest is a
       designed shape and cropping it is how a club's mark stops being its
       mark. */
    x.drawImage(img, cx + (d - iw) / 2, cy + (d - ih) / 2, iw, ih);
    return cx + d;
  }

  /* ---- the acca strip --------------------------------------------------- */
  /* Combined chance assumes the legs are independent, which is a research
     estimate rather than a price: two bookings in the SAME match are
     correlated (one flashpoint, two cards), and the note under every card
     says so. Cross-match legs are much closer to genuinely independent, which
     is why the combined and matchday cards can carry the same strip honestly. */
  function accaStrip(x, th, legs, y, heading, rightLabel) {
    /* ONE LEG PER PLAYER, and the cut to three AFTER that — the rule that
       stopped a calendar card printing "Lundstram + Cuenca + Lundstram", and
       the one that stopped it printing "not enough rated players for a combo"
       over eight rated fixtures.

       IT LIVES IN assets/accas.js NOW. It was here, and separately inline in
       index.html twice, and only this copy had the de-duplication — the other
       two were correct only because their inputs happened to hold one leg per
       player. The /accas page renders the same combos as HTML, which would
       have made a fourth copy. */
    var A = root.PLDAccas
      || (typeof require === 'function' ? require('./accas.js') : null);
    if (!A) throw new Error('share.js needs assets/accas.js loaded before it');
    var rows = A.comboRows(legs);
    x.fillStyle = '#8b94a5'; x.font = '700 16px ' + BODY;
    x.fillText(heading, P, y - 18);
    x.textAlign = 'right'; x.fillText(rightLabel, W - P, y - 18); x.textAlign = 'left';

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


  /* ---- the stat sheet --------------------------------------------------- */
  /*
   * A LANDSCAPE THREE-COLUMN DOSSIER, in the shape the betting-graphic houses
   * use: each club down one side, the match itself down the middle. It reads
   * at a glance in a timeline, which the portrait card does not — that one is
   * a ranked list and answers "who is likeliest booked", where this answers
   * "what am I looking at".
   *
   * EVERY PANEL IS A BOOKINGS PANEL. The graphics this borrows its shape from
   * rank goals, assists, shots and saves, none of which this desk models or
   * has any business implying it does. The columns here are the four things
   * that actually drive a card — yellows per 90, fouls committed, fouls won,
   * and the season's cautions — plus the desk's own P(card) for this fixture,
   * which is the one number a stats graphic cannot print.
   *
   * The referee panel drops "penalties per game" for CARDS PER FOUL. Penalties
   * are not in the match records this desk builds referees from, so that field
   * is null for every official in all three divisions; cards per foul is both
   * available and the better question — how readily this official reaches for
   * the card once a foul has been given.
   *
   * spec = {
   *   league, title, subtitle, note, palette, filename,
   *   home / away: { short, name, panels: [{label, unit, rows: [{n, v}]}] },
   *   ref:   { line, stats: [{label, value}] },
   *   match: { expected, heatLabel, cells: [{label, value, tone}] },
   *   h2h:   { label, rows: [{left, right}] }
   * }
   */
  var SW = 1600, SH = 1000;

  function panelStack(x, th, side, cx, cy, cw, palette, avail) {
    var col = clubColour(side.short, palette, th);
    x.fillStyle = col; roundRect(x, cx, cy, cw, 62, 14); x.fill();
    x.fillStyle = textOn(col); x.font = '800 30px ' + DISP;
    x.textAlign = 'center';
    x.fillText(fit(x, (side.name || side.short || '').toUpperCase(), cw - 32), cx + cw / 2, cy + 42);
    x.textAlign = 'left';

    var panels = (side.panels || []).slice(0, 4);
    if (!panels.length) return;
    var gap = 14, top = cy + 62 + gap;
    var ph = Math.floor((avail - (cy + 62 + gap) - (panels.length - 1) * gap) / panels.length);
    panels.forEach(function (pn, i) {
      var py = top + i * (ph + gap);
      x.fillStyle = '#f4f6fa'; roundRect(x, cx, py, cw, ph, 12); x.fill();
      x.fillStyle = '#8b94a5'; x.font = '700 15px ' + BODY;
      x.fillText(pn.label.toUpperCase(), cx + 14, py + 24);
      if (pn.unit) {
        x.textAlign = 'right';
        x.fillText(pn.unit.toUpperCase(), cx + cw - 14, py + 24);
        x.textAlign = 'left';
      }
      var rows = (pn.rows || []).slice(0, 5);
      /* A panel with nothing in it says so. A desk with no rated players is an
         ordinary early-season state, and five blank lines read as a broken
         card rather than a thin squad. */
      if (!rows.length) {
        x.fillStyle = '#a8b0be'; x.font = '600 17px ' + BODY;
        x.fillText('no rated players yet', cx + 14, py + 54);
        return;
      }
      var rh = Math.min(30, (ph - 34) / rows.length);
      rows.forEach(function (r, j) {
        var ry = py + 32 + j * rh + rh - 8;
        x.fillStyle = '#c2c8d4'; x.font = '700 15px ' + DISP;
        x.fillText(String(j + 1) + '.', cx + 14, ry);
        x.fillStyle = '#0c1322'; x.font = '600 19px ' + BODY;
        x.fillText(fit(x, r.n, cw - 130), cx + 44, ry);
        x.fillStyle = th.ink; x.font = '800 19px ' + DISP;
        x.textAlign = 'right'; x.fillText(String(r.v), cx + cw - 14, ry);
        x.textAlign = 'left';
      });
    });
  }

  function statSheetCard(spec) {
    return ready().then(function () {
      var th = theme(spec.league), k = canvas(SW, SH), x = k.x;
      brandBand(x, th, spec.title, spec.subtitle, SW);

      var P2 = 40, gap = 20, sideW = 450;
      var centreX = P2 + sideW + gap;
      var centreW = SW - 2 * P2 - 2 * sideW - 2 * gap;
      var top = 232, bottom = SH - 96;

      panelStack(x, th, spec.home || {}, P2, top, sideW, spec.palette, bottom);
      panelStack(x, th, spec.away || {}, SW - P2 - sideW, top, sideW, spec.palette, bottom);

      /* ---- the middle column ---- */
      var cy = top;
      /* THE REFEREE, first and largest, because he is the biggest single
         multiplier this desk applies and the reason two identical squads price
         differently on two weekends. */
      var rf = spec.ref || {};
      x.fillStyle = '#0c1322'; roundRect(x, centreX, cy, centreW, 132, 14); x.fill();
      x.fillStyle = 'rgba(255,255,255,.6)'; x.font = '700 15px ' + BODY;
      x.textAlign = 'center';
      x.fillText('REFEREE', centreX + centreW / 2, cy + 28);
      x.fillStyle = '#ffffff'; x.font = '800 30px ' + DISP;
      x.fillText(fit(x, rf.line || 'Not yet appointed', centreW - 28), centreX + centreW / 2, cy + 64);
      var rs = (rf.stats || []).slice(0, 4), rw = centreW / Math.max(1, rs.length);
      rs.forEach(function (st, i) {
        var sx = centreX + i * rw + rw / 2;
        x.fillStyle = '#ffd84d'; x.font = '800 26px ' + DISP;
        x.fillText(String(st.value), sx, cy + 106);
        /* 12px, measured: "YELLOWS PER GAME" is the longest of the four and
           at 13px it ran a hair over its quarter of the panel and came out as
           "YELLOWS PER GA…". The labels are not abbreviated instead, because
           three of these four are per game and one — cards per foul — is a
           ratio, and a blanket "per game" heading would be wrong about it. */
        x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '600 12px ' + BODY;
        x.fillText(fit(x, st.label.toUpperCase(), rw - 8), sx, cy + 124);
      });
      x.textAlign = 'left';
      cy += 132 + 18;

      /* ---- the match itself ---- */
      /* IT TAKES WHATEVER THE HEAD TO HEAD DOES NOT NEED. This was the other
         way round — the match box was a fixed 150 and h2h took the rest of the
         column — and it left white space in both directions. The combined page
         has no h2h files at all, so a card shared from there drew a third of
         the middle column empty; and every desk emits h2h as ONE summary line
         rather than a list of meetings, so even with h2h the row sat at the
         top of a box three hundred pixels tall. Sizing the smaller, fixed
         panel first and giving the surplus to the bigger one settles both. */
      var m = spec.match || {};
      var hRows = ((spec.h2h && spec.h2h.rows) || []).slice(0, 5);
      var hasH2H = !!hRows.length;
      var hh = hasH2H ? 46 + hRows.length * 34 : 0;
      var mh = bottom - cy - (hasH2H ? hh + 18 : 0);
      x.fillStyle = '#f4f6fa'; roundRect(x, centreX, cy, centreW, mh, 14); x.fill();
      x.textAlign = 'center';
      /* CENTRED IN WHATEVER HEIGHT THE BOX HAS. Anchored to the top it sat
         with a hole under it whenever the panel grew to fill a missing head to
         head. At the box's natural 150 this puts it within a pixel of where it
         always was, so the two cases are one expression rather than a branch. */
      var midY = cy + (mh - 26) / 2;
      /* AND IT GROWS WITH THE BOX. Centring alone left the number its old
         62px in a box three times the height, so the panel read as one small
         figure adrift in white. The floor is the height it has always been at
         the natural 150, so the head-to-head case is unchanged. */
      var efs = Math.max(62, Math.min(140, Math.round(mh * 0.32)));
      x.fillStyle = '#8b94a5'; x.font = '700 15px ' + BODY;
      x.fillText('EXPECTED CARDS', centreX + centreW / 2, midY - efs * 0.45);
      x.fillStyle = m.expected != null ? heatHex(m.expected, spec.heatMid, spec.heatHot) : '#64748b';
      x.font = '800 ' + efs + 'px ' + DISP;
      x.fillText(m.expected != null ? Number(m.expected).toFixed(1) : '—',
                 centreX + centreW / 2, midY + efs * 0.48);
      var cells = (m.cells || []).slice(0, 4), cwid = centreW / Math.max(1, cells.length);
      /* Pinned to the BOTTOM of the box, not to a fixed offset from its top —
         otherwise they stay up by the big number and float in a tall box. */
      var cellY = cy + mh - 28;
      cells.forEach(function (cl, i) {
        var sx = centreX + i * cwid + cwid / 2;
        x.fillStyle = '#0c1322'; x.font = '800 22px ' + DISP;
        x.fillText(String(cl.value), sx, cellY);
        x.fillStyle = '#8b94a5'; x.font = '600 13px ' + BODY;
        x.fillText(fit(x, cl.label.toUpperCase(), cwid - 10), sx, cellY + 18);
      });
      x.textAlign = 'left';
      cy += mh + 18;

      /* ---- head to head, in CARDS ---- */
      var h = spec.h2h;
      if (hasH2H) {
        x.fillStyle = '#f4f6fa'; roundRect(x, centreX, cy, centreW, hh, 14); x.fill();
        x.fillStyle = '#8b94a5'; x.font = '700 15px ' + BODY;
        x.textAlign = 'center';
        x.fillText((h.label || 'HEAD TO HEAD').toUpperCase(), centreX + centreW / 2, cy + 26);
        x.textAlign = 'left';
        var hr = hRows;
        var rh2 = Math.min(34, (hh - 40) / Math.max(1, hr.length));
        hr.forEach(function (r, i) {
          var ry = cy + 36 + i * rh2 + rh2 - 10;
          x.fillStyle = '#586275'; x.font = '600 18px ' + BODY;
          x.fillText(fit(x, r.left, centreW - 120), centreX + 16, ry);
          x.fillStyle = '#0c1322'; x.font = '800 18px ' + DISP;
          x.textAlign = 'right'; x.fillText(String(r.right), centreX + centreW - 16, ry);
          x.textAlign = 'left';
        });
      }

      footer(x, th, spec.note ||
        'Every figure is this desk’s own model · research, not a guarantee',
        SW, SH);
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
  /* ---- a ranked leaderboard, one to many panels ------------------------- */
  /*
   * spec = {
   *   league, title, subtitle, note,
   *   panels: [{ title, sub, code, rows: [{n, c, v}] }]
   * }
   *
   * ONE BUILDER FOR ALL THREE SECTIONS on /booked — the divisions, the last
   * five rounds, and every club. They differ only in how many panels there
   * are and what is in them, and a second builder is how the club card would
   * come to count a second yellow differently from the league card beside it.
   *
   * THE CANVAS FOLLOWS THE PANEL COUNT rather than the other way round. Three
   * panels of ten fit the portrait card every other share here uses; twenty-four
   * panels of five do not, at any font a phone can read. So a card with more
   * than four panels is drawn landscape on a grid, and the caller does not
   * choose — the shape of the data does. A fixed portrait card would have
   * produced twenty-four unreadable columns, and a fixed landscape one would
   * have made the three-division card mostly white.
   */
  function rankCard(spec) {
    var panels0 = (spec.panels || []).filter(function (p) { return p && p.rows; });
    var wanted = [];
    panels0.forEach(function (p) {
      if (p.img) wanted.push(p.img);
      (p.rows || []).forEach(function (r) {
        if (r.ph) wanted.push(r.ph);
        if (r.img) wanted.push(r.img);
      });
    });
    return Promise.all([ready(), loadAll(wanted)]).then(function (got) {
      var pics = got[1];
      var panels = panels0;
      var many = panels.length > 4;
      var w = many ? SW : W, pad = many ? 40 : P;
      /* 240 EITHER WAY. The landscape grid started at 210 and the subtitle
         brandBand draws at ~203 was overlapped by the first row of panels —
         the band is the same height on both canvases, so the content must
         start at the same place on both. */
      var top = 240, gap = many ? 14 : 18;
      /* The caller may fix the column count, and the last-five card does:
         its rows carry a cell per round and need the width, so three leagues
         are stacked rather than set side by side. Everything else lets the
         panel count decide. */
      var cols = spec.cols ? Math.max(1, spec.cols)
               : many ? Math.min(6, Math.ceil(Math.sqrt(panels.length * 1.6)))
                      : Math.max(1, panels.length);
      var rowsOf = Math.ceil(panels.length / cols) || 1;
      var cw = (w - 2 * pad - gap * (cols - 1)) / cols;

      /* THE CANVAS IS SIZED TO THE CONTENT, not the content to the canvas.
         Ten names in a panel a thousand pixels tall is the same defect the
         stat sheet's middle column had — a card that reads as though it
         failed to finish. Every other share here is a fixed portrait because
         its content is fixed; this one holds anywhere from five rows to
         twenty-four panels of five, so the height follows. */
      var rh = many ? 26 : 34;
      var limit = spec.limit || 10;
      var deepest = panels.reduce(function (m, p) {
        return Math.max(m, Math.min(p.rows.length, limit) || 1);
      }, 1);
      var headH = panels.some(function (p) { return p.sub; }) ? (many ? 52 : 58) : 44;
      var ch = headH + deepest * rh + 12;
      var footH = many ? 84 : 108;
      var h = Math.round(top + rowsOf * ch + gap * (rowsOf - 1) + footH);

      var th = theme(spec.league), k = canvas(w, h), x = k.x;
      brandBand(x, th, spec.title, spec.subtitle, w);

      panels.forEach(function (p, i) {
        var cx = pad + (i % cols) * (cw + gap);
        var cy = top + Math.floor(i / cols) * (ch + gap);
        x.fillStyle = '#f4f6fa'; roundRect(x, cx, cy, cw, ch, 14); x.fill();

        var hy = cy + 26;
        if (p.code) {
          var after = leagueChip(x, cx + 12, hy - 2, p.code);
          x.fillStyle = '#0c1322'; x.font = '800 17px ' + DISP;
          x.fillText(fit(x, p.title || '', cx + cw - 12 - after), after + 4, hy + 6);
        } else {
          /* The club card's panels are clubs, so the badge belongs in the
             heading — it is the only thing that names the club besides the
             text, and twenty-four text headings read as a spreadsheet. */
          var tx = cx + 12;
          if (p.img || p.short) {
            var bd = many ? 22 : 26;
            crestOn(x, p.img ? pics[p.img] : null, p.short || '',
                    spec.palette, th, tx, hy - bd + 4, bd);
            tx += bd + 8;
          }
          x.fillStyle = '#0c1322'; x.font = '800 ' + (many ? 16 : 19) + 'px ' + DISP;
          x.fillText(fit(x, p.title || '', cx + cw - 12 - tx), tx, hy + 4);
        }
        if (p.sub) {
          x.fillStyle = '#8b94a5'; x.font = '600 12px ' + BODY;
          x.fillText(fit(x, p.sub, cw - 24), cx + 12, hy + (p.code ? 24 : 22));
        }

        var listTop = cy + headH;
        var rows = p.rows.slice(0, limit);
        if (!rows.length) {
          x.fillStyle = '#8b94a5'; x.font = '600 13px ' + BODY;
          x.fillText('Nobody booked yet', cx + 12, listTop + 16);
          return;
        }
        var fs = many ? 14 : 17;
        /* WHICH ROUNDS, not just how many. A leaderboard says a man has two
           cards; the cells say he was booked in the last round and the one
           before, which is the shape of a run rather than a total. Drawn only
           when the caller supplies them, and reserved for BEFORE the name is
           fitted so a long name is truncated rather than drawn over them. */
        var cellW = 30, cellGap = 5;
        var cellsW = p.cells && p.cells.length
          ? p.cells.length * cellW + (p.cells.length - 1) * cellGap + 14 : 0;
        if (p.cells && p.cells.length) {
          x.fillStyle = '#8b94a5'; x.font = '600 11px ' + BODY;
          x.textAlign = 'center';
          p.cells.forEach(function (label, ci) {
            x.fillText(String(label),
              cx + cw - 12 - cellsW + 14 + ci * (cellW + cellGap) + cellW / 2,
              listTop - 8);
          });
          x.textAlign = 'left';
        }
        rows.forEach(function (r, j) {
          var ry = listTop + j * rh + rh - 9;
          x.fillStyle = '#b6bdca'; x.font = '700 ' + (fs - 3) + 'px ' + BODY;
          x.fillText(String(j + 1), cx + 12, ry);
          /* The value is drawn first, at the right edge, and the name fitted
             to what is left — so a long name is truncated and a card is never
             printed with its numbers overlapped by them. */
          x.textAlign = 'right';
          x.fillStyle = '#0c1322'; x.font = '800 ' + fs + 'px ' + DISP;
          x.fillText(String(r.v), cx + cw - 12, ry);
          var vw = x.measureText(String(r.v)).width;
          x.textAlign = 'left';
          if (r.cells) {
            r.cells.forEach(function (n, ci) {
              var bx = cx + cw - 12 - vw - 10 - cellsW + 14 + ci * (cellW + cellGap);
              var by = ry - rh + 10, bh = rh - 8;
              if (n > 0) {
                x.fillStyle = n > 1 ? '#b91c1c' : '#f2c200';
                roundRect(x, bx, by, cellW, bh, 6); x.fill();
                x.fillStyle = n > 1 ? '#fff' : '#3a2f00';
                x.font = '800 ' + (fs - 3) + 'px ' + DISP;
                x.textAlign = 'center';
                x.fillText(String(n), bx + cellW / 2, by + bh - 5);
                x.textAlign = 'left';
              } else {
                /* An empty round is drawn, not skipped: five cells always,
                   so the columns line up down the panel and a gap reads as a
                   match he got through rather than a missing round. */
                x.fillStyle = '#e6e9ef';
                roundRect(x, bx, by, cellW, bh, 6); x.fill();
              }
            });
          }
          /* THE FACE, between the rank and the name. Sized off the row so the
             portrait card's 34px rows and the landscape grid's 26px ones both
             hold one without crowding the text. */
          var nameX = cx + 12 + (fs > 15 ? 24 : 20);
          var fd = Math.min(rh - 8, many ? 20 : 26);
          face(x, r.ph ? pics[r.ph] : null, r.n, r.c, nameX, ry - fd + 4, fd);
          nameX += fd + 8;
          x.fillStyle = '#0c1322'; x.font = '700 ' + fs + 'px ' + BODY;
          var label = r.c ? r.n + '  ' + r.c : r.n;
          x.fillText(fit(x, label, cx + cw - 12 - vw - 10 - cellsW - 10 - nameX),
                     nameX, ry);
        });
      });

      footer(x, th, spec.note || 'Cards shown \u00b7 a second yellow counts once',
             w, h);
      return toBlob(k.c);
    });
  }

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
      /* THE CAVEAT TRAVELS WITH THE CARD. A card is read by people who cannot
         see the desk it came from, so a probability posted without the
         condition it was computed under is a stronger claim than the model can
         support: unless a team sheet is out, these prices assume expected
         minutes, which is a guess about who plays. Stated in the subtitle
         rather than as a new element, because the layout is fixed and a
         caption that overlaps the heat pill would be worse than no caption.

         `pricedOffXI` REPLACED `lineupsConfirmed`, and the difference is who
         is answering. The old flag was the READER'S mark — a button on each
         fixture reading "Lineups unconfirmed" that they clicked once they had
         seen the team sheet — so the card asserted something nobody had
         checked unless somebody remembered to check it. The desks now harvest
         the XI, so the pricing itself knows which basis it used and the card
         states that instead of asking.
         `undefined` means the desk does not report a basis and the card says
         nothing, which is why this is an explicit true/false test. */
      subtitle: [ctx.seasonLabel, f.r ? (ctx.roundWord || 'Matchday') + ' ' + f.r : null,
                 ctx.whenText ? ctx.whenText(f.d) : null,
                 ctx.pricedOffXI === true ? 'priced off the confirmed XI'
                   : ctx.pricedOffXI === false ? 'lineups not out — expected minutes'
                   : null]
                .filter(Boolean).join(' · '),
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


  /* The stat sheet, from the same priced fixture deskMatchSpec reads.
   *
   * ONE ADAPTER PER CARD, both fed by the desks' own `priced` row, so a figure
   * on the dossier and the same figure on the portrait card come from one
   * pricing rather than two readings of it.
   *
   * `squadOf(short)` is the desk's own player list for a club — the adapter
   * cannot reach into three different globals, so the caller passes the lookup
   * it already has.
   */
  function deskStatSheetSpec(priced, ctx) {
    var n1 = function (v) { return v == null ? '—' : Number(v).toFixed(1); };
    var n2 = function (v) { return v == null ? '—' : Number(v).toFixed(2); };
    var pc = function (v) { return v == null ? '—' : (v * 100).toFixed(0) + '%'; };
    var f = priced.fx, m = priced.m || {}, over = m.over || {};
    var ch = (ctx.clubBy && ctx.clubBy[f.h]) || {}, ca = (ctx.clubBy && ctx.clubBy[f.a]) || {};
    var squadOf = ctx.squadOf || function () { return []; };

    /* Top five by one field, dropping anyone the desk has no number for.
       A null is not a zero: a player with no minutes has no rate, and ranking
       him last would state that he never fouls. */
    function top(short, key, dp) {
      return squadOf(short)
        .filter(function (p) { return p && p[key] != null && !p.ls; })
        .sort(function (a, b) { return b[key] - a[key]; })
        .slice(0, 5)
        .map(function (p) {
          return { n: p.n, v: dp === 0 ? String(p[key]) : Number(p[key]).toFixed(dp) };
        });
    }
    /* The desk's own read on THIS fixture, which is the panel a stats graphic
       cannot print: not a season rate but a probability for tonight. */
    var cands = candidatesOf(priced, ctx.clubBy);
    function risk(short) {
      return cands
        .filter(function (c) { return c.club === short; })
        .slice(0, 5)
        .map(function (c) { return { n: c.name, v: (c.prob * 100).toFixed(0) + '%' }; });
    }
    function side(short, club) {
      return {
        short: short, name: club.name || short,
        panels: [
          { label: 'Booked tonight', unit: 'p(card)', rows: risk(short) },
          { label: 'Yellows', unit: 'per 90', rows: top(short, 'y', 2) },
          { label: 'Fouls committed', unit: 'per 90', rows: top(short, 'f', 2) },
          { label: 'Fouls won', unit: 'per 90', rows: top(short, 'fw', 2) }
        ]
      };
    }

    var r = priced.ref && priced.ref.ref;
    return {
      league: ctx.league,
      title: (ch.name || f.h) + '  v  ' + (ca.name || f.a),
      subtitle: [ctx.seasonLabel, f.r ? (ctx.roundWord || 'Matchday') + ' ' + f.r : null,
                 ctx.whenText ? ctx.whenText(f.d) : null].filter(Boolean).join(' · '),
      home: side(f.h, ch), away: side(f.a, ca),
      ref: {
        line: r ? r.n : (priced.ref && priced.ref.name) || 'Not yet appointed',
        /* CARDS PER FOUL, not penalties per game. Penalties are not in the
           match records the referee table is built from, so that field is null
           for every official in all three divisions — and how readily a
           referee cards a foul is the better question for this desk anyway. */
        stats: [
          { label: 'fouls per game', value: r ? n2(r.fpg) : '—' },
          { label: 'yellows per game', value: r ? n2(r.ypg) : '—' },
          { label: 'cards per foul', value: r && r.cpf != null ? Number(r.cpf).toFixed(3) : '—' },
          { label: 'reds per game', value: r ? n2(r.red) : '—' }
        ]
      },
      match: {
        expected: m.expected,
        cells: [
          { label: 'over 3.5', value: pc(over[3.5]) },
          { label: 'over 4.5', value: pc(over[4.5]) },
          { label: 'both carded', value: pc(m.bothCarded) },
          { label: 'both 2+', value: pc(m.bothTwo) }
        ]
      },
      h2h: ctx.h2hRows && ctx.h2hRows.length
        ? { label: 'Head to head · cards', rows: ctx.h2hRows } : null,
      heatMid: ctx.heatMid, heatHot: ctx.heatHot,
      palette: ctx.palette,
      filename: (theme(ctx.league).slug + '-sheet-' + slug(f.h) + '-' + slug(f.a) + '.png')
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

  /* ---- the acca card ------------------------------------------------------
   * One recommended acca as a 4:5 portrait PNG. Two states from one drawing:
   * OPEN is the recommendation, SETTLED is the result — and the second is the
   * one worth having, because anyone can post a tip and almost nobody posts
   * the tip that lost. A card that can only show winners is an advert; this
   * one draws WON and LOST identically and puts the P/L on both.
   *
   * spec: { league, title, subtitle, legs:[{player,club,prob,odds,carded}],
   *         stake, odds, status, pl, note }
   */
  function accaCard(spec) {
    return ready().then(function () {
      var th = theme(spec.league), k = canvas(), x = k.x;
      brandBand(x, th, spec.title, spec.subtitle);

      /* Ten is what fits above the money block without colliding with the
         footer, once the rows go single-line (see `compact` below). It was
         seven while every acca here was a treble; the nine-folds made eight
         and nine reachable, and truncating a nine-fold to seven under a price
         for all nine would have been the exact false claim this cap exists to
         prevent. Above ten the card must still SAY it was cut, because the
         price below it is the price of the whole acca. */
      var all = spec.legs || [], legs = all.slice(0, 10);
      var cut = all.length - legs.length;
      var settled = spec.status === 'won' || spec.status === 'lost';

      /* The blocks below the legs are BOTTOM-ANCHORED and the leg rows stretch
         to meet them. Laid out top-down instead, a three-leg acca — which is
         every acca this desk builds — left the bottom third of the card empty,
         and a 4:5 portrait with a third of it blank reads as a card that
         failed to load. */
      var MONEY_H = 132, MONEY_TOP = 1048;
      var EV_H = 112, EV_TOP = MONEY_TOP - 22 - EV_H;
      var LEGS_TOP = 340;

      /* Status first and large. On a phone timeline the card is read at about
         a third of this size, so the one thing that must survive the shrink is
         whether it came in. */
      /* 300, not 244: brandBand puts the subtitle's baseline at 210, and a
         ribbon drawn at 244 sat its box straight through it — the season and
         date were struck out by the word LOST on every settled card. */
      var y = 300;
      if (settled) {
        var won = spec.status === 'won';
        var lab = won ? 'WON' : 'LOST';
        x.font = '800 46px ' + DISP;
        var lw = x.measureText(lab).width + 52;
        x.fillStyle = won ? '#15803d' : '#b91c1c';
        roundRect(x, P, y - 44, lw, 62, 16); x.fill();
        x.fillStyle = '#fff'; x.textAlign = 'center';
        x.fillText(lab, P + lw / 2, y); x.textAlign = 'left';
        if (spec.pl != null) {
          x.fillStyle = won ? '#15803d' : '#b91c1c';
          x.font = '800 40px ' + DISP;
          var pl = (Number(spec.pl) < 0 ? '\u2212£' : '+£')
                 + Math.abs(Number(spec.pl)).toFixed(2);
          x.textAlign = 'right'; x.fillText(pl, W - P, y); x.textAlign = 'left';
        }
      } else {
        x.fillStyle = '#8b94a5'; x.font = '700 26px ' + BODY;
        /* all.length, not legs.length: the count is the acca's, and taking it
           from the drawn list would make a truncated card describe itself as
           complete. */
        x.fillText('OPEN · ' + all.length + ' LEGS', P, y - 8);
      }

      /* The legs. Numbered, because an acca is an ordered thing people read
         down, and marked once settled so a reader can see WHICH leg failed —
         "it lost" tells you nothing about the model. */
      var avail = EV_TOP - 22 - LEGS_TOP;
      /* TWO ROW SHAPES, chosen by what actually fits rather than by leg count.
         The stacked row draws a name and a second line 30px below it, which
         needs about 76px of slot; at eight legs and up there is not that much
         to give, and the second line lands outside its own stripe. So below
         the stacked minimum the row goes single-line: the two texts sit side
         by side and the price moves up beside the percentage.

         A THRESHOLD, not a leg count, so this cannot drift out of step with
         the geometry above it. At three legs `ideal` is 191 and the card is
         drawn exactly as it was before any of this. */
      var STACKED_MIN = 76;
      var ideal = Math.floor(avail / Math.max(1, legs.length));
      var compact = ideal < STACKED_MIN;
      var rowH = Math.max(compact ? 56 : STACKED_MIN, Math.min(170, ideal));
      legs.forEach(function (l, i) {
        var top = LEGS_TOP + i * rowH, mid = top + rowH / 2;
        /* The stripe is capped rather than filling the row slot. Rows stretch
           to fill the card, and a stripe that stretched with them drew a 158px
           panel around two lines of text — which reads as a box that failed to
           load its contents, not as banding. */
        var bh = Math.min(rowH - (compact ? 8 : 12), 104);
        x.fillStyle = i % 2 ? '#f7f9fc' : '#ffffff';
        roundRect(x, P - 12, mid - bh / 2, W - 2 * P + 24, bh, 14); x.fill();

        x.fillStyle = '#c3cad6'; x.font = '800 30px ' + DISP;
        x.fillText(String(i + 1), P, mid + (compact ? 10 : 8));

        /* `line1`/`line2` when the leg is a MATCH market — the fixture and the
           market it is a leg on. `player`/`club` when it is a player, which is
           what every acca here was until the nine-folds. Read in that order so
           neither caller has to pretend to be the other: a fixture is not a
           player and calling it one is how the next reader of this file
           mis-labels a card. */
        var line1 = l.line1 != null ? l.line1 : l.player;
        var line2 = l.line2 != null ? l.line2 : l.club;
        var tagged = l.legLeague && l.legLeague !== spec.league;

        /* THE TAG IS MEASURED BEFORE ANYTHING IS PLACED. In a compact row it
           sits in front of the fixture, so the fixture's x depends on it —
           drawing the tag afterwards at the same x painted the chip straight
           over the first two characters of every tagged row ("ARS v COV" read
           as "PL⟩S v COV"). Caught by rendering a card and looking at it. */
        var tagW = 0, tag = tagged ? String(l.legLeague) : '';
        if (tagged && compact) {
          x.font = '800 15px ' + DISP;
          tagW = x.measureText(tag).width + 18 + 12;   // chip padding, then a gap
        }
        var textX = P + 44 + tagW;

        if (tagged && compact) {
          x.fillStyle = '#e6eaf1';
          roundRect(x, P + 44, mid - 12, tagW - 12, 24, 8); x.fill();
          x.fillStyle = '#586275'; x.font = '800 15px ' + DISP; x.textAlign = 'center';
          x.fillText(tag, P + 44 + (tagW - 12) / 2, mid + 5); x.textAlign = 'left';
        }

        x.fillStyle = '#0c1322'; x.font = '800 ' + (compact ? 28 : 34) + 'px ' + DISP;
        /* The right-hand reserve is the percentage, the price and the gap
           between them — bigger in a compact row because they sit side by side
           there rather than stacked. */
        var nameMax = W - P - textX - (compact ? 210 : 200);
        var name = fit(x, line1, nameMax);
        x.fillText(name, textX, mid + (compact ? 10 : -2));

        if (compact) {
          /* The market beside the fixture, not under it. Measured off the DRAWN
             name so the gap holds whether or not the fixture was truncated. */
          var nw = x.measureText(name).width;
          x.fillStyle = '#586275'; x.font = '600 19px ' + BODY;
          x.fillText(fit(x, String(line2 || ''), W - P - textX - nw - 224),
                     textX + nw + 14, mid + 10);
        } else {
          x.fillStyle = '#586275'; x.font = '600 20px ' + BODY;
          x.fillText(String(line2 || ''), P + 44, mid + 28);
        }

        /* The league tag, when the leg is not from the card's own division.
           On the cross-league acca no leg matches, so every row is tagged —
           which is the point: without it that card is three club codes and a
           reader guessing which competition each came from, the same defect
           the combined round card is already guarded against. Omitted when
           the row never recorded a league, rather than guessed at. */
        /* Stacked rows tag AFTER the club, on the second line, where there is
           room — the compact branch above has already drawn its own. */
        if (tagged && !compact) {
          x.font = '600 20px ' + BODY;
          var tw = x.measureText(String(line2 || '')).width;
          x.font = '800 15px ' + DISP;
          var tgw = x.measureText(tag).width + 18;
          x.fillStyle = '#e6eaf1';
          roundRect(x, P + 56 + tw, mid + 12, tgw, 24, 8); x.fill();
          x.fillStyle = '#586275'; x.textAlign = 'center';
          x.fillText(tag, P + 56 + tw + tgw / 2, mid + 29); x.textAlign = 'left';
        }

        /* Probability and price on the right, price under it: the percentage
           is the model's claim and the price is what it is worth, and putting
           them apart invites reading one without the other. */
        x.textAlign = 'right';
        var rx = W - P - (settled ? 62 : 0);
        if (compact) {
          /* Side by side rather than stacked, for the same reason the texts
             are: there is no second baseline in a 63px row. */
          x.fillStyle = '#586275'; x.font = '700 21px ' + BODY;
          x.fillText(Number(l.odds).toFixed(2), rx, mid + 10);
          x.fillStyle = probHex(l.prob); x.font = '800 30px ' + DISP;
          x.fillText(Math.round(l.prob * 100) + '%', rx - 84, mid + 10);
        } else {
          x.fillStyle = probHex(l.prob);
          x.font = '800 34px ' + DISP;
          x.fillText(Math.round(l.prob * 100) + '%', rx, mid - 2);
          x.fillStyle = '#586275'; x.font = '700 22px ' + BODY;
          x.fillText(Number(l.odds).toFixed(2), rx, mid + 28);
        }
        x.textAlign = 'left';

        if (settled && l.carded != null) {
          x.fillStyle = l.carded ? '#15803d' : '#b91c1c';
          x.font = '800 40px ' + DISP;
          x.textAlign = 'center';
          x.fillText(l.carded ? '\u2713' : '\u2717', W - P - 22, mid + 14);
          x.textAlign = 'left';
        }
      });
      if (cut > 0) {
        x.fillStyle = '#b91c1c'; x.font = '700 19px ' + BODY;
        x.fillText('+ ' + cut + ' more leg' + (cut > 1 ? 's' : '')
          + ' not shown — the price below is for all ' + all.length + '.',
          P, LEGS_TOP + legs.length * rowH + 24);
      }

      /* ---- what the price is actually worth ------------------------------
       * The one number that makes this card research rather than a tip. A
       * treble at 60.36 needs to land 1.66% of the time to break even; the
       * model says 1.38%; the difference is the edge, and here it is negative.
       * Printing the price without it is how a share card becomes an advert.
       *
       * The combined chance comes from the FAIR odds where the row carries
       * them, so the card cannot disagree with the database that logged it;
       * the product of the legs is a fallback, and it is only defensible
       * because these accas take at most one leg per match — two bookings in
       * one match share a flashpoint and are not independent.
       */
      var p = spec.fairOdds ? 1 / Number(spec.fairOdds)
        : legs.reduce(function (t, l) { return t * Number(l.prob); }, 1);
      var oddsN = Number(spec.odds || 0);
      var be = oddsN ? 1 / oddsN : 0;
      var edge = oddsN ? p * oddsN - 1 : 0;
      x.fillStyle = '#f2f5f9';
      roundRect(x, P - 12, EV_TOP, W - 2 * P + 24, EV_H, 18); x.fill();
      var ev = [
        ['MODEL CHANCE', (p * 100).toFixed(2) + '%', '#0c1322'],
        ['BREAK-EVEN', (be * 100).toFixed(2) + '%', '#0c1322'],
        ['EDGE', (edge < 0 ? '\u2212' : '+') + Math.round(Math.abs(edge) * 100)
          + 'p in £1', edge < 0 ? '#b91c1c' : '#15803d']
      ];
      var evw = (W - 2 * P + 24) / ev.length;
      ev.forEach(function (c, i) {
        var cx = P - 12 + evw * i + evw / 2;
        x.textAlign = 'center';
        x.fillStyle = '#7c8698'; x.font = '700 17px ' + BODY;
        x.fillText(c[0], cx, EV_TOP + 40);
        x.fillStyle = c[2]; x.font = '800 34px ' + DISP;
        x.fillText(c[1], cx, EV_TOP + 84);
        x.textAlign = 'left';
      });

      /* The money. Stake, price, and what it returns — stated once, plainly,
         so the card cannot be read as a bigger claim than it is. */
      x.fillStyle = th.ink;
      roundRect(x, P - 12, MONEY_TOP, W - 2 * P + 24, MONEY_H, 18); x.fill();
      var stake = Number(spec.stake || 0.5);
      var cells = [
        ['STAKE', '£' + stake.toFixed(2)],
        ['ODDS', oddsN.toFixed(2)],
        /* Three labels, not two. "WOULD HAVE RETURNED" on a winner is wrong —
           it did return — and "RETURNS" on a loser implies it still might. */
        [spec.status === 'won' ? 'RETURNED'
          : spec.status === 'lost' ? 'WOULD HAVE RETURNED' : 'RETURNS',
         '£' + (stake * oddsN).toFixed(2)]
      ];
      var cw = (W - 2 * P + 24) / cells.length;
      cells.forEach(function (c, i) {
        var cx = P - 12 + cw * i + cw / 2;
        x.textAlign = 'center';
        x.fillStyle = 'rgba(255,255,255,.72)'; x.font = '700 17px ' + BODY;
        x.fillText(c[0], cx, MONEY_TOP + 44);
        x.fillStyle = '#ffffff'; x.font = '800 40px ' + DISP;
        x.fillText(c[1], cx, MONEY_TOP + 96);
        x.textAlign = 'left';
      });

      /* The margin note is NOT optional decoration. These odds are the fair
         price shaded by a typical card-market margin, taken once per leg, and
         a card that shows a 60.00 treble without saying so is advertising a
         number nobody could have backed. */
      /* Kept short on purpose: footer() gives the note whatever room the 18+
         line and the wordmark leave, and the longer first draft was cut off
         mid-word on every card. */
      /* Short enough to survive the widest wordmark ("CHAMPIONSHIP BOOKINGS"),
         which is the one that truncated the previous draft mid-word. */
      footer(x, th, spec.note || 'Model price, margin per leg. Set pre-KO.');
      /* A BLOB, like every other card here. Returning the canvas would have
         worked right up to `download()`, which hands it to PLDSave.file() and
         gets a File constructed from an object with no bytes — a 0-byte PNG
         that saves without erroring. */
      return toBlob(k.c);
    });
  }

  /* A logged acca row (and its legs) as a card spec.
   *
   * HERE RATHER THAN IN THE PAGE. The tracker is the only reader today, but
   * the row shape is the database's, not the page's, and every time this
   * project has kept a mapping next to one of its readers a second reader has
   * appeared and copied it. The columns are named once, in the module that
   * draws them.
   *
   * Titles come from the row, not from a lookup: `matchday` is null for the
   * cross-league acca by design, and that null is the thing that distinguishes
   * "across the leagues on one date" from "matchday 3", so it is read rather
   * than defaulted away.
   */
  function accaRowSpec(row, legs) {
    var th = theme(row.league);
    var md = row.matchday == null;
    var day = String(row.kickoff_first || '').slice(0, 10);
    return {
      league: row.league,
      title: md ? 'Across the leagues' : 'Matchday ' + row.matchday,
      subtitle: [row.season, day].filter(Boolean).join(' · '),
      legs: (legs || []).map(function (l) {
        return {
          player: l.player, club: l.club, legLeague: l.league || null,
          prob: Number(l.prob),
          odds: Number(l.priced_odds),
          carded: l.carded
        };
      }),
      stake: Number(row.stake), odds: Number(row.priced_odds),
      /* Carried so the card's "model chance" is the number the job logged,
         not one the card recomputes from rounded leg probabilities and then
         quietly disagrees with the row it came from. */
      fairOdds: Number(row.fair_odds) || null,
      status: row.status, pl: row.pl,
      filename: th.slug + '-acca-' + slug(md ? 'all-' + day : 'md' + row.matchday) + '.png'
    };
  }

  /* A NINE-FOLD as a card spec. The legs are MATCH markets, not players, so
   * they fill line1/line2 (the fixture, then the market) rather than
   * player/club — see the row drawing above.
   *
   * HERE RATHER THAN IN THE PAGES, for the reason accaRowSpec is: two pages
   * build a nine-fold now, the goals one on the Premier League desk and the
   * card one on /today, and a mapping kept beside one reader has been copied
   * by the next one every time this project has tried it.
   *
   * NO STAKE FIELD. accaCard defaults it to the 50p the logged accas use, and
   * these are not logged, staked or settled — they are a view of what the
   * model currently likes. The card's status stays open and its legs carry no
   * `carded`, so nothing draws a tick or a cross.
   *
   * spec in: { league, title, subtitle, legs:[{fx, market, code, prob}],
   *            price (an accaPrice result), note }
   */
  function nineFoldSpec(spec) {
    var th = theme(spec.league);
    var price = spec.price || {};
    return {
      league: spec.league,
      title: spec.title,
      subtitle: spec.subtitle,
      legs: (spec.legs || []).map(function (l) {
        return {
          line1: l.fx, line2: l.market,
          /* Tagged with its division only when it differs from the card's own
             — the drawing applies that rule, and passing the code always is
             what lets it. On the cross-league card every row is tagged; on the
             Premier League goals card none is, because the band already says
             it once. */
          legLeague: l.code || null,
          prob: Number(l.prob),
          /* FAIR odds per leg, which is what both pages print beside each leg.
             The whole-acca price below is the MARGINED one, so the two columns
             are not the same kind of number and the footer says which is
             which — a card whose legs and total disagreed about that would
             read as an arithmetic error. */
          odds: 1 / Number(l.prob),
          carded: null
        };
      }),
      odds: Number(price.pricedOdds) || 0,
      /* The whole acca's own fair odds, so MODEL CHANCE is the number the page
         printed rather than one the card recomputes from rounded legs and then
         quietly disagrees with. */
      fairOdds: Number(price.fairOdds) || null,
      status: 'open',
      note: spec.note || 'Fair odds per leg; margined total.',
      filename: th.slug + '-' + slug(spec.title || 'ninefold') + '.png'
    };
  }

  root.PLDShare = {
    W: W, H: H, PAD: P,
    THEMES: THEMES, theme: theme,
    matchCard: matchCard, roundCard: roundCard, calendarCard: calendarCard,
    statSheetCard: statSheetCard, SHEET_W: SW, SHEET_H: SH,
    rankCard: rankCard,
    accaCard: accaCard, accaRowSpec: accaRowSpec, nineFoldSpec: nineFoldSpec,
    deskMatchSpec: deskMatchSpec, deskRoundSpec: deskRoundSpec,
    deskStatSheetSpec: deskStatSheetSpec,
    download: download, slug: slug,
    heatHex: heatHex, probHex: probHex, textOn: textOn,
    roundRect: roundRect, fit: fit, drawMark: drawMark
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

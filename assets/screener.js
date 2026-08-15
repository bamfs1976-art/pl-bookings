/* The player screener — the whole division in one filterable grid.
 *
 * WHY TABULATOR AND NOT THE TABLE NEXT DOOR. The Season table on this same
 * panel is hand-rolled, sorts on click and renders every row it is given. That
 * is fine at 400 rows and it is what most people want. The screener is the
 * other job: 667 players, nine columns, three filters and a slider, re-sorted
 * and re-filtered continuously — which is where a hand-rolled table starts
 * repainting the document on every keystroke. Tabulator's virtual renderer
 * keeps ~30 rows in the DOM whatever the filter says, so the slider is smooth
 * at full squad depth.
 *
 * THE 450-MINUTE FLOOR IS NOT A FILTER. Below the floor a per-90 rate is an
 * artefact of its denominator, and the temptation is to drop those rows. This
 * does not: they render greyed, badged "low sample", and sort below their
 * value. A screener that silently omits a squad's back-up centre-half looks
 * complete and is not, and the reader has no way to tell. The minutes slider
 * CAN hide rows — that is what it is for — but the count it hides is printed
 * next to it, so hiding is always something the reader did on purpose and can
 * see the size of.
 *
 * EVERY NUMBER OPENS. The "why" button on each row expands the full working of
 * that player's fixture probability: his raw rate, the shrinkage, the minutes
 * share, and each of the three fixture factors with where it came from. It
 * renders assets/cardmodel.js's own `working` object, so the explanation
 * cannot drift from the arithmetic.
 *
 * RENDERING IS DOM, NEVER HTML STRINGS. Tabulator inserts a formatter's string
 * return as innerHTML. Player names are data — they carry apostrophes and they
 * come from a feed — so every formatter here returns an element it built, or a
 * string it escaped. Same rule as the rest of the desk.
 *
 * DEPENDENCIES: Tabulator (MIT) and jStat (MIT) through assets/cardmodel.js,
 * both vendored into index.html.
 */
(function (root) {
  'use strict';

  var FLOOR = 450;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function num(x) {
    return typeof x === 'number' && isFinite(x) ? x : null;
  }
  function fmt(x, dp) {
    var v = num(x);
    return v == null ? '—' : v.toFixed(dp == null ? 2 : dp);
  }
  function pct(x, dp) {
    var v = num(x);
    return v == null ? '—' : (v * 100).toFixed(dp == null ? 1 : dp) + '%';
  }

  /* ---- sorting -----------------------------------------------------------
     Two things must be true whichever way a column is pointing, so both are
     handled here rather than per column.

     NULLS LAST. Tabulator's default floats them to the top of a descending
     sort, which presents every player with no card record as the answer to
     "who is most likely to be booked".

     AND THE FLOOR SORTS BELOW ITS VALUE. This is the one that matters. A
     player with one minute and one foul carries a fouls-per-90 of 90.0 and a
     risk score of 90 — arithmetically true, completely meaningless, and top of
     every sort in the division. Rows under the minutes floor are therefore
     kept BELOW rows above it in every sort, then ordered among themselves by
     whatever column was asked for. They are still all there, still greyed,
     still badged; they are just not allowed to answer a question their sample
     cannot answer. The alternative is hiding them, which is the thing this
     screener exists not to do.

     Tabulator negates a custom sorter's result for a descending sort, so both
     rules flip their sign on `dir` to survive that and stay put. */
  function ranked(inner) {
    return function (a, b, aRow, bRow, column, dir) {
      var la = aRow.getData().low, lb = bRow.getData().low;
      if (la !== lb) return (la ? 1 : -1) * (dir === 'desc' ? -1 : 1);
      return inner(a, b, dir);
    };
  }
  var nullsLast = ranked(function (a, b, dir) {
    var x = num(a), y = num(b);
    if (x == null && y == null) return 0;
    if (x == null) return dir === 'desc' ? -1 : 1;
    if (y == null) return dir === 'desc' ? 1 : -1;
    return x - y;
  });
  var textSort = ranked(function (a, b) {
    return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b));
  });

  function create(opts) {
    var o = opts || {};
    var Tab = o.Tabulator || root.Tabulator;
    var model = o.model;                  // assets/cardmodel.js instance
    var players = o.players || [];
    var clubs = o.clubs || [];
    var nextFixture = o.nextFixture || function () { return null; };
    var mount = typeof o.mount === 'string' ? document.getElementById(o.mount) : o.mount;
    if (!Tab || !model || !mount) return null;

    var clubName = Object.create(null);
    clubs.forEach(function (c) { clubName[c.short] = c.name; });

    /* Expanded rows, by row id. Held here rather than on the row element
       because the virtual renderer recycles elements on scroll — state on the
       element would reattach itself to whichever player scrolled into its
       place. */
    var open = new Set();

    /* ---- the rows -------------------------------------------------------- */
    var rows = players.map(function (p, i) {
      var fx = nextFixture(p) || null;
      var priced = model.playerFixture(p, fx
        ? { opponent: fx.opponent, isHome: fx.isHome, ref: fx.ref }
        : { isHome: true });
      var split = model.venueSplit(p);
      return {
        id: i,
        n: p.n,
        c: p.c,
        club: clubName[p.c] || p.c,
        pos: p.p || '—',
        min: num(p.min) || 0,
        y90: num(p.y),
        f90: num(p.f),
        risk: num(p.r),
        vHome: split.home,
        vAway: split.away,
        vSpread: split.spread,
        conviction: model.conviction(p),
        pCard: priced.rated ? priced.p : null,
        low: (num(p.min) || 0) < FLOOR,
        basis: p.b || 'PL',
        fixture: fx,
        working: priced.working,
        _player: p
      };
    });

    /* ---- formatters ------------------------------------------------------ */
    function playerCell(cell) {
      var d = cell.getData();
      var wrap = el('div', 'scr-name');
      wrap.appendChild(el('span', 'scr-name-t', d.n));
      if (d.low) {
        var b = el('span', 'scr-badge scr-badge-low', 'low sample');
        b.title = 'Under ' + FLOOR + ' minutes — the per-90 rates are an '
          + 'artefact of a small denominator. Shown, not hidden.';
        wrap.appendChild(b);
      }
      if (d.basis === 'EFL') {
        var e = el('span', 'scr-badge scr-badge-efl', 'EFL');
        e.title = 'Rated on Championship form — a wide-error prior, not a Premier League rate.';
        wrap.appendChild(e);
      }
      if (d.basis === 'NEW') {
        var nw = el('span', 'scr-badge scr-badge-new', 'new');
        nw.title = 'No card record at all. Listed with dashes rather than a number.';
        wrap.appendChild(nw);
      }
      return wrap;
    }

    function venueCell(cell) {
      var d = cell.getData();
      if (d.vHome == null || d.vAway == null) return el('span', 'scr-dash', '—');
      var wrap = el('span', 'scr-venue');
      wrap.appendChild(el('span', 'scr-venue-h', pct(d.vHome, 0)));
      wrap.appendChild(el('span', 'scr-venue-sep', '/'));
      wrap.appendChild(el('span', 'scr-venue-a', pct(d.vAway, 0)));
      wrap.title = 'P(card) at home / away, venue factor only. Spread '
        + (d.vSpread >= 0 ? '+' : '') + (d.vSpread * 100).toFixed(1) + ' points.';
      return wrap;
    }

    function convictionCell(cell) {
      var v = num(cell.getValue());
      var wrap = el('span', 'scr-conv');
      var bar = el('span', 'scr-conv-bar');
      var fill = el('span', 'scr-conv-fill');
      fill.style.width = Math.max(0, Math.min(100, v || 0)) + '%';
      bar.appendChild(fill);
      wrap.appendChild(bar);
      wrap.appendChild(el('span', 'scr-conv-n', v == null ? '—' : String(v)));
      wrap.title = 'Conviction ' + (v == null ? '—' : v) + '/100 — how much evidence '
        + 'is behind the rate (minutes played, and whether they were Premier League '
        + 'minutes). Not how high the risk is.';
      return wrap;
    }

    function pCardCell(cell) {
      var d = cell.getData();
      if (d.pCard == null) return el('span', 'scr-dash', '—');
      var wrap = el('span', 'scr-p');
      wrap.appendChild(el('b', null, pct(d.pCard, 0)));
      if (d.fixture) {
        wrap.appendChild(el('span', 'scr-p-fx',
          (d.fixture.isHome ? 'v ' : '@ ') + (d.fixture.opponent || '')));
      }
      return wrap;
    }

    function whyCell(cell) {
      var d = cell.getData();
      var b = el('button', 'scr-why', 'why');
      b.type = 'button';
      b.setAttribute('aria-expanded', open.has(d.id) ? 'true' : 'false');
      b.setAttribute('aria-label', 'Show the working behind ' + d.n + "'s card probability");
      if (!d.working) { b.disabled = true; b.title = 'No card record to explain.'; }
      b.addEventListener('click', function () {
        if (open.has(d.id)) open.delete(d.id); else open.add(d.id);
        b.setAttribute('aria-expanded', open.has(d.id) ? 'true' : 'false');
        cell.getRow().reformat();
      });
      return b;
    }

    /* ---- the "why" panel -------------------------------------------------
       Renders cardmodel's own working object. Each line is input, operation,
       result — so the multiplication can be followed and, if it looks wrong,
       checked. */
    function whyPanel(d) {
      var w = d.working;
      var box = el('div', 'scr-why-box');
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', 'How ' + d.n + "'s card probability is built");
      if (!w) {
        box.appendChild(el('p', 'scr-why-note',
          d.n + ' has no card record, so there is no rate to price. He is listed '
          + 'rather than dropped, and shown with dashes rather than a nought.'));
        return box;
      }

      var h = el('p', 'scr-why-head');
      h.appendChild(el('b', null, 'λ = ' + fmt(w.lambda, 3) + ' expected cards'));
      h.appendChild(el('span', 'scr-why-arrow', ' → '));
      h.appendChild(el('b', null, 'P(card) = ' + pct(w.p, 1)));
      h.appendChild(el('span', 'scr-why-sub',
        '  (Poisson: 1 − P(0 cards). P(two or more) = ' + pct(w.pTwoPlus, 1) + '.)'));
      box.appendChild(h);

      var lines = [
        ['Rate per 90', fmt(w.rawRate, 3) + ' yellows',
          w.minutes + (w.minutes === 1 ? ' minute' : ' minutes') + ' played'
            + (w.minutes < w.floor ? ' — under the ' + w.floor + '-minute floor' : '')],
        ['Shrunk toward ' + (w.position || 'position') + ' prior ' + fmt(w.positionPrior, 3),
          fmt(w.shrunkRate, 3),
          w.sampleWeight < 0.05
            ? 'effectively all prior — ' + w.minutes + ' minutes carries no signal, so this is '
              + 'the average ' + (w.position || 'player') + ', not a read on him'
            : Math.round(w.sampleWeight * 100) + '% his own rate, '
              + Math.round((1 - w.sampleWeight) * 100) + '% the position prior'],
        ['Minutes on the pitch', '× ' + fmt(w.minuteShare, 2),
          w.expMin + ' of 90 — this is P(booked | he plays)'],
        ['Venue (' + w.venue.venue + ')', '× ' + fmt(w.venue.factor, 3),
          w.venue.source === 'club'
            ? w.venue.club + ' concede ' + fmt(w.venue.caVenue, 2) + ' cards a game '
              + w.venue.venue + ' against ' + fmt(w.venue.ca, 2) + ' overall'
            : 'no club split on record — the league home/away factor'],
        ['Referee', '× ' + fmt(w.referee.factor, 3), refereeWhy(w.referee)],
        ['Opponent fouls drawn', '× ' + fmt(w.opponent.factor, 3), opponentWhy(w.opponent)]
      ];

      var dl = el('dl', 'scr-why-list');
      lines.forEach(function (l) {
        var dt = el('dt', 'scr-why-dt', l[0]);
        var dd = el('dd', 'scr-why-dd');
        dd.appendChild(el('span', 'scr-why-val', l[1]));
        dd.appendChild(el('span', 'scr-why-note', l[2]));
        dl.appendChild(dt); dl.appendChild(dd);
      });
      box.appendChild(dl);

      var foot = el('p', 'scr-why-foot');
      foot.textContent = 'Conviction ' + d.conviction + '/100'
        + (w.basis === 'EFL' ? ' — Championship basis, a wide-error prior.' : '')
        + (d.low ? ' Low sample: treat the rate as indicative.' : '')
        + ' Nothing here is a pick until the lineup is confirmed.';
      box.appendChild(foot);
      return box;
    }

    function refereeWhy(r) {
      if (r.source === 'unassigned') {
        return 'no official appointed yet — priced at the league pivot of '
          + r.pivot + ' yellows a match, so the factor is neutral';
      }
      if (r.source === 'pivot') {
        return r.name + ' has ' + (r.matches == null ? 'no' : r.matches)
          + ' matches on record, under the 10 needed — priced at the league pivot of '
          + r.pivot + ' rather than his own rate';
      }
      return r.name + ' shows ' + fmt(r.ypg, 2) + ' yellows a match over '
        + r.matches + ', against the league pivot of ' + r.pivot;
    }

    function opponentWhy(op) {
      if (op.source === 'none') {
        return 'no fouls-drawn record for ' + (op.name || 'this opponent')
          + ' — the 2025/26 match record does not cover the promoted clubs, so '
          + 'the factor is neutral until it is entered by hand';
      }
      var src = op.source === 'manual' ? 'entered by hand' : '2025/26 match record';
      return (op.name || op.club) + ' draw ' + fmt(op.drawn, 1) + ' fouls a match '
        + 'against a league ' + fmt(op.league, 1) + ' (' + src + ')';
    }

    /* ---- the table ------------------------------------------------------- */
    var table = new Tab(mount, {
      data: rows,
      index: 'id',
      /* fitColumns, not fitData: the grid must never be wider than the space it
         is in on a laptop, or the last two columns — the probability and the
         button that explains it — sit off the right edge where nobody finds
         them. The name and club columns take the slack; the numeric ones are
         fixed, because a number column that resizes with the viewport makes
         two screenshots of the same table look like different tables. */
      layout: 'fitColumns',
      height: o.height || '68vh',
      /* The whole point: ~30 rows in the DOM whatever the filter matches. */
      renderVertical: 'virtual',
      placeholder: 'No players match these filters.',
      initialSort: [{ column: 'risk', dir: 'desc' }],
      rowFormatter: function (row) {
        var d = row.getData();
        var elm = row.getElement();
        elm.classList.toggle('scr-low', !!d.low);
        /* Rebuild rather than toggle: the element may have been recycled from
           a different player, and a stale panel under the right name is worse
           than no panel. */
        var old = elm.querySelector('.scr-why-box');
        if (old) old.remove();
        if (open.has(d.id)) elm.appendChild(whyPanel(d));
      },
      columns: [
        { title: 'Player', field: 'n', minWidth: 150, widthGrow: 3, formatter: playerCell, sorter: textSort },
        { title: 'Team', field: 'club', minWidth: 126, widthGrow: 2, sorter: textSort },
        { title: 'Pos', field: 'pos', hozAlign: 'center', width: 66, sorter: textSort },
        { title: 'Mins', field: 'min', hozAlign: 'right', width: 74,
          sorter: nullsLast, formatter: function (c) { return String(c.getValue()); } },
        { title: 'YC/90', field: 'y90', hozAlign: 'right', width: 80, sorter: nullsLast,
          formatter: function (c) { return fmt(c.getValue(), 3); } },
        { title: 'Fouls/90', field: 'f90', hozAlign: 'right', width: 98, sorter: nullsLast,
          formatter: function (c) { return fmt(c.getValue(), 2); } },
        { title: 'Risk', field: 'risk', hozAlign: 'right', width: 78, sorter: nullsLast,
          formatter: function (c) { return fmt(c.getValue(), 3); } },
        { title: 'Venue H/A', field: 'vSpread', hozAlign: 'right', width: 104,
          sorter: nullsLast, formatter: venueCell },
        { title: 'Conviction', field: 'conviction', hozAlign: 'right', width: 112,
          sorter: nullsLast, formatter: convictionCell },
        { title: 'P(card)', field: 'pCard', hozAlign: 'right', width: 102,
          sorter: nullsLast, formatter: pCardCell },
        { title: 'Why', field: 'id', hozAlign: 'center', width: 64, headerSort: false,
          formatter: whyCell }
      ]
    });

    /* ---- filters ---------------------------------------------------------
       One predicate, so the counts and the table can never disagree — the
       status line below the slider is computed from the same function the
       table filters on. */
    var state = { team: 'all', pos: 'all', minMinutes: 0, search: '' };

    function keep(d) {
      if (state.team !== 'all' && d.c !== state.team) return false;
      if (state.pos !== 'all' && d.pos !== state.pos) return false;
      if (d.min < state.minMinutes) return false;
      if (state.search) {
        var q = state.search.toLowerCase();
        if (d.n.toLowerCase().indexOf(q) === -1 && d.club.toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    }

    function apply() {
      table.setFilter(keep);
      if (typeof o.onChange === 'function') o.onChange(counts());
    }

    function counts() {
      var shown = rows.filter(keep);
      /* Rows the OTHER filters allow but the slider removes. Named separately
         because "hidden by the minutes slider" is the number a reader needs to
         see, not "not matching the filters". */
      var slid = rows.filter(function (d) {
        var s = state.minMinutes; state.minMinutes = 0;
        var without = keep(d); state.minMinutes = s;
        return without && d.min < s;
      });
      return {
        total: rows.length,
        shown: shown.length,
        lowShown: shown.filter(function (d) { return d.low; }).length,
        hiddenBySlider: slid.length,
        floor: FLOOR
      };
    }

    /* The visible width of the grid, published as a custom property so the
       "why" panel can be as wide as the SCREEN rather than as wide as eleven
       columns. Re-read on every redraw and on resize, because a phone rotating
       is exactly when it is wrong. */
    function publishWidth() {
      var holder = mount.querySelector('.tabulator-tableholder');
      var w = holder ? holder.clientWidth : mount.clientWidth;
      if (w > 0) mount.style.setProperty('--scr-holder-w', w + 'px');
    }
    table.on('tableBuilt', publishWidth);
    table.on('renderComplete', publishWidth);
    if (root.addEventListener) root.addEventListener('resize', publishWidth);

    apply();

    return {
      table: table,
      rows: rows,
      counts: counts,
      setTeam: function (v) { state.team = v || 'all'; apply(); },
      setPosition: function (v) { state.pos = v || 'all'; apply(); },
      setMinMinutes: function (v) { state.minMinutes = Math.max(0, Number(v) || 0); apply(); },
      setSearch: function (v) { state.search = String(v || '').trim(); apply(); },
      state: state,
      expandAll: function (on) {
        rows.forEach(function (d) { if (on) open.add(d.id); else open.delete(d.id); });
        table.redraw(true);
      },
      destroy: function () {
        if (root.removeEventListener) root.removeEventListener('resize', publishWidth);
        try { table.destroy(); } catch (e) { /* already gone */ }
      }
    };
  }

  var PLScreener = { create: create, FLOOR: FLOOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = PLScreener;
  root.PLScreener = PLScreener;
})(typeof window !== 'undefined' ? window : globalThis);

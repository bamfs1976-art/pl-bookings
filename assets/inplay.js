/* In-play companion: one live fixture, the pre-match forecast against what has
 * happened, and what the forecast says about the minutes still to play.
 *
 * WHAT IT IS. A research view. It prints chances, never odds, and says on its
 * face that it runs up to a minute behind the match: bookmakers suspend their
 * markets the moment a card is shown, so nothing here is a live price.
 *
 * WHERE EVERY NUMBER COMES FROM. The desk hands over its own priced players
 * (the numbers it already prints), the live cards from its own ticker, and
 * its season foul averages. The panel adds one thing: the league's card
 * clock, built from the minute of every card this season
 * (data/*_cardevents.js, loaded on first open). The arithmetic is all
 * PLDCore.cardClock and PLDCore.inPlayFixture, which are unit-tested; this
 * file only draws.
 *
 * WHAT IT DOES NOT KNOW, and says so: substitutions (the feed carries cards
 * only, so a player taken off still shows a chance), live fouls, and a
 * second yellow for a player already booked.
 */
(function (root) {
  'use strict';

  var CLOCKS = {
    PL: { file: 'data/pl_cardevents.js', get: function () { return typeof PL_CARDEVENTS !== 'undefined' ? PL_CARDEVENTS : null; } },
    EFLC: { file: 'data/eflc_cardevents.js', get: function () { return typeof EFLC_CARDEVENTS !== 'undefined' ? EFLC_CARDEVENTS : null; } },
    LL: { file: 'data/laliga_cardevents.js', get: function () { return typeof LALIGA_CARDEVENTS !== 'undefined' ? LALIGA_CARDEVENTS : null; } },
    SA: { file: 'data/seriea_cardevents.js', get: function () { return typeof SERIEA_CARDEVENTS !== 'undefined' ? SERIEA_CARDEVENTS : null; } }
  };
  var SHOW = 12;
  var clockCache = {};
  var cur = null;   /* { opts, dlg, box, all } while open */

  function C() { return root.PLDCore; }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
  function n1(v) { return v == null ? '—' : Number(v).toFixed(1); }
  function n2(v) { return v == null ? '—' : Number(v).toFixed(2); }

  function loadScript(src) {
    return new Promise(function (res) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { res(true); }; s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
  }

  function clockFor(league) {
    if (clockCache[league] !== undefined) return Promise.resolve(clockCache[league]);
    var src = CLOCKS[league];
    if (!src) return Promise.resolve(null);
    var ready = src.get() ? Promise.resolve(true) : loadScript(src.file);
    return ready.then(function () {
      var ev = src.get();
      clockCache[league] = ev ? C().cardClock(ev) : null;
      return clockCache[league];
    });
  }

  var CSS = ''
    + '.inp{border:0;border-radius:14px;padding:0;width:min(560px,calc(100vw - 24px));max-width:560px;'
    + 'color:#0c1322;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.35)}'
    + '.inp::backdrop{background:rgba(12,19,34,.55)}'
    + '.inp-in{padding:18px 16px 16px;max-height:92vh;overflow:auto;box-sizing:border-box}'
    + '.inp h2{font-size:19px;margin:0 0 6px}.inp h3{font-size:14px;margin:16px 0 6px}'
    + '.inp p{font-size:13px;line-height:1.45;margin:0 0 8px;color:#334155}'
    + '.inp-note{color:#586275!important}'
    + '.inp-warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px;color:#9a3412!important}'
    + '.inp-head{font-size:15px!important;font-weight:700;color:#0c1322!important}'
    + '.inp table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:fixed}'
    + '.inp th,.inp td{white-space:normal;padding:6px 4px;border-bottom:1px solid #e2e6ee;text-align:left;vertical-align:top;overflow-wrap:anywhere}'
    + '.inp th{font-size:11px;font-weight:700;color:#586275}'
    + '.inp td.n,.inp th.n{text-align:right}'
    + '.inp .inp-k{width:42%}'
    + '.inp-done td{color:#9a3412}'
    + '.inp button{font:inherit;font-size:12px;min-height:32px}'
    + '.inp-close{float:right}'
    + '.inp ul{margin:0 0 8px;padding-left:18px;font-size:13px;line-height:1.45;color:#334155}'
    + '@media (prefers-color-scheme:dark){.inp{background:#111827;color:#e5e7eb}.inp p,.inp ul{color:#cbd5e1}'
    + '.inp-head{color:#f3f4f6!important}.inp th,.inp td{border-color:#374151}'
    + '.inp-warn{background:#3b2414;border-color:#7c2d12;color:#fdba74!important}.inp-done td{color:#fdba74}}';

  function row(tbody, cells, cls) {
    var tr = el('tr', cls ? { class: cls } : null);
    cells.forEach(function (c, i) { tr.appendChild(el('td', i ? { class: 'n' } : null, c)); });
    tbody.appendChild(tr);
  }

  function table(head) {
    var t = el('table');
    var tr = el('tr');
    head.forEach(function (h, i) { tr.appendChild(el('th', i ? { class: 'n' } : { class: 'inp-k' }, h)); });
    var th = el('thead'); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody'); t.appendChild(tb);
    return { t: t, tb: tb };
  }

  function stateText(s) { return s === 'booked' ? 'Booked' : s === 'sent-off' ? 'Sent off' : ''; }

  function render() {
    if (!cur) return;
    var box = cur.box, st;
    try { st = cur.opts.build(); } catch (e) { st = null; }
    box.innerHTML = '';
    var close = el('button', { type: 'button', class: 'btn inp-close' }, 'Close');
    close.addEventListener('click', function () { cur.dlg.close(); });
    box.appendChild(close);
    box.appendChild(el('h2', null, 'Live view'));
    box.appendChild(el('p', { class: 'inp-note' }, '18+ research, not advice. Chances only, no odds. '
      + 'This view runs up to a minute behind the match, and bookmakers suspend their markets the '
      + 'moment a card is shown, so none of these numbers is a live price.'));
    if (!st) { box.appendChild(el('p', null, 'This match is not live on the feed right now.')); return; }

    var clockTxt = st.finished ? 'Full time' : (st.minute ? st.minute + "'" : 'Kick-off');
    var upd = st.updatedAt ? ' · updated ' + new Date(st.updatedAt).toLocaleTimeString('en-GB') : '';
    box.appendChild(el('p', { class: 'inp-head' }, st.homeName + ' v ' + st.awayName + ' · ' + clockTxt + upd));

    if (st.scope === 'gameweek') {
      box.appendChild(el('p', { class: 'inp-warn' }, 'One of these clubs plays twice this gameweek. '
        + 'The Premier League live feed gives a card total for the whole gameweek, which cannot be split '
        + 'between the two matches, so this view cannot say what is left of this one.'));
      return;
    }
    var clock = cur.clock;
    var r = C().inPlayFixture({ home: st.home, away: st.away, players: st.players, minute: st.minute,
      finished: st.finished, cards: st.cards, state: st.state, clock: clock || null, lines: [3.5] });

    box.appendChild(el('h3', null, 'The match'));
    var m = table(['', 'Before kick-off', 'Now']);
    var ch = r.cards.home, ca = r.cards.away;
    var cardsTxt = function (c) { return c.yc + ' yellow' + (c.yc === 1 ? '' : 's') + (c.rc ? ', ' + c.rc + ' red' : ''); };
    row(m.tb, ['Cards: ' + st.home, '', cardsTxt(ch)]);
    row(m.tb, ['Cards: ' + st.away, '', cardsTxt(ca)]);
    row(m.tb, ['Expected cards in the match', n2(r.expected.pre),
      r.expected.total == null ? '—' : r.cards.total + ' so far + ' + n2(r.expected.rest) + ' to come']);
    row(m.tb, ['Over 3.5 cards', pct(r.over[3.5].pre), pct(r.over[3.5].now)]);
    box.appendChild(m.t);

    if (clock === undefined) {
      box.appendChild(el('p', { class: 'inp-note' }, 'Loading the league’s card clock…'));
    } else if (!clock) {
      box.appendChild(el('p', { class: 'inp-warn' }, 'Fewer than ' + C().CLOCK_MIN_CARDS
        + ' cards are recorded for this league this season, too few to say when cards arrive. '
        + 'The "now" figures stay blank until there are enough.'));
    }

    box.appendChild(el('h3', null, 'Fouls'));
    var f = table(['Season average a game', 'Committed', 'Suffered']);
    [[st.home, st.form && st.form.home], [st.away, st.form && st.form.away]].forEach(function (x) {
      var t = x[1] || {};
      row(f.tb, [x[0] + (t.played ? ' (' + t.played + ' games)' : ''), n1(t.foulsFor), n1(t.foulsAgainst)]);
    });
    box.appendChild(f.t);
    box.appendChild(el('p', { class: 'inp-note' }, 'The live feed carries cards only, so these are '
      + 'season averages from before this match, not fouls so far.'));

    box.appendChild(el('h3', null, 'Players'));
    var shown = cur.all ? r.players : r.players.filter(function (p, i) { return p.state || i < SHOW; });
    var pt = table(['Player', 'Before kick-off', 'From here']);
    shown.forEach(function (p) {
      row(pt.tb, [p.name + ' (' + p.club + ')', pct(p.pre), p.state ? stateText(p.state) : pct(p.now)],
        p.state ? 'inp-done' : null);
    });
    box.appendChild(pt.t);
    if (r.players.length > shown.length || cur.all) {
      var more = el('button', { type: 'button', class: 'btn', style: 'margin-top:8px' },
        cur.all ? 'Show fewer' : 'Show all ' + r.players.length + ' players');
      more.addEventListener('click', function () { cur.all = !cur.all; render(); });
      box.appendChild(more);
    }

    box.appendChild(el('h3', null, 'How this is worked out'));
    var share = r.share;
    box.appendChild(el('p', null, (clock ? 'This season, ' + clock.n + ' cards are recorded in this league. '
      + (share == null ? '' : pct(share) + ' of them arrived after this minute. ') : '')
      + 'A player’s chance from here is 1 − (1 − the pre-match chance) raised to the power of '
      + 'that share, so cards are taken to keep arriving at the league’s usual pace. At kick-off it is '
      + 'the desk’s own price, and at full time it is zero. Over 3.5 counts the cards already shown and '
      + 'adds the chances of the players not yet booked.'));
    var ul = el('ul');
    ['The feed has no substitutions: a player taken off still shows a chance.',
      'A booked player’s chance of a second yellow is not priced.',
      'A card in first-half added time recorded before this view existed counts at its full minute '
        + '(45+3 as 48), which slightly overstates what is left at half-time.'].forEach(function (t) {
      ul.appendChild(el('li', null, t));
    });
    box.appendChild(ul);
    box.appendChild(el('p', { class: 'inp-note' }, '18+ only. Bet only what you’re happy to lose. '
      + 'Help: BeGambleAware.'));
  }

  function open(opts) {
    if (!opts || typeof opts.build !== 'function' || !C()) return;
    if (!document.getElementById('inp-css')) {
      var s = el('style', { id: 'inp-css' }); s.textContent = CSS; document.head.appendChild(s);
    }
    var dlg = document.getElementById('inpDialog');
    if (!dlg) {
      dlg = el('dialog', { id: 'inpDialog', class: 'inp', 'aria-label': 'Live view' });
      dlg.appendChild(el('div', { class: 'inp-in' }));
      dlg.addEventListener('close', function () { cur = null; });
      document.body.appendChild(dlg);
    }
    cur = { opts: opts, dlg: dlg, box: dlg.firstChild, all: false, clock: undefined };
    var mine = cur;
    render();
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    clockFor(opts.league).then(function (k) {
      if (cur !== mine) return;
      cur.clock = k; render();
    });
  }

  /* The desk calls this after each poll so an open panel follows the match. */
  function refresh() { if (cur) render(); }

  root.PLDInPlay = { open: open, refresh: refresh, isOpen: function () { return !!cur; } };
})(typeof window !== 'undefined' ? window : this);

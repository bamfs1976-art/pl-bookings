/* PLDLineLog — model v line, the comparison log shared by all four desks.
 *
 * A reader types a bookmaker's odds into a price check and presses Log. The
 * comparison is frozen (odds, model chance, what the odds implied) and kept in
 * this browser only: no account, nothing sent anywhere. After the match the
 * division's bookings ledger settles it, and the view below shows whether the
 * model's edge held up: how often the comparisons it said beat the price came
 * in, against the chance the model gave and the chance the odds implied.
 *
 * Stake-free. Results are counted at one unit a comparison, so the record is
 * about the model, not about money. All arithmetic is PLDCore's (lineEntry,
 * settleLine, lineSummary), so it is unit-tested and the same on every desk.
 */
(function (root) {
  'use strict';

  var KEY = 'bd_lines_v1';
  /* The ledger each division settles from. A desk page has its own loaded;
     the others are fetched only when an entry of theirs is still pending. */
  var LEDGERS = {
    PL: { file: 'data/pl_bookings.js', get: function () { return typeof PL_BOOKINGS !== 'undefined' ? PL_BOOKINGS : null; } },
    EFLC: { file: 'data/eflc_bookings.js', get: function () { return typeof EFLC_BOOKINGS !== 'undefined' ? EFLC_BOOKINGS : null; } },
    LL: { file: 'data/laliga_bookings.js', get: function () { return typeof LALIGA_BOOKINGS !== 'undefined' ? LALIGA_BOOKINGS : null; } },
    SA: { file: 'data/seriea_bookings.js', get: function () { return typeof SERIEA_BOOKINGS !== 'undefined' ? SERIEA_BOOKINGS : null; } }
  };
  var LEAGUE_NAME = { PL: 'Premier League', EFLC: 'Championship', LL: 'La Liga', SA: 'Serie A' };

  function C() { return root.PLDCore; }

  function load() {
    try {
      var o = JSON.parse(root.localStorage.getItem(KEY) || 'null');
      return o && Array.isArray(o.entries) ? o.entries : [];
    } catch (e) { return []; }
  }
  function save(entries) {
    try { root.localStorage.setItem(KEY, JSON.stringify({ v: 1, entries: entries })); return true; }
    catch (e) { return false; }
  }

  /* x = { meta: { league, fixture: {id, r, h, a, d}, player: {n, c} }, prob, odds } */
  function add(x) {
    if (!x || !x.meta || !C()) return false;
    var e = C().lineEntry({ ts: Date.now(), league: x.meta.league, fixture: x.meta.fixture,
      player: x.meta.player, prob: x.prob, odds: x.odds });
    if (!e) return false;
    var all = load();
    /* The same player, fixture and odds logged twice in a minute is one
       comparison pressed twice, not two. */
    var dupe = all.some(function (o) {
      return o.league === e.league && String(o.fixtureId) === String(e.fixtureId)
        && o.player === e.player && o.odds === e.odds && Math.abs((o.ts || 0) - e.ts) < 60000;
    });
    if (dupe) return e;
    all.push(e);
    return save(all) ? e : false;
  }

  function setStatus(id, status) {
    if (C().LINE_STATUSES.indexOf(status) < 0) return;
    save(load().map(function (e) {
      return e.id === id ? Object.assign({}, e, { status: status, settledBy: status === 'pending' ? null : 'hand' }) : e;
    }));
  }
  function remove(id) { save(load().filter(function (e) { return e.id !== id; })); }

  function loadScript(src) {
    return new Promise(function (res) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { res(true); }; s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
  }

  /* Settle every pending entry it can. Ledgers not on this page are loaded
     first, once, and only for divisions with something pending. */
  function settleAll() {
    var all = load();
    var want = {};
    all.forEach(function (e) { if (e.status === 'pending' && LEDGERS[e.league]) want[e.league] = true; });
    var loads = Object.keys(want).map(function (lg) {
      return LEDGERS[lg].get() ? Promise.resolve() : loadScript(LEDGERS[lg].file);
    });
    return Promise.all(loads).then(function () {
      var changed = false;
      var next = all.map(function (e) {
        var L = LEDGERS[e.league], led = L && L.get();
        var s = led ? C().settleLine(e, led) : e;
        if (s !== e) changed = true;
        return s;
      });
      if (changed) save(next);
      return next;
    });
  }

  /* ---- the view -------------------------------------------------------- */
  var CSS = ''
    + '.lnl{border:0;border-radius:14px;padding:0;width:min(760px,100vw - 24px);max-height:92vh;'
    + 'color:#0c1322;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.35)}'
    + '.lnl::backdrop{background:rgba(12,19,34,.55)}'
    + '.lnl-in{padding:18px 16px 16px;max-height:92vh;overflow:auto;box-sizing:border-box}'
    + '.lnl h2{font-size:19px;margin:0 0 6px}.lnl h3{font-size:14px;margin:16px 0 6px}'
    + '.lnl p{font-size:13px;line-height:1.45;margin:0 0 8px;color:#334155}'
    + '.lnl-note{color:#586275!important}'
    + '.lnl-warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px;color:#9a3412!important}'
    + '.lnl table{width:100%;border-collapse:collapse;font-size:12.5px}'
    + '.lnl th,.lnl td{white-space:normal;padding:6px 4px;border-bottom:1px solid #e2e6ee;text-align:left;vertical-align:top}'
    + '.lnl th{font-size:11px;font-weight:700;text-transform:none;letter-spacing:0;color:#586275}'
    + '.lnl-wrap{overflow-x:auto;max-width:100%}'
    + '.lnl td.n,.lnl th.n{text-align:right;white-space:nowrap}'
    + '.lnl select,.lnl button{font:inherit;font-size:12px;min-height:32px}'
    + '.lnl-close{float:right}'
    + '.lnl-list{table-layout:fixed}.lnl-list th:last-child{width:118px}'
    + '.lnl-list td{overflow-wrap:anywhere}.lnl-list select{max-width:100%}'
    + '@media (prefers-color-scheme:dark){.lnl{background:#111827;color:#e5e7eb}.lnl p{color:#cbd5e1}'
    + '.lnl th,.lnl td{border-color:#374151}.lnl-warn{background:#3b2414;border-color:#7c2d12;color:#fdba74!important}}';
  var SMALL = 30;

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function wrap(t) { var d = el('div', { class: 'lnl-wrap' }); d.appendChild(t); return d; }
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };
  var pct = function (v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; };
  var sgn = function (v) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2); };

  function render(box, entries) {
    var S = C().lineSummary(entries);
    box.innerHTML = '';
    var close = el('button', { type: 'button', class: 'btn lnl-close' }, 'Close');
    close.addEventListener('click', function () { document.getElementById('lnlDialog').close(); });
    box.appendChild(close);
    box.appendChild(el('h2', { id: 'lnlTitle' }, 'Model v line'));
    box.appendChild(el('p', { class: 'lnl-note' },
      '18+ research, not advice. Each row is a bookmaker price you logged against the model’s chance. '
      + 'Results count one unit per comparison; nothing here records money. Stored in this browser only.'));
    if (!entries.length) {
      box.appendChild(el('p', null, 'Nothing logged yet. Open a fixture’s Price check, type the odds '
        + 'a bookmaker offers for a player to be booked, then press Log.'));
      return;
    }
    box.appendChild(el('p', null, S.logged + ' logged · ' + S.settled + ' settled · '
      + S.pending + ' waiting for the match · ' + S.voided + ' void (did not play)'
      + (S.unknown ? ' · ' + S.unknown + ' to settle by hand' : '')));
    if (S.settled < SMALL) {
      box.appendChild(el('p', { class: 'lnl-warn' }, 'Only ' + S.settled + ' settled so far. Under '
        + SMALL + ', a run of results says very little about whether the model has an edge.'));
    }

    box.appendChild(el('h3', null, 'When the model beat the price'));
    var B = S.beats;
    box.appendChild(el('p', null, B.n
      ? plural(B.n, 'settled comparison', 'settled comparisons') + '. Booked in ' + B.booked + ' (' + pct(B.observed) + '). The model gave '
        + pct(B.meanModel) + ' on average; the odds implied ' + pct(B.meanImplied) + '. At one unit each: '
        + sgn(B.units) + ' units (' + (B.roi == null ? '—' : (B.roi >= 0 ? '+' : '') + (B.roi * 100).toFixed(1) + '%') + ').'
      : 'None settled yet.'));

    box.appendChild(el('h3', null, 'All settled comparisons'));
    box.appendChild(el('p', null, S.settled
      ? 'The model averaged ' + pct(S.meanModel) + ', the odds implied ' + pct(S.meanImplied)
        + ', and the players were booked in ' + pct(S.observed) + '. Whichever average sits closer to what happened was the better forecaster here.'
      : 'None settled yet.'));

    var bt = el('table', { 'aria-label': 'Model chance against how often players were booked' });
    bt.innerHTML = '<thead><tr><th>Model said</th><th class="n">Logged</th><th class="n">Model avg</th><th class="n">Booked</th></tr></thead>';
    var tb = el('tbody');
    S.buckets.forEach(function (b) {
      var tr = el('tr');
      [Math.round(b.lo * 100) + '–' + Math.round(b.hi * 100) + '%', String(b.n), pct(b.meanP), pct(b.obs)]
        .forEach(function (v, i) { tr.appendChild(el('td', i ? { class: 'n' } : null, v)); });
      tb.appendChild(tr);
    });
    bt.appendChild(tb); box.appendChild(wrap(bt));

    box.appendChild(el('h3', null, 'Your log'));
    var lt = el('table', { class: 'lnl-list' });
    lt.innerHTML = '<thead><tr><th>Comparison</th><th>Result</th></tr></thead>';
    var lb = el('tbody');
    entries.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).forEach(function (e) {
      var tr = el('tr');
      var who = el('td');
      who.appendChild(el('div', null, e.player + ' (' + e.club + ')'));
      who.appendChild(el('div', { class: 'lnl-note', style: 'font-size:11.5px;color:#586275' },
        (LEAGUE_NAME[e.league] || e.league) + ' · ' + e.home + ' v ' + e.away));
      who.appendChild(el('div', { style: 'font-size:12px;margin-top:2px' },
        'Odds ' + Number(e.odds).toFixed(2) + ' · model ' + pct(e.model) + ' · implied ' + pct(e.implied)
        + ' · ' + e.verdict));
      tr.appendChild(who);
      var st = el('td');
      var sel = el('select', { 'aria-label': 'Result for ' + e.player });
      C().LINE_STATUSES.forEach(function (s) {
        var op = el('option', { value: s }, s); if (s === e.status) op.selected = true; sel.appendChild(op);
      });
      sel.addEventListener('change', function () { setStatus(e.id, sel.value); render(box, load()); });
      st.appendChild(sel);
      if (e.settledBy) st.appendChild(el('div', { style: 'font-size:11px;color:#586275' },
        e.settledBy === 'ledger' ? 'from the match record' : 'set by hand'));
      var del = el('button', { type: 'button', class: 'btn', style: 'margin-top:6px;display:block',
        'aria-label': 'Delete ' + e.player }, 'Delete');
      del.addEventListener('click', function () { remove(e.id); render(box, load()); });
      st.appendChild(del); tr.appendChild(st);
      lb.appendChild(tr);
    });
    lt.appendChild(lb); box.appendChild(wrap(lt));
  }

  function open() {
    if (!document.getElementById('lnl-css')) {
      var st = el('style', { id: 'lnl-css' }); st.textContent = CSS; document.head.appendChild(st);
    }
    var old = document.getElementById('lnlDialog');
    if (old) old.remove();
    var dlg = el('dialog', { id: 'lnlDialog', class: 'lnl', 'aria-labelledby': 'lnlTitle' });
    var box = el('div', { class: 'lnl-in' });
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    render(box, load());
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    settleAll().then(function (entries) { render(box, entries); });
    return dlg;
  }

  root.PLDLineLog = { add: add, all: load, settleAll: settleAll, setStatus: setStatus, remove: remove,
    open: open, count: function () { return load().length; }, KEY: KEY };
})(typeof globalThis !== 'undefined' ? globalThis : this);

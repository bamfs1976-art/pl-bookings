/* The command palette, for the desks that did not have one.
 *
 * ⌘K / Ctrl-K on the Premier League desk jumps to any player, club, referee or
 * view. The other two desks had a club dropdown, a position dropdown and a
 * search box that only filtered the players table — so finding a referee meant
 * knowing which tab he lived on first.
 *
 * The caller supplies the items, because only the desk knows what it holds.
 * This owns the keyboard, the overlay, the filtering and the accessibility, and
 * nothing else.
 *
 * Deliberately NOT shown as a button on a phone. It is a keyboard affordance;
 * a touch device has the tab bar and the filters, and a ⌘K chip on a 390px
 * topbar is a control nobody can use taking room from ones they can.
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* opts = { items: () => [{label, sub, group, run}] } */
  function init(opts) {
    if (!opts || typeof opts.items !== 'function') return null;
    var wrap = document.createElement('div');
    wrap.className = 'pk-back';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="pk-scrim"></div>'
      + '<div class="pk-box" role="dialog" aria-modal="true" aria-label="Command palette">'
      + '<input class="pk-input" type="text" placeholder="Search players, clubs, referees, views…"'
      + ' aria-label="Search" autocomplete="off" spellcheck="false">'
      + '<div class="pk-list" role="listbox"></div>'
      + '<div class="pk-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close</div>'
      + '</div>';
    document.body.appendChild(wrap);
    var input = wrap.querySelector('.pk-input');
    var list = wrap.querySelector('.pk-list');
    var all = [], shown = [], sel = 0;

    function render() {
      var q = input.value.trim().toLowerCase();
      shown = (q
        ? all.filter(function (it) {
            return (it.label + ' ' + (it.sub || '')).toLowerCase().indexOf(q) >= 0;
          })
        : all).slice(0, 40);
      if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
      list.innerHTML = shown.length
        ? shown.map(function (it, i) {
            return '<div class="pk-item' + (i === sel ? ' on' : '') + '" role="option"'
              + ' aria-selected="' + (i === sel ? 'true' : 'false') + '" data-i="' + i + '">'
              + '<span class="pk-label">' + esc(it.label) + '</span>'
              + (it.sub ? '<span class="pk-sub">' + esc(it.sub) + '</span>' : '')
              + (it.group ? '<span class="pk-group">' + esc(it.group) + '</span>' : '')
              + '</div>';
          }).join('')
        : '<div class="pk-empty">Nothing matches “' + esc(input.value) + '”.</div>';
      var on = list.querySelector('.pk-item.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    function open() {
      all = opts.items() || [];
      input.value = ''; sel = 0;
      wrap.hidden = false;
      render();
      input.focus();
    }
    function close() { wrap.hidden = true; }
    function choose(i) {
      var it = shown[i];
      close();
      if (it && typeof it.run === 'function') it.run();
    }

    input.addEventListener('input', function () { sel = 0; render(); });
    list.addEventListener('click', function (e) {
      var n = e.target.closest ? e.target.closest('.pk-item') : null;
      if (n) choose(Number(n.dataset.i));
    });
    wrap.querySelector('.pk-scrim').addEventListener('click', close);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (wrap.hidden) open(); else close();
      }
    });

    return { open: open, close: close };
  }

  root.PLDPalette = { init: init };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Sortable-table state, announced.
 *
 * Every desk already MOVES an arrow onto the sorted column — the state is
 * tracked, and shown, and completely invisible to anyone not looking at it. A
 * screen-reader user could sort the screener and be told nothing at all: the
 * table silently reordered and the header still read "Risk".
 *
 * WCAG 2.2 AA, and it is `aria-sort` on the `th` rather than on the button
 * inside it: the column header is the thing that is sorted, and the sort
 * property belongs to the cell with the columnheader role. Exactly one header
 * per table may carry it — a table claiming two sorted columns is worse than
 * one claiming none, because a reader believes it.
 */
(function (root) {
  'use strict';

  function headers(el) {
    var table = el && el.closest ? el.closest('table') : null;
    return table ? table.querySelectorAll('th[data-sort]') : [];
  }

  /* Mark `th` as the sorted column, and clear every sibling. Direction follows
     the same convention the arrows use: positive is ascending. */
  function markSorted(th, dir) {
    if (!th || !th.setAttribute) return;
    var hs = headers(th);
    for (var i = 0; i < hs.length; i++) hs[i].setAttribute('aria-sort', 'none');
    th.setAttribute('aria-sort', Number(dir) > 0 ? 'ascending' : 'descending');
  }

  /* The state a table LOADS in. The screener arrives sorted by risk, so
     without this the first thing a screen reader meets is a sorted table
     insisting nothing is sorted. */
  function syncSorted(table, key, dir) {
    var t = (typeof table === 'string') ? root.document.querySelector(table) : table;
    if (!t) return;
    var hs = t.querySelectorAll('th[data-sort]');
    for (var i = 0; i < hs.length; i++) {
      var th = hs[i];
      th.setAttribute('aria-sort',
        th.getAttribute('data-sort') === String(key)
          ? (Number(dir) > 0 ? 'ascending' : 'descending')
          : 'none');
    }
  }

  root.PLDA11y = { markSorted: markSorted, syncSorted: syncSorted };
}(typeof window !== 'undefined' ? window : globalThis));

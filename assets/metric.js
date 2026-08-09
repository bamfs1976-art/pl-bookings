/* Metric labels that explain themselves, and a confidence meter that is not
 * decoration.
 *
 * WHY THIS EXISTS. The fixture card shipped EXP CARDS, O3.5, O4.5, BTC,
 * H2H 10, "tight 66%", "game state EVE ×0.98 · CRY ×1.02" and a five-dot
 * meter, and defined none of them anywhere on the page. Some carried a
 * `title` attribute, which is the worst of both worlds: invisible on a
 * touchscreen, unreachable by keyboard, and announced inconsistently by
 * screen readers — so the explanation existed and almost nobody could get to
 * it. The dots had `aria-hidden="true"` and no legend at all, so to a screen
 * reader they were not there and to everyone else they were a pattern.
 *
 * ONE popover, not one per label. A card carries five metrics and a gameweek
 * carries ten cards, so per-label popovers would be 50 hidden nodes and 100
 * listeners for a thing at most one of which is ever open. This keeps a single
 * element, moves it, and points aria-describedby at it — which also means the
 * description a screen reader reads is the one on screen, by construction.
 *
 *   PLDMetric.label('Expected cards', {abbr:'EXP', help:'…'})   -> HTML
 *   PLDMetric.confidence(4, 5, 'based on 18 matches')           -> HTML
 *   PLDMetric.wire()                                            -> once, on load
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var POP_ID = 'pld-metric-pop';
  var GUIDE = '/#guide';

  /* A metric label. Rendered as a real <button>, because it does something
     when you press it — a <span title> is a promise the keyboard cannot keep.
     `abbr` is kept and shown small beside the plain name rather than instead
     of it: somebody who has learnt "BTC" should not have to relearn the page,
     and somebody who has not should never have had to. */
  function label(text, opts) {
    opts = opts || {};
    var help = opts.help || '';
    var extra = opts.guide === false ? '' : ' data-guide="1"';
    return '<button type="button" class="mlab" data-help="' + esc(help) + '"' + extra
      + ' aria-label="' + esc(text) + (help ? '. What is this?' : '') + '">'
      + '<span class="mlab-t">' + esc(text) + '</span>'
      + (opts.abbr ? '<span class="mlab-a" aria-hidden="true">' + esc(opts.abbr) + '</span>' : '')
      + '</button>';
  }

  /* The five-dot meter. It had aria-hidden and a title; now it carries the
     count, the scale AND what the scale is of, because "4 of 5" without
     "based on 18 matches" is the same decoration in words. */
  function confidence(n, of, note, what) {
    of = of || 5;
    n = Math.max(0, Math.min(of, Math.round(n)));
    var s = '<span class="cmeter" role="img" aria-label="'
      + esc((what || 'Confidence') + ': ' + n + ' of ' + of + (note ? ' — ' + note : '')) + '">';
    for (var i = 0; i < of; i++) s += '<span class="cmeter-p' + (i < n ? ' on' : '') + '"></span>';
    return s + '</span>';
  }

  var pop = null, current = null;

  function ensure() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = POP_ID;
    pop.className = 'mpop';
    pop.setAttribute('role', 'tooltip');
    pop.hidden = true;
    document.body.appendChild(pop);
    return pop;
  }

  function close() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (current) { current.removeAttribute('aria-describedby'); current = null; }
  }

  function open(btn) {
    var help = btn.getAttribute('data-help');
    if (!help) return;
    var p = ensure();
    if (current === btn && !p.hidden) { close(); return; }   /* tap again to dismiss */
    close();
    p.innerHTML = '<span class="mpop-b">' + esc(help) + '</span>'
      + (btn.hasAttribute('data-guide')
        ? '<a class="mpop-more" href="' + GUIDE + '">Full glossary in the Guide</a>' : '');
    p.hidden = false;
    /* Measured after it is visible: offsetWidth on a hidden element is 0, and
       the first version placed every popover at the left edge because of it. */
    var r = btn.getBoundingClientRect();
    var w = p.offsetWidth, h = p.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = (r.top - h - 10 > 8) ? r.top - h - 10 : r.bottom + 10;
    p.style.left = Math.round(left + window.scrollX) + 'px';
    p.style.top = Math.round(top + window.scrollY) + 'px';
    btn.setAttribute('aria-describedby', POP_ID);
    current = btn;
  }

  function wire() {
    if (root.__pldMetricWired) return;
    root.__pldMetricWired = true;
    /* Delegated: the cards are re-rendered on every referee change, filter and
       gameweek switch, so listeners bound to the buttons themselves would be
       dropped on the floor each time and silently stop working. */
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.mlab');
      if (b) { e.preventDefault(); open(b); return; }
      if (!(e.target.closest && e.target.closest('.mpop'))) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    /* Focus opens it for a keyboard user, who otherwise has to press a button
       to read a description of the thing they have already tabbed to. */
    document.addEventListener('focusin', function (e) {
      var b = e.target.closest && e.target.closest('.mlab');
      if (b) open(b); else if (!(e.target.closest && e.target.closest('.mpop'))) close();
    });
    window.addEventListener('resize', close);
    /* Capture: a popover anchored to a card inside a scrolling column has to
       follow or be dismissed, and scroll does not bubble. */
    window.addEventListener('scroll', close, true);
  }

  root.PLDMetric = { label: label, confidence: confidence, wire: wire, close: close };
})(typeof globalThis !== 'undefined' ? globalThis : this);

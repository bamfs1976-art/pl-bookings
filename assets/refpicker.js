/* The referee control.
 *
 * WHAT IT REPLACES. Every fixture card carried `Ref —` and an unstyled native
 * <select> holding all 22 officials with a raw number in brackets. Ten cards to
 * a gameweek, so the same 22-row dropdown appeared ten times, dominated each
 * card, and said nothing about why a referee matters — which is a shame,
 * because he is the largest multiplier the desk applies.
 *
 * Three things were wrong beyond the styling:
 *
 *   The default state said "Ref —", which reads as missing data. What it
 *   actually means is "not announced yet, so the model is using the league
 *   average" — a statement about the price, and the one the reader needs.
 *
 *   The options were sorted alphabetically. The reason to open the list is to
 *   find a strict official, and alphabetical order buries him.
 *
 *   A picked referee changed every number on the card with nothing saying so.
 *   A hypothetical that looks exactly like a published appointment is the one
 *   genuinely misleading thing a research tool can do.
 *
 * SO: the number a referee carries is shown against the league average he is
 * being compared to, the list is ordered by that number, and anything picked
 * by hand is labelled as simulated with a way back.
 *
 *   PLDRefPicker.html({fid, refs, current, appointed, avg})  -> HTML
 *   PLDRefPicker.wire({onPick, onReset})                     -> once, on load
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function surname(n) { return String(n || '').split(' ').pop(); }

  /* Signed, and against the average the MODEL divides by — not a round number
     chosen for the label. A control that advertises 4.0 while the maths uses
     3.71 is off by a third of the spread between the strictest official and
     the most lenient. */
  function delta(ypg, avg) {
    if (ypg == null) return null;
    var d = ypg - avg;
    return { d: d, txt: (d >= 0 ? '+' : '') + d.toFixed(2) + ' vs avg',
             tone: d >= 0.3 ? 'hi' : d <= -0.3 ? 'lo' : 'mid' };
  }

  /* Below this, a rate is a claim about a handful of afternoons rather than
     about a habit. Same threshold the generated referee reference uses. */
  var MIN_MATCHES = 10;
  function thin(r) { return r.ypg == null || (r.matches != null && r.matches < MIN_MATCHES); }

  function rows(refs, avg, current) {
    /* BY CARD RATE, descending — the reason anyone opens this list is to find
       a strict whistle, and alphabetical order (which is what the <select>
       did) puts him wherever his surname happens to fall.
    
       BUT THIN SAMPLES SINK. Sorted on rate alone the top of the list was an
       official on 5.00 over THREE matches, above everyone with a season behind
       them — so the first pick a reader makes applies a ×1.35 multiplier to
       every player on the card off three afternoons. He is still in the list,
       still shows his number, and now says how little is behind it. */
    return refs.slice().sort(function (a, b) {
      var ta = thin(a) ? 1 : 0, tb = thin(b) ? 1 : 0;
      if (ta !== tb) return ta - tb;
      return (b.ypg == null ? -1 : b.ypg) - (a.ypg == null ? -1 : a.ypg);
    }).map(function (r) {
      var dl = delta(r.ypg, avg);
      return '<button type="button" class="rp-row' + (r.n === current ? ' on' : '')
        + '" data-ref="' + esc(r.n) + '" role="option" aria-selected="' + (r.n === current) + '">'
        + '<span class="rp-nm">' + esc(r.n) + '</span>'
        + '<span class="rp-ypg">' + (r.ypg == null ? '—' : r.ypg.toFixed(2)) + '</span>'
        + (dl ? '<span class="rp-d ' + dl.tone + '">' + esc(dl.txt) + '</span>'
              : '<span class="rp-d">no card record</span>')
        + '<span class="rp-n' + (thin(r) ? ' thin' : '') + '">'
        + (r.matches == null ? 'no card record' : r.matches + ' games'
           + (thin(r) ? ' — too few to rely on' : '')) + '</span>'
        + '</button>';
    }).join('');
  }

  function html(o) {
    var refs = o.refs || [], avg = o.avg || 3.71;
    var cur = o.current || '', appointed = o.appointed || '';
    var isSim = !!cur && cur !== appointed;
    var rec = null;
    for (var i = 0; i < refs.length; i++) if (refs[i].n === cur) rec = refs[i];
    var dl = rec ? delta(rec.ypg, avg) : null;

    var head;
    if (!cur) {
      /* "Ref —" read as missing data. This is a statement about the price. */
      head = '<span class="rp-none">Referee not announced — using league average ('
        + avg.toFixed(2) + ')</span>';
    } else if (isSim) {
      head = '<span class="rp-sim" title="A referee you picked. Nothing has been announced — '
        + 'every number on this card is hypothetical until it is.">Simulated: '
        + esc(surname(cur)) + (dl ? ' (' + esc(dl.txt.replace(' vs avg', '')) + ')' : '') + '</span>'
        + '<button type="button" class="rp-reset" data-ref-reset="' + esc(o.fid) + '">Reset</button>';
    } else {
      head = '<span class="rp-appointed" title="Published appointment, harvested from the fixture feed">'
        + esc(surname(cur)) + (dl ? ' · ' + esc(dl.txt) : '') + '</span>';
    }

    return '<div class="rp" data-fid="' + esc(o.fid) + '">'
      + '<div class="rp-head">' + head
      + '<button type="button" class="rp-open" aria-expanded="false">'
      + (cur ? 'Change' : 'Try a referee') + '</button></div>'
      + '<div class="rp-panel" hidden>'
      + '<input type="text" class="rp-find" placeholder="Filter officials…" aria-label="Filter officials">'
      + '<div class="rp-list" role="listbox" aria-label="Officials by cards per game">'
      + rows(refs, avg, cur) + '</div></div></div>';
  }

  function wire(opts) {
    opts = opts || {};
    if (root.__pldRefWired) return;
    root.__pldRefWired = true;
    /* Delegated. The cards are rebuilt on every pick, so listeners bound to
       the controls themselves would be discarded by the very action that uses
       them — the control would work exactly once. */
    document.addEventListener('click', function (e) {
      var t = e.target;
      var open = t.closest && t.closest('.rp-open');
      if (open) {
        var rp = open.closest('.rp'), panel = rp.querySelector('.rp-panel');
        var show = panel.hidden;
        /* One at a time: ten open panels on a gameweek is a page of dropdowns. */
        document.querySelectorAll('.rp-panel').forEach(function (p) { p.hidden = true; });
        document.querySelectorAll('.rp-open').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
        panel.hidden = !show;
        open.setAttribute('aria-expanded', show ? 'true' : 'false');
        if (show) { var f = panel.querySelector('.rp-find'); if (f) f.focus(); }
        return;
      }
      var reset = t.closest && t.closest('[data-ref-reset]');
      if (reset) { if (opts.onReset) opts.onReset(reset.getAttribute('data-ref-reset')); return; }
      var row = t.closest && t.closest('.rp-row');
      if (row) {
        var fid = row.closest('.rp').getAttribute('data-fid');
        if (opts.onPick) opts.onPick(fid, row.getAttribute('data-ref'));
        return;
      }
      if (!(t.closest && t.closest('.rp'))) {
        document.querySelectorAll('.rp-panel').forEach(function (p) { p.hidden = true; });
      }
    });
    document.addEventListener('input', function (e) {
      var f = e.target.closest && e.target.closest('.rp-find');
      if (!f) return;
      var q = f.value.trim().toLowerCase();
      f.closest('.rp-panel').querySelectorAll('.rp-row').forEach(function (r) {
        r.hidden = !!q && r.querySelector('.rp-nm').textContent.toLowerCase().indexOf(q) < 0;
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = document.querySelector('.rp-panel:not([hidden])');
      if (open) { open.hidden = true; open.closest('.rp').querySelector('.rp-open').focus(); }
    });
  }

  /* WHAT CHANGED. A referee moves the heat and every player's percentage on the
     card, and the old control moved them all in one silent repaint. Capture
     the numbers before the re-render, tween each to its new value after, so
     the eye is told what the pick did. Reduced-motion goes straight there. */
  function capture(rootEl) {
    var was = new Map();
    (rootEl || document).querySelectorAll('[data-num]').forEach(function (el) {
      was.set(el.getAttribute('data-num'), parseFloat(el.textContent));
    });
    return was;
  }

  function animate(was, rootEl) {
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (rootEl || document).querySelectorAll('[data-num]').forEach(function (el) {
      var key = el.getAttribute('data-num');
      if (!was.has(key)) return;
      var from = was.get(key), to = parseFloat(el.textContent);
      if (!isFinite(from) || !isFinite(to) || from === to) return;
      el.classList.add('num-moved');
      setTimeout(function () { el.classList.remove('num-moved'); }, 900);
      if (reduce) return;
      var dp = (el.textContent.split('.')[1] || '').replace('%', '').length;
      var suffix = /%$/.test(el.textContent) ? '%' : '';
      var t0 = performance.now();
      (function step(now) {
        var k = Math.min(1, (now - t0) / 380);
        var v = from + (to - from) * (1 - Math.pow(1 - k, 3));
        el.textContent = v.toFixed(dp) + suffix;
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  root.PLDRefPicker = { html: html, wire: wire, capture: capture, animate: animate, delta: delta };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Why this price: one player's price, rebuilt a step at a time in sentences.
 *
 * Tap a player percentage (any element carrying data-why) and the desk's
 * resolver turns the key into a spec: the inputs it priced that player from.
 * PLDCore.priceSteps rebuilds the price through the same functions the desk
 * used and checks the last step against the printed figure. If they differ,
 * the sheet says so instead of showing sums that do not add up.
 *
 * The click is caught on the way DOWN (capture phase), so tapping the
 * percentage inside a player row opens this and not the row's own record.
 * The player record also carries a real "Why this price" button, which is
 * the keyboard route.
 */
(function (root) {
  'use strict';

  var resolver = null;

  function C() { return root.PLDCore; }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }

  var CSS = ''
    + '.why{border:0;border-radius:14px;padding:0;width:min(520px,calc(100vw - 24px));max-width:520px;'
    + 'color:#0c1322;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.35)}'
    + '.why::backdrop{background:rgba(12,19,34,.55)}'
    + '.why-in{padding:18px 16px 16px;max-height:92vh;overflow:auto;box-sizing:border-box}'
    + '.why h2{font-size:19px;margin:0 0 6px}'
    + '.why p{font-size:13.5px;line-height:1.5;margin:0 0 8px;color:#334155}'
    + '.why-who{font-size:15px!important;font-weight:700;color:#0c1322!important;margin-bottom:2px!important}'
    + '.why-note{color:#586275!important;font-size:12.5px!important}'
    + '.why-warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px;color:#9a3412!important}'
    + '.why ol{margin:10px 0 10px;padding-left:22px;list-style:decimal}'
    + '.why li{display:list-item;font-size:13.5px;line-height:1.5;margin:0 0 8px;color:#1f2937}'
    + '.why-final{font-size:15px!important;font-weight:700;color:#0c1322!important}'
    + '.why button{font:inherit;font-size:12px;min-height:32px}.why-close{float:right}'
    + '[data-why]:not(button){cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}'
    + '@media (prefers-color-scheme:dark){.why{background:#111827;color:#e5e7eb}.why p{color:#cbd5e1}'
    + '.why li{color:#e5e7eb}.why-who,.why-final{color:#f3f4f6!important}'
    + '.why-warn{background:#3b2414;border-color:#7c2d12;color:#fdba74!important}}';

  function ensureCss() {
    if (document.getElementById('why-css')) return;
    var s = el('style', { id: 'why-css' }); s.textContent = CSS; document.head.appendChild(s);
  }

  function open(x) {
    if (!x || !x.spec || !C()) return;
    ensureCss();
    var d = document.getElementById('whyDialog');
    if (!d) {
      d = el('dialog', { id: 'whyDialog', class: 'why', 'aria-label': 'Why this price' });
      d.appendChild(el('div', { class: 'why-in' }));
      document.body.appendChild(d);
    }
    var box = d.firstChild;
    box.innerHTML = '';
    var r = C().priceSteps(x.spec);
    var close = el('button', { type: 'button', class: 'btn why-close' }, 'Close');
    close.addEventListener('click', function () { d.close(); });
    box.appendChild(close);
    box.appendChild(el('h2', null, 'Why this price'));
    box.appendChild(el('p', { class: 'why-who' }, x.player));
    if (x.context) box.appendChild(el('p', { class: 'why-note' }, x.context));
    if (!r.ok) {
      box.appendChild(el('p', { class: 'why-warn' }, 'This price could not be rebuilt step by step from '
        + 'its inputs, so no breakdown is shown rather than one that does not add up.'));
    } else {
      var ol = el('ol');
      r.steps.forEach(function (s) { ol.appendChild(el('li', null, s.sentence)); });
      box.appendChild(ol);
      box.appendChild(el('p', { class: 'why-final' }, 'Price on the desk: ' + pct(r.final) + '.'));
      if (r.versus) box.appendChild(el('p', null, r.versus.sentence));
      if (r.note) box.appendChild(el('p', { class: 'why-note' }, r.note));
    }
    box.appendChild(el('p', { class: 'why-note' }, 'Research, not advice. A price is a model’s '
      + 'estimate, not a promise. 18+ only. Bet only what you’re happy to lose. Help: BeGambleAware.'));
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }

  function setResolver(fn) { resolver = typeof fn === 'function' ? fn : null; }

  if (typeof document !== 'undefined') {
    if (document.head) ensureCss();
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-why]');
      if (!t || !resolver) return;
      var x = null;
      try { x = resolver(t.getAttribute('data-why')); } catch (err) { x = null; }
      if (!x) return;
      e.preventDefault(); e.stopPropagation();
      open(x);
    }, true);
  }

  root.PLDWhy = { open: open, setResolver: setResolver };
})(typeof window !== 'undefined' ? window : this);

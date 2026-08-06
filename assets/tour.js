/* The first-run guided tour, for the desks that did not have one.
 *
 * The Premier League desk has carried a spotlight tour since it was built; the
 * Championship and La Liga desks dropped a new reader straight into a table of
 * several hundred rows with no explanation of what a percentage on it means.
 *
 * Generic on purpose: steps are a config, not code, so the three desks cannot
 * end up teaching three different things about one model. Each desk keys its
 * "seen" flag separately — being shown round the Championship is not being
 * shown round La Liga, even though the tours are the same shape.
 *
 * NON-BLOCKING. The scrim is clickable and Escape closes it. A first-run
 * overlay that traps someone who already knows the product is worse than no
 * overlay, and this one appears exactly once.
 */
(function (root) {
  'use strict';

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function build() {
    var back = el('div', 'pt-back');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'false');
    back.setAttribute('aria-labelledby', 'ptHeading');
    back.innerHTML =
      '<div class="pt-scrim"></div><div class="pt-ring"></div>'
      + '<div class="pt-pop">'
      + '<div class="pt-step"></div><h4 id="ptHeading"></h4><p class="pt-body"></p>'
      + '<div class="pt-actions"><button class="pt-skip" type="button">Skip tour</button>'
      + '<span class="pt-next-wrap"><button class="btn pt-back-btn" type="button">Back</button>'
      + '<button class="btn primary pt-next" type="button">Next</button></span></div></div>';
    document.body.appendChild(back);
    return back;
  }

  /* steps = [{sel, title, body}] — sel may be null for an unanchored step. */
  function run(steps, opts) {
    opts = opts || {};
    if (!steps || !steps.length) return;
    var back = build();
    var ring = back.querySelector('.pt-ring');
    var pop = back.querySelector('.pt-pop');
    var i = 0;

    function close() {
      back.remove();
      if (opts.key) { try { localStorage.setItem(opts.key, '1'); } catch (e) {} }
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }
    function next() { if (i >= steps.length - 1) close(); else show(i + 1); }
    function prev() { if (i > 0) show(i - 1); }

    function place() {
      var s = steps[i];
      var t = s.sel ? document.querySelector(s.sel) : null;
      if (t) {
        var r = t.getBoundingClientRect(), pad = 8;
        ring.style.display = 'block';
        ring.style.left = (r.left - pad) + 'px';
        ring.style.top = (r.top - pad) + 'px';
        ring.style.width = (r.width + pad * 2) + 'px';
        ring.style.height = (r.height + pad * 2) + 'px';
        /* Below the target where there is room, above it where there is not —
           a popover off the bottom of a phone is the same as no popover. */
        var pw = Math.min(330, window.innerWidth - 32);
        var ph = pop.offsetHeight || 200;
        var below = r.bottom + 12 + ph < window.innerHeight;
        pop.style.width = pw + 'px';
        pop.style.left = Math.max(16, Math.min(window.innerWidth - pw - 16, r.left)) + 'px';
        pop.style.top = (below ? r.bottom + 12 : Math.max(16, r.top - ph - 12)) + 'px';
      } else {
        ring.style.display = 'none';
        var w = Math.min(330, window.innerWidth - 32);
        pop.style.width = w + 'px';
        pop.style.left = ((window.innerWidth - w) / 2) + 'px';
        pop.style.top = Math.max(16, (window.innerHeight - (pop.offsetHeight || 200)) / 2) + 'px';
      }
    }

    function show(n) {
      i = n;
      var s = steps[i];
      /* Scroll the target into view BEFORE measuring it, or the ring lands
         where the element used to be. */
      var t = s.sel ? document.querySelector(s.sel) : null;
      if (t && t.scrollIntoView) t.scrollIntoView({ block: 'center', behavior: 'auto' });
      back.querySelector('.pt-step').textContent = 'Step ' + (i + 1) + ' of ' + steps.length;
      back.querySelector('h4').textContent = s.title;
      back.querySelector('.pt-body').textContent = s.body;
      back.querySelector('.pt-back-btn').style.visibility = i === 0 ? 'hidden' : 'visible';
      back.querySelector('.pt-next').textContent = i === steps.length - 1 ? 'Done' : 'Next';
      place();
    }

    back.querySelector('.pt-scrim').addEventListener('click', close);
    back.querySelector('.pt-skip').addEventListener('click', close);
    back.querySelector('.pt-next').addEventListener('click', next);
    back.querySelector('.pt-back-btn').addEventListener('click', prev);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    show(0);
  }

  /* Runs once ever, unless the key is missing. */
  function maybe(steps, key) {
    var seen = false;
    try { seen = !!localStorage.getItem(key); } catch (e) { /* private mode: show it */ }
    if (!seen) setTimeout(function () { run(steps, { key: key }); }, 600);
  }

  root.PLDTour = { run: run, maybe: maybe };
})(typeof globalThis !== 'undefined' ? globalThis : this);

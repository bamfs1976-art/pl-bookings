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

  /* OFFERED, NOT FIRED.
   *
   * This used to be maybe(): unseen key, 600ms timer, tour opens over the top
   * of a page nobody had looked at yet. A first-time visitor met a dimmed
   * screen and "Step 1 of 4" before seeing a single number, and because the
   * spotlight scrolls its target into view, the page also arrived scrolled
   * past its own heading on a phone. An overlay is a reasonable thing to
   * offer and an unreasonable thing to impose.
   *
   * So nothing opens on load. This wires a persistent button that opens the
   * same tour on demand, and returns a start() so a caller can hang it off
   * something else too. The key still records that the tour has been seen —
   * it is used to decide whether the inline hint is worth showing, not
   * whether to seize the screen.
   *
   * opts.button  an existing element to wire, or
   * opts.into    a container to append a fresh button to
   * opts.label   button text (default "How to read this page")
   */
  function offer(steps, key, opts) {
    opts = opts || {};
    var start = function () { run(steps, { key: key }); };
    var btn = opts.button;
    if (!btn && opts.into) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn pt-offer';
      btn.textContent = opts.label || 'How to read this page';
      opts.into.appendChild(btn);
    }
    if (btn) btn.addEventListener('click', start);
    return { start: start, button: btn, seen: seen(key) };
  }

  function seen(key) {
    try { return !!localStorage.getItem(key); } catch (e) { return false; }
  }

  /* A one-line hint under the H1, dismissed for good on the X.
   * Separate key from the tour's: dismissing a sentence is not the same
   * statement as having taken a four-step tour, and conflating them meant
   * one dismissal silently suppressed the other. */
  function hint(el, key) {
    if (!el) return;
    if (seen(key)) { el.hidden = true; return; }
    el.hidden = false;
    var x = el.querySelector('[data-hint-dismiss]');
    if (x) x.addEventListener('click', function () {
      el.hidden = true;
      try { localStorage.setItem(key, '1'); } catch (e) { /* private mode: it comes back */ }
    });
  }

  /* Kept so an un-migrated caller still works — but it no longer fires.
   * Silently turning an auto-open into a no-op would be worse than either
   * behaviour, so it says so once in the console. */
  function maybe(steps, key) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('PLDTour.maybe no longer auto-opens. Use PLDTour.offer(steps, key, {button}).');
    }
    return offer(steps, key, {});
  }

  root.PLDTour = { run: run, offer: offer, hint: hint, seen: seen, maybe: maybe };
})(typeof globalThis !== 'undefined' ? globalThis : this);

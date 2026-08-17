/* Scroll the league bar to the page you are actually on.
 *
 * THE BAR DOES NOT FIT AND IS NOT MEANT TO. It carried abbreviated labels
 * below 560px so four items would fit; that was reversed deliberately in
 * tw.css, because the two entries that lost their names were the two desks the
 * bar exists to expose. The replacement is a horizontal scroll with snap
 * points and full labels, and it comes with an obligation the stylesheet
 * states outright: "the active item is scrolled into view on load so you can
 * always see where you are."
 *
 * NOTHING DID THAT. The bar is 723px of content in a 390px viewport, so on a
 * phone the current item was visible only if it happened to be one of the
 * first two. It never was on the season calendar, whose entry is last:
 * measured at 559..717px, entirely off screen, with scrollLeft still 0. The
 * page you were on was the one page the bar would not show you, behind a
 * sideways swipe with nothing to suggest it.
 *
 * ONE IMPLEMENTATION, loaded by all four desks. A per-page copy of this is
 * four chances to fix it once and leave the other three.
 *
 * Called again by name from today.html: that file serves two routes off one
 * document, so it cannot mark its current item in the markup and does it at
 * boot instead — after this module's own DOMContentLoaded pass has already
 * run and found nothing.
 */
(function (root) {
  'use strict';

  function center() {
    var bar = document.querySelector('.leaguebar-in');
    if (!bar || !bar.scrollWidth) return false;
    var cur = bar.querySelector('[aria-current="page"]');
    if (!cur) return false;
    /* Nothing to do when it already fits — and doing nothing matters, because
       scrolling a bar that fits would shift a row the reader can see all of. */
    if (bar.scrollWidth <= bar.clientWidth) return true;

    var want = cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2;
    var max = bar.scrollWidth - bar.clientWidth;
    want = Math.max(0, Math.min(max, want));
    /* `auto`, not `smooth`: this runs on load, and a bar gliding sideways as
       the page appears reads as the layout still settling. It also respects
       reduced-motion without needing to ask. */
    if (bar.scrollTo) bar.scrollTo({ left: want, behavior: 'auto' });
    else bar.scrollLeft = want;
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', center);
  } else {
    center();
  }

  root.PLDLeagueBar = { center: center };
})(typeof globalThis !== 'undefined' ? globalThis : this);

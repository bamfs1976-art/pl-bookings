# Getting between the desks

> Moved unchanged from the old README.md on 8 September 2026 ("Getting between the desks"). The README is now an orientation page; this file keeps the full prose.

## Getting between the desks

There is a **league switcher** on every page — Premier League · Championship · La Liga · Today — sticky under the topbar, marking the desk you are on.

It is worth recording why it had to be added, because nothing caught the problem. The Championship and La Liga desks were built, tested, guarded, deployed and live, and the home page's only link to another desk was the phrase "Today's Card" inside a paragraph of prose on the Guide tab. Two of the four desks were, in practice, undiscoverable: every page passed its own guards, every URL resolved, the deploy was green, and *nothing asked whether anything linked to them*. `scripts/check-nav.mjs` asks now — that each desk links to all four, marks exactly one as current and marks the right one, and that each pretty URL is routed **before** the catch-all in `_redirects` (a missing rule does not 404, it silently serves the Premier League page at the Championship's URL).

**The first-run tour names them too.** All three of its steps used to be about the Premier League desk, so a new visitor could finish the introduction to the site without learning that two thirds of it existed. There is now a fourth step spotlighting the switcher, and `TOUR_KEY` was bumped so anyone who had already dismissed the old tour sees it once — otherwise the people most in need of the step are exactly the ones who never get it.

**And the combined views are advertised, not merely linked.** A link to `/today` is not the same as knowing what is on it: the cross-league card for a single date and the whole-season calendar both sit a level *below* that page, behind the "Every date" toggle. Each league desk now carries a short note pointing at both, `/today` and `/today#all`, and `check-nav` pins the deep-link handler in `today.html` that makes the second one land on the calendar rather than the single-date view.

Two details are load-bearing on a phone. The bar is **sticky**, because `index.html` restores its scroll position on load — it opens 131px down, so a bar in normal flow was already off-screen when the page appeared, on the one page that most needed it. And the labels **shorten below 560px**: at full length the row needs 625px and the widest iPhone is 430, so "La Liga" and "Today" sat off the right edge on every handset, behind a horizontal swipe nobody would think to try.

Adding it also exposed that index's topbar does not fit a phone at all — the account button wrapped onto a second line and landed on top of the switcher, covering "Today". The controls a phone does not need are now dropped below 560px: the command palette is keyboard-only, the live-basis chip repeats the hero card immediately beneath it, and the density and account labels are carried by their icons.

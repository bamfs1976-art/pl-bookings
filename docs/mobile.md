# Install as an app, and the phone

> Moved unchanged from the old README.md on 8 September 2026 ("Install as an app", "The share buttons did nothing on an iPhone" and "Touch targets"). The README is now an orientation page; this file keeps the full prose.

## Install as an app

The site is a PWA: on iPhone open it in Safari → Share → Add to Home Screen; Chrome on Android offers Install app. It launches full-screen with an offline app shell (live data still needs a connection).

**Every desk is a phone app, not just the Premier League one.** `/today`, `/eflc` and `/laliga` shipped without a manifest link, an apple-touch-icon, a theme colour or a service-worker registration, so adding any of them to an iPhone home screen produced a screenshot thumbnail that opened in a Safari tab. They also declared `viewport-fit=cover` — which pushes the page under the notch and the home indicator — without ever padding the content back out with `env(safe-area-inset-*)`, which is strictly worse than not opting in. Both are fixed, and the offline shell now precaches all four desks and the shared modules rather than the Premier League page alone.

The shell is also cached one entry at a time instead of with `addAll`. `addAll` is atomic: a single 404 rejects the install and the app has **no** offline shell at all, so one renamed data file would have taken the whole PWA down rather than costing it one page. With 28 entries across four desks that stopped being a sensible trade.

### The share buttons did nothing on an iPhone

This is the one worth reading. **iOS Safari ignores the `download` attribute on a `blob:` URL.** The desktop idiom every card used —

```js
a.href = URL.createObjectURL(blob); a.download = name; a.click();
```

— is silently inert on an iPhone: the card renders, the tap does nothing, and there is no error in the console. The site's headline feature was dead on the device most people would open it on, on all four desks plus the CSV exports and the calendar invite, and nothing in the test suite or the browser could see it.

`assets/save.js` now owns every file the site hands over. Where the Web Share API can take files it opens the **native share sheet** — Save Image, Messages, WhatsApp, Instagram — which for a card meant to be posted is not a workaround for the download but a better destination than it. Everywhere else it falls back to the anchor, because Web Share with files is still missing on most desktop browsers. Dismissing the sheet returns `cancelled` and does **not** fall through to a download: the user just declined that file, and handing it over anyway is the kind of thing that makes a share button feel broken in the other direction.

Two details that are easy to get wrong and are pinned by tests: the dedupe of `AbortError` from a genuine failure (the first is a decision, the second needs the fallback), and the fact that the fix has to be in *one* place — the broken idiom was spread across five call sites in `index.html` alone, so fixing any one of them fixed nothing.

### Touch targets

Apple's minimum is 44px. The watchlist star was 15px with one on every row, which on a thumb is a coin toss between starring a player and starring his neighbour — around 400 of them per desk. Raised, along with buttons, selects, tabs, the hamburger and the search fields, inside `@media (pointer: coarse)` so the desktop table keeps its density.

Raising form controls to 16px is what stops iOS zooming the page when one takes focus — and it caused a regression worth recording, because it did not look like one. A `<select>` sizes itself to its longest option, so at 16px `/today`'s date picker became 428px and La Liga's referee filter 384px on a 390px screen. Neither *overflowed*: Safari responds by widening the layout viewport and shrinking the entire page to fit, so the only symptom is that the app renders slightly zoomed out. `select{max-width:100%}` caps it; `scripts/check-mobile.mjs` fails the build if the font size is raised again without the cap.

`scripts/check-mobile.mjs` guards all of the above and runs in CI. Every one of these failures was invisible on a desktop and silent on the phone, which is exactly why they are assertions rather than something to re-check by hand.

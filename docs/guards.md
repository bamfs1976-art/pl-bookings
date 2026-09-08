# The guards: what each one protects against

A report for a human decision, written 8 September 2026. Nothing was deleted
or changed to produce it. It lists every script under `scripts/` that
`.github/workflows/ci.yml` runs, one line each: the silent failure it exists
for, what kind of thing it guards, and whether the same check would be cheaper
as a unit test in `tests/test-core.mjs` or `tests/test-libs.mjs`.

**Kinds.** *Number*: a figure a bettor acts on (a price, a heat, a count, a
line). *Join*: a data join, where finding nobody looks like a feed carrying
nothing and finding the wrong person looks like success. *Product*: a product
decision, where the failure is a page that renders and misleads (unreachable,
unstyled, unreadable, the wrong clock).

**Cheaper as a unit test?** A guard earns its place when it reads the real
committed data, the real pages or the real workflow files, because the failure
it catches lives in those files. Where a guard mostly exercises a pure
function with hand-built inputs, the same assertion belongs beside the
function's other tests: it runs in the same process, needs no page parsing,
and fails with a line number. Those are flagged. Flagging is a suggestion for
the reviewer, not a change.

The six committing workflows do not call these by name: `scripts/check-all.mjs`
globs `check-*.mjs` and runs every one before a push, and `check-ci-wiring.mjs`
fails CI if a guard exists that `ci.yml` does not also list.

## The scripts CI runs

| Script | Silent failure it protects against | Kind | Cheaper as a unit test? |
|---|---|---|---|
| `check-inline.mjs` | A syntax error inside one of the thirteen inline `<script>` blocks ships, because the pages have no build step and nothing else compiles them. | Product | No: it must read the pages. |
| `build-model.mjs` (run as a reproducibility check) | The season prior stops regenerating cleanly from `pl_data.js`, so the committed `data/model.js` and the data drift apart without a diff. | Number | No: it is the build itself. |
| `vendor-libs.mjs --check` | A byte inside 787 KB of vendored library code moves. Half a megabyte of minified JavaScript is unreviewable by eye. | Product | No: it hashes the committed bytes. |
| `check-data.mjs` | The Premier League dataset regresses: a club under its squad floor, an inline dataset back in `index.html`, a suspension ladder that is the wrong league's, a stale match model, the strip reading last season's cautions. | Number | No: reads the shipped dataset and page. |
| `check-transfers.mjs` | The hand-written transfer overlay, the only input allowed to overrule a feed, stops describing the squads beside it and becomes a second source of truth. | Join | No: reads the overlay against the dataset. |
| `check-core-insights.mjs` | The vendored fouls file is well-formed and about last season, putting a "live rate" marker beside 2025-26 numbers. | Number | No: reads the committed file. |
| `check-eflc.mjs` | The Championship desk prices outside the 25 to 60% range a bookings market occupies, or prices the division away from the card rate it produced. | Number | No: re-prices the shipped dataset. |
| `check-laliga.mjs` | The discovered club registry and the dataset describe different divisions, or the bought referee join covered a fraction of the season and looks complete. Also the strip reading `yc` instead of `sc`. | Join | No: reads three committed files together. |
| `check-share.mjs` | A share card, the one artefact that leaves the site, draws the wrong numbers, drops a league's identity, or truncates the 18+ line off the end. | Number | No: runs the renderer over real desk data. |
| `check-models.mjs` | The three desks price the same thing differently; a desk drifts more than a tenth from its division's real card rate, or a player above 55%; a desk goes back to the logistic. | Number | No: it is a calibration check over the datasets. |
| `check-nav.mjs` | A desk is built, deployed and live and nothing links to it; a pretty URL is routed after the catch-all and silently serves the wrong page. | Product | No: reads the pages and `_redirects`. |
| `check-mobile.mjs` | The share buttons do nothing on an iPhone; a select widens the layout viewport; a missing precache entry; a module a page loads that the offline shell does not carry. | Product | No: reads the pages and the service worker. |
| `check-styles.mjs` | Markup emits a class no rule backs, so a fixture list renders as one paragraph. | Product | No: reads every page's CSS. |
| `check-firstrun.mjs` | A tour opens over a page the visitor has not seen; a metric appears undefined; two routes share a title; a footer loses the age notice. | Product | No: reads the pages. |
| `check-accas.mjs` | One fixture fills two legs, one club appears in two legs, both sides of the match odds on one slip, a short acca captioned as a nine-fold. The allocation is checked against exhaustive search over 6,000 random boards. | Number | **Partly.** The exhaustive-search comparison of the allocator is a pure-function property and belongs in `tests/test-core.mjs`; the cross-league pool built from the three datasets should stay here. |
| `check-lineup-pricing.mjs` | A fixture with no published lineup re-prices anyway; an XI weighting that lands anywhere but 990 player-minutes. | Number | **Yes.** Twelve checks over pure functions with built inputs; the byte-identical common case is a fixture-level unit test. |
| `check-matchday.mjs` | The two tabs disagree about which matchday it is for several hours of every matchday; the dropdown rolls over at kick-off while the tab rolls over at midnight. | Product | **Yes.** `PLDCore.currentRound` over a season of fixtures is a pure property; the "one implementation" grep of the pages is the only part that needs the files. |
| `check-contrast.mjs` | A text colour fails WCAG AA on the ground it sits on, in either theme, on any desk. | Product | No: the tokens live in the CSS and the maths is trivial. |
| `check-palette.mjs` | A desk ships in another league's colour; a token exists on one desk and not the others, so a rule renders as no colour rather than an error. | Product | No: reads the four pages' styles. |
| `check-headers.mjs` | The CSP refuses the crest hosts the datasets reference; `X-Frame-Options: DENY` empties `/today` on WebKit; `_headers` and `netlify.toml` disagree. | Product | No: reads the header files against the data. |
| `check-referees.mjs` | The appointment fails to join across two id spaces; a hand pick loses to the feed; the dropdown shows a rate the model does not price with; two officials shorten to the same surname. | Join | No: exercises the real fixture list and card tables. |
| `check-record.mjs` | The track record grades a model nobody was shown: bands that stop meaning what the chip means, the referee split lost, "cleared the line" and "beat its own number" collapsed into one column. | Number | No: reads the route and the pages' constants. |
| `check-booked.mjs` | A leaderboard counts a second yellow as a yellow and a red, inflating exactly the players at the top; a fact about a named player is wrong. | Number | No: counts the committed ledgers. |
| `check-cross-refs.mjs` | A referee's record borrowed from the division next door is copied rather than scaled, or counted into the average it is measured against, at any of the five averaging sites. | Number | **Partly.** The scaling arithmetic is already pinned in `data/test_cross_refs.py`; the five-site exclusion check must read the pages. |
| `check-extra-feeds.mjs` | A parser for an endpoint written without a key returns `[]` for a moved field and writes a file full of nothing; a feed becomes required; two workflows own one file. | Join | No: reads the parsers, the outputs and the workflow. |
| `check-api-budget.mjs` | The 7,500-call daily allowance is overspent by a step whose `if` disagrees with its name, or a browser-facing function whose cost scales with readers. | Product | No: computed from the workflow files themselves. |
| `check-derbies.mjs` | A second derby list appears and drifts from the first, so the backtest excludes fixtures the desk prices with no boost. | Number | **Partly.** "Every derby names two real clubs" is a data test; "exactly one list exists" must grep the pages. |
| `check-clock.mjs` | A kick-off reads "04:30 PM" in New York and "16:30" in London because a call site passed `undefined` as the locale. | Product | **Yes.** Running the helper in en-US, es-ES, de-DE and ja-JP is a pure unit test; the "no page keeps a clock of its own" grep is the only page-reading part. |
| `check-heat.mjs` | "Booking heat" names two different quantities on one page; the bands stop matching the scale. | Number | **Partly.** The band cut-offs are a unit test; "the chip is the model's number" must read the page. |
| `check-build-data.mjs` | The pipeline front door and `data-refresh.yml` drift into two lists of the same steps, and one quietly loses a column. | Join | No: reads the runner against the workflow. |
| `check-ci-wiring.mjs` | A correct check that nothing invokes: a workflow commits without running the guards, or a guard exists that CI does not list. | Product | No: reads the workflow files. |
| `check-rotation.mjs` | The rotation model stops saying what the data says: a lift whose interval includes zero, or the fit not re-deriving from the committed record. | Number | **Partly.** Re-deriving the fit from `pl_lineups_2526.js` is a data check; the band-cut and "no card model reads it" assertions are unit-shaped. |
| `check-desk-widgets.mjs` | A sortable table reorders without announcing it; the price check reports a cheerful green edge on a bet inside the bookmaker's margin. | Number | **Yes.** The price-check parse and the "inside the margin is never value" rule are pure functions; the table-announcement check is a small page read. |
| `check-match-record.mjs` | The write-once match record prices with different constants from the pages it grades, so a season of rows grades a model nobody was shown. | Number | No: reads the pages' constants and prices real fixtures. |
| `check-appointments.mjs` | The published-appointments overlay stops being applied, or an official's spelling stops joining to a card record, and a fixture reads "appointed" while pricing at a neutral referee. | Join | No: reads the committed fixture list and card table. |
| `check-fetch-appointments.mjs` | The fetcher asks for the wrong rounds or the wrong RFEF filename, an EFL article stops surviving its markup, or the workflow stops running it before it commits. A week with no appointments looks like a week nobody ingested. | Join | **Partly.** The EFL markup-stripping cases are pure fixtures; the round selection and the workflow wiring need the real files. |
| `check-suspension.mjs` | The Premier League strip counts last season's cautions during the rollover; the third percentage wraps onto its own line. | Number | No: reads the page and the shared stylesheet. |
| `check-fatigue.mjs` | The displayed fatigue factor gets multiplied into the price, one line away, on a measured effect of the wrong sign whose interval contains zero. | Number | **Partly.** The measured effect re-derives from the record and stays; "no card model reads the factor" is a page grep and a unit assertion could pin the exclusion directly. |

## Summary for the reviewer

- 38 scripts: the 36 `check-*.mjs` guards that `check-all.mjs` also runs
  (`check-inline.mjs` among them), plus `build-model.mjs` as a reproducibility
  check and `vendor-libs.mjs --check`. By kind: 18 guard a number a bettor acts
  on, 7 guard a data join, 13 guard a product decision.
- Four look cheaper as unit tests outright: `check-lineup-pricing`,
  `check-matchday`, `check-clock` and `check-desk-widgets`. Each mostly
  exercises pure functions with built inputs and keeps a small page-reading
  tail that could stay as a much shorter guard.
- Seven are part guard, part unit test, and could be split: `check-accas`,
  `check-cross-refs`, `check-derbies`, `check-heat`, `check-rotation`,
  `check-fetch-appointments` and `check-fatigue`.
- The rest read committed data, pages or workflow files and cannot be
  cheaper as unit tests, because the failure they catch lives in those files.
- Moving anything is a decision for a person. The cost of the current shape
  is about ten seconds per run of `check-all.mjs`; the benefit of a move is a
  line-numbered failure and one fewer file to keep in `ci.yml`.

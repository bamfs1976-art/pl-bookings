# QA results — the readiness pass

*Run 2026-09-05/06 against `claude/readiness`, Chromium via Playwright at
390 × 844 (iPhone-class), `deviceScaleFactor: 2`, served by
`python3 -m http.server`.*

## What was checked, and what the environment could not check

The sandbox serves the static files and nothing else. There are **no Netlify
Functions**, so `/api/fpl/*`, `/api/model-calibration` and `/api/match-record`
all 404, and outbound requests to `cdn.sportmonks.com`,
`media.api-sports.io` and Google Fonts are blocked by the proxy.

Two consequences, and the first is the one that matters:

- **The Premier League desk renders no fixture cards here at all.** `LIVE` is
  null without the FPL proxy, so `renderGameweek` has nothing to draw. Its Why
  lines, team-sheet notices and bench rows could not be observed in this
  environment. They are covered by `check-why`, `check-lineup-ui` and
  `tests/test-core.mjs`, and the same code paths were observed working on the
  Championship desk — but this is a gap in the visual QA and is recorded as
  one rather than glossed.
- Crests and webfonts do not load, so the screenshots show fallback badges and
  system faces. Both degrade as designed (`crestOn` falls back to a badge,
  `face` to a monogram).

Everything below was observed, not inferred.

## The four desks at 390px

| | PL | Championship | La Liga | /today |
|---|---|---|---|---|
| Opens dark | ✅ | ✅ | ✅ | ✅ |
| `body` background | `#0b0f1a` | `#0b0f1a` | `#0b0f1a` | `#0b0f1a` |
| Horizontal page scroll | none | none | none | none |
| League switcher, current marked | ✅ | ✅ | ✅ | ✅ |
| Bottom tab bar | 6 items | 4 items | 4 items | n/a by design |
| Calibration notice | ✅ | ✅ | ✅ | ✅ |
| 18+ / BeGambleAware on the page | ✅ | ✅ | ✅ | ✅ |
| Why lines rendered | — (no feed) | 120 | 100 | 4,190 |
| Team-sheet notices | — (no feed) | 24 | 20 | 1,190 |
| Referee Thursday control | ✅ | ✅ | ✅ | ✅ per day |
| Uncaught page errors | none | none | none | none |

`/today` has no bottom tab bar and no tour button by design: it is the
combined view and navigates by the league switcher. `check-firstrun` already
excludes it from `DESKS_WITH_A_TOUR`.

## Theme (item 6)

- All four open **dark** with no stored preference, on the `<html>` attribute
  before first paint — no flash of the light theme on any of them.
- Toggling to light on the Premier League desk and then navigating to the
  Championship, La Liga and /today: **all three followed**, and each toggle
  button read "Dark" correctly. That did not work before this pass; the choice
  had to be made four times.
- Seeding an old `eflc_desk_theme=light` in a fresh profile and reloading:
  migrated to `bd_theme=light`, theme applied. Nobody's existing choice is
  thrown away.

## Confirmed team sheets (item 4)

Exercised end-to-end on Championship matchday 5 (BIR v WOL) by serving a
substituted `data/lineups.js` through Playwright's route interception, because
the four sheets currently in the repository are all Premier League fixtures and
that desk cannot render here.

| Sheet | Notice rendered | Prices | Candidates |
|---|---|---|---|
| Both sides, readable | `xi-ok` — "✓ Starting elevens confirmed" | re-weighted to the XI (Mosquera 29.9% → 34.0%) | five starters |
| A starter who will not join | `xi-unresolved` — "⚠ Team sheet unread" | **unchanged** | unchanged |
| No sheet | `xi-pending` — "⏳ Lineups pending" | unchanged | unchanged |

The unresolved and pending prices are identical, which is the required
negative: a sheet the desk cannot read must not re-price anything.

**One real defect was found here and fixed during the QA pass.** With the top
candidate named on the bench, he did not grey — he *vanished*. The sibling
desks price a named substitute at almost no expected minutes, so his
probability collapsed and he dropped out of the top four before the card was
built; a flat "top five" slice then cut whatever was left. Either way a reader
watching that player saw the list quietly reshuffle and was told nothing, which
is the exact silent disappearance the feature exists to prevent. Those desks
now recompute who would have been shown without the sheet, carry any of them
now benched through to the card, and slice the *starters* rather than the whole
list. Re-run:

```
--- TOP CANDIDATE BENCHED ---
note: xi-note xi-ok :: ✓ Starting elevens confirmed
   start | "29.1%" | T. Gardner-Hickman
   start | "28.7%" | André
   start | "22.0%" | Hwang Hee-Chan
   start | "21.9%" | J. Stansfield
   start | "17.7%" | C. Klarer
   BENCH | "Bench" | Y. Mosquera
```

Greyed, below the eleven, no percentage. `check-lineup-ui` now pins both
halves, and the assertion had to be anchored on `var show` after a mutation
test showed an unanchored pattern was satisfied by `priceBlock`'s identical
slice a few lines above.

## First-session tour (item 7)

Walked all four steps on the Premier League desk:

```
Step 1 of 4  This Gameweek                      panel-gameweek   screener closed
Step 2 of 4  Why this player                    panel-gameweek   screener closed
Step 3 of 4  Keep a player                      panel-players    screener closed
Step 4 of 4  Three leagues, and a combined view panel-gameweek   screener closed
after Done:  overlay closed, pl_desk_tour_seen_v3 set, back on This Gameweek
```

The screener stayed behind its pill at every step, on both the panel's
`hidden` attribute and the pill's `aria-selected`. No page errors.

## Share sheet (item 9, and the existing cards)

`PLDSave.file` was stubbed to capture the blob rather than download it.

| Desk | Card | Filename | Size |
|---|---|---|---|
| Championship | Referee Thursday | `eflc-bookings-referees-matchday-5.png` | 380 KB |
| Championship | Matchday | `eflc-bookings-matchday-5.png` | 396 KB |
| La Liga | Referee Thursday | `laliga-bookings-referees-matchday-4.png` | 341 KB |
| La Liga | Matchday | `laliga-bookings-matchday-4.png` | 394 KB |

The rendered Referee Thursday card was inspected as an image: twelve officials
ranked ×1.25 down to ×0.75 (strictest first), each row carrying yellows a game,
cards per foul and the fixture, the panel subtitle naming the division's own
3.71 pivot, and the `18+ · begambleaware.org` line in the footer. The existing
matchday card is unchanged.

## Channel attribution (item 12)

In one browser profile, across three desks:

```
first visit  eflc.html?src=reddit    -> {"src":"reddit","at":"2026-09-06T09:48:45.798Z"}
later visit  laliga.html?src=seo     -> {"src":"reddit", ...}   unchanged
unlisted     today.html?src=facebook -> {"src":"reddit", ...}   unchanged
fresh profile, untagged visit        -> null
```

First touch survives a later tagged visit on a different desk, an unlisted
value is dropped, and an untagged visit stores nothing.

## Shared modules (item 11)

No 404s for `/shared/share.js`, `/shared/save.js` or `/shared/suspension.js`
on any desk. `PLDShare`, `PLDSave` and `PLDSuspension` all resolve where the
page loads them. `/today` has no `PLDSuspension` — it loads no suspension
strip, which is why `check-shared` requires each module to be loaded by *some*
desk rather than by all four.

## /api/model-calibration returns aggregates only — confirmed

Read `netlify/functions/model-calibration.js` directly (it cannot be called
here). Its PostgREST query selects
`season, league, md, prob, carded, model_version, logged_at` from
`plb_card_predictions` and nothing else: no `user_id`, no email, no pick rows.
The response is Brier, log loss, observed booking rate, sample size, a
ten-bin reliability curve, the top-20-per-matchday hit rate, and the same
figures broken down by league. Those are model forecasts keyed by fixture and
player, computed server-side. **No user data is exposed.**

## Guards and tests at the end of the pass

```
node tests/test-core.mjs        182 tests passed
node tests/test-libs.mjs        OK
node tests/test-webpush.mjs     OK
python3 data/test_leagues.py    OK
python3 data/test_laliga.py     OK
node scripts/check-all.mjs      all 41 guards passed
```

Four guards were added this pass (`check-lineup-ui`, `check-why`,
`check-shared`, `check-attribution`), each named as a step in `ci.yml` and each
mutation-tested against the specific mistake it exists to catch.

## Two things found in passing, and what was done about them

**`rankCard` had never been rendered in CI.** `check-share`'s stub canvas had
no `arc()` or `clip()`, which `face()` needs, so the renderer behind the booked
leaderboards threw the moment anything actually drew a row. A stub missing a
method does not fail a test that never calls it; it fails the first test that
does — which was the Referee Thursday assertion. The stub is complete now and
that renderer is exercised.

**The README described a league-bar behaviour that had been reversed.** It said
the labels shorten below 560px. They do not: shortening was tried, abandoned
because the two items that lost their names were the two nobody could then
identify, and replaced by a scroll-snapping row that keeps every label. The
reasoning is in the second `@media (max-width:560px)` block in `assets/tw.css`;
the README paragraph now matches it.

**The booking-heat tooltip quoted the wrong derby factor.** Found while
writing up the open question about the two constants. The chip's modelled
branch describes a figure built by adding up every player's own chance — each
scaled by ×1.08 — and stated that ×1.15 had been applied, which is the factor
that scales a match *total* and is used only by the cards-against fallback
below it. Both numbers are right about their own quantity; the sentence
attached one to the other. It is the same "two numbers, one name" defect this
chip was already fixed for once, and it landed on the one part of it nobody
had thought to check. The label now names the per-player figure and says "on
each player"; the fallback branch keeps ×1.15, because there it is correct.
`check-heat` asserts each branch against its own constant and fails if the two
are ever collapsed — mutation-tested in all three directions.

## Left for the owner

- The **301 from `playerbookings.netlify.app`** cannot be made from this
  repository — it is a separate Netlify site. The four steps are in README
  under "One brand".
- The **repository description** cannot be set from a commit. The one line to
  paste is in the pass report.
- **Item 10 was not implemented**, as instructed. It is not authorised.
- **Whether the two derby factors should be reconciled** (×1.08 per player,
  ×1.15 per match total) is a modelling question, not a tidying one: changing
  either moves published prices. It belongs with the November refit.
- The **Premier League desk's Why lines, team-sheet notices and bench rows
  remain visually unverified** — see the environment note at the top. Worth
  five minutes on the deployed site once this merges.

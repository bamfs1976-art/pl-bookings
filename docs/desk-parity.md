# Desk parity: what the Premier League app has that the others do not

A feature-by-feature audit of `index.html` (Premier League) against `eflc.html`
(Championship) and `laliga.html` (La Liga), for the purpose of making the three
an identical product.

Evidence is from the files as they stand at the time of writing. Where a gap is
caused by missing **data** rather than missing **interface**, that is called out,
because the two need completely different work.

## The headline: the data is already at parity, the interface is not

The datasets are field-identical.

| | `pl_data.js` | `eflc_data.js` | `laliga_data.js` |
|---|---|---|---|
| CLUBS fields | `short name img basis ca caH caA fm squad` | identical | identical |
| PLAYERS fields | `c n p min yc rc y f fw r ls b` | identical **+ `sc` `sm`** | identical **+ `sc` `sm`** |

So almost every gap below is interface work on data that is already shipped. The
Championship and La Liga desks even carry two fields the Premier League dataset
does not (`sc`/`sm`, this season's cautions and minutes), because their
suspension strips read from a harvested season file rather than a live feed.

The genuine data gaps were four. Three are closed; what remains is listed at the end.

## Views

| View | PL | EFLC | LL |
|---|---|---|---|
| This Gameweek / This Matchday landing | ✅ | ✅ | ✅ |
| Players | ✅ | ✅ | ✅ |
| Fixtures | ✅ | ✅ | ✅ |
| Clubs | ✅ | ✅ | ✅ |
| Referees | ✅ | ✅ | ✅ |
| Guide | ✅ | ✅ | ✅ |
| Tracker (logged predictions, P/L, ROI) | ✅ | ❌ | ❌ | *(item 9, the one left)* |

**Settled.** All three now open on a fixture-first landing view — the next
round ranked hottest to coolest, with matches, expected cards, cards a match and
referees-appointed across the top. Before this the newer desks opened on a table
of 974 / 783 players, which was a different product on first impression rather
than a different skin.

**Tracker is the one view still missing** from the other two.

**Tracker** logs each gameweek's predictions and scores them. It is backed by
Supabase and an hourly Netlify function (`log-predictions`) that is wired to the
Premier League data only.

## Per player

| Feature | PL | EFLC | LL | Gap type |
|---|---|---|---|---|
| Risk score, YC/90, Fouls/90, Mins | ✅ | ✅ | ✅ | — |
| P(card) + fair odds | ✅ | ✅ (as columns) | ✅ (as columns) | — |
| Odds input → edge % + verdict | ✅ | ✅ | ✅ | — |
| Watchlist star | ✅ | ✅ | ✅ | — |
| Suspension watch strip | ✅ | ✅ | ✅ | — |
| Player photos | ✅ | ✅ | ✅ | *(done — the field was already in the API response and being discarded)* |
| Availability flags | ✅ | ⏳ | ⏳ | *(wired from the same response; reads false for every player so far)* |
| Confidence / low-sample dot | ❌ *(dead CSS)* | ✅ | ✅ | *(audit error — now on all three)* |
| Recent card-form arrow | ✅ | ✅ | ✅ | *(done — from `sc`/`sm`)* |
| "All players" second view | ✅ | ✅ | ✅ | *(done — a card per player beside the table)* |
| Player notes | ✅ | ✅ | ✅ | *(done — kept beside the watchlist, marked in the table)* |
| CSV export | ✅ | ✅ | ✅ | *(done)* |

## Per match

| Feature | PL | EFLC | LL | Gap type |
|---|---|---|---|---|
| Fixture card, booking heat, ranked | ✅ | ✅ | ✅ | — |
| Referee picker, rescales every number | ✅ | ✅ | ✅ | — |
| Team card markets (EXP / O3.5 / O4.5 / BTC) | ✅ | ✅ | ✅ | — |
| Share match card + share matchday card | ✅ | ✅ | ✅ | — |
| Thin-sample warning | ✅ | ✅ | ✅ | *(done)* |
| "Hide low sample" filter | ✅ | ✅ | ✅ | *(audit error — `#fMin`, "450+ minutes")* |
| High / Watch banding of players | ✅ | ✅ | ✅ | *(audit error — see note)* |
| Head-to-head strip | ✅ | ✅ | ✅ | *(done — Championship built by the workflow: 185 pairs)* |
| Derby boost | ✅ | ✅ | ✅ | *(done — 14 pairs each, priced at ×1.08)* |
| **Match model / game-state term** | ✅ | ❌ | ❌ | **data** (no source) |
| ICS calendar export | ✅ | ✅ | ✅ | *(done — from the player record's next fixture)* |

**Correction.** The banding row above originally read ❌ for both newer desks. It was
wrong: they band at the same 50% / 30% thresholds via a `band()` returning
`['hi','High']`, and the audit's grep looked for `>High<` and `"High"` so it
matched neither. Acting on the error made it worse — a second `band()` was
declared in the same scope, function declarations hoist and the last one wins,
so the fixture cards' banding was silently replaced by an HTML string whose
`[0]` is `"<"`. The cards kept rendering with a CSS class called `<`. Fixed by
deleting the duplicate and rendering the existing one as a pill.

**One of these is not cosmetic.** The Premier League desk folds in a vendored
Dixon–Coles match model (`data/sim_model.js`, from Plsimulator) that the other two
have no equivalent for. The three desks are calibrated to within a tenth of their
own division's card rate, so they are comparable — but a Premier League fixture's
heat carries a term the others' does not. That is worth stating on the page
rather than leaving implicit.

## Per team

| Feature | PL | EFLC | LL |
|---|---|---|---|
| Cards against per game | ✅ | ✅ | ✅ |
| Fouls per game | ✅ | ✅ | ✅ |
| Crest | ✅ | ✅ | ✅ |
| Tier (Card-heavy / Middling / Disciplined) | ✅ | ✅ | ✅ |
| Flame marker on combustible sides | ✅ | ✅ | ✅ |
| Top booking risk per club | ✅ | ✅ | ✅ |
| Home / away split columns | ✅ | ✅ | ✅ |
| Form basis, squad size, tier | ✅ | ✅ | ✅ |

**Settled.** Both tables now show one agreed set on all three desks, from the
identical fields every dataset already carried:

- **Clubs** — Club · Form basis · Cards/game · Home · Away · Fouls/game · Tier · Squad · Top booking risk. The Premier League gained Form basis, Home, Away and Squad as real sortable columns (home/away were a sub-line under the total, which cannot be sorted or read down); the newer desks gained Fouls/game and the combustible flame.
- **Referees** — Referee · Matches · Yellows/game · Fouls/game · Cards/foul · Reds/game · Pens/game · ×factor · Strictness, plus Career on the Premier League only, which comes from a 34-season history file the other divisions have no equivalent for. The Premier League gained the ×factor and the strictness bar: the multiplier the model actually applies was the one number its referee table never showed.
- **Tier vocabulary** — all three now read Card-heavy / Middling / Disciplined. The Premier League said Target / Mid / Fade, which are instructions to back or lay on a desk that says *research, not a tip* on every other line. Describing the club is both more accurate and the same words everywhere.

## App shell and UX

| Feature | PL | EFLC | LL |
|---|---|---|---|
| League switcher | ✅ | ✅ | ✅ |
| Dark mode | ✅ | ✅ | ✅ |
| PWA install / offline shell | ✅ | ✅ | ✅ |
| Share sheet on iOS | ✅ | ✅ | ✅ |
| Sidebar + mobile bottom tab bar | ✅ | ✅ | ✅ |
| Command palette (⌘K) | ✅ | ✅ | ✅ |
| Guided tour | ✅ | ✅ | ✅ |
| Glossary / help panel | ✅ | ✅ | ✅ |
| Beginner / Expert density toggle | ✅ | ✅ | ✅ |
| **Account + watchlist sync** | ✅ | ❌ | ❌ |
| **Skip link / landmarks** | ✅ | ❌ | ❌ |

**Settled.** All three now use the same shell: sidebar of areas, breadcrumb, and
a fixed bottom tab bar on a phone. This was the largest single cause of the
three feeling like different products — the navigation model differed before you
read a number — and it is shared code (`assets/shell.js`) rather than three
copies, so it cannot drift again.

Still outstanding on the newer desks: **account + watchlist sync** (part of item
9) and **skip links / landmarks**.

## Reverse gaps — all but one closed

Making the three identical was never one-directional. These existed only on the
newer desks and have been folded back into the Premier League:

1. ~~**Referee ×factor and Strictness as columns**~~ — done. The multiplier the model actually applies was the one number its referee table never showed.
2. ~~**Club home/away split columns**~~ — done. `caH`/`caA` were in the dataset and rendered only as an unsortable sub-line.
3. ~~**Squad size and form basis columns**~~ — done.
4. ~~**Confidence dot**~~ — done, and it ran furthest the other way: `.conf-dot` was dead CSS on the Premier League desk while its Guide described the feature to readers.

**Still open:** *fair odds as a player-table column.* The newer desks show it;
the Premier League desk keeps it behind a click on P(card).
4. **A tighter, more scannable club table** — form basis, squad size and the home/away split in one view.

## The four genuine data gaps

Everything else above is interface work on data already shipped. These four need
a harvest change first:

| Gap | Source | Status |
|---|---|---|
| Player photos | API-Football `/players` carries a photo URL; already called | open — needs a key |
| Availability flags | API-Football `/injuries`; a new endpoint and quota | open — needs a key |
| ~~Head-to-head~~ | football-data.co.uk, the *same* public-domain records already behind the referee figures and venue splits | **done** for La Liga; the Championship builds in the workflow |
| ~~Derby lists~~ | Editorial, hand-written | **done** — 14 pairs each, priced at ×1.08 per player, every short code checked against the shipped club list |

Not obtainable: the **match model**. Plsimulator publishes Premier League ratings
only. Until an equivalent exists for the Championship and La Liga, that term
stays Premier-League-only, and the honest move is to say so on the page.

## Audit errors found while implementing

Four rows were wrong, all for the same reason — a grep matching the wrong thing.
Recorded rather than quietly corrected, because the pattern is the lesson:

1. **High/Watch banding** — present on both newer desks via `band()` returning `['hi','High']`; the grep looked for `>High<` and `"High"`.
2. **"Hide low sample"** — present as `#fMin` ("450+ minutes"); the grep looked for `hideLow`/`lowSample`.
3. **Recent form arrow** — the probe matched `▲`, which is the *sort direction* indicator.
4. **Confidence dot** — the Premier League desk never rendered one. `.conf-dot` was dead CSS and its Guide described a feature the page did not have. The gap ran the *other* way.

## Found while implementing, not in the original audit

**The Premier League desk swaps to a card list on phones.** `renderPlayers()`
returns early behind `MOBILE_MQ.matches` and renders `renderPlayerCards()`
instead — so on a handset it shows stacked cards while the Championship and
La Liga desks show the scrollable table. This is a real look-and-feel
divergence on the device most people use, and it is not in any row above
because the audit compared features, not breakpoints. It should be settled one
way for all three.

**The Matchday list shipped completely unstyled on both newer desks.** Found
from a phone screenshot, not from any guard. `renderMatchday()` was ported from
`today.html` without the five rules that make it a layout — `.row`, `.teams`,
`.top`, `.heat`, `.when` — which lived in that page's inline `<style>` and
nowhere else. `.teams` and `.top` are spans, so with no flex container they
flowed inline and ran together; the Championship fixture list read
`Charlton Athletic v Derby CountyL. Travis 19% · M. Clarke 17%` as one wrapping
paragraph, twelve fixtures deep. `.btn.primary` was missed in the same port, so
"Share matchday" rendered as an ordinary outlined button.

Two things made it survive. `.stat` *did* come across, so the stats strip above
the list looked right and the breakage read as a formatting nit rather than a
broken panel. And a missing CSS rule throws nothing, fails no selector and logs
nothing — every guard in the suite passed, because they all check behaviour and
content rather than appearance.

Fixed in `assets/tw.css`, scoped to `#mdList`: `.row`, `.top` and `.heat` are
generic enough that `index.html` styles its own `class="heat"` chip, so sharing
them unscoped would have fixed two desks by restyling a third.
`scripts/check-styles.mjs` now asserts every literal class the four pages emit
has a rule in the CSS that page actually loads, and that the matchday rules
stay scoped. Its first version was itself satisfiable by the wrong text —
`includes('#mdList .row')` matched inside `#mdList .rowgroup`, and the sweep
accepted `#mdList .row:last-child` as proof the `display:flex` rule existed, so
a rename passed. It now requires a complete selector opening a rule.

**Unverifiable from the sandbox:** club crests on the newer desks come from
`media.api-sports.io` where the Premier League's come from
`cdn.sportmonks.com`. Both hosts are blocked by the build proxy, so crests
render broken locally on all three desks and neither can be checked here.

## Where this stands

**Done and live: items 1–8.** The two newer desks share the Premier League's
shell, open on the same fixture-card grid, and carry the same fixture cards,
player table, club and referee tables, tour, glossary, command palette, density
switch, head-to-head history, derby lists, player photographs and calendar
export. `/today` draws the same card as the three desks it combines. Several
gaps ran the other way and were folded back into the Premier League desk.

**Remaining: item 9 alone.**

| Item | What it needs | Blocker |
|---|---|---|
| 9 — Account sync, Tracker | Per-league Supabase tables and a `log-predictions` equivalent per division | Scope: a project rather than a change |

### Two corrections worth keeping

This table used to say item 8 was blocked on "an API-Football key and quota".
**It was not.** `map_player` had been receiving `player.photo` and
`player.injured` all along, on a call the harvester already made for all three
desks, and discarding both — they were dropped alongside the bug that put a
squad member's headshot on a club badge and never put back. The desks then went
without photographs on the grounds that there was no source, when the source was
the request already in flight. A note that says "blocked" is worth re-testing
before it is believed.

And item 6 was described as needing "a CI run to prove it". That was right, and
the run found something the builder could not: the workflow built the
head-to-head files and never staged them, so a green refresh committed nothing.
A build step whose output is not committed looks exactly like a success.

### What is left that is not an item

- **Availability is unproven.** `inj` is populated but reads false for all 1,757
  players. Plausible in pre-season; indistinguishable from "not wired" until a
  mid-season run puts a name on it.
- **Premier League photographs are 117 of 660.** The rest of that squad comes
  from the legacy ScoutingStats harvest, which carries no photo field. Fixing it
  means moving the PL squad build to API-Football, which changes every published
  Premier League number — a decision, not a chore.
- **Closing odds.** football-data.co.uk carries 1X2, over/under 2.5 goals and
  Asian handicap for E0, E1 and SP1 — free, already a dependency, reachable from
  the runner. No card markets anywhere free. Their use here is a backtest of
  whether the fitted "tight" figure should feed booking heat, which the Guide
  already flags as an open question.

## Recommended order

1. ~~**Navigation shell**~~ — done: `assets/shell.js`, sidebar + breadcrumb + mobile bottom bar on both newer desks.
2. ~~**A "This Matchday" landing**~~ — done on both, priced through the same `priceFixture` as the Fixtures tab, and now drawing the same fixture-card grid the Premier League desk lands on.
3. ~~**Fixture card parity**~~ — done: thin-sample warning added; banding already existed (audit error). The card itself is now `fixtureCard()`, shared between both panels, with its CSS in `assets/tw.css` so all four pages draw one card.
4. ~~**Player table parity**~~ — done: confidence dot (all three), card-form arrow, CSV export, **player notes**, and an **All players** card view beside the table.
5. ~~**Club and referee table parity**~~ — done. One agreed set per table, applied in both directions.
6. ~~**H2H and derby lists**~~ — done. All three divisions carry real history: Championship 185 pairs over 1,094 meetings (3.79 yellows a meeting), Premier League 151/1,118 (4.00), La Liga 136/1,146 (4.82).
7. ~~**Tour, glossary, density toggle, command palette**~~ — done on the two newer desks, as shared modules (`assets/tour.js`, `assets/palette.js`, glossary + density in `assets/shell.js`).
8. ~~**Photos and availability flags**~~ — done. 974/974 Championship and 783/783 La Liga players carry a photograph; the flag is wired but has nothing to show yet.
9. **Account sync and Tracker** — the one item left, and the largest.
10. ~~**One palette, one chrome**~~ — done: see below.

Items 1–5 and 7 were interface work. Items 6 and 8 closed the data gaps. Item 9
is a project in itself.

## 10. One palette, one chrome

Feature parity is not the same as looking like one product, and the audit above
only ever asked the first question. Four pages each declared their own `:root`
and their own dark block — four copies of the same 25 neutrals — plus their own
buttons, cards, tabs, chips and captions. They had already drifted:

| | nav dot | share card | page `--accent` |
|---|---|---|---|
| Premier League | `#e90052` | `#3d195b`→`#e90052` | `#3d195b` ✓ |
| Championship | `#7c3aed` | `#1e1b4b`→`#7c3aed` | `#4b2e83` |
| **La Liga** | **`#ea580c`** | **`#7f1d1d`→`#ea580c`** | **`#4b2e83`** ← the Championship's |
| Today | gradient | `#0f172a`→`#0891b2` | `#0e7490` ✓ |

La Liga was built by copying the Championship's page, and the palette came with
it. So the desk wore the wrong league's purple while its own nav dot and its
own share cards were orange. The league's colour was written down in **five**
places — the page `:root`, the switcher dot, `share.js`, `/today`'s `.lg.*`
tags and three `style=""` attributes on the combined-note dots — and only some
of them agreed.

The quieter half of the same problem: the four copies disagreed about which
tokens EXISTED. `--target`, `--mid` and `--fade` were Premier League only. An
undefined custom property is not an error and not a warning — the declaration
is simply dropped — so a rule carried from that desk to another rendered with
no colour at all rather than breaking.

Now: every token lives in `assets/tw.css`, and a desk declares only which
league it is, by one class on `<html>`. The chrome — type, links, buttons,
cards, tabs, chips, captions — is one shared layer, and 137 duplicate rules
came out of the pages. The drift it had accumulated was individually trivial
and collectively the whole problem: `.stat` had a shadow on two desks and not
the third, `.empty` 26px of padding on two and 22px on the third, `.mono`
tabular figures on every desk except the one with the 900-row table.

`check-palette.mjs` holds it: no page may redeclare a colour, each wears
exactly one league class, `share.js` and the `theme-color` meta must match the
stylesheet they cannot read, and every `var(--x)` a page references must
resolve in both themes.

## What the guards learned

Every bug this audit's implementation shipped was SILENT — no exception, no
failing selector, no red test — and each one is now pinned:

| Failure | Guard |
|---|---|
| Markup emitting a class with no CSS rule | `check-styles.mjs` |
| A security header refusing the site's own resources | `check-headers.mjs` |
| A field reaching the builder and stopping at the writer | `test_coverage.py` (calls the real emitter) |
| A build step whose output is never staged | `check-nav.mjs` |
| A page that fails to boot and shows nothing | `today.html` names its own error |

The recurring defect is not in the code but in the guards: an assertion
satisfied by the WRONG TEXT. A substring matching inside a longer selector; a
`:last-child` border standing in for the `display:flex` that did the work; a
bound set by eye that failed the assertion rather than the code; a check still
reading a file after the rule moved out of it. Every one was found by mutation
— break the thing on purpose, confirm the guard fails — and none by reading.

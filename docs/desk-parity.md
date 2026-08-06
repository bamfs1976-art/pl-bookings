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

The genuine data gaps are four, and they are listed separately at the end.

## Views

| View | PL | EFLC | LL |
|---|---|---|---|
| This Gameweek / This Matchday landing | ✅ | ✅ | ✅ |
| Players | ✅ | ✅ | ✅ |
| Fixtures | ✅ | ✅ | ✅ |
| Clubs | ✅ | ✅ | ✅ |
| Referees | ✅ | ✅ | ✅ |
| Guide | ✅ | ✅ | ✅ |
| Tracker (logged predictions, P/L, ROI) | ✅ | ❌ | ❌ |

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
| **Player photos** | ✅ | ❌ | ❌ | **data** |
| **Availability flags** (injured / doubtful / suspended) | ✅ | ❌ | ❌ | **data** |
| Confidence / low-sample dot | ❌ *(dead CSS)* | ✅ | ✅ | *(audit error — now on all three)* |
| Recent card-form arrow | ✅ | ✅ | ✅ | *(done — from `sc`/`sm`)* |
| **"All players" second view** (Starts, RC, Won/90) | ✅ | ❌ | ❌ | mixed |
| **Player notes** | ✅ | ❌ | ❌ | interface |
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
| **Head-to-head strip** | ✅ | ❌ | ❌ | **data** (same source available) |
| **Derby boost** | ✅ | ❌ | ❌ | **data** (editorial list) |
| **Match model / game-state term** | ✅ | ❌ | ❌ | **data** (no source) |
| **ICS calendar export** | ✅ | ❌ | ❌ | interface |

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

| Gap | Source | Cost |
|---|---|---|
| Player photos | API-Football `/players` carries a photo URL; already called | low — one field through the existing harvester |
| Availability flags | API-Football `/injuries`; a new endpoint and quota | medium |
| Head-to-head | football-data.co.uk — the *same* public-domain records already used for referees and home/away, and they cover both divisions | low |
| Derby lists | Editorial, hand-written, as the PL list is | low |

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

## Where this stands

**Done and live: items 1–5 and 7.** The two newer desks now share the Premier
League's shell, open on a fixture-first landing, and carry the same fixture
cards, player table, club and referee tables, tour, glossary, command palette
and density switch. Several gaps ran the other way and were folded back into the
Premier League desk.

**Remaining: 6, 8 and 9**, and they are the three that need something this
repository does not already have.

| Item | What it needs | Blocker |
|---|---|---|
| 6 — H2H and derby lists | H2H built from football-data.co.uk (the *same* public-domain records already used for referees and home/away splits, covering both divisions); derby lists hand-written as the Premier League's is | The builder can be written, but the fetch is blocked from the build sandbox, so it must be written unrun and proved by a CI run |
| 8 — Player photos, availability flags | Photos are one extra field through the API-Football call already made; availability needs the `/injuries` endpoint | An API-Football key and quota |
| 9 — Account sync, Tracker | Per-league Supabase tables and a `log-predictions` equivalent per division | Largest of the three; a project rather than a change |

Nothing in 6, 8 or 9 is blocked on a *decision* — only on credentials, network
or scope.

## Recommended order

1. ~~**Navigation shell**~~ — done: `assets/shell.js`, sidebar + breadcrumb + mobile bottom bar on both newer desks.
2. ~~**A "This Matchday" landing**~~ — done on both, priced through the same `priceFixture` as the Fixtures tab.
3. ~~**Fixture card parity**~~ — done: thin-sample warning added; banding already existed (audit error).
4. ~~**Player table parity**~~ — done: confidence dot (all three), card-form arrow, CSV export. **Player notes still outstanding.**
5. ~~**Club and referee table parity**~~ — done. One agreed set per table, applied in both directions.
6. **H2H and derby lists** for both newer divisions (low-cost data work).
7. ~~**Tour, glossary, density toggle, command palette**~~ — done on the two newer desks, as shared modules (`assets/tour.js`, `assets/palette.js`, glossary + density in `assets/shell.js`).
8. **Photos and availability flags** (harvest work).
9. **Account sync and Tracker** — largest, needs per-league pipelines.

Items 1–5 and 7 are interface-only and would make the three desks look and behave
identically. Items 6 and 8 close the data gaps. Item 9 is a project in itself.

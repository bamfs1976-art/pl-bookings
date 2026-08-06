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

## Views: two whole sections are missing

| View | PL | EFLC | LL |
|---|---|---|---|
| This Gameweek / This Matchday landing | ✅ | ✅ | ✅ |
| Players | ✅ | ✅ | ✅ |
| Fixtures | ✅ | ✅ | ✅ |
| Clubs | ✅ | ✅ | ✅ |
| Referees | ✅ | ✅ | ✅ |
| Guide | ✅ | ✅ | ✅ |
| Tracker (logged predictions, P/L, ROI) | ✅ | ❌ | ❌ |

**This Gameweek is the biggest single divergence.** The Premier League desk opens
on a fixture-first landing view — matches ranked hottest to coolest, a hero
carrying the gameweek number, a deadline countdown and the model's live track
record, plus a watchlist card. The other two desks open on a table of 974 / 783
players. That is a different product on first impression, not a different skin.

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
| Tier (target / mid / fade) | ✅ | ✅ | ✅ |
| Flame marker on combustible sides | ✅ | ❌ | ❌ |
| Top booking risk per club | ✅ | ✅ | ✅ |
| Home / away split columns | ❌ | ✅ | ✅ |
| Form basis, squad size, discipline | ❌ | ✅ | ✅ |

The club tables have **diverged in both directions**. They show different columns
from the same fields, so neither is a subset of the other.

## App shell and UX

| Feature | PL | EFLC | LL |
|---|---|---|---|
| League switcher | ✅ | ✅ | ✅ |
| Dark mode | ✅ | ✅ | ✅ |
| PWA install / offline shell | ✅ | ✅ | ✅ |
| Share sheet on iOS | ✅ | ✅ | ✅ |
| Sidebar + mobile bottom tab bar | ✅ | ✅ | ✅ |
| **Command palette (⌘K)** | ✅ | ❌ | ❌ |
| **Guided tour** | ✅ | ❌ | ❌ |
| **Glossary / help panel** | ✅ | ❌ | ❌ |
| **Beginner / Expert density toggle** | ✅ | ❌ | ❌ |
| **Account + watchlist sync** | ✅ | ❌ | ❌ |
| **Skip link / landmarks** | ✅ | ❌ | ❌ |

The two newer desks use a plain topbar and an underlined tab strip. The Premier
League desk uses the full app shell. **This is what makes them feel like
different products more than any individual feature does** — the navigation
model differs before you read a single number.

## Reverse gaps: things to fold back into the Premier League desk

Making the three identical is not purely a matter of copying *from* the Premier
League. These exist only on the newer desks, or are better there:

1. **Referee ×factor and Strictness as table columns** — both desks show them as sortable columns. The PL referee table shows Reds/game, Pens/game and Career instead; it does carry the ×factor, but inline rather than as a column you can rank on.
2. **Club home/away split columns** — the PL dataset carries `caH`/`caA` and never displays them.
3. **Fair odds and Basis as player-table columns** — on the PL desk fair odds are behind a click on P(card).
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

## Recommended order

1. **Navigation shell** — sidebar and bottom tab bar on all three. Biggest felt difference, no new data.
2. **A "This Matchday" landing** on both newer desks, mirroring This Gameweek.
3. **Fixture card parity** — High/Watch banding, thin-sample warning on all three.
4. **Player table parity** — confidence dot, form arrow, notes, CSV, and settle one column set across all three.
5. **Club and referee table parity** — pick one column set per table, in both directions.
6. **H2H and derby lists** for both newer divisions (low-cost data work).
7. **Tour, glossary, density toggle, command palette** on all three.
8. **Photos and availability flags** (harvest work).
9. **Account sync and Tracker** — largest, needs per-league pipelines.

Items 1–5 and 7 are interface-only and would make the three desks look and behave
identically. Items 6 and 8 close the data gaps. Item 9 is a project in itself.

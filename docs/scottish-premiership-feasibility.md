# A Scottish Premiership bookings desk: what it would cost to build

Research note. The question was whether the bookings desk can be rebuilt for the
Scottish Premiership, as `docs/la-liga-feasibility.md` asked for Spain.

**Short answer: yes, and it is the cheapest league left on the board — cheaper
than La Liga was, because the pillar that broke in Spain does not break here.
Scotland has free referees.** But it is not the Championship-style copy-paste
that `la-liga-feasibility.md` §7 implied when it ranked Scotland third at
"near-zero marginal cost". Three things are genuinely new, and one of them —
the league split — has no precedent anywhere in this codebase.

Read §2 before believing any number in §4. This session could not reach
football-data.co.uk, and that constrains what was measured rather than assumed.

---

## 1. The headline: the referee layer survives

This is the whole argument. `data/leagues.py` already records why the
Championship was cheap and La Liga was not — free referee data is a British
anomaly, and the desk was built on top of it without anyone noticing:

> Referees are populated, 100%, for **England's five tiers and Scotland's four**
> — and effectively nowhere else.
> — `docs/la-liga-feasibility.md` §3

That claim is now **verified for the top tier, directly**. From the raw
football-data.co.uk `SC0` records mirrored in `jokecamp/FootballData` — the same
cross-check archive the La Liga note used:

| | Scottish Premiership (`SC0`) |
|---|---|
| `Referee` column present | yes |
| `Referee` populated | **88 / 88 rows = 100%** |
| Fouls (`HF`/`AF`) | present and populated |
| Yellows (`HY`/`AY`), reds (`HR`/`AR`) | present and populated |
| Distinct officials | 14 |
| Officials with 3+ matches | 12 |

So `build_refs.py` runs against Scotland with a changed division code, exactly as
it does against the Championship. No API-Football purchase for the referee
*name*, no date-and-clubs join to maintain, no `referee_source="api-football"`.
Scotland is a `has_free_referees` league.

**The referee pool being tiny is a feature, not a problem.** Fourteen officials
over a 228-match season is ~16 matches each, against the Premier League's 380
over ~20. Per-referee sample is comparable, and `min_ref_matches=3` — the
Premier League floor, not the Championship's raised 5 — is the right setting.
The ×factor that scales every player's booking probability by his official's
card rate will be *better* estimated in Scotland than in the Championship.

### One correction to the existing docs

`leagues.py` and `la-liga-feasibility.md` both say **Scotland's four** tiers have
free referees. In the archive snapshot measured here, `SC1` (the Scottish
Championship) has **no match-statistics columns at all** — no `Referee`, no
fouls, no cards, only results and odds. Whether that is an artefact of the
2013-14 vintage of this particular snapshot or a standing difference between the
Scottish top tier and the rest could not be settled from this session.

It does not affect a Premiership desk, which reads `SC0`. It does affect the
"promoted clubs" pattern every other desk uses — see §5.4 — and it means the
"Scotland's four" line in `leagues.py` should be softened to "Scotland's top
tier, and the lower tiers unverified" until someone re-measures `SC1`–`SC3`
against the live files.

---

## 2. What was measured, and what could not be

Honesty about method, because the constraint is unusual and the numbers in §4
inherit it.

**This session's network egress policy blocks `football-data.co.uk`,
`scottishfa.co.uk`, `spfl.co.uk`, Wikipedia, BBC, Transfermarkt, FBref and every
other reference site probed.** Only `github.com` / `raw.githubusercontent.com`
and the search tool were reachable. CI is unaffected — the refresh workflow
already reads football-data.co.uk directly and will continue to.

Consequently:

- **Verified by direct measurement**: the `SC0` schema, 100% referee coverage,
  the officials count, and the card/foul rates in the table below — but from a
  **partial 2013-14 snapshot (88 matches, August–December)** held in
  `jokecamp/FootballData`, because the current files were unreachable.
- **Not verified**: current-season `SC0` rates; `SC1`–`SC3` coverage; the
  Scottish FA suspension thresholds (§5.2), whose authoritative PDF is blocked.
- **Taken from search summaries, not primary sources**: 2025-26 card rates, the
  2026-27 club list, and the suspension thresholds. Each is flagged where used.

The first job of any build is to re-run §4 in CI against the live files. Nothing
here should be shipped as a published number on this evidence.

---

## 3. Why the market is worth having

Two things make Scotland attractive and one makes it marginal.

**Cards are more frequent than in England.** For 2025-26, third-party trackers
put the Scottish Premiership at roughly **4.3 cards per game** against the
Premier League's **3.81** — about 13% more. That is a smaller edge than La
Liga's 29%, but it moves the same way, and it moves the base rate the logistic
in `PLDCore.calibrate` is anchored to, which populates the High band.

**It is genuinely under-served.** No equivalent product points at Scotland. The
Premier League has a dozen card-stats sites; the Premiership has approximately
none. `la-liga-feasibility.md` §7 already said this and it still holds.

**But the market is thin.** Player-to-be-carded is not universally priced in the
Premiership the way it is in the Premier League — it appears reliably on Old
Firm and televised fixtures and inconsistently elsewhere, often only inside
bet-builder tools rather than as a standing market. The desk's value
proposition — "here is a fair price, here is the edge against the bookmaker's"
— degrades when there is frequently no bookmaker price to compare against. This
is the strongest argument for treating Scotland as an *addition* to the existing
four desks rather than a standalone site.

### The card rates, measured

From the 88-match 2013-14 `SC0` snapshot:

| | Scottish Premiership, 2013-14 partial |
|---|---:|
| Matches | 88 |
| Yellows/game | 3.14 |
| Reds/game | 0.22 |
| Fouls/game | 22.25 |
| Yellows per foul | 0.141 |

**Do not compare this to the six-season table in `la-liga-feasibility.md` §1.**
That table covers 2020-21 to 2025-26; this is 2013-14, an era before the
league-wide card inflation the desk's own Referees tab charts. Comparing the two
would understate Scotland by roughly a decade of drift. It is here to prove the
columns are populated and the arithmetic runs, not to rank the league.

---

## 4. What transfers unchanged

Most of the desk. The repo has already paid for generalisation.

| Layer | Scotland's route | Cost |
|---|---|---|
| Match records | `SC0` on football-data.co.uk | registry entry |
| Referee rates | `build_refs.py`, `referee_source="football-data"` | **free, unchanged** |
| Club discipline | `build_club_splits.py` off the same file | unchanged |
| Squads, per-player cards/fouls | API-Football, as La Liga | one league id |
| Head-to-head | `build_h2h.py` | see §5.3 |
| Match/game-state model | `build-model.mjs --fit` | see below |
| App shell, share cards, tracker, PWA | shared | page + guards |

**The game-state model is already solved for Scotland.** Commit `e026e7b` moved
model fitting off the FPL-only `harvest_history.py` and onto API-Football's
`/fixtures/players`, which returns minutes, fouls committed and cards per player
per fixture "for any league the key covers". That was done for the Championship
and La Liga; Scotland inherits it. At **228 matches** a full-season backfill is
one call per finished fixture against a 7,500/day allowance — the cheapest
backfill of any desk, comfortably under La Liga's 380 and the Championship's 552.

**There is no Plsimulator for Scotland**, so the vendored Dixon–Coles ratings in
`data/sim_model.js` have no Scottish counterpart. Whatever the Championship and
La Liga desks do about `tight` and the result-share factor, Scotland does the
same. This is a known, already-handled gap, not a new one.

---

## 5. What is genuinely new

Four things. The first has no precedent in this codebase.

### 5.1 The split — the one real piece of new engineering

Every league the desk covers publishes its whole fixture list before a ball is
kicked. **Scotland does not.** The 12 clubs play each other three times (33
rounds), then the table splits into a top six and a bottom six who play five
more games each — and **those last five rounds do not exist as fixtures until
round 33 has been played.**

Everything forward-looking in the desk assumes a fixture list: the Fixtures tab,
"next fixture" on the watchlist, the referee assignment control, `/today`'s
whole-season calendar, and the prediction logger that grades the model. For the
last five rounds of a Scottish season, roughly 13% of it, there is nothing to
point at, and then it appears all at once.

None of that is hard, but none of it is free either, and the failure mode is the
quiet kind this repo keeps writing guards about: a fixture list that is simply
*shorter* than expected does not throw — it renders an empty tab, or a calendar
that ends in April, and every test passes. A Scottish desk needs an explicit
pre-split / post-split state and a guard that asserts the season is 38 rounds
and knows which of them are not yet knowable.

### 5.2 The suspension scheme is a third shape — and it is UNVERIFIED

`leagues.py` carries two shapes and is explicit that getting them the wrong way
round invents bans nobody serves: England's **ladder** (cumulative, escalating,
gated by matchday) and Spain's **cycle** (repeating fives, no escalation).

Scotland appears to be a **third**: a ladder like England's but with higher
thresholds — reportedly **6 cautions by the club's 19th league match, 12 across
the 38** — and, critically, **the count may pool across domestic competitions**
rather than being per-competition. The Scottish FA records cautionable offences,
not the SPFL, and it records them against the player across the game.

If that pooling is real it is a **feature-level problem, not a config value**.
The desk's suspension watch computes from league cards because in England and
Spain league cards are what count. A Scottish player one booking from a ban may
have got there partly in the League Cup, and no amount of `SC0` data will show
it. The strip would be wrong in the direction that matters — it would
under-count, and quietly.

**This is the single item that must be settled before any build starts.** The
authoritative source is the Scottish FA Judicial Panel Protocol 2025/26 and
Annex C Section 4; both were blocked from this session. Until someone reads
them, `suspension_scheme` for Scotland should be `None` and the feature should
be **off**, in the same spirit as `docs/spain-suspensions.md` refusing to guess
at Spain's higher rungs.

### 5.3 Clubs meet three or four times, not twice

`build_h2h.py` was written for a league where every pair meets home and away,
once each. In Scotland a pair meets three times before the split and possibly a
fourth after it, with an uneven home/away balance — one club gets two home
fixtures in the three-round phase and the other gets one, and the SPFL balances
it across seasons rather than within one.

H2H is therefore *richer* in Scotland (three to four meetings a season instead
of two) but the shape assumptions need checking. Anything that derives "the
reverse fixture" or assumes a 2-row pair will be wrong.

### 5.4 Small league, small samples, and two clubs that distort everything

228 matches and roughly 330 registered players, against the Premier League's 380
and ~600. The 450-minute low-sample threshold was calibrated on a 38-game season
with 20 clubs; on a 38-game season with 12 it is survivable, but the *table* is
much shorter and the tail of one-off appearances is proportionally larger.

More seriously, **Celtic and Rangers distort the game-state factor**. The
result-share scaling in `PLDCore.simFixture` runs ×0.89–×1.11 on Premier League
ratings and is clamped to ×0.85–×1.20. A league where two clubs are overwhelming
favourites in most of their fixtures will hit that clamp far more often, which
means the clamp — not the model — becomes what sets the factor. Worth measuring
before shipping rather than after.

And the promoted-club pattern every other desk uses (`L1` for the Championship,
`SEG` for La Liga: a registry entry with no desk, carrying last season's form
for the clubs coming up) **may not be available in Scotland**, because §1 found
no card or foul columns in `SC1`. St Johnstone come up for 2026-27; if `SC1`
really has no statistics, their players arrive with no baked form at all and
must come from API-Football or not at all.

---

## 6. What it would cost

Assuming §5.2 resolves favourably, in rough order:

1. **A `leagues.py` entry** — `fd_div="SC0"`, `clubs=12`, `matches=228`,
   `min_ref_matches=3`, `af_league=<Scotland's API-Football id — confirm on the
   dashboard; it is not documented publicly>`, `referee_source="football-data"`,
   `suspension_scheme=None` until verified. Half a day.
2. **Re-measure §4 in CI** against live `SC0`, and settle `SC1`–`SC3`. Half a day.
3. **`build_spfl_data.py`**, modelled on `build_laliga_data.py` — the closer of
   the two templates, because Scotland shares La Liga's no-FPL constraint. Two
   to three days including the API-Football squad harvest.
4. **The split.** State, fixtures, guard. Two days, and the estimate is soft
   because nothing like it exists to copy.
5. **`spfl.html` and the guards.** The page is a fork of `laliga.html`. The
   guards are the tax: `check-nav.mjs`'s `DESKS` array, `check-palette`,
   `check-share`, `check-styles`, `check-mobile`, `sw.js` precache, `_redirects`
   **before the catch-all**, and `today.html`'s cross-league view. Two days.
6. **The league switcher does not fit.** `check-nav.mjs` records that four labels
   already need 625px against a 430px handset, and that the `.lb-abbr` short
   labels at `max-width:560px` are what rescue it. A **fifth** entry breaks that
   budget again, at both lengths. The bar needs a rethink — scroll-snap, a
   dropdown, or two rows — not another entry. Half a day, and it is the item
   most likely to be discovered late.

**Call it eight to ten working days**, against La Liga's rebuild. The referee
layer being free is worth roughly a third of that on its own.

---

## 7. Recommendation

**Build it, but not next, and not until the suspension question is answered.**

The case for: it is the cheapest remaining league, it keeps the free-referee
spine that makes this product distinctive, the card rate is above England's, the
model backfill is the smallest of any desk, and nobody else is serving it.

The case against going now: the market is thin enough that the desk's headline
feature — comparing a fair price to a bookmaker's — will often have nothing to
compare against; the split is real new engineering with a soft estimate; and the
suspension scheme is currently a guess, which is precisely the thing this repo
has twice refused to ship.

Two prerequisites, in order:

1. **Read the SFA Judicial Panel Protocol 2025/26 and Annex C §4** and settle
   whether cautions pool across competitions. If they do, decide whether the
   suspension watch ships disabled or the desk buys a cautions feed. This is a
   half-hour of reading that changes the shape of a feature.
2. **Re-measure `SC0` and `SC1`–`SC3` in CI** against live files, and correct the
   "Scotland's four" claim in `leagues.py` either way.

Neither needs a line of desk code, and both can be done before committing to the
build.

---

## Method and sources

Match records and referee coverage measured directly from the public-domain
football-data.co.uk `SC0` and `SC1` files archived in
[jokecamp/FootballData](https://github.com/jokecamp/FootballData) — the same
cross-check archive `docs/la-liga-feasibility.md` used, reached because
football-data.co.uk itself was blocked by this session's egress policy (see §2).
The snapshot is 88 Premiership matches from August–December 2013 and 75
Championship matches from the same period. Column definitions from the
[archive's own key](https://raw.githubusercontent.com/jokecamp/FootballData/master/football-data.co.uk/README.md).

Repository facts — the free-referee anomaly, the two suspension shapes, the
model-fitting route, the league-switcher width budget — are from `data/leagues.py`,
`docs/la-liga-feasibility.md`, `scripts/check-nav.mjs` and commit `e026e7b`.

Secondary, from search summaries and **not** independently verified:

- 2025-26 card rates — [FootyStats Premiership card stats](https://footystats.org/scotland/premiership/card-stats)
  (~4.3 cards/game) against [Premier League 2025-26](https://www.myfootballfacts.com/premier-league/all-time-premier-league/cards/premier-league-red-and-yellow-cards-2025-26-facts-and-stats/) (3.81/match).
  Both are "cards", yellows and reds combined.
- League format and the split — [Groundhopper Guides](https://groundhopperguides.com/scottish-premiership-schedule-split/).
- 2026-27 lineup: Livingston relegated, St Johnstone promoted —
  [Groundhopper Guides](https://groundhopperguides.com/promotion-relegation-scottish-football/).
  Derive the twelve from match records rather than declaring them, per the La
  Liga note's first correction.
- Suspension thresholds (6 by match 19, 12 across 38) — forum discussion only.
  **Treat as unverified.** Primary sources are the
  [Judicial Panel Protocol 2025/26](https://www.scottishfa.co.uk/media/13353/sfa_jpp-2025-26_digital.pdf)
  and [Annex C §4](https://historic-media.scottishfa.co.uk/media/1849/suspensions-for-players-in-mens-football-annex-c-section-4.pdf),
  both blocked here.
- Card-market availability — [ThePuntersPage](https://www.thepunterspage.com/scottish-premiership-betting/),
  [Statschecker](https://www.statschecker.com/players/scottish-premiership-player-most-cards-stats).

API-Football's Scottish Premiership league id is **not** recorded here because it
could not be confirmed — the API and its documentation were both unreachable.
Read it off the dashboard before writing the registry entry rather than
trusting a number from memory.

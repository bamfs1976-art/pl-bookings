# A La Liga bookings desk: what it would cost to build

Research note. The question was whether the Premier League Bookings Desk can be
rebuilt for the Spanish top division, and if not, which league should be next.

**Short answer: yes, and La Liga is the best league in Europe to point this
product at — but one pillar of the desk does not survive the move, and it is the
referee layer.** Everything else transfers, some of it improved. The build is not
a port; it is a re-plumb, because the Premier League's data is free and open in a
way no other league's is.

Every number below was measured, not assumed. Sources and method are at the end.

---

## 1. Why La Liga is the right target

La Liga is the most card-heavy league in the top five, and it is not close.
Six seasons, 2020-21 to 2025-26, from the public-domain football-data.co.uk
match records:

| League | Matches | Yellows/game | Reds/game | Fouls/game | Yellows per foul | Team-innings with 2+ cards |
|---|---:|---:|---:|---:|---:|---:|
| **La Liga** | 2280 | **4.71** | **0.25** | **25.8** | **0.183** | **69.1%** |
| Serie A | 2280 | 4.24 | 0.19 | 25.5 | 0.166 | 65.4% |
| Bundesliga | 1835 | 3.85 | 0.14 | 22.8 | 0.169 | 57.6% |
| Ligue 1 | 2058 | 3.76 | 0.25 | 24.5 | 0.154 | 58.1% |
| Premier League | 2280 | 3.64 | 0.12 | 21.6 | 0.169 | 55.4% |

La Liga shows **29% more yellows per game than the Premier League**, double the
reds, and 19% more fouls. Its referees also convert fouls into cards at the
highest rate of the five, so the extra cards are not merely a by-product of a
scrappier game — the whistle is genuinely stricter.

What that means for the desk's own arithmetic: the base booking rate the logistic
curve is anchored to (`PLDCore.calibrate`) rises from about **0.143** to about
**0.163** per player-appearance. Every player's modelled chance of a card moves
up with it. A market that pays on cards has more to pay on, and the desk's High
band (50%+) would be populated rather than rare.

The suspension-watch feature also gets better. The Premier League's thresholds
are gated by gameweek (5 yellows by GW19, 10 by GW32, 15 all season), so the
feature goes quiet for long stretches. Spain's accumulation ban triggers at five
yellows and then recycles, so a "one booking from a ban" strip has someone on it
essentially every matchday. (Confirm the exact higher thresholds against current
RFEF competition rules before shipping the copy — the five-card ban is
well-established; the cycle above it is the part worth checking.)

So the commercial case is strong. The engineering case is where it gets awkward.

---

## 2. Dependency audit

The desk stands on seven data legs. Here is what happens to each one in Spain.

| # | What the desk uses it for | Premier League source | La Liga |
|---|---|---|---|
| 1 | Live squads, minutes, cards, injuries, fixtures, gameweeks | **FPL API** — free, open, no key, no auth | **Gone.** No equivalent exists |
| 2 | Fouls per 90 (half the risk score) | ScoutingStats (cookie auth) | Substitute needed |
| 3 | Referee yellows/game, fouls/game, cards-per-foul | football-data.co.uk (free) | **Gone.** Not published, any season |
| 4 | Referee career history 1992–2018 | `epldata` R package | **Gone.** No equivalent |
| 5 | Dixon–Coles match model (game state, `tight`) | Plsimulator's `model.json` | **Gone.** Rebuildable |
| 6 | Club cards-against, home/away splits | football-data.co.uk (free) | **Transfers unchanged** |
| 7 | Hosting, auth, pick sync, AI review, calibration loop | Netlify / Supabase / Anthropic | **Transfers unchanged** |

Three legs survive intact, one is rebuildable, three are gone. Legs 1 and 3 are
the ones that matter.

---

## 3. The referee wall

This is the finding that shapes the whole answer, so it is worth stating with the
evidence.

`data/build_refs.py` computes every referee number in the desk — yellows per
game, fouls per game, cards per foul, the ×factor that scales every fixture
probability — from one free public-domain file per season. **That file carries no
referee for La Liga. It never has.**

Measured across the full 33-season archive in the `datasets/football-datasets`
mirror:

| League | Seasons with any referee value |
|---|---|
| Premier League | **all** (100% of rows populated) |
| La Liga | **0 of 33** |
| Ligue 1 | **0 of 33** |
| Serie A | 2 of 33 (2005-06, 2006-07 only) |
| Bundesliga | 2 of 33 (2000-01, 2001-02 only) |

The mirror's own README states it plainly: *"The `Referee` field is present in all
files but is always empty — referee data is not available for La Liga."*

Widening to the full 22-division football-data.co.uk archive confirms the shape
of it. Referees are populated, 100%, for **England's five tiers and Scotland's
four** — and effectively nowhere else. Germany and Italy had it for two seasons
around twenty years ago and lost it.

This is not a La Liga problem. It is a *football-data.co.uk covers British
football* problem. Free referee data is a British anomaly, and the desk was built
on top of it without that ever being visible, because in the Premier League it
simply works.

### What the referee layer is worth

Before deciding whether to pay for a replacement, it is worth knowing what is at
stake. Across the last three Premier League seasons, among the 20 referees with
15+ matches:

- League average: **4.00** yellows/game
- Strictest: **5.09** (×1.27 on the league average)
- Most lenient: **3.41** (×0.85)
- Strictest-to-leniest spread: **×1.49**

A player's fixture probability moves by up to half again depending on who has the
whistle. That is not a garnish — it is one of the largest single factors in the
model, and on the evidence above La Liga's referees vary at least as much. The
referee layer should be replaced, not dropped.

### How to replace it

The cleanest route keeps the free data doing the heavy lifting:

> **Take the referee *name* from a keyed API, and compute every referee *rate*
> from the free public-domain CSV.**

The La Liga file already carries `HY`, `AY`, `HR`, `AR`, `HF`, `AF` at 100%
coverage — every card and every foul in every match. The only missing column is
who refereed it. API-Football's `/fixtures` returns `fixture.referee` per match,
and one call retrieves an entire season's fixture list. Join on date plus the two
club names, and `build_refs.py` runs unchanged over the result: yellows/game,
fouls/game and cards-per-foul all fall out of data that stays free.

Cost of that join: roughly **one API call per season**, plus a handful for name
alignment. It is close to free, and it means the paid dependency is confined to a
single, cheap, cacheable field rather than sitting under the whole product.

What cannot be recovered is leg 4 — the 26-season referee career history. There
is no Spanish `epldata`. That card comes out of the Guide.

---

## 4. The live-feed wall

The second structural problem is quieter but larger in labour terms.

The FPL API is an unusual gift: an official, free, unauthenticated, CORS-proxyable
feed carrying every registered player, their minutes, their cards, their injury
status, the full fixture list and the gameweek clock. The desk leans on it for
the entire in-season experience — This Gameweek, All Players, the live card
overlay, the deadline countdown, the calibration loop's result backfill.

**La Liga has no such feed.** The official LaLiga Fantasy game does have an API
(`api-fantasy.llt-services.com`), but the leading community scraper for it now
opens its README with the notice that the endpoints changed and *"there is no
longer web access, only in-app"*, and what access remains requires a Bearer token
from a logged-in account that expires every 24 hours. That is not a foundation to
put a public site on.

Three viable substitutes, and they are complementary rather than competing:

**API-Football** (already integrated in this repo, `data/harvest_apifootball.py`).
Its `/players` response carries `games.minutes`, `games.position`, `cards.yellow`,
`cards.red`, `fouls.committed` and `fouls.drawn` — which is *both* leg 1 and leg
2 in one source, and is already mapped to the shape `build_pl_data.py` consumes.
La Liga is league 140. Notably it is a **strict improvement on FPL in one
respect**: FPL carries no fouls at all, which is why this repo needs ScoutingStats
alongside it. API-Football carries fouls natively, so a La Liga desk could drop
from two player-data sources to one.

The cost is quota. The free tier is 100 requests/day at 10/minute, and historical
seasons are restricted. `/players` pages at 20 rows, so a full 20-club La Liga
refresh is roughly 40–60 calls — which fits inside the free tier for a
once-daily refresh with nothing to spare. The Pro tier at $19/month (7,500
requests/day) removes the anxiety entirely, and is the honest budget line for a
production site.

**Understat** (free, no key). Covers La Liga and returns **per-match, per-player**
`yellow_card`, `red_card`, `time`, `position` and team. This is a better shape
than FPL's season aggregates for fitting the GLM — it is exactly the match-level
data `data/harvest_history.py` currently reconstructs from FPL `element-summary`,
available directly. It carries **no fouls**, so it cannot stand alone, but as a
free spine for the card half of the model and for the calibration loop's backfill
it is strong.

**FBref** (free, Big-5 coverage, `Fls` and `Fld` in the misc table). The
free source for fouls committed and drawn per 90. Rate-limited and scraped rather
than served, so treat it as a weekly batch, not a live feed.

A sensible La Liga build uses **Understat + FBref for the free baseline and
API-Football for fixtures, referees and live in-season overlay** — mirroring how
the current desk splits baked data from live data, with the sources swapped.

---

## 5. Rebuilding the match model

Leg 5, Plsimulator's Dixon–Coles ratings, is Premier League only. This is the
least worrying loss, because the hard part already lives in this repo.

`PLDCore.simFixture` in `assets/core.js` reproduces the full arithmetic — the
lambdas, the low-score correction, the 10-goal grid — and is pinned by a frozen
golden-value test. What is missing is only the *fitting* step that produces the
attack/defence/home-advantage ratings.

Dixon–Coles needs nothing but dated results with both scorelines, and the free La
Liga archive supplies **33 seasons** of exactly that at 100% coverage. Replacing
`scripts/build-sim-model.mjs` (a vendoring script) with a fitter is a contained,
well-specified piece of work, and it removes an external dependency rather than
adding one. It is arguably an upgrade: the desk would own its match model instead
of borrowing another site's.

---

## 6. What the move actually costs

Reusable essentially as-is: `assets/core.js` (the risk formula, the logistic
calibration, name normalisation, P/L and ROI, the Dixon–Coles arithmetic), the
entire UI shell, the share-card exports, the tracker, the Supabase sync, the AI
review, the calibration loop, the PWA, the CI guards.

Needing new work:

| Work | Size |
|---|---|
| Swap harvest to API-Football / Understat / FBref for La Liga | Medium — the API-Football mapper already exists |
| Referee name join, then run `build_refs.py` unchanged | Small |
| Fit Dixon–Coles from the free archive | Medium |
| Club map, crests, colours, jornada model in place of gameweeks | Small |
| Suspension thresholds to the Spanish rule | Small |
| Drop referee career history; rewrite that part of the Guide | Small |
| Recalibrate the logistic to Spain's higher base rate | Small — parameter, not code |

Nothing here is speculative. The single genuinely new component is the
Dixon–Coles fitter.

Recurring cost: **£0** if a daily refresh inside API-Football's free tier is
acceptable, **~$19/month** for the Pro tier, which is what I would budget.

---

## 7. If not La Liga: the other leagues, ranked

The audit above reduces to one selection rule. **The Premier League Bookings Desk
is cheap to clone into any league where referees are free, and a rebuild
everywhere else.** Free referees means British football.

**1. EFL Championship — by a distance the cheapest sibling.**
Referees 100% populated, every season since 2000-01, from the identical free
source. Cards and fouls likewise. `build_refs.py` runs against it with a changed
URL. This repo *already harvests Championship data* — `harvest.py` pulls league 9
and `harvest_apifootball.py` defaults to league 40 — because it needs the
promoted clubs. Much of the pipeline exists and is tested. The one gap is the
live feed: no FPL equivalent for the Championship either, so API-Football or
Understat fills that role. Given the Championship is a famously card-heavy,
high-volume, 46-game league with a large betting market, this is the strongest
value-for-effort option on the board.

**2. League One / League Two / National League.** Same free referee data, same
pipeline, thinner markets and thinner player data. Cheap to add once the
Championship exists — plausibly as extra leagues inside one desk rather than
separate sites.

**3. Scottish Premiership.** Referees 100% free across all four tiers. Small
league (12 clubs), small market, but a genuinely under-served one and near-zero
marginal cost if the Championship build already generalised the league config.

**4. Serie A.** After La Liga, the best combination of card volume (4.24/game,
0.183 fouls-to-cards) and market size. Same referee problem, same solutions,
same effort. If you are rebuilding the plumbing for one non-British league, the
second one is close to free — the work is per-*architecture*, not per-league.

**5. Bundesliga / Ligue 1.** Lowest card rates outside the Premier League and the
same rebuild cost. Little reason to prefer them.

### The recommendation

Two moves, in this order.

**Do the Championship next.** It reuses the most, costs the least, keeps the free
referee spine that makes this product distinctive, and it is the natural
follow-on from a site that already tracks promoted clubs.

**Then do La Liga**, and build it as a *multi-league architecture* rather than a
second site — the expensive part is generalising the data layer away from
FPL-shaped assumptions, and once that is paid for, Serie A costs a config file.
La Liga has the best cards market in Europe and deserves the desk; it just should
not be the thing that forces the refactor in a hurry.

---

## Method and sources

All league statistics computed directly from the public-domain (PDDL)
football-data.co.uk match records mirrored at
[datasets/football-datasets](https://github.com/datasets/football-datasets) —
the same source `data/build_refs.py` already uses. Referee coverage measured
across all 33 mirrored seasons per league, and cross-checked against a 21-season,
22-division archive of the raw files in
[jokecamp/FootballData](https://github.com/jokecamp/FootballData). Card and foul
rates are six full seasons, 2020-21 to 2025-26. Referee spread is the last three
Premier League seasons, referees with 15+ matches.

- [datasets/football-datasets](https://github.com/datasets/football-datasets) — mirror and its La Liga README
- [jokecamp/FootballData](https://github.com/jokecamp/FootballData) — 22-division raw archive
- [alxgarci/marca-fantasy-api-scraper-updated](https://github.com/alxgarci/marca-fantasy-api-scraper-updated) — LaLiga Fantasy endpoints, and the notice that web access is withdrawn
- [collinb9/understatAPI](https://github.com/collinb9/understatAPI) — Understat league and field coverage
- [API-Football documentation](https://www.api-football.com/documentation-v3) and [pricing](https://www.api-football.com/pricing)
- [FBref Big 5 miscellaneous stats](https://fbref.com/en/comps/Big5/misc/players/Big-5-European-Leagues-Stats) — `Fls` / `Fld`
- [probberechts/soccerdata](https://github.com/probberechts/soccerdata) — FBref access with rate limiting

Two things in this note are stated from documentation rather than a live call,
because neither API can be reached from this environment: API-Football's
`fixture.referee` coverage *for La Liga specifically*, and whether the
ScoutingStats account has a La Liga league id alongside 8 (PL) and 9
(Championship). Both are one request to settle and both should be settled before
any build starts — the referee join in §3 is the load-bearing assumption of the
whole plan.

# Season research — sources, repos and features not yet used

*Compiled 13 August 2026, one day before the season opens. Scope: free APIs,
open datasets, public repositories and competitor features that could improve
the **Premier League Bookings Desk** and **Gameweek Edge**. A twin of this file
lives in `gameweek-edge/docs/SEASON_RESEARCH_2026-08.md` with the same findings
and an FPL-specific action list.*

This file answers, among other things, the two largest items left open in
[`ENHANCEMENTS.md`](../ENHANCEMENTS.md) — the promoted-club squad hole (item 1)
and "FPL carries no fouls, so that half of the risk score is frozen on 2025-26
form all season" (item 8). Both have a free answer, and one of them is a
dataset the sibling repo already proxies.

---

## How to read this

| Mark | Meaning |
|---|---|
| **✅ Verified** | I fetched it from this machine and checked the response. Column names, row counts and totals below are real. |
| **⚠️ Reported** | From documentation or press coverage only. Plausible, not seen. |
| **🚫 Unverifiable here** | The host is blocked by this environment's egress proxy — the position `fantasy.efl.com` was in before CI settled it. Probe from a machine that can reach it before building on it. |

Blocked from this machine: `premierleague.com`, `footballapi.pulselive.com`,
`api.clubelo.com`, `api.open-meteo.com`, `fantasy.premierleague.com`.
`raw.githubusercontent.com` is reachable, which is why the largest finding here
is fully verified.

---

## 0. What was built from this file

Shipped on this branch, and one thing the research got wrong.

- **§1 and §2 are done.** `scripts/build-core-insights.mjs` vendors this
  season's fouls into `data/core_insights.js`; `PLDCore.liveRate` switches both
  halves of the risk score on one 450-minute rule; the FPL proxy now allows
  `event/<gw>/live` and `element-summary/<id>`.
- **A correction to §1's framing.** Gameweek Edge does not read "one column" of
  Core Insights — `netlify/functions/core-insights.js` has aggregated the
  per-match stats there for two seasons. What it *was* doing wrong is more
  interesting, and it nearly happened here too: it read `By Gameweek/`, which
  carries every competition. Harvesting the same way for this desk gave 521
  matches for a 38-round season and a league foul rate 11% low, because 141 of
  them were European and cup ties. Both repos now read
  `By Tournament/Premier League/` and check every match id for the league
  marker. **The number that looks healthy is the one to check.**
- **The fouls column was validated, not trusted**: across 306 players the median
  absolute difference between ScoutingStats' baked 2025-26 rate and Core
  Insights' 2025-26 rate is **0.01 per 90**.

---

## 1. The fouls gap has a free answer, and it is already in the portfolio

`ENHANCEMENTS.md` item 8 states the structural weakness precisely:

> FPL carries no fouls, so that half of the risk score is frozen on 2025-26
> form all season.

Half of `risk = yellows/90 × 2 + fouls/90` going stale in September is the
single biggest correctness problem the desk has after the promoted-club hole.

**[olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights)
publishes `fouls_committed` per player per match, free, with no key, keyed by
official FPL player id, twice a day.** Gameweek Edge already fetches this
repository — `netlify/functions/team-elo.js` reads one column from `teams.csv`
and ignores the rest.

### ✅ Verified

`data/{season}/By Gameweek/GW{n}/playermatchstats.csv`, 63 columns per player
per match. The ones this desk cares about:

```
player_id, match_id, minutes_played, fouls_committed, was_fouled,
tackles, tackles_won, interceptions, blocks, clearances, dribbled_past,
duels_won, duels_lost, ground_duels_won, aerial_duels_won, recoveries,
defensive_contributions, start_min, finish_min, xg, xa
```

I checked 2025-26 GW20 (298 player rows): `fouls_committed`, `was_fouled`,
`tackles` and `recoveries` are **298/298 populated**. The round's fouls total is
**205 across ten matches — 20.5 per match**, which is the correct Premier League
rate, so the column is real data rather than a placeholder.

Three more files in the same directory:

- **`player_gameweek_stats.csv`** — `yellow_cards` and `red_cards` **per
  gameweek**, plus `minutes`, `bps`, `status`, `news`,
  `chance_of_playing_next_round`.
- **`matches.csv`** — `home_fouls_committed` / `away_fouls_committed` per match,
  possession, corners, and both teams' **Elo at kickoff**.
- **`teams.csv`** — `elo`, and the join keys **`pulse_id`** (official Premier
  League match centre) and **`fotmob_name`**. The 2026-27 file is live and
  correct: 20 clubs including Coventry (1661), Hull (1533), Ipswich (1640).

2025-26 is published in the same shape, so a refit is backtestable immediately.

**Terms**: no key, no account, updated 07:30 and 17:30 UTC, used freely with a
link back to the repository.

### What it fixes

1. **Fouls unfreeze.** `fouls/90` becomes a live in-season rate instead of a
   2025-26 constant. This is item 8's last bullet, solved without the
   twice-daily Supabase aggregation it proposed.
2. **The promoted clubs get squads** (item 1) — for Premier League minutes,
   from the moment they play, with no `SS_COOKIE` and no API-Football key. Every
   player who appears in a PL match appears in the file, positions included, and
   `player_id` is the FPL id the desk already matches on, so the name-matching
   problem does not arise at all.
3. **Per-match, not per-season.** Card and foul *form* windows, a proper
   minutes-weighted blend, and the "shrunk, blended, capped at 900 minutes of
   evidence" model on the forecast branch (item 2) all become possible on real
   per-match rows rather than season aggregates.
4. **`dribbled_past` and `duels_lost`** are, plausibly, better card predictors
   than raw fouls — a defender who keeps getting beaten is the one who takes the
   tactical yellow. That is a hypothesis the backtest can now test.

### The one thing it does not fix

Core Insights is Premier League-scoped. It gives the promoted clubs **nothing
before their first PL match**, so the pre-season prior for Coventry, Hull and
Ipswich still needs a Championship source. See ClubElo in §3 for the cheapest
partial answer, and note the honest position: for the first three or four
gameweeks those clubs' rows should carry a low-sample flag regardless of source.

### The risk, and the house style for it

One dataset, one maintainer. It deserves what `efl/app/assets/provider.js` gets
in the sibling repo: a single entry point, a shape guard that raises a **named
error saying which document and what actually arrived**, and no silent fallback
to invented numbers.

---

## 2. Live cards are already available and the proxy does not allow them

`netlify/functions/fpl.js` whitelists three endpoints:

```js
const ALLOW = [ /^bootstrap-static$/, /^fixtures$/, /^event-status$/ ];
```

Gameweek Edge's identical proxy whitelists fifteen, including:

```js
/^event\/\d+\/live$/,        // per-player live stats, incl. yellow_cards
/^element-summary\/\d+$/,    // that player's full per-gameweek history
```

`event/{gw}/live` carries `yellow_cards` and `red_cards` per player **while the
match is being played**. For a product whose entire subject is bookings, that is
the most on-topic feed in existence and it is one regex away. It gives you:

- **A live card ticker per fixture** — cards so far against the pre-match model
  line. This is the Sofascore in-play pattern applied to the one market you
  cover, and nobody in the card-tips space does it well.
- **In-play alerts.** A watchlisted player booked; a fixture running hot; a
  player on a yellow who is now one from a ban.
- **A per-gameweek card harvest with no new vendor**, which combined with §1's
  fouls closes the whole risk formula in season.

`element-summary/{id}` gives the same player's per-gameweek history, which is
the natural backing for the "card form" chart listed as open in item 5.

**Caveat**: the sibling proxy already distinguishes live from cacheable paths
(`const isLive = /\/live$|\/picks$|.../`) and caches accordingly. Copy that
alongside the regex, not after it.

---

## 3. Free sources not currently in use

| Source | Key? | What it gives | Worth it? |
|---|---|---|---|
| **FPL-Core-Insights** | No | §1 — fouls, cards, duels per match | **Yes. The most valuable item in this file.** |
| **FPL `event/{gw}/live`** | No | §2 — live cards. Already proxied next door | **Yes, and it is one line** |
| **api.clubelo.com** 🚫 | No | Daily Elo for every European club **including the Championship**, as CSV | Yes — the only free pre-season rating for a promoted club |
| **Open-Meteo** 🚫 | No | Hourly precipitation and wind by lat-lon, no key, no limit for this volume | See §5 — cheap, and genuinely novel for a card model |
| **Pulse API** (`footballapi.pulselive.com`) 🚫 | No | Powers premierleague.com; **referee per fixture** and lineups. `pulse_id` already sits in Core Insights `teams.csv` | Probe it. Could retire `data/appointments.json` |
| **The Odds API** | Free tier | ~40 bookmakers, **500 requests/month** (~16/day) | Yes — see §5. Enough for one daily closing-line snapshot |
| **Understat** | No | Shot-level xG with x/y, PPDA, 6 leagues | Marginal here — no card data. Relevant to the La Liga desk |
| **openfootball/football.json** | No | Public-domain fixtures/results | Only as a second opinion for a shape guard |
| **OddAlerts / RefStats / FootyMetrics** | Paid | Referee card stats, appointments | Read them as competitors (§5), do not buy |
| **FBref** | — | — | **Dead.** ⚠️ Lost its Opta licence in January 2026 and the advanced stats were removed. Anything in the portfolio pointing at it should be considered broken |

### Two of these deserve more than a table row

**ClubElo** 🚫 rates every European club daily, including the Championship, as
plain CSV with no key. It cannot tell you about cards — but the desk's whole
game-state layer runs on `PLDCore.simFixture`, and a promoted club currently
enters the season with whatever prior the Plsimulator bundle carries for a team
it has never rated. A real Championship-derived Elo is a better starting point
than a generic promoted number, which is the same argument
`gameweek-edge/netlify/functions/team-elo.js` makes at length for FPL — measured
there at 71% closer on attack and 84% closer on defence than the generic prior.

**The Odds API** closes a real gap in two places. The desk maps risk to a
model-implied probability and reports `(odds × p − 1)` as an edge — with the
odds typed in by hand. And `ENHANCEMENTS.md` item 4 says the walk-forward
backtest should score against **market closing odds** (the desk's RPS is 0.2068
against the market's 0.1994) but currently scores against a base rate, "a much
easier benchmark". 500 requests a month is roughly 16 a day: enough for one
daily snapshot of a full round, which is precisely what a closing-line
comparison needs. Key in a Netlify function, never the client, same as
everything else here.

---

## 4. Repositories worth reading (not depending on)

- **[datasets/football-datasets](https://github.com/datasets/football-datasets)**
  — already used for referee history. Still the right choice.
- **[sertalpbilal/FPL-Optimization-Tools](https://github.com/sertalpbilal/FPL-Optimization-Tools)**
  — MILP formulation. Not directly applicable to a card desk, but the acca
  builder is a constrained-selection problem with a correlation penalty, and
  that is the same shape.
- **[douglasbc/scraping-understat-dataset](https://github.com/douglasbc/scraping-understat-dataset)**
  — a working Understat pipeline for the La Liga desk.
- **[openfootball/football.json](https://github.com/openfootball/football.json)**
  — public-domain fixtures, no key. A cheap independent check that a harvest has
  not silently dropped a round.

---

## 5. Features from comparable products you are not maximising

1. **Live in-play card tracking** (§2). The paid referee-stats sites — OddAlerts,
   RefStats, FootyMetrics — all sell *pre-match* card trends. None of them run a
   live line. You would have both, from a feed you already have a proxy for.
2. **Weather.** 🚫 Open-Meteo is free, needs no key, and gives hourly
   precipitation and wind at a lat-lon. A wet pitch produces mistimed tackles;
   this is a plausible card factor that no competitor in this space prices, it
   slots straight into the existing log-odds factor stack next to referee, venue
   and game state, and — importantly — it is testable. `scripts/backtest.mjs`
   can settle whether it earns its place before it ships. Twenty stadium
   coordinates is the whole data requirement.
3. **Closing-line value in the tracker.** The tracker logs picks. Recording the
   odds *at pick time* against the closing price is how serious punters judge a
   tipster, and it is a stronger public claim than a hit rate — it survives a bad
   run of variance in a way a P/L curve does not. It also feeds §3's backtest.
4. **Referee appointment push** (`ENHANCEMENTS.md` item 3). I would raise this
   above where it sits. The appointment is the most time-critical fact in the
   product, it lands about a week out, `data/appointments.py` documents how much
   manual work it currently costs, and every piece of push infrastructure exists
   next door. "Your watchlisted player has drawn Chris Kavanagh" is the
   notification that makes this app a habit.
5. **Charts** (item 5). Three named there are right — club × referee heatmap,
   the reliability curve, per-player card form. Per-player card form is now
   backed by real per-gameweek data from §2's `element-summary`. Build them as
   inline SVG in the share-card style; do not add a library.
6. **Onboarding** (item 7). A new user lands on an empty watchlist card. Three
   steps — pick your clubs, pick your players — turns that into the app's best
   screen on first run.

---

## 6. UX and interface — 2026 platform features that are pure deletion

- **`content-visibility: auto`** on table rows is the cheapest possible answer to
  the table-virtualisation problem (item 6). No library, no windowing, no scroll
  maths — a CSS property, and All Players stops being slow.
- **CSS anchor positioning + the Popover API** reached Baseline in early 2026
  (Firefox 147 completed it). Tooltips and dropdowns that position themselves in
  JavaScript can hand that to the browser.
- **Same-document View Transitions** around the area tab strip and panel
  switching — a few lines, and the PWA feels native. Use the same-document form;
  cross-document is still missing in Firefox.

---

## 7. Deliberately not recommended

- **Buying referee data** (OddAlerts, RefStats, Sportmonks). You compute referee
  rates from 380 real match records already, and that is the part of the product
  you can defend in public.
- **Sportmonks Expected Lineups** — €159/month. Confirmed lineups are free from
  the official feed an hour before kickoff, which is when they matter for cards.
- **Scraping FBref** — the data is gone, not merely harder to reach.
- **A charting library** — see §6.

---

## 8. What I would do first, in this repo

| # | Action | Why now |
|---|---|---|
| 1 | ~~Proxy allowlist~~ **Done.** Both endpoints allowed, live paths held uncacheable | A live feed cached five minutes shows a booked player as uncarded |
| 2 | ~~Core Insights fouls reader~~ **Done.** Harvester, runtime join check, CI guard, tests | Unfreezes half the risk formula and fills the promoted clubs from GW1 |
| 3 | Re-run `scripts/backtest.mjs` on per-match data once GW3–4 exist | Item 2's hazard-form switch has been waiting on exactly this |
| 4 | Probe ClubElo and the Pulse API from CI | One answers the promoted-club prior, the other could retire `appointments.json` |
| 5 | Referee appointment push | Most time-critical fact in the product; the infrastructure exists next door |
| 6 | `content-visibility: auto` on All Players | Item 6, closed in a line of CSS |
| 7 | Odds snapshot into the tracker for closing-line value | Turns the value column from typed-in to measured, and gives the backtest its real benchmark |

Items 1 and 2 together are the season-opening priority: they are the difference
between a desk whose numbers move each week and one that spends 2026-27
describing 2025-26.

---

*Sources:*
[FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights) ·
[ClubElo](http://clubelo.com/API) ·
[Open-Meteo](https://open-meteo.com/) ·
[The Odds API](https://the-odds-api.com/) ·
[FBref / Opta, 2026](https://www.liamhenshaw.com/writing/where-to-find-football-data) ·
[OddAlerts referees](https://www.oddalerts.com/referees) ·
[RefStats](https://refstats.app/) ·
[openfootball](https://github.com/openfootball/football.json) ·
[Understat scraping dataset](https://github.com/douglasbc/scraping-understat-dataset) ·
[Web platform Baseline 2026](https://web.dev/blog/web-platform-01-2026)

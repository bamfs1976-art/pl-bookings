# Premier League Bookings Desk

Per-game booking forecasts for the Premier League, every matchday of 2026-27.
A static site (one `index.html` + one generated `app-data.js`) backed by a
small Python pipeline that refreshes data weekly, freezes each matchweek's
forecasts before kick-off and scores them after.

## What it does

- **Fixtures** — every game of the matchweek priced: the five most bookable
  players per side with P(card) and fair odds. Set the referee when PGMOL
  announce appointments and every probability re-prices live. Derby heat and
  a suspension watch (players one yellow from a 5/10/15 ban) included.
- **Players** — all ~530 squad players with raw rates (YC/90, fouls/90) and
  model outputs (risk, neutral-fixture P(card)). Share-card PNG export.
- **Clubs / Referees** — discipline tiers and the referee watchlist, with the
  exact card factor each official applies to forecasts.
- **Tracker** — log picks (one tap from a fixture card), auto-settled against
  booked lists when results land. Hit-rate, P/L, ROI.
- **Model** — the published-forecast Brier score and calibration table, so
  the desk proves its accuracy instead of claiming it.

## The model

```
lambda  = yellows/90 (blended, shrunk)
          x expected minutes / 90
          x referee factor x venue factor x derby factor
P(card) = 1 - exp(-lambda)
```

- **Blending** — current-season counts plus last season capped at 900 minutes
  of evidence (450 for the promoted clubs' Championship form), so live form
  takes over as the season runs.
- **Shrinkage** — empirical Bayes: 900 pseudo-minutes of the position's
  league rate are mixed into every player, so a 1-minute cameo can't produce
  a 90-fouls-per-90 artefact.
- **Referee factor** — official's yellows/game over league average, clamped
  0.70–1.40 (see the Referees tab). TBC games use 1.00.
- **Venue / derby** — home 0.95, away 1.08; listed rivalries up to +18%.
- Constants live in `pipeline/model.py` and are baked into `app-data.js` so
  the client and pipeline always agree.

## Repo layout

```
index.html                  the app (vanilla JS, Tailwind CDN, no build step)
app-data.js                 generated dataset — do not edit by hand
pipeline/
  model.py                  pure model functions (tested)
  build_dataset.py          sources -> app-data.js
  score_forecasts.py        freeze matchweek forecasts / score vs results
  fetch_fixtures.py         football-data.org or fixturedownload.com
  fetch_stats.py            ScoutingStats in-season player stats
  fetch_results.py          API-Football results + booked players
  sources/                  tracked JSON inputs (prior season, fixtures, ...)
  store/                    forecast log + scores (written by the pipeline)
  tests/                    pytest suite
.github/workflows/refresh-data.yml   weekly cron + manual refresh
```

## The weekly loop

Every Tuesday (or on manual dispatch) the GitHub Action:

1. fetches fixtures, in-season stats and results (each step no-ops if its
   secret isn't configured — the site keeps running on the last good data),
2. **scores** the previous matchweek's frozen forecasts (Brier +
   calibration → Model tab),
3. **freezes** the coming matchweek's forecasts into
   `pipeline/store/forecast_log.json`,
4. runs the test suite, rebuilds `app-data.js`, commits and pushes.

Netlify redeploys on push; publish directory is the root, no build command.

### Secrets (Settings → Secrets and variables → Actions)

**One free key is enough.** Register at [api-football](https://www.api-football.com/)
(free tier, no card) and add it as `API_FOOTBALL_KEY` — it powers both the
in-season player stats (minutes, appearances, yellows, fouls) and the
results/booked-players feed. No paid stats subscription is needed anywhere.

| Secret | Used by | Purpose |
|---|---|---|
| `API_FOOTBALL_KEY` | fetch_stats + fetch_results | 2026-27 player stats, finished games, booked players |
| `FOOTBALL_DATA_TOKEN` | fetch_fixtures | optional; the keyless fixturedownload.com fallback also works |
| `SCOUTINGSTATS_*` | fetch_stats | optional legacy path (normal login cookie), only used if `API_FOOTBALL_KEY` is absent |

`AS_OF_MATCHDAY` is derived automatically from fetched results.

With real appearance data from API-Football, expected minutes switches from
the pre-season share heuristic to actual average minutes per appearance.

Referee appointments have no API: edit
`pipeline/sources/ref_appointments.json` (fixture id → referee name) when
PGMOL publish, or pick the referee in the UI per game.

## Running locally

```
python3 -m pytest pipeline/tests -q     # 28 tests
python3 pipeline/build_dataset.py       # regenerate app-data.js
python3 -m http.server                  # then open http://localhost:8000
```

## Data basis

2026-27 lineup: 17 continuing clubs plus Coventry, Ipswich and Hull
(promoted). Pre-season the model runs on 2025-26 form via ScoutingStats
(Sportmonks) — the promoted trio on Championship form, flagged EFL — and
referee averages from public data. Matchweeks 1–2 fixtures are baked from
the June 2026 fixture release; the fetcher fills the rest.

**Known data gap:** the 2025-26 Championship harvest for the promoted clubs
was faulty — it contains only six distinct players (3 Coventry, 2 Hull,
1 Ipswich), each duplicated 12 times. The pipeline dedupes them, so those
fixture cards show short candidate lists until either the Championship data
is re-harvested into `pipeline/sources/players_2526.json` or real 2026-27
minutes arrive via `fetch_stats.py`.

Built for research, not a betting guarantee. Stake responsibly.

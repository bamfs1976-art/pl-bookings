# Premier League Bookings Desk

A single-file, stats-based tool for Premier League player-bookings markets, ready for the 2026-27 season. Player card risk, club discipline and a referee watchlist, built on 2025-26 form.

## What it is

- One `index.html`, vanilla JavaScript, Tailwind via CDN, no build step, no API keys.
- All player, club and referee data is baked in.
- Logged picks save to your browser under `pl_desk_v1`.
- Light theme by default with a dark mode toggle. Club colours and crests throughout.

## Tabs

- **Players** sortable table of every squad player by booking risk, filter by club and position, search, hide low sample. Share card exports the current view (a club's risks, or the league top 10) as a publishable social image.
- **Gameweek** the week's ten fixtures with win/draw/away percentages, a per-side match-heat multiplier, estimated match cards, the referee once appointed, and each side's top booking risks scaled by heat. Powered by the PL Simulator's shared model bundle (below).
- **Clubs** the 20 clubs by cards received per game, with a discipline tier and each club's top booking risk.
- **Referees** 2025-26 officials by yellows per game, with reds and penalties per game.
- **Tracker** log each pick with odds and stake, settle won, lost or void, see hit-rate, staked, P/L and ROI. Fixtures autocomplete from the 2026-27 calendar and picks are tagged with their matchday, with a P/L-by-matchday breakdown.
- **Guide** the method, the risk formula, the heat model, the tiers and the known limits.

## Booking risk

    risk = yellow cards per 90 × 2 + fouls committed per 90

Yellow rate is weighted double because the market pays on cards. Fouls per 90 carries the volume signal. Both are 2025-26 rates. Players under 450 minutes are flagged low sample.

Before ranking, each player's yellow and foul rates are shrunk toward his positional average in proportion to minutes played (empirical Bayes, prior worth 450 minutes). Big-minute players barely move; a 100-minute rate lands near the positional norm. The table's YC/90 and Fouls/90 columns stay raw; the Risk column and every ranking use the shrunk rates.

## PL Simulator integration

The Gameweek tab consumes the [PL Simulator](https://plsimulation.netlify.app)'s
machine-readable bundle (`model.json`, CORS-open, refreshed weekly), which
carries the official 2026-27 fixture list with matchday dates, attack/defence
ratings fitted to three seasons of results, season-outcome probabilities from
a seeded 20,000-season Monte Carlo run, and referee appointments as announced.
A snapshot of the bundle is baked into `index.html`, so the tab works offline
and upgrades itself to the live bundle when reachable.

Fixture win/draw/away percentages are computed in the browser with the same
Poisson + Dixon-Coles maths and constants as the simulator. They fold into a
per-side match heat:

    heat = closeness × chasing × stakes

- closeness: `1 + 0.20 × (evenness − 0.5)` — tight games are more contested
- chasing: `1 + 0.12 × (opponent win% − own win%)` — likely-trailing sides foul
- stakes: up to `1.08` from matchday 25 when the club's title/top-4/relegation
  race is still open per the Monte Carlo probabilities

A player's GW risk is his booking risk × his side's heat. Estimated match
cards are both clubs' cards-per-game scaled by heat and by the appointed
referee's yellows-per-game against the league norm.

Heat is a transparent research weighting, not a fitted cards model.
`data/backtest_cards.py` is a walk-forward harness that scores each
ingredient (club rates, referee factor, heat) against real match card counts
from football-data.co.uk CSVs (`HY`/`AY` columns), MAE/RMSE vs a
league-average baseline, in the same no-peeking style as the simulator's
backtest:

    python3 data/backtest_cards.py E0_2024-25.csv E0_2025-26.csv

## 2026-27 lineup and data basis

- 20 confirmed clubs: 17 staying up, plus Coventry, Ipswich and Hull (promoted). Burnley, West Ham and Wolves went down.
- Stats are 2025-26 form, the pre-season basis for an August launch. 17 clubs from Premier League data, the 3 promoted clubs from their 2025-26 Championship data, flagged EFL.
- Club team rates are shown for Premier League clubs only. Championship data mixes cup minutes, so the promoted clubs' team rate is not comparable and is omitted, though their players still appear with per-90 rates.
- Referee figures are 2025-26 season averages from public data (tips.gg, with two lenient officials added from search data).

## Deploy to Netlify

Drag the project root to drop.netlify.com, or connect the `pl-bookings` repo. Publish directory is the root, no build command. The `data` folder is gitignored, the app has its data baked in.

## Data and pipeline

The `data` folder holds the build scripts and the raw harvests (gitignored):
- `build_pl_data.py` builds `pl_data.js` (CLUBS, PL_PLAYERS, REFS) from the harvested JSON. It ships raw per-90 rates and counts; the app applies the minutes shrinkage at load, so the prior is never baked in twice. Duplicate harvest rows are deduped on (club, player).
- `backtest_cards.py` the walk-forward expected-cards validation harness (see above).
- Harvested from the ScoutingStats API: `/api/league/8/player-stats` (PL) and `/api/league/9/player-stats` (Championship), plus referee data from tips.gg.

## Source data note

Player and club form via ScoutingStats (Sportmonks). Referee data from public sources. Built for research, not a betting guarantee.

# Premier League Bookings Desk

A single-file, stats-based tool for Premier League player-bookings markets, ready for the 2026-27 season. Player card risk, club discipline and a referee watchlist, built on 2025-26 form.

## What it is

- One `index.html`, vanilla JavaScript, Tailwind via CDN, no build step, no API keys.
- All player, club and referee data is baked in.
- Logged picks save to your browser under `pl_desk_v1`.
- Light theme by default with a dark mode toggle. Club colours and crests throughout.

## Tabs

- **Players** sortable table of every squad player by booking risk, filter by club and position, search, hide low sample. Share card exports the current view (a club's risks, or the league top 10) as a publishable social image.
- **Clubs** the 20 clubs by cards received per game, with a discipline tier and each club's top booking risk.
- **Referees** 2025-26 officials by yellows per game, with reds and penalties per game.
- **Tracker** log each pick with odds and stake, settle won, lost or void, see hit-rate, staked, P/L and ROI.
- **Guide** the method, the risk formula, the tiers and the known limits.

## Booking risk

    risk = yellow cards per 90 × 2 + fouls committed per 90

Yellow rate is weighted double because the market pays on cards. Fouls per 90 carries the volume signal. Both are 2025-26 rates. Players under 450 minutes are flagged low sample.

## 2026-27 lineup and data basis

- 20 confirmed clubs: 17 staying up, plus Coventry, Ipswich and Hull (promoted). Burnley, West Ham and Wolves went down.
- Stats are 2025-26 form, the pre-season basis for an August launch. 17 clubs from Premier League data, the 3 promoted clubs from their 2025-26 Championship data, flagged EFL.
- Club team rates are shown for Premier League clubs only. Championship data mixes cup minutes, so the promoted clubs' team rate is not comparable and is omitted, though their players still appear with per-90 rates.
- Referee figures are 2025-26 season averages from public data (tips.gg, with two lenient officials added from search data).

## Deploy to Netlify

Drag the project root to drop.netlify.com, or connect the `pl-bookings` repo. Publish directory is the root, no build command. The `data` folder is gitignored, the app has its data baked in.

## Data and pipeline

The `data` folder holds the build script and the raw harvests (gitignored):
- `build_pl_data.py` builds `pl_data.js` (CLUBS, PL_PLAYERS, REFS) from the harvested JSON.
- Harvested from the ScoutingStats API: `/api/league/8/player-stats` (PL) and `/api/league/9/player-stats` (Championship), plus referee data from tips.gg.

## Source data note

Player and club form via ScoutingStats (Sportmonks). Referee data from public sources. Built for research, not a betting guarantee.

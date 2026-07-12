# Premier League Bookings Desk

A single-file, stats-based tool for Premier League player-bookings markets, ready for the 2026-27 season. Player card risk, club discipline, a referee watchlist and a live fixtures view, built on 2025-26 form and refreshed in season from the official FPL API.

## What it is

- One `index.html`, vanilla JavaScript, Tailwind via CDN, no build step, no API keys in the client.
- All player, club and referee data is baked in; live card counts, availability and the fixture schedule overlay it from the official FPL API (via a Netlify Function proxy, pattern shared with Gameweek Edge).
- Installable PWA with an offline app shell (manifest + service worker + icons).
- Logged picks save to your browser under `pl_desk_v1`; optional sign-in syncs them across devices (Supabase, same account as Gameweek Edge).
- Light theme by default with a dark mode toggle. Club colours and crests throughout.

## Tabs

- **Players** sortable table of every squad player by booking risk, filter by club and position, search, hide low sample. Star any player onto a **watchlist** and flip the ★ filter to see just your shortlist. Injury/suspension/doubt flags from the live feed, and a **suspension watch** strip for anyone one booking from a ban (5 yellows to GW19, 10 to GW32, 15 all season). Share card exports the current view (a club's risks, or the league top 10) as a publishable social image.
- **Clubs** the 20 clubs by cards received per game, with a discipline tier and each club's top booking risk.
- **Referees** 2025-26 officials by yellows per game, with reds and penalties per game.
- **Fixtures** the 2026-27 schedule by gameweek from the FPL API, each match with a booking-heat rating (both clubs' cards-against combined), combustibility flame and the fixture's top booking risks.
- **Tracker** log each pick with odds and stake, settle won, lost or void, see hit-rate, staked, P/L and ROI. Signed in, picks sync to the cloud and merge across devices. An optional **AI review** (ported from Booking Analytics Pro) reads your settled picks and points at what's working — see below.
- **Guide** the method, the risk formula, the tiers and the known limits.

## Live data

The official FPL API has no CORS, so the app calls it through `netlify/functions/fpl.js` — a whitelisted proxy (`bootstrap-static`, `fixtures`, `event-status`) routed at `/api/fpl/*`. The client caches reduced extracts in `localStorage` for 30 minutes and falls back to stale cache, then to the baked 2025-26 data, whenever the feed is unreachable — the top-bar pill says which basis is showing.

Live card counts overlay the baked squads by club + normalized-name matching. Once a player has 450 minutes of 2026-27 football, the yellow-rate half of his risk score switches to the live rate (rows show a green dot). Fouls are not in the FPL feed, so the fouls half stays on 2025-26 form.

## Accounts and pick sync (Supabase)

Sign-in is optional and everything works signed out. The app uses the same Supabase project as Gameweek Edge (the publishable key is public-safe; RLS does the protecting). Picks live in `plb_picks`, locked to `auth.uid() = user_id` on every policy. On first sign-in, local and cloud picks merge (a settled result beats pending), then the merged set is pushed back up.

One-time setup in the Supabase project: run `supabase/plb_picks.sql` in the SQL editor, and add the deployed site URL to Authentication → URL Configuration → Redirect URLs so confirmation and reset emails return here. Until the table exists, sign-in still works and picks simply stay local.

## AI review of picks (optional)

The one feature worth keeping from Booking Analytics Pro, ported with the key handled properly. With three or more settled picks, the Tracker tab can send them to `netlify/functions/insights.js` (routed at `/api/insights`), which calls the Anthropic API **server-side** with `ANTHROPIC_API_KEY` from the Netlify environment and returns a short performance read — strongest and weakest markets, odds and staking patterns, three concrete adjustments. The key never reaches the browser, the prompts are fixed in the function, and only whitelisted pick fields are sent. Without the environment variable the function answers 501 and the app explains the feature is off; nothing else depends on it.

## Booking risk

    risk = yellow cards per 90 × 2 + fouls committed per 90

Yellow rate is weighted double because the market pays on cards. Fouls per 90 carries the volume signal. Both are 2025-26 rates. Players under 450 minutes are flagged low sample.

## 2026-27 lineup and data basis

- 20 confirmed clubs: 17 staying up, plus Coventry, Ipswich and Hull (promoted). Burnley, West Ham and Wolves went down.
- Stats are 2025-26 form, the pre-season basis for an August launch. 17 clubs from Premier League data, the 3 promoted clubs from their 2025-26 Championship data, flagged EFL.
- Club team rates are shown for Premier League clubs only. Championship data mixes cup minutes, so the promoted clubs' team rate is not comparable and is omitted, though their players still appear with per-90 rates.
- Referee figures are 2025-26 season averages from public data (tips.gg, with two lenient officials added from search data).

## Deploy to Netlify

Connect the `pl-bookings` repo (preferred — the `/api/fpl/*` proxy needs the Netlify Function, which a drag-and-drop deploy of the root also carries in `netlify/functions/`). Publish directory is the root, no build command. The `data` folder is gitignored, the app has its baked data inline. No environment variables are required — optionally set `ANTHROPIC_API_KEY` to switch on the AI review of tracker picks.

## Install as an app

The site is a PWA: on iPhone open it in Safari → Share → Add to Home Screen; Chrome on Android offers Install app. It launches full-screen with an offline app shell (live data still needs a connection).

## Data and pipeline

The `data` folder holds the build script and the raw harvests (gitignored):
- `build_pl_data.py` builds `pl_data.js` (CLUBS, PL_PLAYERS, REFS) from the harvested JSON.
- Harvested from the ScoutingStats API: `/api/league/8/player-stats` (PL) and `/api/league/9/player-stats` (Championship), plus referee data from tips.gg.

## Source data note

Player and club form via ScoutingStats (Sportmonks). Referee data from public sources. Built for research, not a betting guarantee.

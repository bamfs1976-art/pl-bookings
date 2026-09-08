# Bookings Desk

Player-bookings research for the Premier League, the EFL Championship and La
Liga, live at [bookingsdesk.netlify.app](https://bookingsdesk.netlify.app).
Every player's chance of a card in his next fixture, priced from his own foul
and caution record, the referee, the venue, the opponent and the game state,
with the referee tables, club discipline, fixtures, share cards and a pick
tracker around it. Research, not a betting guarantee, and 18+ throughout.

This page is the orientation for a new contributor or a fresh Claude Code
session: what the desk is, where things live, how to run it and how to check
it. The full prose behind every part of it is under [`docs/`](docs/), indexed
at the bottom.

## What it is

- Static pages, vanilla JavaScript, no build step, no framework and no API key
  in the browser. Each desk is one HTML file over shared modules in `assets/`
  and a generated dataset in `data/`.
- Every number a desk shows is derived from committed data by pure functions in
  `assets/core.js`, unit-tested under node, so a price on the page can be
  re-derived in CI. That is what the guard scripts do.
- Installable as a phone app with an offline shell, optional sign-in for pick
  sync, optional Web Push alerts about players you have starred, and an
  optional AI read of your settled picks. Everything works signed out.
- The data pipeline is Python under `data/`, run daily by GitHub Actions,
  which commit the refreshed datasets back to `main`.

Longer: [docs/overview.md](docs/overview.md) and [docs/views.md](docs/views.md).

## The four desks

| Desk | Route | File | Dataset | Notes |
|---|---|---|---|---|
| Today | `/`, `/today`, `/record`, `/booked`, `/accas`, `/derbies` | `today.html` | all three, loaded in same-origin frames via `data-frame.html` | One date across every league, the season calendar, the graded track record, the bookings ledgers and the accas. The home page. |
| Premier League | `/pl` | `index.html` | `data/pl_data.js`, `data/model.js`, `data/pl_fixtures.js` | The original desk. Live card counts, availability and fixtures from the FPL API through a Netlify Function proxy. Sign-in, tracker, AI review, screener, methodology view. |
| Championship | `/eflc` | `eflc.html` | `data/eflc_data.js`, `data/eflc_fixtures.js` | Referees from the free English match records; squads and fixtures from API-Football. No runtime fetches. |
| La Liga | `/laliga` | `laliga.html` | `data/laliga_data.js`, `data/laliga_fixtures.js` | Card rates from the free Spanish records; the official's name bought from API-Football and joined on. No runtime fetches. |

A league switcher on every page links all of them, and `scripts/check-nav.mjs`
fails CI if a desk becomes unreachable. Routes are in `_redirects`. Shared
modules: `assets/core.js` (all the maths), `assets/plmodel.js` (the Premier
League pricing, called by both `index.html` and `/today`), `assets/share.js`
(every share card), `assets/suspension.js`, `assets/refpicker.js`,
`assets/leaguebar.js`, `assets/shell.js`, `assets/save.js` (the share sheet on
iOS) and `assets/tw.css`. The Netlify Functions in `netlify/functions/` are the
FPL proxy, the AI review, the live card ticker, the match record, model
calibration and the four Web Push endpoints.

More: [docs/leagues.md](docs/leagues.md), [docs/navigation.md](docs/navigation.md),
[docs/share-cards.md](docs/share-cards.md), [docs/mobile.md](docs/mobile.md).

## Run it locally

Everything static works from any file server:

```sh
python3 -m http.server 8000
# http://localhost:8000/today.html  /index.html  /eflc.html  /laliga.html
```

Two things differ from the deploy. The pretty routes and the security headers
come from `_redirects` and `_headers`, which only Netlify applies, so use the
`.html` names locally. The Premier League desk's live feed goes through the
`/api/fpl/*` function; without it the desk falls back to the baked dataset and
the basis pill in the top bar says so. To run the functions too:

```sh
npx netlify dev      # serves the site, the redirects and netlify/functions
```

No environment variables are needed for the pages. The optional features each
take their own: `ANTHROPIC_API_KEY` for the AI review, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` for the daily cap and the calibration loop,
`VAPID_*` for push. See [docs/deploy.md](docs/deploy.md) and
[docs/accounts.md](docs/accounts.md).

## How the data pipeline runs

Six GitHub Actions workflows commit to `main`, each running every guard before
it pushes, and the CI workflow re-checks each commit they make:

| Workflow | Schedule (UTC) | What it writes |
|---|---|---|
| Data refresh | daily 04:10 | Player, club and referee datasets for all three desks, the season-prior model, the vendored match model, this season's fouls, the fixture lists, cup and European dates, and `backtest_report.md` |
| Fixtures and referee appointments | 07:20, 15:20, 19:20 daily; 17:20 on the day | Fixture lists with appointments, the published-appointments overlay, the bookings ledgers |
| Confirmed team sheets | hourly 10:05 to 21:05 | Confirmed XIs near kick-off |
| Extra API-Football feeds | 05:40, 11:40, 16:40, 20:40 | Standings, injuries, odds, predictions, card events, team and fixture stats (all optional to the desks) |
| Refresh sim model | Mondays 07:30 | `data/sim_model.js` from Plsimulator's published bundle |
| Backfill a season's team sheets | manual | A completed season's team sheets for the rotation model |

The **Accas** workflow runs hourly and writes the acca log and the match record
to Supabase rather than to the repository.

The pipeline's front door is `python3 scripts/build_data.py`: one command over
the same scripts `data-refresh.yml` calls, in the order that workflow
established. `--dry-run` prints the plan, and a step whose credential is absent
is skipped and named. Two secrets: `API_FOOTBALL_KEY` (squads, fixtures,
appointments, the Spanish officials) and the legacy `SS_COOKIE`. The referee
and club rates need neither; they come from the free football-data.co.uk
records. Sources, licences and what is refused are in
[docs/sources.md](docs/sources.md).

The API allowance is 7,500 calls a day and `scripts/check-api-budget.mjs`
computes the spend from the workflow files themselves.

Full detail, script by script: [docs/data-pipeline.md](docs/data-pipeline.md),
[docs/referees.md](docs/referees.md), [docs/live-data.md](docs/live-data.md).

## How to run the tests

```sh
node tests/test-core.mjs        # the pure maths in assets/core.js
node tests/test-libs.mjs        # card model, backtest, CSV import, vendored libraries, the report
node tests/test-webpush.mjs     # RFC 8291 test vector
node scripts/check-all.mjs      # every guard in scripts/, about ten seconds
python3 data/test_leagues.py    # and the other data/test_*.py files, one each
```

`.github/workflows/ci.yml` runs all of that on every push, plus `node --check`
over every script and inline block. The guards are the important half: each
one re-derives something a reader acts on and fails the build if it drifts.
`scripts/check-ci-wiring.mjs` fails if a guard or test exists that CI does not
run, or if a committing workflow stops running the guards before it pushes.
What each guard protects against, one line each with its kind and whether
it would be cheaper as a unit test, is in [docs/guards.md](docs/guards.md);
the comments above each step in `ci.yml` carry the longer story. More in
[docs/tests-and-ci.md](docs/tests-and-ci.md).

## The model, in one paragraph

A player's booking chance is a Poisson hazard, `1 - exp(-rate)`, over his
yellow rate per 90 shrunk toward a positional prior, scaled by his share of his
side's minutes, the venue, the appointed referee (yellows per game blended with
cards per foul, at the 3.71 pivot when the official has too thin a record), a
derby boost and the game-state factor from a vendored Dixon-Coles match model.
The three desks price through the same function, `PLDCore.pCardSeason`, and
`scripts/check-models.mjs` holds each within a tenth of its division's real
card rate. Fouls per 90 drive the *ranking* (the risk score) and not the price.
The constants live in `data/model.js` and are not changed without a backtest.
There are two backtests: the team-level one runs in the Methodology view on
every page load and currently finds the adjustment stack indistinguishable
from a naive baseline; the per-player one is written by the Data refresh
workflow to [`backtest_report.md`](backtest_report.md). Read both before
touching the model. Full account: [docs/model.md](docs/model.md),
[docs/backtest.md](docs/backtest.md), [docs/modelling-review.md](docs/modelling-review.md),
[docs/calibration.md](docs/calibration.md).

## Deploy notes

Netlify, from this repository, publish directory the root, no build command.
`_headers` and `netlify.toml` both set the security headers and must agree
(`scripts/check-headers.mjs` checks). The Content-Security-Policy allows
`'self'`, the Supabase project for `connect-src`, Google Fonts, and the crest
hosts for images; no script comes from anywhere but this origin. Framing is `SAMEORIGIN`, not `DENY`, because `/today` reads
the other desks through same-origin frames. Datasets and assets carry a short
revalidating cache. The service worker precaches every desk and module for
the offline shell, one entry at a time so a single missing file cannot take
the whole app offline. Detail: [docs/deploy.md](docs/deploy.md),
[docs/mobile.md](docs/mobile.md), [docs/vendored-libraries.md](docs/vendored-libraries.md).

## Licences

- **Data.** Referee and club rates are computed from the public-domain
  football-data.co.uk match records (via the DataHub mirror, PDDL, and the
  origin). Referee career history from 1992/93 comes from the MIT-licensed
  epldata package. Fixture dates use openfootball (CC0) alongside API-Football
  (keyed, under its terms). The Premier League desk reads the official FPL API
  through this site's own proxy, and this season's fouls come from
  FPL-Core-Insights, used with a link back as its README asks. Nothing is
  fetched, scraped or derived from FBref, WhoScored, FootyStats, Understat or
  any bookmaker. The full position, and the app's own Sources & licences view,
  are in [docs/sources.md](docs/sources.md).
- **Libraries.** Tabulator, jStat, simple-statistics, PapaParse and the
  Supabase client, all MIT, vendored and hash-pinned by
  `scripts/vendor-libs.mjs`. Nothing is fetched from a CDN. See
  [docs/vendored-libraries.md](docs/vendored-libraries.md).
- **This repository** carries no licence file of its own.

## Where everything else is documented

Moved from the old README, unchanged, one file per subject:

- [docs/overview.md](docs/overview.md): what it is, in full.
- [docs/views.md](docs/views.md): every view on the Premier League desk.
- [docs/live-data.md](docs/live-data.md): the FPL proxy, caching and fallback.
- [docs/accounts.md](docs/accounts.md): sign-in, pick sync and the AI review.
- [docs/calibration.md](docs/calibration.md): the calibration loop and the match record.
- [docs/model.md](docs/model.md): booking risk, implied probability, the match model, the 2026-27 data basis, and how the three desks were converged.
- [docs/deploy.md](docs/deploy.md): Netlify and the environment variables.
- [docs/navigation.md](docs/navigation.md): the league switcher and why it had to be added.
- [docs/mobile.md](docs/mobile.md): the PWA, the share sheet on iOS, touch targets.
- [docs/data-pipeline.md](docs/data-pipeline.md): every build script and the Data refresh Action.
- [docs/leagues.md](docs/leagues.md): the Championship and La Liga desks, the suspension schemes.
- [docs/share-cards.md](docs/share-cards.md): the cards, `/today` and the season calendar.
- [docs/backtest.md](docs/backtest.md): the in-page backtest and its result.
- [docs/vendored-libraries.md](docs/vendored-libraries.md): what is vendored and how the bytes are proved.
- [docs/tests-and-ci.md](docs/tests-and-ci.md): the front door, the guards, CI.
- [docs/sources.md](docs/sources.md): data sources and licences.
- [docs/push.md](docs/push.md): the two watchlist alerts.

Written for a subject rather than moved:

- [docs/referees.md](docs/referees.md): the referee path end to end, and its guards.
- [docs/decisions.md](docs/decisions.md): the dated record of what was built and what was left, July and August 2026.
- [docs/audit-2026-07.md](docs/audit-2026-07.md): the July 2026 audit with every finding's closure status.
- [docs/guards.md](docs/guards.md): every guard CI runs, what it protects against, and which would be cheaper as unit tests.
- [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md): the running log from September 2026 on.

Research and plans:

- [docs/audit-2026-08.md](docs/audit-2026-08.md) and [docs/upgrade-plan.md](docs/upgrade-plan.md): the August audit and the plan cut from it.
- [docs/modelling-review.md](docs/modelling-review.md): the v1 model, what was wrong with it, and v2.
- [docs/lineup-pricing.md](docs/lineup-pricing.md): pricing off a confirmed XI and the live card ticker.
- [docs/desk-parity.md](docs/desk-parity.md): what the Premier League desk had that the others did not.
- [docs/referee-sourcing.md](docs/referee-sourcing.md), [docs/free-data-sources.md](docs/free-data-sources.md), [docs/repo-scan.md](docs/repo-scan.md): where more data could come from, and what would change.
- [docs/la-liga-feasibility.md](docs/la-liga-feasibility.md), [docs/scottish-premiership-feasibility.md](docs/scottish-premiership-feasibility.md), [docs/scottish-derbies.md](docs/scottish-derbies.md): other competitions.
- [docs/suspension-rules.md](docs/suspension-rules.md) and [docs/spain-suspensions.md](docs/spain-suspensions.md): the three suspension schemes and how far each was verified.
- [docs/SEASON_RESEARCH_2026-08.md](docs/SEASON_RESEARCH_2026-08.md): the pre-season research note.

Out of scope, and staying so: a Champions League or Europa League desk.
European fixtures are hand-built outside the app.

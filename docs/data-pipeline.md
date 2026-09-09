# Data and pipeline

> Moved unchanged from the old README.md on 8 September 2026 ("Data and pipeline"). The README is now an orientation page; this file keeps the full prose.

## Data and pipeline

The `data` folder holds the build script and the raw harvests (harvest JSON gitignored):
- `scripts/build-model.mjs` builds `data/model.js`, the card/fouls model parameters (empirical-Bayes shrinkage priors, the logistic GLM coefficients, the two-stage fouls→card hazard, the NegBin fouls dispersion). Default is a reproducible **season prior** derived from `pl_data.js`; `--fit data/match_history.json` re-estimates the GLM by IRLS on match-level outcomes from `data/harvest_history.py` (FPL `element-summary`), and `scripts/backtest.mjs` walk-forward-scores it (Brier/log-loss). The maths is pure and unit-tested in `assets/core.js`. See `docs/modelling-review.md`.
- `scripts/build-sim-model.mjs` builds `data/sim_model.js` from Plsimulator's published bundle: `node scripts/build-sim-model.mjs` fetches `https://plsimulation.netlify.app/model.json`, or `--from ../Plsimulator/model.json` reads a local checkout. It fails loudly on a club it cannot map to a short code (rename either side and the alias table in the script needs an entry), and `scripts/check-data.mjs` fails CI if any club in `CLUBS` ends up unrated and warns once the vendored bundle is over 45 days old.
- `build_pl_data.py` builds `pl_data.js` (CLUBS, PL_PLAYERS, REFS) from the harvested JSON. It de-duplicates players on (club, name) so a repeated harvest row can never fan out into the shipped data. Each player carries fouls **committed** per 90 (`f`, feeds the risk score) and fouls **won**/drawn per 90 (`fw`) — the latter is read from the ScoutingStats fouls-drawn field where present and is `null` until a harvest includes it (it is not in the FPL feed). Fouls committed and won surface on the player profile, in the per-match and players share cards, and in the CSV export. `index.html` loads the file directly, so regenerating it is the whole refresh — there is no hand-copy step, and CI (`scripts/check-data.mjs`) fails if an inline dataset ever reappears in `index.html`, a duplicate player row slips through, a promoted club loses its EFL flag, or the counts go wrong.
- Player/club form is harvested from the ScoutingStats API: `/api/league/8/player-stats` (PL) and `/api/league/9/player-stats` (Championship).
- `leagues.py` is the **league registry** — what the desk knows about a competition: which free match file to read, how many clubs, which data file to patch, whether that source names the referee at all. Adding a competition should be an entry here, not another copy of a build script. `build_refs.py` and `build_club_splits.py` both read their match records through it, so the source URL, the season code, the blank-row filter and the partial-season guard exist once.
- `build_refs.py` builds a league's referee data from football-data.co.uk — free, no login: `python3 data/build_refs.py` (add `--season 2627` once the new season has matches). It writes `pl_refs.json` and patches the REFS block of `pl_data.js` in place. `--league EFLC` does the same for the **EFL Championship**, `--dry-run` prints the ranking without writing, and a league whose data file does not exist yet gets the JSON and a note rather than an error. Sources are tried in order: the GitHub mirror first for the Premier League (what the refresh has always used), then the football-data.co.uk origin it mirrors — so a mirror outage is a second attempt now, not a hard exit. The Championship is not on the mirror, which carries only the top five European leagues, so it reads the origin directly.
- `ingest_appointments.py` reads a **published referee-appointments article** into the fixture list — the half of the referee path no feed supplies. The EFL publishes its officials about a week out as prose, division by division; API-Football, which writes `eflc_fixtures.js` three times a day, carries them very late or not at all (the file read "552 fixtures, 0 with a referee appointed" three days before the season began). Paste the article in and it maps clubs, resolves each official to the card table's own spelling, and writes `data/appointments.json`:

  ```sh
  python3 data/ingest_appointments.py --dry-run --source <url> < article.txt   # report only
  python3 data/ingest_appointments.py --source <url> < article.txt            # write
  ```

  The overlay is **re-applied by `emit_fixtures` on every harvest**, because a hand edit to the fixture file is erased within eight hours by the next run. A harvested name always wins where there is one — that job is the fresher source — and a disagreement is printed as a changed official rather than resolved quietly. Divisions the app does not model are counted and skipped, not stored.

  The name resolution is the load-bearing part. The desk joins referees by exact string and the card table spells officials two ways ("Tim Robinson", but also "A Herczeg"), while the EFL always publishes full names: of the twelve Championship officials appointed for 14–20 August 2026, **five matched the table and seven did not**. Each miss is invisible — `refFor()` returns "appointed" and `refFactor` stays 1, which on the page is indistinguishable from a neutral referee. So names are resolved by rules that each require a unique hit (exact, first-initial-plus-surname, an expanded forename such as Matt→Matthew) plus a written-down alias list for the rest (Bobby Madley is recorded as R Madley). **Surname alone is never enough** — the table holds both Lewis Smith and Josh Smith, and matching an official to a colleague would price a fixture off another man's card rate while looking entirely correct. Anything unresolved is reported and left as published. `scripts/check-appointments.mjs` fails CI if the overlay stops reaching the fixture file or if the join breaks wholesale.
- `build_club_splits.py` adds each club's home/away cards-against split (`caH`/`caA`) to the CLUBS block from the same football-data.co.uk mirror — run it **after** `build_pl_data.py`, which regenerates CLUBS without the splits. The split is a ratio on the club's existing `ca`, so the ScoutingStats scale is preserved; promoted clubs stay null and fall back to the league median in the app. Fixture booking heat then uses the home side's home rate plus the away side's away rate.
- `build_ref_history.py` generates the 1992/93–2017/18 baseline from the MIT-licensed [epldata](https://github.com/pssguy/epldata) R package: 26 seasons of league cautions-per-game and 70 referees' career records. That source is frozen at May 2018, so it only needs re-running if the aggregation changes (needs `pip install pyreadr`; raw `.rda` files cache in the gitignored `data/epldata/`). Its output is snapshotted as career **totals** in the committed `data/ref_history_base.json`.
- `extend_ref_history.py` writes `data/ref_history.js` (committed) by merging that baseline with every season from **2018/19 onward**, recomputed from the same public-domain football-data.co.uk match records the referee card rates use — so the career column keeps moving forward instead of stopping at 2018. It is **idempotent**: the baseline stays pristine and the football-data era is always rebuilt, so re-running can never double-count. Runs in the Data refresh Action; `python3 data/extend_ref_history.py` by hand also works.
- `harvest.py` automates the harvest. ScoutingStats needs a logged-in session, so it authenticates with a browser cookie: log in at scoutingstats.ai, copy the `cookie` request header from DevTools, then `SS_COOKIE='…' python3 data/harvest.py && python3 data/build_pl_data.py`. If `pl_refs.json` is absent it is reconstructed from the shipped `pl_data.js` (referee figures only change when refreshed by hand).
- The **Data refresh** GitHub Action (`.github/workflows/data-refresh.yml`) runs the whole pipeline in one click from the Actions tab — harvest → rebuild → regenerate the model → re-vendor the match model → guards → commit. The match-model step is `continue-on-error`: the desk works without it, so an unreachable simulator leaves the previous bundle in place instead of failing the refresh. It needs one repository secret, `SS_COOKIE`, holding that same cookie value; re-set it whenever the session expires. It also **fits the card model (Tier 2)**: the Action harvests per-match booking history from the public FPL `element-summary` endpoint (reachable from GitHub's runners) and refits the GLM by IRLS. The fitter keeps the season prior automatically until ≥200 real match rows exist, so it's a no-op early in the season and flips `data/model.js` to `basis:"match-fit"` once enough gameweeks have been played — no manual step needed. Uncheck the **fit_model** input to skip it.

### Serie A (added 9 September 2026)

The Italian steps mirror the Spanish ones, in the order the discovered
registry demands. `scripts/build_data.py` runs them as a front door and
`data-refresh.yml` is the pipeline that ships them; `check-build-data.mjs`
keeps the two lists in step.

- `harvest_apifootball.py --league SA --clubs` discovers the division from
  API-Football league 135 and writes `data/seriea_clubs.json` (refuses a
  division that is not twenty clubs). Everything below resolves club names
  through it.
- `harvest_apifootball.py --league SA` (last season's form, `yc`),
  `--league SA --roster` (this season's membership, `sa_squads.json`),
  `--league SA --out seriea_season_cards.json` (this season's cautions,
  `sc`) and `--league SERB` (Serie B, league 136, for the promoted clubs).
  The two card counts are never conflated: `yc` is 2025-26 form, `sc` is
  2026-27 state.
- `harvest_apifootball.py --ref-fixtures --league SA` takes the COMPLETED
  season's officials into `data/seriea_ref_fixtures.js`; `--fixtures
  --league SA` takes the season being played into `data/seriea_fixtures.js`.
  Two files, two seasons.
- `build_seriea_data.py --season 2526` writes `data/seriea_data.js`
  (`SUSPENSION`, `CLUBS`, `SERIEA_PLAYERS`, `REFS`) through the shared La
  Liga builder configured for Italy; club card rates come free from the I1
  records on the football-data mirror.
- `build_refs.py --league SA --season 2526` joins the bought names onto the
  free rows by date and both canonical clubs and computes every referee rate
  from the free columns. The join must cover the whole season; a partial
  join is a stop, and `scripts/check-seriea.mjs` enforces it on the shipped
  table.
- `fetch_appointments.py --league SA` finds the AIA's designation article for
  a pending giornata and `ingest_appointments.py --format aia` reads it,
  resolving surname-only officials through `appointments.resolve_surname_only`.
  Until that route is confirmed from a runner, the feed's own referee field is
  what the desk shows.

### The Champions League tie list (added 9 September 2026)

`data/harvest_ucl.py` writes `data/ucl_ties.js`, the European ties this app can
honestly price. It runs once a day in `data-refresh.yml`, costs **one**
`/fixtures` call for the whole competition and buys no players: the squads are
already harvested for the three domestic desks.

- **Both sides or neither.** A row is only written when both clubs resolve to
  a desk that holds players for them, through each desk's own resolver rather
  than a second spelling table. Every row carries both short codes and both
  desk codes, because the two halves of the price come from different files.
  A tie with one side unheld is dropped and counted in the log, never
  half-built. `scripts/check-ucl.mjs` re-derives that rule from the desks'
  data files, so the harvest cannot assert it alone.
- **No fabricated kick-offs.** API-Football creates the league-phase fixtures
  as soon as the draw is made and, until it ingests UEFA's calendar, stamps
  every one of them with a single provisional instant. The harvest detects the
  block on the impossibility that a club cannot play twice at one moment,
  reading every tie in the competition rather than the priceable few, and
  writes those ties with a null date. The round is real; the kick-off is not
  known, so nothing claims one. `data/uefa_league_phase.py` records what this
  cost the repository the last time it went unnoticed.
- **No referee rate and no suspension ladder.** The official's name is carried
  so a card can say who it is. The rate is not: a referee's cards-per-foul is
  competition-specific, and these desks hold domestic records. UEFA's
  accumulation rules are not encoded because they are not evidenced. See
  `docs/champions-league-feasibility.md` §4 and §5.

The desk side of it is `/europe`, a route off `today.html` rather than a page:
Europe is not a division, and a separate file would have had to load all three
datasets again and keep its own copy of the pricing in step. Each side of a tie
is priced through its own desk, which for the Premier League means the fitted
model in `assets/plmodel.js` and for the other two the shrink-then-hazard path,
with no referee factor, no derby boost and no game-state term.

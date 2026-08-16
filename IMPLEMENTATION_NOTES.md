# Implementation notes — audit follow-up (2026-07-12)

What was implemented from `AUDIT.md`, and what was deliberately deferred.

## Modelling parity with gameweekedge.co.uk (2026-07-24)

Two modelling best-practices ported from Gameweek Edge:

1. **Recency-weighted GLM fit.** The match-level fit now weights each row by
   `0.97^(gameweeks ago)` (`PLDCore.recencyWeight`, `data/model.js`
   `recencyDecay`), in both `scripts/build-model.mjs` and the
   `scripts/backtest.mjs` weekly refit. No-op on the season-prior basis (no
   per-row gameweek), so nothing changes until a real `--fit` runs.

2. **Server-verified calibration loop (P5 parity).** A scheduled logger grades
   the model in the open, aggregated across everyone — see
   `docs/modelling-review.md`. **Operator steps (cannot be done from the repo):**
   - Run `supabase/plb_predictions.sql` in the Supabase SQL editor (idempotent,
     RLS deny-all — service role only).
   - Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the Netlify
     environment (the same keys the AI cap already uses). Without the service
     key the hourly logger no-ops and the "Live prediction accuracy" card stays
     hidden; everything else works with no env at all.
   - The `@hourly` schedule and `included_files` are declared in `netlify.toml`;
     Netlify picks the schedule up on the next deploy.

## Four library-backed upgrades (2026-08-15)

Tabulator, jStat, simple-statistics and PapaParse, all MIT, **vendored inline**
into `index.html` so the page makes no third-party request to render.

1. **Vendoring is generated, not pasted** (`scripts/vendor-libs.mjs`). Half a
   megabyte of minified JavaScript in an HTML file is unreviewable by eye. Each
   block sits between `VENDOR:<id>` markers, carries a licence header naming the
   package, version, copyright and licence, and has its SHA-256 recorded in
   `scripts/vendor-libs.sha256.json`. `--check` runs offline in CI and fails if a
   byte has moved. Source-map comments are stripped: they point at files this
   page does not ship, on a page whose whole claim is that it fetches nothing.

2. **Screener** (`assets/screener.js`, Tabulator). A fourth view of the Players
   panel. Virtual rendering keeps ~40 rows in the DOM at 667 players. Two
   decisions worth recording. The 450-minute floor is **not** a filter — rows
   below it are greyed and badged, and the minutes slider prints the number it
   hides. And low-sample rows **sort below** every qualified row whichever column
   is clicked: one minute and one foul is a fouls-per-90 of 90.0, arithmetically
   true and otherwise top of every sort in the division. The "why" panel is
   `position:sticky; left:0` at the table holder's own width, published as a
   custom property from JS — it lives inside a row element as wide as eleven
   columns, so left alone the working rendered three screens off the side of a
   phone.

3. **Card model** (`assets/cardmodel.js`, jStat). λ = shrunk rate × minutes share
   × venue × referee × opponent, P(card) = 1 − Poisson(0 | λ). The referee leg
   prices officials with 10+ matches off their own rate and everyone else off the
   3.71 pivot, which is exactly neutral by construction. The opponent leg reads
   fouls **drawn** out of the 2025/26 match record; the three promoted clubs were
   not in that division, so they get `source: "none"` and a neutral factor rather
   than the league mean wearing a club's name, and the Import view accepts the
   figure by hand. `working` is one object, returned by the model and rendered
   verbatim by the expander, so the explanation cannot drift from the arithmetic.

4. **Backtest** (`assets/backtest.js`, simple-statistics + jStat), rendered under
   a new **Methodology** panel and **computed in the page** rather than quoted.
   **It reports that the model does not beat the baseline** — +0.0014 Brier at
   the headline threshold with a 95% interval spanning zero, and no win at any of
   the three thresholds run. The finding underneath: the model discriminates (top
   decile 35.9 points above bottom, against the baseline's −14.1) but is biased
   low, because team yellow counts are *under*-dispersed relative to a Poisson.
   `tests/test-libs.mjs` pins the verdict so a change that flips it fails loudly.

5. **Import** (`assets/adminimport.js`, PapaParse) behind `?admin=1`. Emits a
   `PL_PLAYERS` block byte-compatible with `data/build_pl_data.py`. A blank fouls
   cell is `null`, never `0` — read as nought it fits the player as the most
   disciplined in the division and nothing on screen says why. The flag is
   tidiness, not security, and the view says so: static page, no server, nothing
   to protect.

6. **Sources & licences** panel: epldata (MIT), the DataHub PL mirror (PDDL),
   openfootball (CC0), the FPL API, the four libraries — and an explicit "not
   used, and will not be" entry for FBref, WhoScored, FootyStats, Understat and
   bookmaker feeds.

### Known gaps, deliberately left open

- **The per-player backtest leg.** Scoring P(this player is booked in this
  fixture) needs per-player, per-match outcomes for a completed season. FPL
  carries the current season only (pre-season: nothing) and every archive that
  has it is off limits. The test runs at team-match level on what is licensable
  and says so on screen; it is not evidence about the per-player rates.
- **Promoted-club fouls drawn.** Not in the 2025/26 Premier League record because
  they were not in the division. Manual entry, labelled as such, per the licence
  rules.
- **Page weight.** `index.html` is now ~990 KB, of which 574 KB is vendored
  library code (Tabulator alone is 432 KB) — roughly 130 KB gzipped. It buys a
  page with no third-party requests; splitting the libraries into `assets/` would
  let them cache separately across deploys, and is the obvious next move if the
  shell fetch ever becomes the problem.
- **Two external requests remain, and predate this work**: the Supabase client
  from jsDelivr (optional sign-in) and Google Fonts. Neither is a vendored
  library; both would need their own decision.

## Implemented

1. **Data divergence fixed + hand-copy step eliminated.** The stale inline
   dataset in `index.html` (462 players, 6 EFL rows) is gone; the app loads
   the generated `data/pl_data.js` (528 players, 72 EFL rows) via
   `<script src>`. The service worker precaches it (network-first, like the
   shell), `_headers`/`netlify.toml` give it a short revalidating cache, and
   `scripts/check-data.mjs` (run in CI) fails the build if an inline
   `PL_PLAYERS` literal reappears or the counts regress (≥500 players,
   20 clubs). README's incorrect "data folder is gitignored" claim fixed —
   only `data/*.json` is ignored.

2. **`/api/insights` protected.** Requires a Supabase access token verified
   against `SUPABASE_URL/auth/v1/user`; CORS reflects the request Origin only
   when it matches the site's own Host (never `*`); per-user daily cap
   (default 10, `AI_DAILY_CAP`) via the service-role-locked `plb_ai_usage`
   table (`supabase/plb_ai_usage.sql`, RLS deny-all) when
   `SUPABASE_SERVICE_ROLE_KEY` is set — auth-required but uncapped without
   it. 501-when-unconfigured kept. Graceful fallback to a pinned secondary
   model on 404-model errors; 502 responses surface the upstream API reason.
   Client attaches the session token and tells signed-out users to sign in.

3. **Referee-to-fixture assignment.** Per-fixture Ref select on the Fixtures
   tab (REFS roster + unknown), persisted in `localStorage` under
   `pl_desk_refs_v1` keyed by season + fixture id. Assigned officials scale
   the fixture's booking heat by `ref_ypg / league_avg_ypg` clamped to
   0.75–1.3, with a surname + strictness chip. Watchlisted players whose next
   fixture has a strict (4.0+ ypg) official assigned are flagged in the strip
   above the players table.

4. **Odds/value layer.** Logistic mapping from risk score to implied
   P(card): base rate = total yellows per player-match in the shipped data,
   intercept anchored so the minutes-weighted league-average player lands on
   that base rate, slope fixed (`assets/core.js`, documented in the Guide as
   an estimate). Sortable P(card) column with fair decimal odds in the
   players table; implied probability on fixture top-risks; inline value
   check per player row (paste bookmaker decimal odds → edge % + verdict),
   with honest "model estimate, not a guarantee" framing.

5. **Accuracy self-tracking.** Per-GW snapshots in `pl_desk_acc_v1`: when a
   snapshotted gameweek finishes, the app scores how many of the model's
   top-20 risks picked up a card (delta in live yellow counts) and renders a
   "Model track record" card on the Guide tab (per-GW + cumulative hit rate,
   honest empty state until the season starts). Best-effort: GWs with
   missing data are skipped, and failures can never break the app.

6. **Matchup context.** Static `DERBIES` list (North London, Merseyside,
   North-West, Manchester, Roses, Chelsea–Spurs/Arsenal/Fulham, M23,
   Tyne–Wear, plus promoted-club rivalries Coventry–Villa and Hull–Leeds);
   derby fixtures get a ×1.15 heat boost and a 🔥 derby chip. Last-5-GW card
   form per player (▲n beside the yellow count) once ≥2 accuracy snapshots
   exist. Guide notes home/away splits and opponent fouls-drawn are deferred
   (see below).

7. **PWA/meta polish.** `og:image` + Twitter card meta pointing at a
   generated 1200×630 `og.png` (Pillow: dark background, fanned-cards mark,
   app name, strapline). Tailwind CDN replaced with a purged self-hosted
   build (`npx tailwindcss@3 --content index.html --minify` →
   `assets/tw.css`, ~5.8 KB) — the markup uses only the app's own classes,
   so the CDN was effectively just the preflight reset; CSP tightened
   accordingly in both the meta tag and `_headers`.

8. **Tests + CI.** Pure logic extracted to `assets/core.js` (PLDCore
   global + CommonJS export): risk formula, name normalisation, pick P/L +
   ROI, implied-probability functions. `tests/test-core.mjs` (20 tests, plain
   node) covers formula math, accent/hyphen normalisation edge cases,
   won/lost/void P/L, and implied-prob monotonicity + base-rate calibration
   (including against the real dataset). `.github/workflows/ci.yml` runs the
   tests, `node --check` on functions/SW/core/dataset/inline scripts, and
   the data guard. `sw.js` precaches `assets/core.js` (cache now `plb-v4`).

9. **Docs.** README updated for the external data file, protected AI review,
   ref assignment, value layer, tests/CI; this file lists the deferrals.

10. **The match model, wired (2026-08-04).** `PLDCore.chaseFactor` shipped
    earlier with nothing to feed it. It now runs off Plsimulator's fitted
    Dixon-Coles ratings, vendored into `data/sim_model.js` by
    `scripts/build-sim-model.mjs` and evaluated by `PLDCore.simFixture` — a
    function-for-function port of `plsim/models.py`, pinned to frozen output
    from the Python so the two products cannot drift. Each fixture card shows
    the win probabilities, the fitted `tight` number (`P(margin <= 1)`) and the
    game-state multiplier each side's players carry.

    Two things worth recording. The factor takes the side's **expected result
    share** (`P(win) + P(draw)/2`), not its win probability: fed raw, an even
    fixture marks up *both* sides (measured ×1.013 / ×1.068), because a win
    probability averages ~0.37 in a three-way market while `chaseFactor` is
    neutral at 0.5 — a league-wide upward drift on no evidence. And `tight` is
    computed and displayed but **not** wired into booking heat; it is the right
    replacement for the `DERBIES` list, and that swap belongs to
    `scripts/backtest.mjs`. `sw.js` precaches the new data file (cache now
    `plb-v10`).

## Deferred (and why)

- **Automated ScoutingStats re-harvest** (audit rec 6). The harvest
  endpoints require a logged-in ScoutingStats session; credentials can't be
  baked into a public repo or CI. The pipeline is one command once the
  JSON is present (`python3 data/build_pl_data.py`), and CI guards the
  output. Revisit with a secrets-backed scheduled GitHub Action if an API
  token becomes available.
- **Web push alerts** (audit rec 10: suspension-risk and strict-ref pushes).
  Needs VAPID keys, a subscription store and a send pipeline — server
  infrastructure this static deploy doesn't have. Recommended path: reuse
  the Gameweek Edge push stack (same Supabase project and account model)
  rather than building a parallel one here. The in-app equivalents (the
  suspension-watch strip and the strict-ref watchlist flags) ship now.
- **Full 20+ referee roster.** The baked list covers 12 officials, some
  with null reds/pens; a full PL season uses 20+. Needs a proper data
  harvest of PGMOL appointments/stats (tips.gg or similar), which is a data
  task rather than a code change. The assignment UI takes any roster
  `pl_data.js` ships, so the fix is purely regenerating the data.
- **Home/away splits and opponent fouls-drawn** in the risk model. Not in
  the FPL feed or the current ScoutingStats extract; needs a richer per-match
  source. Documented as a known limit in the Guide.
- **Absolute `og:image` URL.** The canonical deploy domain isn't recorded in
  the repo, so the meta tags use a root-relative path; most crawlers want an
  absolute URL. Swap in `https://<site>/og.png` once the domain is settled.

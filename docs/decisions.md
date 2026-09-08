# Decisions record

The dated record of what was built, what was deliberately left, and why. Two
files merged unchanged on 8 September 2026: `IMPLEMENTATION_NOTES.md` (the
follow-up to the July 2026 audit, now [audit-2026-07.md](audit-2026-07.md))
and `ENHANCEMENTS.md` (the August 2026 review of the sibling repositories).
Headings keep their original dates; only their levels moved down one step so
this file has one title. The running log for new work is the root
`IMPLEMENTATION_NOTES.md`.

---

## Implementation notes — audit follow-up (2026-07-12)

What was implemented from `AUDIT.md`, and what was deliberately deferred.

### Modelling parity with gameweekedge.co.uk (2026-07-24)

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

### Four library-backed upgrades (2026-08-15)

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

#### Known gaps, deliberately left open

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

### Implemented

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

### Deferred (and why)

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

---

## Enhancements from the repo portfolio (2026-08-01)

*Reviewed 2026-08-01, against `main` at `06a8c3c`. Sources: every repo under
`bamfs1976-art`, plus two external repos supplied for comparison
([Lamarssom/card-bookings-bot](https://github.com/Lamarssom/card-bookings-bot),
[Gavin-Roche/premier_league_statistics_analyzer](https://github.com/Gavin-Roche/premier_league_statistics_analyzer)).*

This file records what was taken from where, what was deliberately left, and
what is still open. `AUDIT.md` and `IMPLEMENTATION_NOTES.md` cover the earlier
2026-07-12 audit; this is the follow-on.

---

### The unmerged branches — read this before merging anything

Four `claude/*` branches sit ahead of `main`. Only one of them should be
merged as-is.

| Branch | Base | `main` ahead by | Call |
|---|---|---|---|
| `app-comparison-consolidation-rxjg8p` | `9721239` | 1 | **Merged.** Acca builder in the share cards |
| `pl-bookings-ux-ui-updates-mnhiy2` | `9721239` | 1 | **Delete.** Already on `main` via `06a8c3c` |
| `plbookings-plsimulator-integration-o8j8fg` | `ff9630e` | 56 | **Do not merge.** Port the ideas |
| `premier-league-forecast-review-pda1rp` | `ff9630e` | 56 | **Do not merge.** Port the ideas |

Both of the big branches were cut from `ff9630e`, and `main` has 56 commits
since. Merging either would bulldoze the PWA, Supabase sync, the calibration
loop, the referee history, All Players and the command palette. Their value is
real but it has to be lifted forward by hand, not merged.

---

### Correctness: the promoted clubs have never had a full squad

The single most important finding, and it is a data bug rather than a code one.

`data/pl_data.js` ships 462 players. Ipswich has **1**, Hull **2**, Coventry
**3**. Every other club has 22–31. All six promoted-club rows are forwards, so
the three clubs have no defender or midfielder in the dataset at all — exactly
the players who collect cards.

`AUDIT.md` recorded this as critical bug #1 and `IMPLEMENTATION_NOTES.md`
records it as fixed by shipping "528 players, 72 EFL rows". **That fix was
against a phantom.** Checking the history:

```
2b7b00a  players=528  efl=72   2026-07-13
6ffde1e  players=462  efl=6    2026-07-20   <- "fix duplicates"
```

The 72 EFL rows were the same 6 forwards repeated 12 times each. The de-dup in
`6ffde1e` was correct; it simply revealed a hole that had been there since the
first commit, masked by duplicates. There is nothing to restore from history.

`scripts/check-data.mjs` has been tightened accordingly — the count thresholds
had drifted to `>=400 players` and `>=1 EFL row`, loose enough to hide this.
The load-bearing asserts are now per club: at least 15 players, and at least
one defender and one midfielder. **CI is red until a Championship harvest
lands.** That is the correct state.

Two ways to fix the data:

1. Re-run the ScoutingStats harvest with a valid `SS_COOKIE`, making sure the
   Championship leg (`/api/league/9/player-stats`) actually returns.
2. Take the API-Football path prototyped on the forecast branch. One free key,
   no login cookie, no paid subscription — and it removes the reason
   `IMPLEMENTATION_NOTES.md` gives for the harvest not being automated.

Option 2 is the better long-term answer and is the largest single item still
open.

**Update 2026-08-02 — guards moved upstream.** The hole was only ever caught by
`scripts/check-data.mjs`, i.e. after a bad build had already written
`pl_data.js`. Two checks now run earlier, share one definition of "covered"
(`build_pl_data.PROMOTED`, `MIN_SQUAD`, `REQUIRED_POS`), and are unit-tested in
`data/test_coverage.py` — pure Python, no network and no cookie, so CI runs
them:

- `harvest.py` refuses to overwrite `champ_promoted.json` when the league-9
  payload does not cover the promoted clubs. The old floor was `>=100 players`
  across all 24 Championship clubs, which a three-player slice clears easily —
  and did.
- `build_pl_data.py` refuses to write `pl_data.js` at all, naming each club and
  the positions it is missing rather than leaving a downstream count to fail
  vaguely later.

This does not put the data in. It stops the gap being invisible, and makes the
failure say which club to go and fetch. The two options above are still the
fix, and option 2 is still the better one.

**Update 2026-08-02 — option 2 is built.** `data/harvest_apifootball.py` fetches
the promoted clubs' Championship form from API-Football and writes
`champ_promoted.json` in the shape `build_pl_data.py` already consumes, so
nothing downstream changes. It needs one free key in `API_FOOTBALL_KEY` rather
than a browser cookie, which is why the refresh can finally run unattended: the
workflow runs it whenever the secret is set, after the ScoutingStats step and
overwriting it.

`/players` is paginated twenty at a time, which is the same truncation risk in
a new coat, so the walk reads every page, follows a page count revised upward
mid-walk, and treats a 200 carrying an `errors` object (a bad key, an exhausted
quota) as a failure rather than an empty squad. Coverage is judged by
`build_pl_data.coverage_problems` — the one implementation, reached through an
adapter, after an earlier pair of copies disagreed about whether a thin squad
also reports its missing positions.

**Not yet verified against the live API.** It is written from the documented v3
contract and tested against recorded-shape fixtures in
`data/test_apifootball.py`; api-football.com is unreachable from this
environment and needs a key. The first real run is the proof, and the guards
are deliberately loud so a moved field stops the harvest by name instead of
writing a plausible file. What is still needed: a free key at
<https://dashboard.api-football.com>, added as the `API_FOOTBALL_KEY`
repository secret, then run the data refresh.

---

### Shipped in this branch

#### Responsible gambling notice — from `cheltenhamtips`

`cheltenhamtips` carries BeGambleAware, GamCare, GamStop and the helpline in
its footer. This app carried only "stake responsibly". Now: an 18+ notice with
all four, in the footer, the sidebar legal line and both share-card renderers.
For a UK betting-research tool this is a compliance floor, not a nicety.

#### Stale-client guard on pick sync — from `f1gridmasters`

F1 Grid Masters lost state to a stale client on 2026-07-16 and was hardened
the same day. This app had the same shape of hole: every push stamped
`updated_at` as *now* regardless of when the pick actually changed, so a tab
left open across a deploy signed in and looked like the freshest writer.

Three defences, matching the F1 fix:

- every pick carries a real edit time (`uat`), set where it is actually edited;
- the merge resolves field by field on that time, falling back to the old
  "settled beats pending" rule only for picks predating this version;
- a cloud `schema_v` above the client's puts the tab in **read-only** mode —
  it still displays picks, it just never writes — and the pre-merge state is
  backed up to `pl_desk_v1_backup` first.

`schema_v` is only written once the column is seen on a read, so this works
before and after `supabase/plb_picks.sql` is re-run. That file is now
re-runnable (policies dropped first).

#### Team card markets — from `wcstats` and `card-bookings-bot`

The desk priced players but not the two markets people actually bet: total
cards over/under, and both teams carded. Every fixture card now carries a
market strip: expected cards, O3.5, O4.5, BTC.

Each rated available player is one Bernoulli trial, so the match total is
Poisson-binomial — an exact distribution, folded one player at a time, no
simulation.

The correction that makes it usable: a player's probability assumes he plays
90 minutes, so summing a 25-man squad prices a match with 50 players on the
pitch and returns about **9** expected cards. Each player is now weighted by
his share of his side's minutes, scaled to an eleven. This is the forecast
branch's `expected minutes / 90` in the form the shipped data supports, and it
is the first piece of that branch's model to land.

Calibration check across all 272 possible pairings:

| Metric | Model | Reality |
|---|---|---|
| Expected cards per match | **4.10**, 4.15 once venue lands | ~4.0–4.3 |
| O4.5 on an average fixture | 42–47% | broadly market range |
| Both teams carded | 74–82% | ~75–80% |
| Away vs home, league mean | 2.18 vs 1.97 | away bias, correct direction |

(Figures are league means across all 272 pairings. An individual fixture
spreads much wider — a derby prices near 4.5 with the away side at 2.6.)

Independence is the honest limit — cards cluster, so the far tails run thin.
Stated in the Guide rather than fudged. 14 new unit tests.

Contrast fix alongside it: `--danger` / `--warn` are badge fills and only
reach ~2.9:1 as small text. `--danger-ink` / `--warn-ink` / `--good-ink` are
added for text on a light surface. The strip clears WCAG 2.2 AA in both
themes, lowest measured 4.95:1.

#### Player notes — from `wcstats`

A free-text note per player on the profile, stored beside the watchlist,
debounced, capped at 500 characters, cleared when blank. A starred player
without the reason you starred him is half a note.

#### Head-to-head card history — from `card-bookings-bot`

Average yellows in past meetings between the two clubs, on the market strip
beside the model's number. Built by `data/build_h2h.py` from the same
public-domain football-data.co.uk records already used for referees and venue
splits — 1,118 meetings across 151 club pairs over five seasons, no new source
and no key.

Counts **yellows only**, matching what the fixture model counts (players
booked), so the two are directly comparable. Pairs with under three meetings
show nothing.

Two results worth keeping:

- The history's league average is **4.0 yellows a meeting** against the
  model's 4.10 expected cards. Two unrelated methods landing in the same
  place is the strongest evidence yet that the minutes weighting is right.
- They disagree by **0.61 cards on average and by a full card in 19%** of
  fixtures. So the cell is neither noise nor a restatement — it earns its
  space, and divergence of a card or more is highlighted.

#### Venue factor per player — from the forecast branch

Away sides are carded more, in every season on record. Fixture heat already
reflected it; the per-player number now does too, ×0.95 home and ×1.08 away.
League expected cards moves 4.10 → 4.15, still inside the real band, and opens
a 0.20-card gap between the sides, which is the size the record shows.

Alongside it, `cardLambda` / `pCardFromLambda` / `chaseFactor` land as a
tested foundation for the full hazard model, running beside the shipped
logistic mapping rather than replacing it. Two bugs the tests caught and worth
remembering: `Number(null)` is `0`, so a missing simulator input read as a
certain loss and marked up every unwired fixture; and `1 - exp(-λ)` rounds to
exactly `1` past λ≈37, which would have handed the value layer fair odds of
1.00 and an infinite implied edge.

#### Calendar export — from `sportsfinder-uk`

An RFC 5545 `.ics` for a player's next fixture carrying booking heat, the
assigned referee and the player you are watching, with a one-hour alarm. A
`data:` URL, so no server and it works offline.

#### Acca builder — merged from `app-comparison-consolidation`

Same-match double/treble on the match share card, cross-match on the gameweek
card.

---

### Still open, in priority order

#### 1. Fix the promoted-club data (blocked on a key)

See above. Needs `SS_COOKIE` or an API-Football key. Everything else in the
desk is downstream of this being right.

#### 2. Port the rest of the forecast-branch model

Minutes weighting, the venue factor and the hazard functions have landed. The
rest has not:

```
lambda  = yellows/90 (blended, shrunk) x expected minutes/90
          x referee factor x venue factor x derby factor
P(card) = 1 - exp(-lambda)
```

`main` still maps a risk score through a logistic curve on every displayed
row. The hazard form is now available beside it but does not drive the
numbers, because swapping what every row shows should follow a backtest, not
a refactor. `scripts/backtest.mjs` already exists to do that.

Also on that branch and worth taking: blending current season with last season
capped at 900 minutes of evidence, expected minutes from real appearance data,
confirmed lineups near kick-off, and freezing forecasts before kick-off so
they are scored honestly afterwards.

#### 3. Web push — **done, both alerts**

Shipped: `push-key`, `push-subscribe`, `push-unsubscribe`, `push-cron`,
`supabase/plb_push.sql`, the service worker handlers and the offer card under
My watchlist. Both alerts this item named are live — *referee appointed to a
watchlisted player's fixture* and *one caution from a ban*.

**The ban alert does not reimplement the ladder.** It requires
`PLDCore.nextSuspension` — the same function the page prices with — because
the part that is easy to get wrong is not the arithmetic, it is that an
English rung **expires**. Five cautions is a ban only if reached by the club's
19th match, so a player on four after that match is not one from a ban at all;
a `cards === 4` check would notify about a suspension that cannot happen.
That case is pinned in `tests/test-webpush.mjs`.

Two more things it gets from using the real rule: it counts each club's
**completed matches** rather than gameweeks (they diverge the moment a game is
postponed, which is exactly when a gate matters), and it reports the rung's
cost and how many matches are left before the cut-off — "one away with nine
matches to avoid it" and "one away with one" are the same fact and a different
decision.

The alert state is keyed on the **rung**, not a boolean: a player who is one
from five, gets booked, serves the ban and later comes one from ten is news
twice, and a flag would fire once a season.

**No minutes floor**, unlike the on-page watch strip. That strip ranks the
whole league and has to keep fringe players out of a readable list; this fires
only for a player somebody explicitly starred, and "he barely plays" is a
judgement the subscriber already made.

**Not ported from `gameweek-edge`, rebuilt.** That repo uses the `web-push`
package, which it can because it already has a package.json for Capacitor.
This desk has none, no build step and no install: every function here reaches
Supabase over its REST API with plain `fetch`. Adding one dependency would
mean a lockfile and an install step in the deploy, so RFC 8291 (payload
encryption), RFC 8188 (aes128gcm framing) and RFC 8292 (VAPID) are implemented
directly on `node:crypto` in `netlify/lib/webpush.js` — about 150 lines.

**It is pinned to the specification's own worked example.** Hand-rolled crypto
is exactly what should not be trusted for looking right, and the failure mode
here is invisible: a wrong ciphertext gets a 201 from the push service and is
then silently dropped by the browser, so the symptom is "notifications don't
arrive" with logs saying everything worked. RFC 8291 §5 publishes the keys,
the salt, the plaintext and the expected ciphertext; `tests/test-webpush.mjs`
reproduces it byte for byte, and is wired into CI.

**The watchlist rides on the subscription row.** The desk's watchlist is
local-first and works signed out, deliberately, so the server has no way to
know who follows whom. The client sends a copy of the keys with the
subscription and re-sends on every change through `saveState()`, which is the
one choke point all three star controls funnel through. The alternative was to
require sign-in for alerts, which trades the feature's whole audience for a
tidier schema.

It sends the keys **and the FPL element ids**. The appointment alert targets a
fixture, so a club code out of the key is enough; the ban alert targets a
player, and the element id is the only identity the desk and the FPL feed
share. Resolving one to the other is the club-and-name matching `attachLive`
already does, and repeating that server-side would be the same subtle logic in
two places. A player starred before the live feed has ever loaded has no id
yet — he keeps appointment alerts and gains ban alerts on the next visit.

**The state table is load-bearing.** "A referee has been appointed" is not a
property of the fixture list — every appointed fixture looks identical whether
it was appointed a minute ago or a month ago. It is a difference, so the
previous assignment per fixture is stored, and the first run seeds it and
sends nothing. Getting that wrong does not fail quietly: it notifies every
subscriber about every appointed fixture, every hour, forever.

A re-appointment is treated as its own, more urgent alert — a naive "is the
ref set?" check misses it entirely, and it is the case where the reader may
already have acted on the old number.

Setup: `node scripts/gen-vapid.mjs`, set `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in Netlify, run
`supabase/plb_push.sql` once. Until both are done `/api/push-key` returns 503
and the desk simply does not offer alerts — no broken button.

#### 4. Game-state and close-game factors — from `Plsimulator` (mostly done)

**Landed 2026-08-04.** Not as a JSON export from the forecast branch: the
simulator publishes its whole fitted model as a CORS-open bundle
(`plsimulation.netlify.app/model.json`, refreshed weekly), so
`scripts/build-sim-model.mjs` vendors the ratings into `data/sim_model.js` and
`PLDCore.simFixture` reproduces the Dixon-Coles arithmetic in `core.js`. That
is strictly better than importing precomputed win probabilities — the desk can
price *any* pairing, not just the fixtures someone remembered to export, and a
frozen golden-value test pins the port to `plsim/models.py`'s own output so the
two products cannot drift.

The game-state factor now drives every fixture-aware booking probability. One
correction to the plan above, found by measuring rather than reasoning: feeding
`chaseFactor` the raw **win probability** marks up *both* sides of an even
fixture, because a win probability averages ~0.37 across a three-way market and
the factor is neutral at 0.5. That is a few percent of upward drift on every
player in the league, on no evidence, and it pulls the model off the base rate
the logistic is anchored to. It takes the side's **expected result share**
(`P(win) + P(draw)/2`) instead — 0.5 on a level fixture, mirrored between the
sides, mean exactly 1.0 across all 380 pairings. Range on the shipped ratings
is ×0.887–×1.113, so the ×0.85–×1.20 clamp is a guard rather than a binding
constraint.

**P(one-goal game)** is computed and shown on every fixture card as `tight`
(defined as `P(margin <= 1)` — a draw or a one-goal win). It is deliberately
*not* wired into booking heat yet: it is the right replacement for the
hardcoded `DERBIES` list, but changing what orders the fixture list is a
backtest decision, and `scripts/backtest.mjs` exists to make it. That is the
remaining half of this item.

Still open from this item: the walk-forward backtest scoring against **market
closing odds** (RPS 0.2068 vs the market's 0.1994). The desk's calibration loop
scores against a base rate, which is a much easier benchmark.

#### 5. Charts — **done, two of three, and the third refused**

`assets/charts.js`: inline SVG, no library, tokens not hexes, every chart
carrying a `<title>` and a summary sentence instead of geometry.

- **The reliability curve** was the easy one and the best one, because the
  data was already on the wire. `/api/model-calibration` has returned a
  `buckets` array — mean forecast against observed frequency, with a count —
  for as long as the loop has run, and the client drew the headline Brier
  score and threw the buckets away. A Brier says how wrong; the curve says
  **which way**, and for a bookings desk over-confidence is the direction that
  costs money. Dots are sized by sample count so a nine-forecast bucket cannot
  be read as a finding.
- **Per-player card form** as a stepped cumulative line over the gameweeks the
  browser has recorded. Stepped, not smoothed: a booking is an event at a
  moment, and a diagonal draws a player collecting two-thirds of a yellow in
  midweek. `cardForm()` gave a delta; three-in-one-week and one-a-month have
  the same delta and a very different shape.
- **The club × referee heatmap is not built, and should not be.** 23 officials
  worked the 2025-26 Premier League and a club plays 38 matches, so a club
  meets a given referee **1.65 times a season**. A 20 × 23 grid of one- and
  two-match cells is a picture of sampling noise with a colour scale on it,
  and a colour scale is extremely good at making noise look like a finding.
  Two charts the data does support were built instead: a **strictness strip**
  showing every official's cards per game with this round's actual
  appointments picked out and named (the Friday question is not how strict
  Kavanagh is in the abstract, it is whether any of this week's officials are
  outliers), and the **34-season league trend**, which already existed as a
  bare 280×44 polyline with no scale and no annotation — 1.34 in 1993-94
  against 4.17 in 2023-24 is the largest single fact in the referee dataset
  and the old chart said only "it went up".

#### 6. Table virtualisation — **done, in one CSS property**

`content-visibility: auto` with `contain-intrinsic-size` on the All Players
rows and cards. No library, no windowing, no scroll maths. Measured in
Chromium, appending the fragment and forcing the layout it causes:

| rows | without | with | |
|---|---|---|---|
| 700 (a full league) | 468 ms | 120 ms | **74% faster** |
| 2,000 | 1,374 ms | 331 ms | **76% faster** |

That is a third of a second of blocked main thread returned on every click of
a column header, on a phone.

**The objection this rule usually earns does not apply here, and it was
measured rather than assumed.** Skipping off-screen rows normally stops them
contributing to a table's column widths, so columns twitch as you scroll.
Over 700 rows at three scroll positions: **zero drift on all ten columns** —
Chromium still visits rows for intrinsic sizing and skips only the paint and
the layout of their contents. Browsers without the property render exactly as
they do today, so there is no fallback to write.

Note what it does *not* fix: the rows are still created. `content-visibility`
buys rendering, not DOM construction, so the 800-row cap keeps its purpose
(and with ~700 registered players it never fires in practice).

#### 7. Broadcaster line and onboarding

Both from `sportsfinder-uk`. The broadcaster rights table is a maintained JSON
map of fixture → channel, which is real ongoing work rather than a code
change, so it is listed rather than started. The three-step onboarding wizard
(pick your clubs and players) would seed the watchlist — today a new user
lands on an empty card.

#### 8. Platform patterns from `gameweek-edge`

- The capability registry (`GAMES` / `NAV` with `needs:`) — panels that need
  live data would disappear pre-season instead of showing zeros.
- One `ai.js` with per-task prompts, Haiku for volume and Sonnet for chat,
  cached per gameweek. The desk has one AI feature; this is how it gets four.
- Stripe free/Pro tiering if the desk should ever earn.
- A twice-daily server aggregation into Supabase (the Core Insights pattern)
  is the route to fixing the fouls gap — FPL carries no fouls, so that half of
  the risk score is frozen on 2025-26 form all season.

---

### Deliberately not taken

- **`BAProTips`** is being retired into this app and its one worthwhile
  feature (AI review of tracker picks) is already ported.
- **`card-bookings-bot`'s prediction method** is H2H historical averages with
  no model. The H2H *data* is worth having (item 3); the method is not an
  upgrade on what is here.
- **A Telegram bot as a delivery channel** (the same repo's shape) is a
  plausible distribution idea but a separate product surface, not an
  enhancement to the desk.
- **`Plsimulator`'s Streamlit dashboard** — this app is a single-file static
  site and should stay one.
- **Capacitor / native iOS** from `gameweek-edge`. The PWA covers it until
  there is a reason to pay Apple.

---

## Branding (2026-09-08)

**BAProTips is retired.** Its one worthwhile feature, the AI review of tracker
picks, was ported into this app on 12 July 2026 (see "Deliberately not taken"
above) and the name was retired on 8 September 2026. Bookings Desk is the
product name and `bookingsdesk.netlify.app` is its address; the old app's
`playerbookings.netlify.app` address is not referenced anywhere in this
repository. The mentions of the old name in this file are historical and stay.
The absolute `og:image` URL the July notes deferred "until the domain is
settled" was set the same day.

# Sports MCP Assessment for GameweekEdge and PLBookings

Prepared 1 October 2026. Read-only assessment. No MCPs were installed, no dependencies or keys were added, and no source files were changed.

Companion documents in this folder:

- `sports-data-source-inventory.md`: every current and proposed source.
- `sports-data-schema-proposal.md`: entity model and derived-metric definitions.
- `mcp-setup-recommendation.md`: least-privilege MCP set-up, test checklist and rollback.
- `sports-data-backlog.csv`: prioritised backlog for both products.

The same document set is committed to both repositories (`bamfs1976-art/gameweek-edge` and `bamfs1976-art/pl-bookings`) so each team sees the whole picture. Treat the GameweekEdge copy as the master if they ever drift.

Evidence labels used throughout:

- **Verified (repo)**: read in the code or docs of one of the two repositories, with a path.
- **Verified (official)**: read on the provider's own page or repository on 1 October 2026.
- **Official snippet**: seen as a search excerpt from the provider's own domain. The page itself was blocked by this environment's network policy. Re-check it in a browser.
- **Unverified / to validate**: an assumption or third-party claim. Do not build on it until checked.

---

## Executive recommendation

### The short answer

None of the five MCPs should power either production app. Both apps already use the right production pattern: scheduled jobs fetch upstream APIs directly, write snapshots, and serve those snapshots from the CDN. An MCP adds a process, a dependency and a large tool surface without adding data you lack.

MCPs are worth having only as a **developer and research interface**, and only one of them, narrowly configured.

| Decision | MCP | Why |
|---|---|---|
| **Use (development only, optional)** | **sportsdata-mcp**, pinned to v0.33.0, with `SPORTSDATA_MCP_GROUPS` set explicitly to the FPL groups and, for PLBookings research, the `apisports` group on a separate free-tier key | The only candidate with FPL tools. It allows groups to be enabled selectively. MIT licence and active maintenance. |
| **Keep using** | The in-house **GameweekEdge MCP** (`/api/mcp`, 7 read-only tools) | Already built, read-only, serves your own model. Fix the price-tool drift noted below. |
| **Defer** | **Sports Hub MCP** | Read-only and well engineered, with provider allow-listing. It has no FPL tools and its football groups duplicate API-Football, which PLBookings already calls directly. Revisit if you add other sports. |
| **Defer** | **API-Football MCPs** (community, e.g. `snailbrainx/API-Football-MCP`, `MarvDann/api-football-mcp`) | No official API-Sports MCP was found. PLBookings already has a mature direct integration with retry, quota tracking and a budget guard. The sportsdata-mcp `apisports` group covers ad-hoc exploration. |
| **Defer (out of scope)** | **F1 MCPs** (OpenF1, Jolpica, FastF1) | No football value. Borrow three patterns from them instead (see "Patterns worth borrowing from F1 tooling"). |
| **Avoid** | **SportScore MCP** | No documented card, foul or referee fields. Install ping is on unless you opt out. Free use requires a visible "Powered by SportScore" link. The operator is not named, and the stated rate limits disagree with each other. |
| **Never enable** | sportsdata-mcp account, bookmaker and bet-placement groups, and its `premierleague.com` private-API provider | Since v0.31.0 the package can place real-money bets (`sportsbet_place_bet`, `tab_place_bet`, `entain_place_bet`, `unibet_place_bet`). The premierleague.com provider reads private site APIs that the Premier League's terms do not permit for commercial reuse. |

### Upstream sources that should power production

| Product | Primary | Secondary | Historical | Paid? |
|---|---|---|---|---|
| GameweekEdge | Official FPL API (`bootstrap-static`, `fixtures`, `event/{gw}/live`, `element-summary`, `event-status`) | football-data.org v4 free tier (fixture status, head-to-head), FPL-Core-Insights (best-effort, attributed) | vaastav/Fantasy-Premier-League (MIT) plus your own daily FPL snapshots | No |
| PLBookings | API-Football v3 Pro (fixtures, events, line-ups, fixture statistics, fixture players, season player statistics, injuries) | Official FPL API for PL availability and live yellow-card counts | football-data.co.uk season CSVs for referee history, **subject to the licence check in Phase 0**, otherwise API-Football backfill | Yes, API-Football Pro (already paid) |

### Minimum viable data stack

**GameweekEdge (no paid provider):**

1. FPL API through the existing `/api/fpl` proxy, edge-cached.
2. A daily raw snapshot of `bootstrap-static` and `fixtures`, stored compressed with a manifest. This is the one missing piece. It unlocks price, ownership and availability history without any new provider.
3. football-data.org free tier for fixture status and head-to-head.
4. vaastav history for backtesting (already in `data/fpl-history.json`).
5. A freshness log written by every ingestion job.

**PLBookings (API-Football Pro, about $19 a month, Official snippet):**

1. API-Football as the single source of truth for fixtures, card events with minutes, line-ups, fouls and season player statistics, across every desk including the PL.
2. FPL API for PL live availability and cross-checking yellow-card counts.
3. Referee career history from the existing frozen `epldata` snapshot (MIT) plus football-data.co.uk, if the licence allows your use. Otherwise rebuild it from API-Football fixtures (`referee` field) and `/fixtures/statistics`.
4. Referee appointments from the official announcement, captured as a manual or semi-automated overlay with a recorded source URL.
5. The same freshness log as GameweekEdge.

### The two findings that matter more than any MCP

1. **PLBookings' PL player form base still comes from ScoutingStats through a logged-in browser cookie, including a Cloudflare `cf_clearance` token** (Verified (repo): `pl-bookings/data/harvest.py`; `data/pl_data.js` line 1 reads "ScoutingStats 2025-26 form"). This conflicts with the app's own "no scraping" stance. It breaks whenever the cookie expires, and it has unclear terms. API-Football `/players` already supplies the same fields for the other desks. **Switching the PL desk to API-Football is the single highest-priority implementation task.**
2. **Licensing is the real constraint, not data availability.**
   - football-data.co.uk states its data is free "for use by private individuals only, not for commercial or data training products using automated bots/scrapers/AI" (Official snippet, `football-data.co.uk/disclaimer.php`).
   - API-Sports does not grant a licence to publish data. It says rights must come from the leagues (Official snippet, `api-sports.io/terms`).
   - The Premier League's site terms forbid commercial use and building databases from site material (Verified (official), `premierleague.com/en/terms-and-conditions`).
   - These need a deliberate decision, recorded in `docs/`, before you expand either product.

---

## Current codebase findings

### Shared traits

- **Front end.** Both apps are static, vanilla-JavaScript sites with no framework, hosted on Netlify with Git-based deploys.
  - GameweekEdge ships `index.html` (about 1.7 MB) through an esbuild step.
  - PLBookings has no build step at all.
- **Ingestion.** Scheduled GitHub Actions workflows fetch upstream data and commit generated JSON or JS snapshots into the repo. Netlify serves those snapshots with short cache headers. This is a sound, cheap, outage-tolerant design: when an API is down, the last committed snapshot still serves.
- **Supabase** stores predictions, push subscriptions, usage counters and user data. The schema lives in one-off SQL files, not migrations. Several tables used in code have no SQL file in either repo:
  - GameweekEdge: `gwedge_profiles`, `gwedge_push_subs`, `gwedge_push_state`, `gwedge_billing_events`.
  - PLBookings: `plb_accas`, `plb_acca_legs`, `plb_card_predictions`.
- **Tests and guards are unusually strong.**
  - GameweekEdge's `npm test` chains about 60 checks.
  - PLBookings runs about 40 `check-*.mjs` guards, including an API budget guard (`scripts/check-api-budget.mjs`).
- **No references** to sportsdata-mcp, SportScore, Sports Hub, OpenF1, Jolpica or FastF1 exist in either repo (Verified (repo), full-text search).

### GameweekEdge

| Area | Finding | Evidence |
|---|---|---|
| Stack | Vanilla JS single file, npm, esbuild, Capacitor 6 iOS, Supabase, Stripe subscriptions | `package.json`, `scripts/build-web.mjs`, `capacitor.config.json`, `netlify/functions/checkout.js` |
| Primary data | Official FPL API via the allow-listed proxy `netlify/functions/fpl.js` | Edge `max-age=300, stale-while-revalidate=600`; live endpoints `no-store`; client TTLs from 3 minutes to 6 hours (`index.html` around line 3884) |
| xG and set pieces | Taken from FPL bootstrap fields (`expected_goals`, `expected_assists`, `*_order`, `penalties_text`). No third-party xG. | `docs/FPL_API_SURVEY.md` lines 85-95 and 205-215 |
| Secondary data | football-data.org v4, free key `FOOTBALL_DATA_KEY`. Edge cache acts as the rate limiter for a site-wide 10 calls a minute | `netlify/functions/football-data.js` lines 18-32 |
| Other sources | FPL-Core-Insights (GitHub, attributed), vaastav (MIT, history), Fantasy EFL JSON, PL Simulator bundle (sister project), pl-bookings vendored files (SHA-pinned) | `netlify/functions/core-insights.js`, `scripts/history/lib.mjs`, `netlify/functions/efl.js` |
| Optional adapters | LetLetMe, unofficial FPL GraphQL, Apify actors, World News API. Off unless configured. Shared HTTP client with timeout, jittered retry and Retry-After handling | `netlify/lib/enrichment/`, `docs/ENRICHMENT.md` |
| Schedules | Netlify: `log-predictions` and `push-cron` hourly, `push-live` every 2 minutes, `core-insights` twice daily. Actions: record every 3 hours, tool pages twice daily, history weekly, freshness check daily | `netlify.toml`, `.github/workflows/*.yml` |
| Freshness | `dev/freshness-check.mjs` grades feeds REACHABLE / SHAPED / FRESH. The top bar shows "Data HH:MM". Price figures are labelled "FPL's own figure" or "our estimates" | `scripts/freshness-rules.mjs`, `index.html` around lines 3758 and 14232 |
| History | 10 seasons of vaastav data (`data/fpl-history.json`, 555 KB). Walk-forward backtest. Append-only pre-deadline pick ledger | `docs/HISTORY.md`, `data/record/` |
| Gap | No raw daily archive of FPL snapshots. Price flow is sampled hourly into `gwedge_push_state`, but ownership, availability news and `ep_next` are not kept over time | Inference from `netlify/lib/price-feed.js` and the storage review |
| Existing MCP | Hand-written JSON-RPC server at `/api/mcp`. Public, unauthenticated, 7 tools, all `readOnlyHint: true` | `netlify/functions/mcp.js`, `netlify/lib/mcp.js` |
| MCP drift | `fpl_price_predictions` still uses a logistic estimate. The app replaced that estimate on 22 August 2026 with FPL's own `price_change_percent` after measuring a rank correlation of 0.30 | `mcp.js` lines 615-623; `docs/FPL_API_SURVEY.md` lines 570-604 |
| Rejected sources | Understat, FBref, Pulselive and SDP site APIs, efl.com scraping, Open-Meteo (non-commercial terms) | `docs/data-sources.md`, `docs/scope-referee-source.md`, `docs/MODELLING.md` lines 319-375 |

### PLBookings

| Area | Finding | Evidence |
|---|---|---|
| Stack | Static pages, no `package.json`. Stdlib-only Python harvesters and Node 20 guards. Netlify. Supabase | `README.md` lines 16-19, `netlify.toml` |
| Primary data | API-Football v3 on a **Pro plan (7,500 calls a day)**, with a guard ceiling of 5,000. Estimated use is about 13% of quota | `data/api_budget.py` line 47; `.github/workflows/extra-feeds.yml` lines 12-19 |
| Endpoints used | `/fixtures`, `/fixtures/events`, `/fixtures/lineups`, `/fixtures/statistics`, `/fixtures/players`, `/players`, `/players/squads`, `/players/topyellowcards`, `/players/topredcards`, `/injuries`, `/sidelined`, `/standings`, `/teams/statistics`, `/transfers`, `/fixtures/headtohead`, `/predictions`, `/odds` | `data/harvest_apifootball.py`, `data/harvest_extra.py` lines 756-766 |
| Retry | 0.25 s pacing. 4 retries with 15 to 60 s backoff on rate-limit bodies. Usage read from `x-ratelimit-*` headers. Workflow legs use `continue-on-error` and keep the last committed file | `data/harvest_apifootball.py` lines 286-466 |
| Referee rates | From football-data.co.uk CSVs (Referee, HF/AF, HY/AY, HR/AR), plus `epldata` (MIT) for 1992/93 to 2017/18 | `data/build_refs.py`, `docs/referees.md` |
| Referee appointments | API-Football's `referee` field **stopped carrying PL referees on 6 September 2026** (0 of 350 upcoming fixtures). Appointments now come from scraping premierleague.com news pages through Playwright, plus efl.com, rfef.es PDFs and aia-figc.it | `data/fetch_appointments.py` lines 104-118 |
| PL form base | **ScoutingStats via a logged-in cookie** (`SS_COOKIE`, includes Cloudflare `cf_clearance`) | `data/harvest.py`; `data/pl_data.js` line 1 |
| Live | `/api/live-cards` makes one `/fixtures?live=` call with a 60 s TTL. FPL proxy for PL live data | `netlify/functions/live-cards.js` |
| Schedules | Data refresh 04:10 daily. Fixtures and appointments 7 times a day. Extra feeds 4 times a day. Line-ups hourly 10:05 to 21:05. Accas hourly. Push-cron hourly | `.github/workflows/*.yml` |
| Model | Poisson hazard `1 − exp(−λ)` with an empirical-Bayes shrunk yellow rate (k = 6), a clamped referee factor (0.75 to 1.30) and venue, derby, opponent and chase multipliers | `assets/core.js` lines 1161-1200; `docs/modelling-review.md` |
| Backtest | PL: 302 out-of-sample predictions over 5 rounds. Brier 0.0975 (base) vs 0.0967 (prior) vs 0.0978 (fit). **The fitted GLM does not beat the baseline on the PL.** All predictions fall in the 0 to 20% bands | `backtest_report.md`; `docs/backtest.md` |
| Responsible gambling | 18+ footer, BeGambleAware, GamCare and the helpline on every page. Share cards always carry "18+ · begambleaware.org". Guards enforce both | `index.html` lines 1593-1602; `assets/share.js` lines 216-224; `scripts/check-share.mjs` |
| Betting framing | Fair odds, "value check" edge %, a stake/P&L tracker, recommended accas with priced odds, an `/accas` route | `docs/model.md` line 13; `scripts/accas.mjs` lines 1-30 |
| Provenance gap | The Sources panel omits API-Football, ScoutingStats, FPL-Core-Insights, Plsimulator and appointment scraping. It claims no bookmaker data while `harvest_extra.py` harvests `/odds` (output currently empty and unused) | `index.html` around line 1480; `README.md` lines 170-174 |
| Doc drift | `log-predictions.js` is retired but still described in `calibration.md` and `deploy.md`. README lists 4 of 7 fixture crons. `core.js` line 1192 says "season-prior" | Agent review of docs against code |

---

## Product data requirements

Rating key. **Have**: present in the codebase today. **Gap**: needed but not present. Quality: H / M / L.

### GameweekEdge

| Capability | Status | Best lawful source | Quality | Freshness needed | Key or paid | Notes |
|---|---|---|---|---|---|---|
| FPL bootstrap and player data | Have | FPL API `bootstrap-static` | H | 5 to 60 min | No key | Undocumented official API. Terms to validate (Phase 0) |
| Price, ownership, transfers, form, points | Have (live), Gap (history) | FPL API, plus own daily snapshots | H | Hourly around 01:30 UK price changes | No | No public price API exists. History only exists if you archive it |
| Fixtures, gameweeks, deadlines, FDR | Have | FPL API `fixtures`, `events` | H | 10 min | No | football-data.org as a cross-check for status |
| Availability, injuries, suspensions | Have | FPL `status`, `chance_of_playing_*`, `news`, `yellow_cards` | M | 15 to 60 min | No | FPL news is editorial and can lag press conferences |
| Live scoring and events | Have | FPL `event/{gw}/live`, `event-status` | H | 1 to 2 min in matches | No | Bonus is provisional until confirmed |
| xG / xA and performance | Have (FPL fields) | FPL `expected_goals`, `expected_assists`, `expected_goal_involvements` | M | Daily | No | One provider's xG model (Opta via FPL). No shot-level detail. Understat and FBref are rejected for terms reasons |
| Set-piece roles and penalties | Have | FPL `*_order`, `penalties_text`, team set-piece notes | M | Daily | No | Editorial, updated irregularly |
| Historical FPL data | Have | vaastav (MIT) | H | Weekly | No | Attribute in-app |
| Manager and league features | Have | FPL `entry/*`, `leagues-*` | H | Per request | No | No FPL login is taken, by design |
| Rate limits | n/a | No published FPL limit | n/a | n/a | n/a | Edge caching is the protection. Keep it |

### PLBookings

| Capability | Status | Best lawful source | Quality | Freshness needed | Key or paid | Notes |
|---|---|---|---|---|---|---|
| PL fixtures and results | Have | API-Football `/fixtures` | H | 2 to 7 times a day | Pro | FPL fixtures as a fallback |
| Card events with minute, second yellows, reds | Have | API-Football `/fixtures/events` (type `Card`, detail `Yellow Card` / `Red Card`, `time.elapsed` + `time.extra`) | H | After full time, then once next day | Pro | Second yellow appears as a red with its own detail. Validate the exact detail string (Phase 0) |
| Substitutions | Have | `/fixtures/events` (type `subst`), `/fixtures/lineups` | H | After full time | Pro | Needed for minutes exposure |
| Player booking and suspension data | Have | `/fixtures/players`, `/players`, FPL `yellow_cards` (PL) | H | Daily | Pro / no key | Suspension thresholds hand-coded per league |
| Team cards, fouls, possession, shots | Have | `/fixtures/statistics` | H | After full time | Pro | Validate field names for every league |
| Referee assignments | Partial | Official announcements. API-Football field no longer carries PL refs | M | 3 to 5 days before for PGMOL | n/a | Weakest link. See risks |
| Referee card and foul tendencies | Have | football-data.co.uk history, or API-Football fixtures + statistics | M | Weekly | No / Pro | Small samples per referee per season |
| Line-ups and likely starters | Have (confirmed XIs) | `/fixtures/lineups` about 60 min pre-match | H | Hourly on match days | Pro | Predicted XIs are not available from a lawful free source |
| Head-to-head and recent form | Have | `/fixtures/headtohead`, own fixtures table | M | Weekly | Pro | H2H card counts have tiny samples. Show as context only |
| Historical match data for backtesting | Have (2025/26 PL; EFLC and La Liga in fit report) | API-Football historical seasons, football-data.co.uk | M | One-off backfill | Pro | Confirm how many past seasons Pro returns (Phase 0) |
| Trend analysis, not headline counts | Partial | Derived from events, minutes and fixtures | M | Daily | n/a | Needs per-90 rates, exposure, shrinkage and windows |
| Rate limits | Have guard | 7,500 a day on Pro, 10 a minute on free (Official snippet) | n/a | n/a | n/a | Budget guard at 5,000 a day |

---

## MCP comparison matrix

Tool counts come from each project's own README on 1 October 2026 (Verified (official) unless marked).

| | sportsdata-mcp | API-Football MCPs (community) | SportScore MCP | F1 MCPs | Sports Hub MCP |
|---|---|---|---|---|---|
| Canonical repo | `github.com/DanielTomaro13/sportsdata-mcp` (PyPI `sportsdata-mcp`) | `snailbrainx/API-Football-MCP` (Python, 40+ tools); `MarvDann/api-football-mcp` (TS, 11 tools, PL only) | `github.com/Backspace-me/sportscore-mcp` (npm) | `mariuspot/f1mcp` (Go), `Praneethravuri/pitstop` (Python), `rakeshgangwar/f1-mcp-server` (TS + Python) | `github.com/lacausecrypto/mcp-sports-hub` (npm) |
| Licence | MIT | MIT | MIT | MIT | MIT |
| Runtime and transport | Python 3.11+, local stdio (HTTP optional) | Local stdio (SSE / HTTP optional) | Node, stdio (HTTP optional) | Local stdio or HTTP | Node 18+, local stdio (HTTP on localhost) |
| Tool count | About 841 to 856 across 64 to 65 providers | 11 to 40+ | 8 | 8 to 14 | 410 across 42 providers (tagline still says 336) |
| Selective enabling | Yes: `SPORTSDATA_MCP_GROUPS` (groups, globs, exclusions) | Not documented | No | n/a (small) | Yes: `SPORTS_HUB_PROVIDERS` (default `free`, about 165 tools) |
| What it adds over the codebase | An FPL tool group for ad-hoc questions; OpenF1/Jolpica; dozens of non-football providers | Nothing PLBookings lacks; it is a chat front end to the same API | Keyless scores and timelines for 4 sports | F1 data only | ESPN, TheSportsDB, Sportmonks and odds feeds; no FPL |
| GameweekEdge value | Low to medium (research queries against live FPL) | None | None | None | None |
| PLBookings value | Low (exploring API-Football fields with a dev key) | Low (same) | Low (no card or referee fields documented) | None | Low (API-Football duplicate) |
| Suitability | Internal research only | Prototyping only | Not suitable | Not suitable (out of scope) | Prototyping only |
| Upstream reliability | Mixed. Includes undocumented and spoofed-header sources alongside official ones | Depends on API-Football (commercial, documented) | Unclear operator; conflicting stated limits | OpenF1 and Jolpica are community projects, unaffiliated with F1 | Mixed, as for sportsdata-mcp |
| Key, plan or process | Local process. Free; per-provider keys optional | Local process plus an API-Football key | Local process; no key | Local process; no key | Local process; per-provider keys |
| Tool-count context risk | **Very high** if unrestricted. Must be pinned to a handful of groups | Low to medium | Low | Low | High if `all`, medium on `free` |
| Security and privacy | **Bet placement tools since v0.31.0.** Account tools. Spoofed headers for some providers. Telemetry opt-in | Read-only. Key stored in local env | **Install ping on by default** (opt out) | Read-only | Read-only. PRIVACY.md present |
| Read or write | Mixed. Read-only only if account and bookmaker groups stay off | Read-only | Read-only | Read-only | Read-only (annotated) |
| Cost and limits | Free. 60 s cache. Upstream limits apply | API-Football quota (free 100 a day; Pro 7,500) | About 1,000 a day per IP (README) vs about 10,000 (site). Attribution link required | Jolpica 4 req/s burst, 500 an hour (Verified (official)) | Free. 60 s cache. Retry with Retry-After |
| Overlap | FPL duplicates GameweekEdge's proxy. apisports duplicates PLBookings | Full duplicate of PLBookings' integration | Duplicates API-Football fixtures | None | API-Football and football-data duplicates |
| Single source of truth | FPL API direct | API-Football direct | API-Football direct | n/a | API-Football direct |
| Direct API better for production? | Yes | Yes | Yes | n/a | Yes |

### Narrow source groups the brief asked about

| Source (or sportsdata-mcp group) | Scheduled updates | Server-side caching | Historical snapshots | Reproducible calculations | Provenance per chart | Raw / derived / insight separation | Verdict |
|---|---|---|---|---|---|---|---|
| Official FPL (`fpl.*`) | Yes, via your Actions or Netlify schedules | Yes, existing edge cache | Only if you archive. FPL keeps no history of prices or ownership | Yes, if inputs are archived with a hash | Yes: `source=fpl`, `fetched_at` | Yes | **Production, direct.** MCP only for research |
| PL match and event data (API-Football; or the sportsdata-mcp `premierleague.com` provider) | Yes (API-Football) | Yes | Yes, fixtures are immutable after full time | Yes | Yes | Yes | **API-Football direct.** Do not use the `premierleague.com` private-API provider |
| OpenF1 | Yes | Yes | Yes (2023 onward, Unverified) | Yes | Yes | Yes | Not relevant to football. Pattern reference only |
| Jolpica | Yes, within 500 an hour | Yes | Yes (1950 onward) | Yes | Yes | Yes | Not relevant. Its published rate-limit doc is a model to copy |
| Football-Data.co.uk | Yes (weekly) | Yes | Yes (PL from 1993/94; referee from about 2000/01, Unverified) | Yes, files are versioned by season | Yes | Yes | **Technically ideal, licence-limited.** The terms exclude commercial and automated/AI use. Do not enable it via MCP. Decide production use in Phase 0 |

---

## Recommended data architecture

### A. Claude Code and MCP-assisted development (optional, local only)

```
Developer laptop / Claude Code session
  ├─ sportsdata-mcp (pinned v0.33.0, stdio, local process)
  │     SPORTSDATA_MCP_GROUPS="fpl.players,fpl.fixtures,fpl.reference"
  │     (+ "apisports" with a separate free-tier dev key, PLBookings research only)
  ├─ GameweekEdge MCP (https://gameweekedge.co.uk/api/mcp, read-only)
  └─ Repository files (read) → proposals → PRs reviewed by a human
```

Rules:

- MCPs answer questions, explore fields and draft code. They never write to production data stores and never run in CI.
- Use a **separate API-Football key** for research so exploration cannot consume the production quota.
- Anything learned through an MCP gets re-implemented as a direct, tested call in the ingestion layer.

### B. Production data pipeline (both apps)

```
        ┌───────────── Upstream APIs (direct HTTPS, server-side only) ─────────────┐
        │ FPL API · football-data.org · API-Football · vaastav · Core-Insights     │
        └───────────────────────────────┬──────────────────────────────────────────┘
                                        │ scheduled jobs (GitHub Actions + Netlify scheduled functions)
                                        ▼
  1. RAW LAYER       compressed JSON per call: {source, endpoint, params, fetched_at, http_status, sha256, body}
                     → Supabase Storage bucket `raw/<source>/<yyyy>/<mm>/<dd>/<endpoint>-<hhmm>.json.gz`
                     → raw_fetch_log row (freshness + provenance)
                                        │ normalise (idempotent, keyed by provider IDs)
                                        ▼
  2. NORMALISED      Supabase Postgres tables from the schema proposal
                     (fixtures, match_events, lineups, fpl_player_gw, referee_assignments, ...)
                                        │ derive (versioned code, model_version + input hash)
                                        ▼
  3. DERIVED         team/player/referee discipline metrics, FPL projections, price/ownership deltas
                                        │ publish
                                        ▼
  4. SERVING         committed JSON/JS bundles (current pattern) + Netlify edge cache
                     each bundle carries {built_at, sources[], coverage, model_version}
                                        ▼
  5. APP             reads only the serving layer and its own /api proxies; shows freshness pills
```

#### Why this shape

- It **keeps what already works.** Committed snapshots served from the CDN mean the site still renders when every upstream API is down.
- It **adds what is missing**: an immutable raw archive (for backtests and audits) and a normalised store (for history queries that do not fit in a static file).
- Supabase is already in both stacks, so there is no new vendor.
- Storage cost: compressed daily FPL `bootstrap-static` is roughly 0.3 to 0.5 MB, about 150 MB a season (estimate, validate). API-Football payloads are similar in scale. This fits comfortably within Supabase's paid storage tiers. Prune intraday snapshots after each season and keep one a day.

#### Scheduled refresh by data type

| Data | Source | Off-match days | Match days | During matches |
|---|---|---|---|---|
| FPL bootstrap (prices, ownership, availability) | FPL | Every 6 hours + 02:15 UK after price changes | Hourly | Hourly |
| FPL raw archive snapshot | FPL | Once daily at 02:15 UK (after price changes) and once pre-deadline | Same | n/a |
| FPL fixtures and events | FPL | Every 6 hours | Every 30 minutes | 2 minutes (`event-status`, live) |
| FPL live points | FPL | n/a | n/a | 1 to 2 minutes, `no-store`, never archived intraday; archive final at +3 hours |
| PL / league fixtures | API-Football | 2 times a day | 7 times (current) | `/fixtures?live=` at 60 s TTL |
| Card events, stats, fixture players | API-Football | Once for any fixture finished in the last 48 hours | After full time + next morning re-pull | Live ticker only |
| Line-ups | API-Football | n/a | Hourly from T-90 minutes | n/a |
| Injuries / sidelined | API-Football | Daily | 4 times a day | n/a |
| Referee appointments | Official announcement overlay | Daily | Daily | n/a |
| Referee history | football-data.co.uk or API-Football | Weekly | Weekly | n/a |
| Season player statistics | API-Football `/players` | Daily | Daily | n/a |
| History (vaastav) | GitHub | Weekly | Weekly | n/a |

#### Cache strategy

- **Edge** (existing): `max-age=300, stale-while-revalidate=600` for slow-changing FPL data. `no-store` for live and per-manager endpoints. Keep the PLBookings 60 s TTL for live cards.
- **Immutability-aware TTLs** (borrowed from F1 tooling): a finished fixture's events, statistics and line-ups never change after a 48-hour settlement window. Fetch them once, mark them `settled=true`, and never re-request. This alone removes most repeat API-Football calls.
- **Client**: keep the existing localStorage caches with a refresh floor. Never cache a failed response, which GameweekEdge already gets right (`index.html` around lines 3800-3806).

#### Rate-limit and failure handling

1. **One HTTP client per repo.** Promote GameweekEdge's `netlify/lib/enrichment/http.js` pattern (timeout, bounded retry, full-jitter backoff, Retry-After cap) to every server-side fetch. Port the same semantics to PLBookings' Python `_get`.
2. **Budget guard.** Keep PLBookings' `check-api-budget.mjs`. Add the same for any keyed source in GameweekEdge (football-data.org).
3. **Circuit breaker.** After 3 consecutive failures for a source, skip it for that run, log `status=open`, and serve the last good snapshot.
4. **Shape validation before publish.** Extend GameweekEdge's REACHABLE / SHAPED / FRESH grading to PLBookings. A payload that fails its shape check never overwrites the last good file.
5. **Never fail closed on the page.** The app reads the serving bundle. If it is stale beyond a threshold, show a stale pill; never a blank panel.

#### Observability and freshness indicators

- **Freshness log.** Every job writes a `data_source_freshness_log` row: source, endpoint, started, finished, status, rows, bytes, quota used, error.
- **A single status page per app** (`/status` or a panel) lists each source with last success, age and an OK / Stale / Down state. It reads the latest serving bundle's `sources[]` block, so it works with no database call.
- **Thresholds**:
  - FPL bootstrap: stale after 3 hours.
  - Fixtures: stale after 12 hours.
  - Card events: stale if a fixture finished more than 24 hours ago with no events row.
  - Referee appointments: "Unconfirmed" until a sourced row exists.
- **Alerts.** The existing daily `freshness.yml` (GameweekEdge) and `live-check.yml` (PLBookings) open a GitHub issue on a Stale or Down result. No paid monitoring needed.

#### Core entity model

See `sports-data-schema-proposal.md`. The core spine is:

```
competition → season → fixture → (lineup, match_event, team_match_stats, player_match_stats, referee_assignment)
team, player, referee (with provider ID crosswalks)
fpl_player ↔ player (crosswalk) → fpl_player_gameweek, fpl_snapshot
derived_* metrics keyed by (entity, window, as_of, metric_version)
data_source_freshness_log, raw_fetch_log
```

#### Historical snapshots for backtesting

- Archive raw payloads **as fetched**, with `fetched_at`. Backtests then read "what was known at time T", which prevents look-ahead. GameweekEdge already applies this principle by dropping vaastav's `xP` column.
- Derived metrics store `as_of`, `window`, `metric_version` and `input_hash`. Re-running a calculation on the same inputs must give the same number. Add a test that does exactly this.
- Pre-deadline pick ledgers (GameweekEdge `data/record/`) and pre-match prediction rows (PLBookings `plb_match_predictions`) stay append-only.

#### Surviving upstream outages

| Failure | Behaviour |
|---|---|
| FPL API down | Serve the last bootstrap snapshot. Show "Data from HH:MM". Disable live-only panels with a message |
| API-Football quota hit or 5xx | Workflow leg continues on error. Last committed bundle stays. Freshness log records it. The budget guard prevents this on schedule |
| Referee appointment missing | Price with referee factor 1.0 and show "Referee not yet confirmed", which is already the silent behaviour. Make it visible |
| Source changes shape | Shape check fails. Publish is skipped. An issue is raised |
| Supabase down | Static bundles still serve. Only account features degrade |

#### Labelling coverage and confidence honestly

Every chart and table gets a small footer:

`Source: API-Football · Fetched 01 Oct 2026 07:15 UTC · Coverage: 50 of 50 PL fixtures with events · Sample: 9 matches`

- Add a **confidence badge** driven by sample size:
  - Low: fewer than 5 matches or fewer than 450 minutes.
  - Medium: 5 to 14 matches.
  - High: 15 or more matches.
- Badges apply to players, teams and referees alike, with thresholds tuned per metric in the schema doc.
- Where a value is shrunk towards a prior, say so: "Adjusted towards the league average because of a small sample."

### Patterns worth borrowing from F1 tooling

F1 is out of scope for both apps. Three engineering patterns from the F1 ecosystem transfer directly:

1. **FastF1's persistent on-disk cache**, keyed by request. Cached responses do not count against rate limits (Official snippet, FastF1 docs). Apply it to your harvesters so a re-run of a failed workflow costs zero API calls.
2. **f1mcp's age-aware TTLs.** Past seasons are kept indefinitely; the current season expires after 10 minutes (Verified (official), README). This is the same as the "settled fixture" rule above.
3. **Jolpica's published, explicit rate-limit contract** (4 requests a second burst, 500 an hour; Verified (official), `docs/rate_limits.md`). Write the same for your own public endpoints (`/api/mcp`, `/api/fpl`) so third-party callers cannot drain upstream quotas through you.

---

## GameweekEdge feature roadmap

Ordered by value over effort. Full detail lives in `sports-data-backlog.csv`. Paid provider: none of these items needs one.

| # | Feature | Required data fields | Source | Complexity | Value | Data-confidence caveats |
|---|---|---|---|---|---|---|
| 1 | Daily FPL snapshot archive and freshness log | Full `bootstrap-static`, `fixtures`, `fetched_at` | FPL API | Low | High | Enabler. Without it, price and ownership trends cannot be backtested |
| 2 | Explainable recommendation cards (transfers and captaincy) | `xP`, `ep_next`, fixtures, `chance_of_playing_next_round`, `expected_goals`, `expected_assists`, minutes, source timestamps | FPL API + own model | Medium | High | Show evidence, caveats and "data as of". Never present projections as certainties |
| 3 | Minutes and availability risk signal | `status`, `chance_of_playing_*`, `news`, `news_added`, `starts`, `minutes`, `scout_risks` | FPL API | Medium | High | FPL news lags press conferences. Rotation is inherently uncertain |
| 4 | Captaincy comparison with spread, not just mean | `xP` distribution (`pointsDist`), fixture, home/away, penalties order, EO | FPL API + own model | Low (mostly built) | High | Effective ownership is estimated without full-population data |
| 5 | Price-change and ownership-movement context | `cost_change_event`, `transfers_in_event`, `transfers_out_event`, `selected_by_percent`, `price_change_percent`, hourly `price_flow` | FPL API + archive | Low | Medium | FPL's algorithm is unpublished. Label "FPL's own figure" vs "our estimate" (already done) |
| 6 | Fixture-run planner with selectable windows | `fixtures`, team strength, Dixon-Coles ratings, blanks/doubles | FPL API + PL Simulator bundle | Low (mostly built) | Medium | Fixture difficulty is a model output. Show the method |
| 7 | Transfer comparison and shortlists | Player fields, price, xP over N gameweeks | FPL API | Low (mostly built) | Medium | Same as item 2 |
| 8 | Form, points and value trends over time | Per-GW points, minutes, xG, xA, price history | FPL `element-summary` + archive | Medium | Medium | Small windows are noisy. Show the sample size |
| 9 | Deadline and live-status strip | `events.deadline_time`, `event-status`, `bonus` status | FPL API | Low | Medium | Bonus is provisional until confirmed |
| 10 | Align MCP `fpl_price_predictions` with the app's price source | `price_change_percent` | FPL API | Low | Medium | Prevents two different answers to the same question |
| 11 | Set-piece and penalty duty context | `*_order`, `penalties_text`, team set-piece notes | FPL API | Low | Medium | Editorial and irregular. Show the "last updated" date |
| 12 | Backtest view of projections vs outcomes | Archived projections + actual points | Own ledger + FPL live | Medium | Medium | Needs several gameweeks before it means anything |

Derived metrics for these features (calculation concept and limitations) are defined in `sports-data-schema-proposal.md`, section "Derived metric catalogue".

---

## PLBookings roadmap

Every item works within the existing API-Football Pro subscription. None needs an additional paid provider.

| # | Feature | Required data fields | Source | Complexity | Value | Data-confidence caveats |
|---|---|---|---|---|---|---|
| 1 | Replace the ScoutingStats PL form base with API-Football | `/players`: games.minutes, cards.yellow, cards.red, fouls.committed, fouls.drawn, position | API-Football | Medium | High | Validate parity on 2025/26 before switching. Expect small rate shifts |
| 2 | Honest provenance panel and per-chart source footers | Source list, `fetched_at`, coverage counts | Freshness log | Low | High | Must include API-Football, Plsimulator and the appointment overlay. Remove or explain the odds harvest |
| 3 | Referee discipline profiles | Referee ID, matches, yellows, reds, fouls, home/away split, season | API-Football fixtures + statistics; football-data.co.uk history (licence permitting) | Medium | High | Referees officiate 15 to 25 PL games a season. Shrink towards the league mean and show n |
| 4 | Card timing distribution | `match_event.minute`, `extra_minute`, type | `/fixtures/events` | Low | High | Stoppage time compresses into 45+ and 90+. Bins must say so |
| 5 | Match-level card event timeline | Events, substitutions, score state | `/fixtures/events` | Low | Medium | Settled fixtures only. Live events can be revised |
| 6 | Team and player booking dashboards with selectable windows (last 5 / 10 / season) | Per-match cards, minutes, opponent, venue | `/fixtures/players`, `/fixtures/statistics` | Medium | High | Use per-90 rates with minutes exposure. Flag samples under 450 minutes |
| 7 | Foul-to-card conversion | Fouls committed, yellows, by player, team and referee | `/fixtures/players`, `/fixtures/statistics` | Low | Medium | Foul counts differ between data providers. Do not mix providers in one ratio |
| 8 | Home/away splits | Venue flag on every match row | Fixtures | Low | Medium | Halves the sample. Show n and the confidence badge |
| 9 | Suspension watch | Season yellow count, league thresholds, matches remaining before the gate | API-Football + FPL `yellow_cards` (PL) | Low (mostly built) | High | Cup cautions and Regulatory Commission referrals are not modelled. Say so |
| 10 | Opponent and match-state context | Opponent foul rate, derby flag, Dixon-Coles result share | Own data + Plsimulator | Medium | Medium | Context, not cause. Keep multipliers clamped (already done) |
| 11 | Backtest view with sample-size guards | Pre-match predictions, outcomes, reliability bins, Brier | `plb_match_predictions` | Medium | Medium | The current PL backtest (302 predictions, 5 rounds) cannot separate models. Show intervals and never claim an edge |
| 12 | Probability-style signals | All of the above | Own model | n/a (exists) | Medium | Keep only where calibration holds. The PL fit currently does not beat baseline, so present the prior-based number with its calibration chart |
| 13 | Referee appointment provenance | Referee, fixture, source URL, captured_at, confidence | Official announcement overlay | Low | High | Recording the exact source URL is currently missing for several rows |

---

## Risks, licensing and responsible-use notes

### Licensing (highest risk)

| Source | Stated terms | Risk to you | Action |
|---|---|---|---|
| FPL API | No official documentation or API terms found. premierleague.com terms allow "private and personal use" and forbid commercial use and database creation from site material (Verified (official)) | GameweekEdge charges subscriptions. Its core depends on this API. This is common across the FPL tool market but not formally licensed | Record a decision in `docs/decisions` with your risk acceptance. Do not redistribute raw FPL data in bulk (e.g. as downloads). Keep attribution. Seek advice if revenue grows |
| football-data.co.uk | "Private individuals only, not for commercial or data training products using automated bots/scrapers/AI" (Official snippet) | PLBookings fetches it automatically. Commercial status is unclear (no Stripe found in the repo) | Phase 0: confirm PLBookings' commercial status and email the site owner for written permission. If refused, rebuild referee history from API-Football |
| API-Football | Use in your own apps is allowed. Reselling is prohibited. **No licence to publish is granted**; rights sit with leagues (Official snippet) | Displaying derived statistics is the intended use case. Bulk re-export would breach terms | Never offer raw API-Football data as a download. Show derived metrics with attribution |
| premierleague.com news pages (referee appointments) | Site terms forbid automated database creation (Verified (official)) | `fetch_appointments.py` renders and parses these pages with Playwright | Phase 0: decide whether to keep. Safer: capture manually from the official announcement with the URL recorded, or wait for API-Football coverage to return |
| ScoutingStats | Private, cookie-authenticated API | Highest. Bypasses an access control (Cloudflare clearance) | Retire in Phase 1 |
| vaastav, epldata | MIT | Low | Keep attribution |
| FPL-Core-Insights | "Used with attribution" | Low | Keep the link |
| football-data.org | Free tier: 12 competitions, 10 calls a minute; no bookings on free (Official snippet) | Low | Keep as GameweekEdge secondary only |

### MCP security

- **Bet placement.** sportsdata-mcp ships real-money betting tools. A misconfigured group setting would put them in Claude's tool list. Pin the version, set groups explicitly, and add a test (see `mcp-setup-recommendation.md`) that fails if any tool name contains `place_bet`, `account`, `deposit` or `withdraw`.
- **Tool overload.** More than 800 tools would crowd the context and degrade tool choice. Keep each session under about 30 tools from third-party MCPs.
- **Key leakage.** MCP config files often live in home directories. Use a dev-only API-Football key with its own quota. Never reuse the production key.
- **Your own MCP** at `/api/mcp` is public and unauthenticated. It fans out to FPL on each cold start, protected only by a 5-minute memo. Add per-IP rate limiting and publish a limit, as Jolpica does.

### Responsible use for PLBookings

PLBookings already does more than most products in this space: 18+ marking, BeGambleAware, GamCare and the helpline on every page and share card, enforced by guards. Remaining gaps:

1. **The app frames itself as research but ships betting mechanics**: fair odds, an edge %, a stake/P&L tracker and recommended accas with "priced" odds. The repo's own analysis records the accas' expected return as −17p to −27p in the pound (`docs/referee-sourcing.md`). Recommendation: remove "value check" and "edge" language, or show the negative expected return next to every acca, and keep the tracker as an outcomes log, not a P&L tool.
2. **No age confirmation** before betting-adjacent views. Add a one-time 18+ acknowledgement on `/accas` and the tracker.
3. **Calibration honesty.** The PL fitted model does not beat baseline. Any probability shown must carry its calibration evidence and sample size. Never use the words "lock", "banker", "guaranteed" or "value bet". Add these to `check-copy`-style guards (GameweekEdge already has `scripts/check-copy.mjs`).
4. **Odds harvest.** Either remove the `/odds` harvest or update the "no bookmaker data" claim. Today they contradict each other.

### Data-quality risks

- Referee samples are small. A referee with 8 games and 32 yellows looks extreme on raw rate but is within normal variation. Always shrink and show n.
- Provider foul definitions differ. Do not compare API-Football fouls with football-data.co.uk fouls in the same metric.
- Second yellows: confirm how API-Football encodes them (a red with detail "Second Yellow card" is expected; validate), so they are not double-counted.
- Name joins across providers fail silently. PLBookings already refuses surname-only matches. Formalise this with the crosswalk tables in the schema proposal.

---

## Phased implementation plan

### Phase 0: validate sources and coverage (1 to 2 weeks, no code changes to the apps)

1. Confirm PLBookings' commercial status (ads, affiliates or paid tiers planned?). This decides the football-data.co.uk question.
2. Email football-data.co.uk for written permission covering PLBookings' use, or plan the API-Football rebuild.
3. On the API-Football dashboard, confirm:
   - how many historical PL seasons the Pro plan returns;
   - the exact second-yellow encoding in `/fixtures/events`;
   - whether the PL `referee` field has returned since 6 September 2026.
4. Record a written risk decision on the FPL API and on premierleague.com appointment pages in each repo's `docs/decisions`.
5. Run a parity check: ScoutingStats vs API-Football `/players` for 2025/26 PL yellows, fouls and minutes per player. Accept if 95% of players match within one card and 5% of minutes.
6. If you want MCP research, verify the sportsdata-mcp v0.33.0 group names on a throwaway machine and run the checklist in `mcp-setup-recommendation.md`.

### Phase 1: quick wins using existing data (2 to 3 weeks)

- **PLBookings:**
  - Move the PL form base to API-Football.
  - Retire `SS_COOKIE`.
  - Correct the Sources panel and README.
  - Add per-chart source footers.
  - Surface "Referee not yet confirmed".
  - Add card timing distribution and match timelines from the existing `*_cardevents.js`.
- **GameweekEdge:**
  - Align `fpl_price_predictions` with `price_change_percent`.
  - Add a per-IP limit to `/api/mcp`.
  - Add source and time footers to the transfer and captain cards.
  - Fix the doc drift (FEATURES.md bootstrap TTL, LICENSES.md commit pin).
- **Both:** add missing SQL files for tables used in code, so the schema is reproducible.

### Phase 2: reliable ingestion, caching and historical snapshots (4 to 6 weeks)

- Create the raw-archive bucket and the `raw_fetch_log` and `data_source_freshness_log` tables in each Supabase project.
- Add a shared HTTP client with retry, Retry-After, a circuit breaker and shape validation. Use JS in GameweekEdge and Python in PLBookings.
- GameweekEdge: daily `bootstrap-static` archive at 02:15 UK and pre-deadline.
- PLBookings: "settled fixture" rule; events, statistics and line-ups fetched once after the 48-hour window.
- Normalised tables for fixtures, match events, line-ups, referee assignments and FPL player gameweeks.
- A status panel per app reading `sources[]` from the serving bundle.

### Phase 3: advanced analytics and backtesting (6 to 10 weeks, after one month of archive)

- GameweekEdge:
  - Minutes and availability risk signal.
  - Ownership and price movement trends.
  - Projection-vs-outcome backtest view.
- PLBookings:
  - Referee profiles with shrinkage and confidence badges.
  - Foul-to-card conversion.
  - Selectable trend windows.
  - Home/away splits.
  - Backtest view with reliability bins and intervals.
- Deterministic recompute test: the same inputs must give the same derived metrics.

### Phase 4: optional MCP-assisted developer workflows

- sportsdata-mcp, pinned, with FPL groups only. Optionally add `apisports` on a dev key.
- Keep using the GameweekEdge MCP for model QA prompts.
- Optionally expose a read-only PLBookings MCP (referee profiles, suspension watch) using GameweekEdge's hand-written JSON-RPC layer, once Phase 3 metrics exist.
- Review MCP configuration each quarter. Remove anything unused for 60 days.

---

## Exact next actions

1. **PLBookings:** run the ScoutingStats vs API-Football `/players` parity check on 2025/26 PL data, then switch the PL form base and delete `SS_COOKIE` from the workflow secrets.
2. **PLBookings:** decide on football-data.co.uk by confirming commercial status and requesting written permission. Record the answer in `docs/decisions.md`.
3. **PLBookings:** decide the referee-appointment source. Either keep the premierleague.com parse with a recorded risk acceptance, or switch to a manual official-source overlay with source URLs.
4. **PLBookings:** correct the Sources panel and README (API-Football, Plsimulator, appointment overlay, the odds harvest) and add per-chart source footers.
5. **GameweekEdge:** change MCP `fpl_price_predictions` to use `price_change_percent`, and add a per-IP rate limit to `/api/mcp`.
6. **Both:** commit SQL files for every Supabase table used in code.
7. **Both:** create `data_source_freshness_log` and write one row from every scheduled job.
8. **GameweekEdge:** start the daily compressed `bootstrap-static` and `fixtures` archive (02:15 UK and pre-deadline).
9. **PLBookings:** add the "settled fixture" rule so finished fixtures' events, statistics and line-ups are fetched once.
10. **PLBookings:** soften betting mechanics: remove "edge"/"value" wording, show negative expected return on accas, and add an 18+ acknowledgement on `/accas` and the tracker.
11. **Both:** add source, fetched time, coverage and a sample-size confidence badge to every chart and table.
12. **Optional:** set up sportsdata-mcp locally using `mcp-setup-recommendation.md`, only after actions 1 to 4 are done.

# Sports Data Source Inventory

Prepared 1 October 2026. Covers GameweekEdge (GWE) and PLBookings (PLB). Companion to `sports-mcp-assessment.md`.

## How to read this inventory

### Status

| Value | Meaning |
|---|---|
| **In use** | Called by production code or a scheduled job |
| **Probe only** | Called by a manual probe script, not by production |
| **Proposed** | Recommended by the assessment |
| **Retire** | In use today, recommended for removal |
| **Rejected** | Considered and declined, with reason |

### Evidence

| Value | Meaning |
|---|---|
| **Repo** | Verified in the repository |
| **Official** | Verified on the provider's page |
| **Snippet** | Seen as an official-domain search excerpt; page blocked here |
| **Validate** | Unverified; check before relying on it |

### Ownership

Ownership names the team member accountable for the integration. Each repo has a single owner today, so "Owner" means the repository maintainer. Assign a named person when the team grows.

Secrets are listed by variable **name** only.

---

## Summary table

| # | Source | Products | Status | Auth | Paid | Single source of truth for |
|---|---|---|---|---|---|---|
| 1 | Official FPL API | GWE, PLB | In use | None | No | FPL players, prices, ownership, gameweeks, PL availability |
| 2 | API-Football v3 (api-sports) | PLB | In use | `API_FOOTBALL_KEY` | Yes (Pro) | Fixtures, card events, line-ups, match and player statistics, injuries |
| 3 | football-data.org v4 | GWE (PLB probe) | In use / Probe only | `FOOTBALL_DATA_KEY` (GWE), `FOOTBALL_DATA_TOKEN` (PLB) | No (free tier) | GWE fixture status cross-check, head-to-head |
| 4 | football-data.co.uk CSVs | PLB | In use, licence to validate | None | No | Historical referee, fouls and cards (pending licence) |
| 5 | DataHub football-datasets mirror | PLB | In use | None | No | Mirror of item 4 |
| 6 | vaastav/Fantasy-Premier-League | GWE | In use | None | No | FPL history 10 seasons |
| 7 | FPL-Core-Insights (GitHub) | GWE, PLB | In use | None | No | Supplementary per-match stats, cup fixtures, Club Elo |
| 8 | epldata | PLB | In use (frozen) | None | No | Referee careers 1992/93 to 2017/18 |
| 9 | Fantasy EFL JSON | GWE | In use | None | No | Fantasy EFL game |
| 10 | PL Simulator bundle (sister project) | GWE, PLB | In use | None | No | Dixon-Coles ratings, chase factor |
| 11 | premierleague.com CDN images | GWE, PLB | In use | None | No | Badges and photos |
| 12 | premierleague.com news pages (referee appointments) | PLB | In use, risk to decide | None | No | PL referee appointments (since 6 September 2026) |
| 13 | efl.com, rfef.es, aia-figc.it appointment pages | PLB | In use | None | No | EFLC, La Liga and Serie A appointments |
| 14 | ScoutingStats (Sportmonks-backed) | PLB | **Retire** | `SS_COOKIE`, `SS_USER_AGENT` | n/a | Nothing after retirement |
| 15 | openfootball | PLB | Cited | None | No | Naming reference |
| 16 | Anthropic API | GWE, PLB | In use | `ANTHROPIC_API_KEY` | Yes | AI scout and insight text (not data) |
| 17 | mcclowes/fpl-oas | GWE | In use (tests) | None | No | FPL contract test spec |
| 18 | Optional enrichment adapters (LetLetMe, FPL GraphQL, Apify, World News) | GWE | Off by default | Various | Some | None |
| 19 | Supabase | GWE, PLB | In use | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes | Own predictions, users, push state; proposed raw archive and normalised store |
| 20 | Own raw snapshot archive | GWE, PLB | **Proposed** | Supabase service role | Storage cost | Historical FPL and match snapshots |
| 21 | Own freshness log | GWE, PLB | **Proposed** | Supabase service role | No | Data provenance and status |
| 22 | sportsdata-mcp | Developer only | **Proposed (optional)** | Per group | No | Nothing (research interface) |
| 23 | GameweekEdge MCP (`/api/mcp`) | Developer and public | In use | None | No | Nothing (presents own model) |
| 24 | Sports Hub MCP | n/a | Deferred | Per provider | No | n/a |
| 25 | API-Football community MCPs | n/a | Deferred | `API_FOOTBALL_KEY` | n/a | n/a |
| 26 | SportScore API / MCP | n/a | Rejected | None | No | n/a |
| 27 | OpenF1, Jolpica, FastF1 | n/a | Out of scope | None | No | n/a |
| 28 | Understat, FBref, WhoScored, FootyStats, Transfermarkt | n/a | Rejected | n/a | n/a | n/a |
| 29 | Pulselive / SDP site APIs | GWE probe | Rejected | None | n/a | n/a |
| 30 | The Odds API and bookmaker odds | n/a | Rejected | n/a | n/a | n/a |
| 31 | API-Football `/odds` and `/predictions` harvest | PLB | **Retire or disclose** | `API_FOOTBALL_KEY` | Included | Nothing (outputs empty, unused) |

---

## Source details

### 1. Official FPL API

| Field | Detail |
|---|---|
| Purpose | GWE: all core FPL decision support. PLB: PL availability, live yellow counts, push alerts |
| Ownership | Owner (both repos) |
| Base URL | `https://fantasy.premierleague.com/api/` |
| Endpoints (Repo) | `bootstrap-static`, `fixtures`, `event-status`, `event/{gw}/live`, `element-summary/{id}`, `entry/{id}`, `entry/{id}/history`, `entry/{id}/transfers`, `entry/{id}/event/{gw}/picks`, `dream-team/{gw}`, `team/set-piece-notes`, `leagues-classic/{id}/standings`, `leagues-h2h/*` |
| Auth | None. Browser-like User-Agent from the proxy |
| Called from | GWE `netlify/functions/fpl.js` (allow-list lines 11-29), `mcp.js`, `log-predictions.js`, `push-cron.js`, `push-live.js`, scripts. PLB `netlify/functions/fpl.js`, `push-cron.js`, `data/harvest_history.py`, `data/harvest_fpl_squads.py` |
| Update frequency | Edge `max-age=300, swr=600`. Live endpoints `no-store`. GWE client 3 min to 6 h. PLB client 30 min |
| Coverage | Current season only. No history of prices or ownership |
| Rate limits | None published (Validate). Community clients report 429s under load |
| Licence and attribution | No API terms found. premierleague.com terms restrict commercial use and database creation (Official). Treat as tolerated, not licensed |
| Fallback | Last good localStorage cache, then the committed snapshot (`data/tool-pages.json` GWE; baked dataset PLB). Proposed: the daily raw archive |

### 2. API-Football v3 (api-sports.io)

| Field | Detail |
|---|---|
| Purpose | PLB primary for every desk: fixtures, referees (non-PL), events, line-ups, fixture and player statistics, injuries, standings |
| Ownership | Owner (PLB) |
| Base URL | `https://v3.football.api-sports.io/` (or the RapidAPI mirror via `API_FOOTBALL_HOST`) |
| Auth | Header `x-apisports-key` from `API_FOOTBALL_KEY`. Season via `API_FOOTBALL_SEASON` |
| Plan | Pro, 7,500 calls a day (Repo, `data/api_budget.py` line 47). Pro is about $19 a month (Snippet) |
| Update frequency | Daily 04:10; fixtures 7 times a day; extra feeds 4 times a day; line-ups hourly on match days; live 60 s TTL |
| Coverage | PL, EFLC, La Liga, Serie A, Segunda, Serie B, League One. **PL referee field empty since 6 September 2026** (Repo). Historical depth on Pro: Validate |
| Rate limits | Daily quota resets 00:00 UTC; free plan 10 a minute (Snippet). Repo guard ceiling 5,000 a day. About 13% used |
| Retry | 0.25 s pacing. 4 retries at 15/30/45/60 s on rate-limit bodies. 401/403/429 exit with message |
| Licence and attribution | Use in your own apps allowed. No resale. **No licence to publish**; rights sit with leagues (Snippet, `api-sports.io/terms`). Attribute "Data: API-Football" |
| Fallback | Workflow legs `continue-on-error`; the last committed file stays. Proposed: circuit breaker and freshness log |

### 3. football-data.org v4

| Field | Detail |
|---|---|
| Purpose | GWE: fixture status, cross-competition windows, team info, head-to-head. PLB: probe only |
| Ownership | Owner (GWE) |
| Auth | Header `X-Auth-Token` from `FOOTBALL_DATA_KEY` (GWE) or `FOOTBALL_DATA_TOKEN` (PLB) |
| Update frequency | Edge TTL 1,800 s (matchday) to 86,400 s (teams, H2H) |
| Coverage | Free tier: 12 competitions incl. PL, CL, ELC. **No bookings or line-ups on free** (Snippet). Deep Data at €29 a month adds them |
| Rate limits | 10 calls a minute site-wide on free. The edge cache is the limiter (Repo, `football-data.js` lines 18-32) |
| Licence | Free tier for any use per pricing page (Validate the usage policy page) |
| Fallback | Client returns null; panels hide. FPL fixtures stay authoritative |

### 4. football-data.co.uk season CSVs

| Field | Detail |
|---|---|
| Purpose | PLB referee card and foul rates; historical team cards and fouls |
| Ownership | Owner (PLB) |
| URL | `https://www.football-data.co.uk/mmz4281/{season}/{div}.csv` |
| Auth | None |
| Update frequency | Daily job; upstream updates roughly twice a week in season (Validate) |
| Coverage | PL from 1993/94; referee and match statistics from about 2000/01 (Validate). Columns: Referee, HF/AF, HY/AY, HR/AR, shots, corners, odds |
| Rate limits | None published |
| Licence | "Private individuals only, not for commercial or data training products using automated bots/scrapers/AI" (Snippet, `disclaimer.php`). **Material restriction** |
| Fallback | DataHub mirror (item 5). Long-term fallback: rebuild referee history from API-Football fixtures and statistics |

### 5. DataHub football-datasets mirror

| Field | Detail |
|---|---|
| Purpose | Primary fetch path for PL CSVs in PLB |
| URL | `raw.githubusercontent.com/datasets/football-datasets` |
| Licence | PDDL is stated by PLB (Repo). The mirror's licence does not override item 4's terms on the underlying data (Validate) |
| Fallback | football-data.co.uk origin |

### 6. vaastav/Fantasy-Premier-League

| Field | Detail |
|---|---|
| Purpose | GWE 10-season FPL history and walk-forward backtest |
| Auth | None |
| Update frequency | Weekly (`history.yml`, Tuesdays 04:00 UTC) |
| Coverage | 2016/17 onward, per-GW player rows |
| Licence | MIT. Attribute |
| Notes | `xP` column dropped to avoid look-ahead (Repo, `docs/HISTORY.md`) |
| Fallback | Committed `data/fpl-history.json` |

### 7. FPL-Core-Insights

| Field | Detail |
|---|---|
| Purpose | GWE per-match supplementary stats, cup and European fixtures, Club Elo. PLB foul data (currently stale: "0 rounds, vendored 2026-08-13") |
| URL | `raw.githubusercontent.com/olbauday/FPL-Core-Insights/main` |
| Update frequency | GWE twice daily (06:30, 17:30 UTC) |
| Licence | "Used with attribution" (Repo) |
| Fallback | Best-effort. The app runs without it. PLB: replace with API-Football `/fixtures/players` fouls |

### 8. epldata

Frozen MIT snapshot of referee careers 1992/93 to 2017/18 (PLB `data/build_ref_history.py`). No refresh needed. Attribute.

### 9. Fantasy EFL JSON

GWE `netlify/functions/efl.js`. `fantasy.efl.com/json/fantasy` squads, players and rounds. No auth. TTL 900 to 3,600 s. Terms: Validate. Fallback: labelled sample dataset via `?provider=sample`.

### 10. PL Simulator bundle

Sister project at `plsimulation.netlify.app/model.json`. Dixon-Coles ratings, odds-style outputs, planner windows. Owner-controlled. Weekly for PLB; 6-hour client cache for GWE. Staleness warning after 45 days (PLB) and a season-staleness flag (GWE).

### 11. premierleague.com CDN images

Badges and photos from `resources.premierleague.com`, through a host-allow-listed proxy in GWE (`img.js`, 7-day cache). Terms: site terms apply (Official). Fallback: colour tiles.

### 12. premierleague.com news pages (PL referee appointments)

| Field | Detail |
|---|---|
| Purpose | PLB PL referee appointments, after API-Football stopped carrying them |
| Method | Playwright render and text parse of "match-officials-for-matchweek-N" (`data/fetch_appointments.py`, `scripts/render-page.mjs`) |
| Update frequency | 7 times a day via `fixtures.yml` |
| Coverage | PGMOL appoints about 3 to 5 days ahead |
| Licence | Site terms forbid automated database creation (Official). **Risk decision required** |
| Fallback | Referee factor 1.0, silently. Proposed: show "Referee not yet confirmed" |
| Proposed change | Manual or assisted capture from the official announcement with the source URL recorded, or a recorded risk acceptance |

### 13. Other appointment publishers

efl.com (rendered), rfef.es PDF probing with `pdftotext`, aia-figc.it news. Same risk category as item 12; record a decision per publisher. GWE separately decided on 13 August 2026 not to scrape efl.com (Repo, `docs/scope-referee-source.md`). The two repos currently take different positions.

### 14. ScoutingStats (RETIRE)

| Field | Detail |
|---|---|
| Purpose | PLB PL player form base (2025/26) |
| Auth | Logged-in browser cookie `SS_COOKIE`, including Cloudflare `cf_clearance`; optional `SS_USER_AGENT` |
| Risk | Bypasses an access control. Breaks when the cookie expires. Terms unclear |
| Replacement | API-Football `/players?league=39&season=…` (already used by every other desk) |
| Fallback during migration | Keep the last committed `pl_data.js` until parity is confirmed |

### 15 to 18. Smaller sources

- **openfootball:** CC0. Cited for naming; no fetch found in code.
- **Anthropic API:** produces AI text, not data. Daily caps `AI_DAILY_CAP` (PLB) and a quota table (GWE). Label AI output as such.
- **mcclowes/fpl-oas:** MIT OpenAPI spec vendored for the GWE contract test.
- **Optional enrichment adapters:** LetLetMe, unofficial FPL GraphQL, Apify Live Football, Apify FPL Intelligence, World News API. Off unless env vars are set. Unverified against live endpoints (Repo, `docs/ENRICHMENT.md`). Keep off for production unless each passes the Phase 0 checklist.

### 19. Supabase

Both apps. Predictions, users, push state, AI usage. Proposed new use: raw archive bucket, normalised tables and freshness log. Auth via `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` (server only) and publishable keys (client). Fallback: static bundles serve without it.

### 20. Own raw snapshot archive (PROPOSED)

| Field | Detail |
|---|---|
| Purpose | Immutable record of every upstream payload, for backtests, audits and recomputation |
| Storage | Supabase Storage `raw/<source>/<yyyy>/<mm>/<dd>/<endpoint>-<hhmm>.json.gz`, indexed by `raw_fetch_log` |
| Frequency | FPL daily at 02:15 UK and pre-deadline; API-Football once per settled fixture |
| Retention | Keep daily for ever; prune intraday after each season |
| Licence note | Private archive for your own analysis. Never publish raw payloads |

### 21. Own freshness log (PROPOSED)

`data_source_freshness_log` table and a `sources[]` block in every serving bundle. Feeds the status panel and chart footers. See the schema proposal.

### 22. sportsdata-mcp (PROPOSED, developer only)

Local stdio process, pinned to v0.33.0, with `SPORTSDATA_MCP_GROUPS` explicitly set. Research only. See `mcp-setup-recommendation.md`. Never a production dependency.

### 23. GameweekEdge MCP

Public, unauthenticated, read-only JSON-RPC at `https://gameweekedge.co.uk/api/mcp` with 7 tools. Proposed: per-IP rate limit, align the price tool with the app, publish a usage limit.

### 24 to 31. Deferred, rejected and retiring

| Source | Decision | Reason |
|---|---|---|
| Sports Hub MCP | Deferred | Read-only and well built, but no FPL and duplicates API-Football |
| API-Football community MCPs | Deferred | Duplicate of PLB's direct integration; no official MCP found |
| SportScore | Rejected | No documented card or referee fields; opt-out telemetry; attribution link; unclear operator; conflicting limits |
| OpenF1, Jolpica, FastF1 | Out of scope | F1 only. Borrow caching and rate-limit patterns |
| Understat, FBref, WhoScored, FootyStats, Transfermarkt | Rejected | Scraping, terms, 403s; FBref lost its Opta licence in January 2026 (Repo, `docs/SEASON_RESEARCH_2026-08.md`) |
| Pulselive / SDP | Rejected | Undocumented site APIs. "A 200 means reachable, not permitted" (Repo, GWE `docs/data-sources.md`) |
| The Odds API, bookmaker odds | Rejected | No free football tier; conflicts with research framing |
| API-Football `/odds` and `/predictions` harvest | Retire or disclose | Outputs are empty and unused, yet contradict the "no bookmaker data" claim |

# Sports Data Schema Proposal

Prepared 1 October 2026 for GameweekEdge and PLBookings. Companion to `sports-mcp-assessment.md`.

The schema is database-neutral. Types are logical:

| Type | Meaning |
|---|---|
| `id` | Surrogate key; UUID or bigint |
| `text`, `int`, `decimal`, `bool` | As usual |
| `ts` | Timestamp with time zone, always UTC |
| `date` | Calendar date |
| `json` | Semi-structured payload |

It maps cleanly onto Supabase Postgres, which both apps already use. Serving bundles (the committed JSON/JS files) remain the read path for the apps. These tables are the system of record behind them.

## Design rules

1. **Three layers:**
   - **Raw** payloads are immutable and live in object storage, indexed by `raw_fetch_log`.
   - **Normalised** entities are the tables below.
   - **Derived** metrics are the `derived_*` tables.
   - User-facing insight text is generated from derived rows only, never from raw rows.
2. **Provider IDs are kept, never trusted as global IDs.** Every entity has its own `id` plus a crosswalk table (`external_id`) mapping `(provider, provider_id)` to it. This replaces fragile name joins.
3. **Every normalised row carries provenance:** `source`, `source_fetch_id` (pointing to `raw_fetch_log`) and `ingested_at`.
4. **Every derived row carries reproducibility fields:** `as_of`, `window_spec`, `metric_version` and `input_hash`. The same inputs and version must give the same value.
5. **Point-in-time correctness.** Anything that changes over time (prices, availability, referee appointments) is stored as dated versions, not overwritten. Backtests read "as known at T".
6. **Upserts are idempotent**, keyed on natural keys listed per table.

---

## Reference entities

### competitions

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| code | text | Internal code, e.g. `PL`, `ELC`, `LL`, `SA` |
| name | text | |
| country | text | |
| tier | int | 1 = top flight |
| suspension_rules | json | Caution ladder and gates, e.g. PL 5/10/15 with gates at matches 19 and 32 |

Natural key: `code`.

### seasons

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| competition_id | id | FK competitions |
| label | text | `2026-27` |
| start_date, end_date | date | |
| is_current | bool | |

Natural key: `(competition_id, label)`.

### teams

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| name, short_name | text | |
| country | text | |
| venue_name | text | |

### players

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| full_name, known_as | text | |
| birth_date | date | Disambiguates name collisions |
| nationality | text | |
| primary_position | text | `GK`, `DEF`, `MID`, `FWD` |

### team_season_players (squad membership over time)

| Column | Type | Notes |
|---|---|---|
| team_id, player_id, season_id | id | |
| shirt_number | int | |
| valid_from, valid_to | date | Handles transfers and loans mid-season |

### referees

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| full_name | text | |
| known_as | text | |
| association | text | `PGMOL`, `EFL`, `RFEF`, `AIA` |

### external_id (crosswalk)

| Column | Type | Notes |
|---|---|---|
| entity_type | text | `team`, `player`, `referee`, `fixture`, `competition` |
| entity_id | id | Our ID |
| provider | text | `fpl`, `api_football`, `football_data_org`, `football_data_co_uk`, `vaastav` |
| provider_id | text | Provider's ID or exact name string |
| match_method | text | `id`, `exact_name`, `name_plus_dob`, `manual` |
| confidence | text | `high`, `medium`, `low` |
| verified_by | text | Person or script |
| created_at | ts | |

Natural key: `(provider, entity_type, provider_id)`.

PLBookings' existing rule (never join on surname alone) becomes a constraint: `match_method` cannot be `surname`.

---

## Match entities

### fixtures

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| season_id | id | FK |
| round | text | Matchweek or round label |
| fpl_event | int | FPL gameweek, null outside the PL |
| kickoff_utc | ts | |
| home_team_id, away_team_id | id | FK teams |
| status | text | `scheduled`, `postponed`, `live`, `finished`, `abandoned` |
| home_goals, away_goals | int | Null until finished |
| venue | text | |
| is_derby | bool | From the curated derby list |
| settled | bool | True 48 h after full time; settled fixtures are never re-fetched |
| settled_at | ts | |
| source, source_fetch_id, ingested_at | | Provenance |

### lineups

| Column | Type | Notes |
|---|---|---|
| fixture_id, team_id, player_id | id | |
| is_starter | bool | |
| position | text | As published |
| formation_slot | text | Grid position if supplied |
| minutes_played | int | Filled after full time |
| sub_on_minute, sub_off_minute | int | |
| confirmed_at | ts | When the XI was published |
| source, source_fetch_id | | |

Natural key: `(fixture_id, player_id)`.

### match_events

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| fixture_id | id | FK |
| team_id, player_id | id | `player_id` nullable (bench or staff cards) |
| related_player_id | id | Assist, or player replaced in a substitution |
| event_type | text | `yellow`, `second_yellow`, `red`, `goal`, `own_goal`, `penalty_goal`, `penalty_miss`, `sub`, `var` |
| minute | int | `time.elapsed` |
| extra_minute | int | `time.extra`; 90+4 is minute 90, extra 4 |
| period | text | `1H`, `2H`, `ET`, `PEN` |
| score_home_before, score_away_before | int | Game state at the moment of the event |
| is_bench | bool | Card shown to a non-playing squad member |
| provider_detail | text | Raw detail string, e.g. `Yellow Card` |
| source, source_fetch_id | | |

Natural key: `(fixture_id, event_type, player_id, minute, extra_minute)`.

Second yellows must map to `second_yellow` and not also to `yellow` plus `red`. Validate API-Football's encoding in Phase 0.

### team_match_stats

| Column | Type | Notes |
|---|---|---|
| fixture_id, team_id | id | |
| fouls | int | |
| yellow_cards, red_cards | int | |
| shots, shots_on_target | int | |
| possession_pct | decimal | |
| corners | int | |
| source | text | Never mix providers in one derived ratio |

### player_match_stats

| Column | Type | Notes |
|---|---|---|
| fixture_id, player_id, team_id | id | |
| minutes | int | |
| fouls_committed, fouls_drawn | int | |
| yellow_cards, red_cards | int | |
| position | text | |
| rating | decimal | Provider rating; display only, never a model input |
| source | text | |

### referee_assignments

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| fixture_id, referee_id | id | |
| role | text | `referee`, `var`, `assistant_1`, `assistant_2`, `fourth` |
| announced_at | ts | When it was published |
| captured_at | ts | When we recorded it |
| source_type | text | `api_football`, `official_announcement`, `manual` |
| source_url | text | **Required** for `official_announcement` and `manual` |
| confidence | text | `confirmed`, `reported`, `inferred` |
| superseded_by | id | Re-appointments create a new row |

Version rows, never overwrite.

### player_availability

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| player_id | id | |
| status | text | `available`, `doubtful`, `injured`, `suspended`, `unavailable`, `unknown` |
| chance_next_round | int | FPL 0/25/50/75/100 where available |
| reason | text | Provider text, capped at 400 characters (GWE rule) |
| expected_return | date | If stated |
| valid_from, valid_to | ts | Open-ended `valid_to` = current |
| source | text | `fpl`, `api_football_injuries`, `api_football_sidelined`, `suspension_engine` |
| source_fetch_id | id | |

---

## FPL entities

### fpl_players

| Column | Type | Notes |
|---|---|---|
| fpl_element_id | int | Per-season FPL ID |
| season_id | id | |
| player_id | id | Crosswalk to `players` |
| team_id | id | |
| element_type | int | 1 GK, 2 DEF, 3 MID, 4 FWD |
| web_name | text | |
| penalties_order, direct_freekicks_order, corners_and_indirect_freekicks_order | int | |

Natural key: `(season_id, fpl_element_id)`.

### fpl_gameweeks

| Column | Type | Notes |
|---|---|---|
| season_id | id | |
| event | int | 1 to 38 |
| deadline_utc | ts | |
| is_current, is_next, finished, data_checked | bool | |
| average_score, highest_score | int | |
| chip_plays | json | |

### fpl_player_gameweek

One row per player per gameweek per fixture (doubles produce two rows).

| Column | Type | Notes |
|---|---|---|
| season_id, event, fpl_element_id, fixture_id | | |
| minutes, total_points, bonus, bps | int | |
| goals_scored, assists, clean_sheets, goals_conceded, saves | int | |
| yellow_cards, red_cards | int | |
| expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded | decimal | |
| defensive_contribution | int | |
| value_at_gw | int | Price in tenths |
| selected, transfers_in, transfers_out | int | |
| source | text | `fpl_live` or `vaastav` |

### fpl_snapshots (historical snapshots)

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| season_id | id | |
| captured_at | ts | |
| trigger | text | `daily_0215`, `pre_deadline`, `post_gw` |
| event_current | int | |
| raw_fetch_id | id | Points at the archived payload |
| player_count | int | Shape check |

### fpl_player_snapshot

Slim, queryable columns extracted from each snapshot. The full payload stays in the raw archive.

| Column | Type | Notes |
|---|---|---|
| snapshot_id, fpl_element_id | | |
| now_cost | int | |
| selected_by_percent | decimal | |
| transfers_in_event, transfers_out_event | int | |
| status | text | |
| chance_of_playing_next_round | int | |
| news | text | |
| ep_next | decimal | |
| form | decimal | |
| price_change_percent | decimal | |

---

## Derived discipline metrics

### derived_team_discipline

| Column | Type | Notes |
|---|---|---|
| team_id, season_id | id | |
| as_of | ts | |
| window_spec | text | `last5`, `last10`, `season`, `home_season`, `away_season` |
| matches | int | Sample size |
| yellows_per_match, reds_per_match | decimal | |
| fouls_per_match | decimal | |
| foul_to_card_rate | decimal | |
| opp_yellows_per_match | decimal | Cards drawn from opponents |
| shrunk_yellows_per_match | decimal | |
| confidence | text | |
| metric_version, input_hash | text | |

### derived_player_discipline

| Column | Type | Notes |
|---|---|---|
| player_id, season_id | id | |
| as_of | ts | |
| window_spec | text | |
| minutes, starts | int | Exposure |
| yellows, reds, fouls_committed, fouls_drawn | int | |
| yellows_per90 | decimal | |
| shrunk_yellows_per90 | decimal | |
| fouls_per90 | decimal | |
| foul_to_card_rate | decimal | |
| cautions_to_next_ban | int | |
| matches_to_gate | int | |
| confidence | text | |
| metric_version, input_hash | text | |

### derived_referee_metrics

| Column | Type | Notes |
|---|---|---|
| referee_id | id | |
| competition_id | id | |
| window_spec | text | `season`, `last3seasons`, `career` |
| as_of | ts | |
| matches | int | |
| yellows_per_match, reds_per_match | decimal | |
| fouls_per_match | decimal | |
| cards_per_foul | decimal | |
| home_yellow_share | decimal | |
| shrunk_yellows_per_match | decimal | |
| referee_factor | decimal | Clamped |
| confidence | text | |
| metric_version, input_hash | text | |

### derived_fpl_player_metrics (GameweekEdge)

| Column | Type | Notes |
|---|---|---|
| fpl_element_id, season_id, as_of | | |
| xp_next, xp_next5 | decimal | |
| minutes_risk | decimal | |
| availability_flag | text | |
| price_delta_7d | int | |
| ownership_delta_7d | decimal | |
| form_points_per90_last5 | decimal | |
| value_points_per_million | decimal | |
| confidence | text | |
| metric_version, input_hash | text | |

---

## Operational tables

### raw_fetch_log

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| source | text | |
| endpoint | text | |
| params | json | |
| started_at, finished_at | ts | |
| http_status | int | |
| bytes | int | |
| sha256 | text | Of the stored body |
| storage_path | text | Object-storage key |
| quota_remaining | int | From provider headers where sent |
| job_name | text | Workflow or function name |
| git_sha | text | Code version that fetched it |

### data_source_freshness_log

| Column | Type | Notes |
|---|---|---|
| id | id | PK |
| source | text | |
| dataset | text | e.g. `pl_fixtures`, `fpl_bootstrap` |
| run_started_at, run_finished_at | ts | |
| status | text | `ok`, `partial`, `stale_served`, `failed`, `circuit_open` |
| rows_written | int | |
| coverage_note | text | e.g. "50 of 50 finished fixtures have events" |
| error | text | Truncated, no secrets |
| last_success_at | ts | Carried forward |

---

## Derived metric catalogue

Every metric shown to users must appear here with its calculation concept and main limitations.

| Metric | Calculation concept | Main limitations |
|---|---|---|
| **yellows_per90** (player) | `yellows / minutes × 90` over the window | Unstable under about 450 minutes. Ignores who the referee was and game state |
| **shrunk_yellows_per90** | Empirical-Bayes shrinkage: `(yellows + k × prior_per90) / (minutes/90 + k)`, prior = position mean per 90 for the league, k = 6 full-match equivalents (PLBookings' current choice) | k is a judgement call. A new role (e.g. a midfielder moved to full-back) is shrunk towards the wrong prior |
| **fouls_per90** | `fouls_committed / minutes × 90` | Provider definitions of a foul differ. Use one provider per metric |
| **foul_to_card_rate** (player, team, referee) | `yellows / fouls_committed` over the window | Small denominators. Tactical fouls and dissent cards are not foul-driven, so the ratio understates card risk for some players |
| **cautions_to_next_ban** | Next threshold on the league ladder minus current season cautions, null after the gate date | Cup cautions, Regulatory Commission referrals and reds are not modelled. Rule text is from corroborated quotations, not primary regulation for every league |
| **matches_to_gate** | League matches remaining before the next amnesty gate (e.g. PL matches 19 and 32) | Postponements shift gate timing |
| **yellows_per_match** (team) | Team yellows / matches | Driven by opponents and referees as much as by the team. Show alongside opponent and referee context |
| **opp_yellows_per_match** | Cards shown to opponents in this team's matches | Correlates with possession style. Not a causal "draws cards" measure |
| **referee yellows_per_match** | Referee's yellows / matches officiated in the window | 15 to 25 PL matches a season. Fixture mix (derbies, relegation games) biases it |
| **shrunk_yellows_per_match** (referee) | Shrink towards the league mean with k ≈ 10 matches | Under-reacts to a genuine change in a referee's style mid-season |
| **referee_factor** | Geometric blend of the referee's shrunk yellow-rate ratio and cards-per-foul ratio vs the league, clamped to 0.75 to 1.30 (current PLBookings method) | Clamp hides real extremes. Defaults to 1.0 when no appointment exists. That case must be shown to users |
| **home_yellow_share** | Home-team yellows / all yellows under the referee | Home advantage in cards is small and noisy. Needs multi-season windows |
| **card timing distribution** | Count of cards by 15-minute bin, with 45+ and 90+ as separate bins | Stoppage minutes vary per match. Bins are not equal in length |
| **P(player booked)** | `1 − exp(−λ)`, `λ = shrunk_y90 × expected_minutes/90 × referee × venue × derby × opponent × chase`, each multiplier clamped | A multiplicative model assumes independence. The PL backtest (302 predictions) cannot distinguish it from a simple baseline. Always show calibration evidence |
| **expected team cards** | Sum of player λ over the likely XI plus a bench and staff allowance | Line-up uncertainty before T-60 minutes. The PL model is about 8% conservative vs observed (3.5 vs 3.76) |
| **xp_next / xp_next5** (FPL) | Existing GameweekEdge model: Dixon-Coles team goals × player share of xG/xA × minutes probability, blended with FPL `ep_next` | Returns null under 5 games. MODEL_REVIEW.md flags double-counted minutes and GK saves. Projections are not outcomes |
| **minutes_risk** | `1 − P(starts)`, from recent starts, `chance_of_playing_next_round`, news recency and rotation history | FPL news lags press conferences. Managers rotate unpredictably. Present as a band, not a number |
| **price_delta_7d / ownership_delta_7d** | Difference between today's and the snapshot 7 days earlier | Needs the archive. FPL's price algorithm is unpublished |
| **form_points_per90_last5** | FPL points per 90 over the last 5 appearances | Bonus-heavy and noisy. Five games is a small sample |
| **value_points_per_million** | Season points / (now_cost / 10) | Rewards cheap bench players with few minutes. Filter by minutes |
| **calibration (Brier, reliability bins)** | Mean squared error of predicted probabilities vs outcomes, and observed rate per 10% bin | Needs hundreds of predictions per bin. Show counts per bin and confidence intervals |

### Confidence badge thresholds (default)

| Entity | Low | Medium | High |
|---|---|---|---|
| Player | Under 450 minutes or under 5 appearances | 450 to 1,349 minutes | 1,350 minutes or more |
| Team | Under 5 matches | 5 to 14 | 15 or more |
| Referee | Under 8 matches | 8 to 19 | 20 or more |
| Calibration bin | Under 50 predictions | 50 to 199 | 200 or more |

---

## Mapping to current files

| Current file | Proposed home |
|---|---|
| PLB `data/*_fixtures.js` | `fixtures` + `referee_assignments` (serving bundle unchanged) |
| PLB `data/*_cardevents.js`, `*_bookings.js` | `match_events`, `player_match_stats` |
| PLB `data/*_fxstats.js` | `team_match_stats` |
| PLB `data/appointments.json` | `referee_assignments` with `source_url` |
| PLB `data/ref_history.js` | `derived_referee_metrics` (window `career`) |
| PLB `data/*_injuries.js` | `player_availability` |
| GWE `data/fpl-history.json` | `fpl_player_gameweek` (source `vaastav`) |
| GWE `gwedge_push_state.price_flow` | `fpl_player_snapshot` |
| GWE `data/record/gw-*.json` | Unchanged (append-only ledger); link via `fpl_snapshots` |

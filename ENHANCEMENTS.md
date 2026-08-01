# Enhancements from the repo portfolio

*Reviewed 2026-08-01, against `main` at `06a8c3c`. Sources: every repo under
`bamfs1976-art`, plus two external repos supplied for comparison
([Lamarssom/card-bookings-bot](https://github.com/Lamarssom/card-bookings-bot),
[Gavin-Roche/premier_league_statistics_analyzer](https://github.com/Gavin-Roche/premier_league_statistics_analyzer)).*

This file records what was taken from where, what was deliberately left, and
what is still open. `AUDIT.md` and `IMPLEMENTATION_NOTES.md` cover the earlier
2026-07-12 audit; this is the follow-on.

---

## The unmerged branches — read this before merging anything

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

## Correctness: the promoted clubs have never had a full squad

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

---

## Shipped in this branch

### Responsible gambling notice — from `cheltenhamtips`

`cheltenhamtips` carries BeGambleAware, GamCare, GamStop and the helpline in
its footer. This app carried only "stake responsibly". Now: an 18+ notice with
all four, in the footer, the sidebar legal line and both share-card renderers.
For a UK betting-research tool this is a compliance floor, not a nicety.

### Stale-client guard on pick sync — from `f1gridmasters`

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

### Team card markets — from `wcstats` and `card-bookings-bot`

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
| Expected cards per match | **4.10** | ~4.0–4.3 |
| O4.5 on an average fixture | 42–47% | broadly market range |
| Both teams carded | 74–82% | ~75–80% |
| Away vs home expected | 2.59 vs 1.91 | away bias, correct direction |

Independence is the honest limit — cards cluster, so the far tails run thin.
Stated in the Guide rather than fudged. 14 new unit tests.

Contrast fix alongside it: `--danger` / `--warn` are badge fills and only
reach ~2.9:1 as small text. `--danger-ink` / `--warn-ink` / `--good-ink` are
added for text on a light surface. The strip clears WCAG 2.2 AA in both
themes, lowest measured 4.95:1.

### Player notes — from `wcstats`

A free-text note per player on the profile, stored beside the watchlist,
debounced, capped at 500 characters, cleared when blank. A starred player
without the reason you starred him is half a note.

### Calendar export — from `sportsfinder-uk`

An RFC 5545 `.ics` for a player's next fixture carrying booking heat, the
assigned referee and the player you are watching, with a one-hour alarm. A
`data:` URL, so no server and it works offline.

### Acca builder — merged from `app-comparison-consolidation`

Same-match double/treble on the match share card, cross-match on the gameweek
card.

---

## Still open, in priority order

### 1. Fix the promoted-club data (blocked on a key)

See above. Needs `SS_COOKIE` or an API-Football key. Everything else in the
desk is downstream of this being right.

### 2. Port the rest of the forecast-branch model

The minutes weighting landed. The rest has not:

```
lambda  = yellows/90 (blended, shrunk) x expected minutes/90
          x referee factor x venue factor x derby factor
P(card) = 1 - exp(-lambda)
```

`main` maps a risk score through a logistic curve. The hazard form handles
minutes explicitly and composes the match factors multiplicatively, which is
the more defensible structure. Also on that branch and worth taking: blending
current season with last season capped at 900 minutes of evidence, confirmed
lineups near kick-off, and freezing forecasts before kick-off so they are
scored honestly afterwards.

### 3. Head-to-head card history — from `card-bookings-bot`

Average cards in past meetings between the two clubs, plus an O/U 4.5 call
from history to sit beside the model's number. Computable from the
football-data.co.uk records **already downloaded** for the referee build
(`data/build_refs.py`), so it needs no new source and no key. Cheapest real
signal still on the table.

### 4. Web push — from `gameweek-edge`

Deferred in `IMPLEMENTATION_NOTES.md` as needing server infrastructure. It
exists: `push-key`, `push-subscribe`, `push-unsubscribe`, `push-cron`, VAPID
keys, subscriptions in Supabase under service-role RLS, same project and
account model. The two alerts that justify it are *referee appointment
published for a watchlisted player* and *one card from a ban*.

Needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

### 5. Game-state and close-game factors — from `Plsimulator`

The forecast branch defines the integration point and nothing feeds it. Export
per-fixture win probabilities to `pipeline/sources/sim_predictions.json` and a
10% underdog prices up to ×1.20 on cards.

Better still, the simulator produces a full scoreline grid, so
**P(one-goal game)** is available — a fitted closeness signal that should
replace the hardcoded `DERBIES` list as the primary heat input. Cards follow
tight matches, not just historic rivalries.

Also worth taking: its walk-forward backtest scores against **market closing
odds** (RPS 0.2068 vs the market's 0.1994). The desk's calibration loop scores
against a base rate, which is a much easier benchmark.

### 6. Charts

There is one sparkline in the entire app and no other visualisation.
`Gavin-Roche/premier_league_statistics_analyzer` is a small Plotly study of
exactly this data. Three that would earn their space: a club × referee card
heatmap, the reliability curve the calibration loop already computes as a
table, and per-player card form.

### 7. Table virtualisation

All Players renders every registered player across 20 clubs from the live
feed. No virtualisation, and the season table historically truncated at 400
rows. It will get slow in season.

### 8. Broadcaster line and onboarding

Both from `sportsfinder-uk`. The broadcaster rights table is a maintained JSON
map of fixture → channel, which is real ongoing work rather than a code
change, so it is listed rather than started. The three-step onboarding wizard
(pick your clubs and players) would seed the watchlist — today a new user
lands on an empty card.

### 9. Platform patterns from `gameweek-edge`

- The capability registry (`GAMES` / `NAV` with `needs:`) — panels that need
  live data would disappear pre-season instead of showing zeros.
- One `ai.js` with per-task prompts, Haiku for volume and Sonnet for chat,
  cached per gameweek. The desk has one AI feature; this is how it gets four.
- Stripe free/Pro tiering if the desk should ever earn.
- A twice-daily server aggregation into Supabase (the Core Insights pattern)
  is the route to fixing the fouls gap — FPL carries no fouls, so that half of
  the risk score is frozen on 2025-26 form all season.

---

## Deliberately not taken

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

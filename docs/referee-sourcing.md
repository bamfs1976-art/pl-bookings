# Referee sourcing, and refining the risk profiles matchday by matchday

Research note, August 2026. Two questions:

1. Where do we source **referee statistics** and **match allocations** so the
   app updates itself?
2. How do the **acca and booking risk profiles** get sharper as each matchday's
   data arrives?

**Short answer to (1): the pipeline already exists and mostly works. What is
missing is not a data source — it is a clock.** The harvester already reads the
appointed referee off API-Football and writes it into the fixture files. Nothing
ever runs it on a schedule, and the Premier League desk could not read the
result if it did. Those are the two fixes, and they are small.

**Short answer to (2): the loop is built but not closed.** Every settled acca
leg already records the model's probability next to what actually happened. That
is a calibration dataset accumulating in Supabase right now, and nothing reads
it. The model has never been fitted — it still ships `basis:"season-prior"`,
`fitRows: 0`.

> **What was and was not verified.** Everything about *this repository* below
> was measured against the committed code and the live database. The external
> endpoints were **not** reachable from the session this note was written in —
> the agent proxy denies `footballapi.pulselive.com`, `www.efl.com`,
> `api-football.com`, `football-data.org` and the rest, so their exact response
> shapes are quoted from documentation and search, not from a call I made. CI is
> not so restricted: the refresh workflow already calls API-Football
> successfully. Anything marked ⚠️ needs one CI run to confirm before it is
> built on.

---

## 1. What the app does today

| Piece | State |
|---|---|
| Referee **statistics** | Solved, free, no key. `data/build_refs.py` reads football-data.co.uk match records. 22 PL, 30 EFLC, 27 LL officials with y/g, fouls/g, cards-per-foul. |
| Referee **allocations** | **Not solved.** All 380 PL, 552 EFLC and 380 LL fixtures carry `ref: null`. |
| Refresh **cadence** | **Manual only.** `data-refresh.yml` is `workflow_dispatch` with no `cron:`. |
| PL desk **reads** allocations | **No.** `index.html` never references `PL_FIXTURES`. |
| EFLC / LL desks read allocations | Yes — `fx.ref` → `refByName` → `{appointed: true}`. |

### Finding A — the fixture harvester already does the hard part

`harvest_apifootball.py` line 452 onward:

```python
ref = (fx.get("referee") or "").strip() or None
if ref:
    ref = ref.split(",")[0].strip()   # "Tim Robinson, England" → "Tim Robinson"
```

It parses the appointment, strips the country suffix API-Football appends,
and emits it per fixture. The referee-join proved this field is real: **380 of
380** La Liga matches of the completed 2025-26 season joined an official.

So the data is there for *finished* matches. The open question is lead time on
*upcoming* ones — see Finding C.

### Finding B — the Premier League desk cannot use an appointment

This is the one that surprised me. `index.html`:

```js
function refFor(fid){ const n = refAssign[SEASON+"|"+fid]; return n ? refByName(n) : null; }
```

`refAssign` is the **manual dropdown**, saved to `localStorage`. `PL_FIXTURES`
appears in `data-frame.html` and `scripts/accas.mjs` — and nowhere in
`index.html`. The Championship and La Liga desks read `fx.ref` and show an
"appointed" pill; the flagship desk has no automatic path at all and never had.

Every fixture the PL desk prices without a hand-picked referee is priced at
`refFactor = 1`. That is the whole referee layer switched off by default, on the
one league whose referee data is best.

### Finding C — lead times decide the cadence, and La Liga decides it for us

| League | Who publishes | Lead time | Confidence |
|---|---|---|---|
| Premier League | PGMOL, via premierleague.com "Match officials for Matchweek N" | Typically the Monday/Tuesday before a weekend round (~3–5 days) | Medium — the pattern is visible across the 2025-26 matchweek articles; PGMOL publishes no stated policy I could find |
| EFL Championship | EFL, `efl.com/match-officials` | Comparable, a few days | ⚠️ Low — page not reachable from here |
| La Liga | RFEF's arbitration committee (CTA/CACP) | **One day before kick-off, by 16:00** — a deliberate 2025-26 rule change to reduce pressure on officials | Medium-high — widely reported, consistent across sources |

**The Spanish rule is the binding constraint.** A weekly refresh can never carry
a La Liga appointment. Even a daily job at the wrong hour misses it. This is why
our fixture files show 0 appointments today: they were harvested on 6 August,
and the earliest fixture is 14 August — eight days out, before any of the three
leagues has appointed anyone. That is expected, not a bug.

---

## 2. Recommendation for allocations

### Do this first — it is nearly free

**Put the fixture harvest on a cron and let the PL desk read it.**

1. Add a scheduled job that runs `harvest_apifootball.py --fixtures` for all
   three leagues **twice daily** (~07:00 and ~17:00 UTC). The 17:00 run is
   there specifically to catch the Spanish 16:00 publication; the morning run
   catches PGMOL and the EFL.
2. Commit only when a `ref` actually changed, so the repo does not churn.
3. Teach `index.html` to seed `refAssign` from `PL_FIXTURES[].ref` — the
   harvested appointment as the default, the dropdown still able to override it.
   Keep the override: an appointment can change, and a desk that cannot be
   corrected is worse than one that must be.

Cost: **zero extra API quota beyond what the refresh already spends** — one
`/fixtures` call returns a whole season. Three leagues × 2 runs/day ≈ 6
calls/day against a key we already pay for.

This alone turns the referee layer on for every fixture in all three leagues,
with no new supplier and no new secret.

### Then consider a second source, for cross-checking only

A single unverified supplier for a number that moves every price is a
single point of failure. Options, best first:

| Source | Refs stats | Allocations | Cost | Verdict |
|---|---|---|---|---|
| **football-data.co.uk** (in use) | Yes, and free/public domain | No — historical only | Free | Keep. It is the statistics backbone and owes us nothing. |
| **API-Football** (in use) | Derivable from events | Yes, once published | Paid, key held | Keep. Make it the primary allocation source. |
| **premierleague.com / pulselive** | Some | Yes, PL only, with assistants + VAR | Free, undocumented | ⚠️ Worth probing as a PL cross-check. Undocumented endpoints can vanish; never make it primary. |
| **football-data.org v4** | `referees` array on matches | Partial | Free tier: 12 comps, 10 calls/min | ⚠️ Free tier reportedly thin on match detail. Probe before committing. |
| **Sportmonks** | Rich, dedicated referee endpoints | Yes | Paid, ~€40+/mo | Only if the referee layer becomes the product. Overkill now. |
| Aggregators (FootyStats, OddAlerts, RefOdds, PlayerStats) | Yes | Some | Mixed | Several are themselves built on API-Football. Paying a reseller for our own supplier's data is the wrong direction. |
| Scraping Transfermarkt / FBref | Yes | Some | "Free" | **No.** Both restrict automated access; FBref has tightened hard. Not worth the legal and breakage risk for a number we can get properly. |

**Recommendation: API-Football primary, on a twice-daily cron. Probe pulselive
as a PL-only cross-check. Do not add a paid supplier yet.**

A cross-check is only worth building once there is something to check — i.e.
after the cron has been running and we can see how often, and how early,
appointments actually land. That measurement is the next step, not a guess now.

### The one guard this needs

An appointment arriving **after** an acca has been logged changes that acca's
true probability but must **not** change the logged prediction. `accas.mjs`
already refuses to rewrite an existing acca, and that must stay. The right
behaviour is to record the referee-at-time-of-prediction alongside it, so a
later analysis can separate "the model was wrong" from "the model was priced
without a referee". Today we cannot tell those apart.

---

## 3. Refining the risk profiles as data accumulates

### What already sharpens, and what does not

| Layer | Updates matchday to matchday? |
|---|---|
| Player card rates | Only when the refresh is run by hand. |
| Referee y/g, fouls/g | Same — and only from *last* season's completed records. |
| Suspension counts | Yes, via the season-cards harvest. |
| **Model parameters** | **Never.** `basis: "season-prior"`, `fitRows: 0`. |
| **Calibration** | **Never measured** against outcomes. |

The model is an honest, well-documented *prior* — `docs/modelling-review.md` is
explicit that `basis:"season-prior"` is "not an empirical fit". It has been that
since it shipped. Shrinkage is fixed at `k = 6` matches, the GLM slope at 1.1,
the weights `{yc90: 2.2, foul90: 1.1}` hand-set with position terms at zero.

### The loop that is built but not closed

`plb_acca_legs` stores, per leg: `prob` (what the model said) and `carded` (what
happened). Twelve rows today. That is a calibration dataset, and nothing reads it.

`plb_predictions` already exists with exactly the right shape — `season, gw,
element, name, club, pcard, carded, logged_at` — and has **zero rows**. It was
created and never wired up.

**The gap is volume.** Acca legs alone give ~3 legs × 4 accas × ~40 matchdays ≈
**460 rows a season**. Logging the top ~8 candidates per fixture instead gives
roughly **10,000 a season** across the three leagues. The first number cannot
calibrate anything; the second can. The players are there — 568 PL, 932 EFLC,
770 LL with a usable rate.

### The ladder, cheapest and most valuable first

**Rung 1 — log every candidate, not just the ones we bet.** Extend the hourly
acca job to write the matchday's top candidates per fixture into
`plb_predictions` before kick-off, and settle them with the same
`wasBooked()` the accas already use. Needs a `league` column added (the table is
PL-shaped today, with `element` being an FPL id). This is the single highest-value
change and it buys the next three rungs.

**Rung 2 — measure calibration before changing anything.** `PLDCore` already has
`brier`, `logLoss` and `reliability`. Publish, per league: predicted vs observed
in probability bands. If the model says 25% and the true rate is 25%, the prices
are honest and the negative edge is real. If it says 25% and the truth is 18%,
**every acca has been overpriced and the tracked losses are the model's fault,
not variance.** We currently cannot tell which, and it is the most important
unanswered question about the whole desk.

**Rung 3 — refit shrinkage on evidence.** `k = 6` is a guess. With a season of
logged outcomes it becomes a fitted number, and it is likely different per
league and per position.

**Rung 4 — in-season rates, decayed.** `recencyDecay: 0.97` is in the model and
unused. Blend last season's rate with this season's as matches accrue, weighting
recent matches more. This is what "gets sharper each matchday" actually means in
practice, and it needs Rung 1's data to validate.

**Rung 5 — refit the GLM.** Only once `data/match_history.json` covers enough
matches. `scripts/build-model.mjs --fit` and `scripts/backtest.mjs` already
exist and walk forward properly. **Do not ship a refit that the backtest does
not beat the prior on.**

### Two things to be careful about

**Do not tune on the accas.** Three legs a matchday, chosen as the *highest*
probabilities, are a biased sample — the top of the distribution, where
shrinkage bites hardest. Fitting on them would bake that selection in. Rung 1
exists precisely so the calibration set is every candidate, not the picked ones.

**A model that gets better does not make the accas positive-EV.** The edge is
currently −17p to −27p in the pound, and about 6p of that per leg is the margin
we apply on purpose. Better calibration makes the *disclosure* honest. It does
not make the bet good, and the cards should keep saying so.

---

## 4. Suggested order of work

1. Cron the fixture harvest twice daily; commit only on change. *(small)*
2. PL desk seeds its referee from `PL_FIXTURES[].ref`, override retained. *(small)*
3. Record referee-at-prediction-time on logged accas. *(small)*
4. Add `league` to `plb_predictions`; log every candidate pre-kick-off; settle
   them with the existing `wasBooked()`. *(medium — unlocks everything below)*
5. Publish per-league calibration once ~500 settled predictions exist. *(medium)*
6. Then, and only then, refit shrinkage / decay / GLM against the backtest. *(large)*

Steps 1–3 are worth doing regardless of what the numbers say. Step 4 is the one
that makes the desk self-improving rather than static.

---

### Sources

Repository evidence: `data/harvest_apifootball.py`, `data/build_refs.py`,
`data/*_fixtures.js` headers, `index.html` `refFor()`, `data-frame.html`,
`data/model.js`, `scripts/accas.mjs`, and the live `plb_*` tables.

External (not reachable from the authoring session; see the caveat at the top):
[PGMOL / Premier League referees](https://www.premierleague.com/en/referees) ·
[Match officials for Matchweek 38](https://www.premierleague.com/en/news/4658324/match-officials-for-matchweek-38) ·
[EFL Match Officials](https://www.efl.com/match-officials/) ·
[RFEF designaciones](https://rfef.es/es/federacion/arbitros/designaciones) ·
[Eurosport: designaciones published one day before, 2025-26](https://www.eurosport.es/futbol/la-liga/2025-2026/cambio-designaciones-arbitrales-un-dia-antes-previo-partido-primera-segunda-comite_sto23210561/story.shtml) ·
[API-Football documentation](https://www.api-football.com/documentation-v3) ·
[football-data.org coverage](https://www.football-data.org/coverage) ·
[Sportmonks referees endpoint](https://docs.sportmonks.com/football/endpoints-and-entities/endpoints/referees) ·
[RefOdds methodology (built on API-Football)](https://refstats.app/methodology/)

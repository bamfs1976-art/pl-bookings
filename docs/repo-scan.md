# What would actually elevate this app

Research note, August 2026. A scan of open data sources and repositories against
what the desks now do, ranked by what each would change rather than by novelty.

**The headline is that the most valuable thing available needs no new supplier
at all.** The app pays for API-Football and calls four of its endpoints. The one
it does not call is the one that would make the model fittable for two thirds of
the site.

> **Verified vs not.** Anything about *this repository* was measured against the
> committed code. External claims marked ✅ were checked by fetching the source;
> ⚠️ means the summary was thin or the host is blocked from this sandbox and it
> needs one run to confirm. Several hosts (`football-data.co.uk`,
> `api-football.com`) refuse the agent proxy, so their exact shapes are quoted,
> not observed.

---

## 1. The model is unfittable for two desks, and the fix is already paid for

**This is the finding worth acting on.**

`data/harvest_history.py` builds the training table from the **FPL
element-summary endpoint** — per-player, per-gameweek, leakage-free. It is
excellent, and it is Premier League only. FPL has no Championship or La Liga.

So `scripts/build-model.mjs --fit` can only ever be fitted on one division. The
shipped `basis: "season-prior"`, `fitRows: 0` is usually read as "not fitted
yet". For the Championship and La Liga it is stronger than that: **there is no
per-match training data at all, and no path to any, with the sources currently
wired.**

The endpoints the app calls today (`data/harvest_apifootball.py`):

| Endpoint | Used for |
|---|---|
| `/fixtures` | fixture list, and the referee appointment |
| `/players` | season aggregates per player |
| `/teams` | club registry discovery |
| `/status` | key check |

Missing: **`/fixtures/players`** — per-player statistics *for one fixture*,
including minutes, fouls committed and cards. ⚠️ Confirmed by documentation and
search rather than by a call, because `api-football.com` is blocked here; one CI
run settles it.

That single endpoint gives, for every league the desk covers:

- the per-match label (was he booked in this match)
- the per-match features (minutes actually played, fouls committed)
- built from the same records `wasBooked()` already settles accas against

**Cost.** One call per fixture. A full Championship season is 552 fixtures, La
Liga and the Premier League 380 each — about 1,300 calls to backfill a completed
season once, then roughly a dozen per matchday. The harvester documents the
whole existing job at ~75 calls against a 7,500/day allowance, so the backfill is
one afternoon's quota and the ongoing cost is noise.

**What it unlocks, in order:** a real fit for all three desks; per-match features
instead of season aggregates in `plb_card_predictions`; and a genuine answer to
whether `SHRINK_MATCHES = 6` and the hand-set GLM weights are right, which is
currently unanswerable outside the Premier League.

---

## 2. A design flaw in the calibration table, cheap now and expensive later

`plb_card_predictions` was created today, keyed `(season, league, fixture_id,
player)`. It records what the model forecast and what happened. **It does not
record which model made the forecast.**

The moment the model is refitted — which is the whole point of §1 — the table
will hold rows from two different models with nothing to separate them.
`model-calibration` pools everything in the current season, so the reliability
curve would silently mix a prior-based August with a fitted November and report
the average of two different things as one.

Fix: a `model_version` column, written from `data/model.js`'s own basis/hash, and
a `group by` in the reader. **Trivial while the table holds one matchday. Not
trivial once it holds twenty thousand rows nobody can attribute.**

This is my own omission from earlier today, and it is the kind that only gets
worse with time, so it belongs at the top of the list rather than buried.

---

## 3. Availability is wired but proves nothing

`inj` is populated from `/players`' `injured` flag — a season-aggregate snapshot,
frozen at harvest. Measured today: **true for 0 of 2,417 players across all three
leagues.** Plausible in pre-season, and indistinguishable from "not working".

API-Football has a dedicated **`/injuries`** endpoint, already flagged in
`docs/desk-parity.md` as the fix and never wired because it needed a key and a
schedule. Both now exist. With the daily cron running, this is a small change
that turns a strip which currently cannot say anything into one that can.

---

## 4. A correction: the closing-odds plan rests on a false premise

`docs/desk-parity.md` says football-data.co.uk's odds are *"free, already a
dependency, reachable from the runner"*.

The first half is wrong. ✅ The app reads the **GitHub mirror**,
`datasets/football-datasets`, and I fetched its header:

```
Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,Referee,
HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR
```

**No bookmaker columns at all.** The mirror is a reduced copy carrying match
stats only. The origin does carry 1X2, over/under 2.5 and Asian handicap
(⚠️ unverifiable from here — the host blocks the proxy), but using them means
adding a *second* source, not extending an existing one. Still cheap; just not
free in the way the plan assumed.

And it remains true that **no free source carries card-market odds anywhere**,
which is why the accas are priced at fair-odds-times-margin rather than against
a real book.

---

## 5. Sources scanned and rejected, with reasons

| Source | What it offers | Verdict |
|---|---|---|
| [datasets/football-datasets](https://github.com/datasets/football-datasets) | The football-data.co.uk mirror | **Already the backbone.** Referees, cards, fouls, 1993–present. Nothing new to take. |
| [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League) | ✅ Per-player per-gameweek FPL history, 2016-17 onward | Duplicates what `harvest_history.py` already pulls live, and **weekly updates stopped after 2024-25**. Useful only as a historical backfill for PL seasons before the app existed. |
| [statsbomb/open-data](https://github.com/statsbomb/open-data) | Event-level data, fouls and cards with the minute | ⚠️ Competition coverage not confirmed from the README, and it is overwhelmingly tournaments and historical seasons rather than current PL/EFLC/La Liga. Licence requires attribution and a PDF review. **Wrong shape for a weekly desk.** |
| [probberechts/soccerdata](https://github.com/probberechts/soccerdata) | ✅ Apache-2.0 scraper wrapping FBref, Understat, WhoScored, Sofascore, football-data.co.uk | FBref would give per-match cards and fouls for all three leagues — the same thing §1 gets. But it is scraping, its own README says *"in compliance with the terms of service of the websites you intend to scrape"*, and FBref has tightened hard. **Rejected: §1 gets the same data from a supplier we already pay.** |
| Aggregators (OddAlerts, FootyStats, RefOdds, PlayerStats) | Referee stats, some appointments | Several are themselves built on API-Football. Paying a reseller for our own supplier's data is backwards. |

**Nothing in the open-source landscape beats the endpoint already on the
account.** That is the useful conclusion of the scan, and it is worth stating
plainly rather than padding the list.

---

## 6. Interface: the data has outgrown the presentation

Two of these are new — they only became possible today.

**A reliability diagram.** ~20,000 forecasts a season are now accumulating, and
`/api/model-calibration` already returns `buckets` — predicted mean against
observed frequency per decile. The desk renders this as a **paragraph of prose**
with a Brier score in it. The reliability curve is the standard picture, it is
the single most credible thing a forecasting site can show, and the data is
already in the response. Small chart, large gain in trust.

**Per-league calibration is computed and not shown.** The reader returns
`byLeague`; only the aggregate is rendered. Three divisions with different card
cultures will calibrate differently, and that comparison is more interesting than
the average.

**The acca tracker has no chart.** Running P/L over time at a flat 50p is a
one-line sparkline and it is exactly what a record built to be checked should
lead with.

**Parity item 9 — account sync and watchlist — is the last open audit item**, and
the only gap a user would describe as a missing feature rather than a missing
number.

---

## Recommended order

1. **`model_version` on `plb_card_predictions`** — minutes now, painful later. *(§2)*
2. **`/fixtures/players` harvest**, backfill one completed season for all three
   leagues, and point `build-model.mjs --fit` at it. *(§1)*
3. **`/injuries`**, so the availability strip means something. *(§3)*
4. **Reliability diagram + per-league breakdown**, once ~500 graded rows exist —
   realistically late September. *(§6)*
5. Account sync / watchlist. *(§6)*
6. Closing odds, as a *new* source and only to answer the open "tight match"
   question in the Guide. *(§4)*

Items 1 and 2 are the ones that change what the app can know about itself.
Everything else is presentation or polish on top.

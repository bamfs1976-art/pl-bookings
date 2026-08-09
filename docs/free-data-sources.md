# Free data sources: what would actually improve the desks

Research note, August 2026. Asked: what other free APIs would enhance the app?

The answer is shorter than the question suggests, because most of what the
desks are missing is not available free from anyone — and the best free source
on the list is one this repository already downloads and reads three columns of.

> **What was and was not verified.** Nothing below was called. The agent proxy
> denies every external host — `api.football-data.org`, `open-meteo.com`,
> `thesportsdb.com`, `api.clubelo.com` and the rest — so quotas, licences and
> coverage are quoted from documentation and search, not from a request that
> returned. This is the same limitation `docs/referee-sourcing.md` was written
> under, and it produced one wrong conclusion there. Treat every claim here as
> a hypothesis with a citation. Anything load-bearing gets a probe in CI first,
> in the shape of `scripts/probe-football-data.mjs`.

---

## 1. The gaps, as this repository measures them

Not a wishlist — these are the holes recorded in `docs/referee-sourcing.md`,
`ENHANCEMENTS.md` and `AUDIT.md`, and they decide what a new source is worth.

| Gap | State |
|---|---|
| Championship and La Liga desks are static | `eflc.html` and `laliga.html` contain **no `fetch` call at all** |
| Availability | `inj` is **0 of 2,417 players**, all three leagues |
| Premier League photos | **117 of 660** |
| Referee allocations | One supplier (API-Football), no cross-check |
| Model context | Never fitted; no weather, no match-state, no travel terms |
| Market benchmark | Plsimulator benchmarks against **Premier League odds only** |

---

## 2. Worth doing, best first

### 2.1 football-data.co.uk — the odds columns we already download

**The cheapest thing on this list by a distance, and it is not a new supplier.**

`data/leagues.py` already builds the season URLs for `E0`, `E1` and `SP1`, and
`data/build_refs.py` already parses every row of those files for `Referee`,
`HY`/`AY`, `HR`/`AR` and `HF`/`AF`. The same rows carry bookmaker prices,
including Pinnacle closing 1x2 — the exact quantity `Plsimulator`'s
`tools/build_odds.py` currently goes to a third-party GitHub package to get,
**for the Premier League only**.

So a Championship and La Liga benchmark is available from a file already being
fetched and parsed. It costs a handful of extra column reads in an existing
loop, no new key, no new host, no new failure mode.

- Gap closed: market benchmark beyond the Premier League.
- Cost: near zero.
- Risk: near zero — same file, same parser, same cadence.

Do this one first regardless of what else is decided.

### 2.2 Open-Meteo — settle the weather question before paying for weather

`https://archive-api.open-meteo.com/v1/archive` · no key, no signup · archive
back to **1940** · 10,000 calls/day free for non-commercial use · data under
**CC BY 4.0**, attribution required.

This matters because of the branch it is being written on. The Xweather work is
about *forecast* endpoints, and Xweather's free tier explicitly gates its
archive behind a paid add-on. But the question that has to be answered first is
not "what will the weather be" — it is **"does weather predict cards at all?"**
That question can only be answered on history, and Open-Meteo gives the history
away.

The order that makes sense:

1. Backfill hourly temperature, precipitation and wind onto every match in
   `data/match_history.json`, joined on kick-off time and stadium coordinates.
2. Measure whether any of it moves the observed card rate once referee and
   team are controlled for. `scripts/backtest.mjs` already walks forward
   properly, so this is a feature column, not a new harness.
3. Buy a forecast feed **only if step 2 finds something**.

Doing it the other way round — wiring a live forecast into the desks and then
looking for the signal — is how the model acquires a parameter nobody can
justify. `docs/modelling-review.md` is already candid that the weights are
hand-set; this is a chance not to add another.

⚠️ **Licence caveat worth taking seriously.** The free tier is for
non-commercial use; the CC BY 4.0 grant covers the *data*, the free *service*
does not cover commercial deployment. A public site carrying betting content is
at best an argument. For a one-off historical backfill that runs in CI and
writes a committed CSV, this is a much easier call than for a live per-request
lookup on every page load — which is another reason to do the backfill first
and treat the live feed as a separate decision.

### 2.3 football-data.org v4 — keyed, probed, verdict pending

Covered in full in `docs/referee-sourcing.md` and by
`scripts/probe-football-data.mjs`. Restating only the part that belongs here:
its free tier is supposed to cover Premier League, Championship **and** La Liga,
which would make it the first free source spanning all three desks — and two of
them are photographs. That is the frozen-desk gap, and it is the largest one.

Nothing more should be built on it until the probe has run.

### 2.4 TheSportsDB — the photo gap, with a caveat about where photos go

Free tier, test key, ~30 requests/minute, crowd-sourced player images, club
badges and stadium art across hundreds of leagues.

117 of 660 Premier League photos is a visible hole, and this is the obvious
free filler. The caveat is that crowd-sourced means **coverage is uneven and
per-image licensing is unclear** — and photos are one of the few assets that
*leave* the site, on the share cards. `scripts/check-share.mjs` exists because
nobody who sees a share card can check it against the page it came from; the
same reasoning applies to the rights on an image inside one.

Cleaner alternative where licensing matters: **Wikidata `P18` → Wikimedia
Commons**. Free, no key, explicit CC-BY-SA per file, and the attribution
requirement is satisfiable. Lower coverage, much firmer ground. Given where
these images end up, that trade is probably the right way round.

### 2.5 ClubElo — a free, independent strength prior for Plsimulator

`http://api.clubelo.com` · CSV · no key · European clubs back to the early
European Cups.

`Plsimulator` calibrates its own team ratings in `teams_calibrated.json`. An
independent, freely published rating series is a good sanity check on that —
and the check is the value, not the ratings themselves. A calibration that has
drifted looks completely normal from inside its own backtest.

Caveat: the feed carries no league labels, so joining is by club name. This
repository already has a canonicalisation layer (`data/leagues.py`, and the
La Liga accent handling that `data/test_laliga.py` pins), so that is a solved
problem here rather than a new one.

### 2.6 openfootball — already in use, and correctly scoped

Public domain, no key, England tiers 1–4 and Spain. `Plsimulator` already joins
against it for historical match records.

Worth stating explicitly so nobody promotes it: it is **community-maintained,
and current-season updates lag**. It is a good historical spine, which is
exactly how it is used today, and the wrong thing to point a live desk at.

---

## 3. Deliberately not recommended

Recorded so these are not re-investigated in six months.

| Source | Why not |
|---|---|
| **The Odds API** | Widely assumed to have a usable free football tier. It does not — the free plan is ~25 requests/day, **NBA and MLB only**, h2h markets only. Football is paid. |
| **StatsBomb Open Data** | Genuinely free, genuinely excellent, and event-level with fouls and cards. But it covers World Cups, Euros, historical La Liga and NWSL — **not the current Premier League, Championship or La Liga**. Research value only; nothing the desks can price from. |
| **Understat / FBref / Transfermarkt** | Scraping. `docs/referee-sourcing.md` already ruled these out on ToS and breakage grounds and nothing has changed. Keep them ruled out. |
| **API-Sports free tier** | 100 requests/day of a supplier we already pay for. No gain. |
| **Sportmonks** | Paid, ~€40+/mo. Still overkill, per the earlier note. |

---

## 4. The gap nothing free fills

**Availability and injuries outside the Premier League.**

The FPL bootstrap gives player `status` and `news` free and live, and that is
why the Premier League desk is the only live one. There is no free equivalent
for the Championship or La Liga — not from football-data.org, not from
TheSportsDB, not from anywhere surveyed here. `inj` comes from API-Football's
`injured` flag at harvest time and will remain a snapshot that ages.

Two honest responses, and only one of them is free:

1. **Make the staleness visible.** `docs/referee-sourcing.md` already names the
   real danger: an availability strip showing nobody unavailable is
   indistinguishable from one that failed to load. A visible "availability as
   of *<timestamp>*" on the two frozen desks costs nothing and converts a
   silent wrong answer into a stated one. This is the recommendation.
2. Pay someone. Not yet, and not for this.

The daily cron already caps the staleness at about a day. Stamping it is what
remains.

---

## 5. Suggested order

1. Odds columns from the football-data.co.uk files already being downloaded.
2. Stamp availability freshness on the Championship and La Liga desks.
3. Run the football-data.org probe; decide the frozen desks on its verdict.
4. Open-Meteo historical backfill, then measure. Only then consider a live
   weather feed — Xweather's or anyone's.
5. Photos, via Wikidata/Commons rather than a crowd-sourced set, given they
   travel on the share cards.
6. ClubElo as a check on `teams_calibrated.json`, when convenient.

Items 1, 2 and 3 are days of work between them and close three measured gaps.
Item 4 is the one that could change the model, and it is deliberately last of
the substantive ones because it is the only one that might find nothing — which
is itself a result worth having before any weather integration is designed.

---

### Sources

Repository evidence: `data/leagues.py`, `data/build_refs.py`,
`Plsimulator/tools/build_odds.py`, `Plsimulator/tools/build_xg.py`,
`docs/referee-sourcing.md`, `ENHANCEMENTS.md`.

External (not reachable from the authoring session; see the caveat at the top):
[Open-Meteo historical weather API](https://open-meteo.com/en/docs/historical-weather-api) ·
[Open-Meteo pricing and licence](https://open-meteo.com/en/pricing) ·
[TheSportsDB free API](https://www.thesportsdb.com/free_sports_api) ·
[TheSportsDB documentation](https://www.thesportsdb.com/documentation) ·
[The Odds API docs](https://theoddsapi.com/docs/) ·
[StatsBomb open-data](https://github.com/statsbomb/open-data) ·
[openfootball/football.json](https://github.com/openfootball/football.json) ·
[ClubElo](http://clubelo.com/) ·
[Wikidata P18](https://www.wikidata.org/wiki/Property:P18) ·
[football-data.org coverage](https://www.football-data.org/coverage)

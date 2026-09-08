# The model

> Moved unchanged from the old README.md on 8 September 2026 ("Booking risk", "Implied probability and value", "The match model (game state)", "2026-27 lineup and data basis" and "The models are converged"). The README is now an orientation page; this file keeps the full prose.

## Booking risk

    risk = yellow cards per 90 × 2 + fouls committed per 90

Yellow rate is weighted double because the market pays on cards. Fouls per 90 carries the volume signal. Both are 2025-26 rates. Players under 450 minutes are flagged low sample.

## Implied probability and value

The desk maps each risk score to a model-implied chance of a card in a match with a logistic curve calibrated on the shipped data: the league base booking rate is total yellows per player-match, and the curve is anchored so the minutes-weighted league-average player lands on that base rate (`PLDCore.calibrate` / `PLDCore.impliedProb` in `assets/core.js`). Fair odds are the probability inverse; the value check reports `(odds × p − 1)` as an edge %. It's a season-average estimate and a screen for research — not a price, and framed that way in the Guide.

## The match model (game state)

The desk models cards, not football matches — so it vendors one. [Plsimulator](https://plsimulation.netlify.app) refits a Dixon–Coles attack/defence model weekly and publishes the ratings as a CORS-open bundle (`model.json`); `scripts/build-sim-model.mjs` takes the constants and per-team attack / defence / home-advantage / Elo ratings, rekeys the clubs from full names to the desk's short codes, and writes `data/sim_model.js`. `PLDCore.simFixture` reproduces the source model's arithmetic — the same lambdas, the same Dixon–Coles low-score correction, the same 10-goal grid — and a frozen golden-value test in `tests/test-core.mjs` pins the port to output taken from Plsimulator's own `plsim/models.py`, so the two products cannot drift.

It drives one factor: **game state**. A side being outplayed chases the game and fouls tactically; a comfortable favourite does not. Every player's fixture booking chance is scaled by *his own side's* expected result share — `P(win) + P(draw)/2`, not the raw win probability, because a win probability averages ~0.37 in a three-way market and feeding it raw would mark up **both** sides of an even fixture and drift the whole league off the base rate the logistic is anchored to. Result share is 0.5 on a level fixture and the two sides' factors are mirror images about 1.0, so a mismatch redistributes risk instead of inflating it. It runs ×0.89–×1.11 on the shipped ratings, clamped to ×0.85–×1.20, and applies on the log-odds scale like every other fixture factor.

Each fixture card also shows **tight** — the fitted `P(margin ≤ 1)`. Cards follow games that stay live, so this is the better closeness signal and the natural replacement for the hardcoded derby list, but it is **displayed and not yet used**: swapping what orders the fixture list is a decision for `scripts/backtest.mjs`, not a refactor. Every path degrades to neutral — an unrated fixture, a missing `data/sim_model.js` or a stale `core.js` all leave the desk behaving exactly as it did before the wiring, rather than assuming an average match.

## 2026-27 lineup and data basis

- 20 confirmed clubs: 17 staying up, plus Coventry, Ipswich and Hull (promoted). Burnley, West Ham and Wolves went down.
- Stats are 2025-26 form, the pre-season basis for an August launch. 17 clubs from Premier League data, the 3 promoted clubs from their 2025-26 Championship data, flagged EFL.
- Club team rates are shown for Premier League clubs only. Championship data mixes cup minutes, so the promoted clubs' team rate is not comparable and is omitted, though their players still appear with per-90 rates.
- Referee figures are computed from the full 2025-26 match records (all 380 games) in the free football-data.co.uk mirror at [datasets/football-datasets](https://github.com/datasets/football-datasets) — yellows and reds per game for every official with 3+ matches. Penalty rates carry over from earlier public data where available (not in this source).

### The models are converged

The three desks used to price a booking two different ways: the Premier League
through a logistic over yellows, fouls and position; the Championship and La
Liga through a Poisson hazard over the shrunk yellow rate. On separate pages
that was invisible. On one page it was not — the same day's card showed
Premier League names at 43–59% beside Championship names at 19–23%.

That gap was **the model, not the league**. Measured over the shipped squads:

| | observed cards/90 | logistic mean | logistic max | hazard mean | hazard max |
|---|---:|---:|---:|---:|---:|
| Premier League | 17.4% | 20.2% | 62.4% | **16.0%** | 40.1% |
| Championship | 17.9% | 21.5% | 70.2% | **16.6%** | 43.1% |

Run the logistic over *Championship* data and it prints 70% too, which is what
settled it. All three desks now price through `PLDCore.pCardSeason` — the
Poisson hazard, `1 − exp(−rate)` — for three reasons: it reproduces a division's
own card rate by construction (`1 − exp(−0.174)` **is** 16.0%); its top end
matches reality, where the most-carded players manage about twelve yellows in
thirty-eight games; and the logistic's foul term dominated its top end, which is
the same finding that took the Championship off foul-heavy pricing a year ago.
Fouls still drive the **risk score**, which is what the desks rank by. They no
longer set the price.

The knock-on: the Premier League desk's match totals fell from 4.1 to **3.5
expected cards**, against the 3.76 the free records show the division produced —
about 8% conservative, the same direction and size as the Championship (3.51
against 3.71). Every published Premier League number moved down.

`scripts/check-models.mjs` pins this. It is a *calibration* check, not a
same-numbers check: each desk must land within a tenth of the card rate its own
division produced, no desk may price a player above 55%, and the desks'
calibration errors must not differ by more than 8 points. It also asserts that
neither `assets/plmodel.js` nor `index.html` has gone back to `glmProb` — the
convergence has to be pinned in both, and for one commit during this change it
was pinned in only one.

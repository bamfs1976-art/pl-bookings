# Backtest

> Moved unchanged from the old README.md on 8 September 2026 ("Backtest"). The README is now an orientation page; this file keeps the full prose.

## Backtest

The **Methodology** view runs a walk-forward backtest in the browser on load ([simple-statistics](https://github.com/simple-statistics/simple-statistics) for the summary statistics, [jStat](https://github.com/jstat/jstat) for the Poisson tail) over `data/pl_backtest_2526.js` — the 2025/26 Premier League match record from the DataHub mirror of football-data.co.uk (PDDL), 380 matches, built by `node scripts/build-backtest-2526.mjs`.

What is tested is the **adjustment stack**: a base card rate multiplied by a venue split, a referee factor (officials with 10+ matches price off their own rate; everyone else off the 3.71 yellows-a-match league pivot, which is neutral by construction) and an opponent fouls-drawn context. The naive baseline carries none of them — the season-average card rate so far, given to every side in every match. Every rate a forecast uses comes from matches strictly *before* the one being predicted; `tests/test-libs.mjs` proves that by re-running with all *later* matches tampered with and asserting every earlier forecast is unchanged.

**The result, as it stands: the model does not beat the baseline.**

| Event | Base rate | Model Brier | Baseline Brier | Difference | 95% interval | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1+ yellows | 84.5% | 0.1360 | 0.1310 | +0.0050 | −0.0005 to +0.0105 | no difference |
| **2+ yellows** | **59.1%** | **0.2454** | **0.2440** | **+0.0014** | **−0.0096 to +0.0124** | **no difference** |
| 3+ yellows | 29.2% | 0.2006 | 0.2071 | −0.0065 | −0.0157 to +0.0026 | no difference |

640 scored team-match forecasts. A positive difference means the model's Brier is *higher*, which is worse. At the headline threshold it is nominally worse by 0.0014 and the interval spans zero — over 640 forecasts that is not a difference, it is noise. It is not a win at any of the three thresholds, so there is no threshold to pick that flatters it.

The calibration table shows *where* that comes from, which the Brier score hides. The model **discriminates**: its top decile came in 35.9 points above its bottom one, while the baseline's spread is −14.1 points, i.e. noise. But it is **biased low** — predicting 53.5% on average against an observed 59.1% — and on Brier the discrimination it gains and the calibration it loses cancel out. The bias is the Poisson link, not the adjustments: team yellow counts in 2025/26 have variance 1.66 against a mean 1.87, so they are *under*-dispersed, and a Poisson on the right mean puts too much weight on nought and one.

Two limits, stated in the view as well as here:

- **The per-player leg is untested.** The desk's model is per player; scoring that needs per-player, per-match booking outcomes for a completed season, and no feed this project may use has them (the FPL endpoint carries the current season only — pre-season, so nothing — and every archive that has it is on the forbidden list). The test therefore runs at team-match level on the record that *is* licensable. It is the same multiplier stack, and a result here says nothing about whether the per-player rates are any good.
- **`tests/test-libs.mjs` pins the verdict to "indistinguishable" at all three thresholds.** If a change to the model flips it, that is a finding worth a failing test and a fresh look, not a quiet green tick.

This is a *different* backtest from `scripts/backtest.mjs` / `backtest_report.md`, which walk-forward the per-player GLM against `data/match_history.json` (gitignored, harvested from FPL). That one has not been able to run; this one runs on every page load, on data that ships.

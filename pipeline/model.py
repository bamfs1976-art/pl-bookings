"""Booking-forecast model for the Premier League Bookings Desk.

Everything here is a pure function so it can be unit-tested and reused by
build_dataset.py (which bakes per-player parameters into app-data.js) and
score_forecasts.py (which evaluates published forecasts against results).

The forecast for a player in a fixture is a Poisson-thinned card rate:

    lambda = y90_shrunk * (exp_minutes / 90)
             * ref_factor * opp_factor * venue_factor * derby_factor
    P(card) = 1 - exp(-lambda)

y90_shrunk is the player's yellow-cards-per-90 after (a) blending the
current season with last season's prior and (b) empirical-Bayes shrinkage
toward his position's league mean, so 1-minute cameos can't produce
90-fouls-per-90 artefacts.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Tunables. Documented in the app's Guide tab; change them here only.
# ---------------------------------------------------------------------------

# Pseudo-minutes of position-average play mixed into every player's rates.
# 900 = ten full games of "average player at this position".
SHRINK_PSEUDO_MINUTES = 900.0

# How much of last season carries into the blend, expressed as a cap on the
# prior's minutes. A PL prior keeps up to 900 minutes of weight; a
# Championship (EFL) prior is a weaker signal and keeps up to 450.
PRIOR_CAP_MINUTES_PL = 900.0
PRIOR_CAP_MINUTES_EFL = 450.0

# Venue: away sides pick up ~10-15% more cards than home sides historically.
HOME_FACTOR = 0.95
AWAY_FACTOR = 1.08

# Referee factor is the ref's yellows/game over the league average, clamped
# so a thin sample can't swing a forecast by more than ~±40%.
REF_FACTOR_MIN = 0.70
REF_FACTOR_MAX = 1.40

# Expected-minutes heuristic (no appearance data yet): map share of possible
# minutes to expected minutes on the pitch. Replaced by real appearance data
# when the stats fetcher supplies it.
EXP_MIN_FLOOR = 12.0
EXP_MIN_CEIL = 86.0

# Positions with too few players to form a mean fall back to the league mean.
MIN_PRIOR_SAMPLE_MINUTES = 5400.0  # 60 player-games


# ---------------------------------------------------------------------------
# Rate building: blend, priors, shrinkage
# ---------------------------------------------------------------------------

def blend_seasons(cur_events: float, cur_minutes: float,
                  prior_events: float, prior_minutes: float,
                  prior_cap_minutes: float) -> tuple[float, float]:
    """Combine current-season counts with a capped amount of last season.

    The prior is scaled down so it never contributes more than
    prior_cap_minutes worth of evidence; the current season is never scaled.
    Returns (effective_events, effective_minutes).
    """
    if prior_minutes > 0:
        scale = min(1.0, prior_cap_minutes / prior_minutes)
    else:
        scale = 0.0
    return (cur_events + prior_events * scale,
            cur_minutes + prior_minutes * scale)


def pooled_rate_per90(total_events: float, total_minutes: float) -> float:
    if total_minutes <= 0:
        return 0.0
    return total_events / total_minutes * 90.0


def position_priors(players: list[dict], key_events: str) -> dict[str, float]:
    """League mean per-90 rate for an event count field, by position.

    players need fields: p (position), min (minutes), and key_events (count).
    Minutes-weighted, i.e. total events over total minutes. Positions whose
    pooled sample is under MIN_PRIOR_SAMPLE_MINUTES fall back to the league
    mean, as does any unknown position at lookup time (empty-string key).
    """
    tot_e = tot_m = 0.0
    by_pos: dict[str, list[float]] = {}
    for pl in players:
        mins = pl.get("min") or 0
        ev = pl.get(key_events)
        if ev is None or mins <= 0:
            continue
        tot_e += ev
        tot_m += mins
        acc = by_pos.setdefault(pl.get("p") or "", [0.0, 0.0])
        acc[0] += ev
        acc[1] += mins
    league = pooled_rate_per90(tot_e, tot_m)
    priors = {"": league}
    for pos, (e, m) in by_pos.items():
        priors[pos] = pooled_rate_per90(e, m) if m >= MIN_PRIOR_SAMPLE_MINUTES else league
    return priors


def shrink_rate_per90(events: float, minutes: float, prior_per90: float,
                      pseudo_minutes: float = SHRINK_PSEUDO_MINUTES) -> float:
    """Empirical-Bayes shrinkage: add pseudo_minutes of prior-rate play.

    A player with huge minutes keeps his own rate; a 1-minute cameo returns
    almost exactly the position prior.
    """
    eff_events = events + prior_per90 * pseudo_minutes / 90.0
    eff_minutes = minutes + pseudo_minutes
    return eff_events / eff_minutes * 90.0


def expected_minutes(minutes: float, possible_minutes: float) -> float:
    """Heuristic expected minutes per appearance from season minutes share.

    share >= 0.85 of possible minutes reads as a nailed-on starter (~86 min);
    fringe players slide toward the floor. This is deliberately simple and is
    superseded when real appearances/starts arrive from the stats fetcher.
    """
    if possible_minutes <= 0:
        return EXP_MIN_FLOOR
    share = max(0.0, min(1.0, minutes / possible_minutes))
    em = 20.0 + 70.0 * min(1.0, share / 0.85)
    return max(EXP_MIN_FLOOR, min(EXP_MIN_CEIL, em))


# ---------------------------------------------------------------------------
# Fixture-level factors and the forecast itself
# ---------------------------------------------------------------------------

def ref_factor(ref_ypg: float | None, league_avg_ypg: float) -> float:
    if ref_ypg is None or league_avg_ypg <= 0:
        return 1.0
    return max(REF_FACTOR_MIN, min(REF_FACTOR_MAX, ref_ypg / league_avg_ypg))


def opponent_factor(opp_fouls_drawn_pg: float | None,
                    league_avg_fouls_drawn_pg: float | None) -> float:
    """How much the opponent draws fouls (dribblers, pace). Neutral when the
    data isn't harvested yet; the field is wired end-to-end so switching the
    fetcher on immediately flows through."""
    if not opp_fouls_drawn_pg or not league_avg_fouls_drawn_pg:
        return 1.0
    return max(0.75, min(1.35, opp_fouls_drawn_pg / league_avg_fouls_drawn_pg))


def card_lambda(y90: float, exp_min: float, ref_f: float = 1.0,
                opp_f: float = 1.0, venue_f: float = 1.0,
                derby_f: float = 1.0) -> float:
    return max(0.0, y90) * (exp_min / 90.0) * ref_f * opp_f * venue_f * derby_f


def p_card(lam: float) -> float:
    return 1.0 - math.exp(-lam)


def fair_odds(p: float) -> float | None:
    if p <= 0.0:
        return None
    return 1.0 / p


# ---------------------------------------------------------------------------
# Evaluation: Brier score and calibration
# ---------------------------------------------------------------------------

@dataclass
class Forecast:
    p: float        # published probability
    outcome: int    # 1 = carded, 0 = not


def brier(forecasts: list[Forecast]) -> float | None:
    if not forecasts:
        return None
    return sum((f.p - f.outcome) ** 2 for f in forecasts) / len(forecasts)


def calibration_bins(forecasts: list[Forecast], n_bins: int = 10) -> list[dict]:
    """Bucket forecasts by predicted probability; report predicted vs actual.

    Returns [{lo, hi, n, mean_p, actual}] for non-empty bins only.
    """
    bins: list[dict] = []
    for i in range(n_bins):
        lo, hi = i / n_bins, (i + 1) / n_bins
        members = [f for f in forecasts
                   if (f.p >= lo and (f.p < hi or (i == n_bins - 1 and f.p <= hi)))]
        if not members:
            continue
        bins.append({
            "lo": round(lo, 2), "hi": round(hi, 2), "n": len(members),
            "mean_p": round(sum(f.p for f in members) / len(members), 4),
            "actual": round(sum(f.outcome for f in members) / len(members), 4),
        })
    return bins

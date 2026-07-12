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
import unicodedata
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

# Game-state (chase) factor from simulated win probabilities: sides likely
# to trail commit more tactical fouls, dominant favourites fewer. Linear
# around 50% win probability, clamped.
CHASE_SLOPE = 0.30
CHASE_FACTOR_MIN = 0.85
CHASE_FACTOR_MAX = 1.20

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


def expected_minutes_from_apps(minutes: float, apps: float) -> float:
    """Expected minutes from real appearance data (API-Football in-season):
    plain average minutes per appearance, clamped to the model bounds."""
    if not apps or apps <= 0:
        return EXP_MIN_FLOOR
    return max(EXP_MIN_FLOOR, min(EXP_MIN_CEIL, minutes / apps))


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


def chase_factor(win_prob: float | None) -> float:
    """Card-intensity multiplier from a side's simulated win probability.

    50% win probability is neutral; a 10% underdog gets ~×1.12 (chasing,
    tactical fouls), an 80% favourite ~×0.91. Neutral when no simulation
    output is available for the fixture.
    """
    if win_prob is None:
        return 1.0
    f = 1.0 + (0.5 - win_prob) * CHASE_SLOPE
    return max(CHASE_FACTOR_MIN, min(CHASE_FACTOR_MAX, f))


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
# Name matching: feeds abbreviate ("D. Rice") while our data says
# "Declan Rice". Surname must match exactly (accent/case-insensitive);
# the first token only needs a matching initial.
# ---------------------------------------------------------------------------

# Letters NFKD can't decompose (stroked/special forms, not combining accents)
_FOLD = str.maketrans({"ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l",
                       "Ł": "L", "ð": "d", "Ð": "D", "þ": "th", "Þ": "Th",
                       "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe", "ß": "ss",
                       "ı": "i", "İ": "I"})


def normalize_name(s: str | None) -> str:
    s = (s or "").translate(_FOLD)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(s.lower().replace(".", " ").split())


def names_match(a: str | None, b: str | None) -> bool:
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    ta, tb = na.split(), nb.split()
    if ta[-1] != tb[-1]:
        return False
    return ta[0][0] == tb[0][0]


# ---------------------------------------------------------------------------
# Hit rates from finished matches (the FootyMetrics-style evidence windows)
# ---------------------------------------------------------------------------

def recent_club_hits(club_matches: list[dict], player_name: str,
                     n: int = 10) -> tuple[int, int]:
    """(times carded, window) across the club's last n finished matches.

    club_matches must be ordered oldest-first and carry booked name lists.
    The window counts club games, not player appearances — per-match minutes
    aren't in the results feed.
    """
    last = club_matches[-n:]
    hits = sum(1 for m in last
               if any(names_match(player_name, b) for b in m.get("booked") or []))
    return hits, len(last)


def ref_hit_rates(matches: list[dict]) -> dict[str, dict]:
    """Per-referee card-market hit rates from finished matches.

    Returns {raw referee string: {n, o45, btc}} where o45 is the share of
    matches with 5+ total cards and btc the share where both sides picked up
    at least one card (None when per-side counts are unavailable).
    """
    acc: dict[str, dict] = {}
    for m in matches:
        ref = m.get("referee")
        if not ref:
            continue
        d = acc.setdefault(ref, {"n": 0, "o45": 0, "btc": 0, "btc_n": 0})
        d["n"] += 1
        cards = m.get("cards") or {}
        total = cards.get("total")
        if total is None:
            total = len(m.get("booked") or [])
        if total >= 5:
            d["o45"] += 1
        h, a = cards.get("home"), cards.get("away")
        if h is not None and a is not None:
            d["btc_n"] += 1
            if h > 0 and a > 0:
                d["btc"] += 1
    return {ref: {"n": d["n"],
                  "o45": round(d["o45"] / d["n"], 3),
                  "btc": round(d["btc"] / d["btc_n"], 3) if d["btc_n"] else None}
            for ref, d in acc.items()}


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

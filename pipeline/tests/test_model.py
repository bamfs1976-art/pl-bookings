import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import model  # noqa: E402
from model import Forecast  # noqa: E402


# ---- blending -------------------------------------------------------------

def test_blend_prior_capped():
    # 3000 prior minutes capped at 900 → scale 0.3
    e, m = model.blend_seasons(2, 900, 10, 3000, 900)
    assert m == 900 + 900
    assert e == 2 + 10 * 0.3


def test_blend_small_prior_kept_whole():
    e, m = model.blend_seasons(0, 0, 3, 600, 900)
    assert (e, m) == (3, 600)


def test_blend_no_prior():
    assert model.blend_seasons(4, 1800, 0, 0, 900) == (4, 1800)


def test_blend_current_never_scaled():
    e, m = model.blend_seasons(7, 3400, 5, 3400, 900)
    assert e > 7 and m > 3400
    # current season contributes fully
    assert math.isclose(e - 5 * (900 / 3400), 7)


# ---- priors + shrinkage ---------------------------------------------------

POOL = (
    [{"p": "MF", "min": 3000, "yc": 10} for _ in range(10)]
    + [{"p": "GK", "min": 3000, "yc": 1} for _ in range(4)]
)


def test_position_priors_pooled():
    pr = model.position_priors(POOL, "yc")
    assert math.isclose(pr["MF"], 10 / 3000 * 90)
    assert math.isclose(pr["GK"], 1 / 3000 * 90)
    # league mean sits between the two
    assert pr["GK"] < pr[""] < pr["MF"]


def test_position_priors_small_position_falls_back_to_league():
    pool = POOL + [{"p": "FW", "min": 100, "yc": 5}]  # way under sample floor
    pr = model.position_priors(pool, "yc")
    assert pr["FW"] == pr[""]


def test_shrinkage_kills_tiny_sample_artefacts():
    # The Myles Peart-Harris case: 1 minute, 1 foul → raw 90 fouls/90.
    prior = 12.0 / 90.0 * 90  # nonsense-free prior of 12 fouls per 90? no:
    prior = 1.2  # typical fouls/90 prior
    shrunk = model.shrink_rate_per90(1, 1, prior)
    assert shrunk < 1.4  # pulled almost entirely to the prior
    assert shrunk > prior  # but nudged up by the observed foul


def test_shrinkage_keeps_big_sample_rates():
    # 10 yellows in 3000 minutes = 0.30/90 with prior 0.10/90
    shrunk = model.shrink_rate_per90(10, 3000, 0.10)
    raw = 10 / 3000 * 90
    assert abs(shrunk - raw) < 0.05


def test_shrinkage_zero_minutes_returns_prior():
    assert math.isclose(model.shrink_rate_per90(0, 0, 0.25), 0.25)


# ---- expected minutes -----------------------------------------------------

def test_expected_minutes_starter():
    em = model.expected_minutes(3300, 3420)
    assert em > 80


def test_expected_minutes_fringe():
    em = model.expected_minutes(300, 3420)
    assert em < 35


def test_expected_minutes_from_apps():
    assert model.expected_minutes_from_apps(900, 10) == 86.0  # capped at ceil
    assert model.expected_minutes_from_apps(300, 10) == 30.0
    assert model.expected_minutes_from_apps(500, 0) == model.EXP_MIN_FLOOR
    assert model.expected_minutes_from_apps(5, 10) == model.EXP_MIN_FLOOR


def test_expected_minutes_bounds():
    assert model.expected_minutes(0, 3420) >= model.EXP_MIN_FLOOR
    assert model.expected_minutes(5000, 3420) <= model.EXP_MIN_CEIL
    assert model.expected_minutes(100, 0) == model.EXP_MIN_FLOOR


# ---- fixture factors ------------------------------------------------------

def test_ref_factor_clamped_and_neutral():
    assert model.ref_factor(None, 3.6) == 1.0
    assert model.ref_factor(3.6, 3.6) == 1.0
    assert model.ref_factor(10.0, 3.6) == model.REF_FACTOR_MAX
    assert model.ref_factor(1.0, 3.6) == model.REF_FACTOR_MIN


def test_opponent_factor_neutral_without_data():
    assert model.opponent_factor(None, 11.0) == 1.0
    assert model.opponent_factor(12.0, None) == 1.0
    assert model.opponent_factor(13.2, 11.0) > 1.0


# ---- poisson forecast -----------------------------------------------------

def test_p_card_matches_poisson():
    lam = model.card_lambda(0.4, 90)
    assert math.isclose(model.p_card(lam), 1 - math.exp(-0.4))


def test_full_lambda_composition():
    lam = model.card_lambda(0.3, 45, ref_f=1.2, opp_f=1.1, venue_f=1.08, derby_f=1.15)
    assert math.isclose(lam, 0.3 * 0.5 * 1.2 * 1.1 * 1.08 * 1.15)


def test_probabilities_sane_for_typical_players():
    # An aggressive starting DM under a strict ref away in a derby
    lam = model.card_lambda(0.45, 85, 1.25, 1.0, model.AWAY_FACTOR, 1.15)
    p = model.p_card(lam)
    assert 0.30 < p < 0.60
    # A quiet full-season winger, neutral fixture
    p2 = model.p_card(model.card_lambda(0.10, 80, 1.0, 1.0, model.HOME_FACTOR, 1.0))
    assert p2 < 0.12
    assert model.fair_odds(p2) > 8


def test_fair_odds():
    assert model.fair_odds(0.0) is None
    assert math.isclose(model.fair_odds(0.25), 4.0)


# ---- evaluation -----------------------------------------------------------

def test_brier_perfect_and_worst():
    assert model.brier([]) is None
    assert model.brier([Forecast(1.0, 1), Forecast(0.0, 0)]) == 0.0
    assert model.brier([Forecast(1.0, 0)]) == 1.0


def test_brier_typical():
    fcs = [Forecast(0.3, 0), Forecast(0.3, 1)]
    assert math.isclose(model.brier(fcs), (0.09 + 0.49) / 2)


def test_calibration_bins():
    fcs = [Forecast(0.05, 0)] * 9 + [Forecast(0.05, 1)] \
        + [Forecast(0.95, 1)] * 9 + [Forecast(0.95, 0)]
    bins = model.calibration_bins(fcs)
    assert len(bins) == 2
    lo, hi = bins[0], bins[-1]
    assert lo["n"] == 10 and math.isclose(lo["actual"], 0.1)
    assert hi["n"] == 10 and math.isclose(hi["actual"], 0.9)


def test_calibration_top_bin_includes_p_equal_1():
    bins = model.calibration_bins([Forecast(1.0, 1)])
    assert bins and bins[0]["n"] == 1

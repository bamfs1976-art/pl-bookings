#!/usr/bin/env python3
"""
The per-player per-fixture harvest and the training table built from it.

Pure, no network: the /fixtures/players payload is stubbed in the shape the API
documents, so the mapping and the leakage rules are pinned without spending
quota — and so they are pinned at all, since the harvest itself can only run
where the API is reachable.

The two things worth guarding are both silent:

  * a match with no foul figure read as a match with no fouls, which fits the
    model as though the player never fouled;
  * form leaking backwards, which is invisible in the output and makes the
    fitted model look far better than it is.

    python3 data/test_player_matches.py
"""

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import harvest_apifootball as H          # noqa: E402
import build_match_history as B          # noqa: E402


def entry(name, pos, mins, fouls, yellow=0, red=0):
    """One player's line, in the shape /fixtures/players returns."""
    return {
        "player": {"id": 1, "name": name},
        "statistics": [{
            "games": {"minutes": mins, "position": pos},
            "fouls": {"drawn": 0, "committed": fouls},
            "cards": {"yellow": yellow, "red": red},
        }],
    }


def test_maps_a_player_line():
    r = H.map_fixture_player(entry("A Player", "M", 90, 3, yellow=1), "ABC")
    assert r["player"] == "A Player", r
    assert r["pos"] == "MF", r
    assert r["min"] == 90 and r["fouls"] == 3 and r["yc"] == 1, r
    assert r["club"] == "ABC", r
    for af, ours in (("G", "GK"), ("D", "DF"), ("M", "MF"), ("F", "FW")):
        got = H.map_fixture_player(entry("X", af, 90, 1), "ABC")
        assert got["pos"] == ours, (af, got)


def test_unused_substitute_is_dropped():
    """No minutes is no evidence either way: he was not exposed, so counting
    him as 'not booked' would drag the base rate below the rate per match
    actually played."""
    assert H.map_fixture_player(entry("Bench", "M", 0, 0), "ABC") is None
    assert H.map_fixture_player(entry("Bench", "M", None, 0), "ABC") is None


def test_the_mapper_preserves_the_raw_null():
    """The harvester records what the feed said; the DECODE happens in the
    builder. Coercing here would destroy the only signal that tells us whether
    the null-means-zero assumption still holds."""
    e = entry("A Player", "M", 90, None)
    r = H.map_fixture_player(e, "ABC")
    assert r["fouls"] is None, r


def test_features_are_strictly_before_the_match():
    """The whole point of the table. Row n's rate must use matches 1..n-1 and
    never match n itself."""
    rows = [
        {"player": "P", "club": "ABC", "pos": "MF", "date": "2025-08-01",
         "fixture_id": 1, "round": 1, "min": 90, "fouls": 2, "yc": 1, "rc": 0},
        {"player": "P", "club": "ABC", "pos": "MF", "date": "2025-08-08",
         "fixture_id": 2, "round": 2, "min": 90, "fouls": 4, "yc": 0, "rc": 0},
        # null rather than 0: this feed never writes an explicit zero, and the
        # builder refuses input that does. See the note at the top of
        # data/build_match_history.py.
        {"player": "P", "club": "ABC", "pos": "MF", "date": "2025-08-15",
         "fixture_id": 3, "round": 3, "min": 90, "fouls": None, "yc": 1, "rc": 0},
    ]
    out, _ = B.build(rows)
    assert len(out) == 3, out
    # First match: nothing before it.
    assert out[0]["yc90"] == 0.0 and out[0]["foul90"] == 0.0, out[0]
    assert out[0]["y"] == 1, out[0]
    # Second: one prior 90 with one yellow and two fouls.
    assert out[1]["yc90"] == 1.0, out[1]
    assert out[1]["foul90"] == 2.0, out[1]
    assert out[1]["y"] == 0, out[1]
    # Third: two prior 90s, one yellow, six fouls.
    assert out[2]["yc90"] == 0.5, out[2]
    assert out[2]["foul90"] == 3.0, out[2]


def test_ordered_by_kickoff_not_round():
    """Rounds are played out of order — a postponed match carries an early
    round number and a late date. Ordering by round would let a match that had
    not been played yet contribute to the form going into one that had."""
    rows = [
        # Round 1, but played LAST (postponed).
        {"player": "P", "club": "ABC", "pos": "DF", "date": "2025-12-01",
         "fixture_id": 9, "round": 1, "min": 90, "fouls": 9, "yc": 1, "rc": 0},
        {"player": "P", "club": "ABC", "pos": "DF", "date": "2025-08-10",
         "fixture_id": 2, "round": 2, "min": 90, "fouls": 1, "yc": 0, "rc": 0},
    ]
    out, _ = B.build(rows)
    early = [r for r in out if r["round"] == 2][0]
    assert early["foul90"] == 0.0, (
        "the postponed round-1 match fed form into a match played four months "
        f"earlier: {early}")


def test_a_red_counts_as_carded():
    rows = [{"player": "P", "club": "ABC", "pos": "FW", "date": "2025-08-01",
             "fixture_id": 1, "round": 1, "min": 90, "fouls": 1, "yc": 0, "rc": 1}]
    out, _ = B.build(rows)
    assert out[0]["y"] == 1, out


def test_null_fouls_are_decoded_as_nought():
    """MEASURED, not assumed. Over 667 player-matches the feed never wrote an
    explicit 0, every fixture carried some foul data, and the null rows had a
    median of 70 minutes — regular starters. Null is how this feed spells
    nought, so it counts as a played 90 with no fouls in it."""
    rows = [
        {"player": "P", "club": "ABC", "pos": "MF", "date": "2025-08-01",
         "fixture_id": 1, "round": 1, "min": 90, "fouls": 4, "yc": 0, "rc": 0},
        {"player": "P", "club": "ABC", "pos": "MF", "date": "2025-08-08",
         "fixture_id": 2, "round": 2, "min": 90, "fouls": None, "yc": 0, "rc": 0},
        {"player": "P", "club": "ABC", "pos": "MF", "date": "2025-08-15",
         "fixture_id": 3, "round": 3, "min": 90, "fouls": None, "yc": 0, "rc": 0},
    ]
    out, stats = B.build(rows)
    assert stats["no_fouls"] == 2, stats
    # Two prior 90s, four fouls between them: 2.00 per 90. Dropping the null
    # match from the denominator instead would report 4.00 and describe an
    # average player as one of the division's dirtiest.
    assert out[2]["foul90"] == 2.0, out[2]


def test_an_explicit_zero_stops_the_build():
    """The decode is only sound while the feed never writes 0. If it starts,
    null means 'not recorded' again and reading it as nought would train the
    model to think half the league never fouls — so it refuses rather than
    building a table that is half decoded one way and half the other."""
    rows = [
        {"player": "P", "club": "ABC", "pos": "MF", "date": "2025-08-01",
         "fixture_id": 1, "round": 1, "min": 90, "fouls": 0, "yc": 0, "rc": 0},
        {"player": "Q", "club": "ABC", "pos": "MF", "date": "2025-08-01",
         "fixture_id": 1, "round": 1, "min": 90, "fouls": None, "yc": 0, "rc": 0},
    ]
    try:
        B.build(rows)
    except ValueError as e:
        assert "explicit fouls=0" in str(e), e
        return
    raise AssertionError("an explicit zero did not stop the build")


def test_finished_only():
    """Only a finished match has a complete card record."""
    assert "FT" in H.FINISHED and "AET" in H.FINISHED and "PEN" in H.FINISHED
    for live in ("NS", "1H", "HT", "2H", "PST", "SUSP"):
        assert live not in H.FINISHED, live


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  ok  {t.__name__}")
    print(f"\n{len(tests)} player-match harvest tests passed.")


if __name__ == "__main__":
    main()

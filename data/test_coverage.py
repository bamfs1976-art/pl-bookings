#!/usr/bin/env python3
"""Tests for the promoted-club coverage guards.

Run: python3 data/test_coverage.py   (wired into CI)

These guard the one part of the pipeline with no Premier League fallback. The
promoted clubs' form comes from the Championship feed, and when that feed came
back thin nothing noticed: the shipped dataset carried six forwards and no
defender for the three clubs, for a year, while every count-based check
passed. So the tests below are mostly about the shapes that LOOK fine.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data as B  # noqa: E402
import harvest as H  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


def row(club, pos, name):
    return {"c": club, "p": pos, "n": name}


def full_squad(club, n=None):
    """A squad that should pass: every position, over the floor."""
    n = n or B.MIN_SQUAD
    out = [row(club, "GK", club + "-gk"), row(club, "DF", club + "-df"),
           row(club, "MF", club + "-mf"), row(club, "FW", club + "-fw")]
    while len(out) < n:
        out.append(row(club, "DF", club + "-d" + str(len(out))))
    return out


print("coverage_problems (the build guard)")


def _clean():
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    assert B.coverage_problems(rows) == [], B.coverage_problems(rows)


t("a full squad for every promoted club is clean", _clean)


def _historical():
    """The hole that actually shipped, reproduced exactly: six forwards
    across the three clubs and nothing else. Every one of them must be
    reported, and by name — a single 'data is bad' line would not have told
    anyone which club to go and fetch."""
    rows = [row("HUL", "FW", "McBurnie"), row("HUL", "FW", "Gelhardt"),
            row("COV", "FW", "Wright"), row("COV", "FW", "Simms"),
            row("COV", "FW", "Thomas-Asante"),
            row("IPS", "FW", "Clarke")]
    probs = B.coverage_problems(rows)
    assert len(probs) == 6, probs          # three thin squads + three missing-position lines
    joined = " | ".join(probs)
    for club in ("HUL", "COV", "IPS"):
        assert club in joined, joined
    assert "GK, DF, MF" in joined, joined   # the missing positions are named
    assert "2 players" in joined and "3 players" in joined, joined
    assert "1 player," in joined, joined   # not "1 players"


t("the six-forwards hole that shipped is caught, club by club", _historical)


def _count_is_not_enough():
    """The load-bearing case. A club can clear the squad floor and still be
    useless: twenty forwards is not a squad, and a row count cannot tell."""
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    rows = [r for r in rows if r["c"] != "IPS"]
    rows += [row("IPS", "FW", "f" + str(i)) for i in range(B.MIN_SQUAD + 5)]
    probs = B.coverage_problems(rows)
    assert len(probs) == 1, probs
    assert probs[0] == "IPS: no GK, DF, MF in the squad", probs[0]


t("a big squad of only forwards is still a problem", _count_is_not_enough)


def _absent_club():
    rows = full_squad("COV") + full_squad("HUL")
    probs = B.coverage_problems(rows)
    assert any(p.startswith("IPS: no players at all") for p in probs), probs


t("a club missing entirely says so plainly", _absent_club)


def _ignores_others():
    """Premier League clubs are not this guard's business — they have their
    own feed and their own CI floor."""
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    rows.append(row("ARS", "FW", "lone-gunner"))
    assert B.coverage_problems(rows) == []


t("a thin PL club is not reported here", _ignores_others)


def _tolerates_junk():
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    assert B.coverage_problems(rows + [None]) == []


t("a dropped row does not crash the guard", _tolerates_junk)


print("promoted_shortfall (the harvest guard)")


def raw(team, pos, name):
    return {"team": team, "pos": pos, "n": name}


def _harvest_agrees():
    """The two stages must agree about what covered means, or the harvest
    writes a file the build then refuses — the worst of both."""
    names = {"COV": "Coventry City", "IPS": "Ipswich Town", "HUL": "Hull City"}
    payload = []
    for short, full in names.items():
        payload += [raw(full, "Goalkeeper", short + "1"), raw(full, "Defender", short + "2"),
                    raw(full, "Midfielder", short + "3"), raw(full, "Attacker", short + "4")]
        while len([p for p in payload if p["team"] == full]) < B.MIN_SQUAD:
            payload.append(raw(full, "Defender", short + "x" + str(len(payload))))
    assert H.promoted_shortfall(payload) == [], H.promoted_shortfall(payload)
    assert H.promoted_shortfall({"players": payload}) == []


t("a covered payload passes in both wrapper shapes", _harvest_agrees)


def _harvest_catches_slice():
    """What league 9 actually returns: plenty of players, a handful of them
    from the clubs we keep."""
    payload = [raw("Coventry City", "Attacker", "Wright"),
               raw("Hull City", "Attacker", "McBurnie"),
               raw("Ipswich Town", "Attacker", "Clarke")]
    payload += [raw("Sheffield Wednesday", "Defender", "x" + str(i)) for i in range(200)]
    short = H.promoted_shortfall(payload)
    # Two complaints per club — thin, and missing three positions — because
    # the harvest guard delegates to the build's rule rather than carrying its
    # own. That delegation is the point: an earlier pair of copies disagreed
    # about whether a thin squad also reports its gaps.
    assert len(short) == 6, short
    assert sum("need at least" in s for s in short) == 3, short
    assert sum("no GK, DF, MF" in s for s in short) == 3, short


t("200 Championship players with 3 from the promoted clubs is a shortfall", _harvest_catches_slice)


def _harvest_unknown_club():
    """A renamed club in the feed reads as an absent one, which is the right
    answer — an unmapped name is not evidence of a squad."""
    payload = [raw("Coventry", "Defender", "x")] * 30   # note: not "Coventry City"
    short = H.promoted_shortfall(payload)
    assert any(s.startswith("COV: no players at all") for s in short), short


t("an unmapped club name counts as no cover, not as cover", _harvest_unknown_club)


def _shared_vocabulary():
    """If these ever drift, the harvest and the build start disagreeing."""
    # The strongest form of that: identical inputs, identical complaints, with
    # no second copy of the rule to fall out of step.
    rows = [row("HUL", "FW", "one")]
    api = [raw("Hull City", "Attacker", "one")]
    assert H.promoted_shortfall(api) == B.coverage_problems(rows), (
        H.promoted_shortfall(api), B.coverage_problems(rows))
    assert B.PROMOTED == {"COV", "IPS", "HUL"}
    assert B.REQUIRED_POS == {"GK", "DF", "MF", "FW"}
    assert B.MIN_SQUAD >= 15
    for short in B.PROMOTED:
        assert short in B.SHORT.values(), short


t("the club map, floor and positions are shared by both stages", _shared_vocabulary)

print(f"\n{passed} tests passed")

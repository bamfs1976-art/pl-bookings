#!/usr/bin/env python3
"""Tests for the API-Football harvest route.

Run: python3 data/test_apifootball.py   (wired into CI)

This route replaces a cookie with a key, which is the point — a key can be a
repository secret, so the refresh can run unattended. But it also swaps one
truncation risk for another: `/players` is paginated twenty at a time, and a
squad's first page looks exactly like a squad. That is the same shape of
failure that let six forwards ship as three squads, so most of what follows is
about pages.

Everything here runs against fixtures. The live API is not reachable from CI
and needs a key, so these prove the MAPPING and the WALK, not the endpoint.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data as B  # noqa: E402
import leagues as L  # noqa: E402
import harvest_apifootball as A  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


def entry(name, club, pos, minutes, yellow=0, red=0, fouls_c=None, fouls_d=None, tid=63):
    """One /players row, in the v3 shape.

    tid defaults to 63, the id the club-scoped tests fetch: map_player picks a
    player's leg by TEAM ID rather than by name now, because a name can be
    spelled two ways and an id cannot."""
    return {
        "player": {"name": name, "photo": f"https://media.api-sports.io/{name}.png"},
        "statistics": [{
            "team": {"id": tid, "name": club},
            "games": {"minutes": minutes, "position": pos, "appearences": 10},
            "cards": {"yellow": yellow, "red": red},
            "fouls": {"committed": fouls_c, "drawn": fouls_d},
        }],
    }


def page(rows, current, total):
    return {"errors": [], "paging": {"current": current, "total": total}, "response": rows}


print("club names")


def _aliases():
    known = A.known_names("EFLC")
    assert L.canonical_club("Coventry", known) == "Coventry City"
    assert L.canonical_club("Ipswich", known) == "Ipswich Town"
    assert L.canonical_club("Hull City", known) == "Hull City"
    assert L.canonical_club("QPR", known) == "Queens Park Rangers"
    assert L.canonical_club("Sheffield Wednesday", known) is None, "relegated, not ours"
    assert L.canonical_club(None, known) is None
    assert L.canonical_club("  Coventry  ", known) == "Coventry City", "trimmed"
    # Every alias must land on a name SOME desk keys on, or the row is dropped
    # later for a reason nobody will connect back to this table.
    everything = set(B.SHORT) | set(L.EFLC_CLUBS)
    for full in set(L.AF_ALIASES.values()):
        assert full in everything, full


t("API-Football spellings map onto the build's club names", _aliases)


def _resolve():
    payload = {"response": [
        {"team": {"id": 63, "name": "Coventry"}},
        {"team": {"id": 64, "name": "Ipswich"}},
        {"team": {"id": 65, "name": "Hull City"}},
        {"team": {"id": 99, "name": "Sheffield Wednesday"}},
    ]}
    ids, unmapped = A.resolve_teams(payload, "EFLC")
    assert ids["Coventry City"] == 63 and ids["Hull City"] == 65, ids
    assert unmapped == ["Sheffield Wednesday"], unmapped


t("API spellings resolve to ids, the rest are reported", _resolve)


def _resolve_reports_unknown_names():
    """An unmapped name is RETURNED, never skipped. A squad that quietly does
    not arrive is indistinguishable from a club with no players, and a
    misspelling and a relegated club look identical from here."""
    payload = {"response": [{"team": {"id": 63, "name": "Coventry"}},
                            {"team": {"id": 71, "name": "Kidderminster"}}]}
    ids, unmapped = A.resolve_teams(payload, "EFLC")
    assert ids == {"Coventry City": 63}, ids
    assert unmapped == ["Kidderminster"], unmapped


t("club names nothing maps are reported by name", _resolve_reports_unknown_names)


print("per-90 conversion")


def _per90():
    assert A.per90(45, 900) == 4.5
    assert A.per90(0, 900) == 0.0
    # The one that matters: no minutes is unknown, not zero. A zero here reads
    # as a player who never fouls and would rank him the calmest in the league.
    assert A.per90(3, 0) is None
    assert A.per90(3, None) is None
    assert A.per90(None, 900) is None
    assert A.per90("x", 900) is None


t("a rate off zero minutes is unknown, not zero", _per90)


print("player mapping")


def _map():
    row = A.map_player(entry("A Player", "Coventry", "Defender", 900,
                             yellow=5, red=1, fouls_c=30, fouls_d=12, tid=63),
                       "Coventry City", 63)
    assert row["team"] == "Coventry City"
    assert row["n"] == "A Player"
    assert row["pos"] == "Defender"
    assert row["min"] == 900 and row["yc"] == 5 and row["rc"] == 1
    assert row["fc90"] == 3.0 and row["fd90"] == 1.2
    assert row["tid"] == 63
    # The position vocabulary has to be one build_pl_data.POS knows, or every
    # player lands with a blank position and the coverage guard fires forever.
    assert row["pos"] in B.POS, row["pos"]
    assert B.POS[row["pos"]] == "DF"


t("a row maps into the shape build_pl_data consumes", _map)


def _map_transfer():
    """A January move gives a player two statistics legs. Keep the leg for the
    club we asked about — the other one is another club's form."""
    e = entry("Mover", "Coventry", "Midfielder", 400, yellow=2, fouls_c=10, tid=63)
    e["statistics"].append({
        "team": {"id": 77, "name": "Hull City"},
        "games": {"minutes": 1200, "position": "Midfielder"},
        "cards": {"yellow": 9, "red": 0},
        "fouls": {"committed": 40, "drawn": 5},
    })
    row = A.map_player(e, "Coventry City", 63)
    assert row["min"] == 400 and row["yc"] == 2, row
    other = A.map_player(e, "Hull City", 77)
    assert other["min"] == 1200 and other["yc"] == 9, other


t("a mid-season transfer keeps the right club's leg", _map_transfer)


def _map_junk():
    assert A.map_player(None, "Coventry City", 63) is None
    assert A.map_player({}, "Coventry City", 63) is None
    assert A.map_player({"player": {"name": "X"}, "statistics": []},
                        "Coventry City", 63) is None
    # a row whose only leg belongs to another club is not ours
    assert A.map_player(entry("X", "Hull City", "Defender", 90, tid=77),
                        "Coventry City", 63) is None


t("unusable rows are dropped rather than half-built", _map_junk)


print("pagination — the failure this route invites")


def _single_page():
    rows = [entry(f"P{i}", "Coventry", "Defender", 900) for i in range(12)]
    got = A.collect_players(lambda p: page(rows, 1, 1), 63, "Coventry City")
    assert len(got) == 12, len(got)


t("a one-page squad reads in full", _single_page)


def _walks_every_page():
    """The load-bearing test. Twenty-eight players across two pages: stopping
    at page one yields twenty, which is a plausible-looking squad and wrong."""
    all_rows = [entry(f"P{i}", "Coventry", "Defender", 900) for i in range(28)]
    pages = {1: page(all_rows[:20], 1, 2), 2: page(all_rows[20:], 2, 2)}
    calls = []

    def fetch(p):
        calls.append(p)
        return pages[p]

    got = A.collect_players(fetch, 63, "Coventry City")
    assert calls == [1, 2], calls
    assert len(got) == 28, f"read {len(got)}, a page-one-only read gives 20"


t("both pages of a 28-player squad are read", _walks_every_page)


def _total_can_grow_mid_walk():
    """A feed that revises its page count upward must not truncate us. Page
    one says two pages; page two says three. Stopping at two loses a third of
    the squad, and the shape that comes back looks perfectly normal."""
    rows = [[entry(f"P{i}", "Coventry", "Defender", 900)] for i in range(3)]
    pages = {1: page(rows[0], 1, 2), 2: page(rows[1], 2, 3), 3: page(rows[2], 3, 3)}
    calls = []

    def fetch(p):
        calls.append(p)
        return pages[p]

    got = A.collect_players(fetch, 63, "Coventry City")
    assert calls == [1, 2, 3], calls
    assert len(got) == 3, len(got)


t("a page count revised upward mid-walk is followed", _total_can_grow_mid_walk)


def _api_errors_are_errors():
    """API-Football answers 200 with an errors object for a bad key or an
    exhausted quota. Treating that as an empty squad would overwrite good data
    with nothing."""
    bad = {"errors": {"token": "invalid"}, "paging": {"current": 1, "total": 1}, "response": []}
    try:
        A.collect_players(lambda p: bad, 63, "Coventry City")
    except RuntimeError as e:
        assert "errors" in str(e), e
        return
    raise AssertionError("an errors payload should have raised")


t("a 200 carrying an errors object is a failure, not an empty squad", _api_errors_are_errors)


def _runaway_guard():
    try:
        A.collect_players(lambda p: page([], p, 9999), 63, "Coventry City")
    except RuntimeError as e:
        assert "50" in str(e), e
        return
    raise AssertionError("a runaway page count should have raised")


t("a nonsense page count stops rather than looping", _runaway_guard)


print("coverage, in the API's own shape")


def _shortfall_shares_the_bar():
    """This route must clear exactly the bar the other one does, or the two
    harvests disagree about what a covered squad is."""
    rows = []
    for club in ("Coventry City", "Ipswich Town", "Hull City"):
        for i, pos in enumerate(["Goalkeeper", "Defender", "Midfielder", "Attacker"]):
            rows.append({"team": club, "pos": pos, "n": f"{club}{i}"})
        while len([r for r in rows if r["team"] == club]) < B.MIN_SQUAD:
            rows.append({"team": club, "pos": "Defender", "n": f"{club}x{len(rows)}"})
    assert A.shortfall(rows, B.PROMOTED) == [], A.shortfall(rows, B.PROMOTED)

    thin = [r for r in rows if r["team"] != "Hull City"]
    thin.append({"team": "Hull City", "pos": "Attacker", "n": "lone"})
    out = A.shortfall(thin, B.PROMOTED)
    assert out and all("HUL" in o for o in out), out
    assert any("1 player" in o for o in out), out


t("the API-Football rows are judged by the same coverage bar", _shortfall_shares_the_bar)


def _end_to_end_shape():
    """A full walk, mapped, then handed to the build's own guard — the seam
    where a wrong field name would show up as an empty squad."""
    rows = []
    # A distinct id per club, because the leg-picking is by id now: a shared id
    # would let one club's rows answer for another's and the test would pass
    # for the wrong reason.
    for tid, (club, api_name) in enumerate(
            (("Coventry City", "Coventry"), ("Ipswich Town", "Ipswich"),
             ("Hull City", "Hull City")), start=63):
        squad = []
        for i, pos in enumerate(["Goalkeeper", "Defender", "Midfielder", "Attacker"]):
            squad.append(entry(f"{club}-{pos}", api_name, pos, 900, yellow=i,
                               fouls_c=10, tid=tid))
        while len(squad) < B.MIN_SQUAD:
            squad.append(entry(f"{club}-x{len(squad)}", api_name, "Defender", 900,
                               fouls_c=8, tid=tid))
        rows += A.collect_players(lambda p, s=squad: page(s, 1, 1), tid, club)
    assert A.shortfall(rows, B.PROMOTED) == [], A.shortfall(rows, B.PROMOTED)
    built = [B.mk(r, "EFL") for r in rows]
    assert all(b is not None for b in built), "every row survives build_pl_data.mk"
    assert B.coverage_problems(built) == [], B.coverage_problems(built)
    sample = built[0]
    assert sample["b"] == "EFL" and sample["c"] in B.PROMOTED
    assert sample["r"] is not None, "risk is computed, so the harvest feeds the model"


t("a full harvest passes the build's guard and produces risk scores", _end_to_end_shape)

print("env plumbing")


def _env_or():
    """A blank workflow input sets the variable to "", which os.environ.get's
    default never sees — the request then goes out as `season=`. This is the
    seam between the YAML and the script, and nothing else covers it."""
    import os
    os.environ["AF_TEST_EMPTY"] = ""
    assert A.env_or("AF_TEST_EMPTY", "2025") == "2025", "set-but-empty falls back"
    os.environ["AF_TEST_EMPTY"] = "  "
    assert A.env_or("AF_TEST_EMPTY", "2025") == "2025", "whitespace-only falls back"
    os.environ["AF_TEST_EMPTY"] = " 2024 "
    assert A.env_or("AF_TEST_EMPTY", "2025") == "2024", "a real value is trimmed and used"
    os.environ.pop("AF_TEST_EMPTY")
    assert A.env_or("AF_TEST_EMPTY", "2025") == "2025", "absent falls back"


t("a blank workflow input falls back to the default", _env_or)


def _season_shape():
    """The two APIs number seasons differently: ScoutingStats uses a five-digit
    id (25583), API-Football a four-digit start year (2025). Feeding one to the
    other asks for a season that does not exist, and the old workflow wired
    exactly that."""
    assert A.DEFAULT_SEASON.isdigit() and len(A.DEFAULT_SEASON) == 4
    for bad in ("25583", "", "2025-26", "abc"):
        assert not (bad.isdigit() and len(bad) == 4), bad


t("a ScoutingStats season id is not a valid API-Football season", _season_shape)

print("diagnosing a failure")


def _api_errors():
    """A 200 carrying an errors object is a refusal, and reading it as "no
    results" is what sent two real runs chasing a spelling problem that did
    not exist. Both shapes the API uses have to be recognised."""
    assert A.api_errors({"errors": []}) is None, "empty list is fine"
    assert A.api_errors({"errors": {}}) is None, "empty dict is fine"
    assert A.api_errors({}) is None
    assert A.api_errors(None) is None
    # the dict form, which is what a plan restriction returns
    msg = A.api_errors({"errors": {"plan": "Free plans do not have access to this season."}})
    assert msg and "Free plans" in msg, msg
    assert "plan:" in msg, msg
    # the list form
    assert A.api_errors({"errors": ["rate limit"]}) == "rate limit"
    # a key error, which is the other thing that lands here
    tok = A.api_errors({"errors": {"token": "invalid"}})
    assert tok and "token" in tok, tok


t("a 200 carrying an errors object is recognised in both shapes", _api_errors)


def _errors_beat_emptiness():
    """A refused request has an empty response AND an errors object. The
    errors must win: 'no teams' and 'you may not read this season' lead to
    completely different next steps."""
    refused = {"errors": {"plan": "not allowed"}, "response": []}
    assert A.api_errors(refused), "the refusal is visible"
    ids, unmapped = A.resolve_teams(refused, "EFLC")
    # Indistinguishable from a league that simply has no clubs: no ids, and
    # nothing unmapped either, because there were no names to fail on. Which
    # is exactly why main() checks api_errors BEFORE it interprets emptiness —
    # "no teams" and "your plan may not read this season" lead to completely
    # different next steps, and the free plan not covering 2025-26 is the most
    # likely refusal this project will meet.
    assert ids == {} and unmapped == [], (ids, unmapped)


t("a refusal and an empty league look identical to resolve_teams", _errors_beat_emptiness)

def _rate_limit_is_retried_not_fatal():
    """The first real run fetched seven full squads and then died on Ipswich:
    21 clubs at three pages each is ~63 calls, and issued back to back that is
    several hundred a minute. A per-minute refusal is temporary, so it must be
    waited out — the alternative is losing a harvest that was working."""
    import time as _t
    real_fetch, real_delay, real_sleep = A._fetch_once, A.REQUEST_DELAY, _t.sleep
    calls = {"n": 0}

    def once(host, key, url):
        A._last_request[0] = _t.monotonic()
        calls["n"] += 1
        if calls["n"] <= 2:
            return {"errors": {"rateLimit": "Too many requests. You have exceeded the limit"}}
        return {"errors": [], "response": [{"team": {"id": 1, "name": "Millwall"}}]}

    try:
        A._fetch_once, A.REQUEST_DELAY = once, 0.0
        _t.sleep = lambda s: None                     # do not really wait
        out = A._get("h", "k", "teams", {"league": 40})
        assert calls["n"] == 3, calls
        assert out["response"], out
    finally:
        A._fetch_once, A.REQUEST_DELAY = real_fetch, real_delay
        _t.sleep = real_sleep


t("a per-minute rate limit is waited out, not fatal", _rate_limit_is_retried_not_fatal)


def _rate_limit_recognised_in_both_shapes():
    assert A._rate_limited({"errors": {"rateLimit": "Too many requests"}})
    assert A._rate_limited({"errors": ["Too Many Requests"]})
    assert not A._rate_limited({"errors": [], "response": []})
    assert not A._rate_limited({"errors": {"token": "Missing application key"}}), \
        "a bad key must NOT be retried — it will never come good"


t("a rate limit is told apart from a bad key", _rate_limit_recognised_in_both_shapes)

print(f"\n{passed} tests passed")
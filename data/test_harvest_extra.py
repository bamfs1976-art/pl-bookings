#!/usr/bin/env python3
"""The eleven endpoints the desk was not calling, and the shapes assumed.

    python3 data/test_harvest_extra.py

WHAT THESE TESTS ARE, AND WHAT THEY ARE NOT. Every parser in
data/harvest_extra.py was written without access to the API — the sandbox it
was built in cannot reach v3.football.api-sports.io and holds no key — so the
payloads below are what the DOCUMENTED shape says, written out by hand.

That makes this file two things at once. It is a normal test of the parsing
logic: the club join, the second yellow, the minute arithmetic, the refusals.
And it is a WRITTEN-DOWN STATEMENT OF AN ASSUMPTION, so that when
`--probe` lands a real payload the difference between what was assumed and
what arrives is a diff rather than an argument.

If a probe and this file disagree, this file is wrong.

THE REFUSALS ARE THE POINT. A parser that reaches for a key that is not there
and returns [] produces a file full of nothing, and every guard downstream
reads that as a quiet week. So each parser declares the keys it needs, and the
tests below check that a payload without them RAISES rather than shrugging.
"""

import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import harvest_extra as X  # noqa: E402

FAIL, passed = [], 0


def check(name, got, want):
    global passed
    if got != want:
        FAIL.append(f"{name}:\n      got  {got!r}\n      want {want!r}")
    else:
        passed += 1


def ok(cond, msg):
    global passed
    if not cond:
        FAIL.append(msg)
    else:
        passed += 1


def refuses(name, fn):
    """A shape we did not expect must stop the harvest, not empty it."""
    global passed
    try:
        fn()
    except X.ShapeError:
        passed += 1
        return
    except Exception as e:                                   # noqa: BLE001
        FAIL.append(f"{name}: raised {type(e).__name__} rather than ShapeError "
                    f"({e}) — the message a scheduled run prints has to name "
                    "the endpoint and what it found")
        return
    FAIL.append(f"{name}: an unrecognised shape was accepted. A parser that "
                "shrugs writes a file full of nothing, and nothing downstream "
                "can tell that from a quiet week.")


ARS = "Arsenal"          # canonical in build_pl_data.SHORT
CHE = "Chelsea"

# ── injuries ─────────────────────────────────────────────────────────────
INJ = {"response": [
    {"player": {"id": 1, "name": "Bukayo Saka", "type": "Missing Fixture",
                "reason": "Hamstring Injury"},
     "team": {"id": 42, "name": ARS},
     "fixture": {"id": 999}},
    {"player": {"id": 2, "name": "Somebody Else", "type": "Questionable",
                "reason": "Knock"},
     "team": {"id": 1, "name": "A Club This Desk Has Never Heard Of"},
     "fixture": {"id": 999}},
]}
inj = X.parse_injuries(INJ, "PL")
check("injuries: one row per unavailable player in a club we model", len(inj), 1)
check("injuries: the club is resolved to a short code", inj[0]["c"], "ARS")
check("injuries: the feed's own word is kept, not mapped to a flag",
      inj[0]["type"], "Missing Fixture")
check("injuries: the reason survives", inj[0]["reason"], "Hamstring Injury")
refuses("injuries", lambda: X.parse_injuries({"response": [{"nope": 1}]}, "PL"))

# ── card leaders ─────────────────────────────────────────────────────────
TOP = {"response": [
    {"player": {"id": 10, "name": "Bruno Guimaraes"},
     "statistics": [{"team": {"id": 34, "name": ARS},
                     "games": {"appearences": 30},
                     "cards": {"yellow": 12, "yellowred": 1, "red": 0}}]},
]}
lead = X.parse_card_leaders(TOP, "PL", "yellow")
check("cards: the statistics row is read", len(lead), 1)
check("cards: yellows", lead[0]["yc"], 12)
check("cards: a second yellow is its own count, not folded into reds",
      (lead[0]["yr"], lead[0]["rc"]), (1, 0))
check("cards: appearances carry, so a rate is possible", lead[0]["apps"], 30)
refuses("cards", lambda: X.parse_card_leaders(
    {"response": [{"player": {"name": "X"}}]}, "PL", "yellow"))

# ── events: the second yellow, said out loud ─────────────────────────────
EV = {"response": [
    {"type": "Card", "detail": "Yellow Card", "team": {"name": ARS},
     "player": {"name": "Declan Rice"}, "time": {"elapsed": 23, "extra": None}},
    {"type": "Card", "detail": "Second Yellow card", "team": {"name": ARS},
     "player": {"name": "Declan Rice"}, "time": {"elapsed": 90, "extra": 3}},
    {"type": "Card", "detail": "Red Card", "team": {"name": CHE},
     "player": {"name": "Somebody"}, "time": {"elapsed": 71, "extra": None}},
    {"type": "Goal", "detail": "Normal Goal", "team": {"name": ARS},
     "player": {"name": "Kai Havertz"}, "time": {"elapsed": 12, "extra": None}},
]}
ev = X.parse_events(EV, "PL", 1)
check("events: goals are not cards", len(ev), 3)
check("events: a second yellow is its own kind", [e["k"] for e in ev],
      ["Y", "Y2", "R"])
check("events: stoppage time is added to the minute", ev[1]["m"], 93)
check("events: both clubs resolve", [e["c"] for e in ev], ["ARS", "ARS", "CHE"])
# AN UNKNOWN CARD LABEL MUST STOP THE HARVEST. Dropping it silently shrinks
# every count that reads this file, and the count still looks plausible.
refuses("events: an unrecognised card detail", lambda: X.parse_events(
    {"response": [{"type": "Card", "detail": "Sin Bin", "team": {"name": ARS},
                   "player": {"name": "X"}, "time": {"elapsed": 5}}]}, "PL", 1))
refuses("events", lambda: X.parse_events({"response": [{"type": "Card"}]}, "PL", 1))

# ── transfers ────────────────────────────────────────────────────────────
TR = {"response": [
    {"player": {"id": 7, "name": "Nico Gonzalez"},
     "transfers": [
         {"date": "2026-08-20", "type": "€ 50M",
          "teams": {"out": {"name": "Manchester City"}, "in": {"name": "Newcastle"}}},
         # A MODELLED CLUB ON BOTH ENDS, deliberately: with an unknown club
         # here the row is dropped by the club filter and the date cutoff is
         # never the reason, so a broken cutoff passed the test.
         {"date": "2019-01-01", "type": "Loan",
          "teams": {"out": {"name": "Chelsea"}, "in": {"name": "Arsenal"}}},
     ]},
]}
tr = X.parse_transfers(TR, "PL", since="2026-06-01")
check("transfers: only moves since the cutoff", len(tr), 1)
check("transfers: and it is the recent one that survives",
      tr[0]["date"], "2026-08-20")
check("transfers: both ends resolve to short codes",
      (tr[0]["fromCode"], tr[0]["toCode"]), ("MCI", "NEW"))
check("transfers: the fee/loan wording is kept as reported", tr[0]["type"], "€ 50M")
refuses("transfers", lambda: X.parse_transfers({"response": [{"player": {}}]}, "PL"))

# ── team statistics: cards by minute band ────────────────────────────────
TS = {"response": {
    "team": {"id": 42, "name": ARS},
    "fixtures": {"played": {"total": 38}},
    "cards": {
        "yellow": {"0-15": {"total": 3}, "16-30": {"total": 7},
                   "31-45": {"total": 11}, "46-60": {"total": 9},
                   "61-75": {"total": 14}, "76-90": {"total": 21},
                   "91-105": {"total": 2}, "106-120": {"total": None}},
        "red": {"76-90": {"total": 2}},
    },
}}
ts = X.parse_team_stats(TS, "PL")
check("teamstats: the club", ts["c"], "ARS")
check("teamstats: matches played", ts["played"], 38)
check("teamstats: yellows are summed across the bands", ts["yc"], 67)
check("teamstats: reds too", ts["rc"], 2)
check("teamstats: a band with no total is absent, not zero",
      "106-120" in ts["bands"], False)
check("teamstats: the late-game band survives", ts["bands"]["76-90"], 21)
# /teams/statistics returns an OBJECT where every other endpoint returns a list.
refuses("teamstats: a list where an object was expected",
        lambda: X.parse_team_stats({"response": []}, "PL"))

# ── standings ────────────────────────────────────────────────────────────
ST = {"response": [{"league": {"standings": [[
    {"rank": 1, "team": {"name": ARS}, "points": 89, "goalsDiff": 51,
     "all": {"played": 38}},
    {"rank": 2, "team": {"name": CHE}, "points": 84, "goalsDiff": 40,
     "all": {"played": 38}},
]]}}]}
st = X.parse_standings(ST, "PL")
check("standings: both clubs", [r["c"] for r in st], ["ARS", "CHE"])
check("standings: points", st[0]["pts"], 89)
refuses("standings: no standings groups",
        lambda: X.parse_standings({"response": [{"league": {}}]}, "PL"))

# ── predictions ──────────────────────────────────────────────────────────
PR = {"response": [{"predictions": {
    "percent": {"home": "45%", "draw": "25%", "away": "30%"},
    "advice": "Double chance : Arsenal or draw"}}]}
pr = X.parse_prediction(PR, 55)
check("predictions: the percent sign is stripped", pr["home"], 45.0)
check("predictions: the fixture id is carried", pr["fx"], 55)
check("predictions: the advice string survives",
      pr["advice"], "Double chance : Arsenal or draw")
refuses("predictions", lambda: X.parse_prediction({"response": [{"x": 1}]}, 1))

# ── fixture statistics ───────────────────────────────────────────────────
FS = {"response": [
    {"team": {"name": ARS}, "statistics": [
        {"type": "Fouls", "value": 12}, {"type": "Yellow Cards", "value": 3},
        {"type": "Red Cards", "value": None}, {"type": "Corner Kicks", "value": 7}]},
    {"team": {"name": CHE}, "statistics": [
        {"type": "Fouls", "value": 15}, {"type": "Yellow Cards", "value": 2}]},
]}
fs = X.parse_fixture_stats(FS, "PL", 1)
check("fxstats: both sides", sorted(fs), ["ARS", "CHE"])
check("fxstats: fouls", fs["ARS"]["fouls"], 12)
check("fxstats: a null red count reads as none shown, not as missing",
      fs["ARS"]["rc"], 0)
check("fxstats: corners are not collected — this is a card desk",
      "corners" in fs["ARS"], False)
refuses("fxstats", lambda: X.parse_fixture_stats({"response": [{"team": {}}]}, "PL", 1))

# ── head to head ─────────────────────────────────────────────────────────
HH = {"response": [
    {"fixture": {"date": "2026-01-02T15:00:00+00:00"},
     "teams": {"home": {"name": ARS}, "away": {"name": CHE}},
     "goals": {"home": 2, "away": 1}},
    {"fixture": {"date": "2025-09-14T15:00:00+00:00"},
     "teams": {"home": {"name": CHE}, "away": {"name": ARS}},
     "goals": {"home": 0, "away": 0}},
]}
hh = X.parse_h2h(HH, "PL")
check("h2h: newest first", [r["d"] for r in hh], ["2026-01-02", "2025-09-14"])
refuses("h2h", lambda: X.parse_h2h({"response": [{"fixture": {}}]}, "PL"))

# ── odds: the CARD markets only ──────────────────────────────────────────
OD = {"response": [{"bookmakers": [
    {"id": 8, "name": "Bet365", "bets": [
        {"id": 1, "name": "Match Winner", "values": [
            {"value": "Home", "odd": "1.50"}]},
        {"id": 80, "name": "Total Cards", "values": [
            {"value": "Over 4.5", "odd": "2.10"},
            {"value": "Under 4.5", "odd": "1.70"}]},
    ]},
]}]}
od = X.parse_odds(OD, 77)
check("odds: only the card market is kept", len(od["lines"]), 2)
check("odds: the line and the price",
      (od["lines"][0]["label"], od["lines"][0]["odd"]), ("Over 4.5", 2.10))
check("odds: the bookmaker is named, because two books disagree",
      od["lines"][0]["book"], "Bet365")
check("odds: a fixture with no card market yields no lines",
      X.parse_odds({"response": [{"bookmakers": [
          {"name": "X", "bets": [{"name": "Match Winner", "values": []}]}]}]},
          1)["lines"], [])
refuses("odds", lambda: X.parse_odds({"response": [{"nope": 1}]}, 1))

# ── sidelined ────────────────────────────────────────────────────────────
SL = {"response": [
    {"type": "Suspended", "start": "2026-08-10", "end": "2026-08-17"},
    {"type": "Hamstring Injury", "start": "2026-05-01", "end": None},
]}
sl = X.parse_sidelined(SL, "A Player")
check("sidelined: both absences", len(sl), 2)
check("sidelined: an open-ended absence has no end", sl[1]["end"], None)
check("sidelined: the player's name is carried in, since the row has none",
      sl[0]["n"], "A Player")
refuses("sidelined", lambda: X.parse_sidelined({"response": [{"x": 1}]}, "A"))

# ── the contract itself ──────────────────────────────────────────────────
check("an empty response is a state, not a shape failure",
      X.expect([], ["anything"], "test"), [])
ok("live payload" not in "".join(FAIL), "sanity")
try:
    X.expect([{"a": {"b": 1}}], ["a.c"], "test")
    FAIL.append("expect() accepted a missing nested key")
except X.ShapeError as e:
    passed += 1
    ok("a.c" in str(e), "the refusal does not name the key that was missing")
    ok("probe" in str(e).lower(),
       "the refusal does not tell the reader to run --probe, which is the "
       "only way to find out what the shape really is")

if FAIL:
    print("FAIL")
    for f in FAIL:
        print("  -", f)
    sys.exit(1)
print(f"harvest_extra OK: {passed} checks over 11 endpoints — clubs resolve to "
      "short codes, a second yellow is its own kind, stoppage time is added, "
      "only card markets are read from the odds, and every parser REFUSES a "
      "shape it was not written for rather than returning nothing. The shapes "
      "are assumed, not verified: run --probe.")

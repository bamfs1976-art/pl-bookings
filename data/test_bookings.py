#!/usr/bin/env python3
"""The bookings ledger: the merge, and the two ways it silently loses cards.

    python3 data/test_bookings.py

The ledger is built from an INCREMENTAL harvest, which is where both of its
failure modes come from. A run ordinarily carries one round, so a rebuild that
replaced the ledger would throw away every earlier round; and a re-walk that
re-read a fixture already recorded would double it. Both produce a leaderboard
of plausible names and wrong numbers, which is the kind of wrong nobody spots.
"""

import json
import sys
import tempfile
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import build_bookings as B  # noqa: E402

FAIL = []


def check(name, got, want):
    if got != want:
        FAIL.append(f"{name}: got {got!r}, expected {want!r}")


def row(fid, rd, club, player, yc=1, rc=0):
    return {"league": "LL", "fixture_id": fid, "round": rd, "club": club,
            "player": player, "yc": yc, "rc": rc, "min": 90}


EMPTY = {"season": "2026-27", "rounds": 0, "fixtures": [], "players": []}

# ---- the card count, per player per match --------------------------------
# A SECOND YELLOW IS ONE DISMISSAL. The feed reports it as two yellows and a
# red; counting all three gives a player three cards for one sending-off, and
# it would do it only for the players a leaderboard puts at the top.
check("a booking", B.cards_in({"yc": 1, "rc": 0}), 1)
check("a straight red", B.cards_in({"yc": 0, "rc": 1}), 1)
check("booking then a second yellow", B.cards_in({"yc": 2, "rc": 1}), 2)
check("a booking and a later straight red", B.cards_in({"yc": 1, "rc": 1}), 2)
check("nothing", B.cards_in({"yc": 0, "rc": 0}), 0)

# ---- the merge keeps what came before ------------------------------------
first = B.merge(EMPTY, [row(1, 1, "SEV", "A One"), row(2, 1, "BET", "B Two")], "2026-27")
check("first build, players", len(first["players"]), 2)
check("first build, rounds", first["rounds"], 1)
check("first build, fixtures", first["fixtures"], [1, 2])

# Round two arrives ALONE, which is what the incremental harvest returns.
second = B.merge(first, [row(3, 2, "SEV", "A One")], "2026-27")
check("round one survived the round-two build", len(second["players"]), 2)
a_one = [p for p in second["players"] if p["n"] == "A One"][0]
check("A One has both rounds", a_one["rds"], {"1": 1, "2": 1})
check("rounds advanced", second["rounds"], 2)
check("fixtures accumulated", second["fixtures"], [1, 2, 3])

# ---- and does not double a fixture it has already seen -------------------
# The harvest is told what to skip, but a manual run without --only-new, or a
# rebuild from a full-season file, re-reads everything.
again = B.merge(second, [row(1, 1, "SEV", "A One"), row(3, 2, "SEV", "A One")], "2026-27")
a_again = [p for p in again["players"] if p["n"] == "A One"][0]
check("a re-walked fixture is not counted twice", a_again["rds"], {"1": 1, "2": 1})
check("fixtures did not multiply", again["fixtures"], [1, 2, 3])

# ---- a player with no card never appears ---------------------------------
clean = B.merge(EMPTY, [row(1, 1, "SEV", "C Three", yc=0, rc=0)], "2026-27")
check("an unbooked player is not a row", clean["players"], [])
check("but his fixture is recorded", clean["fixtures"], [1])

# ---- ordering is by cards, most first ------------------------------------
many = B.merge(EMPTY, [
    row(1, 1, "SEV", "A One"), row(2, 2, "SEV", "A One"), row(3, 3, "SEV", "A One"),
    row(1, 1, "BET", "B Two"), row(2, 2, "BET", "B Two"),
    row(1, 1, "VAL", "D Four"),
], "2026-27")
check("ordered by cards", [p["n"] for p in many["players"]], ["A One", "B Two", "D Four"])

# ---- the last-five window is answerable from the ledger alone ------------
# The page slices on rounds; this is the arithmetic it does, checked here so a
# ledger shape change that breaks it fails in the data tests rather than on
# the page.
win = [r for r in range(max(1, many["rounds"] - 4), many["rounds"] + 1)]
last5 = {p["n"]: sum(v for k, v in p["rds"].items() if int(k) in win)
         for p in many["players"]}
check("last five rounds, full window", last5, {"A One": 3, "B Two": 2, "D Four": 1})
narrow = [r for r in range(3, 4)]
just3 = {p["n"]: sum(v for k, v in p["rds"].items() if int(k) in narrow)
         for p in many["players"]}
check("a one-round window sees only that round", just3,
      {"A One": 1, "B Two": 0, "D Four": 0})

# ---- the faces, and the one man they must never belong to ----------------
# The ledger spells a player the player-match feed's way and the squads spell
# him the squad feed's way, so this join is the reason the page can show a face
# at all. It is also the most dangerous join in the pipeline: everywhere else a
# wrong match costs a rate, here it puts a photograph of the wrong man beside a
# public statement about how often he has been booked.
def with_squad(players, ledger_names):
    """Run attach_photos against a written-out squad file for one league."""
    rows = ",\n".join(
        '  {c:"%s",n:"%s",ph:%s}' % (c, n, f'"{ph}"' if ph else "null")
        for c, n, ph in players)
    led = {"season": "2026-27", "rounds": 1, "fixtures": [1],
           "players": [{"n": n, "c": c, "rds": {"1": 1}} for c, n in ledger_names]}
    name, konst = B.DATA_FOR["LL"]
    real = B.DATA / name
    keep = real.read_text(encoding="utf-8") if real.exists() else None
    try:
        real.write_text(f"const {konst} = [\n{rows},\n];\n", encoding="utf-8")
        B.attach_photos(led, "LL")
    finally:
        if keep is None:
            real.unlink()
        else:
            real.write_text(keep, encoding="utf-8")
    return {p["n"]: p.get("ph") for p in led["players"]}


check("the abbreviated forename the Championship is full of",
      with_squad([("BIR", "B. Osayi-Samuel", "face1")],
                 [("BIR", "Bright Osayi-Samuel")]),
      {"Bright Osayi-Samuel": "face1"})
check("an appended surname does not lose the man",
      with_squad([("ARS", "Gabriel Martinelli Silva", "face2")],
                 [("ARS", "Gabriel Martinelli")]),
      {"Gabriel Martinelli": "face2"})
# THE NEGATIVE CASES. Two men who merely look alike, and one man at the wrong
# club. Both would be invisible on the page: a plausible face beside a real name.
check("two men sharing an initial and a surname get no face at all",
      with_squad([("TOT", "B. Johnson", "face3"), ("TOT", "B. Johnson", "face4")],
                 [("TOT", "Brennan Johnson")]),
      {"Brennan Johnson": None})
check("a surname alone is not a man",
      with_squad([("BOU", "Eli Kroupi", "face5")], [("BOU", "Junior Kroupi")]),
      {"Junior Kroupi": None})
check("the same club, or no face",
      with_squad([("SEV", "Gorka Guruzeta", "face6")], [("ATH", "Gorka Guruzeta")]),
      {"Gorka Guruzeta": None})
check("one man listed twice with one photograph is not an ambiguity",
      with_squad([("VAL", "H. Duro", "face7"), ("VAL", "Hugo Duro", "face7")],
                 [("VAL", "Hugo Duro")]),
      {"Hugo Duro": "face7"})
# AND IT IS REBUILT, NOT INHERITED. A photograph carried over from the shipped
# ledger would outlive the transfer that made it wrong.
stale = {"season": "2026-27", "rounds": 1, "fixtures": [1],
         "players": [{"n": "Nobody At All", "c": "VAL", "rds": {"1": 1},
                      "ph": "https://example.invalid/old.png"}]}
B.attach_photos(stale, "LL")
check("a face that no longer joins is dropped, not kept",
      stale["players"][0].get("ph"), None)

# ---- a ledger that will not parse stops the build ------------------------
with tempfile.TemporaryDirectory() as d:
    bad = Path(d) / "x.js"
    bad.write_text("const X = {not json};\n", encoding="utf-8")
    try:
        B.load_shipped(bad)
        FAIL.append("a corrupt ledger was read as empty — the next build would "
                    "have thrown the season away and re-walked the whole fixture list")
    except SystemExit:
        pass
    missing = Path(d) / "none.js"
    check("a ledger that does not exist yet is empty, not an error",
          B.load_shipped(missing)["players"], [])

if FAIL:
    print("FAIL")
    for f in FAIL:
        print("  -", f)
    sys.exit(1)
print(f"bookings ledger OK: {5 + 21} checks — second yellows counted once, the "
      "merge keeps earlier rounds and never doubles a fixture, unbooked players "
      "stay out, the last-five window slices on rounds, and a face is attached "
      "only to the man it belongs to")

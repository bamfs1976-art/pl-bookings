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

# ---- appearances, for "booked in X of last 5" ----------------------------
def app(fid, rd, club, player, mins=90, yc=0, rc=0):
    r = row(fid, rd, club, player, yc=yc, rc=rc)
    r["min"] = mins
    return r


ap1 = B.merge(EMPTY, [app(1, 1, "SEV", "A One", yc=1), app(2, 2, "SEV", "A One"),
                      app(3, 3, "SEV", "A One", mins=0),
                      app(4, 3, "SEV", "E Five", mins=0, yc=1)], "2026-27")
apps = {a["n"]: a["r"] for a in ap1["apps"]}
check("an unused substitute is not an appearance", apps["A One"], [1, 2])
check("a player booked from the bench was in the match", apps["E Five"], [3])
# A RE-WALK ADDS NOTHING. The first run after appearances arrived re-reads
# fixtures whose cards are already in the ledger; that must fill in who played
# without doubling a single card.
re = B.merge(ap1, [app(1, 1, "SEV", "A One", yc=1), app(2, 2, "SEV", "A One")], "2026-27")
check("a re-walk does not double appearances",
      {a["n"]: a["r"] for a in re["apps"]}["A One"], [1, 2])
check("nor the card it re-reads",
      [p["rds"] for p in re["players"] if p["n"] == "A One"][0], {"1": 1})
backfill = B.merge({"season": "2026-27", "rounds": 1, "fixtures": [1],
                    "players": [{"n": "A One", "c": "SEV", "rds": {"1": 1}}]},
                   [app(1, 1, "SEV", "A One", yc=1)], "2026-27")
check("a ledger from before appearances picks them up on the re-walk",
      backfill["apps"], [{"c": "SEV", "n": "A One", "r": [1]}])
check("while its card stays at one",
      backfill["players"][0]["rds"], {"1": 1})
long = B.merge(EMPTY, [app(i, i, "SEV", "A One") for i in range(1, 9)], "2026-27")
check("only the last five appearances are kept", long["apps"][0]["r"], [4, 5, 6, 7, 8])

check("form reads most recent first",
      B.form_string([1, 2, 3, 5, 6], {"6": 1, "2": 1}), "10010")
check("a second yellow is one booked match, not two",
      B.form_string([4], {"4": 2}), "1")
check("fewer than five is fewer than five", B.form_string([2, 3], {}), "00")


def form_with_squad(players, led):
    """Run attach_form against a written-out squad file for one league."""
    rows = ",\n".join('  {c:"%s",n:"%s"}' % (c, n) for c, n in players)
    name, konst = B.DATA_FOR["LL"]
    real = B.DATA / name
    keep = real.read_text(encoding="utf-8") if real.exists() else None
    try:
        real.write_text(f"const {konst} = [\n{rows},\n];\n", encoding="utf-8")
        B.attach_form(led, "LL")
    finally:
        if keep is None:
            real.unlink()
        else:
            real.write_text(keep, encoding="utf-8")
    return led["form"]


def led_of(apps, players=()):
    return {"season": "2026-27", "rounds": 3, "fixtures": [1], "players": list(players),
            "apps": [{"c": c, "n": n, "r": r} for c, n, r in apps]}


check("the badge is keyed the way the desk spells him",
      form_with_squad([("BIR", "B. Osayi-Samuel")],
                      led_of([("BIR", "Bright Osayi-Samuel", [1, 2, 3])],
                             [{"n": "Bright Osayi-Samuel", "c": "BIR", "rds": {"3": 1}}])),
      {"BIR|B. Osayi-Samuel": "100"})
check("an unbooked regular reads all zeros, not missing",
      form_with_squad([("SEV", "Isaac Romero")], led_of([("SEV", "Isaac Romero", [1, 2])])),
      {"SEV|Isaac Romero": "00"})
check("a squad name matching two men gets no badge",
      form_with_squad([("TOT", "B. Johnson")],
                      led_of([("TOT", "Brennan Johnson", [1]), ("TOT", "Ben Johnson", [2])])),
      {})
check("one feed player claimed by two squad names gets no badge",
      form_with_squad([("TOT", "B. Johnson"), ("TOT", "Ben Johnson")],
                      led_of([("TOT", "Ben Johnson", [1])])),
      {})
check("the same club, or no badge",
      form_with_squad([("ATH", "Gorka Guruzeta")], led_of([("SEV", "Gorka Guruzeta", [1])])),
      {})
stale_form = led_of([("SEV", "Isaac Romero", [1])])
stale_form["form"] = {"VAL|Gone": "11111"}
check("form is rebuilt, never inherited",
      form_with_squad([("SEV", "Isaac Romero")], stale_form), {"SEV|Isaac Romero": "0"})

# ---- the harvest reads the ledger it is told to skip ---------------------
# The ledger is a script, and the harvest read it as JSON: every run died on
# the comment line and the ledgers stopped at round two or three.
import harvest_apifootball as H  # noqa: E402
with tempfile.TemporaryDirectory() as d:
    led_js = Path(d) / "x_bookings.js"
    led_js.write_text("// Auto-generated.\nconst X = " + json.dumps(
        {"fixtures": [7, 8], "players": [],
         "apps": [{"c": "SEV", "n": "A One", "r": [1]}]}) + ";\n", encoding="utf-8")
    check("the harvest reads a shipped ledger", H.ledger_skip(led_js), {7, 8})
    old_js = Path(d) / "y_bookings.js"
    old_js.write_text("const Y = " + json.dumps({"fixtures": [7, 8], "players": []}) + ";\n",
                      encoding="utf-8")
    check("a ledger from before appearances is walked again", H.ledger_skip(old_js), set())
    check("no ledger yet skips nothing", H.ledger_skip(Path(d) / "none.js"), set())
    # The build runs when the harvest fails, and writes an empty `apps`. That
    # ledger still has no appearances and must still be walked.
    failed_js = Path(d) / "w_bookings.js"
    failed_js.write_text("const W = " + json.dumps(
        {"fixtures": [7, 8], "players": [], "apps": []}) + ";\n", encoding="utf-8")
    check("an empty appearance list after a failed harvest is walked again",
          H.ledger_skip(failed_js), set())
    junk = Path(d) / "z_bookings.js"
    junk.write_text("const Z = {not json};\n", encoding="utf-8")
    try:
        H.ledger_skip(junk)
        FAIL.append("a corrupt ledger was read as empty by the harvest")
    except SystemExit:
        pass

if FAIL:
    print("FAIL")
    for f in FAIL:
        print("  -", f)
    sys.exit(1)
print(f"bookings ledger OK: {5 + 21 + 21} checks — second yellows counted once, the "
      "merge keeps earlier rounds and never doubles a fixture, unbooked players "
      "stay out, the last-five window slices on rounds, a face is attached "
      "only to the man it belongs to, appearances survive a re-walk, the "
      "last-5 badge joins one man or none, and the harvest can read the ledger")

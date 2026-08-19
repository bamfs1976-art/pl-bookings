#!/usr/bin/env python3
"""Tests for the FPL-squads harvest and the previous-build fallback.

Run: python3 data/test_fpl_squads.py   (wired into CI)

Two things are being defended here, and they fail in opposite directions.

The harvest must never turn "no record" into a number. A promoted-club player
with no minutes has not committed zero fouls per 90; the rate does not exist,
and a zero would rank him the calmest defender in the division and put him top
of every safe-pick screen. Null is the only honest value.

The fallback must never turn "did not run" into "returned nothing". The raw
harvest JSONs are gitignored, so a refresh without a ScoutingStats cookie sees
no Premier League file at all — and a build that believed that would rewrite
the shipped dataset as an empty league and a bot would commit it.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data as B  # noqa: E402
import harvest_fpl_squads as F  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


def boot(*teams):
    """A bootstrap-static payload, minimal but the real shape."""
    tl, els, tid, code = [], [], 0, 100
    for name, squad in teams:
        tid += 1
        tl.append({"id": tid, "name": name})
        for pos, first, second in squad:
            code += 1
            els.append({"team": tid, "element_type": pos, "first_name": first,
                        "second_name": second, "web_name": second,
                        "minutes": 0, "code": code})
    return {"teams": tl, "elements": els}


FULL = [(1, "A", "Keeper"), (2, "B", "Back"), (3, "C", "Mid"), (4, "D", "Forward")]


def full(n=None):
    out = list(FULL)
    n = n or B.MIN_SQUAD
    while len(out) < n:
        out.append((2, "E", "Sub" + str(len(out))))
    return out


print("squads_from_bootstrap")


def _shape():
    rows = F.squads_from_bootstrap(boot(("Coventry", full()), ("Arsenal", full())))
    assert {r["team"] for r in rows} == {"Coventry City"}, rows
    assert len(rows) == B.MIN_SQUAD, len(rows)
    assert [r["pos"] for r in rows][:4] == ["Goalkeeper", "Defender", "Midfielder", "Attacker"]
    assert rows[0]["n"] == "A Keeper", rows[0]


t("only the promoted clubs are taken, in the build's position vocabulary", _shape)


def _no_face_as_crest():
    """`img` is the CLUB BADGE in this row shape — build_pl_data carries it
    into CLUBS. These rows once put the FPL player cutout there, which is how
    a club came to wear a squad member's face. No badge is fine: these are
    fill-in rows for clubs that also have real rows from a source that does
    supply one, and build_clubs takes the first non-null."""
    rows = F.squads_from_bootstrap(boot(("Coventry", full())))
    for r in rows:
        assert r["img"] is None, r
    # The build must not resurrect it downstream either.
    for b in (B.mk(r, "NEW") for r in rows):
        assert b["_img"] is None, b


t("fill-in rows carry no crest rather than the player's face", _no_face_as_crest)


def _rates_are_null_not_zero():
    """The load-bearing one. A zero here is worse than the missing squad it
    replaces: it is a confident claim that a player who has never played is
    the least likely in the league to be booked."""
    rows = F.squads_from_bootstrap(boot(("Hull City", full())))
    for r in rows:
        for k in ("yc", "rc", "fc90", "fd90"):
            assert r[k] is None, (k, r)
    # And it must survive the build, which is where a None could silently
    # become a 0 on the way to the shipped file.
    built = [B.mk(r, "NEW") for r in rows]
    for b in built:
        assert b["y"] is None and b["f"] is None and b["r"] is None, b
        assert b["yc"] is None and b["rc"] is None, b


t("every rate is null, through the harvest and through the build", _rates_are_null_not_zero)


def _aliases():
    """FPL's own spelling has varied. An unmapped club is a rename we must
    notice, so it reads as absent rather than as an empty squad."""
    assert F.canonical_club("Coventry") == "Coventry City"
    assert F.canonical_club("Coventry City") == "Coventry City"
    assert F.canonical_club("Ipswich") == "Ipswich Town"
    assert F.canonical_club(" Hull  ") == "Hull City"   # surrounding whitespace only
    assert F.canonical_club("Hull FC") is None           # a genuine rename must be noticed
    assert F.canonical_club("Sheffield Wednesday") is None
    assert F.canonical_club(None) is None
    for v in set(F.CLUB_ALIASES.values()):
        assert v in B.SHORT, v                       # every alias lands in the build's club map


t("club aliases resolve, and an unknown club resolves to nothing", _aliases)


def _missing_clubs_named():
    rows = F.squads_from_bootstrap(boot(("Coventry City", full())))
    assert F.missing_clubs(rows) == ["Hull City", "Ipswich Town"], F.missing_clubs(rows)
    everything = boot(("Coventry City", full()), ("Ipswich Town", full()), ("Hull City", full()))
    assert F.missing_clubs(F.squads_from_bootstrap(everything)) == []


t("a club absent from the feed is named, not silently dropped", _missing_clubs_named)


def _empty_feed():
    assert F.squads_from_bootstrap({}) == []
    assert F.squads_from_bootstrap({"teams": None, "elements": None}) == []
    assert len(F.missing_clubs([])) == 3


t("an empty or malformed feed yields no rows and three missing clubs", _empty_feed)


print("de-duplication: a real rate is never overwritten by a blank one")


def _championship_rate_wins():
    """The six players who DO have Championship form keep it. Load order is
    the only thing enforcing that, so it is asserted rather than assumed."""
    champ = {"team": "Coventry City", "n": "Haji Wright", "pos": "Attacker",
             "min": 3000, "yc": 5, "rc": 0, "fc90": 1.2, "fd90": 0.8}
    blank = {"team": "Coventry City", "n": "Haji Wright", "pos": "Attacker",
             "min": 0, "yc": None, "rc": None, "fc90": None, "fd90": None}
    rows = [B.mk(champ, "EFL"), B.mk(blank, "NEW")]
    seen, out = set(), []
    for r in rows:
        k = (r["c"], r["n"])
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    assert len(out) == 1, out
    assert out[0]["b"] == "EFL" and out[0]["r"] is not None, out[0]


t("a player in both feeds keeps his Championship rate", _championship_rate_wins)


def _load_order_end_to_end():
    """The same property through the real build_players, because the hand-run
    de-dup above would keep passing if someone swapped the two load statements.
    Order is the ONLY thing stopping a blank row from erasing a real rate."""
    champ = [{"team": "Coventry City", "n": "Haji Wright", "pos": "Attacker",
              "min": 3000, "yc": 5, "rc": 0, "fc90": 1.2, "fd90": 0.8}]
    squads = [{"team": "Coventry City", "n": "Haji Wright", "pos": "Attacker",
               "min": 0, "yc": None, "rc": None, "fc90": None, "fd90": None},
              {"team": "Coventry City", "n": "New Defender", "pos": "Defender",
               "min": 0, "yc": None, "rc": None, "fc90": None, "fd90": None}]
    (DATA / "champ_promoted.json").write_text(json.dumps(champ), encoding="utf-8")
    (DATA / "promoted_squads.json").write_text(json.dumps(squads), encoding="utf-8")
    try:
        rows = B.build_players()
    finally:
        (DATA / "champ_promoted.json").unlink()
        (DATA / "promoted_squads.json").unlink()
    wright = [r for r in rows if r["n"] == "Haji Wright"]
    assert len(wright) == 1, wright
    assert wright[0]["b"] == "EFL", wright[0]
    assert wright[0]["r"] is not None, wright[0]
    fresh = [r for r in rows if r["n"] == "New Defender"]
    assert len(fresh) == 1 and fresh[0]["b"] == "NEW" and fresh[0]["r"] is None, fresh
    # And the Premier League rows are still there, from the previous build.
    # A FLOOR, NOT A COUNT. This was 400, which was the size of the shipped
    # squads when it was written; a transfer window retired 106 players and it
    # became a test of one particular August rather than of the fallback. What
    # it is for is catching the fallback failing altogether and the rows being
    # wiped, so it is set well below any real division and well above zero.
    assert len([r for r in rows if r["b"] == "PL"]) >= 300, len(rows)


t("through build_players, the blank row never overwrites the real one", _load_order_end_to_end)


print("club_basis (which label a mixed squad gets)")


def _club_basis():
    assert B.club_basis(["PL"] * 20) == "PL"
    assert B.club_basis(["EFL", "NEW", "NEW"]) == "EFL"
    assert B.club_basis(["NEW"] * 20) == "EFL"          # no Championship rows at all
    assert B.club_basis(["NEW", "EFL"]) == "EFL"        # order must not decide it
    assert B.club_basis(["EFL", "NEW"]) == "EFL"
    # WAS "EFL", on the rule that any non-PL row disqualifies the aggregate.
    # That was exact while a NEW row could only appear at a promoted club, so
    # "not all PL" and "no Premier League data" said the same thing. Once the
    # squads are reconciled against the FPL feed a signing can land at any of
    # the twenty, and this rule labelled Manchester City EFL over one of them —
    # blanking the team card average, the home/away splits and the club inputs
    # the model prices with. A club with Premier League form and a newcomer has
    # Premier League form. See data/test_reconcile.py.
    assert B.club_basis(["PL", "NEW"]) == "PL"


t("a promoted club reads EFL whatever order its rows arrive in", _club_basis)


def _promoted_clubs_withhold_their_team_rate():
    """The club aggregate exists only for clubs with 38 Premier League games.
    A NEW-heavy squad has none, and a number computed from a handful of
    Championship players would read as a league-comparable rate."""
    rows = [B.mk({"team": "Coventry City", "n": "x" + str(i), "pos": "Defender",
                  "min": 0, "yc": None, "rc": None, "fc90": None, "fd90": None}, "NEW")
            for i in range(20)]
    club = B.build_clubs(rows)[0]
    assert club["basis"] == "EFL", club
    assert club["ca"] is None and club["fm"] is None, club
    assert club["squad"] == 20, club


t("a promoted club ships no team rate and counts its whole squad", _promoted_clubs_withhold_their_team_rate)


print("reading the shipped file back in (the previous-build fallback)")


def _quote_keys():
    assert B.quote_keys('{a:1,b:"x"}') == '{"a":1,"b":"x"}'
    # A string value that looks like a key must be left alone — this is the
    # whole reason quote_keys tracks string state instead of running a regex.
    # No space after the comma, so the "preceded by { or ," guard alone would
    # quote `b` here. Only tracking string state saves it.
    assert B.quote_keys('{n:"a,b:c",r:1}') == '{"n":"a,b:c","r":1}'
    assert B.quote_keys('{n:"{x:1}",r:1}') == '{"n":"{x:1}","r":1}'
    # An escaped quote must not be read as the end of the string.
    assert B.quote_keys('{n:"a\\"x,b:c",r:1}') == '{"n":"a\\"x,b:c","r":1}'
    assert B.quote_keys('{n:"Smith, jr: II",r:2}') == '{"n":"Smith, jr: II","r":2}'
    assert B.quote_keys('{ls:true,r:null}') == '{"ls":true,"r":null}'
    assert B.quote_keys('{img:"https://x.example/a.png"}') == '{"img":"https://x.example/a.png"}'


t("only real keys get quoted, never text inside a string", _quote_keys)


def _js_array_round_trip():
    src = ('// header\nconst CLUBS = [\n'
           '  {short:"COV",name:"Coventry City",img:null,basis:"EFL",ca:null,caH:null,caA:null,fm:null,squad:3},\n'
           '];\nconst PL_PLAYERS = [\n'
           '  {c:"COV",n:"Haji Wright",p:"FW",min:3000,yc:5,rc:0,y:0.15,f:1.2,fw:0.8,r:1.5,ls:false,b:"EFL"},\n'
           '];\n')
    clubs = B.js_array(src, "CLUBS")
    # caH/caA are patched in by build_club_splits.py AFTER this file is
    # written, so the parser must not depend on a fixed list of keys.
    assert clubs == [{"short": "COV", "name": "Coventry City", "img": None, "basis": "EFL",
                      "ca": None, "caH": None, "caA": None, "fm": None, "squad": 3}], clubs
    players = B.js_array(src, "PL_PLAYERS")
    assert players[0]["n"] == "Haji Wright" and players[0]["ls"] is False, players


t("CLUBS and PL_PLAYERS parse back out, including post-patched fields", _js_array_round_trip)


def _shipped_file_round_trips_exactly():
    """The real shipped file, read back and rebuilt, must reproduce itself.
    If it does not, a refresh that falls back would quietly alter numbers
    nobody asked it to touch."""
    shipped = B.shipped_rows()
    assert sum(len(v) for v in shipped.values()) >= 400, {k: len(v) for k, v in shipped.items()}
    original = {(p["c"], p["n"]): p for p in B.js_array(
        (DATA / "pl_data.js").read_text(encoding="utf-8"), "PL_PLAYERS")}
    for basis, rows in shipped.items():
        for r in rows:
            built = B.mk(r, basis)
            was = original[(built["c"], built["n"])]
            for k in ("p", "min", "yc", "rc", "y", "f", "fw", "r", "ls", "b"):
                assert built[k] == was[k], (built["n"], k, built[k], was[k])


t("every shipped row rebuilds to itself, field for field", _shipped_file_round_trips_exactly)


def _fallback_is_announced():
    """A silent fallback is the dangerous kind: the refresh looks like it
    worked and re-commits last month's numbers as this month's."""
    reused = []
    rows = B.source("does-not-exist.json", "PL", {"PL": [{"n": "a"}, {"n": "b"}]}, reused)
    assert len(rows) == 2, rows
    assert len(reused) == 1 and "does-not-exist.json" in reused[0], reused
    assert "2 players" in reused[0], reused[0]


t("a fallback names the file and the count it kept", _fallback_is_announced)


def _fresh_wins_and_is_silent():
    reused = []
    kept = {"NEW": [{"n": "old"}, {"n": "older"}]}
    (DATA / "_t_fresh.json").write_text(json.dumps([{"n": "new"}]), encoding="utf-8")
    try:
        rows = B.source("_t_fresh.json", "NEW", kept, reused)
    finally:
        (DATA / "_t_fresh.json").unlink()
    assert rows == [{"n": "new"}], rows
    assert reused == [], reused


t("a source that did harvest is used, and reports nothing", _fresh_wins_and_is_silent)


def _absent_everywhere_is_empty_not_a_crash():
    reused = []
    assert B.source("does-not-exist.json", "NEW", {}, reused) == []
    assert reused == []      # nothing was kept, so there is nothing to announce


t("a source with no harvest and no history is simply empty", _absent_everywhere_is_empty_not_a_crash)

print(f"\n{passed} tests passed")

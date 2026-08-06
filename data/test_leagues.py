#!/usr/bin/env python3
"""Tests for the league registry and the league-aware referee build.

Run: python3 data/test_leagues.py   (wired into CI)

The desk's referee numbers all come from one free file per season, and the
move to a second competition is the moment that file stops being a constant.
These tests hold the two things that break in that move: the parsing has to
survive the origin's file quirks (blank trailing rows, latin-1 names), and a
league whose records carry no referee has to be refused rather than shipped as
an empty ranking.

The CSV fixtures below are real football-data.co.uk rows — Championship rows
from the 2019-20 E1 file, La Liga rows from the 2024-25 SP1 file — trimmed to
the columns under test.
"""
import io
import csv
import json
import sys
import tempfile
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues as L  # noqa: E402
import build_refs as B  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


HEAD = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,Referee,HF,AF,HY,AY,HR,AR"

# Real E1 rows (2019-20). O Langford and A Davies are genuine Championship
# officials; the repeated rows give one of them enough matches to rank.
EFLC_CSV = "\n".join([
    HEAD,
    "E1,02/08/2019,Luton,Middlesbrough,3,3,O Langford,14,20,2,2,0,0",
    "E1,03/08/2019,Barnsley,Fulham,1,0,A Davies,16,14,3,1,0,0",
    "E1,03/08/2019,Blackburn,Charlton,1,2,O Langford,10,12,1,3,1,0",
    "E1,03/08/2019,Bristol City,Leeds,1,3,A Davies,11,9,2,2,0,0",
    "E1,04/08/2019,Derby,Huddersfield,1,2,O Langford,13,15,4,0,0,0",
    "",                       # the origin's trailing blank line
    ",,,,,,,,,,,,",           # and its row of nothing but commas
])

# Real SP1 rows (2024-25). Every column present, Referee empty on all of them —
# which is what the La Liga file looks like in every one of its 33 seasons.
LALIGA_CSV = "\n".join([
    HEAD,
    "SP1,15/08/2024,Ath Bilbao,Getafe,1,1,,15,12,4,1,0,0",
    "SP1,15/08/2024,Betis,Girona,1,1,,17,10,3,2,0,0",
    "SP1,16/08/2024,Celta,Alaves,2,1,,14,16,2,4,0,1",
])


def rows(text):
    return L.usable(list(csv.DictReader(io.StringIO(text))))


# ── the registry ────────────────────────────────────────────────────────────

def test_known_leagues():
    pl, eflc = L.get("PL"), L.get("EFLC")
    assert pl.fd_div == "E0" and eflc.fd_div == "E1", "division codes"
    assert pl.clubs == 20 and eflc.clubs == 24, "club counts"
    assert L.get("eflc").code == "EFLC", "codes are case-insensitive"


def test_pl_still_reads_the_mirror_first():
    """The Premier League path is the one already in production. Its first
    source must stay the GitHub mirror the refresh Action has always used."""
    src = L.get("PL").sources("2526")
    assert src[0][0] == "mirror", src
    assert "datasets/football-datasets" in src[0][1], src[0][1]
    assert "season-2526.csv" in src[0][1], src[0][1]


def test_origin_is_the_fallback_and_the_championship_route():
    """The mirror carries only the top five leagues, so the Championship reads
    the origin — and the Premier League gains it as a second chance."""
    pl = L.get("PL").sources("2526")
    assert len(pl) == 2 and pl[1][0] == "football-data.co.uk", pl
    assert pl[1][1].endswith("/2526/E0.csv"), pl[1][1]
    eflc = L.get("EFLC").sources("2526")
    assert len(eflc) == 1, "the Championship is not on the mirror"
    assert eflc[0][1].endswith("/2526/E1.csv"), eflc[0][1]


def test_free_referees_is_a_property_of_the_league():
    assert L.get("PL").has_free_referees
    assert L.get("EFLC").has_free_referees


# ── parsing the origin's file quirks ────────────────────────────────────────

def test_blank_rows_do_not_count_as_matches():
    """The origin ends its files with commas-only rows. Counting them inflates
    every 'is this a complete season' guard, which is the guard that stops a
    half-season overwriting good data."""
    raw = list(csv.DictReader(io.StringIO(EFLC_CSV)))
    assert len(raw) == 6, f"raw parse sees the junk row: {len(raw)}"
    assert len(L.usable(raw)) == 5, "usable() drops it"


def test_latin1_names_survive():
    """Accented officials appear latin-1 encoded in some origin files. Strict
    UTF-8 throws; errors='replace' invents a second referee who never
    officiated. Neither is acceptable."""
    text = L.decode("Referee\nMart\xednez Munuera\n".encode("latin-1"))
    assert "Martínez Munuera" in text, repr(text)
    assert L.decode("A Taylor".encode("utf-8")) == "A Taylor"


def test_partial_season_is_refused():
    """A file below the row floor must stop the run, not shrink the ranking."""
    try:
        L.load_rows(L.get("EFLC"), csv_path=_tmp(EFLC_CSV))
    except SystemExit as e:
        assert "usable match rows" in str(e), str(e)
    else:
        assert False, "5 rows should not have been accepted"


def _tmp(text):
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8")
    f.write(text)
    f.close()
    return f.name


# ── the referee computation ─────────────────────────────────────────────────

def test_tally_and_rates_on_real_championship_rows():
    tally, skipped = B.tally_refs(rows(EFLC_CSV))
    assert skipped == 0, skipped
    lang = tally["O Langford"]
    assert lang["matches"] == 3, lang
    assert lang["yellows"] == 2 + 2 + 1 + 3 + 4 + 0, lang       # 12
    assert lang["reds"] == 1, lang
    assert lang["fouls"] == 14 + 20 + 10 + 12 + 13 + 15, lang   # 84

    refs = B.build_refs(tally, {}, min_matches=3)
    assert len(refs) == 1, "A Davies has 2 matches, under the floor"
    r = refs[0]
    assert r["name"] == "O Langford", r          # unmapped abbrev falls back
    assert r["ypg"] == 4.0, r                    # 12 / 3
    assert r["fouls_pg"] == 28.0, r              # 84 / 3
    assert r["cards_per_foul"] == round(12 / 84, 4), r
    assert r["red_pg"] == round(1 / 3, 2), r


def test_min_matches_floor_is_per_league():
    """The Championship runs a higher floor than the Premier League: 552
    matches over more officials means more of the list is one-off
    appointments, and a rate off two matches is noise with a name on it."""
    tally, _ = B.tally_refs(rows(EFLC_CSV))
    assert len(B.build_refs(tally, {}, min_matches=2)) == 2
    assert len(B.build_refs(tally, {}, min_matches=5)) == 0
    assert L.get("EFLC").min_ref_matches > L.get("PL").min_ref_matches


def test_full_names_are_shared_across_competitions():
    """Officials move between the two leagues. One map, or the two disagree
    about the same person the season he is promoted."""
    assert L.full_name("A Taylor") == "Anthony Taylor"
    assert L.full_name("O Langford") == "O Langford", "unmapped falls back"


def test_a_league_without_referees_yields_nothing():
    """The La Liga shape: every card and foul present, no official named.
    tally_refs must return empty rather than inventing a blank-named referee
    who appears to have taken every match in the league."""
    r = rows(LALIGA_CSV)
    assert len(r) == 3, "the rows themselves are fine"
    tally, skipped = B.tally_refs(r)
    assert tally == {}, tally
    assert skipped == 3, skipped


# ── carrying over what the source does not publish ──────────────────────────

def test_pen_and_region_carry_over_past_added_columns():
    """The regression that shipped: this carry-over is matched by a regex over
    the generated row, and it used to require a closing brace right after
    `pen:`. Appending fpg/cpf to the row silently broke it — 0 of 22 rows
    matched, so pen and region were dropped on every rebuild instead of
    carried. The row format is allowed to grow."""
    league = L.get("PL")
    path = league.path(league.data_file)
    original = path.read_text(encoding="utf-8")
    try:
        path.write_text(
            'const REFS = [\n'
            '  {n:"Anthony Taylor",region:"Cheshire",matches:25,ypg:4.1,'
            'red:0.08,pen:0.24,fpg:21.7,cpf:0.19},\n'
            '];\n', encoding="utf-8")
        prev = B.previous_details(league)
        assert prev.get("a taylor") == {"region": "Cheshire", "pen_pg": 0.24}, prev

        # and it reaches the rebuilt row
        tally = {"A Taylor": {"matches": 4, "yellows": 8, "reds": 0,
                              "fouls": 80, "foul_matches": 4}}
        out = B.build_refs(tally, prev, min_matches=3)[0]
        assert out["pen_pg"] == 0.24 and out["region"] == "Cheshire", out
    finally:
        path.write_text(original, encoding="utf-8")


def test_missing_data_file_is_not_an_error():
    """A competition the desk has not built yet has no data file to patch.
    That is the normal first run for a new league, not a failure.

    Uses a league pointed at a filename that cannot exist rather than at a
    real one: the first version asserted eflc_data.js was absent, which was
    true the day it was written and false the day the Championship was
    built. A test that depends on which artifacts happen to be present is a
    test that fails for being right."""
    league = L.League(code="NOPE", name="Nowhere League", fd_div="E9",
                      clubs=1, matches=1, data_file="does_not_exist_data.js",
                      refs_file="does_not_exist_refs.json")
    assert not league.path(league.data_file).exists()
    assert B.previous_details(league) == {}
    msg = B.patch_data_file(league, [])
    assert "does not exist yet" in msg, msg


def test_generated_block_is_valid_and_ordered():
    tally, _ = B.tally_refs(rows(EFLC_CSV))
    refs = B.build_refs(tally, {}, min_matches=2)
    block = B.refs_block(refs)
    assert block.startswith("const REFS = [") and block.endswith("];"), block
    assert '"O Langford"' in block, block
    # sorted by yellows per game, strictest first
    ypg = [r["ypg"] for r in refs]
    assert ypg == sorted(ypg, reverse=True), ypg


# ── the Championship dataset ────────────────────────────────────────────────

def test_the_24_are_24_and_distinct():
    """The lineup was DERIVED from six separately-confirmed moves, not read off
    one list. A duplicated short code would silently merge two squads."""
    assert len(L.EFLC_CLUBS) == 24, len(L.EFLC_CLUBS)
    assert len(set(L.EFLC_CLUBS.values())) == 24, "short codes collide"
    assert all(len(s) == 3 and s.isupper() for s in L.EFLC_CLUBS.values())


def test_every_alias_points_at_a_real_club():
    codes = set(L.EFLC_CLUBS.values())
    stray = {a: c for a, c in L.EFLC_ALIASES.items() if c not in codes}
    assert not stray, stray
    assert L.eflc_short("QPR") == "QPR"
    assert L.eflc_short("West Brom") == L.eflc_short("West Bromwich Albion") == "WBA"
    assert L.eflc_short("Leicester") is None, "relegated to League One, not in the 24"


def test_the_two_minorities_are_in_the_24():
    codes = set(L.EFLC_CLUBS.values())
    assert L.EFLC_FROM_PL < codes and L.EFLC_FROM_L1 < codes
    assert not (L.EFLC_FROM_PL & L.EFLC_FROM_L1), "a club cannot arrive from both"


def test_unmapped_clubs_are_reported_not_dropped():
    """The failure this build is most exposed to. An unrecognised club name
    looks exactly like a club with no players, and 23 squads plus a silent gap
    is the shape of the bug that already cost this repo a year."""
    import build_eflc_data as E
    unmapped = {}
    got = E.rows_for(
        [{"team": "Millwall", "n": "A", "pos": "Defender", "min": 900, "yc": 5, "fc90": 2.0},
         {"team": "Luton", "n": "B", "pos": "Defender", "min": 900, "yc": 3, "fc90": 1.2}],
        {"MIL"}, "EFLC", unmapped)
    assert len(got) == 1 and got[0]["c"] == "MIL", got
    assert unmapped == {"Luton": 1}, unmapped


def test_keep_filter_excludes_other_divisions_clubs():
    """pl_players.json is the WHOLE Premier League. Only the three relegated
    clubs may come out of it, or the Championship desk grows a Liverpool."""
    import build_eflc_data as E
    unmapped = {}
    got = E.rows_for(
        [{"team": "Burnley", "n": "A", "pos": "Defender", "min": 900, "yc": 5, "fc90": 2.0},
         {"team": "Southampton", "n": "B", "pos": "Defender", "min": 900, "yc": 4, "fc90": 1.5}],
        L.EFLC_FROM_PL, "PL", unmapped)
    assert [r["c"] for r in got] == ["BUR"], got
    assert unmapped == {}, "Southampton IS in the 24 — recognised, just not from this feed"


def test_club_rates_off_real_championship_matches():
    import build_eflc_data as E
    # Two Millwall matches: home 2Y+0R, away 1Y+1R.
    two = rows("\n".join([
        HEAD,
        "E1,01/01/2020,Millwall,Derby,1,0,X,10,10,2,1,0,0",
        "E1,08/01/2020,Derby,Millwall,0,0,X,10,10,1,1,0,1",
    ]))
    rates = E.club_card_rates(two)
    assert rates == {}, "two matches is under the venue floor"

    # 20 matches, 10 at each venue, so both clear the per-venue floor of 8.
    r = E.club_card_rates(rows_n(20))["MIL"]
    assert r[0] == 2.0, r      # 40 cards over 20 matches
    assert r[1] == 3.0, r      # home: 3 a game
    assert r[2] == 1.0, r      # away: 1 a game

    # 12 matches is 6 a venue: the overall rate survives, the splits do not.
    # A venue rate off six games is noise, and the app has a league-median
    # fallback precisely so it does not have to be given one.
    thin = E.club_card_rates(rows_n(12))["MIL"]
    assert thin == (2.0, None, None), thin


def rows_n(n):
    """n Millwall matches, alternating venue: 3 cards at home, 1 away."""
    lines = [HEAD]
    for i in range(n // 2):
        lines.append(f"E1,0{1+i%9}/01/2020,Millwall,Derby,1,0,X,10,10,3,0,0,0")
        lines.append(f"E1,0{1+i%9}/02/2020,Derby,Millwall,0,0,X,10,10,0,1,0,0")
    return rows("\n".join(lines))


def test_a_club_with_no_match_record_gets_no_invented_rate():
    """The six who were not in the division last season. Null, so the app's
    league-median fallback takes over — not zero, which reads as spotless."""
    import build_eflc_data as E
    players = [{"c": "BUR", "b": "PL", "_img": None, "_fouls": 40.0},
               {"c": "MIL", "b": "EFLC", "_img": None, "_fouls": 50.0}]
    clubs = {c["short"]: c for c in E.build_clubs(players, {"MIL": (2.0, 3.0, 1.0)})}
    assert clubs["BUR"]["ca"] is None and clubs["BUR"]["fm"] is None, clubs["BUR"]
    assert clubs["BUR"]["basis"] == "PL", clubs["BUR"]
    assert clubs["MIL"]["ca"] == 2.0 and clubs["MIL"]["basis"] == "EFLC", clubs["MIL"]


def test_coverage_rule_is_shared_and_takes_a_club_set():
    """The Premier League desk judges its promoted three. The Championship
    judges all 24, because no higher-division feed sits behind any of them."""
    import build_pl_data as P
    squad = [{"c": "MIL", "p": p} for p in ["GK", "DF", "DF", "MF", "FW"] * 4]
    problems = P.coverage_problems(squad, clubs={"MIL", "BUR"})
    assert any("BUR" in p and "no players" in p for p in problems), problems
    assert not any("MIL" in p for p in problems), problems
    # default is still the promoted three — the Premier League path is untouched
    assert P.coverage_problems([]) == P.coverage_problems([], clubs=P.PROMOTED)


def test_risk_arithmetic_is_shared_with_the_premier_league_builder():
    """Not reimplemented. Same mk(), same formula, different club map."""
    import build_pl_data as P
    row = P.mk({"team": "Millwall", "n": "A", "pos": "Defender", "min": 900,
                "yc": 5, "rc": 0, "fc90": 2.0}, "EFLC", resolve=L.eflc_short)
    assert row["c"] == "MIL" and row["p"] == "DF", row
    assert row["y"] == 0.5, row                      # 5 yellows / 900 min * 90
    assert row["r"] == round(0.5 * 2 + 2.0, 3), row  # yc90*2 + fouls90
    assert P.mk({"team": "Millwall", "n": "A", "min": 900}, "PL") is None, \
        "the Premier League map does not know Millwall — default unchanged"


if __name__ == "__main__":
    print("league registry and referee build")
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            t(name[5:].replace("_", " "), fn)
    print(f"\n{passed} passed")

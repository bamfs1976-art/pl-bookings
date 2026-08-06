#!/usr/bin/env python3
"""Tests for the La Liga leg: club discovery, the spelling tables, and the
referee join that is the one thing this league pays for.

Run: python3 data/test_laliga.py

WHAT IS ACTUALLY AT RISK HERE. Two things, and neither of them raises:

  1. A club name that resolves to nothing produces a club with no players and
     no error. Spain makes this likelier than England did, because three
     separate feeds spell the same club three ways and two of them use accents
     ("Ath Madrid" / "Atlético Madrid" / "Atletico Madrid").

  2. The referee join can half-work. Every rate on the desk is computed from
     free match records, but the official's NAME is joined on from a paid
     fixture list, and a join that matches 60% of a season yields a referee
     table that looks complete and rates everyone on three fifths of their
     work. Nothing downstream can tell the difference.

So most of what follows is about names and about the join.
"""

import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues as L      # noqa: E402
import build_refs as R   # noqa: E402
import harvest_apifootball as A  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


# The twenty of 2025-26, as football-data.co.uk actually spells them. Taken
# from the real season-2526.csv, not invented — every one of these strings
# appears in the free file the desk reads.
FD_NAMES_2526 = [
    "Alaves", "Ath Bilbao", "Ath Madrid", "Barcelona", "Betis", "Celta",
    "Elche", "Espanol", "Getafe", "Girona", "Levante", "Mallorca", "Osasuna",
    "Oviedo", "Real Madrid", "Sevilla", "Sociedad", "Valencia", "Vallecano",
    "Villarreal",
]

# The same twenty as API-Football spells them, accents and all.
AF_NAMES_2526 = [
    "Alavés", "Athletic Club", "Atlético Madrid", "Barcelona", "Real Betis",
    "Celta Vigo", "Elche", "Espanyol", "Getafe", "Girona", "Levante",
    "Mallorca", "Osasuna", "Real Oviedo", "Real Madrid", "Sevilla",
    "Real Sociedad", "Valencia", "Rayo Vallecano", "Villarreal",
]


def registry(names):
    """A club registry as --clubs would have written it."""
    shorts = L.assign_shorts([L.canon_name("LL", n) for n in names])
    return {n: {"short": s, "id": 1000 + i}
            for i, (n, s) in enumerate(sorted(shorts.items()))}


print("club names")


def _both_feeds_agree():
    """The load-bearing one. football-data and API-Football name the same
    twenty clubs completely differently, and if the two spellings do not reach
    the same club then the club card rates address nobody."""
    fd = {L.canon_name("LL", n) for n in FD_NAMES_2526}
    af = {L.canon_name("LL", n) for n in AF_NAMES_2526}
    assert fd == af, (
        "the two feeds' spellings do not agree.\n"
        f"  only football-data: {sorted(fd - af)}\n"
        f"  only API-Football:  {sorted(af - fd)}")
    assert len(fd) == 20, f"{len(fd)} distinct clubs, not 20: {sorted(fd)}"


t("both feeds' spellings of the 2025-26 twenty reach the same clubs",
  _both_feeds_agree)


def _every_club_has_a_code():
    reg = registry(AF_NAMES_2526)
    assert len(reg) == 20, len(reg)
    codes = [d["short"] for d in reg.values()]
    assert len(set(codes)) == 20, f"colliding codes: {sorted(codes)}"
    assert all(len(c) == 3 for c in codes), codes
    # The three Reals are the reason the override table exists at all.
    assert reg["Real Madrid"]["short"] == "RMA"
    assert reg["Real Sociedad"]["short"] == "RSO"
    assert reg["Real Betis"]["short"] == "BET"


t("every club gets a distinct three-letter code, Reals included",
  _every_club_has_a_code)


def _short_lookup_from_every_spelling():
    reg = registry(AF_NAMES_2526)
    for fd, af in zip(sorted(FD_NAMES_2526, key=lambda n: L.canon_name("LL", n)),
                      sorted(AF_NAMES_2526, key=lambda n: L.canon_name("LL", n))):
        a = L.laliga_short(fd, clubs=reg)
        b = L.laliga_short(af, clubs=reg)
        assert a and a == b, f"{fd!r} -> {a}, {af!r} -> {b}"


t("a club resolves to the same code from either feed's spelling",
  _short_lookup_from_every_spelling)


def _unknown_is_none_not_a_guess():
    reg = registry(AF_NAMES_2526)
    for junk in ("Wrexham", "", None, "   ", "Not A Club"):
        assert L.laliga_short(junk, clubs=reg) is None, junk


t("an unrecognised name is None, never a guess", _unknown_is_none_not_a_guess)


def _accents_are_not_a_second_club():
    reg = registry(AF_NAMES_2526)
    assert L.laliga_short("Atlético Madrid", clubs=reg) == \
        L.laliga_short("Atletico Madrid", clubs=reg)
    assert L.laliga_short("Alavés", clubs=reg) == L.laliga_short("Alaves", clubs=reg)

    # The two above are both covered by an explicit alias, so they would pass
    # even with accent folding switched off — which is exactly what happened
    # when this test was first written, and it is worth nothing if it cannot
    # fail. The real job of the folding is names NOT in any table: Spanish
    # clubs carry diacritics and a feed may start or stop emitting them at any
    # time, and an unfolded name becomes a second club with half a squad.
    unlisted = {"Malaga": {"short": "MAL", "id": 1}}
    assert L.laliga_short("Málaga", clubs=unlisted) == "MAL", \
        "an accented name with no explicit alias did not fold to its club"
    assert L.canon_name("LL", "Castellón") == "Castellon"
    assert L.strip_accents("Giménez Peña") == "Gimenez Pena"


t("a name differing only by an accent is the same club",
  _accents_are_not_a_second_club)


def _codes_do_not_depend_on_feed_order():
    """A re-harvest that renamed clubs would orphan every stored watchlist
    entry and every remembered referee pick, silently."""
    a = L.assign_shorts(AF_NAMES_2526)
    b = L.assign_shorts(list(reversed(AF_NAMES_2526)))
    assert a == b, "short codes depend on the order the API answered in"


t("short codes are stable whatever order the feed returns",
  _codes_do_not_depend_on_feed_order)


def _generated_codes_terminate_and_stay_distinct():
    """Clubs outside the override table still need codes, and a collision
    must resolve rather than loop or come back None."""
    names = ["Real Madrid", "Real Madrid Castilla", "Realidad FC", "Rea",
             "Racing Club", "Racing Club de Ferrol", "Racing Santander"]
    got = L.assign_shorts(names)
    assert len(got) == len(names), f"{len(got)} codes for {len(names)} clubs: {got}"
    assert len(set(got.values())) == len(names), got
    assert got["Real Madrid"] == "RMA", got
    assert got["Racing Santander"] == "RAC", got


t("generated codes resolve collisions instead of looping or returning None",
  _generated_codes_terminate_and_stay_distinct)


print("division discovery")


def teams_payload(names):
    return {"errors": [], "response": [{"team": {"id": 500 + i, "name": n}}
                                       for i, n in enumerate(names)]}


def _discovery_refuses_a_short_division():
    """Nineteen clubs is not a smaller La Liga, it is a name that arrived in a
    spelling nothing mapped — and it looks exactly like a club with no
    players, which is the failure this repo has already paid for."""
    league = L.get("LL")
    try:
        A.discover_clubs(teams_payload(AF_NAMES_2526[:19]), league, "2026")
    except SystemExit as e:
        assert "19 clubs" in str(e), str(e)
    else:
        raise AssertionError("a 19-club division was accepted")


t("discovery refuses a division of the wrong size",
  _discovery_refuses_a_short_division)


print("the referee join")


def _date_formats_all_land():
    """The archive uses dd/mm/yy and dd/mm/yyyy; the GitHub mirror rewrites to
    yyyy-mm-dd. All three have to produce the same string or the join finds
    nothing while looking like a data problem."""
    assert R.fd_date("2026-05-17") == "2026-05-17"
    assert R.fd_date("17/05/2026") == "2026-05-17"
    assert R.fd_date("17/05/26") == "2026-05-17"
    assert R.fd_date("2026-05-17T19:00:00+00:00") == "2026-05-17"
    assert R.fd_date("") is None and R.fd_date(None) is None
    assert R.fd_date("nonsense") is None


t("every date format in the archive lands on the same key", _date_formats_all_land)


def rows_and_fixtures(n=20):
    """n matches, football-data spellings on one side and API-Football
    spellings on the other — which is the real situation."""
    rows, fx = [], []
    for i in range(n):
        fd_h, fd_a = FD_NAMES_2526[i % 20], FD_NAMES_2526[(i + 7) % 20]
        af_h, af_a = AF_NAMES_2526[i % 20], AF_NAMES_2526[(i + 7) % 20]
        date = f"2026-03-{(i % 28) + 1:02d}"
        rows.append({"Date": date, "HomeTeam": fd_h, "AwayTeam": fd_a,
                     "HY": 2, "AY": 3, "HR": 0, "AR": 0, "HF": 12, "AF": 14,
                     "Referee": ""})
        fx.append({"d": date + "T19:00:00+00:00", "hn": af_h, "an": af_a,
                   "ref": f"Official {i % 4}"})
    return rows, fx


def _join_bridges_the_spelling_gap():
    rows, fx = rows_and_fixtures()
    out, stats = R.attach_referees(rows, fx, "LL")
    assert stats["matched"] == len(rows), stats
    assert stats["unmatched"] == 0, stats
    assert all(r["Referee"] for r in out), "a row came back with no official"
    # And the free records are an INPUT: mutating them would mean a second
    # pass saw a referee that came from somewhere else.
    assert all(r["Referee"] == "" for r in rows), "the source rows were mutated"


t("the join bridges football-data and API-Football spellings",
  _join_bridges_the_spelling_gap)


def _join_keeps_clubs_that_have_since_been_relegated():
    """THE ONE THAT COST A REWRITE. This join runs over the season just
    finished, three of whose clubs are no longer in the division and so have
    no short code. Keying the join on short codes dropped their matches and
    rated every referee on four fifths of his season."""
    rows, fx = rows_and_fixtures()
    # A registry that has dropped three clubs, as next season's would have.
    reg = registry(AF_NAMES_2526[:17])
    L.LEAGUES["LL"].clubs_file = None      # force load_clubs to return {}
    try:
        out, stats = R.attach_referees(rows, fx, "LL")
    finally:
        L.LEAGUES["LL"].clubs_file = "laliga_clubs.json"
    assert stats["matched"] == len(rows), (
        "matches involving clubs outside the current division were dropped: "
        f"{stats}")
    assert reg  # the registry is irrelevant to the join, which is the point


t("matches involving since-relegated clubs still join",
  _join_keeps_clubs_that_have_since_been_relegated)


def _join_tells_a_gap_apart_from_a_mismatch():
    """A fixture with no official is a GAP. A fixture that is not there at all
    is a BUG. They need different fixes, so they are counted separately."""
    rows, fx = rows_and_fixtures(10)
    fx[0]["ref"] = None                       # present, no official: a gap
    fx[1]["hn"] = "Club That Does Not Exist"  # absent: a mismatch
    _, stats = R.attach_referees(rows, fx, "LL")
    assert stats["matched"] == 8, stats
    assert stats["no_referee_in_feed"] == 1, stats
    assert stats["unmatched"] == 1, stats
    assert stats["misses"], "an unmatched row was not named"


t("a missing official is counted apart from a missing fixture",
  _join_tells_a_gap_apart_from_a_mismatch)


def _rates_come_out_of_the_free_columns():
    """After the join, every published number is computed from the free file.
    Nothing about the paid feed reaches a rate."""
    rows, fx = rows_and_fixtures(40)
    out, _ = R.attach_referees(rows, fx, "LL")
    tally, skipped = R.tally_refs(out)
    assert skipped == 0, skipped
    assert set(tally) == {f"Official {i}" for i in range(4)}, sorted(tally)
    refs = R.build_refs(tally, {}, min_matches=3)
    assert len(refs) == 4, refs
    for r in refs:
        assert r["ypg"] == 5.0, r          # HY 2 + AY 3, every match
        assert r["fouls_pg"] == 26.0, r    # HF 12 + AF 14
        assert abs(r["cards_per_foul"] - 5.0 / 26.0) < 1e-4, r


t("every rate is computed from the free cards and fouls",
  _rates_come_out_of_the_free_columns)


print("registry round-trip")


def _registry_survives_a_write_and_read():
    """Writes to a THROWAWAY filename, never data/laliga_clubs.json.

    The first version of this wrote the real file and put it back in a
    `finally`. That is fine until the process dies between the two — which it
    did, during a deliberate fault-injection run, leaving a corrupt 19-club
    registry committed-adjacent in the working tree. A test has no business
    touching a shipped data file even briefly.
    """
    league = L.get("LL")
    real = league.clubs_file
    league.clubs_file = "laliga_clubs.__test__.json"
    path = L.clubs_path("LL")
    try:
        reg = registry(AF_NAMES_2526)
        L.save_clubs("LL", reg, season="2026")
        back = L.load_clubs("LL")
        assert back == reg, "the registry did not survive a round trip"
        assert L.laliga_short("Ath Madrid") == reg["Atletico Madrid"]["short"]
    finally:
        path.unlink(missing_ok=True)
        league.clubs_file = real
    assert not path.exists(), "the test registry was left behind"


t("the club registry survives a write and read", _registry_survives_a_write_and_read)


def _a_league_that_declares_its_clubs_has_no_registry():
    assert L.clubs_path("EFLC") is None
    assert L.load_clubs("EFLC") == {}, "the Championship declares its clubs"


t("a league that declares its clubs has no discovered registry",
  _a_league_that_declares_its_clubs_has_no_registry)


print(f"\n{passed} tests passed")

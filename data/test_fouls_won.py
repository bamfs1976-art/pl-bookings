#!/usr/bin/env python3
"""Tests for the fouls-won fill, the second reader of the API-Football harvest.

Run: python3 data/test_fouls_won.py   (wired into CI)

Fouls won shipped null on 456 of 456 Premier League rows while the same number
sat in a file the refresh already writes daily. Closing that is a join between
two feeds that spell players differently, and a name join has exactly one
interesting failure mode: it half-works. A join that matches nothing produces a
column of dashes, which is indistinguishable in the shipped file from a feed
that genuinely carries no fouls — so the build stops rather than ship it.

The other direction matters just as much. This is a FILL: it exists to add a
number where there is none. If it can overwrite, it becomes a silent partial
change of source, and the one thing the workflow comment above the harvest step
is explicit about is that the Premier League's basis is not being switched as a
side effect of the Championship's.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data as B  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


def row(club, name, fw=None):
    """A shipped player row, only the fields the fill reads."""
    return {"c": club, "n": name, "fw": fw}


def af(team, name, fd90):
    """One API-Football source row, in the shape map_player() writes."""
    return {"team": team, "n": name, "fd90": fd90}


def with_source(rows, src, season=B.FORM_SEASON, league="PL", stamped=True):
    """Run the fill against a temporary harvest file, always cleaning up.

    Stamped by default, because that is what the harvester now writes; the
    bare-array form is what already exists on disk and is tested separately.
    """
    payload = ({"league": league, "season": season, "players": src}
               if stamped else src)
    path = DATA / B.AF_FILL
    existed = path.exists()
    keep = path.read_text(encoding="utf-8") if existed else None
    path.write_text(json.dumps(payload), encoding="utf-8")
    try:
        return B.fill_fouls_won(rows)
    finally:
        if existed:
            path.write_text(keep, encoding="utf-8")
        else:
            path.unlink()


# --- the join itself ------------------------------------------------------

def _full_name_matches():
    rows = [row("ARS", "Mikel Merino")]
    assert with_source(rows, [af("Arsenal", "Mikel Merino", 1.25)]) == 1
    assert rows[0]["fw"] == 1.25, rows


t("a player spelled the same way in both feeds is filled", _full_name_matches)


def _abbreviated_forename_matches():
    """The common case: API-Football writes "C. Nørgaard", ScoutingStats does
    not. An exact-name join alone would match almost nothing."""
    rows = [row("ARS", "Christian Nørgaard")]
    assert with_source(rows, [af("Arsenal", "C. Nørgaard", 0.9)]) == 1
    assert rows[0]["fw"] == 0.9, rows


t("an abbreviated forename still matches on initial + surname",
  _abbreviated_forename_matches)


def _accents_do_not_block_the_join():
    rows = [row("ARS", "Viktor Gyokeres")]
    assert with_source(rows, [af("Arsenal", "Viktor Gyökeres", 2.1)]) == 1
    assert rows[0]["fw"] == 2.1, rows


t("an accent on one side only still matches", _accents_do_not_block_the_join)


def _nordic_letters_are_not_accents():
    """ø, æ, ß and ł are LETTERS, not letters carrying a mark, so NFKD leaves
    them exactly as they are and strip_accents cannot help.

    This is the case the matched-nothing guard is blind to: it fires when the
    join finds nobody, and a handful of Scandinavians dropping out of 456
    matches is not nobody. Both feeds happen to write "Nørgaard" today, which
    is luck rather than a property of either — Fabianski and Larsen are already
    spelled both ways across the sources this repo reads."""
    rows = [row("ARS", "Christian Norgaard"), row("EVE", "Lukasz Fabianski")]
    src = [af("Arsenal", "C. Nørgaard", 1.1), af("Everton", "Ł. Fabiański", 0.4)]
    assert with_source(rows, src) == 2
    assert rows[0]["fw"] == 1.1 and rows[1]["fw"] == 0.4, rows


t("Nordic and Polish letters fold to the same key", _nordic_letters_are_not_accents)


def _wrong_club_does_not_match():
    """Two feeds, one surname, two clubs. The club is part of the key because
    a name alone is not unique in a league.

    Carries a control row that DOES match, so this exercises the club half of
    the key rather than the matched-nothing guard below."""
    rows = [row("ARS", "Gabriel Jesus"), row("ARS", "Mikel Merino")]
    src = [af("Chelsea", "Gabriel Jesus", 3.0), af("Arsenal", "Mikel Merino", 1.0)]
    assert with_source(rows, src) == 1
    assert rows[0]["fw"] is None, rows
    assert rows[1]["fw"] == 1.0, rows


t("a matching name at a different club is not used", _wrong_club_does_not_match)


# --- what the fill must never do -----------------------------------------

def _never_overwrites():
    rows = [row("ARS", "Mikel Merino", 0.5)]
    assert with_source(rows, [af("Arsenal", "Mikel Merino", 9.9)]) == 0
    assert rows[0]["fw"] == 0.5, rows


t("a value already present always wins", _never_overwrites)


def _never_adds_a_player():
    rows = [row("ARS", "Mikel Merino")]
    src = [af("Arsenal", "Mikel Merino", 1.0), af("Arsenal", "Someone Else", 2.0)]
    assert with_source(rows, src) == 1
    assert len(rows) == 1, rows


t("a source player with no shipped row is not added", _never_adds_a_player)


def _no_minutes_stays_a_dash():
    """per90() hands back None for a player with no minutes. That is "unknown",
    and it must stay unknown rather than become a zero that ranks him the
    calmest man in the division. The control row keeps this on the null rate
    rather than on the matched-nothing guard."""
    rows = [row("ARS", "Mikel Merino"), row("ARS", "Declan Rice")]
    src = [af("Arsenal", "Mikel Merino", None), af("Arsenal", "Declan Rice", 1.4)]
    assert with_source(rows, src) == 1
    assert rows[0]["fw"] is None, rows
    assert rows[1]["fw"] == 1.4, rows


t("a null rate in the source is not read as nought", _no_minutes_stays_a_dash)


def _ambiguous_initial_and_surname_is_dropped():
    """Two players, one club, same initial and surname. Either answer attaches
    one man's fouls to the other, so neither is used. The control row keeps
    this on the ambiguity rule rather than on the matched-nothing guard."""
    rows = [row("ARS", "Gabriel Magalhaes"), row("ARS", "Mikel Merino")]
    src = [af("Arsenal", "G. Magalhaes", 1.0), af("Arsenal", "Gary Magalhaes", 4.0),
           af("Arsenal", "Mikel Merino", 1.0)]
    assert with_source(rows, src) == 1
    assert rows[0]["fw"] is None, rows
    assert rows[1]["fw"] == 1.0, rows


t("an ambiguous initial + surname key is left alone",
  _ambiguous_initial_and_surname_is_dropped)


def _exact_wins_over_initial():
    """When both keys could match, the full name is the more confident one."""
    rows = [row("ARS", "Gabriel Magalhaes")]
    src = [af("Arsenal", "Gabriel Magalhaes", 1.0), af("Arsenal", "G. Magalhaes", 4.0)]
    assert with_source(rows, src) == 1
    assert rows[0]["fw"] == 1.0, rows


t("the full-name match is preferred to the initial one", _exact_wins_over_initial)


# --- the failure that would otherwise be silent ---------------------------

def _a_join_that_matches_nothing_stops_the_build():
    rows = [row("ARS", "Mikel Merino"), row("ARS", "Declan Rice")]
    src = [af("Arsenal", "Nobody At All", 1.0)]
    try:
        with_source(rows, src)
    except SystemExit as e:
        assert "matched none of them" in str(e), str(e)
        return
    raise AssertionError("a join matching nothing must stop the build")


t("a join with gaps to fill that fills none is fatal",
  _a_join_that_matches_nothing_stops_the_build)


def _no_gaps_is_not_a_failure():
    """Everything already has a number: nothing to do, and emphatically not a
    broken join."""
    rows = [row("ARS", "Mikel Merino", 1.0)]
    assert with_source(rows, [af("Arsenal", "Nobody At All", 2.0)]) == 0


t("a run with nothing to fill is not treated as a broken join",
  _no_gaps_is_not_a_failure)


# --- the season stamp ----------------------------------------------------

def _wrong_season_stops_the_build():
    """The failure the stamp exists for. Last season's fouls won on this
    season's players is not a visible error — every number reads as fine."""
    rows = [row("ARS", "Mikel Merino")]
    try:
        with_source(rows, [af("Arsenal", "Mikel Merino", 1.0)], season="2024")
    except SystemExit as e:
        assert "season 2024" in str(e), str(e)
        assert rows[0]["fw"] is None, rows
        return
    raise AssertionError("a harvest of another season must stop the build")


t("a harvest stamped with another season is refused", _wrong_season_stops_the_build)


def _wrong_league_stops_the_build():
    """--out makes it possible to point any league's harvest at this file."""
    rows = [row("ARS", "Mikel Merino")]
    try:
        with_source(rows, [af("Arsenal", "Mikel Merino", 1.0)], league="LL")
    except SystemExit as e:
        assert "LL season" in str(e), str(e)
        return
    raise AssertionError("another league's harvest must stop the build")


t("a harvest stamped with another league is refused", _wrong_league_stops_the_build)


def _right_season_fills():
    rows = [row("ARS", "Mikel Merino")]
    assert with_source(rows, [af("Arsenal", "Mikel Merino", 1.0)],
                       season=B.FORM_SEASON) == 1
    assert rows[0]["fw"] == 1.0, rows


t("a harvest stamped with this season fills as normal", _right_season_fills)


def _unstamped_file_still_works():
    """What is on disk today. A harvest written before stamps existed is a bare
    array: "cannot tell" is not "wrong", so it is used and the build says so."""
    rows = [row("ARS", "Mikel Merino")]
    assert with_source(rows, [af("Arsenal", "Mikel Merino", 1.0)],
                       stamped=False) == 1
    assert rows[0]["fw"] == 1.0, rows


t("a harvest with no stamp is still used", _unstamped_file_still_works)


def _stamp_reads_back_what_the_harvester_writes():
    """Pins the two halves together: the shape harvest_apifootball.py writes is
    the shape stamp() reads. They are in different files and nothing else would
    notice them drifting apart."""
    path = DATA / B.AF_FILL
    assert not path.exists(), f"{B.AF_FILL} exists, so this test cannot run"
    payload = {"league": "PL", "season": "2025",
               "players": [af("Arsenal", "Mikel Merino", 1.0)]}
    path.write_text(json.dumps(payload), encoding="utf-8")
    try:
        assert B.stamp(B.AF_FILL) == ("PL", "2025"), B.stamp(B.AF_FILL)
        assert B.load(B.AF_FILL) == payload["players"], B.load(B.AF_FILL)
    finally:
        path.unlink()


t("the stamp the harvester writes is the stamp the build reads",
  _stamp_reads_back_what_the_harvester_writes)


def _absent_source_is_not_a_failure():
    """The harvest is gated on a key and on continue-on-error, so its file is
    legitimately absent. That is a partial refresh, not a broken one."""
    path = DATA / B.AF_FILL
    assert not path.exists(), (
        f"{B.AF_FILL} exists, so this test cannot check the absent case")
    rows = [row("ARS", "Mikel Merino")]
    assert B.fill_fouls_won(rows) == 0
    assert rows[0]["fw"] is None, rows


t("an unharvested source leaves the dashes alone", _absent_source_is_not_a_failure)



# --- an empty feed is not a broken join -----------------------------------
#
# THE DAY THIS COST. The 10 August refresh died here: API-Football returned 696
# Premier League squad rows with no statistics on any of them, the join matched
# nothing, and the build refused. Referees, fixtures, injuries and all three
# desks then stayed frozen on 6 August data four days before the Championship
# opened — over one supplementary column.
#
# The refusal is right when the source HAS numbers and the keys cannot reach
# them: that is a join silently shipping a league of dashes that reads as "the
# source has no fouls". It is wrong when the source carries no numbers at all,
# which is an upstream that rolled its season over. The original comment said
# the two were indistinguishable; they are not, in the source.


def _a_source_with_no_numbers_does_not_stop_the_build():
    rows = [row("ARS", "Mikel Merino"), row("CHE", "Moisés Caicedo")]
    src = [af("Arsenal", "M. Merino", None), af("Chelsea", "M. Caicedo", None)]
    # returns rather than exits, and leaves the dashes for the next refresh
    assert with_source(rows, src) == 0
    assert all(r["fw"] is None for r in rows), rows


t("a source carrying no fouls-won numbers does not stop the build",
  _a_source_with_no_numbers_does_not_stop_the_build)


def _a_source_with_numbers_and_no_matches_still_stops_the_build():
    # The guard's real purpose, which must survive the fix above: numbers are
    # present, the keys do not reach them, and shipping that would be
    # indistinguishable from a feed that had nothing.
    rows = [row("ARS", "Mikel Merino")]
    src = [af("Nowhere United", "Someone Else", 1.4)]
    try:
        with_source(rows, src)
    except SystemExit as e:
        assert "broken join" in str(e), str(e)
        # and it must name a row that HAS a number, not merely the first row in
        # the file — sampling blind is what sent the last reader into
        # name_keys() when the names were never the problem
        assert "Someone Else" in str(e), str(e)
        return
    assert False, "a broken join was allowed through"


t("a source with numbers and no matches still stops the build",
  _a_source_with_numbers_and_no_matches_still_stops_the_build)


def _one_usable_number_is_enough_to_arm_the_guard():
    # The two paths are separated by whether ANY source row carries a number,
    # so the boundary is exactly one. A file of nulls plus a single number is a
    # feed with data, and a join that reaches none of it is broken.
    rows = [row("ARS", "Mikel Merino")]
    src = [af("Nowhere United", "Someone Else", None)] * 50
    src.append(af("Nowhere United", "The One", 0.8))
    try:
        with_source(rows, src)
    except SystemExit as e:
        assert "The One" in str(e), (
            "the sample must come from the rows that carry numbers: " + str(e))
        return
    assert False, "one usable number did not arm the guard"


t("one usable number is enough to arm the guard",
  _one_usable_number_is_enough_to_arm_the_guard)


print(f"\n{passed} tests passed")

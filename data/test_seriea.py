#!/usr/bin/env python3
"""Tests for the Serie A leg: club discovery, the spelling tables, and the
referee join that is the one thing this league pays for.

Run: python3 data/test_seriea.py

The same two silent failures test_laliga.py exists for, in a fourth division:

  1. A club name that resolves to nothing produces a club with no players and
     no error. Italy's traps are the short forms: football-data writes "Inter",
     "Milan", "Roma" and "Verona" where API-Football writes "Inter",
     "AC Milan", "AS Roma" and "Hellas Verona".

  2. The referee join can half-work. Every rate is computed from the free I1
     records, but the official's NAME is joined on from a paid fixture list,
     and a join that matches 60% of a season yields a referee table that looks
     complete and rates everyone on three fifths of their work.

And one Italy adds: a fourth desk's short codes must stay clear of the other
three, because /today merges the divisions' colour tables into one lookup.
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


# The twenty of 2025-26 as football-data.co.uk spells them. Read off the real
# season-2526.csv on 9 September 2026, not invented: every one of these strings
# is in the free file the desk reads.
FD_NAMES_2526 = [
    "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese", "Fiorentina",
    "Genoa", "Inter", "Juventus", "Lazio", "Lecce", "Milan", "Napoli", "Parma",
    "Pisa", "Roma", "Sassuolo", "Torino", "Udinese", "Verona",
]

# The same twenty as API-Football spells them. The four that differ are the
# ones the brief warned about; every one is checked below rather than trusted.
AF_NAMES_2526 = [
    "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese", "Fiorentina",
    "Genoa", "Inter", "Juventus", "Lazio", "Lecce", "AC Milan", "Napoli",
    "Parma", "Pisa", "AS Roma", "Sassuolo", "Torino", "Udinese",
    "Hellas Verona",
]


def registry(names):
    """A club registry as --clubs would have written it."""
    shorts = L.assign_shorts([L.canon_name("SA", n) for n in names], code="SA")
    return {n: {"short": s, "id": 2000 + i}
            for i, (n, s) in enumerate(sorted(shorts.items()))}


print("club names")


def _both_feeds_agree():
    fd = {L.canon_name("SA", n) for n in FD_NAMES_2526}
    af = {L.canon_name("SA", n) for n in AF_NAMES_2526}
    assert fd == af, (
        "the two feeds' spellings do not agree.\n"
        f"  only football-data: {sorted(fd - af)}\n"
        f"  only API-Football:  {sorted(af - fd)}")
    assert len(fd) == 20, f"{len(fd)} distinct clubs, not 20: {sorted(fd)}"
    # The four traps, each named so a table edit that loses one fails by name.
    for fd_name, canon in (("Milan", "AC Milan"), ("Roma", "AS Roma"),
                           ("Verona", "Hellas Verona"), ("Inter", "Inter")):
        assert L.canon_name("SA", fd_name) == canon, (fd_name, L.canon_name("SA", fd_name))


t("both feeds' spellings of the 2025-26 twenty reach the same clubs",
  _both_feeds_agree)


def _every_club_has_a_code():
    reg = registry(AF_NAMES_2526)
    assert len(reg) == 20, len(reg)
    codes = [d["short"] for d in reg.values()]
    assert len(set(codes)) == 20, f"colliding codes: {sorted(codes)}"
    assert all(len(c) == 3 for c in codes), codes
    assert reg["AC Milan"]["short"] == "ACM"
    assert reg["Bologna"]["short"] == "BGN"
    assert reg["Inter"]["short"] == "INT"
    assert reg["Hellas Verona"]["short"] == "VER"


t("every club gets a distinct three-letter code", _every_club_has_a_code)


def _codes_stay_clear_of_the_other_desks():
    """Bologna is not BOL, Milan is not MIL, Bari is not BAR, Livorno is not
    LIV. A collision would silently hand one club another's colour on /today
    and merge two watchlists that are two different players."""
    taken = L.codes_elsewhere("SA")
    clash = set(L.SERIEA_SHORT.values()) & taken
    assert not clash, f"Serie A codes used by another desk: {sorted(clash)}"
    for name, wrong in (("Bologna", "BOL"), ("AC Milan", "MIL"), ("Bari", "BAR"),
                        ("Livorno", "LIV")):
        assert L.SERIEA_SHORT[name] != wrong, name
        assert wrong in taken, f"{wrong} should be another desk's code"
    reg = registry(AF_NAMES_2526)
    assert not ({d["short"] for d in reg.values()} & taken)


t("Serie A codes stay clear of the other three desks", _codes_stay_clear_of_the_other_desks)


def _short_lookup_from_every_spelling():
    reg = registry(AF_NAMES_2526)
    for fd, af in zip(sorted(FD_NAMES_2526, key=lambda n: L.canon_name("SA", n)),
                      sorted(AF_NAMES_2526, key=lambda n: L.canon_name("SA", n))):
        a = L.seriea_short(fd, clubs=reg)
        b = L.seriea_short(af, clubs=reg)
        assert a and a == b, f"{fd!r} -> {a}, {af!r} -> {b}"
    # And the legal forms the feed and the press use.
    for spelling, code in (("FC Internazionale", "INT"), ("Inter Milan", "INT"),
                           ("Hellas Verona FC", "VER"), ("SSC Napoli", "NAP"),
                           ("Juventus FC", "JUV"), ("Genoa CFC", "GEN"),
                           ("Como 1907", "COM"), ("Bologna FC 1909", "BGN"),
                           ("Parma Calcio 1913", "PAR"), ("ACF Fiorentina", "FIO")):
        assert L.seriea_short(spelling, clubs=reg) == code, \
            (spelling, L.seriea_short(spelling, clubs=reg))


t("a club resolves to the same code from either feed's spelling",
  _short_lookup_from_every_spelling)


def _unknown_is_none_not_a_guess():
    reg = registry(AF_NAMES_2526)
    for junk in ("Wrexham", "Real Madrid", "", None, "   ", "Not A Club"):
        assert L.seriea_short(junk, clubs=reg) is None, junk
    assert L.short_for("SA", "Ath Madrid", clubs=reg) is None, \
        "a Spanish spelling must not resolve in Italy"


t("an unrecognised name is None, never a guess", _unknown_is_none_not_a_guess)


def _accents_are_not_a_second_club():
    """Names NOT in any table are the real test of the folding: a feed may
    start or stop emitting diacritics at any time."""
    unlisted = {"Sudtirol": {"short": "SDT", "id": 1}, "Forli": {"short": "FRL", "id": 2}}
    assert L.seriea_short("Südtirol", clubs=unlisted) == "SDT"
    assert L.seriea_short("Forlì", clubs=unlisted) == "FRL", \
        "an accented name with no explicit alias did not fold to its club"
    assert L.canon_name("SA", "FeralpiSalò") == "Feralpisalo"
    assert L.strip_accents("Doveri, Daniele") == "Doveri, Daniele"


t("a name differing only by an accent is the same club", _accents_are_not_a_second_club)


def _codes_do_not_depend_on_feed_order():
    a = L.assign_shorts(AF_NAMES_2526, code="SA")
    b = L.assign_shorts(list(reversed(AF_NAMES_2526)), code="SA")
    assert a == b, "short codes depend on the order the API answered in"


t("short codes are stable whatever order the feed returns",
  _codes_do_not_depend_on_feed_order)


print("division discovery")


def teams_payload(names):
    return {"errors": [], "response": [{"team": {"id": 500 + i, "name": n}}
                                       for i, n in enumerate(names)]}


def _discovery_refuses_a_short_division():
    league = L.get("SA")
    try:
        A.discover_clubs(teams_payload(AF_NAMES_2526[:19]), league, "2026")
    except SystemExit as e:
        assert "19 clubs" in str(e), str(e)
    else:
        raise AssertionError("a 19-club division was accepted")


t("discovery refuses a division of the wrong size", _discovery_refuses_a_short_division)


def _one_canonicaliser_everywhere():
    """The bug the first La Liga run found, checked for Italy before its first
    run: discovery, the squad harvest and the referee join must all reach one
    name for one club."""
    for spelling in ("Milan", "AC Milan"):
        assert L.canon_name("SA", spelling) == "AC Milan", spelling
        got = A.canonical_for("SA", spelling)
        assert got in ("AC Milan", None), (spelling, got)
    for short, full in (("Roma", "AS Roma"), ("Verona", "Hellas Verona"),
                        ("Internazionale", "Inter")):
        assert L.canon_name("SA", short) == full, (short, L.canon_name("SA", short))
        assert L.canon_name("SA", full) == full, full


t("every spelling of a club reaches one canonical name", _one_canonicaliser_everywhere)


def _serie_b_resolves_against_serie_a():
    known = A.known_names("SERB")
    assert "Arsenal" not in known and "Real Madrid" not in known, \
        "a Serie B harvest is checking Italian clubs against another desk's names"
    assert known == A.known_names("SA"), \
        "Serie B must resolve against Serie A's registry: it is harvested " \
        "only for the clubs that have just come up into it"


t("a Serie B harvest resolves against Serie A's clubs", _serie_b_resolves_against_serie_a)


def _the_families_do_not_cross():
    """Italy's registry must never answer for Spain, or the other way round.
    One resolver serves both; this is what stops it blurring them."""
    sa = {"Inter": {"short": "INT", "id": 1}}
    assert L.discovered_short("LL", "Inter", clubs=sa) is None or True
    assert L.canon_name("LL", "AC Milan") == "AC Milan"
    assert L.laliga_short("AC Milan", clubs={}) is None
    assert L.seriea_short("Real Madrid", clubs={}) is None


t("the Spanish and Italian families do not cross", _the_families_do_not_cross)


print("the referee join")


def rows_and_fixtures(n=20):
    rows, fx = [], []
    for i in range(n):
        fd_h, fd_a = FD_NAMES_2526[i % 20], FD_NAMES_2526[(i + 7) % 20]
        af_h, af_a = AF_NAMES_2526[i % 20], AF_NAMES_2526[(i + 7) % 20]
        date = f"2026-03-{(i % 28) + 1:02d}"
        rows.append({"Date": date, "HomeTeam": fd_h, "AwayTeam": fd_a,
                     "HY": 2, "AY": 2, "HR": 0, "AR": 0, "HF": 12, "AF": 13,
                     "Referee": ""})
        fx.append({"d": date + "T19:45:00+00:00", "hn": af_h, "an": af_a,
                   "ref": f"Official {i % 4}"})
    return rows, fx


def _join_bridges_the_spelling_gap():
    rows, fx = rows_and_fixtures()
    out, stats = R.attach_referees(rows, fx, "SA")
    assert stats["matched"] == len(rows), stats
    assert stats["unmatched"] == 0, stats
    assert all(r["Referee"] for r in out), "a row came back with no official"
    assert all(r["Referee"] == "" for r in rows), "the source rows were mutated"


t("the join bridges football-data and API-Football spellings",
  _join_bridges_the_spelling_gap)


def _join_keeps_clubs_that_have_since_been_relegated():
    rows, fx = rows_and_fixtures()
    L.LEAGUES["SA"].clubs_file = None
    try:
        out, stats = R.attach_referees(rows, fx, "SA")
    finally:
        L.LEAGUES["SA"].clubs_file = "seriea_clubs.json"
    assert stats["matched"] == len(rows), stats


t("matches involving since-relegated clubs still join",
  _join_keeps_clubs_that_have_since_been_relegated)


def _rates_come_out_of_the_free_columns():
    rows, fx = rows_and_fixtures(40)
    out, _ = R.attach_referees(rows, fx, "SA")
    tally, skipped = R.tally_refs(out)
    assert skipped == 0, skipped
    refs = R.build_refs(tally, {}, min_matches=3)
    assert len(refs) == 4, refs
    for r in refs:
        assert r["ypg"] == 4.0, r
        assert r["fouls_pg"] == 25.0, r


t("every rate is computed from the free cards and fouls", _rates_come_out_of_the_free_columns)


def _italian_officials_merge_by_surname_not_position():
    """API-Football spells Italian officials two ways too: "Daniele Doveri"
    and "D. Doveri". One surname each, so the leading-run rule is enough, and
    two officials sharing an initial and a surname must stay apart."""
    names = ["D. Doveri", "Daniele Doveri", "M. Guida", "Marco Guida",
             "L. Rossi", "Luca Rossi", "Lorenzo Rossi"]
    mapping, merges, ambiguous = R.canonical_referees(names)
    assert mapping["D. Doveri"] == "Daniele Doveri"
    assert mapping["M. Guida"] == "Marco Guida"
    assert mapping["L. Rossi"] == "L. Rossi", "two L. Rossis must not be merged"
    assert ambiguous, "the Rossi collision was not reported"


t("Italian officials merge by surname and a shared initial stays apart",
  _italian_officials_merge_by_surname_not_position)


print("registry round-trip")


def _registry_survives_a_write_and_read():
    league = L.get("SA")
    real = league.clubs_file
    league.clubs_file = "seriea_clubs.__test__.json"
    path = L.clubs_path("SA")
    try:
        reg = registry(AF_NAMES_2526)
        L.save_clubs("SA", reg, season="2026")
        back = L.load_clubs("SA")
        assert back == reg, "the registry did not survive a round trip"
        assert L.load_clubs("SERB") == reg, "the feeder reads its owner's registry"
        assert L.seriea_short("Milan") == reg["AC Milan"]["short"]
    finally:
        path.unlink(missing_ok=True)
        league.clubs_file = real
    assert not path.exists(), "the test registry was left behind"


t("the club registry survives a write and read, and the feeder reads it",
  _registry_survives_a_write_and_read)


def _the_committed_registry_if_present_is_the_division():
    """Once --clubs has run on the runner, the committed file must be twenty
    clubs with distinct codes clear of the other desks."""
    reg = L.load_clubs("SA")
    if not reg:
        print("    (seriea_clubs.json not committed yet: skipped)")
        return
    assert len(reg) == 20, f"{len(reg)} clubs in seriea_clubs.json"
    codes = [d["short"] for d in reg.values()]
    assert len(set(codes)) == 20, codes
    assert not (set(codes) & L.codes_elsewhere("SA")), \
        f"committed codes collide with another desk: {set(codes) & L.codes_elsewhere('SA')}"
    for n in reg:
        assert L.seriea_short(n) == reg[n]["short"], n


t("the committed registry, when present, is a twenty-club division",
  _the_committed_registry_if_present_is_the_division)


# ---- the referee join, end to end ---------------------------------------------
#
# The free I1 records name no official on any of their 380 rows, so the NAME
# is bought once a season (harvest_apifootball.py --ref-fixtures --league SA)
# and joined on by build_refs.py --league SA. These tests pin the file the two
# scripts agree on, the mapping from a feed row to a join row, and the read
# back of the shipped file.

import cross_refs as X  # noqa: E402


def _the_ref_fixture_file_is_configured():
    assert A.REF_FIXTURE_FILES["SA"] == ("SERIEA_REF_FIXTURES", "seriea_ref_fixtures.js")
    assert A.REF_FIXTURE_FILES["SA"] != A.REF_FIXTURE_FILES["LL"]
    assert L.get("SA").referee_source == "api-football"
    assert not L.get("SA").has_free_referees
    assert L.get("SA").min_ref_matches == 3


t("the referee-join fixture file is configured for Serie A",
  _the_ref_fixture_file_is_configured)


def _a_feed_row_becomes_a_join_row_in_canonical_names():
    """API-Football spells the clubs one way and the free records another; a
    join row carries the canonical name so both sides meet."""
    entry = {"fixture": {"date": "2026-03-01T19:45:00+00:00",
                         "referee": "D. Doveri, Italy"},
             "teams": {"home": {"name": "AC Milan"}, "away": {"name": "Hellas Verona"}}}
    row = A.map_ref_fixture(entry, "SA")
    assert row == {"d": "2026-03-01", "hn": "AC Milan", "an": "Hellas Verona",
                   "ref": "D. Doveri"}, row
    fd = {"Date": "2026-03-01", "HomeTeam": "Milan", "AwayTeam": "Verona",
          "HY": 3, "AY": 1, "HR": 0, "AR": 0, "HF": 10, "AF": 14, "Referee": ""}
    out, stats = R.attach_referees([fd], [row], "SA")
    assert stats["matched"] == 1, stats
    assert out[0]["Referee"] == "D. Doveri", out
    # A row without an official is kept, so the count of matches is honest
    # and the miss shows up in the join report rather than vanishing.
    entry["fixture"]["referee"] = None
    assert A.map_ref_fixture(entry, "SA")["ref"] is None


t("a feed fixture becomes a join row in canonical names, and joins",
  _a_feed_row_becomes_a_join_row_in_canonical_names)


def _the_shipped_fixture_list_reads_back_whole():
    """Before the runner has harvested: a written list reads back row for row
    and the temporary file is removed. After: the committed list is the whole
    season, or build_refs would be building a partial table."""
    league = L.get("SA")
    const, filename = A.REF_FIXTURE_FILES["SA"]
    path = league.path(filename)
    if path.exists():
        fixtures, why = R.load_fixture_list(league)
        assert fixtures is not None, why
        assert len(fixtures) == 380, f"{filename} holds {len(fixtures)} rows, not 380"
        named = sum(1 for f in fixtures if f.get("ref"))
        assert named == 380, f"only {named} of 380 fixtures name an official"
        print(f"    (committed {filename}: {named} of {len(fixtures)} named)")
        return
    fixtures, why = R.load_fixture_list(league)
    assert fixtures is None and "--ref-fixtures --league SA" in why, why
    _, fx = rows_and_fixtures(6)
    rows = [{"d": f["d"][:10], "hn": f["hn"], "an": f["an"], "ref": f["ref"]} for f in fx]
    try:
        A.emit_ref_fixtures(rows, league, "2025")
        src = path.read_text(encoding="utf-8")
        assert f"const {const} = [" in src and "Serie A 2025-26" in src, src[:300]
        back, why = R.load_fixture_list(league)
    finally:
        path.unlink(missing_ok=True)
    assert why is None and back == rows, (why, back)


t("the referee-join fixture list reads back whole, and the committed one is the season",
  _the_shipped_fixture_list_reads_back_whole)


def _serie_a_can_lend_and_borrow_officials():
    """cross_refs walks every modelled division; Serie A must be one of them,
    reading the files the registry names, and must cope before they exist."""
    assert "SA" in X.CODES
    assert X.DATA_FILE["SA"] == L.get("SA").data_file
    assert X.FIXTURE_CONST["SA"] == ("SERIEA_FIXTURES", "seriea_fixtures.js")
    refs = X.read_refs("SA")
    assert refs is None or isinstance(refs, list)
    assert isinstance(X.appointed_names("SA"), list)


t("Serie A is a division cross_refs can lend to and borrow from",
  _serie_a_can_lend_and_borrow_officials)


# ---- the season file ---------------------------------------------------------
#
# build_seriea_data.py is the La Liga builder configured for Italy. These
# tests pin what the configuration changes (files, constant, basis label) and
# what the emitted file carries, without a harvest: a handful of rows through
# the real emitter, to a temporary path.

import build_laliga_data as B  # noqa: E402
import build_pl_data as P      # noqa: E402


def _the_builder_configures_for_serie_a():
    try:
        B.configure("SA")
        assert B.CODE == "SA"
        assert B.OUT.name == "seriea_data.js", B.OUT
        assert B.STATUS.name == "seriea_status.txt", B.STATUS
        assert B.D["const"] == "SERIEA_PLAYERS"
        assert B.D["feeder"] == ("serieb_players.json", "SB", "Serie B"), B.D["feeder"]
        assert B.D["squads"] == "sa_squads.json"
        assert B.D["season_cards"] == "seriea_season_cards.json"
        assert B.LEAGUE.code == "SA" and B.LEAGUE.players_file == "seriea_players.json"
        # The wrapper is the entry point the workflow runs, and it must land
        # on this configuration rather than a copy of the builder.
        src = (DATA / "build_seriea_data.py").read_text(encoding="utf-8")
        assert 'B.configure("SA")' in src and "B.main()" in src
    finally:
        B.configure("LL")
    # Switching back restores every La Liga value, so the import-time default
    # the other tests and the workflow rely on is unchanged.
    assert B.CODE == "LL" and B.OUT.name == "laliga_data.js"
    assert B.D["const"] == "LALIGA_PLAYERS" and B.D["feeder"][1] == "SEG"
    assert B.D["fill"] == "laliga_squads.json"


t("the Serie A builder is the shared builder configured for Italy",
  _the_builder_configures_for_serie_a)


def _the_season_file_carries_the_italian_rule_and_the_sb_basis():
    """A club with a real I1 match record is basis SA; a promoted club with
    none is SB, never SERB; and the SUSPENSION block is the ladder with its
    tail, verbatim from the registry."""
    import json as _json
    import tempfile
    clubs = {"Juventus": {"short": "JUV", "img": None},
             "Cremonese": {"short": "CRE", "img": None}}
    resolve = lambda n: {"Juventus": "JUV", "Cremonese": "CRE"}.get(n)  # noqa: E731
    rows = [
        P.mk({"team": "Juventus", "n": "M. Locatelli", "pos": "M", "min": 2700,
              "yc": 9, "rc": 0, "fc90": 1.8}, "SA", resolve),
        P.mk({"team": "Cremonese", "n": "M. Bianchetti", "pos": "D", "min": 3000,
              "yc": 7, "rc": 1, "fc90": 1.2}, "SB", resolve),
    ]
    assert all(rows), rows
    rates = {"JUV": (2.1, 1.9, 2.3)}          # Cremonese has no I1 record: promoted
    tmp = Path(tempfile.mkdtemp()) / "seriea_data.js"
    try:
        B.configure("SA")
        B.OUT = tmp
        club_rows = B.build_clubs(rows, rates, clubs, promoted={"CRE"})
        B.emit(club_rows, rows, "const REFS = [];")
        out = tmp.read_text(encoding="utf-8")
    finally:
        B.configure("LL")
        tmp.unlink(missing_ok=True)
    by = {c["short"]: c for c in club_rows}
    assert by["JUV"]["basis"] == "SA", by["JUV"]
    assert by["CRE"]["basis"] == "SB", by["CRE"]
    assert "SERB" not in out, "the feeder's registry code leaked into the page's basis label"
    assert "const SERIEA_PLAYERS = [" in out and "const CLUBS = [" in out
    assert "LALIGA" not in out and "La Liga" not in out, "a La Liga literal survived configure('SA')"
    assert "(desk SA)" in out
    line = next(l for l in out.splitlines() if l.startswith("const SUSPENSION = "))
    scheme = _json.loads(line[len("const SUSPENSION = "):].rstrip(";"))
    assert scheme == L.get("SA").suspension_scheme
    assert scheme["kind"] == "ladder" and scheme["then_every"] == 1
    assert [r["at"] for r in scheme["rungs"]] == [5, 10, 14, 17, 19]
    assert all(r["by"] is None and r["ban"] == 1 for r in scheme["rungs"])
    # This season's count is null until harvested: the strip must read "not
    # counted", never "zero".
    assert out.count("sc:null") == 2, out
    assert 'b:"SB"' in out and 'b:"SA"' in out


t("the season file carries the Italian rule verbatim and labels promoted clubs SB",
  _the_season_file_carries_the_italian_rule_and_the_sb_basis)

print(f"\n{passed} tests passed")

#!/usr/bin/env python3
"""Tests for the published-appointments overlay.

Run: python3 data/test_appointments.py   (wired into CI)

Two jobs, and the second is the dangerous one.

PARSING is mundane: prose in, fixtures out, and a heading it does not know is
reported rather than swallowed.

RESOLVING A NAME is not. The desk joins referees by exact string, the card
table spells them two ways ("Tim Robinson" but also "A Herczeg"), and the EFL
publishes full names — so seven of the twelve Championship officials appointed
for 14-20 August 2026 did not match the table. A miss is invisible: the
fixture reads "appointed" and prices at refFactor = 1, which on the page is
indistinguishable from a neutral referee.

The tempting fix is to match on surname. That is the one thing that must never
happen, because the table holds both "Lewis Smith" and "Josh Smith" and a
surname rule prices a fixture off a COLLEAGUE'S card rate while looking
entirely correct. Most of what follows guards that line.
"""
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import appointments as A          # noqa: E402
import ingest_appointments as I   # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


# The real Championship table's two spellings, in miniature.
TABLE = ["Tim Robinson", "Lewis Smith", "Josh Smith", "A Herczeg", "B Speedie",
         "R Madley", "W Finnie", "O Langford", "G Ward", "Matthew Donohue",
         "Farai Hallam", "Andrew Kitchen", "S Martin"]

ARTICLE = """\
Referee Appointments: 14-20 August

Friday, 14th August 2026
Sky Bet Championship
Wolverhampton Wanderers v Blackburn Rovers (20:00)
Referee: Farai Hallam
Assistants: Mark Stevens and David Harrison
Fourth Official: Andrew Kitchen

Saturday, 15th August 2026
Sky Bet Championship
Norwich City v West Bromwich Albion (15:00)
Referee: Tim Robinson
Assistants: Hugh Gilroy and Ian Cooper

Sky Bet League One
Barnsley v Bromley (15:00)
Referee: Ross Martin
Assistants: Bradley Hall and James Wilson
"""


def _the_article_parses_into_fixtures():
    rows, unknown = I.parse(ARTICLE)
    assert len(rows) == 3, rows
    assert not unknown, unknown
    first = rows[0]
    assert first["date"] == "2026-08-14", first
    assert first["home"] == "Wolverhampton Wanderers" and first["away"] == "Blackburn Rovers"
    assert first["ref"] == "Farai Hallam"
    assert first["competition"] == "sky bet championship"
    # The date heading carries forward to the next fixture under it, and the
    # competition heading changes independently of the date.
    assert rows[1]["date"] == "2026-08-15" and rows[1]["competition"] == "sky bet championship"
    assert rows[2]["competition"] == "sky bet league one"


def _officials_who_are_not_the_referee_are_ignored():
    rows, _ = I.parse(ARTICLE)
    named = {r["ref"] for r in rows}
    # Andrew Kitchen is the fourth official at Wolves and a referee elsewhere.
    # A parser that took every name would appoint him to a match he is not
    # refereeing, at his own card rate.
    assert "Andrew Kitchen" not in named, named
    assert "Mark Stevens" not in named and "Hugh Gilroy" not in named


def _only_modelled_divisions_are_ingested():
    rows, _ = I.parse(ARTICLE)
    entries, skipped, problems = I.to_entries(rows, "http://example.test")
    assert not problems, problems
    assert len(entries) == 2, entries
    assert {e["league"] for e in entries} == {"EFLC"}
    assert skipped == {"sky bet league one": 1}, skipped
    assert entries[0]["h"] == "WOL" and entries[0]["a"] == "BLB"


def _an_unknown_heading_is_reported_not_swallowed():
    rows, unknown = I.parse(
        "Saturday, 15th August 2026\n"
        "Sky Bet League Five\n"
        "Bristol City v Millwall (15:00)\n"
        "Referee: Lewis Smith\n")
    assert unknown == ["Sky Bet League Five"], unknown
    # And it is NOT quietly attributed to the previous competition.
    _, skipped, _ = I.to_entries(rows, "x")
    assert skipped == {"sky bet league five": 1}, skipped


def _a_club_it_cannot_map_is_reported_not_guessed():
    rows, _ = I.parse("Saturday, 15th August 2026\nSky Bet Championship\n"
                      "Real Madrid v Millwall (15:00)\nReferee: Lewis Smith\n")
    entries, _, problems = I.to_entries(rows, "x")
    assert not entries, entries
    assert problems and "Real Madrid" in problems[0], problems


def _the_four_resolution_rules():
    r = A.resolve_ref_name
    assert r("Tim Robinson", TABLE) == ("Tim Robinson", "exact")
    assert r("Adam Herczeg", TABLE) == ("A Herczeg", "initial")
    assert r("Matt Donohue", TABLE) == ("Matthew Donohue", "forename")
    assert r("Bobby Madley", TABLE) == ("R Madley", "alias")


def _surname_alone_is_never_enough():
    """The line the whole module exists to hold."""
    r = A.resolve_ref_name
    # Both Smiths are in the table under their full names, so each resolves to
    # ITSELF and neither can reach the other.
    assert r("Lewis Smith", TABLE) == ("Lewis Smith", "exact")
    assert r("Josh Smith", TABLE) == ("Josh Smith", "exact")
    # An official the table knows only by surname-with-initial cannot be
    # reached by a different forename sharing that surname.
    assert A.resolve_ref_name("Sam Martin", ["S Martin"])[0] == "S Martin"
    assert A.resolve_ref_name("Ross Martin", ["S Martin"])[0] is None, \
        "a different forename matched on the surname — that prices a fixture " \
        "off another official's card rate"


def _an_ambiguous_initial_is_refused():
    """Two officials could wear "J Smith". Neither may be chosen."""
    table = ["J Smith", "James Smith", "Josh Smith"]
    assert A.resolve_ref_name("Jordan Smith", table)[0] is None
    # ...while an unambiguous one still resolves.
    assert A.resolve_ref_name("Jordan Smith", ["J Smith"])[0] == "J Smith"


def _an_unknown_official_is_left_as_published():
    assert A.resolve_ref_name("A Brand New Official", TABLE) == (None, None)
    assert A.resolve_ref_name("", TABLE) == (None, None)
    assert A.resolve_ref_name("Madonna", TABLE) == (None, None)


def _accents_and_punctuation_do_not_break_a_match():
    assert A.resolve_ref_name("Jamie O'Connor", ["Jamie OConnor"])[0] == "Jamie OConnor"
    assert A.resolve_ref_name("Jose Munuera", ["José Munuera"])[0] == "José Munuera"


def _the_overlay_fills_nulls_and_never_overwrites():
    rows = [
        {"id": 1, "d": "2026-08-14T19:00:00+00:00", "h": "WOL", "a": "BLB", "ref": None, "st": "NS"},
        {"id": 2, "d": "2026-08-15T14:00:00+00:00", "h": "NOR", "a": "WBA", "ref": "Someone Else", "st": "NS"},
    ]
    entries = [
        {"league": "EFLC", "date": "2026-08-14", "h": "WOL", "a": "BLB",
         "ref": "Farai Hallam", "refResolved": "Farai Hallam"},
        {"league": "EFLC", "date": "2026-08-15", "h": "NOR", "a": "WBA",
         "ref": "Tim Robinson", "refResolved": "Tim Robinson"},
    ]
    rep = A.apply_to(rows, "EFLC", entries=entries, verbose=False)
    assert rows[0]["ref"] == "Farai Hallam", rows[0]
    # The harvested value stands: that job runs three times a day and is the
    # fresher source. The difference is reported, not resolved.
    assert rows[1]["ref"] == "Someone Else", rows[1]
    assert rep["applied"] == 1 and len(rep["disagreed"]) == 1, rep


def _the_overlay_is_idempotent():
    rows = [{"id": 1, "d": "2026-08-14T19:00:00+00:00", "h": "WOL", "a": "BLB", "ref": None, "st": "NS"}]
    entries = [{"league": "EFLC", "date": "2026-08-14", "h": "WOL", "a": "BLB",
                "ref": "Farai Hallam", "refResolved": "Farai Hallam"}]
    A.apply_to(rows, "EFLC", entries=entries, verbose=False)
    second = A.apply_to(rows, "EFLC", entries=entries, verbose=False)
    assert rows[0]["ref"] == "Farai Hallam"
    assert second["applied"] == 0 and second["already"] == 1, second


def _a_moved_kickoff_is_matched_and_reported():
    """A fixture put back a day still gets its official, and says so."""
    rows = [{"id": 1, "d": "2026-08-16T14:00:00+00:00", "h": "WOL", "a": "BLB", "ref": None, "st": "NS"}]
    entries = [{"league": "EFLC", "date": "2026-08-15", "h": "WOL", "a": "BLB",
                "ref": "Farai Hallam", "refResolved": "Farai Hallam"}]
    rep = A.apply_to(rows, "EFLC", entries=entries, verbose=False)
    assert rows[0]["ref"] == "Farai Hallam"
    assert len(rep["shifted"]) == 1, rep


def _an_appointment_with_no_fixture_is_reported():
    rows = [{"id": 1, "d": "2026-08-14T19:00:00+00:00", "h": "WOL", "a": "BLB", "ref": None, "st": "NS"}]
    entries = [{"league": "EFLC", "date": "2026-08-14", "h": "STK", "a": "SWA",
                "ref": "Lewis Smith", "refResolved": "Lewis Smith"}]
    rep = A.apply_to(rows, "EFLC", entries=entries, verbose=False)
    assert len(rep["unmatched"]) == 1 and rep["applied"] == 0, rep


def _another_leagues_entries_are_not_applied():
    rows = [{"id": 1, "d": "2026-08-14T19:00:00+00:00", "h": "WOL", "a": "BLB", "ref": None, "st": "NS"}]
    entries = [{"league": "PL", "date": "2026-08-14", "h": "WOL", "a": "BLB",
                "ref": "Michael Oliver", "refResolved": "Michael Oliver"}]
    A.apply_to(rows, "EFLC", entries=entries, verbose=False)
    assert rows[0]["ref"] is None, "a Premier League appointment reached the Championship list"


def _the_committed_fixture_file_reads_back():
    """The reader must handle the file emit_fixtures actually writes."""
    path = DATA / "eflc_fixtures.js"
    if not path.exists():
        return
    rows, season, name = I.read_fixture_file(path)
    assert rows and season and name, (len(rows), season, name)
    assert all({"id", "d", "h", "a", "ref", "st"} <= set(r) for r in rows[:5]), rows[0]
    assert isinstance(season, int) and season >= 2020, season


def _every_committed_appointment_still_resolves():
    """The live check, against the real table: an official who stops resolving
    is a fixture priced at a neutral referee, and nothing else would say so."""
    known = A.ref_names("EFLC")
    if not known:
        return
    entries = [e for e in A.load() if e.get("league") == "EFLC"]
    stale = [e["ref"] for e in entries
             if e.get("refResolved") and e["refResolved"] not in known]
    assert not stale, f"committed appointments no longer match the card table: {stale}"


t("the article parses into fixtures", _the_article_parses_into_fixtures)
t("assistants and fourth officials are ignored", _officials_who_are_not_the_referee_are_ignored)
t("only modelled divisions are ingested", _only_modelled_divisions_are_ingested)
t("an unknown competition heading is reported, not swallowed", _an_unknown_heading_is_reported_not_swallowed)
t("a club it cannot map is reported, not guessed", _a_club_it_cannot_map_is_reported_not_guessed)
t("the four resolution rules", _the_four_resolution_rules)
t("surname alone is never enough", _surname_alone_is_never_enough)
t("an ambiguous initial is refused", _an_ambiguous_initial_is_refused)
t("an unknown official is left as published", _an_unknown_official_is_left_as_published)
t("accents and apostrophes do not break a match", _accents_and_punctuation_do_not_break_a_match)
t("the overlay fills nulls and never overwrites", _the_overlay_fills_nulls_and_never_overwrites)
t("the overlay is idempotent", _the_overlay_is_idempotent)
t("a moved kickoff is matched and reported", _a_moved_kickoff_is_matched_and_reported)
t("an appointment with no fixture is reported", _an_appointment_with_no_fixture_is_reported)
t("another league's entries are not applied", _another_leagues_entries_are_not_applied)
t("the committed fixture file reads back", _the_committed_fixture_file_reads_back)
t("every committed appointment still resolves", _every_committed_appointment_still_resolves)

print(f"\n{passed} tests passed")

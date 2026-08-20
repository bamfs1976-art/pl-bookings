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


# --- the RFEF designation sheet -------------------------------------------
#
# Spain publishes a table, not prose, and the referee sits on the same
# extracted line as the FOURTH OFFICIAL: "Árbitro:Name    4º Árbitro:Other".
# "4º Árbitro" contains "Árbitro", so a naive search finds whichever comes
# first and a naive capture swallows both. Either way the match is priced off
# a man who never refereed it, which is the one failure this file exists to
# refuse — and it would look entirely correct on the page.

RFEF_SHEET = """Competición: Campeonato Nacional de Liga de Primera División   Jornada - 1
TEMPORADA 2026-2027
15-08-2026            Deportivo Alavés          Getafe CF          19:30
Árbitro:Manuel Jesús Orellana              4º Árbitro:José Antonio Palomares
A. Asistente 1: Iván Ríos                  VAR: Carlos Del Cerro
A. Asistente 2: Roberto Tejero             AVAR: Álvaro Moreno
Oficial Informador: Iñaki Vicandi
15-08-2026            Sevilla FC        Rayo Vallecano de Madrid       21:30
Árbitro:Ricardo De Burgos                  4º Árbitro:Manuel García
A. Asistente 1: Iker De Francisco          VAR: Daniel Jesús Trujillo
A. Asistente 2: Asier Pérez De Mendiola    AVAR: Alejandro Muñiz
Oficial Informador: Alfonso Baena
"""


def _the_rfef_sheet_parses_to_its_two_fixtures():
    rows = I.parse_rfef(RFEF_SHEET)
    assert len(rows) == 2, f"parsed {len(rows)} fixtures, expected 2: {rows}"
    a, b = rows
    assert a["date"] == "2026-08-15" and a["ko"] == "19:30", a
    assert a["home"] == "Deportivo Alavés" and a["away"] == "Getafe CF", a
    assert b["home"] == "Sevilla FC" and b["away"] == "Rayo Vallecano de Madrid", b


t("an RFEF designation sheet parses to its fixtures",
  _the_rfef_sheet_parses_to_its_two_fixtures)


def _the_fourth_official_is_never_read_as_the_referee():
    rows = I.parse_rfef(RFEF_SHEET)
    refs = [r["ref"] for r in rows]
    assert refs == ["Manuel Jesús Orellana", "Ricardo De Burgos"], refs
    # Named explicitly: these two are the fourth officials on that sheet and
    # must appear nowhere in the parsed output at all.
    for fourth in ("Palomares", "Manuel García"):
        for r in rows:
            assert fourth not in (r["ref"] or ""), (
                f"the fourth official {fourth!r} was read as a referee: {r}")
    # Nor may the VAR or the assistants be picked up.
    for other in ("Carlos Del Cerro", "Iván Ríos", "Alejandro Muñiz", "Iñaki Vicandi"):
        assert all(other not in (r["ref"] or "") for r in rows), other


t("the fourth official is never read as the referee",
  _the_fourth_official_is_never_read_as_the_referee)


def _the_rfef_clubs_and_referees_resolve():
    import leagues
    rows = I.parse_rfef(RFEF_SHEET)
    entries, skipped, problems = I.to_entries(rows, "test://sheet")
    assert not problems, problems
    assert len(entries) == 2, (entries, skipped)
    assert [e["h"] for e in entries] == ["ALA", "SEV"], entries
    assert [e["a"] for e in entries] == ["GET", "RAY"], entries
    # De Burgos resolves through the contiguous-surname rule; the card table
    # spells him "Ricardo De Burgos Bengoetxea" and the CTA does not.
    seville = entries[1]
    assert seville["refResolved"] == "Ricardo De Burgos Bengoetxea", seville
    # Orellana is genuinely new to the division: no card record, and the
    # published name is KEPT rather than resolved to a colleague.
    alaves = entries[0]
    assert alaves["refResolved"] is None, alaves
    assert alaves["ref"] == "Manuel Jesús Orellana", alaves


t("RFEF clubs and referees resolve, and a new official is left unresolved",
  _the_rfef_clubs_and_referees_resolve)


def _the_fourth_official_first_on_the_line_is_still_not_the_referee():
    # PDF text extraction does not promise column order. If the fourth
    # official comes out FIRST, cutting at "4º Árbitro" leaves nothing before
    # it — and the correct outcome is to find no referee for that fixture and
    # say so, never to fall through and take the fourth official's name.
    sheet = RFEF_SHEET.replace(
        "Árbitro:Ricardo De Burgos                  4º Árbitro:Manuel García",
        "4º Árbitro:Manuel García                  Árbitro:Ricardo De Burgos")
    rows = I.parse_rfef(sheet)
    for r in rows:
        assert "Manuel García" not in (r["ref"] or ""), (
            f"the fourth official was read as the referee: {r}")


t("a fourth official printed first is still not the referee",
  _the_fourth_official_first_on_the_line_is_still_not_the_referee)


def _a_club_the_sheet_spells_legally_still_maps():
    # The registry holds short names; the RFEF prints legal ones. This is the
    # only reason the two clubs above resolve at all, so it is asserted
    # directly rather than left implied by the sheet test.
    import leagues
    assert leagues.short_for("LL", "Getafe CF") == "GET"
    assert leagues.short_for("LL", "Sevilla FC") == "SEV"
    assert leagues.short_for("LL", "Rayo Vallecano de Madrid") == "RAY"
    assert leagues.short_for("LL", "Real Madrid CF") == "RMA"
    # And an ending that leaves nothing recognisable resolves to nothing,
    # rather than to half a name.
    assert leagues.short_for("LL", "Nonexistent United FC") is None


t("a club the sheet spells legally still maps to its short code",
  _a_club_the_sheet_spells_legally_still_maps)

def _two_muniz_officials_on_one_sheet():
    """Carlos Muñiz refereed ESP v LEV; Alejandro Muñiz was its AVAR.

    The nearest miss this join has had on real data. One designation sheet, one
    fixture, two officials sharing a surname — and only Alejandro is in the
    card table. A surname-only join would have priced that match off HIS 4.83
    yellows a game, well above the division's, and nothing on the page would
    have looked wrong: a named referee and a plausible number.

    The first initial is what refuses it, so that is what this pins.
    """
    names = ["Alejandro Muñiz Ruiz"]
    assert A.resolve_ref_name("Carlos Muñiz", names) == (None, None), (
        "Carlos Muñiz resolved to a colleague who shares his surname")
    # The same rule must still resolve the man who IS on the table, or the
    # refusal above is just a join that has stopped working.
    got, how = A.resolve_ref_name("Alejandro Muñiz", names)
    assert got == "Alejandro Muñiz Ruiz" and how, "the real Muñiz stopped resolving"
    # A bare surname carries no initial and must never resolve.
    assert A.resolve_ref_name("Muñiz", names) == (None, None)
    # With both on the table, each finds its own and neither the other's.
    both = ["Alejandro Muñiz Ruiz", "Carlos Muñiz Fernández"]
    assert A.resolve_ref_name("Carlos Muñiz", both)[0] == "Carlos Muñiz Fernández"
    assert A.resolve_ref_name("Alejandro Muñiz", both)[0] == "Alejandro Muñiz Ruiz"


t("two Muñiz officials on one sheet are not merged",
  _two_muniz_officials_on_one_sheet)


def _the_sunday_sheet_parses_as_published():
    """The real jornada-1 Sunday sheet, byte for byte off the PDF.

    Two things here have bitten this parser: the referee and the FOURTH
    official share a line, and there is no space after "Árbitro:". Both are in
    the fixture below exactly as the sheet prints them.
    """
    text = (
        "Competición: Campeonato Nacional de Liga de Primera División\n"
        "16-08-2026 | Real Racing Club de Santander | Villarreal CF | 17:00\n"
        "Árbitro:Miguel Sesma                        4º Árbitro:Fernando Román\n"
        "A. Asistente 1: Ion Rodríguez               VAR: Luis Mario Milla\n"
        "16-08-2026 | RCD Espanyol de Barcelona | Levante UD | 19:00\n"
        "Árbitro:Carlos Muñiz                        4º Árbitro:Antonio Sánchez\n"
        "A. Asistente 2: Álvaro Granel               AVAR: Alejandro Muñiz\n"
    )
    rows = I.parse_rfef(text)
    assert len(rows) == 2, f"expected two fixtures, got {len(rows)}"
    assert rows[0]["home"] == "Real Racing Club de Santander"
    assert rows[0]["away"] == "Villarreal CF"
    assert rows[0]["ref"] == "Miguel Sesma", (
        f"read {rows[0]['ref']!r} — the fourth official is on the same line")
    assert rows[1]["ref"] == "Carlos Muñiz", (
        f"read {rows[1]['ref']!r} — the AVAR is the OTHER Muñiz")
    # The fourth officials must not have been read as referees anywhere.
    assert "Fernando Román" not in [r["ref"] for r in rows]
    assert "Antonio Sánchez" not in [r["ref"] for r in rows]


t("the published Sunday sheet parses, fourth officials and all",
  _the_sunday_sheet_parses_as_published)

def _a_compound_given_name_is_not_a_surname():
    """"Francisco José Hernández" is Francisco Hernandez Maeso.

    The CTA prints both given names; the card table carries one. Read
    positionally the published surnames are ["jose", "hernandez"] and the
    table's are ["hernandez", "maeso"] — neither is a contiguous run of the
    other, so every rule up to and including `run` finds nothing and a fixture
    with a perfectly good card record prices at the league rate.
    """
    table = ["Francisco Hernandez Maeso", "Alejandro Hernandez"]
    got, how = A.resolve_ref_name("Francisco José Hernández", table)
    assert got == "Francisco Hernandez Maeso", f"resolved to {got!r}"
    assert how == "given2", (
        f"resolved by {how!r} — the tier must be visible in the ingest log, "
        "not pass as a plain run")

    # THE OTHER HERNÁNDEZ IS THE POINT. Alejandro shares the surname and is
    # more than a card a game stricter; the first initial is all that separates
    # them, and dropping a token must not drop that too.
    assert A.resolve_ref_name("Alejandro José Hernández", table)[0] == "Alejandro Hernandez"
    assert A.resolve_ref_name("José Hernández", table) == (None, None), (
        "a José who is neither of them took one of their records")

    # AMBIGUITY STILL REFUSES. Two officials who would both match once the
    # second token is dropped is not a lookup.
    two = ["Francisco Hernandez Maeso", "Francisco Hernandez Pastor"]
    assert A.resolve_ref_name("Francisco José Hernández", two) == (None, None)

    # AND IT MUST NOT FIRE WHERE A REAL SURNAME WOULD BE DROPPED. Every one of
    # these resolves by an earlier rule; if any starts coming back "given2",
    # the tier has stopped being a last resort.
    ll = A.ref_names("LL")
    for published in ("Juan Martinez Munuera", "Jose Luis Munuera Montero",
                      "Jose Maria Sanchez Martinez", "Miguel Angel Ortiz Arias",
                      "Mateo Busquets Ferrer"):
        got, how = A.resolve_ref_name(published, ll)
        assert got and how != "given2", f"{published!r} resolved by {how!r}"

    # A SWEEP, not a handful: no official on any desk may resolve to a
    # different one once a second given name is assumed.
    for code in ("PL", "EFLC", "LL"):
        names = A.ref_names(code)
        for n in names:
            assert A.resolve_ref_name(n, names)[0] == n, f"{code}: {n!r} stopped resolving"
            toks = n.split()
            if len(toks) < 3:
                continue
            probe = f"{toks[0]} {toks[1]} {toks[-1]}"
            hit, tier = A.resolve_ref_name(probe, names)
            assert not (tier == "given2" and hit != n), (
                f"{code}: {probe!r} -> {hit!r} via given2, but it is {n!r}")


t("a compound given name is not a surname", _a_compound_given_name_is_not_a_surname)


def _the_monday_sheet_parses_with_two_franciscos():
    """One line, two officials called Francisco — the referee and the fourth.

    The fourth official is cut off BEFORE the referee is read, so the only way
    to get this wrong is to stop doing that. "Francisco García" has no card
    record, so reading him as the referee would price the fixture at the league
    rate instead of the most lenient whistle in the division — a quiet 30%
    error in every card line on that match.
    """
    text = (
        "17-08-2026 | RC Deportivo | Elche CF | 21:00\n"
        "Árbitro:Francisco José Hernández            4º Árbitro:Francisco García\n"
        "A. Asistente 2: Abraham Pérez               AVAR: Guillermo Cuadra\n"
    )
    rows = I.parse_rfef(text)
    assert len(rows) == 1
    assert rows[0]["ref"] == "Francisco José Hernández", (
        f"read {rows[0]['ref']!r} — the fourth official shares the line AND the "
        "given name")
    assert rows[0]["home"] == "RC Deportivo" and rows[0]["away"] == "Elche CF"


t("the Monday sheet parses with two officials called Francisco",
  _the_monday_sheet_parses_with_two_franciscos)


def _an_abbreviated_harvest_yields_to_the_sheet_that_named_the_man():
    """The one case where the overlay overrules the harvest, and its limits.

    API-Football harvested Rayo v Alavés as "J. Munuera"; the RFEF sheet named
    José Luis Munuera Montero. One man, two spellings, and only one of them
    reaches a card record — La Liga has TWO Munueras, so matchRefName rightly
    refuses the abbreviation and the fixture priced at the league rate, which
    on the page is indistinguishable from no referee at all.

    A hand edit could not fix it: the harvest rewrites that file three times a
    day. So the rule lives in the overlay, and everything below is its bounds.
    """
    LL = ["José Luis Munuera Montero", "Juan Martinez Munuera",
          "Adrian Cordero Vega", "Jesus Gil Manzano"]

    # FIRES: the abbreviation prices nothing, the sheet's spelling does, and
    # the two are the same official.
    assert A.supersedes("J. Munuera", "José Luis Munuera Montero", set(LL))

    # REFUSED — a genuine change of official. This is the whole reason the
    # harvest wins by default, and it must survive the exception.
    assert not A.supersedes("Adrian Cordero Vega", "Jesus Gil Manzano", set(LL))
    # REFUSED — the harvested name already prices. Fresher AND priceable wins.
    assert not A.supersedes("Juan Martinez Munuera", "José Luis Munuera Montero", set(LL))
    # REFUSED — an abbreviation of somebody else entirely.
    assert not A.supersedes("J. Manzano", "José Luis Munuera Montero", set(LL))
    # REFUSED — neither spelling prices, so swapping them would only hide that
    # the card table has never heard of the man. "C. Muniz" is the live case.
    assert not A.supersedes("C. Muniz", "Carlos Muñiz", set(LL))

    # And end to end, on a fixture row: the swap happens, and it is REPORTED
    # rather than done quietly — this is the one place the harvest is overruled.
    rows = [{"id": 1, "d": "2026-08-20T19:00:00+00:00", "h": "RAY", "a": "ALA",
             "ref": "J. Munuera", "st": "NS"}]
    entries = [{"league": "LL", "date": "2026-08-20", "h": "RAY", "a": "ALA",
                "ref": "José Luis Munuera", "refResolved": "José Luis Munuera Montero"}]
    saved = A.ref_names
    try:
        A.ref_names = lambda code: LL
        rep = A.apply_to(rows, "LL", entries=entries, verbose=False)
    finally:
        A.ref_names = saved
    assert rows[0]["ref"] == "José Luis Munuera Montero", rows[0]
    assert len(rep["clarified"]) == 1 and not rep["disagreed"], rep


t("an abbreviated harvest yields to the sheet that named the man",
  _an_abbreviated_harvest_yields_to_the_sheet_that_named_the_man)

print(f"\n{passed} tests passed")

#!/usr/bin/env python3
"""
UEFA's published league-phase calendar, for the weeks API-Football has not
got dates for yet.

WHY THIS EXISTS. The league-phase draw is made in late August and UEFA
publishes the full calendar the same week — eight matchdays in the
Champions and Europa Leagues, six in the Conference League. API-Football
creates the fixtures as soon as the pairings are known but, until it
ingests the calendar, stamps every one of them with a single provisional
kick-off. The harvest then emits a club's whole league phase at one
instant, split evenly home and away.

That is not a small inaccuracy. A club cannot play eight matches at one
moment, so every row in the block is wrong, and the block is indis-
tinguishable from real data downstream: rest days computed from it read
one enormous pile-up and nothing at all for the rest of the autumn. It
has shipped twice — the 2026-27 Champions League block in August, and the
Europa League block still in the file at the time of writing.

WHAT THIS IS. The calendar as UEFA published it, transcribed for English
clubs only, in UEFA's own local time. It is deliberately NOT a full copy
of the draw: the harvest only ever keeps English clubs, so the rest would
be dead weight that still has to be maintained.

HOW IT IS USED. harvest_other_fixtures.py substitutes these rows for a
competition whose API rows are a placeholder block, and only then. Once
API-Football ingests the real calendar no block is detected and this file
is ignored, so it ages out on its own rather than needing to be removed.

SOURCE. editorial.uefa.com, 2026/27 league-phase fixture lists, read from
the per-club (pot) listings and cross-checked row by row against the
by-matchday listings — two independent renderings of the same draw. Every
club is asserted to hold its competition's full complement of ties, split
evenly home and away: the format's own invariant, and what catches a
venue read off the wrong line.
"""
from datetime import date

# Central European time is what UEFA publishes in, and the switch to
# winter time falls inside the league phase — matchday three is CEST and
# matchday four is CET. The harvest emits UTC, so the offset has to be
# right or every autumn kick-off lands an hour out.
#
# 2026: summer time runs 29 March to 25 October.
# 2027: summer time starts 28 March, after the league phase has finished.
CEST_FROM = date(2026, 3, 29)
CEST_UNTIL = date(2026, 10, 25)      # exclusive — the 25th is already CET


def utc_offset_hours(on):
    """+2 while Central European Summer Time is in force, else +1."""
    return 2 if CEST_FROM <= on < CEST_UNTIL else 1


def to_utc_iso(day, local_hhmm):
    """A UEFA local date and time as the ISO instant the harvest emits.

    Matches harvest_other_fixtures.py's own output convention exactly:
    an offset-bearing ISO 8601 string written in UTC, e.g. a 21:00 CEST
    kick-off as "2026-09-17T19:00:00+00:00".
    """
    hh, mm = (int(x) for x in local_hhmm.split(":"))
    minutes = hh * 60 + mm - utc_offset_hours(day) * 60
    if minutes < 0:                  # a kick-off that lands the previous day
        raise ValueError("kick-off before midnight UTC is not a UEFA slot")
    return "%sT%02d:%02d:00+00:00" % (day.isoformat(), minutes // 60, minutes % 60)


D = date

# How many ties a club plays in each league phase. The Conference League
# runs six matchdays where the other two run eight, so a single hard-coded
# 8 in the self-check would have rejected correct Conference League data —
# and a check that cries wolf gets removed rather than fixed.
TIES_PER_CLUB = {"UCL": 8, "UEL": 8, "UECL": 6}

# (season start year, competition) -> {club short code: [(date, local time, venue)]}
#
# Season 2026 is 2026-27. Venues are from the club's own listing: (H) or (A)
# beside the opponent.
LEAGUE_PHASE = {
    (2026, "UEL"): {
        # Crystal Palace F.C.
        "CRY": [
            (D(2026, 9, 17), "21:00", "H"),   # KKS Lech Poznan
            (D(2026, 10, 15), "18:45", "A"),  # Olympique Lyonnais
            (D(2026, 10, 22), "21:00", "A"),  # Besiktas JK
            (D(2026, 11, 5), "18:45", "H"),   # TSG 1899 Hoffenheim
            (D(2026, 11, 26), "21:00", "H"),  # Real Sociedad de Futbol
            (D(2026, 12, 10), "18:45", "A"),  # Jagiellonia Bialystok
            (D(2027, 1, 21), "21:00", "H"),   # AC Sparta Praha
            (D(2027, 1, 28), "21:00", "A"),   # FC Salzburg
        ],
        # AFC Bournemouth
        "BOU": [
            (D(2026, 9, 17), "21:00", "A"),   # Real Sociedad de Futbol
            (D(2026, 10, 15), "21:00", "H"),  # SK Sturm Graz
            (D(2026, 10, 22), "21:00", "H"),  # AC Milan
            (D(2026, 11, 5), "18:45", "A"),   # AC Sparta Praha
            (D(2026, 11, 26), "18:45", "A"),  # Real Club Celta
            (D(2026, 12, 10), "21:00", "H"),  # FC Viktoria Plzen
            (D(2027, 1, 21), "18:45", "A"),   # Lillestrom SK
            (D(2027, 1, 28), "21:00", "H"),   # Hapoel Beer-Sheva FC
        ],
        # Sunderland AFC
        "SUN": [
            (D(2026, 9, 16), "21:00", "H"),   # AZ Alkmaar
            (D(2026, 10, 15), "18:45", "A"),  # SCU Torreense
            (D(2026, 10, 22), "18:45", "A"),  # KKS Lech Poznan
            (D(2026, 11, 5), "21:00", "H"),   # GNK Dinamo
            (D(2026, 11, 26), "21:00", "H"),  # Jagiellonia Bialystok
            (D(2026, 12, 10), "21:00", "A"),  # AC Milan
            (D(2027, 1, 21), "21:00", "A"),   # RSC Anderlecht
            (D(2027, 1, 28), "21:00", "H"),   # PFC Levski Sofia
        ],
    },
    (2026, "UECL"): {
        # Brighton & Hove Albion — the only English club in it. Six
        # matchdays, so three home and three away.
        "BHA": [
            (D(2026, 10, 15), "21:00", "H"),  # FK Kauno Zalgiris
            (D(2026, 10, 22), "18:45", "A"),  # FK Jablonec
            (D(2026, 11, 5), "21:00", "A"),   # Getafe CF
            (D(2026, 11, 26), "18:45", "H"),  # Universitatea Craiova
            (D(2026, 12, 10), "21:00", "H"),  # AS Monaco
            (D(2026, 12, 17), "21:00", "A"),  # Panathinaikos FC
        ],
    },
}


def rows_for(season, comp):
    """Curated rows for one competition-season, in the harvest's own shape.

    Returns [] when nothing is curated, so the caller can treat "no
    override available" and "override empty" as the same thing.
    """
    table = LEAGUE_PHASE.get((int(season), comp))
    if not table:
        return []
    out = []
    for club, ties in sorted(table.items()):
        for day, local, venue in ties:
            out.append({"c": club, "d": to_utc_iso(day, local),
                        "comp": comp, "v": venue})
    return sorted(out, key=lambda r: (r["d"], r["c"]))


def self_check():
    """The format's own invariants, asserted over everything curated here.

    Cheap enough to run on import from the tests, and it is the check that
    catches the realistic transcription error: a venue read off the wrong
    line, which shows up as a club with five homes and three aways.
    """
    problems = []
    for (season, comp), table in sorted(LEAGUE_PHASE.items()):
        want = TIES_PER_CLUB.get(comp)
        if want is None:
            problems.append(f"{season} {comp}: no tie count known for this competition")
            continue
        half = want // 2
        for club, ties in sorted(table.items()):
            if len(ties) != want:
                problems.append(f"{season} {comp} {club}: {len(ties)} ties, expected {want}")
            homes = sum(1 for _, _, v in ties if v == "H")
            aways = sum(1 for _, _, v in ties if v == "A")
            if homes != half or aways != half:
                problems.append(f"{season} {comp} {club}: {homes}H/{aways}A, "
                                f"expected {half}/{half}")
            days = [d for d, _, _ in ties]
            if len(set(days)) != len(days):
                problems.append(f"{season} {comp} {club}: two ties on one day")
            if days != sorted(days):
                problems.append(f"{season} {comp} {club}: ties are not in date order")
    return problems


if __name__ == "__main__":
    bad = self_check()
    for line in bad:
        print("FAIL", line)
    print("uefa_league_phase: %d competition-season(s), %s"
          % (len(LEAGUE_PHASE), "OK" if not bad else "%d problem(s)" % len(bad)))
    raise SystemExit(1 if bad else 0)

#!/usr/bin/env python3
"""The league registry: what the desk knows about a competition.

The desk was built for one league, so every build script hardcoded the same
three facts about it — where the match records live, how many clubs there are,
which file to patch. Two scripts already carried byte-identical copies of the
fetch-and-parse code (build_refs.py and build_club_splits.py), which is two
places for a source URL to rot.

This module holds those facts once. Adding a competition should be an entry in
LEAGUES, not a new copy of a script.

WHY THE CHAMPIONSHIP IS THE CHEAP ONE. Every referee number the desk shows —
yellows per game, fouls per game, cards per foul, the fixture x-factor — comes
from the free football-data.co.uk match records, and that source publishes a
referee for English and Scottish football and effectively nowhere else. It is
measured, not assumed: 0 of 33 seasons for La Liga and Ligue 1, 2 of 33 for
Serie A and the Bundesliga, all of them for England's five tiers and Scotland's
four. See docs/la-liga-feasibility.md. So a Championship desk reuses the whole
referee spine with a changed division code, and a La Liga desk has to buy the
referee NAME from a keyed API and compute the rates from this same free file.

That is the reason the registry carries `fd_div` (which free file to read) and
`referee_source` (whether that file will actually have a referee in it)
separately. A league can have match records and still have no referees.
"""

import csv
import io
import sys
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent

# Below this many usable match rows the file is a partial season or the wrong
# file, and a rate computed off it is worse than the one already shipped.
MIN_ROWS = 50

# The Frictionless Data mirror of football-data.co.uk on GitHub. Stable raw
# URLs, public domain, and reachable from a CI runner without a User-Agent
# argument — but it only carries the top five European leagues, so anything
# outside them reads the origin directly.
MIRROR = ("https://raw.githubusercontent.com/datasets/football-datasets/"
          "main/datasets/{slug}/season-{season}.csv")
ORIGIN = "https://www.football-data.co.uk/mmz4281/{season}/{div}.csv"


class League:
    """One competition, and where its free match records come from."""

    def __init__(self, code, name, fd_div, clubs, matches, data_file,
                 refs_file, mirror_slug=None, referee_source="football-data",
                 min_ref_matches=3, suspension=None):
        self.code = code                    # the desk's own id, e.g. "EFLC"
        self.name = name                    # display name
        self.fd_div = fd_div                # football-data.co.uk division code
        self.clubs = clubs
        self.matches = matches              # full-season match count
        self.data_file = data_file          # the generated <league>_data.js
        self.refs_file = refs_file          # the raw referee JSON (gitignored)
        self.mirror_slug = mirror_slug      # set only if the GitHub mirror has it
        self.referee_source = referee_source
        self.min_ref_matches = min_ref_matches
        self.suspension = suspension or ""

    @property
    def has_free_referees(self):
        """Whether fd_div's records name the official.

        The whole reason the Championship is cheap and La Liga is not.
        """
        return self.referee_source == "football-data"

    def sources(self, season):
        """Ordered (label, url) to try for one season's match records.

        The mirror first where it exists — it is what the Premier League
        refresh has always used and what CI has exercised — then the origin
        it mirrors. Before this, a mirror outage was a hard exit with no
        second attempt, which is a poor way to lose free data.
        """
        out = []
        if self.mirror_slug:
            out.append(("mirror", MIRROR.format(slug=self.mirror_slug, season=season)))
        out.append(("football-data.co.uk", ORIGIN.format(season=season, div=self.fd_div)))
        return out

    def path(self, name):
        return DATA / name


LEAGUES = {
    "PL": League(
        code="PL", name="Premier League", fd_div="E0", clubs=20, matches=380,
        data_file="pl_data.js", refs_file="pl_refs.json",
        mirror_slug="premier-league",
        suspension="5 yellows to GW19, 10 to GW32, 15 all season",
    ),
    "EFLC": League(
        code="EFLC", name="EFL Championship", fd_div="E1", clubs=24, matches=552,
        data_file="eflc_data.js", refs_file="eflc_refs.json",
        # The GitHub mirror carries only the top five European leagues, so the
        # Championship reads football-data.co.uk directly. Same publisher, same
        # columns, same licence — the mirror is a convenience, not the source.
        mirror_slug=None,
        # 552 matches over ~35 officials, against the Premier League's 380 over
        # ~20. Individual workloads are thinner and more of the list is made of
        # one-off appointments, so the floor is higher before a rate is ranked.
        min_ref_matches=5,
        # PARTIALLY CONFIRMED — do not ship as user-facing copy yet. The EFL
        # uses the same 5/10/15 ladder as the Premier League with the cutoffs
        # moved for a 46-game season, and the 10-before-match-37 rung (a TWO
        # match ban, not one) is confirmed. The 5 and 15 cutoffs are not, and
        # the desk's suspension-watch strip is only as good as these numbers,
        # so they need checking against the EFL regulations before the strip
        # is switched on for this league.
        suspension="10 yellows before match 37 = 2 matches (5 and 15 rungs TO CONFIRM)",
    ),
}


def get(code):
    """A league by code, or a loud exit naming the ones that exist."""
    try:
        return LEAGUES[code.upper()]
    except KeyError:
        sys.exit(f"ERROR: unknown league {code!r}. Known: "
                 + ", ".join(sorted(LEAGUES)))


def decode(raw):
    """football-data.co.uk bytes as text.

    The origin files are not consistently UTF-8 — accented officials' names
    appear latin-1 encoded in some seasons. Decoding strictly as UTF-8 throws
    on those, and decoding with errors="replace" silently corrupts a name into
    a second referee who never officiated. Try UTF-8, fall back to latin-1,
    which cannot fail and is what the file actually is when UTF-8 rejects it.
    """
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def usable(rows):
    """Match rows with an actual fixture on them.

    The origin CSVs end with rows of nothing but commas, which DictReader
    turns into dicts of empty strings. They count toward len(rows) and so
    inflate every "is this a complete season" guard that came before this.
    """
    return [r for r in rows if (r.get("HomeTeam") or "").strip()]


def load_rows(league, season=None, csv_path=None, agent="pl-bookings"):
    """One season's match records: every source tried, blanks dropped, guarded.

    Returns (rows, label). Exits on failure naming every URL attempted — a
    referee refresh that quietly does nothing is worse than one that stops.
    """
    if csv_path:
        text = Path(csv_path).read_bytes()
        rows = usable(list(csv.DictReader(io.StringIO(decode(text)))))
        return _guard(rows, league, str(csv_path)), str(csv_path)

    tried = []
    for label, url in league.sources(season):
        req = urllib.request.Request(url, headers={"User-Agent": agent})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = decode(r.read())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            reason = getattr(e, "code", None) or getattr(e, "reason", e)
            tried.append(f"  {label}: {url}\n    -> {reason}")
            continue
        rows = usable(list(csv.DictReader(io.StringIO(text))))
        if len(rows) < MIN_ROWS:
            tried.append(f"  {label}: {url}\n    -> only {len(rows)} usable rows")
            continue
        return _guard(rows, league, url), label

    sys.exit(f"ERROR: no usable {league.name} match records for season "
             f"{season!r}. Tried:\n" + "\n".join(tried)
             + "\n\nCheck the season code (e.g. 2526) or pass --csv.")


def _guard(rows, league, where):
    if len(rows) < MIN_ROWS:
        sys.exit(f"ERROR: {where} gave only {len(rows)} usable match rows for "
                 f"{league.name} (a full season is {league.matches}) — partial "
                 "season or wrong file; refusing to overwrite good data.")
    return rows


# Referees are not owned by a competition. Championship officials get promoted
# to the Premier League list and Premier League officials take Championship
# fixtures, so one shared map is correct — two per-league maps would disagree
# about the same person the season he moves.
#
# football-data.co.uk abbreviates ("A Taylor"); the desk displays full names.
# An unmapped abbreviation falls back to itself, which is honest rather than
# wrong, so this map is allowed to be incomplete.
REFEREE_NAMES = {
    "A Taylor": "Anthony Taylor", "C Kavanagh": "Chris Kavanagh",
    "M Oliver": "Michael Oliver", "S Attwell": "Stuart Attwell",
    "S Barrott": "Samuel Barrott", "D England": "Darren England",
    "T Bramall": "Thomas Bramall", "P Bankes": "Peter Bankes",
    "J Gillett": "Jarred Gillett", "C Pawson": "Craig Pawson",
    "A Madley": "Andy Madley", "R Jones": "Robert Jones",
    "S Hooper": "Simon Hooper", "M Salisbury": "Michael Salisbury",
    "P Tierney": "Paul Tierney", "J Brooks": "John Brooks",
    "T Harrington": "Tony Harrington", "T Robinson": "Tim Robinson",
    "T Kirk": "Thomas Kirk", "F Hallam": "Farai Hallam",
    "A Kitchen": "Adam Kitchen", "M Donohue": "Matthew Donohue",
    "L Smith": "Lewis Smith", "D Coote": "David Coote",
    "G Scott": "Graham Scott", "D Bond": "Darren Bond",
    "J Smith": "Josh Smith", "S Allison": "Sam Allison",
}


def full_name(abbrev):
    return REFEREE_NAMES.get(abbrev, abbrev)

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
import json
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
                 min_ref_matches=3, suspension=None, af_league=None,
                 players_file=None, clubs_file=None, suspension_scheme=None):
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
        # The same rule, structured, so a desk can compute with it instead of
        # each page hardcoding thresholds. Two shapes, because two countries
        # do genuinely different things:
        #
        #   ladder  England. CUMULATIVE season totals, escalating bans, each
        #           rung gated by a match number. Reaching 5 by your club's
        #           19th league game is one match; 10 by the 37th is two; 15
        #           at any point is three. The count does NOT reset when a ban
        #           is served — a player on twelve has served two bans and is
        #           still climbing toward the third rung.
        #
        #   cycle   Spain. A REPEATING cycle of five with no gate and no
        #           escalation; the counter restarts each time and the next
        #           five cost the same single match (RFEF art. 112).
        #
        # Getting these two the same way round matters: applying England's
        # ladder to Spain would invent bans nobody serves, and applying
        # Spain's cycle to England would forgive a player who has already
        # used up his 5- and 10-rungs.
        self.suspension_scheme = suspension_scheme
        # API-Football's own league id. The squad feed: it is fetched per CLUB
        # rather than per league page, so a walk is a squad and cannot come
        # back as a slice of one — which is the entire failure mode the
        # ScoutingStats route produced six different ways.
        self.af_league = af_league
        self.players_file = players_file
        # Only leagues that DISCOVER their division carry one (see LL). A
        # league whose clubs are declared in this module has none, and
        # load_clubs returning {} for it is the correct answer, not a gap.
        self.clubs_file = clubs_file

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
        mirror_slug="premier-league", af_league=39,
        players_file="pl_players.json",
        suspension="5 yellows to GW19, 10 to GW32, 15 all season",
        suspension_scheme={
            "kind": "ladder", "cumulative": True, "review": 20,
            "rungs": [{"at": 5, "ban": 1, "by": 19},
                      {"at": 10, "ban": 2, "by": 32},
                      {"at": 15, "ban": 3, "by": None}],
        },
    ),
    "EFLC": League(
        code="EFLC", name="EFL Championship", fd_div="E1", clubs=24, matches=552,
        data_file="eflc_data.js", refs_file="eflc_refs.json",
        # The GitHub mirror carries only the top five European leagues, so the
        # Championship reads football-data.co.uk directly. Same publisher, same
        # columns, same licence — the mirror is a convenience, not the source.
        mirror_slug=None, af_league=40,
        # champ_promoted.json is the historical name and stays: both builders
        # already read it, and the file has always held the whole league.
        players_file="champ_promoted.json",
        # 552 matches over ~35 officials, against the Premier League's 380 over
        # ~20. Individual workloads are thinner and more of the list is made of
        # one-off appointments, so the floor is higher before a rate is ranked.
        min_ref_matches=5,
        # CHECKED. The EFL runs the same 5/10/15 ladder as the Premier League
        # with the cutoffs moved for a 46-game season: five by the club's 19th
        # league match is one game, ten by the 37th is TWO, fifteen at any
        # point in the season is three. Twenty or more does not add a fourth
        # automatic rung — it refers the player to a Regulatory Commission,
        # whose sanction is discretionary and therefore not predictable here.
        # The count is cumulative and does NOT reset when a ban is served.
        # Accumulation suspensions do not carry into the play-offs.
        # See docs/suspension-rules.md for the evidence and its limits.
        suspension="5 yellows to match 19, 10 to match 37 (2 games), "
                   "15 all season (3 games); cumulative, no reset",
        suspension_scheme={
            "kind": "ladder", "cumulative": True, "review": 20,
            "rungs": [{"at": 5, "ban": 1, "by": 19},
                      {"at": 10, "ban": 2, "by": 37},
                      {"at": 15, "ban": 3, "by": None}],
        },
    ),
    "L1": League(
        code="L1", name="EFL League One", fd_div="E2", clubs=24, matches=552,
        # No desk of its own. It is in the registry for the three clubs
        # promoted into the Championship, whose 2025-26 form is a League One
        # record — and, being English, it has free referees too if it ever
        # wants one.
        data_file="l1_data.js", refs_file="l1_refs.json",
        players_file="l1_players.json",
        mirror_slug=None, af_league=41, min_ref_matches=5,
    ),
    "SEG": League(
        code="SEG", name="Segunda División", fd_div="SP2", clubs=22, matches=462,
        # No desk of its own, and no referees — it is here for the clubs
        # PROMOTED into La Liga, whose 2025-26 form is a Segunda record and
        # appears in no La Liga harvest. The Spanish counterpart of L1.
        data_file="segunda_data.js", refs_file="segunda_refs.json",
        players_file="segunda_players.json",
        mirror_slug=None, af_league=141, referee_source="none",
    ),
    "LL": League(
        code="LL", name="La Liga", fd_div="SP1", clubs=20, matches=380,
        data_file="laliga_data.js", refs_file="laliga_refs.json",
        # The mirror DOES carry Spain — it is one of the top five. What it does
        # not carry, in any of 33 seasons, is a referee: the Referee column is
        # present and always empty. Hence referee_source below.
        mirror_slug="la-liga", af_league=140,
        players_file="laliga_players.json", clubs_file="laliga_clubs.json",
        # THE ONE LEAGUE HERE THAT PAYS FOR ITS REFEREES. Every card and every
        # foul is in the free SP1 file at full coverage; only the official's
        # NAME is missing. So the name is bought from API-Football's /fixtures
        # — one call a season — and joined onto the free rows by date and the
        # two clubs, after which build_refs.py computes every rate off data
        # that stayed free. See build_refs.attach_referees.
        referee_source="api-football",
        # 380 matches over ~20 officials, the same ratio as the Premier League,
        # so the same floor.
        min_ref_matches=3,
        # CHECKED against the RFEF Código Disciplinario, art. 112. See
        # docs/spain-suspensions.md for the evidence and its limits.
        #
        # THE ANSWER IS THAT THERE ARE NO HIGHER RUNGS. England gates its
        # ladder by matchday (5 by GW19, 10 by GW32, 15 all season, with the
        # 10-rung a TWO-match ban); Spain does not have a ladder at all. Art.
        # 112 sets one threshold — five cautions in the same season AND
        # competition, one match — and then: "Cumplida la sanción, se iniciará
        # un nuevo ciclo de la misma clase y con idénticos efectos." Identical
        # effects. So the tenth card costs one match, the fifteenth costs one
        # match, and so on; there is no escalation to price.
        #
        # Consequences for anything built on this:
        #   - the count is PER COMPETITION ("misma temporada y competición"),
        #     so league and Copa cards never pool;
        #   - the Copa threshold is three, not five;
        #   - accumulation sanctions do not carry into the following season;
        #   - a fifth caution shown WITHIN a match can draw an extra match and
        #     a fine, which is a referee's decision and not predictable here.
        suspension="every 5 yellows = 1 match; the cycle repeats with identical "
                   "effect (RFEF art. 112) — no escalation at 10 or 15",
        suspension_scheme={"kind": "cycle", "at": 5, "ban": 1, "cumulative": False},
    ),
}


# ── the 2026-27 EFL Championship ────────────────────────────────────────────
#
# DERIVED, NOT READ OFF A CONFIRMED LIST. The EFL's own line-up pages could not
# be fetched when this was written, so the 24 were derived from moves that were
# each confirmed separately: Coventry, Ipswich and Hull up to the Premier
# League; Sheffield Wednesday, Leicester and Oxford down to League One; Burnley,
# West Ham and Wolves down from the Premier League; Lincoln, Cardiff and Bolton
# up from League One. That is a chain of six facts, and a wrong link here does
# not crash anything — an unmapped club name simply produces no players. So
# build_eflc_data.py reports every unmapped club by name and refuses to write
# when the count is short, rather than shipping 21 squads and a quiet gap.
EFLC_CLUBS = {
    "Birmingham City": "BIR", "Blackburn Rovers": "BLB",
    "Bolton Wanderers": "BOL", "Bristol City": "BRC", "Burnley": "BUR",
    "Cardiff City": "CAR", "Charlton Athletic": "CHA", "Derby County": "DER",
    "Lincoln City": "LIN", "Middlesbrough": "MID", "Millwall": "MIL",
    "Norwich City": "NOR", "Portsmouth": "POR", "Preston North End": "PRE",
    "Queens Park Rangers": "QPR", "Sheffield United": "SHU",
    "Southampton": "SOU", "Stoke City": "STK", "Swansea City": "SWA",
    "Watford": "WAT", "West Bromwich Albion": "WBA",
    "West Ham United": "WHU", "Wolverhampton Wanderers": "WOL",
    "Wrexham": "WRE",
}

# Feeds name the same club differently — ScoutingStats, the FPL feed and
# football-data.co.uk all disagree, and football-data in particular uses short
# forms ("Sheffield United" is "Sheffield United" but "QPR" is "QPR"). Every
# spelling that resolves to a club goes here. An alias that is NOT here is
# reported, not guessed.
EFLC_ALIASES = {
    "Birmingham": "BIR", "Blackburn": "BLB", "Bolton": "BOL",
    "Bristol City": "BRC", "Cardiff": "CAR", "Charlton": "CHA",
    "Derby": "DER", "Lincoln": "LIN", "Middlesbrough": "MID",
    "Norwich": "NOR", "Preston": "PRE", "QPR": "QPR",
    "Queens Park Rangers": "QPR", "Sheffield Utd": "SHU",
    "Sheff Utd": "SHU", "Stoke": "STK", "Swansea": "SWA",
    "West Brom": "WBA", "West Bromwich": "WBA", "West Ham": "WHU",
    "Wolves": "WOL", "Wolverhampton": "WOL",
}

# Where each club's 2025-26 form comes from. The Championship desk is the
# mirror image of the Premier League one: most of its clubs played in the
# division last season, and the interesting minority did not.
EFLC_FROM_PL = {"BUR", "WHU", "WOL"}   # relegated — last season's form is PL
EFLC_FROM_L1 = {"LIN", "CAR", "BOL"}   # promoted — last season's form is L1


def eflc_short(name):
    """A club name from any feed as its short code, or None if unrecognised."""
    n = (name or "").strip()
    return EFLC_CLUBS.get(n) or EFLC_ALIASES.get(n)


# API-Football spells clubs its own way, and an unmapped name is silently no
# club at all. Every difference is written down here, and anything left over is
# reported by name rather than dropped — a squad that quietly does not arrive
# looks exactly like a club that has no players, which is the confusion this
# repo has already paid for once.
AF_ALIASES = {
    "Newcastle": "Newcastle United", "Tottenham": "Tottenham Hotspur",
    "West Ham": "West Ham United", "Wolves": "Wolverhampton Wanderers",
    "Brighton": "Brighton & Hove Albion", "Bournemouth": "AFC Bournemouth",
    "Leeds": "Leeds United", "Coventry": "Coventry City",
    "Ipswich": "Ipswich Town", "Sheffield Utd": "Sheffield United",
    "West Brom": "West Bromwich Albion", "QPR": "Queens Park Rangers",
    "Preston": "Preston North End", "Blackburn": "Blackburn Rovers",
    "Swansea": "Swansea City", "Cardiff": "Cardiff City",
    "Norwich": "Norwich City", "Stoke": "Stoke City", "Derby": "Derby County",
    "Charlton": "Charlton Athletic", "Birmingham": "Birmingham City",
    "Bolton": "Bolton Wanderers", "Lincoln": "Lincoln City",
    "Man City": "Manchester City", "Man United": "Manchester United",
    "Manchester Utd": "Manchester United", "Nott'm Forest": "Nottingham Forest",
    "Forest": "Nottingham Forest",
    "Wolverhampton": "Wolverhampton Wanderers",
}


# ── La Liga ─────────────────────────────────────────────────────────────────
#
# NOT A ROSTER. Unlike EFLC_CLUBS above, this is deliberately NOT a list of who
# is in the division — it is a spelling table that covers more clubs than any
# one season contains, and the actual twenty are DISCOVERED from API-Football
# (harvest_apifootball.py --clubs) and written to laliga_clubs.json.
#
# The Championship's 24 were derived from a chain of six separately-confirmed
# promotions and relegations, and that was already the weakest link in this
# repo — a wrong link produces no error, just a club with no players. Spain's
# 2026-27 line-up could not be confirmed from a primary source when this was
# written, so rather than guess it and inherit that failure mode, the division
# names itself and the build refuses to write if it comes back with anything
# other than the twenty the registry expects.
#
# Codes for clubs beyond this table are generated (see auto_short); the table
# exists for the ones where three letters off the front would be wrong or
# would collide — Real Madrid / Real Sociedad / Real Betis being the obvious
# case, since all three start "Rea".
LALIGA_SHORT = {
    "Real Madrid": "RMA", "Barcelona": "BAR", "Atletico Madrid": "ATM",
    "Athletic Club": "ATH", "Real Sociedad": "RSO", "Real Betis": "BET",
    "Sevilla": "SEV", "Valencia": "VAL", "Villarreal": "VIL",
    "Celta Vigo": "CEL", "Espanyol": "ESP", "Getafe": "GET",
    "Girona": "GIR", "Osasuna": "OSA", "Rayo Vallecano": "RAY",
    "Mallorca": "MLL", "Deportivo Alaves": "ALA", "Elche": "ELC",
    "Levante": "LEV", "Real Oviedo": "OVI", "Las Palmas": "LPA",
    "Real Valladolid": "VLL", "Leganes": "LEG", "Cadiz": "CAD",
    "Almeria": "ALM", "Granada": "GRA", "Sporting Gijon": "SPG",
    "Eibar": "EIB", "Huesca": "HUE", "Real Zaragoza": "ZAR",
    "Racing Santander": "RAC", "Deportivo La Coruna": "DEP",
    "Malaga": "MAL", "Tenerife": "TEN", "Cartagena": "CTG",
    "Albacete": "ALB", "Mirandes": "MIR", "Castellon": "CST",
    "Burgos": "BUG", "Andorra": "AND", "Ceuta": "CEU", "Eldense": "ELD",
}

# football-data.co.uk writes Spanish clubs its own way, and has done for
# twenty years — "Ath Madrid", "Espanol" (one n), "Sociedad", "Vallecano".
# These are the spellings the FREE match records use, and every one of them
# has to reach the same club as the API-Football spelling or the referee join
# and the club card rates both silently address nobody.
LALIGA_FD_ALIASES = {
    "Ath Madrid": "Atletico Madrid", "Ath Bilbao": "Athletic Club",
    "Espanol": "Espanyol", "Betis": "Real Betis", "Sociedad": "Real Sociedad",
    "Vallecano": "Rayo Vallecano", "Celta": "Celta Vigo",
    "Alaves": "Deportivo Alaves", "La Coruna": "Deportivo La Coruna",
    "Sp Gijon": "Sporting Gijon", "Vallodolid": "Real Valladolid",
    "Valladolid": "Real Valladolid", "Oviedo": "Real Oviedo",
    "Zaragoza": "Real Zaragoza", "Santander": "Racing Santander",
    "Racing": "Racing Santander", "Gimnastic": "Gimnastic Tarragona",
    "Almeria": "Almeria", "Cadiz": "Cadiz", "Leganes": "Leganes",
}

# API-Football's own spellings that differ from the canonical name above.
# THE RFEF'S CONVENTION. Spain's designation sheets print each club's legal
# name — "Getafe CF", "Rayo Vallecano de Madrid" — where the registry,
# discovered from API-Football, holds "Getafe" and "Rayo Vallecano".
#
# A table of RFEF spellings was written for jornada 1's SATURDAY sheet and then
# deleted, because every entry in it was already resolved by the suffix strip
# below and a table that cannot fail is one no guard can tell has rotted.
#
# THE SUNDAY SHEET DISPROVED THAT, and the deletion with it. A legal name is not
# only a suffix: "RCD Espanyol de Barcelona" carries a prefix AND a city, and
# "Real Racing Club de Santander" is a formal name with neither end strippable
# to anything the registry holds. Both were reported "club not recognised" and
# the whole sheet refused — which is the designed behaviour and exactly why the
# gap was visible rather than silent.
#
# SO THE TABLE IS BACK, and it carries ONLY the spellings observed to fail.
# Adding "Villarreal CF" or "Levante UD" — which the strip already handles —
# would rebuild the table that could not fail. Entries here are load-bearing by
# construction: remove one and its sheet stops ingesting.
#
# CONSULTED ON THE ACCENT-INSENSITIVE PASS ONLY, unlike the two tables above.
# The pass folds accents off the INPUT and off every key, so an accented key —
# "Real Betis Balompié", added from jornada 2's sheet — is found exactly as an
# ASCII one is. An exact-match pass would therefore be a branch no input
# reaches: removing it changed nothing and no test noticed, which is the
# definition of the dead wiring this file refuses elsewhere. Add a key that must
# beat a same-folded key in another table and this needs revisiting, loudly.
#
# NOT A GENERAL PREFIX STRIP, deliberately. Stripping leading legal words would
# have to leave "Real Madrid", "Real Betis", "Real Sociedad" and "Deportivo La
# Coruña" alone while removing "Real Racing Club" and "RCD" — the same word,
# kept in four names and dropped in two. A rule that cannot be stated is a rule
# that will one day resolve a club to the wrong one, silently.
LALIGA_RFEF_ALIASES = {
    "Real Racing Club de Santander": "Racing Santander",
    "RCD Espanyol de Barcelona": "Espanyol",
    # Not "Deportivo La Coruña" shortened but the club's OWN initials plus a
    # bare "Deportivo": nothing to strip at either end and nothing the accent
    # index reaches, since the registry's key carries the city and this does
    # not.
    "RC Deportivo": "Deportivo La Coruna",
    # Jornada 2's sheet, and a third shape again: not a prefix and not a
    # strippable ending but a SECOND NOUN inside the legal name. "Balompié" is
    # simply part of what the club is called, and "de Fútbol" is a trailing
    # phrase the suffix list would have to carry as a special case while
    # leaving "Real Sociedad" itself alone.
    "Real Betis Balompié": "Real Betis",
    "Real Sociedad de Fútbol": "Real Sociedad",
    # Jornada 2's Saturday and Sunday sheets. Two more shapes: a LEGAL PREFIX
    # the registry does not carry ("Club" before Atlético, "RC" before Celta)
    # combined with a city the registry spells differently or not at all. The
    # suffix strip reaches neither — " de Madrid" leaves "Club Atlético", which
    # is nothing, and "RC Celta de Vigo" ends in no listed suffix at all.
    "Club Atlético de Madrid": "Atletico Madrid",
    "RC Celta de Vigo": "Celta Vigo",
    # Jornada 2's Monday sheet, and a fifth shape: the SAME legal prefix as
    # Atlético de Madrid directly above, with no "de" and no city — the club is
    # called Osasuna and "Club Atlético" is the legal form wrapped around it.
    # The pair is exactly why this is a table and not a prefix rule: stripping
    # "Club Atlético " resolves this one and breaks the other, leaving
    # "de Madrid".
    "Club Atlético Osasuna": "Osasuna",
    "CA Osasuna": "Osasuna",
}

# Legal endings no registry carries. Stripped and retried,
# never substituted — a strip leaving nothing recognisable falls through to
# None rather than to a guess.
LALIGA_LEGAL_SUFFIXES = (" CF", " FC", " SAD", " CD", " UD", " SD", " RCD", " RC",
                         " de Madrid")

LALIGA_AF_ALIASES = {
    "Atlético Madrid": "Atletico Madrid", "Athletic Bilbao": "Athletic Club",
    "Alavés": "Deportivo Alaves", "Deportivo Alavés": "Deportivo Alaves",
    "Cádiz": "Cadiz", "Almería": "Almeria", "Leganés": "Leganes",
    "Celta de Vigo": "Celta Vigo", "RC Celta": "Celta Vigo",
    "Rayo": "Rayo Vallecano", "Betis": "Real Betis",
    "Sociedad": "Real Sociedad", "Oviedo": "Real Oviedo",
    "Valladolid": "Real Valladolid", "Espanyol de Barcelona": "Espanyol",
    "RCD Espanyol": "Espanyol", "FC Barcelona": "Barcelona",
    "Málaga": "Malaga", "Castellón": "Castellon", "Mirandés": "Mirandes",
    "Gijón": "Sporting Gijon", "Sporting Gijón": "Sporting Gijon",
}


def strip_accents(text):
    """Accent-insensitive form. Feeds disagree about diacritics on the same
    club — "Alavés" and "Alaves" are one team — and a name that differs only
    by an accent must not become a second club with half a squad."""
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", str(text or ""))
                   if not unicodedata.combining(c))


def auto_short(name, taken):
    """A three-letter code for a club the override table does not cover.

    Deterministic and collision-aware: the same league produces the same codes
    every run, which matters because the code is what the shipped data file and
    every stored watchlist key on. A generated code is a fallback, not a
    preference — anything that appears regularly belongs in LALIGA_SHORT.
    """
    words = [w for w in strip_accents(name).upper().replace("-", " ").split()
             if w.isalnum()]
    if not words:
        return None
    candidates = []
    if len(words) >= 3:
        candidates.append("".join(w[0] for w in words[:3]))
    if len(words) >= 2:
        candidates.append(words[0][:2] + words[1][0])
        candidates.append(words[1][:3])
    candidates.append(words[0][:3])
    # Then widen: first word plus a walking letter of the second, then digits,
    # so a collision always terminates rather than looping.
    base = words[0][:2] if len(words[0]) >= 2 else words[0]
    for w in words[1:]:
        candidates.extend(base + c for c in w)
    candidates.extend(words[0][:2] + str(i) for i in range(1, 10))
    for c in candidates:
        c = c.upper()
        if len(c) == 3 and c not in taken:
            return c
    return None


def assign_shorts(names):
    """{club name: short code} for a discovered division.

    Overrides first, in a fixed order, so a generated code can never take a
    letter combination an override needs. Sorted throughout: the mapping must
    not depend on the order the API happened to answer in, or a re-harvest
    would silently rename clubs and orphan every stored pick.
    """
    names = sorted({(n or "").strip() for n in names if (n or "").strip()})
    out, taken = {}, set()
    for n in names:
        code = LALIGA_SHORT.get(n)
        if code and code not in taken:
            out[n] = code
            taken.add(code)
    for n in names:
        if n in out:
            continue
        code = auto_short(n, taken)
        if code:
            out[n] = code
            taken.add(code)
    return out


def clubs_path(code):
    """Where a league's discovered club registry lives, or None if that league
    declares its clubs in this module instead."""
    league = LEAGUES.get(code.upper())
    name = getattr(league, "clubs_file", None) if league else None
    return DATA / name if name else None


def load_clubs(code):
    """The discovered club registry for a league, or {} before it exists.

    {canonical name: {"short": "RMA", "id": 541}}. Written by
    harvest_apifootball.py --clubs, committed, and read by every later stage —
    so the division is established once, by the feed, rather than asserted by
    hand in four places.
    """
    path = clubs_path(code)
    if path is None or not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    clubs = raw.get("clubs") if isinstance(raw, dict) else raw
    return clubs if isinstance(clubs, dict) else {}


def save_clubs(code, clubs, season=None):
    path = clubs_path(code)
    if path is None:
        sys.exit(f"ERROR: {code} declares its clubs in leagues.py, so it has "
                 "no discovered registry to write. Give it a clubs_file if it "
                 "should name its own division.")
    payload = {"league": code, "season": season, "clubs": clubs}
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False,
                               sort_keys=True) + "\n", encoding="utf-8")
    return path


def _accent_index(mapping):
    return {strip_accents(k).lower(): v for k, v in mapping.items()}


def laliga_short(name, clubs=None):
    """A La Liga club name from ANY feed as its short code, or None.

    Tries, in order: the discovered registry, the football-data spelling table,
    the API-Football spelling table, then an accent-insensitive pass over all
    three. Returns None rather than guessing — an unmapped name is reported by
    every caller, because a club that quietly resolves to nothing is
    indistinguishable from a club with no players.
    """
    n = (name or "").strip()
    if not n:
        return None
    reg = load_clubs("LL") if clubs is None else clubs
    entry = reg.get(n)
    if entry:
        return entry.get("short") if isinstance(entry, dict) else entry
    for table in (LALIGA_FD_ALIASES, LALIGA_AF_ALIASES):
        canon = table.get(n)
        if canon:
            hit = reg.get(canon)
            if hit:
                return hit.get("short") if isinstance(hit, dict) else hit
            if canon in LALIGA_SHORT and not reg:
                return LALIGA_SHORT[canon]
    flat = strip_accents(n).lower()
    for table in (_accent_index(reg), _accent_index(LALIGA_FD_ALIASES),
                  _accent_index(LALIGA_AF_ALIASES), _accent_index(LALIGA_RFEF_ALIASES)):
        hit = table.get(flat)
        if hit is None:
            continue
        if isinstance(hit, dict):
            return hit.get("short")
        canon = reg.get(hit)
        if canon:
            return canon.get("short") if isinstance(canon, dict) else canon
        if not reg and hit in LALIGA_SHORT:
            return LALIGA_SHORT[hit]
    # A legal ending no registry carries ("Getafe CF"). Stripped and retried
    # ONCE, so an ending that leaves nothing recognisable still returns None
    # instead of half a name.
    for suffix in LALIGA_LEGAL_SUFFIXES:
        if n.endswith(suffix):
            # No emptiness guard: the recursive call's own `if not n` returns
            # None for a name that was nothing but a suffix, and a guard no
            # input can reach is a branch no test can cover.
            return laliga_short(n[: -len(suffix)].strip(), clubs=reg)
    return None

def canon_name(code, name):
    """A club name from any feed as its CANONICAL name, whether or not that
    club is in the division now.

    Deliberately independent of the club registry. The referee join runs over
    a COMPLETED season, and three of that season's clubs have since been
    relegated out of the registry — keying the join on short codes dropped
    their matches, which is a fifth of the league quietly missing from every
    referee's record. A club's name does not depend on which division it is
    in; its short code does.
    """
    n = (name or "").strip()
    if not n:
        return None
    if code.upper() != "LL":
        canon = EFLC_CLUBS.get(n) or EFLC_ALIASES.get(n) or AF_ALIASES.get(n)
        return canon or n
    for table in (LALIGA_FD_ALIASES, LALIGA_AF_ALIASES):
        if n in table:
            return table[n]
    flat = strip_accents(n).lower()
    for table in (LALIGA_FD_ALIASES, LALIGA_AF_ALIASES):
        for k, v in table.items():
            if strip_accents(k).lower() == flat:
                return v
    for known in LALIGA_SHORT:
        if strip_accents(known).lower() == flat:
            return known
    return n


def short_for(code, name, clubs=None):
    """A club name as its short code, for whichever league is asking."""
    if code.upper() == "LL":
        return laliga_short(name, clubs=clubs)
    return eflc_short(name)


def canonical_club(api_name, known):
    """An API-Football club name as the name a builder keys on, or None.

    `known` is the set of names that builder recognises, passed in rather than
    imported, so this module does not have to know which desk is asking.
    """
    name = (api_name or "").strip()
    if not name:
        return None
    if name in known:
        return name
    mapped = AF_ALIASES.get(name)
    return mapped if mapped in known else None


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
    "A Kitchen": "Andrew Kitchen", "M Donohue": "Matthew Donohue",
    "L Smith": "Lewis Smith", "D Coote": "David Coote",
    "G Scott": "Graham Scott", "D Bond": "Darren Bond",
    "J Smith": "Josh Smith", "S Allison": "Sam Allison",
}


def full_name(abbrev):
    return REFEREE_NAMES.get(abbrev, abbrev)

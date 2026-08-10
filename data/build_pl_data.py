#!/usr/bin/env python3
"""
Build the Premier League Bookings Desk dataset for 2026-27.

Inputs (harvested from ScoutingStats, logged in):
  pl_players.json     2025-26 Premier League players (league 8, season 25583)
  champ_promoted.json 2025-26 Championship players for the 3 promoted clubs
  pl_refs.json        PL referee card rates (build_refs.py, from the free
                      football-data.co.uk mirror at datasets/football-datasets)

Optional input (free FPL feed, no cookie — data/harvest_fpl_squads.py):
  promoted_squads.json  The promoted clubs' full 2026-27 squads with NO form.
                        The Championship feed only ever returned the handful of
                        players who cleared its minutes floor, which left three
                        clubs as six forwards and no defenders. These rows fill
                        the squad out and are flagged NEW, not EFL, because
                        they carry no rate at all.

Optional input (API-Football — data/harvest_apifootball.py --league PL):
  pl_af_players.json    The same 2025-26 Premier League season, from the other
                        feed. Read for ONE field: fouls won. ScoutingStats maps
                        fd90 <- fouls_drawn_p90 and returns it empty, so 456 of
                        the 456 PL rows shipped fw:null while the Championship
                        desk had the number for its own three clubs all along —
                        the call that carries it is already made daily for the
                        relegated three (see the data-refresh workflow).
                        FILL ONLY: it never overwrites a value, never adds a
                        player, and touches no other field. Booking risk is
                        yc_p90*2 + fouls_COMMITTED_p90, so nothing here can move
                        a published price — which is what keeps this separate
                        from the open question of whether pl_data.js should be
                        built on an API-Football basis at all.

Output: pl_data.js with PL_PLAYERS, CLUBS and REFS. index.html loads this file
directly via <script src="data/pl_data.js"> — there is no hand-copy step, so
regenerating this file is all a data refresh needs. Keep the const names stable.

pl_data.js is ALSO the cache of the last good harvest. The raw JSONs above are
gitignored (large, regenerable), so a refresh that cannot reach ScoutingStats
has no Premier League rows at all — and a build that took that literally would
rewrite the shipped file as an empty one and a bot would commit it. Instead any
source that is missing today is read back out of the file it produced last
time. That is what makes a partial refresh possible: the FPL squads leg below
needs no cookie and no key, so it can land on its own without the rest of the
pipeline being reachable.

2026-27 lineup: 17 continuing PL clubs (drop Burnley, West Ham, Wolves) plus
Coventry, Ipswich, Hull (promoted, flagged EFL as clubs; their players are EFL
where a Championship rate exists and NEW where none does).
Booking risk = yc_p90*2 + fouls_p90, the same metric as the WC desk.
"""

import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402

OUT = DATA / "pl_data.js"
LOW_MIN = 450

# The API-Football harvest of this same season, read for fouls won only.
# Written by the refresh workflow's "--league PL --out" step, which exists for
# the Championship desk; this build is a second reader of a file it already
# pays for, not a new call.
AF_FILL = "pl_af_players.json"
# The season the shipped FORM describes, in API-Football's vocabulary (a season
# named by its starting year, so 2025 is 2025-26). NOT the season being played:
# this desk is built for 2026-27 and prices it off the last completed season.
#
# It is a constant here because the two feeds have no season in common to check
# against — ScoutingStats names seasons by an internal id (25583) that does not
# convert. So this is the one place that says which season the form is, and the
# fill refuses a harvest stamped as any other. Move it when the form moves.
FORM_SEASON = "2025"

# The share of players that must end up carrying a fouls-won number before
# the build will ship. This is what the fouls-won guard actually protects:
# not that any particular top-up matched, but that the column is not a page
# of dashes reading as "the source has none". Comfortably under the ~72%
# the primary source alone provides, and far above the ~0% a real outage
# would leave.
FW_MIN_COVERAGE = 0.5

DROP = {"Burnley", "West Ham United", "Wolverhampton Wanderers"}  # relegated

# The promoted three. Their form comes from the Championship feed, which is the
# only part of this pipeline with no Premier League fallback — so it is the
# only part that can go missing without anything else looking wrong.
PROMOTED = {"COV", "IPS", "HUL"}
# A club needs a squad, not a handful of names. Fifteen is the floor the CI
# guard already applies to the shipped file; applying it HERE means a bad
# harvest never reaches the file in the first place.
MIN_SQUAD = 15
# And a squad is not a squad without defenders. This is the check that would
# have caught the real hole: for a year the promoted clubs carried six
# forwards and nothing else, which no row count can see. A booking model
# without centre-backs and holding midfielders is missing exactly the players
# it exists to rate.
REQUIRED_POS = {"GK", "DF", "MF", "FW"}


# Reported in football order rather than alphabetical: "no GK, DF, MF" is the
# order a reader thinks in, and "no DF, GK, MF" reads like a sorting accident.
POS_ORDER = ["GK", "DF", "MF", "FW"]


def _n_players(n):
    return f"{n} player" + ("" if n == 1 else "s")


def coverage_problems(rows, clubs=None):
    """Every reason a set of clubs' data is not fit to ship, as plain
    sentences. Empty list means it is. Pure — takes rows, touches nothing.

    `clubs` defaults to the promoted three, which is the only set with no
    Premier League fallback and so the only one this file has to judge. The
    Championship desk passes its whole 24, because there every club is in that
    position: no higher-division feed sits behind any of them."""
    problems = []
    by_club = {}
    for r in rows:
        if not r:
            continue
        by_club.setdefault(r["c"], []).append(r)
    for short in sorted(PROMOTED if clubs is None else clubs):
        squad = by_club.get(short, [])
        if not squad:
            problems.append(f"{short}: no players at all")
            continue
        if len(squad) < MIN_SQUAD:
            problems.append(f"{short}: {_n_players(len(squad))}, need at least {MIN_SQUAD}")
        have = {r["p"] for r in squad}
        missing = [q for q in POS_ORDER if q in REQUIRED_POS and q not in have]
        if missing:
            problems.append(f"{short}: no {', '.join(missing)} in the squad")
    return problems
POS = {"Goalkeeper": "GK", "Defender": "DF", "Midfielder": "MF", "Attacker": "FW"}

SHORT = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "AFC Bournemouth": "BOU", "Brentford": "BRE",
    "Brighton & Hove Albion": "BHA", "Chelsea": "CHE", "Crystal Palace": "CRY",
    "Everton": "EVE", "Fulham": "FUL", "Leeds United": "LEE", "Liverpool": "LIV",
    "Manchester City": "MCI", "Manchester United": "MUN", "Newcastle United": "NEW",
    "Nottingham Forest": "NFO", "Sunderland": "SUN", "Tottenham Hotspur": "TOT",
    "Coventry City": "COV", "Ipswich Town": "IPS", "Hull City": "HUL",
}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load_optional(name):
    """A source that may not have been harvested yet. Missing is not an error;
    a malformed file is."""
    if not (DATA / name).exists():
        return []
    return load(name)


def load(name):
    d = json.loads((DATA / name).read_text(encoding="utf-8"))
    return d["players"] if isinstance(d, dict) and "players" in d else d


def stamp(name):
    """(league, season) off a harvest file, or (None, None) if it carries none.

    Harvests written before the stamp existed are bare arrays. Absent is
    therefore "cannot tell", which is not the same as "wrong" — the caller
    reports it and carries on rather than refusing to build on a file that was
    perfectly good yesterday.
    """
    path = DATA / name
    if not path.exists():
        return None, None
    d = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(d, dict):
        return None, None
    return d.get("league"), d.get("season")


# --- reading the shipped file back in -------------------------------------
NAME_BY_SHORT = {v: k for k, v in SHORT.items()}
POS_NAME = {v: k for k, v in POS.items()}


def quote_keys(js):
    """Quote the unquoted object keys in a machine-written JS object literal.

    Tracks string state so a player named "Smith, jr: II" is left alone, and
    takes no allowlist of key names — build_club_splits.py patches caH/caA into
    the same file afterwards, and a fixed list would have gone stale silently
    the first time a field was added."""
    out, i, n, in_str = [], 0, len(js), False
    while i < n:
        ch = js[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(js[i + 1])
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        m = re.match(r"[A-Za-z_][A-Za-z_0-9]*(?=:)", js[i:])
        if m and (not out or out[-1] in "{,"):
            out.append('"' + m.group(0) + '"')
            i += m.end()
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def js_array(src, name):
    """Parse `const NAME = [...]` out of the generated file.

    Safe here, and only here, because main() writes it: JSON scalars, one
    object per line, trailing comma. This is not a JavaScript parser and must
    not be pointed at a hand-written file."""
    m = re.search(r"^const " + name + r" = \[$(.*?)^\];$", src, re.S | re.M)
    if not m:
        raise SystemExit(f"ERROR: {OUT.name} has no `const {name} = [` block, so "
                         "it cannot serve as the previous harvest. It was not "
                         "written by this script.")
    body = quote_keys(m.group(1)).strip().rstrip(",")
    return json.loads("[" + body + "]")


def shipped_rows():
    """The last good harvest, in the SOURCE shape mk() consumes, grouped by
    basis. Round-trips exactly: mk() recomputes y and r from yc, min and f,
    which are all carried on the shipped row."""
    if not OUT.exists():
        return {}
    src = OUT.read_text(encoding="utf-8")
    imgs = {c["short"]: c.get("img") for c in js_array(src, "CLUBS")}
    out = {}
    for p in js_array(src, "PL_PLAYERS"):
        out.setdefault(p.get("b"), []).append({
            "team": NAME_BY_SHORT.get(p["c"]), "n": p["n"],
            "pos": POS_NAME.get(p.get("p"), p.get("p")),
            "min": p.get("min"), "yc": p.get("yc"), "rc": p.get("rc"),
            "fc90": p.get("f"), "fd90": p.get("fw"),
            # tid is not emitted, and nothing downstream reads it — the club
            # crest comes from img, which CLUBS does carry.
            "tid": None, "img": imgs.get(p["c"]),
        })
    return out


def source(name, basis, shipped, reused):
    """This run's harvest for one source, or the last one if it didn't run.

    Falling back is the difference between a partial refresh and a destroyed
    dataset: without a cookie there is no pl_players.json, and taking that at
    face value would ship an empty league. Every fallback is named on stdout so
    a refresh never quietly re-commits stale data while looking like it worked.
    """
    fresh = load_optional(name)
    if fresh:
        return fresh
    kept = shipped.get(basis, [])
    if kept:
        reused.append(f"{name} ({_n_players(len(kept))} kept from the previous build)")
    return kept


def build_players():
    shipped = shipped_rows()
    reused = []
    rows = []
    for p in source("pl_players.json", "PL", shipped, reused):
        if p.get("team") in DROP:
            continue
        rows.append(mk(p, "PL"))
    for p in source("champ_promoted.json", "EFL", shipped, reused):
        rows.append(mk(p, "EFL"))
    # The promoted clubs' remaining squad, from the free FPL feed, with no form
    # attached. Loaded AFTER champ_promoted so the de-duplication below keeps
    # the Championship rate wherever one exists: a real number must never be
    # overwritten by a blank one, and the order is the only thing enforcing
    # that.
    for p in source("promoted_squads.json", "NEW", shipped, reused):
        rows.append(mk(p, "NEW"))
    if reused:
        print("Reusing the previous build for sources that did not harvest:")
        for r in reused:
            print("  - " + r)
    # De-duplicate on (club, name): a harvest that repeats a player (the
    # promoted-club feeds have done this) must never fan out into the shipped
    # data — duplicate rows in a prediction product erode trust instantly.
    seen, deduped = set(), []
    for r in rows:
        if not r:
            continue
        key = (r["c"], r["n"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    # After the de-duplication, so a player is filled once and on the row that
    # actually ships, and after the basis labels are set, because a fill must
    # never look like a change of source: a row filled here is still a
    # ScoutingStats row that gained one field.
    fill_fouls_won(deduped)
    return deduped


def mk(p, basis, resolve=None):
    """One source row into a shipped player row.

    `resolve` maps a feed's club name to a short code; it defaults to this
    league's SHORT map. The Championship builder passes its own, so the risk
    formula, the per-90 conversions and the fouls-won key fallbacks are shared
    rather than reimplemented — the arithmetic here is the product.
    """
    club = p.get("team")
    short = (resolve or SHORT.get)(club)
    if not short:
        return None
    mins = num(p.get("min")) or 0
    yc = num(p.get("yc"))
    rc = num(p.get("rc"))
    fc90 = num(p.get("fc90"))
    # Fouls won (fouls drawn) per 90. ScoutingStats key varies by export; try
    # the parallels of fc90 in order. Absent in older harvests -> stays null,
    # and the app hides the metric until a refresh populates it.
    fw90 = num(p.get("fd90"))
    if fw90 is None:
        fw90 = num(p.get("fw90"))
    if fw90 is None:
        fw90 = num(p.get("fouls_drawn_p90"))
    yc90 = round(yc / mins * 90, 3) if (yc is not None and mins > 0) else None
    risk = round((yc90 * 2) + fc90, 3) if (yc90 is not None and fc90 is not None) else None
    return {
        "c": short, "n": p.get("n"), "p": POS.get(p.get("pos"), p.get("pos") or ""),
        "min": int(mins), "yc": int(yc) if yc is not None else None,
        "rc": int(rc) if rc is not None else None,
        "y": yc90, "f": fc90, "fw": (round(fw90, 3) if fw90 is not None else None),
        "r": risk,
        "ls": (mins < LOW_MIN), "b": basis,
        # ph: the player's photograph. inj: injured/unavailable per the feed.
        # Both stay None when the source did not supply them, so a desk shows
        # a monogram and no flag rather than a broken image and a false "fit".
        "ph": p.get("photo") or None,
        "inj": (True if p.get("inj") is True else None),
        "_club": club, "_tid": p.get("tid"), "_img": p.get("img"),
        "_fouls": (fc90 * mins / 90) if (fc90 is not None) else 0,
    }


# strip_accents removes COMBINING marks — every Spanish, French and Portuguese
# diacritic, and Gyökeres's umlaut. It does not touch ø, æ, ß, ł or ð, which
# are distinct letters rather than a letter plus a mark and survive NFKD whole.
# So "Nørgaard" and "Norgaard" share no key at all, on either stage, and two
# feeds that disagree about one character drop the player silently: the
# matched-nothing guard only fires when the join finds NOBODY, and a handful of
# Scandinavians going missing among 456 matches is exactly the size of failure
# it cannot see. Both feeds happen to write "Nørgaard" today, which is luck
# rather than a property of either.
#
# Folded here rather than in leagues.strip_accents, which the club joins for
# three leagues depend on — a shared primitive is the wrong place to widen for
# one caller's benefit.
FOLD = {"ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "đ": "d", "ð": "d",
        "ł": "l", "þ": "th", "ŋ": "n", "ı": "i"}


def fold_letters(text):
    """The letters NFKD leaves alone, in their conventional Latin form."""
    for a, b in FOLD.items():
        text = text.replace(a, b).replace(a.upper(), b.upper())
    return text


def name_keys(name):
    """A player's name as join keys, longest-confidence first.

    The two feeds do not spell a player the same way. ScoutingStats writes him
    out ("Christian Nørgaard"); API-Football abbreviates the forename
    ("C. Nørgaard"). Accents survive in one and not always the other. So the
    full name is tried first and an initial-plus-surname key second — the same
    two-stage join build_refs.py already uses for officials, for the same
    reason.

    Returns (full, initial) or (None, None) for a name with no letters in it.
    """
    flat = fold_letters(leagues.strip_accents(name or "")).lower()
    parts = "".join(ch if ch.isalpha() else " " for ch in flat).split()
    if not parts:
        return None, None
    return " ".join(parts), parts[0][0] + " " + parts[-1]


def fouls_won_index(rows):
    """(club, name key) -> fouls won, from the API-Football squads.

    Ambiguity is dropped rather than guessed. Two players at one club who share
    an initial and a surname collapse to the same second-stage key, and picking
    either would attach one man's fouls to the other silently — so the key is
    removed and those players simply keep their dash.
    """
    exact, initial, clash = {}, {}, set()
    for r in rows or []:
        short = SHORT.get(r.get("team"))
        fw = num(r.get("fd90"))
        if not short or fw is None:
            continue
        full, ini = name_keys(r.get("n"))
        if not full:
            continue
        exact[(short, full)] = fw
        key = (short, ini)
        if key in initial and initial[key] != fw:
            clash.add(key)
        initial[key] = fw
    for key in clash:
        initial.pop(key, None)
    return exact, initial, len(clash)


def fill_fouls_won(rows):
    """Fill fw from the API-Football harvest, where and only where it is null.

    A fill, not a merge: an existing number always wins, no row is created, and
    no other field is read. The failure this guards against is the one a join
    makes silently — matching almost nothing and looking exactly like a feed
    that simply had no data. So the match rate is printed every run, and a join
    that had gaps to fill and closed none of them stops the build instead of
    shipping a league of dashes that reads as "the source has no fouls".
    """
    src = load_optional(AF_FILL)
    gaps = [r for r in rows if r.get("fw") is None]
    if not src:
        if gaps:
            print(f"Fouls won: {AF_FILL} not harvested, so the dash stays on "
                  f"{_n_players(len(gaps))}.")
        return 0

    # Which season, and whose. Both would produce a page of entirely plausible
    # numbers if they were wrong, which is the only reason this is checked at
    # all: last season's fouls on this season's players is not a visible error.
    af_league, af_season = stamp(AF_FILL)
    if af_season is None:
        print(f"Fouls won: {AF_FILL} carries no season stamp (harvested before "
              f"they existed), so it is being taken as {FORM_SEASON}. The next "
              "refresh stamps it.")
    elif af_season != FORM_SEASON or (af_league or "PL") != "PL":
        sys.exit(
            f"ERROR: {AF_FILL} holds {af_league or '?'} season {af_season}, but "
            f"this build's form is PL season {FORM_SEASON}.\n"
            "Filling from it would put one season's fouls won on another "
            "season's players, and every number would look right.\n\n"
            "Either re-harvest that season:\n"
            f"    API_FOOTBALL_SEASON={FORM_SEASON} python3 "
            f"data/harvest_apifootball.py --league PL --out {AF_FILL}\n"
            "or, if the form itself has moved on, move FORM_SEASON in this "
            "file to match it.")

    if not gaps:
        print(f"Fouls won: every row already carries one; {AF_FILL} not needed.")
        return 0

    # AN EMPTY FEED AND A BROKEN JOIN ARE NOT THE SAME FAILURE, and the refusal
    # below used to treat them as one.
    #
    # The comment above says they are indistinguishable in the shipped file, and
    # that is true — but they are perfectly distinguishable HERE, in the source:
    # count the rows that actually carry a fouls-won number. None at all is an
    # upstream that returned squads without statistics, which is what happens
    # when API-Football rolls a season over. Rows that carry numbers plus a join
    # that matches nothing is a broken key, which is the thing worth stopping
    # for.
    #
    # Conflating them cost a whole day of refreshes. The 10 August run died
    # here, so referees, fixtures, injuries and every other desk stayed frozen
    # on 6 August data four days before the Championship opened — over one
    # supplementary column. Worse, the error names three source rows whatever
    # the cause, so the message read as "the names do not match" and sent the
    # next reader into name_keys() when nothing was wrong with it.
    carrying = sum(1 for r in src if num(r.get("fd90")) is not None)
    if not carrying:
        print(f"::warning::Fouls won: {AF_FILL} holds {len(src)} rows and not "
              "one of them carries a fouls-won number — the feed returned "
              "squads without statistics, which is what a season rollover "
              f"looks like. {_n_players(len(gaps))} keep the value from the "
              "previous build rather than the refresh stopping here.")
        return 0

    exact, initial, clashes = fouls_won_index(src)
    by_exact = by_initial = 0
    for r in gaps:
        full, ini = name_keys(r["n"])
        if full is None:
            continue
        if (r["c"], full) in exact:
            r["fw"] = exact[(r["c"], full)]
            by_exact += 1
        elif (r["c"], ini) in initial:
            r["fw"] = initial[(r["c"], ini)]
            by_initial += 1

    filled = by_exact + by_initial
    if not filled:
        # WHAT THE GUARD IS ACTUALLY FOR, restated because the original test
        # was a proxy that stopped tracking it.
        #
        # The fear is shipping a league of DASHES that reads as "the source has
        # no fouls won" — indistinguishable, in the file, from a source that
        # genuinely had none. That is a fact about the SHIPPED COVERAGE, and the
        # test was "did this top-up match anything", which is a different
        # question and answers the first one only while the two move together.
        #
        # They stopped moving together the day the promoted clubs arrived. This
        # is a FILL: it touches only rows the primary source left null, and by
        # August those rows are precisely the players last season's Premier
        # League cannot describe — 120 of the 186 gaps are Coventry, Hull and
        # Ipswich, who spent it in the Championship. A source that cannot reach
        # them matching none of them is arithmetic, not a broken join, and it
        # took every desk down for a day over a column that was 72% populated.
        #
        # So the refusal now asks the real question: would this build ship
        # without meaningful fouls-won coverage? If the primary source is
        # working, no, and the fill is supplementary. If it is not, that is the
        # league of dashes and it still stops.
        reachable = {SHORT.get(r.get("team")) for r in src}
        reachable.discard(None)
        stranded = sum(1 for r in gaps if r["c"] not in reachable)
        have = sum(1 for r in rows if r.get("fw") is not None)
        coverage = have / len(rows) if rows else 0.0
        why = (f"{AF_FILL} holds {len(src)} rows, {carrying} of them carrying a "
               f"fouls-won number, and {len(gaps)} players want one — but the "
               f"join matched none of them.\n"
               f"  {stranded} of those {len(gaps)} play for a club the source "
               "does not cover at all, so no key could ever reach them.\n"
               "  a source row WITH a number: "
               + ", ".join([str(r.get("n")) for r in src
                            if num(r.get("fd90")) is not None][:3])
               + "\n  a player wanting one: "
               + ", ".join(r["n"] for r in gaps[:3]))
        if coverage >= FW_MIN_COVERAGE:
            print(f"::warning::Fouls won: {why}\n  Shipping anyway: "
                  f"{have} of {len(rows)} players ({coverage:.0%}) carry a "
                  "fouls-won number from the primary source, so this is a "
                  "top-up that reached nobody, not a league of dashes.")
            return 0
        sys.exit(
            f"ERROR: {why}\n\nAnd only {have} of {len(rows)} players "
            f"({coverage:.0%}) carry a fouls-won number at all, which is under "
            f"the {FW_MIN_COVERAGE:.0%} floor — this would ship a column of "
            "dashes that reads as 'the source has none'.")
    print(f"Fouls won: filled {filled} of {len(gaps)} missing "
          f"({by_exact} on full name, {by_initial} on initial + surname)"
          + (f"; {clashes} ambiguous key(s) left alone" if clashes else ""))
    return filled


def club_basis(bases):
    """A club's basis describes its TEAM aggregate, not its players.

    A promoted club now carries two kinds of row: the few with real
    Championship form (EFL) and the rest with none yet (NEW). Both produce the
    same team aggregate — none — so the club label's job is only to say "not on
    Premier League data", which EFL already means everywhere in the app. The
    EFL/NEW distinction lives where it changes what a reader should believe:
    on the player row.

    Derived from the whole squad rather than read off whichever row happened to
    load first, so the label cannot flip when a harvest changes order."""
    bases = set(bases)
    return "PL" if bases == {"PL"} else "EFL"


def build_clubs(players):
    by = {}
    for p in players:
        c = p["c"]
        d = by.setdefault(c, {"short": c, "name": p["_club"], "tid": p["_tid"],
                              "img": None, "bases": [], "yc": 0, "fouls": 0.0,
                              "players": 0})
        # First NON-NULL crest, not the first player's. Squads are a mix of
        # sources and only some carry a badge — the FPL fill-in rows carry
        # none — so keying off whichever row sorted first would blank a club
        # whose first row happened to be a fill-in.
        if d["img"] is None and p["_img"]:
            d["img"] = p["_img"]
        d["bases"].append(p["b"])
        d["yc"] += (p["yc"] or 0)
        d["fouls"] += p["_fouls"]
        d["players"] += 1
    for d in by.values():
        d["basis"] = club_basis(d["bases"])
    clubs = []
    for c, d in by.items():
        if d["basis"] == "PL":
            # PL minutes are league-only, so team per-game rates are reliable
            ca = round(d["yc"] / 38, 2)
            fm = round(d["fouls"] / 38, 1)
        else:
            # Championship minutes include cup games, so the team per-game
            # aggregate is not comparable; a NEW club has no minutes at all.
            # Omit rather than ship a wrong number.
            ca = None
            fm = None
        clubs.append({"short": c, "name": d["name"], "img": d["img"], "basis": d["basis"],
                      "ca": ca, "fm": fm, "squad": d["players"]})
    clubs.sort(key=lambda x: (x["ca"] is None, -(x["ca"] or 0)))
    return clubs


# The reverse of the abbreviated names main() emits for REFS.
REF_FIELD = {"n": "name", "region": "region", "matches": "matches", "ypg": "ypg",
             "red": "red_pg", "pen": "pen_pg", "fpg": "fouls_pg", "cpf": "cards_per_foul"}


def shipped_refs():
    if not OUT.exists():
        return []
    return [{REF_FIELD[k]: v for k, v in r.items() if k in REF_FIELD}
            for r in js_array(OUT.read_text(encoding="utf-8"), "REFS")]


def build_refs():
    """Referees, with the same previous-build fallback as the players.

    In the refresh workflow build_refs.py always runs first, so pl_refs.json is
    always there — but it is gitignored like every other raw harvest, and a
    build that crashed on its absence could not be run standalone at all. It
    also means a rebuild triggered for the players' sake cannot destroy the
    referee table as a side effect."""
    path = DATA / "pl_refs.json"
    if path.exists():
        refs = list(json.loads(path.read_text(encoding="utf-8"))["refs"])
    else:
        refs = shipped_refs()
        if refs:
            print(f"Reusing the previous build for pl_refs.json ({len(refs)} referees kept).")
    refs.sort(key=lambda r: -(r.get("ypg") or 0))
    return refs


def _league():
    """The Premier League's registry entry. Imported lazily inside a function
    because leagues.py has no dependency on this module and should not gain
    one — the registry is the lower layer."""
    import leagues
    return leagues.get("PL")


def jsval(x):
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, str):
        return json.dumps(x, ensure_ascii=False)
    return str(x)


def player_row(p):
    """One shipped player as the text that goes in the file.

    A FUNCTION, not an inline join, so a test can call the real emitter rather
    than reimplement it. That distinction is not academic: ph and inj were
    added to mk() and left out of the writer's key list, the refresh ran green,
    and pl_data.js came out byte-identical with no photographs in it. A test
    that rebuilds the row itself passes happily through exactly that.

    ph/inj are emitted only when present, so a source that never carried them
    adds nothing rather than a column of nulls — the desks already read a
    missing field as "no photo, nothing known".
    """
    parts = [
        f'c:{jsval(p["c"])}', f'n:{jsval(p["n"])}', f'p:{jsval(p["p"])}',
        f'min:{p["min"]}', f'yc:{jsval(p["yc"])}', f'rc:{jsval(p["rc"])}',
        f'y:{jsval(p["y"])}', f'f:{jsval(p["f"])}', f'fw:{jsval(p["fw"])}',
        f'r:{jsval(p["r"])}', f'ls:{jsval(p["ls"])}', f'b:{jsval(p["b"])}',
    ]
    if p.get("ph"):
        parts.append(f'ph:{jsval(p["ph"])}')
    if p.get("inj"):
        parts.append('inj:true')
    return "{" + ",".join(parts) + "}"


def main():
    players = build_players()
    problems = coverage_problems(players)
    if problems:
        sys.exit(
            "ERROR: the promoted-club (Championship) data is incomplete, so "
            "pl_data.js was NOT rewritten:\n  - "
            + "\n  - ".join(problems)
            + "\n\nThe Championship harvest only ever returns the players who cleared "
              "its minutes floor, so it cannot fill a squad on its own and nothing "
              "downstream can reconstruct a missing centre-back. Run\n"
              "    python3 data/harvest_fpl_squads.py\n"
              "which takes the squads from the free FPL feed with no cookie and no "
              "key, and writes promoted_squads.json. Those rows carry no form by "
              "design — they fill in as Premier League minutes accumulate."
        )
    clubs = build_clubs(players)
    refs = build_refs()

    lines = ["// Auto-generated by build_pl_data.py. ScoutingStats 2025-26 form.",
             "// 2026-27 Premier League. Promoted clubs flagged EFL (Championship basis);",
             "// their players without a Championship rate are flagged NEW, rates null.",
             # The league's suspension rule, from data/leagues.py — shipped so the
             # page computes with it instead of hardcoding thresholds. The
             # Premier League's gates (19, 32) differ from the Championship's
             # (19, 37) because the seasons are different lengths, and that is
             # exactly the kind of constant that rots when it is written twice.
             "const SUSPENSION = " + json.dumps(_league().suspension_scheme) + ";",
             "const CLUBS = ["]
    for c in clubs:
        lines.append("  {" + ",".join([
            f'short:{jsval(c["short"])}', f'name:{jsval(c["name"])}', f'img:{jsval(c["img"])}',
            f'basis:{jsval(c["basis"])}', f'ca:{jsval(c["ca"])}', f'fm:{jsval(c["fm"])}',
            f'squad:{c["squad"]}',
        ]) + "},")
    lines.append("];")
    lines.append("const PL_PLAYERS = [")
    pout = sorted(players, key=lambda x: (x["c"], x["r"] is None, -(x["r"] or 0), x["n"] or ""))
    for p in pout:
        lines.append("  " + player_row(p) + ",")
    lines.append("];")
    lines.append("const REFS = [")
    for r in refs:
        lines.append("  {" + ",".join([
            f'n:{jsval(r["name"])}', f'region:{jsval(r.get("region") or "")}',
            f'matches:{jsval(r.get("matches"))}', f'ypg:{jsval(r.get("ypg"))}',
            f'red:{jsval(r.get("red_pg"))}', f'pen:{jsval(r.get("pen_pg"))}',
            f'fpg:{jsval(r.get("fouls_pg"))}', f'cpf:{jsval(r.get("cards_per_foul"))}',
        ]) + "},")
    lines.append("];")
    OUT.write_text("\n".join(lines), encoding="utf-8")

    # report
    print(f"players: {len(players)}  clubs: {len(clubs)}  refs: {len(refs)}")
    print(f"size: {OUT.stat().st_size/1024:.1f} KB")
    print("club cards-against per game (tier basis):")
    for c in clubs:
        ca = "  -" if c["ca"] is None else f"{c['ca']:>4}"
        fm = "   -" if c["fm"] is None else f"{c['fm']:>5}"
        print(f"   {ca}  {fm} fm  {c['short']} {c['name']} ({c['basis']}, {c['squad']} players)")


if __name__ == "__main__":
    main()

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
OUT = DATA / "pl_data.js"
LOW_MIN = 450

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
        "_club": club, "_tid": p.get("tid"), "_img": p.get("img"),
        "_fouls": (fc90 * mins / 90) if (fc90 is not None) else 0,
    }


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


def jsval(x):
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, str):
        return json.dumps(x, ensure_ascii=False)
    return str(x)


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
        lines.append("  {" + ",".join([
            f'c:{jsval(p["c"])}', f'n:{jsval(p["n"])}', f'p:{jsval(p["p"])}',
            f'min:{p["min"]}', f'yc:{jsval(p["yc"])}', f'rc:{jsval(p["rc"])}',
            f'y:{jsval(p["y"])}', f'f:{jsval(p["f"])}', f'fw:{jsval(p["fw"])}',
            f'r:{jsval(p["r"])}', f'ls:{jsval(p["ls"])}', f'b:{jsval(p["b"])}',
        ]) + "},")
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

#!/usr/bin/env python3
"""
Build the Premier League Bookings Desk dataset for 2026-27.

Inputs (harvested from ScoutingStats, logged in):
  pl_players.json     2025-26 Premier League players (league 8, season 25583)
  champ_promoted.json 2025-26 Championship players for the 3 promoted clubs
  pl_refs.json        2025-26 PL referee card rates (tips.gg)

Output: pl_data.js with PL_PLAYERS, CLUBS and REFS.

2026-27 lineup: 17 continuing PL clubs (drop Burnley, West Ham, Wolves) plus
Coventry, Ipswich, Hull (promoted, 2025-26 Championship form, flagged EFL).
Booking risk = yc_p90*2 + fouls_p90, the same metric as the WC desk.

The r shipped here is the RAW risk. The app shrinks each player's yellow and
foul rates toward his positional mean in proportion to minutes at load time
(empirical Bayes; see the shrinkage block in index.html) and overwrites r
with the shrunk value, so keep this output raw — shrinking here too would
apply the prior twice. That is why yc and min travel alongside the per-90
rates: the app needs the raw counts to rebuild the rates exactly.
"""

import json
from pathlib import Path

DATA = Path(__file__).resolve().parent
OUT = DATA / "pl_data.js"
LOW_MIN = 450

DROP = {"Burnley", "West Ham United", "Wolverhampton Wanderers"}  # relegated
POS = {"Goalkeeper": "GK", "Defender": "DF", "Midfielder": "MF", "Attacker": "FW"}

SHORT = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "AFC Bournemouth": "BOU", "Brentford": "BRE",
    "Brighton & Hove Albion": "BHA", "Chelsea": "CHE", "Crystal Palace": "CRY",
    "Everton": "EVE", "Fulham": "FUL", "Leeds United": "LEE", "Liverpool": "LIV",
    "Manchester City": "MCI", "Manchester United": "MUN", "Newcastle United": "NEW",
    "Nottingham Forest": "NFO", "Sunderland": "SUN", "Tottenham Hotspur": "TOT",
    "Coventry City": "COV", "Ipswich Town": "IPS", "Hull City": "HUL",
}
# extra referees from public search data (lenient end), flagged source
EXTRA_REFS = [
    {"name": "Craig Pawson", "region": "South Yorkshire", "matches": None, "yellows": None, "ypg": 2.5, "red_pg": None, "pen_pg": None},
    {"name": "Tony Harrington", "region": "Cleveland", "matches": 12, "yellows": 38, "ypg": 3.3, "red_pg": None, "pen_pg": None},
]


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load(name):
    d = json.loads((DATA / name).read_text(encoding="utf-8"))
    return d["players"] if isinstance(d, dict) and "players" in d else d


def build_players():
    rows = []
    for p in load("pl_players.json"):
        if p.get("team") in DROP:
            continue
        rows.append(mk(p, "PL"))
    for p in load("champ_promoted.json"):
        rows.append(mk(p, "EFL"))
    # The Championship harvest repeats each player once per query page, so
    # dedupe on (club, name), keeping the row with the most minutes.
    best = {}
    for r in rows:
        if not r:
            continue
        key = (r["c"], r["n"])
        if key not in best or r["min"] > best[key]["min"]:
            best[key] = r
    return list(best.values())


def mk(p, basis):
    club = p.get("team")
    short = SHORT.get(club)
    if not short:
        return None
    mins = num(p.get("min")) or 0
    yc = num(p.get("yc"))
    rc = num(p.get("rc"))
    fc90 = num(p.get("fc90"))
    yc90 = round(yc / mins * 90, 3) if (yc is not None and mins > 0) else None
    risk = round((yc90 * 2) + fc90, 3) if (yc90 is not None and fc90 is not None) else None
    return {
        "c": short, "n": p.get("n"), "p": POS.get(p.get("pos"), p.get("pos") or ""),
        "min": int(mins), "yc": int(yc) if yc is not None else None,
        "rc": int(rc) if rc is not None else None,
        "y": yc90, "f": fc90, "r": risk,
        "ls": (mins < LOW_MIN), "b": basis,
        "_club": club, "_tid": p.get("tid"), "_img": p.get("img"),
        "_fouls": (fc90 * mins / 90) if (fc90 is not None) else 0,
    }


def build_clubs(players):
    by = {}
    for p in players:
        c = p["c"]
        d = by.setdefault(c, {"short": c, "name": p["_club"], "tid": p["_tid"],
                              "img": p["_img"], "basis": p["b"], "yc": 0, "fouls": 0.0,
                              "players": 0})
        d["yc"] += (p["yc"] or 0)
        d["fouls"] += p["_fouls"]
        d["players"] += 1
    clubs = []
    for c, d in by.items():
        if d["basis"] == "PL":
            # PL minutes are league-only, so team per-game rates are reliable
            ca = round(d["yc"] / 38, 2)
            fm = round(d["fouls"] / 38, 1)
        else:
            # Championship minutes include cup games, so the team per-game
            # aggregate is not comparable. Omit rather than ship a wrong number.
            ca = None
            fm = None
        clubs.append({"short": c, "name": d["name"], "img": d["img"], "basis": d["basis"],
                      "ca": ca, "fm": fm, "squad": d["players"]})
    clubs.sort(key=lambda x: (x["ca"] is None, -(x["ca"] or 0)))
    return clubs


def build_refs():
    d = json.loads((DATA / "pl_refs.json").read_text(encoding="utf-8"))
    refs = list(d["refs"]) + EXTRA_REFS
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
    clubs = build_clubs(players)
    refs = build_refs()

    lines = ["// Auto-generated by build_pl_data.py. ScoutingStats 2025-26 form.",
             "// 2026-27 Premier League. Promoted clubs flagged EFL (Championship basis).",
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
            f'y:{jsval(p["y"])}', f'f:{jsval(p["f"])}', f'r:{jsval(p["r"])}',
            f'ls:{jsval(p["ls"])}', f'b:{jsval(p["b"])}',
        ]) + "},")
    lines.append("];")
    lines.append("const REFS = [")
    for r in refs:
        lines.append("  {" + ",".join([
            f'n:{jsval(r["name"])}', f'region:{jsval(r.get("region") or "")}',
            f'matches:{jsval(r.get("matches"))}', f'ypg:{jsval(r.get("ypg"))}',
            f'red:{jsval(r.get("red_pg"))}', f'pen:{jsval(r.get("pen_pg"))}',
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

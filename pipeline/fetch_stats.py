#!/usr/bin/env python3
"""Refresh sources/players_current.json with 2026-27 in-season player stats.

Uses the same ScoutingStats (Sportmonks) endpoint the original harvest came
from. Configure via environment:

  SCOUTINGSTATS_BASE     e.g. https://scoutingstats.ai  (required to run)
  SCOUTINGSTATS_COOKIE   session cookie if the API needs a login
  SCOUTINGSTATS_SEASON   Sportmonks season id for PL 2026-27 (required)
  AS_OF_MATCHDAY         integer matchday just completed (required)

Without SCOUTINGSTATS_BASE this exits 0 without touching the file, so the
site keeps running on the last good harvest (or the 2025-26 prior).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent / "sources"
OUT = SRC / "players_current.json"
LOW_MIN = 450

POS = {"Goalkeeper": "GK", "Defender": "DF", "Midfielder": "MF", "Attacker": "FW"}

# 2026-27 club-name → short map (must cover every PL club this season)
SHORT = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "AFC Bournemouth": "BOU",
    "Brentford": "BRE", "Brighton & Hove Albion": "BHA", "Chelsea": "CHE",
    "Crystal Palace": "CRY", "Everton": "EVE", "Fulham": "FUL",
    "Leeds United": "LEE", "Liverpool": "LIV", "Manchester City": "MCI",
    "Manchester United": "MUN", "Newcastle United": "NEW",
    "Nottingham Forest": "NFO", "Sunderland": "SUN", "Tottenham Hotspur": "TOT",
    "Coventry City": "COV", "Ipswich Town": "IPS", "Hull City": "HUL",
}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    base = os.environ.get("SCOUTINGSTATS_BASE")
    season = os.environ.get("SCOUTINGSTATS_SEASON")
    as_of = os.environ.get("AS_OF_MATCHDAY")
    if not base:
        print("SCOUTINGSTATS_BASE not set; keeping existing players_current.json")
        return
    if not season or not as_of:
        print("SCOUTINGSTATS_SEASON and AS_OF_MATCHDAY are required", file=sys.stderr)
        sys.exit(1)

    url = f"{base.rstrip('/')}/api/league/8/player-stats?season={season}"
    headers = {"Accept": "application/json"}
    cookie = os.environ.get("SCOUTINGSTATS_COOKIE")
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    raw = d["players"] if isinstance(d, dict) and "players" in d else d

    players = []
    for p in raw:
        c = SHORT.get(p.get("team"))
        if not c:
            continue
        mins = num(p.get("min")) or 0
        yc = num(p.get("yc"))
        rc = num(p.get("rc"))
        fc90 = num(p.get("fc90"))
        y90 = round(yc / mins * 90, 3) if (yc is not None and mins > 0) else None
        risk = round(y90 * 2 + fc90, 3) if (y90 is not None and fc90 is not None) else None
        players.append({
            "c": c, "n": p.get("n"), "p": POS.get(p.get("pos"), p.get("pos") or ""),
            "min": int(mins), "yc": int(yc) if yc is not None else None,
            "rc": int(rc) if rc is not None else None,
            "y": y90, "f": fc90, "r": risk,
            "ls": mins < LOW_MIN, "b": "PL",
        })

    OUT.write_text(json.dumps({
        "note": "2026-27 in-season stats via fetch_stats.py",
        "as_of_matchday": int(as_of),
        "players": players,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(players)} current-season players (matchday {as_of})")


if __name__ == "__main__":
    main()

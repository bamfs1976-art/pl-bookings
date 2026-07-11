#!/usr/bin/env python3
"""Refresh sources/players_current.json with 2026-27 in-season player stats.

Primary source: API-Football (api-sports.io) — the same free key used by
fetch_results.py. The /players endpoint carries minutes, appearances,
yellows/reds and fouls committed on the free tier, so no paid stats
subscription is needed anywhere in the pipeline.

  API_FOOTBALL_KEY       api-sports key (primary)
  AS_OF_MATCHDAY         optional; derived from sources/results.json if unset

Legacy fallback (only if API_FOOTBALL_KEY is absent): the original
ScoutingStats endpoint with a normal logged-in session cookie —
SCOUTINGSTATS_BASE, SCOUTINGSTATS_COOKIE, SCOUTINGSTATS_SEASON.

With neither configured this exits 0 without touching the file, so the site
keeps running on the last good harvest (or the 2025-26 prior).
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from fetch_results import short

SRC = Path(__file__).resolve().parent / "sources"
OUT = SRC / "players_current.json"
LOW_MIN = 450
LEAGUE = 39
SEASON = 2026

POS = {"Goalkeeper": "GK", "Defender": "DF", "Midfielder": "MF", "Attacker": "FW"}

# ScoutingStats club names (legacy path only)
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


def mk_row(club, name, pos, mins, yc, rc, fouls, apps):
    """Build one players_current row in the app's canonical shape."""
    mins = mins or 0
    y90 = round(yc / mins * 90, 3) if (yc is not None and mins > 0) else None
    f90 = round(fouls / mins * 90, 2) if (fouls is not None and mins > 0) else None
    risk = round(y90 * 2 + f90, 3) if (y90 is not None and f90 is not None) else None
    return {
        "c": club, "n": name, "p": pos,
        "min": int(mins),
        "yc": int(yc) if yc is not None else None,
        "rc": int(rc) if rc is not None else None,
        "y": y90, "f": f90, "r": risk,
        "ls": mins < LOW_MIN, "b": "PL",
        "apps": int(apps) if apps else None,
    }


def rows_from_api_football(items: list[dict]) -> list[dict]:
    """Map API-Football /players items to our row shape.

    A player transferred between PL clubs has several league-39 stat blocks:
    counts are summed, the club comes from the block with the most minutes.
    """
    rows = []
    for item in items:
        name = (item.get("player") or {}).get("name")
        blocks = [s for s in item.get("statistics") or []
                  if ((s.get("league") or {}).get("id")) == LEAGUE]
        if not name or not blocks:
            continue
        mins = yc = rc = fouls = apps = 0.0
        best = (None, -1.0)  # (club short, minutes)
        pos = ""
        for s in blocks:
            g = s.get("games") or {}
            m = num(g.get("minutes")) or 0
            mins += m
            apps += num(g.get("appearences")) or 0
            yc += num((s.get("cards") or {}).get("yellow")) or 0
            rc += num((s.get("cards") or {}).get("red")) or 0
            fouls += num((s.get("fouls") or {}).get("committed")) or 0
            club = short((s.get("team") or {}).get("name") or "")
            if club and m > best[1]:
                best = (club, m)
            pos = POS.get(g.get("position"), pos) or pos
        if not best[0] or mins <= 0:
            continue
        rows.append(mk_row(best[0], name, pos, mins, yc, rc, fouls, apps))
    return rows


def api(path: str, key: str):
    req = urllib.request.Request(
        f"https://v3.football.api-sports.io/{path}",
        headers={"x-apisports-key": key})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_api_football(key: str) -> list[dict]:
    items, page, total = [], 1, 1
    while page <= total:
        d = api(f"players?league={LEAGUE}&season={SEASON}&page={page}", key)
        items.extend(d.get("response", []))
        total = (d.get("paging") or {}).get("total") or 1
        page += 1
        time.sleep(0.35)
    return rows_from_api_football(items)


def fetch_scoutingstats(base: str) -> list[dict]:
    season = os.environ.get("SCOUTINGSTATS_SEASON")
    if not season:
        print("SCOUTINGSTATS_SEASON is required for the legacy path", file=sys.stderr)
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
    rows = []
    for p in raw:
        c = SHORT.get(p.get("team"))
        if not c:
            continue
        mins = num(p.get("min")) or 0
        fc90 = num(p.get("fc90"))
        fouls = fc90 * mins / 90 if (fc90 is not None) else None
        rows.append(mk_row(c, p.get("n"), POS.get(p.get("pos"), p.get("pos") or ""),
                           mins, num(p.get("yc")), num(p.get("rc")), fouls, None))
    return rows


def derive_matchday() -> int:
    env = os.environ.get("AS_OF_MATCHDAY")
    if env:
        return int(env)
    results = SRC / "results.json"
    if results.exists():
        matches = json.loads(results.read_text(encoding="utf-8")).get("matches", [])
        if matches:
            return max(m["mw"] for m in matches)
    return 0


def main():
    key = os.environ.get("API_FOOTBALL_KEY")
    base = os.environ.get("SCOUTINGSTATS_BASE")
    if key:
        rows, src = fetch_api_football(key), "API-Football"
    elif base:
        rows, src = fetch_scoutingstats(base), "ScoutingStats"
    else:
        print("no stats source configured (API_FOOTBALL_KEY or SCOUTINGSTATS_BASE); "
              "keeping existing players_current.json")
        return

    if not rows:
        print(f"{src} returned no player stats (season not started?); "
              "keeping existing players_current.json")
        return

    OUT.write_text(json.dumps({
        "note": f"2026-27 in-season stats via fetch_stats.py ({src})",
        "as_of_matchday": derive_matchday(),
        "players": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(rows)} current-season players from {src} "
          f"(matchday {derive_matchday()})")


if __name__ == "__main__":
    main()

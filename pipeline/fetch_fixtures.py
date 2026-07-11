#!/usr/bin/env python3
"""Refresh sources/fixtures.json with the full 2026-27 schedule.

Sources, in order:
  1. football-data.org v4 (set FOOTBALL_DATA_TOKEN) — also carries referee
     names on finished/imminent matches on some plans.
  2. fixturedownload.com public feed (no key).

Without network access or a token this exits 0 leaving the existing file
untouched, so the weekly workflow never hard-fails on a missing secret.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent / "sources"
OUT = SRC / "fixtures.json"
SEASON = "2026-27"
SEASON_START_YEAR = 2026

# Every alias the two feeds use, mapped to our club shorts.
ALIASES = {
    "arsenal": "ARS", "arsenal fc": "ARS",
    "aston villa": "AVL", "aston villa fc": "AVL",
    "afc bournemouth": "BOU", "bournemouth": "BOU",
    "brentford": "BRE", "brentford fc": "BRE",
    "brighton": "BHA", "brighton & hove albion": "BHA", "brighton and hove albion": "BHA",
    "brighton & hove albion fc": "BHA",
    "chelsea": "CHE", "chelsea fc": "CHE",
    "coventry": "COV", "coventry city": "COV", "coventry city fc": "COV",
    "crystal palace": "CRY", "crystal palace fc": "CRY",
    "everton": "EVE", "everton fc": "EVE",
    "fulham": "FUL", "fulham fc": "FUL",
    "hull": "HUL", "hull city": "HUL", "hull city afc": "HUL",
    "ipswich": "IPS", "ipswich town": "IPS", "ipswich town fc": "IPS",
    "leeds": "LEE", "leeds united": "LEE", "leeds united fc": "LEE",
    "liverpool": "LIV", "liverpool fc": "LIV",
    "man city": "MCI", "manchester city": "MCI", "manchester city fc": "MCI",
    "man utd": "MUN", "manchester united": "MUN", "manchester united fc": "MUN",
    "newcastle": "NEW", "newcastle united": "NEW", "newcastle united fc": "NEW",
    "nott'm forest": "NFO", "nottingham forest": "NFO", "nottingham forest fc": "NFO",
    "sunderland": "SUN", "sunderland afc": "SUN",
    "spurs": "TOT", "tottenham": "TOT", "tottenham hotspur": "TOT",
    "tottenham hotspur fc": "TOT",
}


def short(name: str) -> str | None:
    return ALIASES.get((name or "").strip().lower())


def get_json(url: str, headers: dict | None = None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def fixture_id(mw: int, home: str, away: str) -> str:
    return f"2627-{mw:02d}-{home}-{away}"


def from_football_data(token: str) -> list[dict] | None:
    url = (f"https://api.football-data.org/v4/competitions/PL/matches"
           f"?season={SEASON_START_YEAR}")
    d = get_json(url, {"X-Auth-Token": token})
    rows = []
    for m in d.get("matches", []):
        h, a = short(m["homeTeam"]["name"]), short(m["awayTeam"]["name"])
        mw = m.get("matchday")
        if not h or not a or not mw:
            continue
        rows.append({"id": fixture_id(mw, h, a), "mw": mw,
                     "kickoff": m["utcDate"], "home": h, "away": a})
    return rows or None


def from_fixturedownload() -> list[dict] | None:
    d = get_json(f"https://fixturedownload.com/feed/json/epl-{SEASON_START_YEAR}")
    rows = []
    for m in d:
        h, a = short(m.get("HomeTeam")), short(m.get("AwayTeam"))
        mw = m.get("RoundNumber")
        if not h or not a or not mw:
            continue
        ko = (m.get("DateUtc") or "").replace(" ", "T").replace("TZ", "Z")
        if ko and not ko.endswith("Z"):
            ko += "Z"
        rows.append({"id": fixture_id(mw, h, a), "mw": mw,
                     "kickoff": ko, "home": h, "away": a})
    return rows or None


def main():
    rows = None
    src = None
    token = os.environ.get("FOOTBALL_DATA_TOKEN")
    if token:
        try:
            rows = from_football_data(token)
            src = "football-data.org v4"
        except Exception as e:
            print(f"football-data.org failed: {e}", file=sys.stderr)
    if rows is None:
        try:
            rows = from_fixturedownload()
            src = "fixturedownload.com"
        except Exception as e:
            print(f"fixturedownload.com failed: {e}", file=sys.stderr)
    if rows is None:
        print("no fixture source reachable; keeping existing fixtures.json")
        return

    rows.sort(key=lambda r: (r["mw"], r["kickoff"], r["id"]))
    OUT.write_text(json.dumps({
        "season": SEASON,
        "source": src,
        "note": "Overwritten by fetch_fixtures.py on each refresh.",
        "fixtures": rows,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(rows)} fixtures from {src}")


if __name__ == "__main__":
    main()

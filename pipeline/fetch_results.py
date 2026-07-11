#!/usr/bin/env python3
"""Refresh sources/results.json: finished 2026-27 matches + booked players.

Primary source is API-Football (api-sports.io), whose events feed carries
per-player cards on the free tier:

  API_FOOTBALL_KEY   api-sports key (required to run)

League 39 = Premier League. Matches are joined back to our fixture ids via
(matchweek, home short, away short), so run fetch_fixtures.py first.

Without the key this exits 0 leaving the file untouched.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent / "sources"
OUT = SRC / "results.json"
LEAGUE = 39
SEASON = 2026

ALIASES = {
    "arsenal": "ARS", "aston villa": "AVL", "bournemouth": "BOU",
    "brentford": "BRE", "brighton": "BHA", "chelsea": "CHE",
    "coventry": "COV", "coventry city": "COV",
    "crystal palace": "CRY", "everton": "EVE", "fulham": "FUL",
    "hull city": "HUL", "ipswich": "IPS", "ipswich town": "IPS",
    "leeds": "LEE", "leeds united": "LEE", "liverpool": "LIV",
    "manchester city": "MCI", "manchester united": "MUN",
    "newcastle": "NEW", "newcastle united": "NEW",
    "nottingham forest": "NFO", "sunderland": "SUN", "tottenham": "TOT",
}


def short(name: str) -> str | None:
    return ALIASES.get((name or "").strip().lower())


def api(path: str, key: str):
    req = urllib.request.Request(
        f"https://v3.football.api-sports.io/{path}",
        headers={"x-apisports-key": key})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        print("API_FOOTBALL_KEY not set; keeping existing results.json")
        return

    existing = {"matches": []}
    if OUT.exists():
        existing = json.loads(OUT.read_text(encoding="utf-8"))
    have = {m["fixture_id"] for m in existing["matches"]}

    d = api(f"fixtures?league={LEAGUE}&season={SEASON}&status=FT", key)
    matches = existing["matches"]
    fetched = 0
    for item in d.get("response", []):
        fx = item["fixture"]
        lg = item["league"]
        h = short(item["teams"]["home"]["name"])
        a = short(item["teams"]["away"]["name"])
        rnd = (lg.get("round") or "")
        mw = int(rnd.split("-")[-1].strip()) if "-" in rnd else None
        if not h or not a or not mw:
            continue
        fid = f"2627-{mw:02d}-{h}-{a}"
        if fid in have:
            continue
        ev = api(f"fixtures/events?fixture={fx['id']}", key)
        booked = []
        for e in ev.get("response", []):
            if e.get("type") == "Card":
                nm = (e.get("player") or {}).get("name")
                if nm and nm not in booked:
                    booked.append(nm)
        matches.append({
            "fixture_id": fid, "mw": mw,
            "kickoff": fx.get("date"),
            "home": h, "away": a,
            "score": f'{item["goals"]["home"]}-{item["goals"]["away"]}',
            "referee": fx.get("referee"),
            "booked": booked,
        })
        fetched += 1
        time.sleep(0.4)  # stay friendly to the free-tier rate limit

    matches.sort(key=lambda m: (m["mw"], m["fixture_id"]))
    OUT.write_text(json.dumps({
        "note": "Finished matches + booked players via fetch_results.py (API-Football).",
        "matches": matches,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"results.json: +{fetched} new, {len(matches)} total finished matches")


if __name__ == "__main__":
    main()

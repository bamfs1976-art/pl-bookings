#!/usr/bin/env python3
"""Fetch confirmed lineups for imminent fixtures into sources/lineups.json.

API-Football publishes lineups ~40-60 minutes before kick-off. Run this
close to kick-off (the lineups-refresh workflow, or locally) and rebuild:
starters get full expected minutes, bench players drop to cameo minutes,
and anyone outside the squad disappears from that fixture's candidates.

  API_FOOTBALL_KEY   api-sports key (required; exits 0 without it)
  LINEUP_WINDOW_H    look-ahead window in hours (default 48)
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fetch_results import short

SRC = Path(__file__).resolve().parent / "sources"
OUT = SRC / "lineups.json"
LEAGUE = 39
SEASON = 2026


def api(path: str, key: str):
    req = urllib.request.Request(
        f"https://v3.football.api-sports.io/{path}",
        headers={"x-apisports-key": key})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    key = os.environ.get("API_FOOTBALL_KEY")
    if not key:
        print("API_FOOTBALL_KEY not set; keeping existing lineups.json")
        return
    window = float(os.environ.get("LINEUP_WINDOW_H", "48"))

    fixtures = json.loads((SRC / "fixtures.json").read_text(encoding="utf-8"))["fixtures"]
    now = datetime.now(timezone.utc)
    upcoming = [f for f in fixtures
                if 0 <= (datetime.fromisoformat(f["kickoff"].replace("Z", "+00:00"))
                         - now).total_seconds() <= window * 3600]
    if not upcoming:
        print("no fixtures inside the look-ahead window")
        return

    existing = {}
    if OUT.exists():
        existing = json.loads(OUT.read_text(encoding="utf-8")).get("lineups", {})

    # Map our fixture ids to API-Football fixture ids by date + club shorts.
    dates = sorted({f["kickoff"][:10] for f in upcoming})
    api_by_key = {}
    for d in dates:
        resp = api(f"fixtures?league={LEAGUE}&season={SEASON}&date={d}", key)
        for item in resp.get("response", []):
            h = short(item["teams"]["home"]["name"])
            a = short(item["teams"]["away"]["name"])
            if h and a:
                api_by_key[(h, a)] = item["fixture"]["id"]
        time.sleep(0.4)

    fetched = 0
    for f in upcoming:
        api_id = api_by_key.get((f["home"], f["away"]))
        if not api_id:
            continue
        resp = api(f"fixtures/lineups?fixture={api_id}", key)
        sides = resp.get("response", [])
        if len(sides) < 2:
            continue  # not announced yet
        starters, subs = [], []
        for side in sides:
            starters += [x["player"]["name"] for x in side.get("startXI") or []
                         if (x.get("player") or {}).get("name")]
            subs += [x["player"]["name"] for x in side.get("substitutes") or []
                     if (x.get("player") or {}).get("name")]
        existing[f["id"]] = {
            "starters": starters, "subs": subs,
            "fetched_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        fetched += 1
        time.sleep(0.4)

    OUT.write_text(json.dumps({
        "note": "Confirmed lineups via fetch_lineups.py (API-Football).",
        "lineups": existing,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"lineups: {fetched} fetched/updated, {len(existing)} stored")


if __name__ == "__main__":
    main()

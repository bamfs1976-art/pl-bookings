#!/usr/bin/env python3
"""Ask API-Football what referee it holds for a league's upcoming fixtures.

WHY THIS EXISTS. Premier League referees stopped appearing on the desk after
6 September. The fixture file says 30 of 30 played fixtures have an official
and 0 of 350 upcoming ones do, and git says round 3's ten were all present the
day before they kicked off — so the supply worked and then stopped. That leaves
exactly two possibilities and no way to tell them apart from inside this
repository: either the API has no referee for these fixtures, or the harvest
has stopped reading the one it is given.

This answers that by printing the RAW field, per fixture, straight off the
response, next to what the committed file holds. It writes nothing, commits
nothing and touches no dataset. One call per league.

Usage: python3 scripts/probe-af-referees.py [--league PL] [--rounds 2]
"""
import argparse
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
sys.path.insert(0, str(DATA))
import harvest_apifootball as H  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default="PL")
    ap.add_argument("--rounds", type=int, default=2,
                    help="how many upcoming rounds to show (default 2)")
    a = ap.parse_args()

    import os
    key = os.environ.get("API_FOOTBALL_KEY", "")
    if not key:
        sys.exit("ERROR: API_FOOTBALL_KEY is not set — nothing to ask.")
    season = os.environ.get("API_FOOTBALL_SEASON", "2026")
    host = os.environ.get("API_FOOTBALL_HOST", H.DEFAULT_HOST)

    af_id = {"PL": 39, "EFLC": 40, "LL": 140, "SA": 135}[a.league.upper()]
    print(f"{a.league}: API-Football league {af_id}, season {season}, host {host}")

    payload = H._get(host, key, "fixtures",
                     {"league": af_id, "season": season})
    errs = H.api_errors(payload)
    if errs:
        sys.exit(f"ERROR: the API refused: {errs}")
    rows = (payload or {}).get("response") or []
    print(f"  {len(rows)} fixture(s) in the response")

    # What the committed file believes, for the same fixtures.
    shipped = {}
    konst, fname = H.FIXTURE_FILES[a.league.upper()]
    text = (DATA / fname).read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.strip().startswith("{id:"):
            fid = line.split("id:")[1].split(",")[0]
            ref = None
            if "ref:" in line:
                raw = line.split("ref:")[1].split(",st:")[0].strip()
                ref = None if raw == "null" else raw.strip('"')
            shipped[fid] = ref

    upcoming = [r for r in rows
                if ((r.get("fixture") or {}).get("status") or {}).get("short") == "NS"]
    upcoming.sort(key=lambda r: (r.get("fixture") or {}).get("date") or "")
    seen_rounds, shown = [], 0
    for r in upcoming:
        fx, lg, tm = r.get("fixture") or {}, r.get("league") or {}, r.get("teams") or {}
        rnd = lg.get("round")
        if rnd not in seen_rounds:
            if len(seen_rounds) >= a.rounds:
                break
            seen_rounds.append(rnd)
            print(f"\n  {rnd}")
        ref = fx.get("referee")
        fid = str(fx.get("id"))
        print(f"    {str(fx.get('date'))[:16]}  "
              f"{(tm.get('home') or {}).get('name','?'):<24}"
              f"v {(tm.get('away') or {}).get('name','?'):<24}"
              f"API: {ref if ref else '(null)':<22}"
              f"file: {shipped.get(fid) or '(null)'}")
        shown += 1
    named = sum(1 for r in upcoming
                if (r.get("fixture") or {}).get("referee"))
    print(f"\n  {named} of {len(upcoming)} upcoming fixture(s) carry a referee "
          f"in the API response.")
    print("  If that number is 0, the API is not publishing them and no change "
          "here can conjure one.\n  If it is not 0, the harvest is dropping "
          "them and this repository is the problem.")


if __name__ == "__main__":
    main()

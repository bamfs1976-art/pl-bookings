#!/usr/bin/env python3
"""
Harvest the raw ScoutingStats JSON that build_pl_data.py consumes.

The ScoutingStats API requires a logged-in browser session, so this script
authenticates with a session cookie you copy from your browser:

  1. Log in at https://scoutingstats.ai in your browser.
  2. Open DevTools -> Network, click any request to scoutingstats.ai,
     and copy the full value of the `cookie` request header.
  3. Run:  SS_COOKIE='<pasted cookie>' python3 data/harvest.py

Writes (both gitignored):
  data/pl_players.json       league 8 (Premier League) player stats
  data/champ_promoted.json   league 9 (Championship) player stats
                             (build_pl_data.py keeps only the promoted clubs)

If data/pl_refs.json is missing, build_refs.py is run to produce it from the
free football-data.co.uk mirror (no login needed for referees).

Optional env: SS_SEASON_PL / SS_SEASON_CH to pin a season id (e.g. 25583 was
2025-26); unset, the API returns its current season.
"""

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
BASE = "https://scoutingstats.ai/api/league/{league}/player-stats"


def fetch(league, season, cookie):
    url = BASE.format(league=league)
    if season:
        url += f"?season={season}"
    req = urllib.request.Request(url, headers={
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            sys.exit(f"ERROR: {url} answered {e.code} — the SS_COOKIE is "
                     "missing, expired or not logged in. Copy a fresh cookie "
                     "header from a logged-in browser session and retry.")
        raise
    data = json.loads(body)
    players = data["players"] if isinstance(data, dict) and "players" in data else data
    if not isinstance(players, list) or len(players) < 100:
        sys.exit(f"ERROR: {url} returned {len(players) if isinstance(players, list) else 'non-list'} "
                 "players — unexpected shape, refusing to overwrite the harvest.")
    return data, len(players)




def main():
    cookie = os.environ.get("SS_COOKIE", "").strip()
    if not cookie:
        sys.exit("ERROR: set SS_COOKIE to a logged-in scoutingstats.ai cookie "
                 "header (see the docstring at the top of this file).")

    pl, n_pl = fetch(8, os.environ.get("SS_SEASON_PL"), cookie)
    (DATA / "pl_players.json").write_text(json.dumps(pl), encoding="utf-8")
    print(f"pl_players.json written ({n_pl} players)")

    ch, n_ch = fetch(9, os.environ.get("SS_SEASON_CH"), cookie)
    (DATA / "champ_promoted.json").write_text(json.dumps(ch), encoding="utf-8")
    print(f"champ_promoted.json written ({n_ch} players)")

    if not (DATA / "pl_refs.json").exists():
        subprocess.run([sys.executable, str(DATA / "build_refs.py")], check=True)

    print("Harvest complete. Now run: python3 data/build_pl_data.py")


if __name__ == "__main__":
    main()

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
sys.path.insert(0, str(DATA))
# The club map, squad floor and position list live in build_pl_data so the
# harvest and the build cannot drift apart about what a covered squad is.
import build_pl_data  # noqa: E402
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




def promoted_shortfall(payload):
    """Which promoted clubs this Championship payload fails to cover, reusing
    the build's own club map, squad floor and position requirement so the two
    stages cannot disagree about what "covered" means."""
    players = payload["players"] if isinstance(payload, dict) and "players" in payload else payload
    by_club = {}
    for p in players or []:
        short = build_pl_data.SHORT.get(p.get("team"))
        if short in build_pl_data.PROMOTED:
            by_club.setdefault(short, []).append(p)
    out = []
    for short in sorted(build_pl_data.PROMOTED):
        squad = by_club.get(short, [])
        if len(squad) < build_pl_data.MIN_SQUAD:
            out.append(f"{short}: {build_pl_data._n_players(len(squad))}, need at least {build_pl_data.MIN_SQUAD}")
            continue
        have = {build_pl_data.POS.get(p.get("pos"), p.get("pos") or "") for p in squad}
        missing = [q for q in build_pl_data.POS_ORDER
                   if q in build_pl_data.REQUIRED_POS and q not in have]
        if missing:
            out.append(f"{short}: no {', '.join(missing)} in the squad")
    return out


def main():
    cookie = os.environ.get("SS_COOKIE", "").strip()
    if not cookie:
        sys.exit("ERROR: set SS_COOKIE to a logged-in scoutingstats.ai cookie "
                 "header (see the docstring at the top of this file).")

    pl, n_pl = fetch(8, os.environ.get("SS_SEASON_PL"), cookie)
    (DATA / "pl_players.json").write_text(json.dumps(pl), encoding="utf-8")
    print(f"pl_players.json written ({n_pl} players)")

    ch, n_ch = fetch(9, os.environ.get("SS_SEASON_CH"), cookie)
    # The league-wide count is not the check that matters. league 9 has 24
    # clubs, so a payload of 100+ players clears `fetch`'s floor comfortably
    # while carrying only a handful for the three clubs we actually keep —
    # which is exactly what shipped: six forwards, no defenders, for a year.
    # Refuse to overwrite a good file with a thin one.
    thin = promoted_shortfall(ch)
    if thin:
        sys.exit(
            "ERROR: league 9 answered with "
            f"{n_ch} players, but the promoted clubs are not covered:\n  - "
            + "\n  - ".join(thin)
            + "\n\nchamp_promoted.json was NOT overwritten. This endpoint appears to "
              "return a slice of the league rather than full squads; try a "
              "team-scoped or paginated request before trusting the result."
        )
    (DATA / "champ_promoted.json").write_text(json.dumps(ch), encoding="utf-8")
    print(f"champ_promoted.json written ({n_ch} players)")

    if not (DATA / "pl_refs.json").exists():
        subprocess.run([sys.executable, str(DATA / "build_refs.py")], check=True)

    print("Harvest complete. Now run: python3 data/build_pl_data.py")


if __name__ == "__main__":
    main()

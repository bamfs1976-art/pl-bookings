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
        if e.code == 400:
            # Not an auth failure — a malformed REQUEST. The cookie is a header
            # value, so anything the browser did not put there (a line break
            # from a wrapped copy, a "Cookie:" prefix copied along with the
            # value, smart quotes) makes the header invalid and the edge
            # rejects it before the API is reached. That looked like a bare
            # traceback until this existed.
            sys.exit(f"ERROR: {url} answered 400 (bad request).\n\n"
                     "That is the request being malformed, not the session "
                     "being rejected — so it is almost always the cookie "
                     "VALUE rather than the account. Check that SS_COOKIE:\n"
                     "  - is a single line with no breaks in it\n"
                     "  - has no leading 'cookie:' or 'Cookie:' prefix\n"
                     "  - is the raw header value, not the name/value table\n"
                     "    from the Application tab\n\n"
                     "In a GitHub Actions log a multi-line secret shows as\n"
                     "'SS_COOKIE:' with the value starting on the NEXT line — "
                     "that is the tell.")
        raise
    data = json.loads(body)
    players = data["players"] if isinstance(data, dict) and "players" in data else data
    if not isinstance(players, list) or len(players) < 100:
        sys.exit(f"ERROR: {url} returned {len(players) if isinstance(players, list) else 'non-list'} "
                 "players — unexpected shape, refusing to overwrite the harvest.")
    return data, len(players)




def promoted_shortfall(payload):
    """Which promoted clubs this Championship payload fails to cover.

    Normalises into the shape build_pl_data.coverage_problems already judges
    and calls THAT, rather than re-implementing the rule. Two copies of a rule
    are two rules: an earlier pair differed on whether a thin squad also
    reports its missing positions, so the harvest and the build disagreed
    about the same data."""
    players = payload["players"] if isinstance(payload, dict) and "players" in payload else payload
    rows = []
    for p in players or []:
        short = build_pl_data.SHORT.get(p.get("team"))
        if short in build_pl_data.PROMOTED:
            rows.append({"c": short,
                         "p": build_pl_data.POS.get(p.get("pos"), p.get("pos") or "")})
    return build_pl_data.coverage_problems(rows)


def clean_cookie(raw):
    """(cookie, problem) for a raw SS_COOKIE value.

    Pure, so the rules are testable without a network or a real session.

    A cookie is an HTTP header value, and the ways it arrives broken are all
    silent: a line break survives a copy from a wrapped DevTools pane, the
    'cookie:' label gets selected with the value, or someone pastes the
    Application tab's name/value table instead of the header. None of those
    look wrong in a secrets box, and the API answers 400 to all of them —
    which reads as a server problem rather than a paste problem. Name it here
    instead, before a request is made.
    """
    raw = (raw or "").strip()
    if not raw:
        return None, ("SS_COOKIE is not set. Copy the `cookie` REQUEST header "
                      "from a logged-in scoutingstats.ai session (see the "
                      "docstring at the top of this file).")
    if "\n" in raw or "\r" in raw:
        n = len([ln for ln in raw.splitlines() if ln.strip()])
        return None, (
            f"SS_COOKIE contains a line break ({n} lines). A cookie header is "
            "ONE line — a break makes the header invalid and the API answers "
            "400.\n\nRe-copy it as a single line: DevTools -> Network -> tick "
            "'Disable cache' -> reload -> click a request -> Request Headers "
            "-> Raw, then copy the whole `cookie:` line's value.\n\nIn a "
            "GitHub Actions log this shows as 'SS_COOKIE:' with the value "
            "starting on the next line.")
    low = raw.lower()
    if low.startswith("cookie:"):
        # Recoverable and unambiguous, unlike a line break: strip the label
        # rather than making someone paste again for it.
        raw = raw.split(":", 1)[1].strip()
        print("note: stripped a leading 'cookie:' label from SS_COOKIE")
    if "=" not in raw:
        return None, ("SS_COOKIE has no `name=value` pair in it, so it is not "
                      "a cookie header. Copy the value of the `cookie` request "
                      "header, not the URL, the response, or a single cookie's "
                      "name.")
    return raw, None


def main():
    cookie, problem = clean_cookie(os.environ.get("SS_COOKIE"))
    if problem:
        sys.exit("ERROR: " + problem)

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

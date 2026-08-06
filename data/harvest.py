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

Optional env:
  SS_USER_AGENT  the User-Agent to send. Cloudflare binds cf_clearance to the
                 IP AND the User-Agent that solved its challenge, so this must
                 match the browser the cookie came from or the edge answers 400.
  SS_SEASON_PL / SS_SEASON_CH to pin a season id (e.g. 25583 was
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


# The cookie is only half of what the edge checks. Cloudflare binds
# cf_clearance to the IP AND THE USER-AGENT that solved the challenge, so a
# request carrying a browser's clearance token under a different User-Agent is
# rejected — with a 400, which reads like a malformed cookie and is not.
#
# This value was hardcoded to a Linux string, which was invisible for as long
# as the harvest only ever ran beside a Linux browser. Run it on Windows with a
# cookie from Chrome and it cannot work, however correct the cookie is. So it
# is settable, and the default is the common case for a desktop browser rather
# than for the machine this repo happens to be developed on.
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")


def user_agent():
    return (os.environ.get("SS_USER_AGENT") or "").strip() or DEFAULT_UA


def fetch(league, season, cookie):
    url = BASE.format(league=league)
    if season:
        url += f"?season={season}"
    req = urllib.request.Request(url, headers={
        "Cookie": cookie,
        "User-Agent": user_agent(),
        "Accept": "application/json",
        # Cloudflare scores requests that look nothing like the browser the
        # clearance was issued to. These cost nothing and remove a whole class
        # of "why is this a 400" from the picture.
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://scoutingstats.ai/",
        "X-Requested-With": "XMLHttpRequest",
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
            cf = "cf_clearance=" in (cookie or "")
            sys.exit(
                f"ERROR: {url} answered 400 (bad request).\n\n"
                "That is the request being rejected as malformed, not the "
                "session being judged — so it is the cookie VALUE or where "
                "the request came FROM, not the account.\n\n"
                + ("MOST LIKELY HERE: this cookie carries cf_clearance, "
                   "Cloudflare's challenge-clearance token. It is bound to "
                   "BOTH the IP address AND the User-Agent that solved the "
                   "challenge, and BOTH have to match or the edge rejects the "
                   "request before scoutingstats.ai is reached.\n\n"
                   f"  This request sent:\n    {user_agent()}\n\n"
                   "  If that is not the User-Agent of the browser you copied "
                   "the cookie from, that alone is enough to cause this. Read "
                   "the browser's own value from DevTools -> Network -> any "
                   "request -> Request Headers -> user-agent, and set it:\n\n"
                   "    $env:SS_USER_AGENT = '<the browser's user-agent>'\n\n"
                   "  And run the harvest on the SAME MACHINE AND NETWORK as "
                   "that browser session. Those two constraints together are "
                   "why this route cannot run unattended, and why "
                   "data/harvest_apifootball.py exists as the key-based "
                   "alternative.\n\n"
                   if cf else "")
                + "Otherwise check that SS_COOKIE:\n"
                  "  - is a single line with no breaks in it\n"
                  "  - has no leading 'cookie:' or 'Cookie:' prefix\n"
                  "  - is the raw header value, not the name/value table from\n"
                  "    the Application tab\n\n"
                  "In a GitHub Actions log a multi-line secret shows as\n"
                  "'SS_COOKIE:' with the value starting on the NEXT line.")
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

#!/usr/bin/env python3
"""Where two mangled player names come from: this repository, or the feed.

  python3 scripts/probe-encoding.py

WHAT THIS ANSWERS. Two names ship mangled:

    data/laliga_data.js   "Dani MartÃ­nez"   should be "Dani Martínez"
    data/seriea_data.js   "C. Inao OulaÃ¯"   should be "C. Inao Oulaï"

Both are the signature of UTF-8 bytes read as Latin-1, and both repair
perfectly with .encode("latin-1").decode("utf-8"), so the corruption is a
single clean round of double-encoding rather than lossy damage.

Reading the code did not settle WHERE it happens, and this is not a thing to
guess at. Every candidate in this repository already looks right:

  * harvest_apifootball._fetch_once decodes the wire with an explicit
    .decode("utf-8"),
  * every open() and write_text() in data/ passes encoding="utf-8",
  * json.dumps escapes non-ASCII to \\uXXXX, which is lossless.

So the remaining possibility is that API-Football serves these two names
already double-encoded. That is a claim about somebody else's data, and the
only honest way to make it is to look at the bytes.

THE TEST. Fetch the two players from the two endpoints they actually reach
this project through, and print the raw bytes of each name.

    C3 AD                is UTF-8 for í. The feed is clean and we corrupt it.
    C3 83 C2 AD          is UTF-8 for Ã­. The feed serves it already mangled.

There is no third answer, which is what makes this worth one run.

WHAT IT DOES NOT DO. It writes nothing, commits nothing and always exits 0: a
diagnostic that can fail a workflow is a diagnostic somebody disables. It is
also read-only against the API, and costs at most four calls.

Needs API_FOOTBALL_KEY. Runs where the API is reachable, which is a GitHub
runner rather than a development container behind an egress proxy.
"""

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
sys.path.insert(0, str(DATA))
import harvest_apifootball as af  # noqa: E402

# The two rows, and the endpoint each reached this project through.
#
# Dani Martinez carries a rate and a photo, so he came from the /players
# statistics harvest. Inao Oulai is basis NEW with no rate at all, which is
# the /players/squads roster path: membership without a record.
LALIGA, SERIEA = 140, 135
TARGETS = [
    {"desk": "LL", "club": "Atletico Madrid", "team": 530,
     "shipped": "Dani MartÃ\xadnez", "want": "Dani Martínez"},
    {"desk": "SA", "club": "Fiorentina", "team": 502,
     "shipped": "C. Inao OulaÃ¯", "want": "C. Inao Oulaï"},
]


def hexed(s):
    """A string's UTF-8 bytes, spaced, so a doubled C3 is visible at a glance."""
    return " ".join(f"{b:02X}" for b in s.encode("utf-8"))


def repaired(s):
    """The double-encoding undone, or None when the string is not that.

    A correctly encoded name raises on one of the two steps and comes back
    None, which is what makes this safe to apply to everything: it can only
    touch a string that IS latin-1 encodable AND whose bytes ARE valid UTF-8,
    and for pure ASCII it returns the string unchanged rather than a different
    one.
    """
    try:
        out = s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    return out if out != s else None


def look(label, names, targets):
    """Report every name that is mangled, and say what the bytes are."""
    print(f"\n  {label}: {len(names)} name(s) read")
    bad = [n for n in names if repaired(n)]
    for t in targets:
        hit = [n for n in names if t["want"].split()[-1][:4] in n
               or t["shipped"].split()[-1][:4] in n]
        for n in hit:
            fix = repaired(n)
            print(f"    as served : {n!r}")
            print(f"    bytes     : {hexed(n)}")
            if fix:
                print(f"    VERDICT   : THE FEED SERVES IT MANGLED. "
                      f"Repairs to {fix!r}")
            elif n == t["want"]:
                print("    VERDICT   : THE FEED IS CLEAN. The corruption is "
                      "ours, downstream of this call.")
            else:
                print("    VERDICT   : neither the shipped spelling nor the "
                      "correct one. Read the bytes above by hand.")
        if not hit:
            print(f"    {t['want']!r} did not come back from this endpoint at all")
    if bad:
        print(f"    {len(bad)} of {len(names)} name(s) from this endpoint are "
              f"mangled: {', '.join(sorted(bad)[:8])}")
    else:
        print("    no mangled names from this endpoint")


def main():
    key = af.env_or("API_FOOTBALL_KEY", "")
    if not key:
        print("API_FOOTBALL_KEY is not set, so nothing was asked. Not an error.")
        return 0
    host = af.env_or("API_FOOTBALL_HOST", af.DEFAULT_HOST)
    season = af.env_or("API_FOOTBALL_SEASON", "2025")

    print("Where the two mangled names come from: the feed, or this repository")
    print(f"  host {host}, season {season} for the statistics endpoint")
    print("  C3 AD is UTF-8 for i-acute. C3 83 C2 AD is UTF-8 for A-tilde "
          "plus soft hyphen,")
    print("  which is that same i-acute encoded twice.")

    for t in TARGETS:
        print(f"\n{t['club']} ({t['desk']}, team {t['team']})")

        # 1. THE ROSTER PATH: /players/squads, no season, membership only.
        payload = af._get(host, key, "players/squads", {"team": t["team"]})
        errs = af.api_errors(payload)
        if errs:
            print(f"  players/squads refused: {errs}")
        else:
            names = []
            for entry in (payload.get("response") or []):
                for pl in (entry.get("players") or []):
                    n = (pl.get("name") or "").strip()
                    if n:
                        names.append(n)
            look("players/squads", names, [t])

        # 2. THE FORM PATH: /players?team&season, the statistics endpoint the
        #    rates come from. Page 1 only: this is a diagnostic, not a harvest.
        league = LALIGA if t["desk"] == "LL" else SERIEA
        payload = af._get(host, key, "players",
                          {"team": t["team"], "league": league,
                           "season": season, "page": 1})
        errs = af.api_errors(payload)
        if errs:
            print(f"  players refused: {errs}")
        else:
            names = []
            for entry in (payload.get("response") or []):
                n = ((entry.get("player") or {}).get("name") or "").strip()
                if n:
                    names.append(n)
            look("players (page 1)", names, [t])

    print("\nNothing was written. The fix is decided by a person on this "
          "evidence.")
    af.report_usage()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # a diagnostic must not fail the workflow
        print(f"probe failed, which is not a build failure: {e!r}")
        sys.exit(0)

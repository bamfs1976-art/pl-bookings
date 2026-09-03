#!/usr/bin/env python3
"""Which columns a football-data.co.uk division actually carries.

    python3 data/probe_fd_division.py --div SC0 --seasons 2526,2425,2324

WHY PRESENCE IS NOT THE QUESTION. This repository already learned the hard way
that a football-data column can exist and mean nothing: Spain's SP1 file has a
`Referee` column in every one of 33 seasons and it is EMPTY in all of them,
which is why data/leagues.py buys La Liga's referee names from API-Football
instead. A probe that reported "Referee: present" would have said the opposite
of the truth.

So this reports the FILL RATE — how many rows carry a value — and it samples
several seasons, because one quiet season looks exactly like a column that was
never populated.

WHAT IT IS FOR. Deciding whether a division can be modelled from the free
archive before anything is built for it. A desk needs the referee's name and
the four card columns; without them the same desk costs one API call per
fixture instead of nothing. That question came up for the Scottish
Premiership (SC0) and had no answer in the repository.

It writes nothing and needs no key. It does need to reach
www.football-data.co.uk, which several of the environments this project is
worked in cannot — hence a workflow step rather than a local run.

WHAT IT FOUND, 2026-09-03, seasons 2023-24 / 2024-25 / 2025-26:

  SC0  Scottish Premiership   Referee 100%, HY/AY/HR/AR 100%, HF/AF 100%,
                              228 rows a season (12 clubs x 38 — the right
                              shape). Everything a referee model needs, free.
  E0   Premier League         the same, and it is the control: it proves the
                              probe reads a file it is known to read.
  SP1  La Liga                Referee ABSENT in all three; every card and foul
                              column filled on 100% of rows. This is why La
                              Liga buys its referee names from API-Football.

So a Scottish desk would cost NOTHING in referees or card rates — the same
free archive the Premier League and Championship already run on. What it
would still need is the parts football-data does not carry: squads, fixtures,
appointments, and a suspension scheme.
"""

import argparse
import csv
import io
import sys
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402

# What a desk actually needs, and what each column is for. Anything not in
# here is somebody else's problem.
WANTED = [
    ("Referee", "the official's name — without it there is no referee model"),
    ("HY", "home yellows"),
    ("AY", "away yellows"),
    ("HR", "home reds"),
    ("AR", "away reds"),
    ("HF", "home fouls"),
    ("AF", "away fouls"),
    ("HomeTeam", "club names, for the join"),
    ("AwayTeam", "club names, for the join"),
    ("Date", "the date, for the join"),
]


def fetch(div, season, agent="pl-bookings"):
    """One division-season as text, or (None, why)."""
    url = leagues.ORIGIN.format(season=season, div=div)
    req = urllib.request.Request(url, headers={"User-Agent": agent})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace"), url
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        return None, f"{url} — {e}"


def probe(div, seasons):
    """Fill rates per column, per season.

    Returns "usable", "unusable" or "unknown", and the third is not a
    formality. A division nobody could reach and a division whose columns are
    empty are completely different answers, and the first draft of this
    collapsed them into one — printing "DOES NOT carry a usable record" for
    SC0 when the only thing that had actually happened was a blocked proxy.
    That is the failure this whole file exists to avoid, committed by the
    probe itself.
    """
    print(f"\n=== {div}, football-data.co.uk ===")
    usable_seasons = 0
    verdict = {name: [] for name, _ in WANTED}

    for season in seasons:
        text, where = fetch(div, season)
        if text is None:
            print(f"  {season}: unreachable — {where}")
            continue
        rows = list(csv.DictReader(io.StringIO(text)))
        if not rows:
            print(f"  {season}: no rows")
            continue
        usable_seasons += 1
        cols = rows[0].keys()
        bits = []
        for name, _why in WANTED:
            if name not in cols:
                verdict[name].append(None)
                bits.append(f"{name}=absent")
                continue
            filled = sum(1 for r in rows if (r.get(name) or "").strip())
            pct = filled / len(rows) * 100
            verdict[name].append(pct)
            bits.append(f"{name}={pct:.0f}%")
        print(f"  {season}: {len(rows):3} rows, {len(cols)} columns | " + "  ".join(bits))

    if not usable_seasons:
        print(f"  NOTHING READ for {div}. This says NOTHING about what the "
              "division carries — only that this machine could not fetch it. "
              "Run it somewhere that reaches www.football-data.co.uk.")
        return "unknown"

    print(f"\n  verdict across {usable_seasons} season(s):")
    ok = True
    for name, why in WANTED:
        seen = [p for p in verdict[name] if p is not None]
        if not seen:
            print(f"    {name:10} ABSENT in every season           — {why}")
            ok = False
        elif max(seen) == 0:
            # THE SPAIN CASE. Present and empty is worse than absent: it looks
            # like coverage to anything that checks the header.
            print(f"    {name:10} present but EMPTY in every season — {why}")
            ok = False
        else:
            lo, hi = min(seen), max(seen)
            mark = "" if lo > 90 else "   <-- patchy"
            print(f"    {name:10} filled {lo:.0f}-{hi:.0f}% of rows{mark}       — {why}")
    return "usable" if ok else "unusable"


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--div", default="SC0",
                    help="football-data division code, e.g. SC0 (Scottish "
                         "Premiership), E0, SP1. Comma-separated for several.")
    ap.add_argument("--seasons", default="2526,2425,2324",
                    help="comma-separated football-data season codes. Several, "
                         "because one quiet season is indistinguishable from a "
                         "column nobody ever filled in.")
    args = ap.parse_args()

    seasons = [s.strip() for s in args.seasons.split(",") if s.strip()]
    divs = [d.strip().upper() for d in args.div.split(",") if d.strip()]
    results = {d: probe(d, seasons) for d in divs}

    print("\n" + "=" * 60)
    SAYS = {
        "usable": "has everything a referee model needs",
        "unusable": "DOES NOT carry a usable referee/card record",
        "unknown": "COULD NOT BE READ — no conclusion, try a machine that "
                   "reaches football-data.co.uk",
    }
    for d, how in results.items():
        print(f"  {d}: {SAYS[how]}")
    # An unreadable probe is not a pass. It exits non-zero so a workflow step
    # cannot go green on having learned nothing.
    return 0 if all(h != "unknown" for h in results.values()) else 2


if __name__ == "__main__":
    sys.exit(main())

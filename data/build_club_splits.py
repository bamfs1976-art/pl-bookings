#!/usr/bin/env python3
"""
Add home/away cards-against splits to the CLUBS block of data/pl_data.js.

Source: the same football-data.co.uk Premier League match CSVs (mirrored
by the Frictionless Data project, public domain) that build_refs.py uses.
Every match row carries both teams' yellow (HY/AY) and red (HR/AR) card
counts, so each club's card rate can be split by venue.

The split is applied as a RATIO on the club's existing `ca` (cards
received per game, ScoutingStats basis), not as absolute football-data
numbers, so the two sources' slightly different counting bases can't
shift the booking-heat scale:

    caH = ca * (home cards rate / overall cards rate)
    caA = ca * (away cards rate / overall cards rate)

A club's caH and caA average back to its ca. Promoted clubs have no PL
ca (and no 2025-26 PL matches), so they get caH/caA null and the app
keeps using its league-median fallback.

Run AFTER build_pl_data.py (which regenerates CLUBS without the splits).

Usage:
    python3 data/build_club_splits.py              # fetch season 2526
    python3 data/build_club_splits.py --season 2627
    python3 data/build_club_splits.py --csv path/to/season.csv   # offline

Patches the CLUBS block of data/pl_data.js in place (PL_PLAYERS and REFS
are untouched).
"""

import argparse
import csv
import io
import re
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
RAW = ("https://raw.githubusercontent.com/datasets/football-datasets/"
       "main/datasets/premier-league/season-{season}.csv")
MIN_VENUE_MATCHES = 8  # below this the venue rate is too noisy to trust

# football-data.co.uk team names -> pl_data.js short codes (2025-26 PL).
# Relegated clubs (Burnley, West Ham, Wolves) are simply never looked up.
TEAM_SHORT = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "Bournemouth": "BOU",
    "Brentford": "BRE", "Brighton": "BHA", "Chelsea": "CHE",
    "Crystal Palace": "CRY", "Everton": "EVE", "Fulham": "FUL",
    "Leeds": "LEE", "Liverpool": "LIV", "Man City": "MCI",
    "Man United": "MUN", "Newcastle": "NEW", "Nott'm Forest": "NFO",
    "Sunderland": "SUN", "Tottenham": "TOT",
}


def load_rows(args):
    if args.csv:
        text = Path(args.csv).read_text(encoding="utf-8-sig")
    else:
        url = RAW.format(season=args.season)
        req = urllib.request.Request(url, headers={"User-Agent": "pl-bookings-splits"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8-sig")
        except urllib.error.HTTPError as e:
            sys.exit(f"ERROR: {url} answered {e.code} — check the season code "
                     "(e.g. 2526) or pass a local file with --csv.")
    return list(csv.DictReader(io.StringIO(text)))


def venue_rates(rows):
    """short -> {home: cards/game at home, away: cards/game away, overall}."""
    tally = {}  # short -> [home_cards, home_n, away_cards, away_n]
    skipped = 0
    for r in rows:
        try:
            hy, ay = int(r["HY"]), int(r["AY"])
            hr, ar = int(r["HR"]), int(r["AR"])
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        h = TEAM_SHORT.get((r.get("HomeTeam") or "").strip())
        a = TEAM_SHORT.get((r.get("AwayTeam") or "").strip())
        if h:
            t = tally.setdefault(h, [0, 0, 0, 0])
            t[0] += hy + hr
            t[1] += 1
        if a:
            t = tally.setdefault(a, [0, 0, 0, 0])
            t[2] += ay + ar
            t[3] += 1
    out = {}
    for short, (hc, hn, ac, an) in tally.items():
        if hn < MIN_VENUE_MATCHES or an < MIN_VENUE_MATCHES:
            print(f"  {short}: only {hn}H/{an}A matches — skipping split")
            continue
        overall = (hc + ac) / (hn + an)
        if overall <= 0:
            continue
        out[short] = {"home": hc / hn, "away": ac / an, "overall": overall}
    if skipped:
        print(f"  ({skipped} rows without card columns skipped)")
    return out


def patch_clubs(rates):
    path = DATA / "pl_data.js"
    src = path.read_text(encoding="utf-8")
    patched = 0

    def sub_line(m):
        nonlocal patched
        line, short = m.group(0), m.group(1)
        # Drop any previous split so re-runs stay idempotent.
        line = re.sub(r",caH:(?:null|[\d.]+),caA:(?:null|[\d.]+)", "", line)
        ca_m = re.search(r"ca:([\d.]+)", line)
        r = rates.get(short)
        if ca_m and r:
            ca = float(ca_m.group(1))
            ca_h = round(ca * r["home"] / r["overall"], 2)
            ca_a = round(ca * r["away"] / r["overall"], 2)
            ins = f",caH:{ca_h},caA:{ca_a}"
            patched += 1
        else:
            ins = ",caH:null,caA:null"
        return re.sub(r"(ca:(?:null|[\d.]+))", r"\1" + ins, line, count=1)

    new = re.sub(r'\{short:"([A-Z]{3})",name:.*?\}', sub_line, src)
    if patched < 15:
        sys.exit(f"ERROR: only patched {patched} clubs — team-name mapping looks "
                 "broken; refusing to write.")
    path.write_text(new, encoding="utf-8")
    return patched


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2526", help="football-data season code (e.g. 2526)")
    ap.add_argument("--csv", help="local season CSV instead of fetching")
    args = ap.parse_args()

    rows = load_rows(args)
    if len(rows) < 50:
        sys.exit(f"ERROR: only {len(rows)} match rows — season incomplete or wrong "
                 "file; refusing to patch the club splits.")

    rates = venue_rates(rows)
    print(f"venue rates for {len(rates)} clubs from {len(rows)} matches")
    patched = patch_clubs(rates)
    print(f"patched caH/caA for {patched} clubs in data/pl_data.js "
          f"(promoted clubs stay null)")


if __name__ == "__main__":
    main()

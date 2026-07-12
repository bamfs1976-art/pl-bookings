#!/usr/bin/env python3
"""
Build the referee dataset from a free source: the football-data.co.uk
Premier League match CSVs mirrored on GitHub by the Frictionless Data
project (github.com/datasets/football-datasets, public domain data).

Every match row carries the referee plus both teams' yellow (HY/AY) and
red (HR/AR) card counts, so yellows-per-game and reds-per-game can be
computed for EVERY official who took a Premier League match — no login,
no API key.

Penalties are not in this source, so pen-per-game (and the region label)
are carried over from the previous dataset where the referee matches,
and null for new officials.

Usage:
    python3 data/build_refs.py              # fetch season 2526 from GitHub
    python3 data/build_refs.py --season 2627
    python3 data/build_refs.py --csv path/to/season.csv   # offline

Writes data/pl_refs.json and patches the REFS block of data/pl_data.js
in place (CLUBS and PL_PLAYERS are untouched).
"""

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
RAW = ("https://raw.githubusercontent.com/datasets/football-datasets/"
       "main/datasets/premier-league/season-{season}.csv")
MIN_MATCHES = 3  # below this, ypg is too noisy to rank

# football-data.co.uk abbreviates names ("A Taylor"); display full names.
FULL_NAMES = {
    "A Taylor": "Anthony Taylor", "C Kavanagh": "Chris Kavanagh",
    "M Oliver": "Michael Oliver", "S Attwell": "Stuart Attwell",
    "S Barrott": "Samuel Barrott", "D England": "Darren England",
    "T Bramall": "Thomas Bramall", "P Bankes": "Peter Bankes",
    "J Gillett": "Jarred Gillett", "C Pawson": "Craig Pawson",
    "A Madley": "Andy Madley", "R Jones": "Robert Jones",
    "S Hooper": "Simon Hooper", "M Salisbury": "Michael Salisbury",
    "P Tierney": "Paul Tierney", "J Brooks": "John Brooks",
    "T Harrington": "Tony Harrington", "T Robinson": "Tim Robinson",
    "T Kirk": "Thomas Kirk", "F Hallam": "Farai Hallam",
    "A Kitchen": "Adam Kitchen", "M Donohue": "Matthew Donohue",
    "L Smith": "Lewis Smith", "D Coote": "David Coote",
    "G Scott": "Graham Scott", "D Bond": "Darren Bond",
    "J Smith": "Josh Smith", "S Allison": "Sam Allison",
}


def full_name(abbrev):
    return FULL_NAMES.get(abbrev, abbrev)


def load_rows(args):
    if args.csv:
        text = Path(args.csv).read_text(encoding="utf-8-sig")
    else:
        url = RAW.format(season=args.season)
        req = urllib.request.Request(url, headers={"User-Agent": "pl-bookings-refs"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                text = r.read().decode("utf-8-sig")
        except urllib.error.HTTPError as e:
            sys.exit(f"ERROR: {url} answered {e.code} — check the season code "
                     "(e.g. 2526) or pass a local file with --csv.")
    return list(csv.DictReader(io.StringIO(text)))


def previous_details():
    """pen/region from the current pl_data.js, keyed by surname+initial."""
    src = (DATA / "pl_data.js").read_text(encoding="utf-8")
    block = re.search(r"const REFS = \[(.*?)\];", src, re.S)
    out = {}
    if not block:
        return out
    for m in re.finditer(r"\{n:(\".*?\"),region:(\".*?\"),matches:(?:null|[\d.]+),"
                         r"ypg:(?:null|[\d.]+),red:(?:null|[\d.]+),pen:(null|[\d.]+)\}",
                         block.group(1)):
        name = json.loads(m.group(1))
        key = (name.split()[0][0] + " " + name.split()[-1]).lower()
        pen = None if m.group(3) == "null" else float(m.group(3))
        out[key] = {"region": json.loads(m.group(2)), "pen_pg": pen}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2526", help="football-data season code (e.g. 2526)")
    ap.add_argument("--csv", help="local season CSV instead of fetching")
    args = ap.parse_args()

    rows = load_rows(args)
    if len(rows) < 50:
        sys.exit(f"ERROR: only {len(rows)} match rows — season incomplete or wrong file; "
                 "refusing to overwrite the referee data.")

    tally = {}
    skipped = 0
    for r in rows:
        ref = (r.get("Referee") or "").strip()
        try:
            hy, ay = int(r["HY"]), int(r["AY"])
            hr, ar = int(r["HR"]), int(r["AR"])
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        if not ref:
            skipped += 1
            continue
        d = tally.setdefault(ref, {"matches": 0, "yellows": 0, "reds": 0})
        d["matches"] += 1
        d["yellows"] += hy + ay
        d["reds"] += hr + ar

    prev = previous_details()
    refs = []
    for abbrev, d in tally.items():
        if d["matches"] < MIN_MATCHES:
            continue
        name = full_name(abbrev)
        key = (name.split()[0][0] + " " + name.split()[-1]).lower()
        old = prev.get(key, {})
        refs.append({
            "name": name,
            "region": old.get("region", ""),
            "matches": d["matches"],
            "yellows": d["yellows"],
            "ypg": round(d["yellows"] / d["matches"], 2),
            "red_pg": round(d["reds"] / d["matches"], 2),
            "pen_pg": old.get("pen_pg"),
        })
    refs.sort(key=lambda r: -r["ypg"])

    (DATA / "pl_refs.json").write_text(json.dumps({"refs": refs}, indent=1), encoding="utf-8")

    # Patch the REFS block of pl_data.js in place; players/clubs untouched.
    def jsval(x):
        if x is None:
            return "null"
        if isinstance(x, str):
            return json.dumps(x, ensure_ascii=False)
        return str(x)

    lines = ["const REFS = ["]
    for r in refs:
        lines.append("  {" + ",".join([
            f'n:{jsval(r["name"])}', f'region:{jsval(r["region"])}',
            f'matches:{jsval(r["matches"])}', f'ypg:{jsval(r["ypg"])}',
            f'red:{jsval(r["red_pg"])}', f'pen:{jsval(r["pen_pg"])}',
        ]) + "},")
    lines.append("];")
    src = (DATA / "pl_data.js").read_text(encoding="utf-8")
    new_src, n = re.subn(r"const REFS = \[.*?\];", "\n".join(lines), src, count=1, flags=re.S)
    if n != 1:
        sys.exit("ERROR: could not find the REFS block in pl_data.js.")
    (DATA / "pl_data.js").write_text(new_src, encoding="utf-8")

    dropped = len(tally) - len(refs)
    print(f"refs: {len(refs)} (dropped {dropped} under {MIN_MATCHES} matches, "
          f"skipped {skipped} rows without card data)")
    for r in refs:
        pen = "  - " if r["pen_pg"] is None else f"{r['pen_pg']:.2f}"
        print(f"   {r['ypg']:>5}  {r['red_pg']:>4} red  {pen} pen  "
              f"{r['matches']:>2}m  {r['name']}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Build a league's referee dataset from the free football-data.co.uk match
records (public domain, no login, no key).

Every match row carries the referee plus both teams' yellow (HY/AY) and red
(HR/AR) card counts and fouls (HF/AF), so yellows-per-game, fouls-per-game and
cards-per-foul can be computed for every official who took a match.

Penalties are not in this source, so pen-per-game (and the region label) are
carried over from the previous dataset where the referee matches, and null for
new officials.

Usage:
    python3 data/build_refs.py                          # Premier League, 2526
    python3 data/build_refs.py --season 2627
    python3 data/build_refs.py --league EFLC            # EFL Championship
    python3 data/build_refs.py --league EFLC --season 2526
    python3 data/build_refs.py --csv path/to/season.csv  # offline
    python3 data/build_refs.py --league EFLC --dry-run   # print, write nothing

Writes data/<league>_refs.json and patches the REFS block of the league's
data file in place (clubs and players are untouched). A league whose data file
does not exist yet — the state a new competition starts in — gets the JSON and
a note, not an error.

WHICH LEAGUES THIS WORKS FOR. Only the ones whose match records actually name
the official, which is English and Scottish football and effectively nowhere
else; see data/leagues.py and docs/la-liga-feasibility.md. Pointing this script
at a league without free referees is refused up front rather than producing an
empty ranking.
"""

import argparse
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402


def previous_details(league):
    """pen/region from the league's current data file, keyed by initial+surname.

    Absent file or absent REFS block is not an error: a competition the desk
    has not built yet has no previous detail to carry over, which is the
    normal state on the first run for a new league.
    """
    path = league.path(league.data_file)
    if not path.exists():
        return {}
    src = path.read_text(encoding="utf-8")
    block = re.search(r"const REFS = \[(.*?)\];", src, re.S)
    out = {}
    if not block:
        return out
    # NOTE the row is matched up to `pen:` and no further. This pattern used to
    # end with a closing brace, which silently stopped matching the day fpg and
    # cpf were appended to the row format — 0 of 22 rows since, so pen and
    # region were being dropped on every rebuild rather than carried over. The
    # row format is allowed to grow; this pattern must not care that it did.
    for m in re.finditer(r"\{n:(\".*?\"),region:(\".*?\"),matches:(?:null|[\d.]+),"
                         r"ypg:(?:null|[\d.]+),red:(?:null|[\d.]+),pen:(null|[\d.]+)",
                         block.group(1)):
        name = json.loads(m.group(1))
        key = (name.split()[0][0] + " " + name.split()[-1]).lower()
        pen = None if m.group(3) == "null" else float(m.group(3))
        out[key] = {"region": json.loads(m.group(2)), "pen_pg": pen}
    return out


def tally_refs(rows):
    """referee -> counts, plus the number of rows that carried no usable card
    data. Pure: this is the whole computation, and it is what the tests call."""
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
        # Fouls (HF/AF) are in the same source and are what turn a raw card
        # count into a strictness rate — a referee showing many yellows may
        # simply be getting foul-heavy fixtures. Optional: rows without them
        # still count toward cards, they just don't feed fouls/cpf.
        try:
            fouls = int(r["HF"]) + int(r["AF"])
        except (KeyError, TypeError, ValueError):
            fouls = None
        d = tally.setdefault(ref, {"matches": 0, "yellows": 0, "reds": 0,
                                   "fouls": 0, "foul_matches": 0})
        d["matches"] += 1
        d["yellows"] += hy + ay
        d["reds"] += hr + ar
        if fouls is not None:
            d["fouls"] += fouls
            d["foul_matches"] += 1
    return tally, skipped


def build_refs(tally, prev, min_matches):
    """The ranked referee rows. Pure, so the rates are unit-testable."""
    refs = []
    for abbrev, d in tally.items():
        if d["matches"] < min_matches:
            continue
        name = leagues.full_name(abbrev)
        key = (name.split()[0][0] + " " + name.split()[-1]).lower()
        old = prev.get(key, {})
        # fouls/game and cards-per-foul, over the matches that carried fouls.
        fm = d.get("foul_matches", 0)
        fpg = round(d["fouls"] / fm, 2) if fm else None
        # Cards per foul uses the same match subset as the fouls, so the two
        # rates are consistent; yellows only (reds are a different decision).
        cpf = None
        if fm and d["fouls"] > 0:
            yellows_in_fm = d["yellows"] * (fm / d["matches"])   # pro-rata when some rows lacked fouls
            cpf = round(yellows_in_fm / d["fouls"], 4)
        refs.append({
            "name": name,
            "region": old.get("region", ""),
            "matches": d["matches"],
            "yellows": d["yellows"],
            "ypg": round(d["yellows"] / d["matches"], 2),
            "red_pg": round(d["reds"] / d["matches"], 2),
            "pen_pg": old.get("pen_pg"),
            "fouls_pg": fpg,
            "cards_per_foul": cpf,
        })
    refs.sort(key=lambda r: -r["ypg"])
    return refs


def jsval(x):
    if x is None:
        return "null"
    if isinstance(x, str):
        return json.dumps(x, ensure_ascii=False)
    return str(x)


def refs_block(refs):
    lines = ["const REFS = ["]
    for r in refs:
        lines.append("  {" + ",".join([
            f'n:{jsval(r["name"])}', f'region:{jsval(r["region"])}',
            f'matches:{jsval(r["matches"])}', f'ypg:{jsval(r["ypg"])}',
            f'red:{jsval(r["red_pg"])}', f'pen:{jsval(r["pen_pg"])}',
            f'fpg:{jsval(r["fouls_pg"])}', f'cpf:{jsval(r["cards_per_foul"])}',
        ]) + "},")
    lines.append("];")
    return "\n".join(lines)


def patch_data_file(league, refs):
    """Replace the REFS block in the league's data file. Returns a status
    string; a missing data file is reported, not fatal."""
    path = league.path(league.data_file)
    if not path.exists():
        return (f"{league.data_file} does not exist yet — wrote "
                f"{league.refs_file} only. Build the league's data file, then "
                "re-run to patch its REFS block.")
    src = path.read_text(encoding="utf-8")
    new_src, n = re.subn(r"const REFS = \[.*?\];", refs_block(refs), src,
                         count=1, flags=re.S)
    if n != 1:
        sys.exit(f"ERROR: could not find the REFS block in {league.data_file}.")
    path.write_text(new_src, encoding="utf-8")
    return f"patched the REFS block of {league.data_file}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default="PL",
                    help="league code (%s)" % ", ".join(sorted(leagues.LEAGUES)))
    ap.add_argument("--season", default="2526", help="football-data season code (e.g. 2526)")
    ap.add_argument("--csv", help="local season CSV instead of fetching")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the ranking, write nothing")
    args = ap.parse_args()

    league = leagues.get(args.league)
    if not league.has_free_referees:
        sys.exit(f"ERROR: {league.name} match records do not name the official, "
                 "so there is nothing for this script to compute. See "
                 "docs/la-liga-feasibility.md for the referee-name join that "
                 "such a league needs instead.")

    rows, where = leagues.load_rows(league, season=args.season, csv_path=args.csv,
                                    agent="pl-bookings-refs")
    tally, skipped = tally_refs(rows)
    if not tally:
        sys.exit(f"ERROR: {where} carried {len(rows)} match rows but named no "
                 "referee on any of them. This source does not publish "
                 f"referees for {league.name}; refusing to write an empty set.")

    refs = build_refs(tally, previous_details(league), league.min_ref_matches)
    if not refs:
        sys.exit(f"ERROR: no referee reached {league.min_ref_matches} matches "
                 f"in {len(rows)} rows — partial season; refusing to write.")

    dropped = len(tally) - len(refs)
    print(f"{league.name} refs: {len(refs)} from {len(rows)} matches via {where}")
    print(f"  (dropped {dropped} under {league.min_ref_matches} matches, "
          f"skipped {skipped} rows without card data)")
    for r in refs:
        pen = "  - " if r["pen_pg"] is None else f"{r['pen_pg']:.2f}"
        fpg = "  -  " if r["fouls_pg"] is None else f"{r['fouls_pg']:>5.2f}"
        cpf = "  -  " if r["cards_per_foul"] is None else f"{r['cards_per_foul']:.3f}"
        print(f"   {r['ypg']:>5}  {r['red_pg']:>4} red  {pen} pen  "
              f"{fpg} fouls  {cpf} c/f  {r['matches']:>2}m  {r['name']}")

    if args.dry_run:
        print("\ndry run — nothing written")
        return

    league.path(league.refs_file).write_text(
        json.dumps({"refs": refs}, indent=1), encoding="utf-8")
    print("\n" + patch_data_file(league, refs))


if __name__ == "__main__":
    main()

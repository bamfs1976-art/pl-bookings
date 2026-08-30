#!/usr/bin/env python3
"""An official's record from the division next door, when this one has none.

    python3 data/cross_refs.py            # all modelled leagues
    python3 data/cross_refs.py --dry-run

THE PROBLEM. A referee's card rate is stored per division, because that is how
it is measured — the free match records are one file per competition. But
officials are not per division. Josh Smith took Coventry v Hull in the Premier
League with 27 Championship matches on record and nothing in the Premier League
table, so the desk priced that fixture at the league rate and marked him
unrated, while the number it needed was one file away. Tony Harrington and
Robert Jones are the same case in the other direction. Four of the nine
fixtures priced at ×1.00 across the three desks were officials the app already
knew.

WHY THE RATE IS SCALED AND NOT COPIED. 3.37 yellows a game means something
different in a division that averages 3.71 from one that averages 4.41. What
transfers is the man's tendency RELATIVE TO HIS OWN COMPETITION, so a borrowed
row is

    his rate  ×  (this league's rate / his league's rate)

Josh Smith is 9% below the Championship's average, so he prices 9% below the
Premier League's. The two English leagues happen to run within 1% of each other
(3.748 and 3.711), which is why this looks like a copy for them — it is not,
and it would not be for Spain.

WHAT IT REFUSES.
  * An official already in this division's table. A measured record always
    beats a borrowed one, however few matches it has.
  * An official who has never been appointed in this division. The table is
    what the desk's dropdown shows and what its guards count; filling it with
    thirty Championship officials who will never take a Premier League match
    makes the page worse to use and every count meaningless.
  * A borrowed row in the source. Borrowing is one hop, never two — otherwise
    a rate could travel Spain → England → Spain and come back rescaled twice.

THE LAG, STATED. Appointments land up to seven times a day; this runs with the
daily data refresh. An official appointed for the first time in a division
within a day of kickoff therefore prices at the league rate for that match and
is borrowed afterwards. The alternative was a second workflow writing the
league data files, and two owners of one file is the failure this repository
keeps meeting. In practice appointments are published days out.
"""

import argparse
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import appointments as A  # noqa: E402
import build_pl_data as P  # noqa: E402

# The divisions that can lend to each other: every one the app models and
# whose officials are named in its match records.
CODES = ("PL", "EFLC", "LL")

FIXTURE_CONST = {"PL": ("PL_FIXTURES", "pl_fixtures.js"),
                 "EFLC": ("EFLC_FIXTURES", "eflc_fixtures.js"),
                 "LL": ("LALIGA_FIXTURES", "laliga_fixtures.js")}
DATA_FILE = {"PL": "pl_data.js", "EFLC": "eflc_data.js", "LL": "laliga_data.js"}


def read_refs(code):
    """The REFS rows in a league's shipped data file, or None if absent."""
    path = DATA / DATA_FILE[code]
    if not path.exists():
        return None
    return P.js_array(path.read_text(encoding="utf-8"), "REFS",
                      label=DATA_FILE[code])


def appointed_names(code):
    """Every official named on a fixture in this division, this season.

    The whole season's list, not the fixtures still to come: a man who took a
    match in August is a man this division uses, and dropping him the moment
    the fixture is played would make his row appear and disappear.
    """
    const, name = FIXTURE_CONST[code]
    path = DATA / name
    if not path.exists():
        return []
    rows = P.js_array(path.read_text(encoding="utf-8"), const, label=name)
    return [r["ref"] for r in rows if r.get("ref")]


def yellow_rate(refs):
    """A division's yellows a game, weighted by matches — the denominator the
    scaling is relative to. Native rows only; a borrowed row carries no
    matches of its own in this competition and would count its exposure twice.
    """
    m = sum(r["matches"] for r in refs if not r.get("borrowed"))
    if not m:
        return None
    return sum(r["ypg"] * r["matches"] for r in refs if not r.get("borrowed")) / m


def _scaled(value, factor):
    return None if value is None else round(value * factor, 2)


def borrow(code, refs, others):
    """Rows to add to `code`'s table. `others` is {code: refs}.

    Returns (rows, notes). Nothing is mutated.
    """
    native = [r for r in refs if not r.get("borrowed")]
    have = [r["n"] for r in native]
    mine = yellow_rate(native)
    if mine is None:
        return [], [f"{code} has no measured officials — nothing to scale against"]

    wanted = appointed_names(code)
    rows, notes, seen = [], [], set()
    for published in wanted:
        # Already ours? Then there is nothing to borrow, whatever his record.
        if A.resolve_ref_name(published, have)[0]:
            continue
        for lender in CODES:
            if lender == code or lender not in others or others[lender] is None:
                continue
            pool = [r for r in others[lender] if not r.get("borrowed")]
            hit, how = A.resolve_ref_name(published, [r["n"] for r in pool])
            if not hit:
                continue
            src = next(r for r in pool if r["n"] == hit)
            if hit in seen:
                break
            theirs = yellow_rate(pool)
            if not theirs:
                break
            f = mine / theirs
            seen.add(hit)
            rows.append({
                "n": hit, "region": src.get("region", ""),
                "matches": src["matches"],
                "ypg": _scaled(src.get("ypg"), f),
                "red": _scaled(src.get("red"), f),
                # Penalties and cards-per-foul are NOT scaled by a YELLOW-card
                # ratio — a penalty is a different decision and cpf is already
                # a ratio of two quantities that both move with the division.
                "pen": src.get("pen"),
                "fpg": src.get("fpg"),
                "cpf": src.get("cpf"),
                "borrowed": lender,
            })
            notes.append(
                f"{code}: {hit} borrowed from {lender} — {src['matches']} match(es) "
                f"at {src.get('ypg')} y/g there, {rows[-1]['ypg']} here "
                f"(×{f:.3f}), matched on {how}")
            break
    return rows, notes


def refs_block(refs):
    """The REFS literal, in build_refs.py's format plus the borrowed marker."""
    lines = ["const REFS = ["]
    for r in refs:
        cells = [f'n:{json.dumps(r["n"], ensure_ascii=False)}',
                 f'region:{json.dumps(r.get("region") or "", ensure_ascii=False)}',
                 f'matches:{_js(r.get("matches"))}', f'ypg:{_js(r.get("ypg"))}',
                 f'red:{_js(r.get("red"))}', f'pen:{_js(r.get("pen"))}',
                 f'fpg:{_js(r.get("fpg"))}', f'cpf:{_js(r.get("cpf"))}']
        if r.get("borrowed"):
            cells.append(f'borrowed:{json.dumps(r["borrowed"])}')
        lines.append("  {" + ",".join(cells) + "},")
    lines.append("];")
    return "\n".join(lines)


def _js(x):
    return "null" if x is None else str(x)


def apply(dry_run=False):
    """Recompute every division's borrowed rows. Idempotent by construction:
    the existing borrowed rows are DROPPED before anything is decided, so a
    referee who has since earned a record of his own, moved, or stopped being
    appointed here simply does not come back."""
    tables = {c: read_refs(c) for c in CODES}
    native = {c: ([r for r in t if not r.get("borrowed")] if t else None)
              for c, t in tables.items()}

    all_notes, changed = [], []
    for code in CODES:
        if native[code] is None:
            all_notes.append(f"{code}: no data file yet — skipped")
            continue
        rows, notes = borrow(code, native[code], native)
        all_notes.extend(notes)
        # Sorted by card rate with the rest, so the table still reads as a
        # ranking rather than natives-then-borrowed.
        merged = sorted(native[code] + rows,
                        key=lambda r: -(r.get("ypg") or 0))
        path = DATA / DATA_FILE[code]
        src = path.read_text(encoding="utf-8")
        block = refs_block(merged)
        new = re.sub(r"const REFS = \[.*?\];", lambda _m: block, src,
                     count=1, flags=re.S)
        if new == src:
            continue
        changed.append(f"{DATA_FILE[code]} ({len(rows)} borrowed)")
        if not dry_run:
            path.write_text(new, encoding="utf-8")
    return all_notes, changed


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    notes, changed = apply(dry_run=args.dry_run)
    for n in notes:
        print("  " + n)
    if not changed:
        print("no division needed a borrowed record")
        return
    print(("would rewrite " if args.dry_run else "rewrote ") + ", ".join(changed))


if __name__ == "__main__":
    main()

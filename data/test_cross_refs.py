#!/usr/bin/env python3
"""Borrowing a referee's record from the division next door.

    python3 data/test_cross_refs.py

WHY THIS IS ITS OWN TEST FILE. Every other join in this pipeline that went
wrong went wrong on a NAME. This one can go wrong on ARITHMETIC, silently and
in a way that looks entirely correct on the page: a rate copied instead of
scaled, or a borrowed row counted into the very average it is measured
against, changes what a fixture is priced at and nothing says so. A referee
factor of ×0.91 and one of ×1.00 look equally plausible.

The circularity is the one to hold on to. Josh Smith's 27 matches were
refereed in the Championship and are already in the Championship's baseline.
Count them in the Premier League's baseline as well and the Premier League
average moves — which moves the factor his borrowed rate is turned into,
which is the number the borrow existed to produce.
"""

import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import cross_refs as X  # noqa: E402

FAIL = []
passed = 0


def check(name, got, want):
    global passed
    if got != want:
        FAIL.append(f"{name}: got {got!r}, expected {want!r}")
    else:
        passed += 1


def ok(cond, msg):
    global passed
    if not cond:
        FAIL.append(msg)
    else:
        passed += 1


def ref(n, ypg, matches, red=0.1, borrowed=None):
    r = {"n": n, "region": "", "matches": matches, "ypg": ypg, "red": red,
         "pen": None, "fpg": 20.0, "cpf": 0.18}
    if borrowed:
        r["borrowed"] = borrowed
    return r


# ---- the average is over what this division actually refereed --------------
# Two officials at 4.00 over 10 matches each, plus a borrowed row at 1.00 over
# 100. Included, the mean collapses to 1.5; excluded it stays 4.00.
mixed = [ref("A One", 4.0, 10), ref("B Two", 4.0, 10),
         ref("C Three", 1.0, 100, borrowed="EFLC")]
check("a borrowed row does not move the division's average",
      X.yellow_rate(mixed), 4.0)
check("and the average is weighted by matches, not a mean of rates",
      round(X.yellow_rate([ref("A", 4.0, 30), ref("B", 1.0, 10)]), 3), 3.25)


# ---- the rate is scaled, not copied ----------------------------------------
# A strict league (5.00) borrowing from a lenient one (2.50): a man at 2.00
# there is 20% below his own average, so 4.00 here — NOT 2.00.
strict = [ref("Home One", 5.0, 20), ref("Home Two", 5.0, 20)]
lenient = [ref("Visitor", 2.0, 20), ref("Other", 3.0, 20)]

def borrow_with(code, mine, others, appointed):
    """X.borrow with the fixture list stubbed, so the arithmetic is testable
    without a shipped fixture file."""
    real = X.appointed_names
    X.appointed_names = lambda _c: appointed
    try:
        return X.borrow(code, mine, others)
    finally:
        X.appointed_names = real


rows, notes = borrow_with("PL", strict, {"PL": strict, "EFLC": lenient},
                          ["Visitor"])
check("one row borrowed", len(rows), 1)
if rows:
    # lenient average = (2*20 + 3*20)/40 = 2.5 ; factor = 5.0/2.5 = 2.0
    check("the rate is scaled by the two divisions' averages", rows[0]["ypg"], 4.0)
    check("the red rate is scaled the same way", rows[0]["red"], 0.2)
    check("and it is marked with where it came from", rows[0]["borrowed"], "EFLC")
    check("his match count is the OTHER division's, unchanged",
          rows[0]["matches"], 20)
    ok(rows[0]["pen"] is None or rows[0]["pen"] == lenient[0]["pen"],
       "penalties per game were scaled by a YELLOW-card ratio — a penalty is a "
       "different decision and does not move with a division's card rate")

# AND THE BORROWED ROW MUST NOT THEN MOVE THE AVERAGE IT WAS SCALED BY.
check("the division's average is unchanged by what it lent to",
      X.yellow_rate(strict + rows), 5.0)


# ---- what it refuses -------------------------------------------------------
own = [ref("Visitor", 9.0, 2), ref("Home One", 5.0, 20)]
rows2, _ = borrow_with("PL", own, {"PL": own, "EFLC": lenient}, ["Visitor"])
check("a measured record beats a borrowed one, however few matches it has",
      rows2, [])

rows3, _ = borrow_with("PL", strict, {"PL": strict, "EFLC": lenient}, [])
check("an official never appointed in this division is not borrowed", rows3, [])

# ONE HOP, NEVER TWO. A row that is itself borrowed cannot be lent on: its rate
# has already been rescaled once, and a second pass would rescale the rescale.
second_hand = [ref("Tourist", 2.0, 20, borrowed="LL"), ref("Other", 3.0, 20)]
rows4, _ = borrow_with("PL", strict, {"PL": strict, "EFLC": second_hand},
                       ["Tourist"])
check("a borrowed row is not lent on a second time", rows4, [])

# AND NOT FROM A DIVISION WITH NOTHING TO SCALE AGAINST.
rows5, _ = borrow_with("PL", strict, {"PL": strict, "EFLC": []}, ["Visitor"])
check("an empty lender lends nothing", rows5, [])


# ---- the name rule is the shared one, not a new one ------------------------
# The fixture file writes an official the feed's way; the table writes him the
# match records' way. This is the same resolver the appointments overlay uses.
rows6, _ = borrow_with("PL", strict, {"PL": strict, "EFLC": lenient},
                       ["V. Visitor"])
ok(len(rows6) == 0 or rows6[0]["n"] == "Visitor",
   "an abbreviated name resolved to somebody other than the man it abbreviates")

# TWO OFFICIALS WHO LOOK ALIKE ARE REFUSED, because resolve_ref_name refuses
# them — the property that matters is that this file does not paper over it.
twins = [ref("J Smith", 2.0, 20), ref("James Smith", 3.0, 20)]
rows7, _ = borrow_with("PL", strict, {"PL": strict, "EFLC": twins},
                       ["Josh Smith"])
ok(all(r["n"] != "James Smith" for r in rows7),
   "a surname match alone attached one official's card record to another")


# ---- the emitted literal round-trips ---------------------------------------
block = X.refs_block([ref("Plain", 4.0, 10), ref("Lent", 3.0, 7, borrowed="LL")])
ok("borrowed:\"LL\"" in block,
   "the borrowed marker is not written to the data file, so nothing downstream "
   "can tell a borrowed row from a measured one")
ok(block.count("borrowed:") == 1,
   "a measured row was written with a borrowed marker")
ok(block.startswith("const REFS = [") and block.rstrip().endswith("];"),
   "the REFS block is no longer the shape build_refs.py writes and the patch "
   "regex will not match it")

if FAIL:
    print("FAIL")
    for f in FAIL:
        print("  -", f)
    sys.exit(1)
print(f"cross-division referees OK: {passed} checks — a borrowed rate is scaled "
      "by the two divisions' averages and never counted into the one it is "
      "measured against, a measured record always wins, and borrowing is one "
      "hop only")

#!/usr/bin/env python3
"""
Transfers: the squads follow the feed, the rates follow the player.

WHAT THIS GUARDS. build_pl_data.reconcile_squads decides who plays for whom.
Measured against the FPL feed on 19 August 2026 — three weeks into a window —
the shipped dataset had 40 players priced at a club they had left, 106 rows for
players no longer in the division, and 118 players in the league with no row.
None of that threw, and every one of those rows looked complete: a booking
model that prices a Newcastle midfielder who plays for Arsenal is not broken in
any way a reader can see.

The dangerous direction is the fix, not the bug. A reconcile that is too eager
DELETES players — a feed that arrives short, a club renamed, a name it cannot
match — and a desk that quietly loses a third of its squads is worse than one
that is three weeks stale. So the refusals are pinned here as hard as the
behaviour.

  python3 data/test_reconcile.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pl_data as b  # noqa: E402

passed = 0


def ok(cond, msg):
    global passed
    assert cond, msg
    passed += 1


CLUBS = sorted(b.SHORT.values())


def league(extra=(), skip=()):
    """A feed the size of a real division: every club, 25 players each."""
    rows = []
    for c in CLUBS:
        for i in range(25):
            # No digits: name_tokens strips them, and a fixture whose 25
            # players all tokenise identically tests nothing.
            n = f"Firstname{c} Surname{chr(97 + i)}"
            if n in skip:
                continue
            rows.append({"c": c, "n": n, "pos": "Midfielder"})
    rows.extend(extra)
    return rows


def shipped(name, club, **kw):
    row = {"c": club, "n": name, "b": "PL", "min": 900, "yc": 4, "rc": 0,
           "f": 1.2, "fw": 1.0, "p": "M", "r": 0.5}
    row.update(kw)
    return row


print("reconcile: the squads follow the feed")
rows = [shipped("FirstnameARS Surnamea", "ARS"), shipped("Bruno Guimarães", "NEW")]
out = b.reconcile_squads(list(rows),
                         league(extra=[{"c": "ARS", "n": "Bruno Guimarães Rodriguez Moura",
                                        "pos": "Midfielder"}]))
moved = [r for r in out if r["n"] == "Bruno Guimarães"]
ok(len(moved) == 1 and moved[0]["c"] == "ARS",
   "a player the feed puts at another club must move there — he is priced into "
   f"his new club's fixtures or he is priced into nobody's; got {moved}")

print("reconcile: the rate follows the player")
ok(moved[0]["yc"] == 4 and moved[0]["f"] == 1.2 and moved[0]["b"] == "PL",
   "a card rate is a property of the PLAYER — how often he fouls and how often "
   "that is punished — so it travels with him. Discarding it on transfer would "
   f"blank the most-priced players of every window; got {moved[0]}")

print("reconcile: a player the feed does not have has left")
out = b.reconcile_squads([shipped("Departed Man", "ARS")], league())
ok(not [r for r in out if r["n"] == "Departed Man"],
   "a row for somebody no longer in the division must go, or the desk offers "
   "prices on a player who cannot be booked in this league")

print("reconcile: a player with no row arrives, with no rate")
out = b.reconcile_squads([], league())
new = [r for r in out if r["n"] == "FirstnameARS Surnamea"]
ok(len(new) == 1, f"every feed player without a row must arrive; got {len(new)}")
ok(new[0]["b"] == "NEW", "an arrival is basis NEW — the label that means 'in "
   "this league, no form yet' — never EFL, which claims a Championship rate")
ok(new[0].get("yc") is None and new[0].get("f") is None,
   "an arrival's rates are NULL, not zero: a player with no minutes has not "
   f"committed zero fouls per 90, the rate does not exist; got {new[0]}")

print("reconcile: what it refuses to do")
# THE EXPENSIVE DIRECTION. Each of these would empty part of the desk.
kept = b.reconcile_squads([shipped("FirstnameARS Surnamea", "ARS")], [])
ok(len(kept) == 1, "no feed at all must leave the squads untouched, not empty them")

short = [{"c": "ARS", "n": f"Player {i}", "pos": "M"} for i in range(30)]
kept = b.reconcile_squads([shipped("Somebody Else", "CHE")], short)
ok(len(kept) == 1 and kept[0]["n"] == "Somebody Else",
   "a feed carrying one club is not a division — reconciling against it would "
   "retire nineteen clubs' worth of players, so it must be refused whole")

half = [r for r in league() if r["c"] in CLUBS[:17]]
kept = b.reconcile_squads([shipped("FirstnameCHE Surnamea", "CHE")], half)
ok(len(kept) == 1, "a feed missing clubs is refused whole rather than retiring "
   "everybody at the clubs it happens to omit")

print("reconcile: ambiguity is left alone, never guessed")
two = league(extra=[{"c": "LEE", "n": "Gabriel dos Santos", "pos": "Defender"},
                    {"c": "ARS", "n": "Gabriel Martinelli Silva", "pos": "Midfielder"}])
out = b.reconcile_squads([shipped("Gabriel", "ARS")], two)
still = [r for r in out if r["n"] == "Gabriel"]
ok(len(still) == 1 and still[0]["c"] == "ARS",
   "a name answering to two players must leave the shipped row exactly as it "
   f"is — moving a player on a guess is the failure this prevents; got {still}")

print("reconcile: the count is the feed's, not the old file's")
out = b.reconcile_squads([shipped("Departed Man", "ARS"), shipped("FirstnameCHE Surnamed", "CHE")],
                         league())
ok(len(out) == len(CLUBS) * 25,
   "after a reconcile the squad list is exactly the division the feed "
   f"describes; got {len(out)} against {len(CLUBS) * 25}")

print(f"\n{passed} checks passed")

# MUTATIONS these assertions were checked against:
#   move the club but blank the rates      -> "the rate follows the player"
#   keep rows the feed does not have       -> "a player the feed does not have"
#   arrive with zeroed rates instead of null -> "an arrival's rates are NULL"
#   drop the too-small-feed refusals       -> "a feed carrying one club"
#   pick the first hit when ambiguous      -> "ambiguity is left alone"

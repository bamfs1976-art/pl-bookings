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

# THE SHIPPED OVERLAY IS NOT AN INPUT TO THESE TESTS. apply_transfers reads
# data/transfers.json when it is given no entries, which quietly made every
# fixture below depend on a hand-edited file: a real entry naming a player one
# of these fixtures also uses would break a test that has nothing to do with
# transfers. It also masked a mutation — inventing a row for an unmatched entry
# was caught by an unrelated assertion twenty tests earlier, which proves
# nothing about the assertion written for it. Every transfer test passes its
# entries explicitly, so the file is never the thing under test here.
b.load_transfers = lambda: []


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
    # _club, _tid and _img carry the OLD club, exactly as a real shipped row
    # does. Without them the club-identity assertions below would pass on a row
    # that simply has no club name — a guard satisfied by the wrong absence.
    row = {"c": club, "n": name, "b": "PL", "min": 900, "yc": 4, "rc": 0,
           "f": 1.2, "fw": 1.0, "p": "M", "r": 0.5,
           "_club": b.NAME_BY_SHORT.get(club), "_tid": 99,
           "_img": "https://example.invalid/old-badge.png", "_fouls": 12.0}
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

# The club a moved player carries with him, which is the part that went wrong
# the first time this ran for real: build_clubs names each club from the
# _club of whichever of its players it meets first and takes the badge from
# the first _img, so a row that changed `c` and kept those RENAMED the club it
# joined — "MUN Aston Villa", "LIV Aston Villa" — and the club-splits step
# refused to write against the wreckage. Every trace of the old club must go.
ok(moved[0].get("_club") == "Arsenal",
   "a moved player must carry his NEW club's name, or he renames the club he "
   f"joins; got {moved[0].get('_club')!r}")
ok(moved[0].get("_img") is None and moved[0].get("_tid") is None,
   "a moved player must carry no crest or team id from his old club — the "
   f"badge comes from somebody already there; got {moved[0]}")

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

print("reconcile: a move that collides with an existing row keeps the evidence")
# Taiwo Awoniyi was in the dataset twice — a Premier League row at Forest and,
# because the promoted-club fill reads the same FPL feed, a formless row at
# Coventry. They did not collide while they sat at different clubs, so the
# de-duplication earlier in build_players let both through; moving the first
# put two Awoniyis in one squad, and check-lineup-pricing caught it.
dupes = [shipped("Taiwo Awoniyi", "NFO"),
         shipped("Taiwo Awoniyi", "COV", b="NEW", y=None, f=None, yc=None, min=0)]
out = b.reconcile_squads(dupes, league(extra=[{"c": "COV", "n": "Taiwo Awoniyi",
                                               "pos": "Attacker"}]))
awo = [r for r in out if r["n"] == "Taiwo Awoniyi"]
ok(len(awo) == 1,
   f"a move onto an existing row must leave ONE player, not two; got {len(awo)}")
ok(awo[0]["c"] == "COV" and awo[0]["b"] == "PL" and awo[0]["yc"] == 4,
   "and the survivor is the row with the evidence on it — keeping the formless "
   f"one throws away the reason for moving him at all; got {awo[0]}")

print("reconcile: the same man spelt two ways is one player")
# The promoted clubs carried both a Championship row ("F. Onyeka") and an FPL
# fill row ("Frank Onyeka") for the same person, because the de-duplication in
# build_players keys on the exact name. Coventry, Ipswich and Hull were
# shipping squads of 55 to 58 against a real 25 to 30 — half of each squad
# listed twice, at two different rates.
pair = [shipped("F. Onyeka", "COV", b="EFL"),
        shipped("Frank Onyeka", "COV", b="NEW", y=None, f=None, yc=None, min=0)]
out = b.reconcile_squads(pair, league(extra=[{"c": "COV", "n": "Frank Onyeka",
                                              "pos": "Midfielder"}]))
onyeka = [r for r in out if "nyeka" in r["n"]]
ok(len(onyeka) == 1,
   f"an abbreviated name and its full form are one player; got {onyeka}")
ok(onyeka[0]["b"] == "EFL" and onyeka[0]["yc"] == 4,
   f"and the row with the rate survives; got {onyeka[0]}")

# BUT A ONE-TOKEN NAME IS NOT AN ABBREVIATION. Arsenal field both Gabriel and
# Gabriel Jesus; the join matches them because a single token is covered by any
# name containing it, so collapsing on the full join rule would merge two
# players into one row and silently delete a footballer.
both = [shipped("Gabriel", "ARS"), shipped("Gabriel Jesus", "ARS")]
out = b.reconcile_squads(both, league(extra=[{"c": "ARS", "n": "Gabriel", "pos": "Defender"},
                                             {"c": "ARS", "n": "Gabriel Jesus", "pos": "Attacker"}]))
gabriels = sorted(r["n"] for r in out if r["n"].startswith("Gabriel"))
ok(gabriels == ["Gabriel", "Gabriel Jesus"],
   f"two players who share a name must both survive; got {gabriels}")

print("reconcile: a signing does not demote the club he joins")
# club_basis labels the TEAM aggregate. Before the reconcile, a NEW row could
# only appear at a promoted club, so "not all PL" and "no Premier League data"
# meant the same thing. One signing at an established club broke that: the
# first real run labelled every club EFL, which blanks the team card average,
# the home/away splits and the club inputs the model prices with — the whole
# desk, over one transfer.
ok(b.club_basis(["PL", "PL", "NEW"]) == "PL",
   "a club with Premier League form and a new signing is still on Premier "
   "League data")
ok(b.club_basis(["PL"]) == "PL", "an untouched club is unchanged")
ok(b.club_basis(["EFL", "NEW"]) == "EFL",
   "a promoted club has no Premier League aggregate and must not claim one")
ok(b.club_basis(["PL"] * 30 + ["EFL"]) == "PL",
   "and a Championship signing does not demote an established club — Palace "
   "signed Esse from Coventry and Liverpool signed Koumas from Hull, and a set "
   "test cost both of them their team aggregate over one player")
ok(b.club_basis(["PL"] + ["EFL"] * 25) == "EFL",
   "while a promoted club that signs a Premier League player still has no "
   "Premier League season behind it — Coventry gained a PL row when Awoniyi "
   "joined, and 'has any PL row' would have let it claim an aggregate")
ok(b.club_basis(["NEW"]) == "EFL",
   "a club of nothing but newcomers has no aggregate either")
ok(b.club_basis([]) == "EFL", "no rows at all is not a Premier League basis")

print("transfers: the overlay the feed has not caught up with")
# THE ORDERING, WHICH IS THE WHOLE POINT. The feed still lists Romero at
# Tottenham — that is why the overlay exists — so the feed pass must run FIRST
# and the overlay LAST. Reversed, the overlay deletes his row and the feed pass
# immediately re-creates it as an arrival: he comes back, on basis NEW, with
# his card rate thrown away, and the build reports success.
ROMERO = "Cristian Romero"
feed_with_him = league(extra=[{"c": "TOT", "n": ROMERO, "pos": "Defender"}])
out = b.reconcile_squads([shipped(ROMERO, "TOT")], feed_with_him,
                         transfers=[{"league": "PL", "player": ROMERO,
                                     "from": "TOT", "to": None}])
ok(not [r for r in out if r["n"] == ROMERO],
   "a player the overlay says has left must be gone even though the FEED still "
   f"lists him — that is the only case the overlay is for; got {out}")

# ...and he must not come back as a formless arrival either, which is what
# running the overlay first would produce.
ok(not [r for r in out if ROMERO in (r.get("n") or "")],
   "the departed player reappeared as an arrival — the overlay ran before the "
   "feed pass, so the feed re-created the row it had just deleted")

print("transfers: a move within the division keeps the rate and the identity")
out = b.reconcile_squads([shipped("Firstnamex Surnamex", "TOT")],
                         league(extra=[{"c": "TOT", "n": "Firstnamex Surnamex",
                                        "pos": "Defender"}]),
                         transfers=[{"league": "PL", "player": "Firstnamex Surnamex",
                                     "from": "TOT", "to": "ARS"}])
got = [r for r in out if r["n"] == "Firstnamex Surnamex"]
ok(len(got) == 1 and got[0]["c"] == "ARS", f"the overlay did not move him; {got}")
ok(got[0]["yc"] == 4 and got[0]["f"] == 1.2,
   "the rate is a property of the player and must survive an overlay move too")
ok(got[0]["_club"] == "Arsenal" and got[0]["_tid"] is None and got[0]["_img"] is None,
   "an overlay move must clear every trace of the old club, or the player "
   f"renames the club he joins — the 'MUN Aston Villa' failure; got {got[0]}")

print("transfers: and what it refuses")
# NEVER INVENTS. An entry naming nobody must not conjure a row: a model that
# prices a player who does not exist is worse than one that is a week stale.
out = b.apply_transfers([shipped("Firstnamex Surnamex", "TOT")],
                        [{"league": "PL", "player": "Nobody Atall",
                          "from": "TOT", "to": "ARS"}])
ok(len(out) == 1 and out[0]["n"] == "Firstnamex Surnamex",
   f"an entry matching nobody must change nothing and invent nothing; got {out}")

# STALE ENTRY. He has since joined Chelsea; an old "left Tottenham" line must
# not drag him back out of the club the feed has already put him at.
rows = [shipped("Firstnamex Surnamex", "CHE")]
out = b.apply_transfers(rows, [{"league": "PL", "player": "Firstnamex Surnamex",
                                "from": "TOT", "to": None}])
ok(len(out) == 1 and out[0]["c"] == "CHE",
   "an entry whose `from` no longer matches the dataset must be refused — it "
   f"is stale or wrong, and applying it deletes a player who is playing; got {out}")

# AMBIGUITY. Two rows answering to one name is exactly when a guess is
# unrecoverable, so nothing moves.
rows = [shipped("Firstnamex Surnamex", "TOT"), shipped("Firstnamex Surnamex", "EVE")]
out = b.apply_transfers(rows, [{"league": "PL", "player": "Firstnamex Surnamex",
                                "from": "TOT", "to": "ARS"}])
ok(len(out) == 2 and {r["c"] for r in out} == {"TOT", "EVE"},
   f"an ambiguous name must leave both rows exactly where they are; got {out}")

# ANOTHER LEAGUE'S ENTRIES ARE NOT THIS LEAGUE'S.
out = b.apply_transfers([shipped("Firstnamex Surnamex", "TOT")],
                        [{"league": "LL", "player": "Firstnamex Surnamex",
                          "from": "TOT", "to": None}])
ok(len(out) == 1, "a La Liga entry must not move a Premier League player")

# AND IT STILL RUNS WHEN THE FEED DOES NOT. The feed pass bails out on a feed
# too small to be a division — correctly — and the overlay is independent
# evidence that must survive that bail-out, or a bad FPL day silently restores
# a player who has left.
out = b.reconcile_squads([shipped(ROMERO, "TOT")], [{"c": "TOT", "n": "X Y"}],
                         transfers=[{"league": "PL", "player": ROMERO,
                                     "from": "TOT", "to": None}])
ok(not [r for r in out if r["n"] == ROMERO],
   "the overlay must apply even when the FPL feed is too small to reconcile "
   f"against — it is separate evidence, not a refinement of the feed; got {out}")

print(f"\n{passed} checks passed")

# MUTATIONS these assertions were checked against:
#   overlay before the feed pass           -> "the departed player reappeared"
#   overlay skipped on the small-feed path -> "must apply even when the FPL
#                                             feed is too small"
#   apply an entry whose `from` disagrees  -> "an entry whose `from` no longer
#                                             matches"
#   take the first hit when ambiguous      -> "an ambiguous name must leave
#                                             both rows"
#   create a row for an unmatched entry    -> "must change nothing and invent
#                                             nothing"
#   move the club but blank the rates      -> "the rate follows the player"
#   keep rows the feed does not have       -> "a player the feed does not have"
#   arrive with zeroed rates instead of null -> "an arrival's rates are NULL"
#   drop the too-small-feed refusals       -> "a feed carrying one club"
#   pick the first hit when ambiguous      -> "ambiguity is left alone"
#   move `c` and keep _club/_img           -> "a moved player must carry his
#                                             NEW club's name"
# That last one is not hypothetical: it is what the first real run did, and
# the fixture carries the old club's name, id and badge so the assertion fails
# on the wrong VALUE rather than on a missing key.

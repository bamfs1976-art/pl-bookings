#!/usr/bin/env python3
"""The bookings ledger — who has been booked, and in which rounds.

    python3 data/harvest_apifootball.py --player-matches --league LL \\
        --season 2026 --out ll_player_matches_2627.json \\
        --only-new laliga_bookings.json
    python3 data/build_bookings.py --league LL \\
        --from ll_player_matches_2627.json

WHY A LEDGER AND NOT A TABLE OF PLAYER-MATCHES. The page needs two things: how
many cards a player has this season, and how many he has in the last five
rounds. Both are answerable from the ROUNDS HE WAS BOOKED IN and nothing else,
so that is all this stores — one row per booked player, a list of round
numbers. The per-player-per-match harvest it is built from is 10,000 rows a
season and would be a third of a megabyte in the repository by May; this is a
few hundred rows and stays small, because a player who has never been booked
does not appear at all.

IT IS APPEND-SAFE, AND THAT MATTERS MORE THAN IT LOOKS. The harvest is
incremental — `--only-new` skips fixtures already recorded — so a run
ordinarily carries only the newest round. Rebuilding the ledger from that
alone would silently throw away every earlier round, and the page would look
right: a leaderboard with plausible names and small numbers. So a run MERGES
into the shipped ledger, and the fixtures already recorded are what tells the
harvest what it may skip. The two halves are the same list.

ROUNDS, NOT DATES. "The last five games" is per LEAGUE, and a league plays a
round at a time; using dates would make a Friday-night fixture and the
following Monday's part of different windows depending on when the page was
opened. `rounds` is the highest round the ledger has seen, and the window is
the five rounds ending there.

A SECOND YELLOW IS ONE DISMISSAL, NOT TWO CARDS — the same convention the
match record uses (see scripts/accas.mjs outcomeTotals). API-Football reports
it on the player line as yc=2, rc=1 for that match; counting the yellows and
the red would give that player three cards for one sending-off. The ledger
therefore records, per round, the number of CARDS SHOWN with a second yellow
counted once: a straight red alone is one, a booking is one, a booking
followed by a second yellow is two.
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import build_pl_data as P  # noqa: E402
import leagues  # noqa: E402

OUT_FOR = {
    "PL": ("pl_bookings.js", "PL_BOOKINGS"),
    "EFLC": ("eflc_bookings.js", "EFLC_BOOKINGS"),
    "LL": ("laliga_bookings.js", "LALIGA_BOOKINGS"),
}

# The shipped dataset each ledger borrows its faces from. Same division, same
# club codes, and — the whole reason the join happens HERE — a name written the
# other feed's way. See attach_photos.
DATA_FOR = {
    "PL": ("pl_data.js", "PL_PLAYERS"),
    "EFLC": ("eflc_data.js", "EFLC_PLAYERS"),
    "LL": ("laliga_data.js", "LALIGA_PLAYERS"),
}


def cards_in(row):
    """Cards shown to one player in one match, second yellow counted once.

    yc is the number of yellows the feed reports and rc the dismissals. A
    second yellow appears as yc=2, rc=1 — two yellows and a red for what a
    reader, and every card market, counts as two cards. So a dismissal that
    followed a booking adds nothing beyond the yellows, and a STRAIGHT red
    (rc=1, yc=0) is the one card it is.
    """
    yc = int(row.get("yc") or 0)
    rc = int(row.get("rc") or 0)
    if rc and yc >= 2:
        return yc            # booking + second yellow: the two yellows ARE the cards
    return yc + rc


def load_shipped(path):
    """The ledger already in the repository, or an empty one."""
    if not path.exists():
        return {"season": None, "rounds": 0, "fixtures": [], "players": []}
    src = path.read_text(encoding="utf-8")
    start = src.find("{")
    end = src.rfind("}")
    if start < 0 or end < 0:
        sys.exit(f"ERROR: {path.name} is present but has no object in it")
    try:
        return json.loads(src[start:end + 1])
    except ValueError as e:
        sys.exit(f"ERROR: {path.name} will not parse: {e}")


def merge(shipped, rows, season):
    """Fold a player-matches harvest into the shipped ledger."""
    by_key = {}
    for p in shipped.get("players") or []:
        by_key[(p["c"], p["n"])] = {
            "n": p["n"], "c": p["c"],
            "rds": {int(k): int(v) for k, v in (p.get("rds") or {}).items()},
        }
    fixtures = {int(f) for f in (shipped.get("fixtures") or [])}

    seen_fixtures = set()
    for r in rows:
        fid = r.get("fixture_id")
        rd = r.get("round")
        if fid is None or rd is None:
            continue
        seen_fixtures.add(int(fid))
        n = cards_in(r)
        if not n:
            continue
        key = (r.get("club"), r.get("player"))
        if not key[0] or not key[1]:
            continue
        e = by_key.setdefault(key, {"n": key[1], "c": key[0], "rds": {}})
        # A fixture already in the ledger is not re-added: the harvest is
        # incremental, but a re-walk (a rebuilt ledger, a manual run without
        # --only-new) must not double every count it re-reads.
        if int(fid) in fixtures:
            continue
        e["rds"][int(rd)] = e["rds"].get(int(rd), 0) + n

    fixtures |= seen_fixtures
    players = sorted(
        ({"n": e["n"], "c": e["c"], "rds": {str(k): v for k, v in sorted(e["rds"].items())}}
         for e in by_key.values() if e["rds"]),
        key=lambda p: (-sum(p["rds"].values()), p["c"], p["n"]))
    rounds = max([int(k) for p in players for k in p["rds"]] or [0])
    return {
        "season": season or shipped.get("season"),
        "rounds": max(rounds, int(shipped.get("rounds") or 0)),
        "fixtures": sorted(fixtures),
        "players": players,
    }


def attach_photos(led, league):
    """Give each booked player his face, from the division's own dataset.

    WHY THE JOIN IS HERE AND NOT ON THE PAGE. The ledger writes a player the
    way API-Football's player-match feed spells him — "Bright Osayi-Samuel" —
    and the shipped squads write him the way that division's squad feed does:
    "B. Osayi-Samuel". An exact match on club and name finds 3 of the
    Championship's 85 booked players. The rule that reconciles those two
    spellings already exists, is already tested against real names in both
    directions (data/test_names.py), and is written in Python. Re-implementing
    it in the browser to run on every render is how this repository has
    produced two joins that disagree every previous time, so the page does no
    joining at all: it reads `ph` off the row.

    AMBIGUITY IS REFUSED, NOT GUESSED, and here that matters more than it does
    anywhere else in the pipeline. Everywhere else a wrong join costs a rate;
    on this page it puts a PHOTOGRAPH OF THE WRONG MAN next to a public claim
    about how often he has been booked. So a name matching two players at the
    club yields no photograph, and he keeps his monogram.

    Returns (matched, total). Mutates the ledger's rows.
    """
    name, konst = DATA_FOR[league]
    src = DATA / name
    if not src.exists():
        return 0, len(led.get("players") or [])
    squad = P.js_array(src.read_text(encoding="utf-8"), konst, label=name)

    # Tokenise the squad ONCE. This runs over a few hundred booked players
    # against a few hundred squad rows; tokenising inside the inner loop is
    # the same work several hundred times over.
    by_club = {}
    for s in squad:
        if not s.get("ph"):
            continue
        by_club.setdefault(s.get("c"), []).append((P.name_tokens(s.get("n")), s["ph"]))

    matched = 0
    for p in led.get("players") or []:
        p.pop("ph", None)
        toks = P.name_tokens(p.get("n"))
        hits = [ph for t, ph in by_club.get(p.get("c"), []) if P.same_tokens(toks, t)]
        # `set` rather than `len(hits) == 1`: one man listed twice in a squad
        # with the same photograph is not an ambiguity, two men are.
        if len(set(hits)) == 1:
            p["ph"] = hits[0]
            matched += 1
    return matched, len(led.get("players") or [])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", default="EFLC", choices=sorted(OUT_FOR))
    ap.add_argument("--from", dest="src",
                    help="the player-matches harvest to fold in; omit to re-attach "
                         "photographs to the shipped ledger without harvesting")
    ap.add_argument("--season", help="e.g. 2026-27; kept from the ledger if omitted")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    L = leagues.LEAGUES[args.league]
    name, konst = OUT_FOR[args.league]
    out = DATA / name

    # NO HARVEST IS A VALID RUN. A round of football changes who is in the
    # ledger; a squad refresh changes what they look like, and the two arrive
    # on different schedules. Folding in nothing is a faithful round-trip —
    # merge() rebuilds every row from the shipped file — so this re-attaches
    # the faces and rewrites, rather than making a new photograph wait for
    # somebody to be booked.
    rows = []
    src = DATA / args.src if args.src else None
    if src is not None and not src.exists():
        print(f"{args.src} not present — nothing to fold in; "
              "re-attaching photographs only.")
    elif src is not None:
        rows = json.loads(src.read_text(encoding="utf-8"))
        rows = [r for r in rows if (r.get("league") or args.league) == args.league]

    shipped = load_shipped(out)
    if not (shipped.get("players") or rows):
        print(f"{L.name}: no ledger and nothing harvested — nothing to write.")
        return
    before = len(shipped.get("players") or [])
    led = merge(shipped, rows, args.season)
    # AFTER the merge, and every run. merge() rebuilds each row from n, c and
    # rds alone, so a photograph never survives from the shipped file — which
    # is what makes this self-healing: a player the squad feed had no face for
    # in August picks one up on the first build after it does, and a player
    # who has moved clubs loses one that is no longer his.
    faces, of = attach_photos(led, args.league)

    total = sum(sum(int(v) for v in p["rds"].values()) for p in led["players"])
    print(f"{L.name}: {len(rows)} player-match rows folded in")
    print(f"  {len(led['players'])} booked player(s) (was {before}), "
          f"{total} card(s), rounds 1-{led['rounds']}, "
          f"{len(led['fixtures'])} fixture(s) recorded")
    print(f"  {faces} of {of} with a photograph"
          + (f" ({of - faces} draw a monogram)" if of > faces else ""))
    if led["players"]:
        top = led["players"][0]
        print(f"  most booked: {top['n']} ({top['c']}) "
              f"{sum(int(v) for v in top['rds'].values())}")
    if args.dry_run:
        print("  --dry-run: nothing written")
        return

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    out.write_text(
        f"// Auto-generated by data/build_bookings.py. Do not hand-edit.\n"
        f"// {L.name} {led['season']}: who has been booked and in which rounds.\n"
        f"// {len(led['players'])} player(s), {total} card(s), "
        f"{len(led['fixtures'])} fixture(s) recorded. Built {stamp}.\n"
        f"//\n"
        f"// A second yellow counts ONCE, as the dismissal it is — the same\n"
        f"// convention the match record uses.\n"
        f"const {konst} = " + json.dumps(led, ensure_ascii=False) + ";\n",
        encoding="utf-8")
    print(f"  {name} written")


if __name__ == "__main__":
    main()

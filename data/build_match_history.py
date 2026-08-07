#!/usr/bin/env python3
"""
Turn a per-player per-fixture harvest into a leakage-free training table.

    python3 data/harvest_apifootball.py --player-matches --league LL --season 2025
    python3 data/build_match_history.py --league LL
    node scripts/build-model.mjs --fit data/ll_match_history.json

WHY THIS EXISTS. data/harvest_history.py already does this for the Premier
League from the FPL element-summary endpoint. FPL has no Championship and no
La Liga, so `build-model.mjs --fit` could only ever be fitted on one of the
three divisions this app covers. Same output shape, any league.

LEAKAGE. For every match a player actually played, the FEATURES are his form
strictly BEFORE that match and the LABEL is whether he was booked IN it. A
player's first appearance therefore has no rate to stand on and enters at zero,
which is the same convention harvest_history.py uses — the shrinkage in the
model is what stops a zero being read as evidence of restraint.

BETTER THAN THE FPL ROUTE IN ONE RESPECT. FPL carries no fouls, so
harvest_history.py substitutes a season-level fouls-per-90 constant for each
player — a number that includes the very matches it is used to predict. Here
fouls are per-match, so foul90 accumulates the same way yellows do and the row
is leakage-free in both features rather than one.

Writes data/<league>_match_history.json, a list of:
  {round, name, pos, yc90, foul90, y}
"""

import argparse
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402

# NULL MEANS ZERO, and that is measured rather than assumed.
#
# The first backfill came back with fouls on 46% of Championship rows and 50%
# of Spanish ones, and this file refused to build a table from it. The refusal
# was right to fire and wrong about the cause. The diagnostic
# (data/player_matches_status.txt) settled it over 667 player-matches:
#
#   explicit zeros: 0
#   fixtures wholly without fouls: 0, partly: 25, of 25
#   minutes on null rows: median 70, max 90
#
# API-Football never writes `committed: 0`. Every fixture carries some foul
# data, so nothing is a feed gap, and the null rows are regular starters rather
# than unused substitutes. A feed that recorded fouls properly would produce
# explicit zeros somewhere in 667 rows. It produces none, so null is how it
# spells nought. The arithmetic agrees: 348 players with at least one foul over
# 25 La Liga matches is about 625 fouls, or 25 a match, which is the division's
# actual rate.
#
# THE ASSUMPTION IS GUARDED, not just documented. The decode is only sound
# while the feed never writes an explicit 0; the day it starts, null reverts to
# meaning "not recorded" and reading it as zero would train the model to think
# half the league never fouls. So an explicit zero anywhere is a hard refusal.


def build(rows):
    """Per-player chronological accumulation. Returns (training rows, stats)."""
    by_player = {}
    for r in rows:
        by_player.setdefault((r.get("player"), r.get("club")), []).append(r)

    # If the feed has started writing explicit zeros, the null-means-zero
    # decode is no longer sound. Checked over the whole input before a single
    # row is built, because a table half-decoded one way and half the other is
    # worse than no table.
    explicit_zeros = sum(1 for r in rows if r.get("fouls") == 0)
    if explicit_zeros:
        raise ValueError(
            f"{explicit_zeros} row(s) carry an explicit fouls=0. This feed has "
            "always used null for nought, and the null-means-zero decode "
            "depends on that. If it now writes both, null means 'not recorded' "
            "again and every null row would train the model as foul-free. "
            "Re-check data/player_matches_status.txt before building.")

    out = []
    no_fouls = 0
    for (name, _club), matches in by_player.items():
        # ORDERED BY KICK-OFF, not by round. Rounds are played out of order —
        # a postponed match carries an early round number and a late date — and
        # ordering by round would let a match that had not happened yet
        # contribute to the form going into one that had.
        matches.sort(key=lambda m: (m.get("date") or "", m.get("fixture_id") or 0))
        cum_yc, cum_min, cum_fouls, cum_foul_min = 0, 0, 0, 0
        for m in matches:
            mins = m.get("min") or 0
            if mins <= 0:
                continue
            # null IS nought here — see the note at the top of this file.
            fouls = m.get("fouls")
            if fouls is None:
                no_fouls += 1
                fouls = 0
            y90 = (cum_yc / (cum_min / 90.0)) if cum_min > 0 else 0.0
            f90 = (cum_fouls / (cum_foul_min / 90.0)) if cum_foul_min > 0 else 0.0
            out.append({
                "round": m.get("round") or 0,
                "name": name,
                "pos": m.get("pos") or "",
                "yc90": round(y90, 4),
                "foul90": round(f90, 4),
                # A red counts: the model predicts "was carded", and the
                # suspension ladders elsewhere in the app treat them separately.
                "y": 1 if ((m.get("yc") or 0) + (m.get("rc") or 0)) > 0 else 0,
            })
            cum_yc += m.get("yc") or 0
            cum_min += mins
            cum_fouls += fouls
            cum_foul_min += mins
    return out, {"players": len(by_player), "no_fouls": no_fouls}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default="PL", choices=sorted(leagues.LEAGUES))
    ap.add_argument("--in", dest="src", help="input harvest file")
    ap.add_argument("--out", help="output training file")
    args = ap.parse_args()

    league = leagues.get(args.league)
    src = DATA / (args.src or f"{league.code.lower()}_player_matches.json")
    if not src.exists():
        sys.exit(f"ERROR: {src.name} not found. Run:\n"
                 f"  python3 data/harvest_apifootball.py --player-matches "
                 f"--league {league.code}")
    rows = json.loads(src.read_text(encoding="utf-8"))
    if not rows:
        sys.exit(f"ERROR: {src.name} is empty.")

    out, stats = build(rows)
    if not out:
        sys.exit("ERROR: no usable training rows — every line had zero minutes.")

    name = args.out or f"{league.code.lower()}_match_history.json"
    (DATA / name).write_text(json.dumps(out), encoding="utf-8")
    booked = sum(r["y"] for r in out)
    zeroed = stats["no_fouls"]
    line = (f"{name}: {len(out)} match rows over {stats['players']} players, "
            f"{booked} carded ({100 * booked / len(out):.1f}%); {zeroed} row(s) "
            f"({100 * zeroed / len(out):.0f}%) had a null foul count, decoded "
            "as nought.")
    print(line)
    # APPENDED to the harvest's own status file, so the whole pipeline reports
    # itself in one committed place. The harvest wrote its findings there and
    # this step did not, which left "did a training table actually get built?"
    # answerable only by scraping a job log — the exact thing that file exists
    # to avoid.
    status = DATA / "player_matches_status.txt"
    with status.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    if len(out) < 200:
        print(f"NOTE: build-model.mjs keeps the season prior below 200 rows, "
              f"so {len(out)} will not change the model yet.")
    print(f"Next: node scripts/build-model.mjs --fit data/{name}")


if __name__ == "__main__":
    main()

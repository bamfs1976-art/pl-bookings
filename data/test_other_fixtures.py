#!/usr/bin/env python3
"""
The draw-pending placeholder, and the calendar that replaces it.

WHY THIS FILE EXISTS. Twice now the harvest has emitted eight rows per club
at one kick-off — the 2026-27 Champions League block in August, the Europa
League block after it — and both times the file shipped, was vendored
downstream and reached production before anyone noticed. Nothing in this
repo asserted the one thing that makes the block obviously wrong: a club
cannot play two matches at the same instant.

  python3 data/test_other_fixtures.py
"""
import sys
from datetime import date
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import uefa_league_phase as ulp  # noqa: E402
import harvest_other_fixtures as hof  # noqa: E402

FAILED = []


def ok(cond, label):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        FAILED.append(label)


def section(name):
    print("\n" + name)


# ── the curated calendar ──────────────────────────────────────────────
section("uefa_league_phase: the transcription holds its own invariants")
ok(ulp.self_check() == [],
   "every curated club has eight ties, four home and four away, in date order")

# The offset is the thing most likely to be wrong and least likely to be
# noticed: it is right for two-thirds of the league phase either way.
ok(ulp.utc_offset_hours(date(2026, 9, 17)) == 2, "September is summer time (+2)")
ok(ulp.utc_offset_hours(date(2026, 10, 22)) == 2, "22 October is still summer time")
ok(ulp.utc_offset_hours(date(2026, 10, 25)) == 1, "the clocks go back on 25 October")
ok(ulp.utc_offset_hours(date(2026, 11, 5)) == 1, "November is winter time (+1)")
ok(ulp.utc_offset_hours(date(2027, 1, 28)) == 1, "and so is the January finish")

ok(ulp.to_utc_iso(date(2026, 9, 17), "21:00") == "2026-09-17T19:00:00+00:00",
   "a 21:00 CEST kick-off is 19:00 UTC")
ok(ulp.to_utc_iso(date(2026, 11, 5), "18:45") == "2026-11-05T17:45:00+00:00",
   "an 18:45 CET kick-off is 17:45 UTC")

# The convention has to match what the harvest already emits for the
# competitions API-Football HAS dated, or the file mixes two clocks.
uel = ulp.rows_for(2026, "UEL")
ok(len(uel) == 24, f"the 2026-27 Europa League league phase is 24 English rows, got {len(uel)}")
ok(all(r["comp"] == "UEL" for r in uel), "every row is tagged with its competition")
ok(sorted({r["c"] for r in uel}) == ["BOU", "CRY", "SUN"],
   "and covers exactly the three English clubs in it")
ok(len({(r["c"], r["d"]) for r in uel}) == 24,
   "no club holds two curated ties at one instant")
ok(ulp.rows_for(2026, "UCL") == [],
   "a competition with nothing curated returns nothing, rather than guessing")
ok(ulp.rows_for(1999, "UEL") == [], "and so does a season with nothing curated")


# ── the detector ──────────────────────────────────────────────────────
section("placeholder_clubs: a club cannot play twice at one instant")
REAL = [
    {"c": "LIV", "d": "2026-09-09T19:00:00+00:00", "comp": "UCL", "v": "H"},
    {"c": "LIV", "d": "2026-10-14T16:45:00+00:00", "comp": "UCL", "v": "A"},
    {"c": "ARS", "d": "2026-09-09T19:00:00+00:00", "comp": "UCL", "v": "A"},
]
ok(hof.placeholder_keys(REAL) == set(),
   "real rows are left alone, including two clubs kicking off together")
ok(hof.placeholder_keys([]) == set(), "and an empty competition is not a placeholder")

BLOCK = [{"c": "CRY", "d": "2026-09-16T19:00:00+00:00", "comp": "UEL",
          "v": "H" if i < 4 else "A"} for i in range(8)]
ok(hof.placeholder_keys(BLOCK) == {("CRY", "2026-09-16T19:00:00+00:00")},
   "eight rows at one instant is a placeholder, named by the slot")
ok(hof.placeholder_keys(BLOCK + REAL) == {("CRY", "2026-09-16T19:00:00+00:00")},
   "and the real rows beside it are not condemned with it")

# Brighton's Conference League: two real play-off legs in August, then a
# six-row league-phase block in October. Condemning the club rather than
# the slot threw away two ties that were never in doubt — which is exactly
# what the first version of this did.
BHA = [
    {"c": "BHA", "d": "2026-08-20T17:00:00+00:00", "comp": "UECL", "v": "A"},
    {"c": "BHA", "d": "2026-08-27T18:30:00+00:00", "comp": "UECL", "v": "H"},
] + [{"c": "BHA", "d": "2026-10-15T19:00:00+00:00", "comp": "UECL",
      "v": "H" if i < 3 else "A"} for i in range(6)]
ok(hof.placeholder_keys(BHA) == {("BHA", "2026-10-15T19:00:00+00:00")},
   "only the pile-up is flagged, not the club's real play-off legs")


# ── the substitution ──────────────────────────────────────────────────
section("apply_league_phase_override: replace when we can, drop when we cannot")
rows, note = hof.apply_league_phase_override(list(REAL), "UCL", 2026)
ok(rows == REAL and note is None, "nothing to fix means nothing is touched, and nothing is said")

block = [{"c": c, "d": "2026-09-16T19:00:00+00:00", "comp": "UEL",
          "v": "H" if i < 4 else "A"}
         for c in ("BOU", "CRY", "SUN") for i in range(8)]
rows, note = hof.apply_league_phase_override(list(block), "UEL", 2026)
ok(len(rows) == 24, f"the block is replaced one-for-one, got {len(rows)} rows")
ok(len({(r["c"], r["d"]) for r in rows}) == 24,
   "and the replacement has no club playing twice at once")
# Nine days, not eight: Europa League matchday one straddles Wednesday
# 16 and Thursday 17 September, so the three English clubs do not all
# play on the same day even in the same round. The point of the check is
# that the block's ONE day has become many.
ok(len({r["d"][:10] for r in rows}) == 9,
   "the eight matchdays land on nine distinct days, not one, got "
   + str(len({r["d"][:10] for r in rows})))
ok(sorted({r["d"][:10] for r in rows})[0] == "2026-09-16",
   "starting on matchday one's Wednesday")
ok(note and "replaced" in note, f"the run says what it did: {note}")

# The case that matters most, because it is the one that shipped: a
# placeholder with nothing curated must not survive the harvest.
rows, note = hof.apply_league_phase_override(list(block), "UECL", 2026)
ok(rows == [], "a placeholder with no curated calendar is dropped, not emitted")
ok(note and "DROPPED" in note, f"and the run says so loudly: {note}")

mixed = list(block) + list(REAL)
rows, note = hof.apply_league_phase_override(mixed, "UECL", 2026)
ok(rows == REAL,
   "dropping takes the placeholder slots only, leaving real rows in the same competition")

# The regression that matters: a club with BOTH real ties and a block keeps
# the real ones.
rows, note = hof.apply_league_phase_override(list(BHA), "UECL", 2026)
ok(len(rows) == 2, f"the play-off legs survive the drop, got {len(rows)} rows")
ok(sorted(r["d"][:10] for r in rows) == ["2026-08-20", "2026-08-27"],
   "and they are the two August dates, untouched")


if FAILED:
    print("\nFAILED:\n  - " + "\n  - ".join(FAILED))
    raise SystemExit(1)
print("\nother fixtures: all checks passed")

#!/usr/bin/env python3
"""
Build the Serie A Bookings Desk dataset for 2026-27.

The fifth desk, built by the La Liga builder with a different configuration.
Nothing about the arithmetic differs between Spain and Italy: both divisions
are discovered from API-Football rather than declared, both take their club
card rates free from football-data.co.uk (I1 for Italy) and buy only the
referee NAMES, and both derive their promoted clubs by comparing the current
registry with last season's match records. So data/build_laliga_data.py holds
one builder parametrised by desk, and this file is the Serie A entry point.

  17 clubs  2025-26 Serie A form   basis SA    seriea_players.json
   3 clubs  2025-26 Serie B form   basis SB    serieb_players.json
            (promoted. Flagged, because a foul rate earned in the second tier
            is not the same evidence as one earned in the first.)

Run order:
    python3 data/harvest_apifootball.py --league SA --clubs      # the division
    python3 data/harvest_apifootball.py --league SA              # squads
    python3 data/harvest_apifootball.py --league SERB            # promoted squads
    python3 data/build_seriea_data.py --season 2526              # this

Output: data/seriea_data.js (SUSPENSION, CLUBS, SERIEA_PLAYERS, REFS), the
same shape as laliga_data.js, so build_refs.py --league SA patches its REFS
block unchanged. The SUSPENSION block carries the Italian ladder with its
`then_every` tail from data/leagues.py; the page computes with it and never
hardcodes a threshold.

Sources are never conflated: `sc` is this season's cautions from
seriea_season_cards.json, `yc` is last season's total from the squads harvest.
"""

import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_laliga_data as B  # noqa: E402

B.configure("SA")

if __name__ == "__main__":
    B.main()

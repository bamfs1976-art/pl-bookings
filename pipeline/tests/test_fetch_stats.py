import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fetch_stats import rows_from_api_football  # noqa: E402


def block(team, minutes, apps, yellow, fouls, position="Midfielder", league=39):
    return {
        "league": {"id": league},
        "team": {"name": team},
        "games": {"minutes": minutes, "appearences": apps, "position": position},
        "cards": {"yellow": yellow, "red": 0},
        "fouls": {"committed": fouls},
    }


def test_maps_basic_player():
    items = [{"player": {"name": "Declan Rice"},
              "statistics": [block("Arsenal", 900, 10, 3, 12)]}]
    rows = rows_from_api_football(items)
    assert len(rows) == 1
    r = rows[0]
    assert r["c"] == "ARS" and r["p"] == "MF"
    assert r["min"] == 900 and r["yc"] == 3 and r["apps"] == 10
    assert r["y"] == 0.3           # 3 in 900 minutes
    assert r["f"] == 1.2           # 12 fouls in 900
    assert r["r"] == 1.8


def test_sums_transfer_blocks_and_attributes_biggest_club():
    items = [{"player": {"name": "Journeyman"},
              "statistics": [block("Everton", 300, 5, 1, 4),
                             block("Fulham", 800, 9, 2, 10)]}]
    rows = rows_from_api_football(items)
    assert len(rows) == 1
    r = rows[0]
    assert r["c"] == "FUL"                    # most minutes
    assert r["min"] == 1100 and r["yc"] == 3  # counts summed


def test_ignores_non_pl_blocks_and_unknown_teams():
    items = [
        {"player": {"name": "Cup Only"},
         "statistics": [block("Arsenal", 200, 3, 1, 2, league=48)]},
        {"player": {"name": "Unknown Club"},
         "statistics": [block("Real Madrid", 500, 6, 1, 5)]},
        {"player": {"name": "Unused Sub"},
         "statistics": [block("Chelsea", 0, 0, 0, 0)]},
    ]
    assert rows_from_api_football(items) == []

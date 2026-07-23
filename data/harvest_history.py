#!/usr/bin/env python3
"""
Harvest per-match booking outcomes for the model fit (Tier 2).

The FPL element-summary endpoint is public (no login) and returns each player's
per-gameweek history. This builds a leakage-free training table: for every match
a player actually played, the FEATURES are his form *before* that match and the
LABEL is whether he was booked *in* it.

  python3 data/harvest_history.py            # current season
  python3 data/harvest_history.py --season-past   # use last completed season's history_past

Writes data/match_history.json (gitignored), a list of rows:
  {round, name, pos, yc90, foul90, y}
where
  yc90   cumulative yellows / cumulative 90s BEFORE this match (no leakage)
  foul90 the player's season fouls-per-90 from data/pl_data.js (FPL has no fouls)
  pos    GK/DF/MF/FW
  y      1 if booked in this match, else 0

Then fit:  node scripts/build-model.mjs --fit data/match_history.json
And backtest:  node scripts/backtest.mjs

Run this where the FPL API is reachable (a normal machine or the data-refresh
Action) — it is not reachable from every sandbox.
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
BASE = "https://fantasy.premierleague.com/api"
POS = {1: "GK", 2: "DF", 3: "MF", 4: "FW"}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def norm(s):
    s = (s or "").lower()
    out = []
    for ch in s:
        if "a" <= ch <= "z":
            out.append(ch)
        elif ch.strip() == "":
            out.append(" ")
        else:
            out.append(" ")
    return " ".join("".join(out).split())


def foul_map():
    """name -> fouls/90 from the shipped season data (FPL carries no fouls)."""
    src = (DATA / "pl_data.js").read_text(encoding="utf-8")
    m = {}
    for mt in re.finditer(r'\{c:"[^"]+",n:"((?:[^"\\]|\\.)*)"[^}]*?,f:([0-9.]+|null)', src):
        name, f = mt.group(1), mt.group(2)
        if f != "null":
            m[norm(name)] = float(f)
    return m


def main():
    use_past = "--season-past" in sys.argv
    print("Fetching bootstrap-static…")
    boot = get(f"{BASE}/bootstrap-static/")
    fouls = foul_map()
    league_foul = (sum(fouls.values()) / len(fouls)) if fouls else 1.0
    rows = []
    elements = [e for e in boot["elements"] if (e.get("minutes") or 0) > 0]
    print(f"{len(elements)} players with minutes — pulling per-match history…")
    for i, el in enumerate(elements):
        if i % 50 == 0:
            print(f"  {i}/{len(elements)}")
        try:
            summ = get(f"{BASE}/element-summary/{el['id']}/")
        except Exception as e:
            print(f"  skip {el.get('web_name')}: {e}")
            continue
        pos = POS.get(el.get("element_type"), "")
        nm = norm((el.get("first_name") or "") + " " + (el.get("second_name") or ""))
        f90 = fouls.get(nm)
        if f90 is None:
            f90 = fouls.get(norm(el.get("web_name")), league_foul)
        hist = summ.get("history_past" if use_past else "history", []) or []
        cum_yc, cum_min = 0, 0
        for h in sorted(hist, key=lambda x: x.get("round", x.get("season_name", 0))):
            mins = h.get("minutes") or 0
            if mins <= 0:
                continue
            y90 = (cum_yc / (cum_min / 90.0)) if cum_min > 0 else 0.0
            rows.append({
                "round": h.get("round", 0), "name": el.get("web_name"), "pos": pos,
                "yc90": round(y90, 4), "foul90": round(f90, 4),
                "y": 1 if (h.get("yellow_cards") or 0) > 0 else 0,
            })
            cum_yc += h.get("yellow_cards") or 0
            cum_min += mins
    (DATA / "match_history.json").write_text(json.dumps(rows), encoding="utf-8")
    booked = sum(r["y"] for r in rows)
    print(f"match_history.json written: {len(rows)} match rows, "
          f"{booked} booked ({(100*booked/len(rows) if rows else 0):.1f}%).")
    print("Next: node scripts/build-model.mjs --fit data/match_history.json && node scripts/backtest.mjs")


if __name__ == "__main__":
    main()

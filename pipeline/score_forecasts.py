#!/usr/bin/env python3
"""Log matchday forecasts and score them against results.

Two subcommands:

  log [--mw N]   Freeze P(card) for every player in every fixture of
                 matchweek N (default: the next matchweek with a future
                 kickoff) into pipeline/store/forecast_log.json. Re-logging
                 before kickoff overwrites (team news, ref announcements);
                 after kickoff the entry is immutable.

  score          Join the log with sources/results.json, settle outcomes,
                 and write pipeline/store/forecast_scores.json (Brier score,
                 calibration bins, per-matchweek table) which
                 build_dataset.py embeds into app-data.js.

The point: the model's published probabilities are frozen *before* games and
scored *after*, so the Model tab reports real forecast accuracy, not
hindsight.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import model

PIPE = Path(__file__).resolve().parent
SRC = PIPE / "sources"
STORE = PIPE / "store"
LOG = STORE / "forecast_log.json"
SCORES = STORE / "forecast_scores.json"


def load(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_ko(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def build_context():
    """Player model parameters exactly as the app ships them."""
    import build_dataset
    prior = load(SRC / "players_2526.json", [])
    current = load(SRC / "players_current.json", {"players": [], "as_of_matchday": 0})
    players = build_dataset.build_players(prior, current)
    refs = load(SRC / "refs_2526.json", [])
    fixtures = load(SRC / "fixtures.json", {"fixtures": []})["fixtures"]
    appts = load(SRC / "ref_appointments.json", {"appointments": {}})["appointments"]
    derbies = load(SRC / "derbies.json", {"derbies": []})["derbies"]
    avg = build_dataset.league_avg_ypg(refs)
    return players, refs, fixtures, appts, derbies, avg


def derby_factor(derbies, home, away):
    for d in derbies:
        if set(d["pair"]) == {home, away}:
            return d.get("factor", 1.0)
    return 1.0


def forecast_fixture(fx, players, refs, appts, derbies, avg):
    ref_name = appts.get(fx["id"])
    ref = next((r for r in refs if r["n"] == ref_name), None)
    rf = model.ref_factor(ref["ypg"] if ref else None, avg)
    df = derby_factor(derbies, fx["home"], fx["away"])
    rows = []
    for side, venue_f in ((fx["home"], model.HOME_FACTOR), (fx["away"], model.AWAY_FACTOR)):
        for p in players:
            if p["c"] != side:
                continue
            lam = model.card_lambda(p["ys"], p["em"], rf, 1.0, venue_f, df)
            rows.append({
                "fixture_id": fx["id"], "mw": fx["mw"], "kickoff": fx["kickoff"],
                "club": p["c"], "player": p["n"],
                "p": round(model.p_card(lam), 4),
                "ref": ref_name, "logged_at": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
    return rows


def cmd_log(mw: int | None):
    players, refs, fixtures, appts, derbies, avg = build_context()
    if mw is None:
        future = [f for f in fixtures if parse_ko(f["kickoff"]) > now_utc()]
        if not future:
            print("no future fixtures known; nothing to log")
            return
        mw = min(f["mw"] for f in future)
    target = [f for f in fixtures if f["mw"] == mw]
    if not target:
        print(f"no fixtures known for matchweek {mw}")
        return

    log = load(LOG, {"forecasts": []})
    kept = []
    frozen_keys = set()
    for e in log["forecasts"]:
        started = parse_ko(e["kickoff"]) <= now_utc()
        if e["mw"] == mw and not started:
            continue  # replaced by this run
        kept.append(e)
        if e["mw"] == mw and started:
            frozen_keys.add((e["fixture_id"], e["player"]))

    added = 0
    for fx in target:
        if parse_ko(fx["kickoff"]) <= now_utc():
            continue  # never (re)log a started game
        for row in forecast_fixture(fx, players, refs, appts, derbies, avg):
            if (row["fixture_id"], row["player"]) in frozen_keys:
                continue
            kept.append(row)
            added += 1

    STORE.mkdir(exist_ok=True)
    LOG.write_text(json.dumps({"forecasts": kept}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    print(f"logged {added} forecasts for matchweek {mw} "
          f"({len(kept)} total in log)")


def cmd_score():
    log = load(LOG, {"forecasts": []})["forecasts"]
    results = load(SRC / "results.json", {"matches": []})["matches"]
    if not log:
        print("forecast log is empty; nothing to score")
    by_fixture = {m["fixture_id"]: m for m in results}

    scored = []
    for e in log:
        m = by_fixture.get(e["fixture_id"])
        if not m:
            continue
        booked = m.get("booked", [])
        hit = any(model.names_match(e["player"], b) for b in booked)
        scored.append({**e, "outcome": 1 if hit else 0})

    fcs = [model.Forecast(p=s["p"], outcome=s["outcome"]) for s in scored]
    by_mw = {}
    for s in scored:
        by_mw.setdefault(s["mw"], []).append(
            model.Forecast(p=s["p"], outcome=s["outcome"]))

    out = {
        "n": len(fcs),
        "brier": round(model.brier(fcs), 4) if fcs else None,
        "bins": model.calibration_bins(fcs),
        "by_mw": [{"mw": mw, "n": len(v), "brier": round(model.brier(v), 4)}
                  for mw, v in sorted(by_mw.items())],
        "scored_at": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    STORE.mkdir(exist_ok=True)
    SCORES.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"scored {out['n']} forecasts, brier={out['brier']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    lg = sub.add_parser("log", help="freeze forecasts for a matchweek")
    lg.add_argument("--mw", type=int, default=None)
    sub.add_parser("score", help="score logged forecasts against results")
    args = ap.parse_args()
    if args.cmd == "log":
        cmd_log(args.mw)
    else:
        cmd_score()


if __name__ == "__main__":
    main()

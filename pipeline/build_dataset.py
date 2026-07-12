#!/usr/bin/env python3
"""Build app-data.js for the Premier League Bookings Desk.

Reads pipeline/sources/*.json (last-season baseline, in-season stats,
fixtures, referee appointments, derbies) plus pipeline/store/ scoring
output, runs the blending + shrinkage model, and writes ../app-data.js —
the single generated artefact the static site loads.

Run:  python3 pipeline/build_dataset.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import model

PIPE = Path(__file__).resolve().parent
SRC = PIPE / "sources"
STORE = PIPE / "store"
OUT = PIPE.parent / "app-data.js"

LOW_MIN = 450          # display flag only; the model no longer needs it
PL_POSSIBLE = 38 * 90.0
EFL_POSSIBLE = 46 * 90.0


def read(name: str, default=None):
    p = SRC / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def read_store(name: str, default=None):
    p = STORE / name
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def build_players(prior_players: list[dict], current: dict) -> list[dict]:
    """Blend prior season into current season and attach model parameters.

    Pre-season (no current data) every player runs on his prior alone.
    In-season, the current harvest defines the squad list and the prior is
    joined by (club, name); departures drop out, new signings run on
    shrinkage until they build minutes.
    """
    cur_players = current.get("players") or []
    as_of_md = current.get("as_of_matchday") or 0

    # Defensive dedupe on (club, name): the 2025-26 Championship harvest
    # shipped each promoted-club player 12 times. Keep the first row.
    def dedupe(rows):
        seen, out = set(), []
        for r in rows:
            k = (r.get("c"), r.get("n"))
            if k in seen:
                continue
            seen.add(k)
            out.append(r)
        return out

    prior_players = dedupe(prior_players)
    cur_players = dedupe(cur_players)

    # Shrinkage priors come from the big, stable last-season PL pool.
    pool = [p for p in prior_players if p.get("b") == "PL"]
    y_priors = model.position_priors(pool, "yc")
    f_priors = model.position_priors(
        [dict(p, fls=(p["f"] or 0) * (p["min"] or 0) / 90.0) for p in pool], "fls")

    prior_by_key = {(p["c"], p["n"]): p for p in prior_players}

    if cur_players:
        base = cur_players
        season_possible = max(90.0, as_of_md * 90.0)
    else:
        base = prior_players
        season_possible = None  # use each prior's own basis

    out = []
    for p in base:
        prior = p if not cur_players else prior_by_key.get((p["c"], p["n"]))
        cur_min = p["min"] if cur_players else 0.0
        cur_yc = (p.get("yc") or 0) if cur_players else 0.0
        cur_fouls = ((p.get("f") or 0) * (p.get("min") or 0) / 90.0) if cur_players else 0.0

        pr_min = (prior.get("min") or 0) if prior else 0.0
        pr_yc = (prior.get("yc") or 0) if prior else 0.0
        pr_fouls = ((prior.get("f") or 0) * pr_min / 90.0) if prior else 0.0
        pr_cap = (model.PRIOR_CAP_MINUTES_EFL if (prior and prior.get("b") == "EFL")
                  else model.PRIOR_CAP_MINUTES_PL)

        yc_e, yc_m = model.blend_seasons(cur_yc, cur_min, pr_yc, pr_min, pr_cap)
        fl_e, fl_m = model.blend_seasons(cur_fouls, cur_min, pr_fouls, pr_min, pr_cap)

        pos = p.get("p") or ""
        ys = model.shrink_rate_per90(yc_e, yc_m, y_priors.get(pos, y_priors[""]))
        fs = model.shrink_rate_per90(fl_e, fl_m, f_priors.get(pos, f_priors[""]))

        if p.get("apps"):
            # real appearance data (API-Football) beats the share heuristic
            em = model.expected_minutes_from_apps(p.get("min") or 0, p["apps"])
        else:
            possible = season_possible if season_possible is not None else (
                EFL_POSSIBLE if p.get("b") == "EFL" else PL_POSSIBLE)
            em = model.expected_minutes(p.get("min") or 0, possible)

        row = {
            "c": p["c"], "n": p["n"], "p": pos,
            "min": int(p.get("min") or 0),
            "yc": p.get("yc"), "rc": p.get("rc"),
            "y": p.get("y"), "f": p.get("f"), "r": p.get("r"),
            "ls": bool((p.get("min") or 0) < LOW_MIN), "b": p.get("b", "PL"),
            # model parameters
            "ys": round(ys, 4), "fs": round(fs, 4),
            "rs": round(ys * 2 + fs, 3),
            "em": round(em, 1),
            # current-season yellows, drives the suspension watch
            "syc": int(cur_yc) if cur_players else 0,
        }
        out.append(row)
    return out


def league_avg_ypg(refs: list[dict]) -> float:
    num = den = 0.0
    for r in refs:
        if r.get("ypg") is not None and r.get("matches"):
            num += r["ypg"] * r["matches"]
            den += r["matches"]
    return round(num / den, 3) if den else 3.6


def main():
    prior_players = read("players_2526.json", [])
    clubs = read("clubs_2526.json", [])
    refs = read("refs_2526.json", [])
    fixtures = read("fixtures.json", {"fixtures": []})
    appointments = read("ref_appointments.json", {"appointments": {}})
    derbies = read("derbies.json", {"derbies": []})
    current = read("players_current.json", {"players": [], "as_of_matchday": 0})
    results = read("results.json", {"matches": []})["matches"]
    lineups = read("lineups.json", {"lineups": {}})["lineups"]
    scores = read_store("forecast_scores.json", None)

    players = build_players(prior_players, current)

    # "carded in X of the club's last N games" evidence windows
    results = sorted(results, key=lambda m: (m["mw"], m["fixture_id"]))
    by_club: dict[str, list[dict]] = {}
    for m in results:
        by_club.setdefault(m["home"], []).append(m)
        by_club.setdefault(m["away"], []).append(m)
    for p in players:
        ms = by_club.get(p["c"])
        if ms:
            hits, n = model.recent_club_hits(ms, p["n"])
            p["h10"] = [hits, n]

    # in-season referee hit rates (O4.5 cards, both teams carded)
    rates = model.ref_hit_rates(results)
    for r in refs:
        for raw, d in rates.items():
            if model.names_match(r["n"], raw):
                r["sn"], r["o45"], r["btc"] = d["n"], d["o45"], d["btc"]
                break

    sims = read("sim_predictions.json", {"fixtures": {}})["fixtures"]
    for fx in fixtures["fixtures"]:
        ref = appointments.get("appointments", {}).get(fx["id"])
        fx["ref"] = ref or None
        sim = sims.get(fx["id"])
        if sim:
            fx["gs"] = {"home": round(model.chase_factor(sim.get("home_win")), 3),
                        "away": round(model.chase_factor(sim.get("away_win")), 3)}

    data = {
        "meta": {
            "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "season": fixtures.get("season", "2026-27"),
            "as_of_matchday": current.get("as_of_matchday") or 0,
            "league_avg_ypg": league_avg_ypg(refs),
            "players": len(players),
            "fixtures_known": len(fixtures["fixtures"]),
            "model": {
                "home_factor": model.HOME_FACTOR,
                "away_factor": model.AWAY_FACTOR,
                "ref_factor_min": model.REF_FACTOR_MIN,
                "ref_factor_max": model.REF_FACTOR_MAX,
                "shrink_pseudo_minutes": model.SHRINK_PSEUDO_MINUTES,
                "prior_cap_pl": model.PRIOR_CAP_MINUTES_PL,
                "prior_cap_efl": model.PRIOR_CAP_MINUTES_EFL,
            },
        },
        "clubs": clubs,
        "players": players,
        "refs": refs,
        "fixtures": fixtures["fixtures"],
        "derbies": derbies["derbies"],
        "lineups": lineups,
        # last ~2 matchweeks of finished games; the tracker auto-settles
        # picks made from fixture cards against these booked lists
        "results": [{"fixture_id": m["fixture_id"], "mw": m["mw"],
                     "score": m.get("score"), "booked": m.get("booked", [])}
                    for m in results[-20:]],
        "eval": scores or {"n": 0, "brier": None, "bins": [], "by_mw": []},
    }

    OUT.write_text(
        "// Generated by pipeline/build_dataset.py — do not edit by hand.\n"
        "window.DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8")
    print(f"app-data.js: {OUT.stat().st_size/1024:.1f} KB, "
          f"{len(players)} players, {len(fixtures['fixtures'])} fixtures, "
          f"matchday {data['meta']['as_of_matchday']}, "
          f"eval n={data['eval']['n']}")


if __name__ == "__main__":
    main()

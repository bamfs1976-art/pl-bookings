#!/usr/bin/env python3
"""Why the Championship lost every player photograph, and where to get them back.

  python3 scripts/probe-photos.py

WHAT HAPPENED. data/eflc_data.js went from 575 photographs in 763 rows to 126
in 761, in one data refresh, and check-booked.mjs then failed the fixtures
workflow because only 15 of 85 booked players had a face. Broken down by the
basis each row was built on, the loss is total and confined to one source:

    before   EFLC 445/445   L1 66/66   PL 64/64   NEW 0/188
    after    EFLC   0/403   L1 66/66   PL 60/60   NEW 0/232

The Premier League, La Liga and Serie A datasets were rebuilt by the same run
and did not lose a single photograph.

THE ONE THING THAT WAS DIFFERENT. scripts/form-season.mjs flips a division's
form season to the CURRENT one once six rounds have been played, because a
player's own record only beats the positional prior at about that point. The
Championship reached round 6 that morning and flipped, alone:

    Premier League   round 3   form 2025-26
    EFL Championship round 6   form 2026-27   <- flipped
    La Liga          round 5   form 2025-26
    Serie A          round 3   form 2025-26

So the Championship harvest asked /players for season 2026 while every other
desk still asked for 2025, and the Championship is the only desk that lost its
faces. That is a strong correlation and not yet a cause, which is what this
settles.

THIS IS NOT AN EFL PROBLEM. La Liga is at round 5. It flips next round, and
Serie A and the Premier League follow. Whatever answer comes back here applies
to all four within weeks.

THE THREE QUESTIONS, in three calls:

  1. Does /players carry player.photo for the CURRENT season?
  2. Does it carry it for the COMPLETED season, where we know it used to?
  3. Does /players/squads carry it? That endpoint takes no season at all, is
     already called once per club by the roster harvest, and already has its
     answer thrown away in emit_roster. If it carries photographs then the fix
     costs no extra calls and cannot be broken by a season flip again.

It writes nothing, commits nothing and always exits 0: a diagnostic that can
fail a workflow is a diagnostic somebody disables.

Needs API_FOOTBALL_KEY. Runs where the API is reachable, which is a GitHub
runner rather than a development container behind an egress proxy.
"""

import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
sys.path.insert(0, str(DATA))
import harvest_apifootball as af  # noqa: E402

EFLC_LEAGUE = 40
COMPLETED, CURRENT = "2025", "2026"


def photo_rate(rows, get):
    """(with a photograph, total, one example) over a response's rows."""
    total = with_ph = 0
    example = None
    for r in rows:
        total += 1
        ph = get(r)
        if ph:
            with_ph += 1
            if example is None:
                example = ph
    return with_ph, total, example


def report(label, with_ph, total, example):
    if not total:
        print(f"  {label:34} no rows came back")
        return
    pct = 100.0 * with_ph / total
    print(f"  {label:34} {with_ph:>3} of {total:>3} ({pct:5.1f}%)"
          + (f"  e.g. {example}" if example else ""))


def main():
    key = af.env_or("API_FOOTBALL_KEY", "")
    if not key:
        print("API_FOOTBALL_KEY is not set, so nothing was asked. Not an error.")
        return 0
    host = af.env_or("API_FOOTBALL_HOST", af.DEFAULT_HOST)

    print("Championship photographs: which call still carries them")
    print(f"  host {host}, league {EFLC_LEAGUE}")

    team_id = None
    for season, tag in ((CURRENT, "CURRENT, the one that flipped"),
                        (COMPLETED, "COMPLETED, the one that worked")):
        payload = af._get(host, key, "players",
                          {"league": EFLC_LEAGUE, "season": season, "page": 1})
        errs = af.api_errors(payload)
        if errs:
            print(f"\n/players season {season} refused: {errs}")
            continue
        rows = (payload or {}).get("response") or []
        print(f"\n/players?season={season}   ({tag})")
        report("player.photo", *photo_rate(
            rows, lambda r: ((r or {}).get("player") or {}).get("photo")))
        # A team id for question 3, taken from a response already paid for.
        if team_id is None:
            for r in rows:
                for s in (r.get("statistics") or []):
                    tid = (s.get("team") or {}).get("id")
                    if tid:
                        team_id = tid
                        break
                if team_id:
                    break

    if team_id is None:
        print("\nNo team id came back, so /players/squads was not asked.")
    else:
        payload = af._get(host, key, "players/squads", {"team": team_id})
        errs = af.api_errors(payload)
        print(f"\n/players/squads?team={team_id}   (NO SEASON, one call a club)")
        if errs:
            print(f"  refused: {errs}")
        else:
            people = []
            for entry in ((payload or {}).get("response") or []):
                people.extend(entry.get("players") or [])
            report("photo", *photo_rate(people, lambda p: (p or {}).get("photo")))

    # 4. OUR OWN CHAIN, on a real team-scoped response, which is the call the
    #    harvest actually makes. The three answers above are about the feed;
    #    this one is about this repository. map_player turns a response row
    #    into the harvest file's shape and build_pl_data.mk turns that into a
    #    shipped player row, and a photograph has to survive both.
    if team_id is not None:
        import build_pl_data as B  # noqa: E402
        payload = af._get(host, key, "players",
                          {"team": team_id, "season": CURRENT, "page": 1})
        errs = af.api_errors(payload)
        print(f"\n/players?team={team_id}&season={CURRENT}   (THE CALL THE HARVEST MAKES)")
        if errs:
            print(f"  refused: {errs}")
        else:
            rows = (payload or {}).get("response") or []
            report("response player.photo", *photo_rate(
                rows, lambda r: ((r or {}).get("player") or {}).get("photo")))
            mapped = [m for m in
                      (af.map_player(r, "Probe FC", team_id) for r in rows)
                      if m]
            report("after map_player, photo", *photo_rate(
                mapped, lambda r: (r or {}).get("photo")))
            shipped = [B.mk(dict(m, team="Probe FC"), "EFLC", resolve=lambda _n: "PRB")
                       for m in mapped]
            shipped = [r for r in shipped if r]
            report("after mk(), ph", *photo_rate(
                shipped, lambda r: (r or {}).get("ph")))
            if mapped and not any(m.get("photo") for m in mapped):
                print("    => the loss is in map_player or the response, not the build")
            elif shipped and not any(r.get("ph") for r in shipped):
                print("    => the loss is in mk()")
            elif shipped:
                print("    => the chain preserves the photograph, so the loss is "
                      "further down: a source that did not harvest and fell back "
                      "to shipped_rows(), which does not carry ph")

    print("\nReading:")
    print("  If the current season is empty and the completed one is not, the")
    print("  season flip is the cause and every desk hits it at round 6.")
    print("  If /players/squads carries photographs, the roster harvest already")
    print("  being made is the source, at no extra cost and immune to the flip.")
    print("\nNothing was written.")
    af.report_usage()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:  # a diagnostic must not fail the workflow
        print(f"probe failed, which is not a build failure: {e!r}")
        sys.exit(0)

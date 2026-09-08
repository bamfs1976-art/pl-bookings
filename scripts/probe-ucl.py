#!/usr/bin/env python3
"""Does this API-Football subscription serve the Champions League?

  API_FOOTBALL_KEY=<key> python3 scripts/probe-ucl.py

THE ONE QUESTION docs/champions-league-feasibility.md is gated on. That note
costs a European desk at roughly 150 calls a day for squads plus a ~2,000-call
one-off backfill for referee rates, and every line of it assumes this plan can
see competition id 2 at all. If it cannot, the note ends and nothing should be
built.

IT WRITES NOTHING AND COMMITS NOTHING. Every call is a GET, and it spends about
six of them against a 7,500 allowance. It reuses harvest_apifootball's client
rather than carrying its own — same auth, same per-minute pacing, same
rate-limit backoff, and one place for the host to be wrong.

IT ALWAYS EXITS 0. A subscription that does not cover this competition is a
SUCCESSFUL probe: the answer was obtained. Exiting non-zero for it would mark
the run red and email the repository owner about a diagnostic that worked —
see the note on the same mistake in scripts/probe-source.mjs.

FOUR THINGS ARE ASKED, in the order they gate each other:

  1. FIXTURES. Does /fixtures?league=2 return a season at all? Everything else
     is moot if not.

  2. REFEREES, and WHEN. The desk's whole referee layer needs a name. A name
     that appears only after a match has been played is worth much less than
     one that appears before it — an appointment reprices a fixture, a record
     of who refereed it does not. So upcoming and finished fixtures are counted
     separately, because only the contrast distinguishes the two.

  3. STATISTICS. build_refs.py needs cards and FOULS per match to compute
     cards-per-foul, which is the de-contaminated strictness signal the desk
     ranks referees on. Yellow cards alone would not do.

  4. A SQUAD THE DESK DOES NOT HOLD. Porto and Inter are the two clubs from the
     reference cards that no desk covers. If /players refuses them, the ~150
     calls a day in §3 of the note buys nothing.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data"))

import harvest_apifootball as H     # noqa: E402

UCL = 2                             # API-Football's competition id
SEASON = int(os.environ.get("API_FOOTBALL_SEASON", "2026"))


def ask(host, key, path, params):
    payload = H._get(host, key, path, params)
    err = H.api_errors(payload)
    if err:
        print(f"    REFUSED: {err}")
        return None
    return payload


def main():
    key = os.environ.get("API_FOOTBALL_KEY", "").strip().strip('"').strip("'")
    if not key:
        # Not an error exit: the whole point is that the log says what happened.
        print("API_FOOTBALL_KEY is not set — nothing can be asked. "
              "Add it under Settings -> Secrets and variables -> Actions.")
        return
    host = H.env_or("API_FOOTBALL_HOST", H.DEFAULT_HOST)
    print(f"host: {host}   season: {SEASON}   competition: {UCL} (UCL)\n")

    # ---- 1. fixtures ------------------------------------------------------
    print("1. fixtures")
    fx = ask(host, key, "fixtures", {"league": UCL, "season": SEASON})
    if not fx:
        print("\nVERDICT: this subscription does not serve competition 2. "
              "docs/champions-league-feasibility.md ends here — nothing to "
              "build.")
        return
    rows = fx.get("response") or []
    print(f"    {len(rows)} fixture(s) returned")
    if not rows:
        print("\nVERDICT: the endpoint answers but the season is empty. Either "
              "the plan excludes this competition's data or the season number "
              "is wrong — try another with API_FOOTBALL_SEASON.")
        return

    clubs = set()
    for r in rows:
        for side in ("home", "away"):
            t = ((r.get("teams") or {}).get(side) or {})
            if t.get("name"):
                clubs.add(t["name"])
    print(f"    {len(clubs)} distinct club(s)")
    print(f"    e.g. {', '.join(sorted(clubs)[:8])}")

    # ---- 2. referees, before and after ------------------------------------
    print("\n2. referees")
    done, upcoming, done_ref, up_ref, names = 0, 0, 0, 0, []
    for r in rows:
        st = (((r.get("fixture") or {}).get("status") or {}).get("short") or "")
        ref = ((r.get("fixture") or {}).get("referee") or "").strip()
        if st in ("FT", "AET", "PEN"):
            done += 1
            if ref:
                done_ref += 1
                names.append(ref)
        elif st in ("NS", "TBD"):
            upcoming += 1
            if ref:
                up_ref += 1
                names.append(ref)
    pc = lambda n, d: f"{(100 * n / d):.0f}%" if d else "n/a"       # noqa: E731
    print(f"    finished  {done_ref}/{done} carry a referee ({pc(done_ref, done)})")
    print(f"    upcoming  {up_ref}/{upcoming} carry a referee ({pc(up_ref, upcoming)})")
    print(f"    {len(set(names))} distinct official(s)"
          + (f": {', '.join(sorted(set(names))[:6])}" if names else ""))
    if done and not done_ref:
        print("    NO REFEREE ON A PLAYED MATCH — the referee layer cannot be "
              "built from this feed at all.")
    elif upcoming and not up_ref:
        print("    Referees appear only AFTER the match. That is a record, not "
              "an appointment: it can build referee RATES but cannot reprice a "
              "fixture in advance. The RFEF/EFL overlay would still be needed "
              "for the appointment itself.")

    # ---- 3. cards AND fouls on a played match -----------------------------
    print("\n3. statistics on a finished match")
    played = [r for r in rows
              if (((r.get("fixture") or {}).get("status") or {}).get("short")
                  in ("FT", "AET", "PEN"))]
    if not played:
        print("    no finished fixture in this season yet — re-run once the "
              "competition has kicked off, or with an earlier season.")
    else:
        fid = (played[0].get("fixture") or {}).get("id")
        st = ask(host, key, "fixtures/statistics", {"fixture": fid})
        if st:
            wanted = {"yellow cards": None, "red cards": None, "fouls": None}
            for team in (st.get("response") or []):
                for s in (team.get("statistics") or []):
                    t = str(s.get("type") or "").lower()
                    if t in wanted and s.get("value") is not None:
                        wanted[t] = s.get("value")
            for k, v in wanted.items():
                print(f"    {k:14} {'present' if v is not None else 'ABSENT'}"
                      + (f"  (e.g. {v})" if v is not None else ""))
            if wanted["fouls"] is None:
                print("    NO FOULS — cards-per-foul cannot be computed, and "
                      "that is the signal the desk ranks referees on.")

    # ---- 4. a squad no desk holds -----------------------------------------
    print("\n4. a squad the desk does not hold")
    for name in ("Porto", "Inter"):
        hit = [c for c in clubs if name.lower() in c.lower()]
        if not hit:
            print(f"    {name}: not in this season's fixtures — skipped")
            continue
        tid = None
        for r in rows:
            for side in ("home", "away"):
                t = ((r.get("teams") or {}).get(side) or {})
                if t.get("name") == hit[0]:
                    tid = t.get("id")
            if tid:
                break
        pl = ask(host, key, "players", {"team": tid, "season": SEASON, "page": 1})
        if pl:
            n = len(pl.get("response") or [])
            pages = ((pl.get("paging") or {}).get("total")) or 1
            print(f"    {hit[0]}: {n} player(s) on page 1 of {pages}")

    print("\n" + (H.usage_line() or "the allowance headers said nothing"))
    print("\nprobe complete — nothing was written or committed.")


if __name__ == "__main__":
    main()

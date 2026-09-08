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
import leagues                      # noqa: E402

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
    #
    # THE MATCH SAMPLED MATTERS, and the first run of this got it wrong. It
    # took played[0] — the chronologically FIRST finished fixture, which in a
    # competition whose id covers the qualifying rounds is a July tie between
    # clubs like Atert Bissen and Ararat-Armenia. Statistical coverage on a
    # minor qualifier says nothing about coverage in the league phase, and
    # reading "ABSENT" off one of those is a false negative that would have
    # ended the feasibility note on a wrong answer.
    #
    # So: the LATEST finished fixtures, several of them, with the round printed
    # so the log says what was actually asked about.
    print("\n3. statistics on a finished match")
    played = [r for r in rows
              if (((r.get("fixture") or {}).get("status") or {}).get("short")
                  in ("FT", "AET", "PEN"))]
    played.sort(key=lambda r: str((r.get("fixture") or {}).get("date") or ""),
                reverse=True)
    if not played:
        print("    no finished fixture in this season yet — re-run once the "
              "competition has kicked off, or with an earlier season.")
    else:
        got_fouls = got_cards = False
        for r in played[:3]:
            fid = (r.get("fixture") or {}).get("id")
            rnd = (r.get("league") or {}).get("round") or "?"
            when = str((r.get("fixture") or {}).get("date") or "")[:10]
            tm = r.get("teams") or {}
            label = (f"{(tm.get('home') or {}).get('name')} v "
                     f"{(tm.get('away') or {}).get('name')}")
            print(f"    {when}  {rnd}  —  {label}")

            st = ask(host, key, "fixtures/statistics", {"fixture": fid})
            wanted = {"yellow cards": None, "red cards": None, "fouls": None}
            if st:
                for team in (st.get("response") or []):
                    for s in (team.get("statistics") or []):
                        t = str(s.get("type") or "").lower()
                        if t in wanted and s.get("value") is not None:
                            wanted[t] = s.get("value")
            for k, v in wanted.items():
                print(f"      statistics {k:14} "
                      + (f"present (e.g. {v})" if v is not None else "ABSENT"))
            if wanted["fouls"] is not None:
                got_fouls = True
            if wanted["yellow cards"] is not None:
                got_cards = True

            # AND THE OTHER ROUTE TO A CARD. extra-feeds.yml already buys
            # /events per finished match, and a card is an EVENT before it is a
            # statistic — so statistics being thin does not by itself mean the
            # cards are unavailable. Fouls have no such second source, which is
            # why they are the binding constraint.
            ev = ask(host, key, "fixtures/events", {"fixture": fid})
            if ev is not None:
                cards = [e for e in (ev.get("response") or [])
                         if str(e.get("type") or "").lower() == "card"]
                print(f"      events     {len(cards)} card event(s)")
                if cards:
                    got_cards = True

        print()
        if got_fouls:
            print("    FOULS ARE AVAILABLE — cards-per-foul can be computed, "
                  "which is the signal the desk ranks referees on.")
        else:
            print("    NO FOULS on any of the sampled matches. Cards-per-foul "
                  "cannot be computed from this feed, so a European referee "
                  "record could rank on yellows per game only — a weaker "
                  "signal, and one the desk deliberately moved away from "
                  "because it does not separate a strict referee from a busy "
                  "match. See docs/champions-league-feasibility.md §4.")
        if not got_cards:
            print("    AND NO CARDS EITHER, from statistics or events — there "
                  "is no referee record to build here at all.")

    # ---- 4. a squad no desk holds -----------------------------------------
    #
    # MATCHED PROPERLY. The first run asked for "Inter" and was answered about
    # Inter Club d'Escaldes, an Andorran side in the qualifying rounds — a
    # substring match across 81 clubs spanning the whole of UEFA. The names are
    # spelled out, and every candidate that matches is printed so a wrong one
    # is visible rather than reported as a finding.
    print("\n4. a squad the desk does not hold")
    for name in ("FC Porto", "Inter Milan"):
        hit = [c for c in clubs if c.lower() == name.lower()]
        if not hit:
            near = [c for c in clubs
                    if name.split()[-1].lower() in c.lower()]
            print(f"    {name}: no exact match in this season's fixtures"
                  + (f" (near: {', '.join(sorted(near)[:4])})" if near else "")
                  + " — skipped")
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

    # ---- 5. what the desk already covers, and what it would cost ----------
    #
    # STEP 2 OF THE NOTE, and it spends nothing: the fixture list is already in
    # hand, so this is arithmetic on a response that has been paid for.
    #
    # Matched accent-insensitively against the names each league's BUILDER keys
    # on — leagues.known_names, not a fresh list — because that is the set a
    # squad has to land in to be usable. The La Liga note learned this the hard
    # way: two canonicalisers gave two answers and a club ended up with no
    # squad and no error.
    print("\n5. coverage against the desks, and the cost of the gap")

    rounds = {}
    for r in rows:
        rounds[(r.get("league") or {}).get("round") or "?"] = \
            rounds.get((r.get("league") or {}).get("round") or "?", 0) + 1
    print("    rounds in this season:")
    for rnd, n in sorted(rounds.items(), key=lambda kv: -kv[1]):
        print(f"      {n:>4}  {rnd}")

    # The LEAGUE PHASE is the part a desk would price. The qualifiers are 60-odd
    # clubs that mostly go out in July and are not what anyone previews.
    phase = [r for r in rows
             if any(w in str((r.get("league") or {}).get("round") or "").lower()
                    for w in ("league", "group"))]
    phase_clubs = set()
    for r in phase:
        for side in ("home", "away"):
            t = ((r.get("teams") or {}).get(side) or {})
            if t.get("name"):
                phase_clubs.add(t["name"])
    scope = phase_clubs or clubs
    print(f"\n    {len(phase)} league-phase fixture(s), {len(phase_clubs)} club(s)"
          if phase else
          f"\n    no league-phase fixture yet — costing against all "
          f"{len(clubs)} clubs in the season, which OVERSTATES it")

    held = set()
    for code in ("PL", "EFLC", "LL"):
        try:
            held |= set(H.known_names(code) or [])
        except Exception as e:                                  # noqa: BLE001
            print(f"    (could not read {code}'s club list: {e})")
    flat = {leagues.strip_accents(n).lower() for n in held}

    covered, missing = [], []
    for c in sorted(scope):
        key = leagues.strip_accents(c).lower()
        # The feed's spelling is not the builder's. Try the alias tables the
        # repo already keeps before calling a club missing.
        alt = {key}
        for code in ("PL", "EFLC", "LL"):
            try:
                canon = H.canonical_for(code, c)
                if canon:
                    alt.add(leagues.strip_accents(canon).lower())
            except Exception:                                   # noqa: BLE001
                pass
        (covered if alt & flat else missing).append(c)

    print(f"    covered by a desk : {len(covered)}"
          + (f"  ({', '.join(covered[:8])}{'...' if len(covered) > 8 else ''})"
             if covered else ""))
    print(f"    NOT held          : {len(missing)}")
    for c in missing[:40]:
        print(f"      {c}")
    if len(missing) > 40:
        print(f"      ... and {len(missing) - 40} more")

    # AND HOW MANY TIES ARE ALREADY PRICEABLE. The note asserted zero, reasoning
    # that UEFA does not pair clubs from the same country. That reasoning does
    # not hold: it forbids ENGLAND v ENGLAND, not England v Spain, and both of
    # those sides are held. Counted rather than argued.
    cov = set(covered)
    both = [r for r in phase
            if ((r.get("teams") or {}).get("home") or {}).get("name") in cov
            and ((r.get("teams") or {}).get("away") or {}).get("name") in cov]
    print(f"\n    league-phase ties with BOTH sides held: {len(both)}"
          f" of {len(phase)}")
    for r in both[:10]:
        tm = r.get("teams") or {}
        print(f"      {(tm.get('home') or {}).get('name')} v "
              f"{(tm.get('away') or {}).get('name')}"
              f"   ({(r.get('league') or {}).get('round')})")
    if len(both) > 10:
        print(f"      ... and {len(both) - 10} more")
    if not both:
        print("      none — so nothing is priceable until the squads land")

    # The cost, in the same unit data/api_budget.py reports: season form is
    # 360 calls a day for 64 clubs across three desks, ~5.6 a club.
    per_club = 360 / 64
    print(f"\n    season form for {len(missing)} missing club(s) "
          f"= {round(len(missing) * per_club)} calls a day "
          f"(at the measured {per_club:.1f} a club)")
    print(f"    today's usage so far: {H.usage_line() or 'unknown'}")

    print("\n" + (H.usage_line() or "the allowance headers said nothing"))
    print("\nprobe complete — nothing was written or committed.")


if __name__ == "__main__":
    main()

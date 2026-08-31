#!/usr/bin/env python3
"""
The dates the league fixture list cannot see: cups and Europe.

WHY THIS EXISTS. data/pl_fixtures.js holds 380 records — thirty-eight per club,
rounds 1 to 38, no competition field. Rest days computed from it alone are not
rest days, they are days since the last LEAGUE match, and the difference is the
whole point: a side that played in Thessaloniki on the Thursday and at home on
the Sunday reads as seven days' rest.

Measured on the 2025-26 record, league dates alone put 74.2% of team-fixtures
in the "fresh" bucket (six or more days) and 11.4% in "congested" (three or
fewer). Three-quarters fresh is not a football season. The mis-labelling is not
random either — it lands on exactly the clubs playing midweek in Europe, which
are the clubs a fatigue factor is about. Testing the factor on league-only
dates would push the measured effect toward zero and then record the null as a
finding.

WHAT IT FETCHES. Dates and venues only — no results, no lineups, no players.
Five competitions an English club can be pulled into midweek, and nothing else.

WHAT IT DOES NOT DO. It does not enter the LEAGUES registry. That registry
carries desk semantics — a suspension ladder, a referee source, a minimum
sample before a referee is priced — and none of it means anything for a cup
run. A competition here is three fields and no opinions.

  python3 data/harvest_other_fixtures.py --season 2026
  python3 data/harvest_other_fixtures.py --season 2025 --out pl_other_fixtures_2526.js

Writes data/pl_other_fixtures.js: {c, d, comp, v} per club per fixture, where
`v` is "H" or "A" — the away leg is what the 72-hour European flag needs.

Needs API_FOOTBALL_KEY. Runs where the API is reachable: the refresh workflow,
not a dev container behind an egress proxy.
"""
import argparse
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data  # noqa: E402
import harvest_apifootball as af  # noqa: E402
import uefa_league_phase  # noqa: E402

# API-Football league ids. Europe first, then the two domestic cups.
#
# The Europa Conference League was renamed the UEFA Conference League in 2024
# and kept its id; the id is what this keys on, so the rename costs nothing.
COMPETITIONS = [
    (2, "UCL"),      # Champions League
    (3, "UEL"),      # Europa League
    (848, "UECL"),   # Conference League
    (45, "FAC"),     # FA Cup
    (48, "EFLC"),    # EFL Cup — the League Cup, not the Championship
]

# The EFL Cup's code collides with the Championship's league code everywhere
# else in this project. Renamed on the way out so nothing downstream can read a
# midweek cup tie as a second-tier league fixture.
COMP_OUT = {"EFLC": "LCUP"}


def english_short(name):
    """An English club name as a short code, or None for everyone else.

    THE UNION OF BOTH ENGLISH MAPS, not the Premier League's alone. The first
    version used only build_pl_data.SHORT, which is the 2026-27 twenty — so
    harvesting the 2025-26 season silently dropped West Ham, Burnley and
    Wolves, who were in the division that year and have since gone down. Their
    cup dates simply did not exist, which reads in the backtest as three clubs
    that never played midweek. It is the same trap known_names() in
    harvest_apifootball exists for: neither list is complete alone.

    A Champions League response is still full of clubs this project has no
    opinion about, and they resolve to None as before.
    """
    maps = (build_pl_data.SHORT, build_pl_data.leagues.EFLC_CLUBS)
    raw = (name or "").strip()
    for m in maps:
        if raw in m:
            return m[raw]
    known = set(build_pl_data.SHORT) | set(build_pl_data.leagues.EFLC_CLUBS)
    canon = build_pl_data.leagues.canonical_club(name, known)
    for m in maps:
        if canon in m:
            return m[canon]
    return None


def canonical_name_for(short):
    """A short code as the name every English builder keys on."""
    rev = {v: k for k, v in build_pl_data.SHORT.items()}
    rev.update({v: k for k, v in build_pl_data.leagues.EFLC_CLUBS.items()
                if v not in rev})
    return rev.get(short, short)


def rows_for(host, key, comp_id, comp_code, season):
    """Every fixture in one competition-season that involves a PL club."""
    payload = af._get(host, key, "fixtures", {"league": str(comp_id), "season": season})
    err = af.api_errors(payload)
    if err:
        # A plan that does not cover a competition is not the same as a
        # competition with no English clubs in it, and the difference decides
        # whether the rest days are trustworthy — so it is returned, not
        # swallowed.
        return None, f"{comp_code}: {err}"
    rows, page, pages = [], 1, af.pages_needed(payload)
    seen_clubs, names = set(), {}
    while True:
        for entry in (payload.get("response") or []):
            fx = (entry or {}).get("fixture") or {}
            teams = (entry or {}).get("teams") or {}
            when = fx.get("date")
            if not when:
                continue
            for side, venue in (("home", "H"), ("away", "A")):
                raw = ((teams.get(side) or {}).get("name"))
                short = english_short(raw)
                if not short:
                    continue
                seen_clubs.add(short)
                # THE CANONICAL NAME, not the feed's. API-Football says "Man
                # City"; the match record the backtest walks says "Manchester
                # City", and a bridge built from the feed's spelling would
                # join nothing. canonical_name_for reverses the same maps
                # english_short resolved through.
                names[short] = names.get(short) or canonical_name_for(short)
                rows.append({"c": short, "d": when,
                             "comp": COMP_OUT.get(comp_code, comp_code), "v": venue})
        if page >= pages:
            break
        page += 1
        payload = af._get(host, key, "fixtures",
                          {"league": str(comp_id), "season": season, "page": page})
        pages = max(pages, af.pages_needed(payload))
    return (rows, names), f"{comp_code}: {len(rows)} ties, {len(seen_clubs)} English club(s)"


def placeholder_keys(rows):
    """The (club, kick-off) slots that are a draw-pending placeholder.

    A club cannot play two matches at the same instant. When API-Football
    has the pairings but not the calendar it stamps every league-phase tie
    with one slot, so a club comes back with six or eight rows on a single
    kick-off, split home and away. Every date in that block is wrong, and
    rest days computed from it read as one pile-up and an empty autumn.

    Detected on the impossibility rather than on a date heuristic, so a
    genuine matchday where several English clubs kick off together is
    never mistaken for one.

    KEYED ON THE SLOT, NOT THE CLUB, which is the correction that matters.
    Brighton's Conference League rows are two real play-off legs in August
    followed by a six-row league-phase block in October; condemning the
    whole club would throw away two ties that were never in doubt.
    """
    seen, bad = {}, set()
    for r in rows:
        key = (r["c"], r["d"])
        if key in seen:
            bad.add(key)
        seen[key] = True
    return bad


def apply_league_phase_override(rows, comp_code, season):
    """Replace a placeholder block with UEFA's published calendar.

    Returns (rows, note). Three outcomes, and the note says which:
      - no placeholder            → rows unchanged
      - placeholder, curated      → the affected clubs' rows are replaced
      - placeholder, not curated  → the affected clubs' rows are DROPPED

    Dropping is the right answer for the third case and worth stating
    plainly: the block carries no information beyond "this club is in this
    competition", and leaving it in means every downstream consumer has to
    recognise and strip it. One of them did not, and shipped fabricated
    congestion to production.
    """
    bad = placeholder_keys(rows)
    if not bad:
        return rows, None
    kept = [r for r in rows if (r["c"], r["d"]) not in bad]
    clubs = {c for c, _ in bad}
    curated = [r for r in uefa_league_phase.rows_for(season, comp_code)
               if r["c"] in clubs]
    who = ", ".join(sorted(clubs))
    if curated:
        return kept + curated, (
            f"{comp_code}: placeholder block for {who} replaced with "
            f"{len(curated)} UEFA league-phase rows")
    return kept, (
        f"{comp_code}: placeholder block for {who} DROPPED — "
        f"API-Football has the draw but not the calendar, and nothing is "
        f"curated in uefa_league_phase.py for {season} {comp_code}")


def const_name(out):
    """The global this file declares, derived from its own filename.

    Both seasons are emitted by the same code, and the first version gave both
    the same name — so loading the live file and the backtest file in one page
    would have been "Identifier 'PL_OTHER_FIXTURES' has already been declared",
    which is a blank page rather than a wrong number. This project has shipped
    that exact collision once already.
    """
    stem = out.rsplit(".", 1)[0]
    return stem.upper().replace("-", "_")


def drop_placeholder_dates(rows):
    """Remove fixtures whose date is the round's placeholder, not a kick-off.

    A CLUB CANNOT PLAY TWICE IN THE SAME COMPETITION ON THE SAME DAY. That is
    not a heuristic, it is the calendar, and it is the only signal available
    here that a date is a placeholder rather than a fixture.

    WHAT THIS CAUGHT. The 2026-27 European league phase was drawn in late
    August and the fixture list published shortly after. Between the two, the
    feed carried every Europa League and Conference League tie stamped with
    matchday one's date — so this harvest wrote eight Bournemouth matches on
    16 September, eight for Crystal Palace, eight for Sunderland and six
    Brighton ties on 15 October. The Champions League, whose calendar was
    already confirmed, came through correctly.

    Nothing about the bad rows looked wrong. The count was right (three clubs
    times eight), the venues were right and split four home and four away, and
    the competition codes were right. Only the dates were fiction — and dates
    are the entire point of this file, which exists so that rest days are days
    since the last COMPETITIVE match. Eight European nights collapsed onto one
    would credit a club with seven weeks of rest it never had, and put it in
    the wrong congestion bucket in every direction.

    So they are dropped rather than written. A missing European date makes a
    club look better rested than it was, which is wrong in one direction and
    obvious when the calendar lands; a fabricated one is wrong in both
    directions and looks exactly like data. Verified against the full 2025-26
    season: 314 fixtures, not one collision.
    """
    seen = {}
    for r in rows:
        seen.setdefault((r["c"], r["comp"], r["d"][:10]), []).append(r)
    keep, dropped = [], {}
    for (club, comp, day), group in seen.items():
        if len(group) == 1:
            keep.append(group[0])
        else:
            dropped[comp] = dropped.get(comp, 0) + len(group)
    return sorted(keep, key=lambda r: (r["d"], r["c"])), dropped


def emit(rows, season, out, club_names=None):
    rows, dropped = drop_placeholder_dates(rows)
    by_comp = {}
    for r in rows:
        by_comp[r["comp"]] = by_comp.get(r["comp"], 0) + 1
    head = [
        "// Auto-generated by harvest_other_fixtures.py. Do not hand-edit.",
        "//",
        f"// Cup and European dates for Premier League clubs, season {season}.",
        "// Dates and venues only — this file exists so that rest days are days",
        "// since the last COMPETITIVE match rather than days since the last",
        "// league match. Without it a side that played away in Europe on the",
        "// Thursday and at home on the Sunday reads as seven days' rest.",
        "//",
        "//   c     club short code",
        "//   d     kick-off, ISO 8601 with offset",
        "//   comp  UCL, UEL, UECL, FAC (FA Cup), LCUP (League Cup)",
        "//   v     H or A — the away leg is what the 72-hour European flag needs",
        "//",
        "// " + ", ".join(f"{k} {v}" for k, v in sorted(by_comp.items())),
    ]
    # AN INCOMPLETE FILE MUST SAY SO, IN THE FILE. A reader counting rows would
    # otherwise see a plausible European calendar and no reason to doubt it —
    # and the whole reason those rows are gone is that they looked plausible.
    if dropped:
        head += [
            "//",
            "// NOT YET PUBLISHED, so deliberately absent rather than guessed:",
            "// " + ", ".join(f"{k} {v} fixture(s)" for k, v in sorted(dropped.items()))
            + ". The feed carried these with the round's placeholder date rather",
            "// than a kick-off — a club cannot play twice in one competition on",
            "// one day. They return of their own accord once UEFA confirms the",
            "// calendar and the next harvest reads real dates.",
        ]
    head += ["const %s = [" % const_name(out)]
    body = [
        '  {c:"%s",d:"%s",comp:"%s",v:"%s"},' % (r["c"], r["d"], r["comp"], r["v"])
        for r in rows
    ]
    # THE NAME-TO-CODE MAP THIS HARVEST ACTUALLY USED. Emitted rather than
    # kept a second time downstream: the backtest walks a record that names
    # clubs in full, this file keys on short codes, and a hand-written bridge
    # between them is one more list to fall out of date the next time a club
    # is relegated.
    tail = ["];", "",
            "const %s_CLUBS = %s;" % (const_name(out),
                                      json.dumps({v: k for k, v in
                                                  sorted((club_names or {}).items())},
                                                 ensure_ascii=False)),
            ""]
    (DATA / out).write_text("\n".join(head + body + tail), encoding="utf-8")
    return by_comp, dropped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True,
                    help="season START year — 2026 is 2026-27, 2025 is 2025-26")
    ap.add_argument("--out", default="pl_other_fixtures.js")
    args = ap.parse_args()

    host, key = af.env_or("API_FOOTBALL_HOST", af.DEFAULT_HOST), af.env_or("API_FOOTBALL_KEY", "")
    if not key:
        sys.exit("ERROR: API_FOOTBALL_KEY is not set. Nothing written.")

    rows, refused, notes, club_names = [], [], [], {}
    for comp_id, comp_code in COMPETITIONS:
        got, note = rows_for(host, key, comp_id, comp_code, args.season)
        notes.append(note)
        if got is None:
            refused.append(note)
        else:
            # BEFORE the rows join the pile, because a placeholder block is
            # only recognisable within its own competition: pooled with the
            # cups, one club's eight identical UCL stamps sit beside real
            # ties and the impossibility is no longer local.
            fixed, fix_note = apply_league_phase_override(
                got[0], comp_code, args.season)
            if fix_note:
                notes.append("  " + fix_note)
            rows.extend(fixed)
            club_names.update(got[1])

    for n in notes:
        print("  " + n)

    # A REFUSAL IS REPORTED, NOT ABSORBED. If the plan does not cover the
    # Champions League then the rest days for every European side are wrong in
    # the one direction that matters, and the backtest reading this file has to
    # know that rather than infer it from a smaller number.
    if refused:
        print("REFUSED by the API (rest days for these competitions will be "
              "missing):\n  - " + "\n  - ".join(refused))
    if not rows:
        sys.exit("ERROR: no cup or European ties resolved to a Premier League "
                 "club. Nothing written — an empty file here reads as 'nobody "
                 "played midweek', which is a stronger claim than 'we could "
                 "not ask'.")

    by_comp, dropped = emit(rows, args.season, args.out, club_names)
    clubs = len({r["c"] for r in rows})
    print(f"{args.out} written: {sum(by_comp.values())} club-ties across "
          f"{clubs} clubs — "
          + ", ".join(f"{k} {v}" for k, v in sorted(by_comp.items())))
    # SAID OUT LOUD, not left in the file for somebody to notice. A harvest
    # that quietly writes fewer rows than it fetched is the failure this
    # project keeps finding; the number it did not write is the interesting one.
    if dropped:
        print("  placeholder dates refused (a club cannot play twice in one "
              "competition on one day): "
              + ", ".join(f"{k} {v}" for k, v in sorted(dropped.items())))
        print("  those competitions' calendars are not published yet; the next "
              "harvest picks them up when they are.")
    if refused:
        print("INCOMPLETE: " + str(len(refused)) + " competition(s) refused above.")


if __name__ == "__main__":
    main()

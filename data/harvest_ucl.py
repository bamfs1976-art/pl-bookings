#!/usr/bin/env python3
"""The Champions League ties this app can actually price.

  python3 data/harvest_ucl.py --season 2026

WHAT THIS IS FOR. A European tie is priceable here only when BOTH clubs are
ones a desk already holds players for. `docs/champions-league-feasibility.md`
§1 states the rule and why it is not negotiable:

    BOTH SIDES OR NEITHER - the match total is the sum of the two halves, and
    pricing one off its real XI and the other off last season's minutes would
    make them answer different questions.

With the Premier League, La Liga and Serie A desks built, that is no longer a
rare case. UEFA does not pair two clubs from the same country in the league
phase, so every qualifying tie is one country against another, and the desk
holds three of them.

WHAT IT WRITES. data/ucl_ties.js, one row per tie where both clubs resolve,
each row carrying BOTH clubs' short codes AND the desk each belongs to,
because the two sides come from different datasets and the page has to know
which file to read each from. A tie with one side unheld is dropped, not
half-built.

WHAT IT COSTS. One /fixtures call for the whole competition, once a day. The
squads are already harvested for the domestic desks; nothing here buys a
player.

WHAT IT DELIBERATELY DOES NOT DO.

  * NO REFEREE RATE. A referee's card rate is competition-specific, and the
    desks hold domestic records. Michael Oliver's Premier League rate is not
    his Champions League rate: different instructions, different tempo, and
    cards-per-foul is precisely the quantity that moves. The official's NAME
    is carried so a card can say who it is; his rate is not, and the page
    prices these ties at a neutral referee until a European record exists.
    See §4 of the feasibility note.

  * NO SUSPENSION LADDER. UEFA runs its own accumulation rules and this
    repository does not encode a rung it has not evidenced. The registry is
    untouched.

  * NO NEW CLUBS. Ties involving a club no desk holds are counted in the
    summary and dropped from the file, which is the honest version of what
    this app can and cannot say.

  * NO PLACEHOLDER KICK-OFFS. API-Football creates the league-phase
    fixtures as soon as the draw is made and, until it ingests UEFA's
    calendar, stamps every one of them with a single provisional instant.
    `data/uefa_league_phase.py` documents what that cost this repository the
    last time it went unnoticed: a whole autumn of European football read as
    one pile-up, and fabricated congestion shipped to production. Detected
    here on the same impossibility (a club in two ties at the same instant),
    over EVERY tie in the competition rather than the priceable few, and a
    tie caught by it is written with a null date. The round is real, the
    clubs are real, the price is real; the kick-off is not known yet, so the
    card does not claim one.
"""

import argparse
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import harvest_apifootball as af  # noqa: E402

# The competition, and the desks a club may belong to. Order matters only for
# reporting: a club cannot be in two of these at once.
UCL_LEAGUE_ID = 2
DESKS = ["PL", "LL", "SA"]
OUT = "ucl_ties.js"
CONST = "UCL_TIES"


def desk_of(name):
    """(desk code, club short) for a club a desk holds, or (None, None).

    Asks each desk's own resolver, which is the same call the domestic
    harvests make, so a club is recognised here exactly when its desk would
    recognise it and never by a second spelling table.
    """
    for code in DESKS:
        short = af.short_in(code, name)
        if short:
            return code, short
    return None, None


def map_tie(entry):
    """One /fixtures row as a tie row, or None with the reason.

    Returns (row, unheld) where `unheld` is the list of club names this app
    holds no players for. A row is only produced when that list is empty.
    """
    fx = (entry or {}).get("fixture") or {}
    tm = (entry or {}).get("teams") or {}
    lg = (entry or {}).get("league") or {}
    hn = ((tm.get("home") or {}).get("name") or "").strip()
    an = ((tm.get("away") or {}).get("name") or "").strip()
    if not hn or not an or not fx.get("date"):
        return None, []
    hl, h = desk_of(hn)
    al, a = desk_of(an)
    unheld = [n for n, got in ((hn, h), (an, a)) if not got]
    if unheld:
        return None, unheld
    ref = (fx.get("referee") or "").strip() or None
    if ref:
        # API-Football appends the country: "Michael Oliver, England".
        ref = ref.split(",")[0].strip() or None
    return {
        "id": fx.get("id"),
        # The instant as the feed gives it. placeholder_slots() decides
        # whether it is a kick-off or a draw-pending stamp, and null_placeholders()
        # clears it if it is the latter.
        "d": fx.get("date"),
        # The round as published ("League Stage - 3"), kept whole. A European
        # season is a league phase and then knockout rounds with names rather
        # than numbers, so a bare integer would lose which is which.
        "r": (lg.get("round") or "").strip() or None,
        "h": h, "hl": hl, "a": a, "al": al,
        "ref": ref,
        "st": ((fx.get("status") or {}).get("short") or "NS"),
    }, []


def placeholder_slots(entries):
    """The (club name, instant) pairs that are a draw-pending stamp, not a slot.

    A club cannot play two matches at the same moment. When API-Football has
    the pairings but not the calendar it gives a club's whole league phase one
    instant, so the impossibility is the detector, and it needs no date
    heuristic and no list of which seasons are affected.

    READ OVER EVERY TIE IN THE COMPETITION, not the priceable few. Arsenal's
    eight league-phase ties are eight rows here; only one or two of them may
    have both clubs on a desk, and one row on its own looks like a fixture.
    The block is only visible from the whole draw.

    Keyed on the slot rather than the club, following
    harvest_other_fixtures.placeholder_keys: a club can hold two real play-off
    legs in August and a placeholder block in October, and condemning the club
    would throw away the two that were never in doubt.
    """
    seen, bad = set(), set()
    for e in entries or []:
        fx = (e or {}).get("fixture") or {}
        tm = (e or {}).get("teams") or {}
        when = fx.get("date")
        if not when:
            continue
        for side in ("home", "away"):
            name = ((tm.get(side) or {}).get("name") or "").strip()
            if not name:
                continue
            key = (name, when)
            if key in seen:
                bad.add(key)
            seen.add(key)
    return bad


def null_placeholders(rows, bad, names_by_id):
    """Clear the date on every tie sitting in a placeholder block.

    Returns the number cleared. The row keeps its id, round, clubs and
    official; it loses only the thing the feed does not actually know.
    """
    cleared = 0
    for r in rows:
        hn, an = names_by_id.get(r["id"], ("", ""))
        if (hn, r["d"]) in bad or (an, r["d"]) in bad:
            r["d"] = None
            cleared += 1
    return cleared


def order(r):
    """Sort key: dated ties by kick-off, undated ones after them by round."""
    return (r["d"] is None, r["d"] or "", r["r"] or "", r["h"])


def emit(rows, season, seen, unheld_names, cleared):
    withref = sum(1 for r in rows if r["ref"])
    undated = sum(1 for r in rows if not r["d"])
    pairs = sorted({(r["hl"], r["al"]) for r in rows})
    lines = [
        "// Auto-generated by data/harvest_ucl.py. Do not edit by hand.",
        f"// UEFA Champions League {season}-{int(season) % 100 + 1}: {len(rows)} of "
        f"{seen} ties have BOTH clubs on a desk this app holds",
        f"// ({', '.join(a + ' v ' + b for a, b in pairs) or 'none'}); "
        f"{withref} with an official named, {undated} with no kick-off known.",
        "// Player rates are each club's DOMESTIC season, which is what the card",
        "// says: eight European matches is not a sample. No referee rate and no",
        "// suspension ladder - see docs/champions-league-feasibility.md.",
        "// A null date is a tie whose kick-off the feed has NOT published: the",
        "// draw is made, the calendar is not ingested, and every fixture in the",
        "// block carries one provisional instant. The card shows the round.",
        f"const {CONST} = [",
    ]
    for r in sorted(rows, key=order):
        lines.append("  {" + ",".join([
            f'id:{json.dumps(r["id"])}', f'd:{json.dumps(r["d"])}',
            f'r:{json.dumps(r["r"])}',
            f'h:{json.dumps(r["h"])}', f'hl:{json.dumps(r["hl"])}',
            f'a:{json.dumps(r["a"])}', f'al:{json.dumps(r["al"])}',
            f'ref:{json.dumps(r["ref"], ensure_ascii=False)}',
            f'st:{json.dumps(r["st"])}',
        ]) + "},")
    lines.append("];")
    (DATA / OUT).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{OUT} written ({len(rows)} priceable of {seen} ties, "
          f"{withref} with an official named)")
    if cleared:
        print(f"  {cleared} tie(s) sat in a draw-pending placeholder block and "
              "were written with NO kick-off. That is the feed having the draw "
              "but not the calendar, not a fault here.")
    for r in sorted(rows, key=order):
        print(f"  {str(r['d'])[:10] if r['d'] else 'date t.b.c.':<11}  {r['r'] or '?':<18} "
              f"{r['h']} ({r['hl']}) v {r['a']} ({r['al']})"
              + (f"  ref {r['ref']}" if r["ref"] else ""))
    if unheld_names:
        top = sorted(unheld_names.items(), key=lambda kv: -kv[1])
        print(f"\n  {len(top)} club(s) no desk holds, so their ties are not priced:")
        print("   " + ", ".join(f"{n} x{c}" for n, c in top[:24]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", help="season START year, e.g. 2026 for 2026-27")
    args = ap.parse_args()

    key = af.env_or("API_FOOTBALL_KEY", "")
    if not key:
        sys.exit("ERROR: API_FOOTBALL_KEY is not set.")
    season = args.season or af.env_or("API_FOOTBALL_SEASON", "2026")
    host = af.env_or("API_FOOTBALL_HOST", af.DEFAULT_HOST)

    print(f"UEFA Champions League: API-Football league {UCL_LEAGUE_ID}, season {season}")
    payload = af._get(host, key, "fixtures",
                      {"league": UCL_LEAGUE_ID, "season": season})
    errs = af.api_errors(payload)
    if errs:
        sys.exit(f"ERROR: the feed refused the request: {errs}")
    entries = (payload or {}).get("response") or []
    if not entries:
        sys.exit(f"ERROR: no fixtures came back for league {UCL_LEAGUE_ID} "
                 f"season {season}. Refusing to write an empty file over a "
                 "good one.")

    rows, unheld_names, names_by_id = [], {}, {}
    for e in entries:
        fx = (e or {}).get("fixture") or {}
        tm = (e or {}).get("teams") or {}
        names_by_id[fx.get("id")] = (
            ((tm.get("home") or {}).get("name") or "").strip(),
            ((tm.get("away") or {}).get("name") or "").strip())
        row, unheld = map_tie(e)
        if row:
            rows.append(row)
        for n in unheld:
            unheld_names[n] = unheld_names.get(n, 0) + 1

    bad = placeholder_slots(entries)
    if bad:
        print(f"  {len(bad)} club-slot(s) across the whole draw are a "
              "placeholder: the feed has the pairings, not the calendar.")
    cleared = null_placeholders(rows, bad, names_by_id)

    emit(rows, season, len(entries), unheld_names, cleared)
    af.report_usage()
    return 0


if __name__ == "__main__":
    sys.exit(main())

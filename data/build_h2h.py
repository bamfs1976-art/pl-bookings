#!/usr/bin/env python3
"""Build head-to-head card history for any division the registry knows.

WHY THIS IS PYTHON AND NOT scripts/build-h2h.mjs. The Node builder does one
league and hardcodes its own football-data spelling table for the twenty
Premier League clubs. Doing the same for the Championship and La Liga would put
a third and fourth copy of the club-name problem in the repo — and La Liga's is
the awkward one, with accents, three feeds spelling the same club three ways
and a discovered registry. All of that is already solved once in leagues.py, so
this reuses it: `load_rows` for fetching (mirror first, football-data.co.uk
second) and `short_for` for naming.

DATES ARE PARSED, NOT SORTED AS STRINGS. The mirror rewrites dates as
`yyyy-mm-dd`, where a lexicographic sort happens to be chronological. The
origin uses `dd/mm/yy`, where it is not — it sorts by day of month, so "the
last six meetings" would silently be six arbitrary ones. The Championship reads
the origin, because the mirror does not carry it. Same `fd_date` the referee
join uses.

COUNTING RULE: yellows only, matching the fixture model, which counts players
booked. Reds are carried separately rather than folded in — a sending off is a
different event and is priced differently again.

Usage:
    python3 data/build_h2h.py --league LL
    python3 data/build_h2h.py --league EFLC --seasons 2122,2223,2324,2425,2526
"""
import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import leagues                                    # noqa: E402
from build_refs import fd_date                    # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_SEASONS = ["2122", "2223", "2324", "2425", "2526"]

# The Premier League's football-data spellings. leagues.py maps the other two
# divisions already; this table exists so PL can be built by the same code
# rather than by a second implementation.
PL_FD_SHORT = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "Bournemouth": "BOU", "Brentford": "BRE",
    "Brighton": "BHA", "Chelsea": "CHE", "Crystal Palace": "CRY", "Everton": "EVE",
    "Fulham": "FUL", "Leeds": "LEE", "Liverpool": "LIV", "Man City": "MCI",
    "Man United": "MUN", "Newcastle": "NEW", "Nott'm Forest": "NFO",
    "Sunderland": "SUN", "Tottenham": "TOT",
    "Coventry": "COV", "Hull": "HUL", "Ipswich": "IPS",
}


def rnd(x, places):
    """Round HALF AWAY FROM ZERO, as JavaScript's Math.round(x*100)/100 does.

    Named rnd, not r: `for r in rows` further down rebinds a bare `r` to a
    dict, and calling it then raises TypeError from inside the aggregation —
    which the first version did, invisibly, because the run's stderr was
    suppressed and the diff compared a stale output file.

    Python's built-in round() is banker's rounding — it breaks ties to the even
    digit — so 4.125 becomes 4.12 here and 4.13 in the Node builder this
    replaces. Twenty of the Premier League's 151 pairs differed by exactly that
    one hundredth, which is not a bug in either language but would have churned
    the shipped file and made the port impossible to verify by diffing.
    """
    f = 10 ** places
    return math.floor(x * f + 0.5) / f


def short_of(code, name):
    """A football-data club name as this division's short code, or None."""
    if code == "PL":
        return PL_FD_SHORT.get((name or "").strip())
    return leagues.short_for(code, name)


def current_clubs(code):
    """The shorts actually in the division now, read from the SHIPPED dataset so
    the history and the desk cannot drift. A meeting is only useful if both
    clubs are still here — otherwise it is a fixture that cannot recur."""
    path = HERE / leagues.get(code).data_file
    text = path.read_text(encoding="utf-8")
    m = re.search(r"const CLUBS = \[(.*?)\n\];", text, re.S)
    if not m:
        sys.exit(f"ERROR: no CLUBS block in {path}")
    return set(re.findall(r'short:"([^"]+)"', m.group(1)))


def num(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def build(code, seasons):
    league = leagues.get(code)
    clubs = current_clubs(code)
    meetings = defaultdict(list)
    scanned = used = 0
    unmapped = defaultdict(int)
    got = []

    for season in seasons:
        try:
            rows, label = leagues.load_rows(league, season)
        except SystemExit:
            print(f"  season {season}: no source answered — skipped", file=sys.stderr)
            continue
        n = 0
        for r in rows:
            scanned += 1
            h = short_of(code, r.get("HomeTeam"))
            a = short_of(code, r.get("AwayTeam"))
            if not h:
                unmapped[(r.get("HomeTeam") or "").strip()] += 1
            if not a:
                unmapped[(r.get("AwayTeam") or "").strip()] += 1
            if not h or not a or h not in clubs or a not in clubs:
                continue
            hy, ay = num(r.get("HY")), num(r.get("AY"))
            hr, ar = num(r.get("HR")), num(r.get("AR"))
            if None in (hy, ay, hr, ar):
                continue
            meetings["|".join(sorted([h, a]))].append(
                {"y": hy + ay, "r": hr + ar, "d": fd_date(r.get("Date")) or ""})
            used += 1
            n += 1
        got.append(season)
        print(f"  season {season} ({label}): {n} meetings between current clubs")

    if not got:
        sys.exit(f"ERROR: no season data for {code} — nothing written. "
                 "The mirror does not carry every division and the origin may "
                 "be unreachable from this machine.")

    pairs = {}
    for k, lst in meetings.items():
        # Sorted on the PARSED date, newest first. See the module docstring.
        lst.sort(key=lambda m: m["d"], reverse=True)
        ys = [m["y"] for m in lst]
        n = len(ys)
        pairs[k] = {
            "n": n,
            "avg": rnd(sum(ys) / n, 2),
            "o45": rnd(len([v for v in ys if v >= 5]) / n, 3),
            "red": rnd(sum(m["r"] for m in lst) / n, 2),
            "last": ys[:6],
        }

    tot = sum(p["n"] for p in pairs.values())
    out = {
        "meta": {
            "seasons": got,
            "span": f"{got[0]}-{got[-1]}",
            "pairs": len(pairs),
            "meetings": tot,
            "leagueAvgYellows": rnd(
                sum(p["avg"] * p["n"] for p in pairs.values()) / tot, 2) if tot else 0,
            "counts": "yellows only; reds carried separately",
            "source": "football-data.co.uk (mirror where available)",
        },
        "pairs": pairs,
    }
    if unmapped:
        worst = sorted(unmapped.items(), key=lambda kv: -kv[1])[:8]
        print("  unmapped club names (not in this division now, or missing an "
              "alias): " + ", ".join(f"{k or '<blank>'}×{v}" for k, v in worst),
              file=sys.stderr)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default="LL", help="PL, EFLC or LL")
    ap.add_argument("--seasons", default=",".join(DEFAULT_SEASONS))
    ap.add_argument("--out", help="output path (defaults to the league's h2h file)")
    a = ap.parse_args()

    code = a.league.upper()
    seasons = [s.strip() for s in a.seasons.split(",") if s.strip()]
    print(f"Building head-to-head for {code} over {len(seasons)} seasons")
    data = build(code, seasons)

    name = {"PL": "h2h.js", "EFLC": "eflc_h2h.js", "LL": "laliga_h2h.js"}[code]
    var = {"PL": "H2H", "EFLC": "EFLC_H2H", "LL": "LALIGA_H2H"}[code]
    path = Path(a.out) if a.out else HERE / name
    path.write_text(
        "// Auto-generated by data/build_h2h.py. Head-to-head card history.\n"
        "// Public-domain football-data.co.uk match records. Yellows only.\n"
        f"const {var} = " + json.dumps(data, separators=(",", ":")) + ";\n",
        encoding="utf-8")
    m = data["meta"]
    print(f"Wrote {path.name}: {m['pairs']} pairs, {m['meetings']} meetings, "
          f"league average {m['leagueAvgYellows']} yellows a meeting")


if __name__ == "__main__":
    main()

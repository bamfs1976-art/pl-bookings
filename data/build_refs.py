#!/usr/bin/env python3
"""
Build a league's referee dataset from the free football-data.co.uk match
records (public domain, no login, no key).

Every match row carries the referee plus both teams' yellow (HY/AY) and red
(HR/AR) card counts and fouls (HF/AF), so yellows-per-game, fouls-per-game and
cards-per-foul can be computed for every official who took a match.

Penalties are not in this source, so pen-per-game (and the region label) are
carried over from the previous dataset where the referee matches, and null for
new officials.

Usage:
    python3 data/build_refs.py                          # Premier League, 2526
    python3 data/build_refs.py --season 2627
    python3 data/build_refs.py --league EFLC            # EFL Championship
    python3 data/build_refs.py --league EFLC --season 2526
    python3 data/build_refs.py --csv path/to/season.csv  # offline
    python3 data/build_refs.py --league EFLC --dry-run   # print, write nothing

Writes data/<league>_refs.json and patches the REFS block of the league's
data file in place (clubs and players are untouched). A league whose data file
does not exist yet — the state a new competition starts in — gets the JSON and
a note, not an error.

WHICH LEAGUES THIS WORKS FOR. Only the ones whose match records actually name
the official, which is English and Scottish football and effectively nowhere
else; see data/leagues.py and docs/la-liga-feasibility.md. Pointing this script
at a league without free referees is refused up front rather than producing an
empty ranking.
"""

import argparse
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402
import build_pl_data  # noqa: E402


def previous_details(league):
    """pen/region from the league's current data file, keyed by initial+surname.

    Absent file or absent REFS block is not an error: a competition the desk
    has not built yet has no previous detail to carry over, which is the
    normal state on the first run for a new league.
    """
    path = league.path(league.data_file)
    if not path.exists():
        return {}
    src = path.read_text(encoding="utf-8")
    block = re.search(r"const REFS = \[(.*?)\];", src, re.S)
    out = {}
    if not block:
        return out
    # NOTE the row is matched up to `pen:` and no further. This pattern used to
    # end with a closing brace, which silently stopped matching the day fpg and
    # cpf were appended to the row format — 0 of 22 rows since, so pen and
    # region were being dropped on every rebuild rather than carried over. The
    # row format is allowed to grow; this pattern must not care that it did.
    for m in re.finditer(r"\{n:(\".*?\"),region:(\".*?\"),matches:(?:null|[\d.]+),"
                         r"ypg:(?:null|[\d.]+),red:(?:null|[\d.]+),pen:(null|[\d.]+)",
                         block.group(1)):
        name = json.loads(m.group(1))
        key = (name.split()[0][0] + " " + name.split()[-1]).lower()
        pen = None if m.group(3) == "null" else float(m.group(3))
        out[key] = {"region": json.loads(m.group(2)), "pen_pg": pen}
    return out


def match_key(date, home, away):
    """The join key: one calendar date and the two clubs by CANONICAL NAME.

    Deliberately NOT the kick-off time. The free records carry a date and the
    API carries a timestamp with an offset, and the two disagree by hours for
    an evening kick-off — joining on anything finer would match nothing while
    looking like a data problem rather than a units problem.

    And deliberately not the short code. This join runs over a COMPLETED
    season whose relegated clubs are no longer in the division, so they have
    no short code — keying on one dropped their matches and rated every
    referee on four fifths of his season.
    """
    if not date or not home or not away:
        return None
    return (str(date)[:10], home, away)


def fd_date(raw):
    """football-data.co.uk's date as ISO. The archive uses BOTH `dd/mm/yy` and
    `dd/mm/yyyy` across seasons, and the GitHub mirror re-writes them as
    `yyyy-mm-dd`, so all three have to land on the same string or the join
    silently produces nothing."""
    s = (raw or "").strip()
    if not s:
        return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    parts = s.split("/")
    if len(parts) != 3:
        return None
    d, m, y = (p.strip() for p in parts)
    if len(y) == 2:
        # football-data has no pre-2000 rows in any file this reads.
        y = "20" + y
    if not (d.isdigit() and m.isdigit() and y.isdigit()):
        return None
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def attach_referees(rows, fixtures, code):
    """Stamp `Referee` onto free match records from a keyed fixture list.

    THE ONE THING SPAIN PAYS FOR. Every card and every foul in La Liga is in
    the free public-domain file already; the single column that is missing,
    and has been for all 33 seasons of the archive, is who refereed the match.
    So the NAME is bought — one /fixtures call a season — and joined on here,
    after which tally_refs and build_refs below compute every published rate
    off data that stayed free.

    Returns (rows, stats). Rows are copies: the free records are an input and
    must not be mutated in place, or a second pass over them would see a
    referee that came from somewhere else.
    """
    index, played = {}, set()
    for fx in fixtures or []:
        key = match_key(fx.get("d"), leagues.canon_name(code, fx.get("hn") or fx.get("h")),
                        leagues.canon_name(code, fx.get("an") or fx.get("a")))
        if not key:
            continue
        played.add(key)
        ref = (fx.get("ref") or "").strip()
        if ref:
            index[key] = ref

    out = []
    stats = {"matched": 0, "unmatched": 0, "no_referee_in_feed": 0, "misses": []}
    for r in rows:
        row = dict(r)
        key = match_key(fd_date(r.get("Date")),
                        leagues.canon_name(code, r.get("HomeTeam")),
                        leagues.canon_name(code, r.get("AwayTeam")))
        ref = index.get(key) if key else None
        if ref:
            row["Referee"] = ref
            stats["matched"] += 1
        elif key and key in played:
            # The fixture is there; the API just carries no official for it.
            # A different failure from "these two lists do not line up", and
            # worth telling apart — one is a gap, the other is a bug.
            stats["no_referee_in_feed"] += 1
        else:
            stats["unmatched"] += 1
            if len(stats["misses"]) < 8:
                stats["misses"].append(
                    f"{r.get('Date')} {r.get('HomeTeam')} v {r.get('AwayTeam')}")
        out.append(row)
    return out, stats


def load_fixture_list(league):
    """The committed fixture list for a league, parsed back out of its .js.

    Read from the SHIPPED file rather than re-fetched: the fixtures harvest is
    its own workflow step with its own key and its own failure mode, and a
    referee refresh should use whatever that step last produced rather than
    spending a second call and being able to fail differently.
    """
    import harvest_apifootball as A
    entry = A.REF_FIXTURE_FILES.get(league.code)
    if not entry:
        return None, f"{league.name} has no referee-join fixture file configured"
    const, filename = entry
    path = league.path(filename)
    if not path.exists():
        return None, (f"{filename} does not exist yet — harvest the completed "
                      f"season's officials first:\n    python3 "
                      f"data/harvest_apifootball.py --ref-fixtures --league "
                      f"{league.code} --season <the season just played>")
    src = path.read_text(encoding="utf-8")
    m = re.search(r"const " + const + r" = \[(.*?)\];", src, re.S)
    if not m:
        return None, f"{filename} has no `const {const} = [` block"
    body = build_pl_data.quote_keys(m.group(1)).strip().rstrip(",")
    try:
        return json.loads("[" + body + "]"), None
    except ValueError as e:
        return None, f"{filename} did not parse: {e}"


def tally_refs(rows):
    """referee -> counts, plus the number of rows that carried no usable card
    data. Pure: this is the whole computation, and it is what the tests call."""
    tally = {}
    skipped = 0
    for r in rows:
        ref = (r.get("Referee") or "").strip()
        try:
            hy, ay = int(r["HY"]), int(r["AY"])
            hr, ar = int(r["HR"]), int(r["AR"])
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        if not ref:
            skipped += 1
            continue
        # Fouls (HF/AF) are in the same source and are what turn a raw card
        # count into a strictness rate — a referee showing many yellows may
        # simply be getting foul-heavy fixtures. Optional: rows without them
        # still count toward cards, they just don't feed fouls/cpf.
        try:
            fouls = int(r["HF"]) + int(r["AF"])
        except (KeyError, TypeError, ValueError):
            fouls = None
        d = tally.setdefault(ref, {"matches": 0, "yellows": 0, "reds": 0,
                                   "fouls": 0, "foul_matches": 0})
        d["matches"] += 1
        d["yellows"] += hy + ay
        d["reds"] += hr + ar
        if fouls is not None:
            d["fouls"] += fouls
            d["foul_matches"] += 1
    return tally, skipped


def build_refs(tally, prev, min_matches):
    """The ranked referee rows. Pure, so the rates are unit-testable."""
    refs = []
    for abbrev, d in tally.items():
        if d["matches"] < min_matches:
            continue
        name = leagues.full_name(abbrev)
        key = (name.split()[0][0] + " " + name.split()[-1]).lower()
        old = prev.get(key, {})
        # fouls/game and cards-per-foul, over the matches that carried fouls.
        fm = d.get("foul_matches", 0)
        fpg = round(d["fouls"] / fm, 2) if fm else None
        # Cards per foul uses the same match subset as the fouls, so the two
        # rates are consistent; yellows only (reds are a different decision).
        cpf = None
        if fm and d["fouls"] > 0:
            yellows_in_fm = d["yellows"] * (fm / d["matches"])   # pro-rata when some rows lacked fouls
            cpf = round(yellows_in_fm / d["fouls"], 4)
        refs.append({
            "name": name,
            "region": old.get("region", ""),
            "matches": d["matches"],
            "yellows": d["yellows"],
            "ypg": round(d["yellows"] / d["matches"], 2),
            "red_pg": round(d["reds"] / d["matches"], 2),
            "pen_pg": old.get("pen_pg"),
            "fouls_pg": fpg,
            "cards_per_foul": cpf,
        })
    refs.sort(key=lambda r: -r["ypg"])
    return refs


def jsval(x):
    if x is None:
        return "null"
    if isinstance(x, str):
        return json.dumps(x, ensure_ascii=False)
    return str(x)


def refs_block(refs):
    lines = ["const REFS = ["]
    for r in refs:
        lines.append("  {" + ",".join([
            f'n:{jsval(r["name"])}', f'region:{jsval(r["region"])}',
            f'matches:{jsval(r["matches"])}', f'ypg:{jsval(r["ypg"])}',
            f'red:{jsval(r["red_pg"])}', f'pen:{jsval(r["pen_pg"])}',
            f'fpg:{jsval(r["fouls_pg"])}', f'cpf:{jsval(r["cards_per_foul"])}',
        ]) + "},")
    lines.append("];")
    return "\n".join(lines)


def patch_data_file(league, refs):
    """Replace the REFS block in the league's data file. Returns a status
    string; a missing data file is reported, not fatal."""
    path = league.path(league.data_file)
    if not path.exists():
        return (f"{league.data_file} does not exist yet — wrote "
                f"{league.refs_file} only. Build the league's data file, then "
                "re-run to patch its REFS block.")
    src = path.read_text(encoding="utf-8")
    new_src, n = re.subn(r"const REFS = \[.*?\];", refs_block(refs), src,
                         count=1, flags=re.S)
    if n != 1:
        sys.exit(f"ERROR: could not find the REFS block in {league.data_file}.")
    path.write_text(new_src, encoding="utf-8")
    return f"patched the REFS block of {league.data_file}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default="PL",
                    help="league code (%s)" % ", ".join(sorted(leagues.LEAGUES)))
    ap.add_argument("--season", default="2526", help="football-data season code (e.g. 2526)")
    ap.add_argument("--csv", help="local season CSV instead of fetching")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the ranking, write nothing")
    args = ap.parse_args()

    league = leagues.get(args.league)
    if league.referee_source not in ("football-data", "api-football"):
        sys.exit(f"ERROR: {league.name} has referee_source "
                 f"{league.referee_source!r}, which this script cannot build "
                 "from. See docs/la-liga-feasibility.md.")

    rows, where = leagues.load_rows(league, season=args.season, csv_path=args.csv,
                                    agent="pl-bookings-refs")

    # A league whose free records carry no official gets the NAME joined on
    # from the keyed fixture list. Everything after this line is identical for
    # both kinds of league, which is the entire point of doing it here: the
    # rates are computed once, from the free cards and fouls, however the name
    # arrived.
    if not league.has_free_referees:
        fixtures, why = load_fixture_list(league)
        if fixtures is None:
            sys.exit(f"ERROR: {league.name} needs the referee NAME joined on "
                     f"from the fixture list, and {why}.")
        rows, jstats = attach_referees(rows, fixtures, league.code)
        print(f"Referee join: {jstats['matched']} of {len(rows)} matches got an "
              f"official from {len(fixtures)} fixtures")
        if jstats["unmatched"]:
            print(f"  {jstats['unmatched']} match rows found no fixture:")
            for miss in jstats["misses"]:
                print("    " + miss)
        if not jstats["matched"]:
            sys.exit("ERROR: the join matched NOTHING. Every match row failed "
                     "to find a fixture, which is a key problem (club spelling "
                     "or date format), not an empty season. Refusing to write.")
        # Below about half, something systematic is wrong — a renamed club, a
        # season offset — and a referee table built on the half that happened
        # to line up is worse than none, because it looks complete.
        if jstats["matched"] < len(rows) // 2:
            sys.exit(f"ERROR: only {jstats['matched']} of {len(rows)} matches "
                     "joined. That is a systematic mismatch, not a gap. "
                     "Refusing to write a half-league referee table.")

    tally, skipped = tally_refs(rows)
    if not tally:
        sys.exit(f"ERROR: {where} carried {len(rows)} match rows but named no "
                 "referee on any of them. This source does not publish "
                 f"referees for {league.name}; refusing to write an empty set.")

    refs = build_refs(tally, previous_details(league), league.min_ref_matches)
    if not refs:
        sys.exit(f"ERROR: no referee reached {league.min_ref_matches} matches "
                 f"in {len(rows)} rows — partial season; refusing to write.")

    dropped = len(tally) - len(refs)
    print(f"{league.name} refs: {len(refs)} from {len(rows)} matches via {where}")
    print(f"  (dropped {dropped} under {league.min_ref_matches} matches, "
          f"skipped {skipped} rows without card data)")
    for r in refs:
        pen = "  - " if r["pen_pg"] is None else f"{r['pen_pg']:.2f}"
        fpg = "  -  " if r["fouls_pg"] is None else f"{r['fouls_pg']:>5.2f}"
        cpf = "  -  " if r["cards_per_foul"] is None else f"{r['cards_per_foul']:.3f}"
        print(f"   {r['ypg']:>5}  {r['red_pg']:>4} red  {pen} pen  "
              f"{fpg} fouls  {cpf} c/f  {r['matches']:>2}m  {r['name']}")

    if args.dry_run:
        print("\ndry run — nothing written")
        return

    league.path(league.refs_file).write_text(
        json.dumps({"refs": refs}, indent=1), encoding="utf-8")
    print("\n" + patch_data_file(league, refs))


if __name__ == "__main__":
    main()

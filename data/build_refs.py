#!/usr/bin/env python3
"""
Build a league's referee dataset from the free football-data.co.uk match
records (public domain, no login, no key).

Every match row carries the referee plus both teams' yellow (HY/AY) and red
(HR/AR) card counts and fouls (HF/AF), so yellows-per-game, fouls-per-game and
cards-per-foul can be computed for every official who took a match.

Penalties are not in this source. The region label is carried over from the
previous dataset where the referee matches; the penalty column is HAND-SEEDED
from data/ref_pens.json, which carries a source and a read-date beside every
figure, and falls back to the carried value. Null for everyone else, because
null means nobody knows and zero would mean he has never given one.

    python3 data/build_refs.py --pens-only --league ALL   # seed only, no fetch

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


PENS = DATA / "ref_pens.json"


def seeded_pens(league):
    """Hand-seeded penalties a game, keyed like previous_details.

    THE COLUMN HAS NO FEED. football-data.co.uk carries yellows, reds and fouls
    and no penalties, so this build has always written pen:null and carried the
    previous file's value forward — and when the carry-over regex silently
    stopped matching, every value was dropped and the column has been empty on
    all three desks since. Nothing refills it automatically because there is
    nothing free to refill it from.

    So data/ref_pens.json is entered by hand, from published referee-stat
    graphics, WITH the source and the date it was read written beside each
    figure. It is a separate file rather than an edit to the generated dataset
    for the reason every hand-fact in this repository is: a number nobody can
    trace is a number nobody can check, and one edited into an auto-generated
    file looks exactly like something the pipeline produced.

    It WINS over the carried value, because the carried value is only ever an
    older copy of this one and re-stating it in two places is how the two come
    to disagree. It does not win over a measured figure, because there is no
    measured figure; if a source that carries penalties is ever harvested, that
    branch goes above this one.
    """
    if not PENS.exists():
        return {}
    try:
        doc = json.loads(PENS.read_text(encoding="utf-8"))
    except ValueError as e:
        raise SystemExit(f"ERROR: data/ref_pens.json will not parse: {e}")
    out = {}
    for e in doc.get("entries") or []:
        if e.get("league") != league.code or e.get("pen") is None:
            continue
        name = str(e.get("ref") or "").strip()
        if not name or len(name.split()) < 2:
            raise SystemExit(
                f"ERROR: data/ref_pens.json has an entry with no full name: {e!r}. "
                "The key is initial-plus-surname, so a one-word name cannot be "
                "matched to an official and would be silently dropped.")
        if not e.get("source"):
            raise SystemExit(
                f"ERROR: data/ref_pens.json entry for {name} has no source. A "
                "hand-entered figure without one cannot be checked or corrected.")
        key = (name.split()[0][0] + " " + name.split()[-1]).lower()
        out[key] = float(e["pen"])
    return out


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


def _ref_parts(name):
    """(initial, [surnames]) for a referee name, accent- and case-folded."""
    flat = leagues.strip_accents(name or "").lower().replace(".", " ")
    parts = [t for t in flat.split() if t]
    if not parts:
        return None, []
    return parts[0][0], parts[1:]


def canonical_referees(names, dates=None):
    """{feed spelling: one canonical name}, plus the merges made.

    THE FEED NAMES THE SAME OFFICIAL TWO WAYS. API-Football returned both
    "Mateo Busquets Ferrer" and "M. Busquets" across one Spanish season, nine
    matches under one and ten under the other. Nothing errors: you get 41
    officials for a 380-match season instead of ~27, every rate computed on
    half a career, and a strictest-to-most-lenient spread inflated by the small
    samples. It looks like a complete referee table.

    An ABBREVIATED name is one whose first token is a single letter. It merges
    into a full name when the initial matches and its surnames appear as a
    CONTIGUOUS RUN anywhere in that full name's surnames — so "R. De Burgos"
    reaches "Ricardo De Burgos Bengoetxea", and "I. Diaz" reaches "Isidro Diaz
    de Mera Escuderos".

    ANYWHERE, not a leading run, and the difference is most of Spain. The rule
    was written against names where it happens to be the same test, and it left
    seven of twenty officials split across two rows apiece — a 27-referee table
    for a 20-referee division, with both halves of each career carrying the
    wrong card rate. Two things break a leading-run test:

      * A SECOND SURNAME. Spanish names carry two, paterno then materno, and
        the feed abbreviates to whichever it likes. "J. Manzano" is Jesús GIL
        MANZANO and "A. Ruiz" is Alejandro MUÑIZ RUIZ — the surname cited is
        the second one, so it can never lead.
      * A COMPOUND GIVEN NAME. "Miguel Ángel Ortiz Arias" splits into an
        initial and [angel, ortiz, arias]: nothing here knows "Ángel" is half a
        forename rather than a surname, so the run the test compares against
        starts one token too early. Same for every José Luis and José María.

    Both are the same mistake — assuming a POSITION rather than testing for
    MEMBERSHIP — and the contiguous-run test fixes both at once.

    It cannot merge a full name into the wrong person, because a run of
    surnames that matches two different officials is caught by the ambiguity
    check below rather than resolved. "J. Munuera" is exactly that: Juan
    Martínez MUNUERA and José Luis MUNUERA Montero both answer to it, and no
    amount of name-matching can say which refereed a given match.

    Two full names are NEVER merged with each other. "Jose Luis Munuera
    Montero" and "Jose Luis Guzman Mansilla" share an initial and a given name
    and are different people; a looser rule collapsed them, which is worse than
    the problem it fixes.

    An abbreviation matching more than one full name is left alone and
    reported: a wrong merge invents a referee's record, and there is no
    recovering from that downstream.
    """
    names = sorted({(n or "").strip() for n in names if (n or "").strip()})
    full, abbrev = [], []
    for n in names:
        init, surs = _ref_parts(n)
        if not init or not surs:
            continue
        first = leagues.strip_accents(n).lower().split()[0].replace(".", "")
        (abbrev if len(first) == 1 else full).append((n, init, surs))

    def run_in(surs, fsurs):
        """Is `surs` a contiguous run of tokens anywhere within `fsurs`?"""
        if not surs or len(surs) > len(fsurs):
            return False
        return any(fsurs[i:i + len(surs)] == surs
                   for i in range(len(fsurs) - len(surs) + 1))

    mapping, merges, ambiguous, resolved = {n: n for n in names}, [], [], []

    def candidates(surs, init):
        cands = [(fn, fsurs) for fn, finit, fsurs in full if finit == init]
        # TWO TIERS, and the order is the whole reason this resolves. The FIRST
        # surname is the primary one — paterno — and the one an abbreviation
        # normally cites, so a leading-run match is preferred over an interior
        # one and settles the case outright when it is unique. Widening to
        # "anywhere" without this loses a merge the narrow rule got right:
        # "J. Martinez" is Juan MARTINEZ Munuera at the leading position, but
        # José María Sánchez MARTINEZ also contains the token, so a flat
        # anywhere-test sees two candidates and gives up on both.
        lead = [fn for fn, fsurs in cands if fsurs[:len(surs)] == surs]
        return lead or [fn for fn, fsurs in cands if run_in(surs, fsurs)]

    # PASS 1: everything the spelling alone settles.
    pending = []
    for n, init, surs in abbrev:
        hits = candidates(surs, init)
        if len(hits) == 1:
            mapping[n] = hits[0]
            merges.append(f"{n} -> {hits[0]}")
        elif len(hits) > 1:
            pending.append((n, hits))

    # PASS 2: THE CALENDAR BREAKS WHAT IS LEFT, by exclusion rather than by
    # preference. Nobody referees two matches in one division on one day, so a
    # candidate already working on a date the abbreviation also worked is not
    # that abbreviation — no guess, a physical impossibility.
    #
    # "J. Munuera" is the case this exists for. Juan Martínez MUNUERA and José
    # Luis MUNUERA Montero both answer to it and no spelling rule can separate
    # them. It clashes with Juan twice and with Munuera Montero never, and the
    # two spellings turn out to cover disjoint, contiguous halves of the season
    # — the feed simply changed how it wrote his name in January.
    #
    # A SECOND PASS, not a branch inside the first, because a candidate's dates
    # are those of his whole MERGED identity and not of one spelling. Both of
    # the clashes that identify Juan are filed under "J. Martinez", which pass 1
    # folds into him; testing against the full spelling alone finds no clash at
    # all and resolves nothing. Doing it after every unambiguous merge is also
    # what stops the answer depending on the order the names happen to sort in.
    def dates_of(canonical):
        out = set()
        for spelling, target in mapping.items():
            if target == canonical:
                out |= dates.get(spelling) or set()
        return out

    for n, hits in pending:
        clear = hits
        if dates:
            mine = dates.get(n) or set()
            clear = [fn for fn in hits if not (mine & dates_of(fn))] or hits
        if len(clear) == 1:
            mapping[n] = clear[0]
            resolved.append(f"{n} -> {clear[0]} (the other {len(hits) - 1} were "
                            "already refereeing on dates he worked)")
        else:
            ambiguous.append(f"{n} could be any of: {', '.join(clear)}")

    return mapping, merges + resolved, ambiguous


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
    by_name = {}
    for fx in fixtures or []:
        nm, d = fx.get("ref"), fx.get("d") or fx.get("date")
        if nm and d:
            by_name.setdefault(nm, set()).add(str(d)[:10])
    canon, merges, ambiguous = canonical_referees(
        [fx.get("ref") for fx in fixtures or []], by_name)
    if merges:
        print(f"  merged {len(merges)} abbreviated referee names into their "
              "full spelling:")
        for m in merges:
            print("    " + m)
    for a in ambiguous:
        print("  NOT merged (ambiguous): " + a)

    index, played = {}, set()
    for fx in fixtures or []:
        key = match_key(fx.get("d"), leagues.canon_name(code, fx.get("hn") or fx.get("h")),
                        leagues.canon_name(code, fx.get("an") or fx.get("a")))
        if not key:
            continue
        played.add(key)
        ref = (fx.get("ref") or "").strip()
        if ref:
            index[key] = canon.get(ref, ref)

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


def build_refs(tally, prev, min_matches, pens=None):
    """The ranked referee rows. Pure, so the rates are unit-testable.

    `pens` is the hand-seeded penalty column (see seeded_pens). Optional so
    every existing caller and test keeps its exact behaviour."""
    pens = pens or {}
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
            # The seed wins over the carried value; see seeded_pens.
            "pen_pg": pens.get(key, old.get("pen_pg")),
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


def patch_pens_only(league, dry_run=False):
    """Update the pen column from data/ref_pens.json and touch nothing else.

    ONE FIELD, IN PLACE — not a rewritten block. The full build regenerates the
    whole REFS literal from its own computation, which is correct for it and
    wrong here for two reasons: it needs a season CSV this cannot always fetch,
    and the shipped rows now carry fields it does not know about. An official
    BORROWED from another division (data/cross_refs.py) is marked with one, and
    re-emitting the block through refs_block would drop that marker while
    appearing to succeed — the row would stay, silently reclassified as a
    measured record of this division.

    Returns (updated, missing, total).
    """
    path = league.path(league.data_file)
    if not path.exists():
        return 0, [], 0
    pens = seeded_pens(league)
    if not pens:
        return 0, [], 0
    src = path.read_text(encoding="utf-8")
    block = re.search(r"const REFS = \[(.*?)\];", src, re.S)
    if not block:
        sys.exit(f"ERROR: could not find the REFS block in {league.data_file}.")

    seen, updated = set(), 0
    ROW = re.compile(r"(\{n:(\".*?\"),region:\".*?\",matches:(?:null|[\d.]+),"
                     r"ypg:(?:null|[\d.]+),red:(?:null|[\d.]+),pen:)(null|[\d.]+)")

    def sub(m):
        nonlocal updated
        name = json.loads(m.group(2))
        parts = name.split()
        key = (parts[0][0] + " " + parts[-1]).lower()
        if key not in pens:
            return m.group(0)
        seen.add(key)
        want = repr(pens[key]) if pens[key] != int(pens[key]) else str(pens[key])
        if m.group(3) == want:
            return m.group(0)
        updated += 1
        return m.group(1) + want

    body, n = ROW.subn(sub, block.group(1))
    if not n:
        sys.exit(f"ERROR: no referee rows matched in {league.data_file} — the row "
                 "format has changed and this would have reported 0 updates "
                 "rather than failing.")
    missing = sorted(k for k in pens if k not in seen)
    if updated and not dry_run:
        path.write_text(src[:block.start(1)] + body + src[block.end(1):],
                        encoding="utf-8")
    return updated, missing, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default="PL",
                    help="league code (%s)" % ", ".join(sorted(leagues.LEAGUES)))
    ap.add_argument("--season", default="2526", help="football-data season code (e.g. 2526)")
    ap.add_argument("--csv", help="local season CSV instead of fetching")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the ranking, write nothing")
    ap.add_argument("--pens-only", action="store_true",
                    help="apply data/ref_pens.json to the shipped table and do "
                         "nothing else — no fetch, no recomputation")
    args = ap.parse_args()

    if args.pens_only:
        for code in sorted(leagues.LEAGUES) if args.league == "ALL" else [args.league]:
            L = leagues.LEAGUES[code]
            updated, missing, rows = patch_pens_only(L, args.dry_run)
            print(f"{L.name}: {updated} of {rows} referee row(s) given a penalty rate"
                  + (" (--dry-run: nothing written)" if args.dry_run and updated else ""))
            for k in missing:
                print(f"  WARNING: data/ref_pens.json names '{k}' for {code}, and no "
                      "official in that table matches — the figure is being kept "
                      "and applied to nobody")
        return

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

    refs = build_refs(tally, previous_details(league), league.min_ref_matches,
                      seeded_pens(league))
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

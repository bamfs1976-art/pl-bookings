#!/usr/bin/env python3
"""The Champions League referee record: who refereed which European match, and
the cards and fouls in it.

Called from data/harvest_ucl.py --refs. Writes two files:

  data/ucl_ref_fixtures.js  const UCL_REF_FIXTURES = {fixture id: record}
                            The source of truth, one row a finished match,
                            committed so every run only fetches what is new.
  data/ucl_refs.js          const UCL_REFS = [...]   one row a referee
                            const UCL_REF_BASE = {...} the competition average

WHY A EUROPEAN RECORD AND NOT THE DOMESTIC ONE. A referee's card rate is
competition-specific (docs/champions-league-feasibility.md §4). Glenn Nyberg
shows about 2.6 cards a game in the Champions League; Felix Zwayer about 5.1.
Until 13 October 2026 the /europe page priced every tie at a neutral referee,
and Atlético v Man Utd under Nyberg read as the hotter of that night's two
priced ties when it was the cooler.

THE SAME ARITHMETIC AS THE DESKS. The record is mapped onto the football-data
row shape (Referee, HY, AY, HR, AR, HF, AF) and handed to
build_refs.tally_refs and build_refs.build_refs, so yellows per game and cards
per foul are computed by the code every league desk already uses, not a second
copy of it. The baseline the page divides by is this competition's own.

WHAT COUNTS. The league phase (and the group stage before 2024-25) and the
knockout rounds. Qualifying is excluded: a July tie between two champions of
small leagues is a different game with different referees, and API-Football's
competition 2 includes it (the feasibility probe's first, wrong reading came
from exactly that).

WHAT IT COSTS. /fixtures?ids= takes twenty ids and returns each fixture whole,
statistics and events inlined, so a matchday of eighteen ties is one call and a
season about ten. Only finished fixtures not already in the record are asked
for. The season lists come from the call harvest_ucl.py already makes; a past
season is listed only by --backfill, and only while it has no records.
"""

import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent

FIXTURES_FILE = "ucl_ref_fixtures.js"
FIXTURES_CONST = "UCL_REF_FIXTURES"
REFS_FILE = "ucl_refs.js"
MIN_MATCHES = 3          # the floor extend_ref_history.py uses for a record
BATCH = 20               # /fixtures?ids= accepts at most twenty
FINISHED = {"FT", "AET", "PEN"}

# League phase / group stage and the knockouts. "Play-offs" on its own is the
# QUALIFYING play-off; the league-phase one is "Knockout Round Play-offs".
#
# ANY ROUND THAT STARTS "Group", not just "Group Stage". The first backfill
# recorded 2023-24's 29 knockout matches and none of its 96 group games: the
# feed labels that season's group rounds per group, and "group stage" alone
# rejected every one. Qualifying rounds never start with "Group".
IN_PHASE = re.compile(
    r"^(league stage|group\b|knockout round play-offs|round of 16|"
    r"quarter-finals|semi-finals|final)\b", re.I)

# A past season counts as recorded once it holds this many matches. A single
# knockout round must not mark a season done (2023-24 sat at 29 of 125).
SEASON_COMPLETE = 100


def in_phase(round_name):
    return bool(IN_PHASE.match((round_name or "").strip()))


def referee_name(raw):
    """'Glenn Nyberg, Sweden' -> 'Glenn Nyberg'; blank -> None."""
    name = (raw or "").split(",")[0].strip()
    return name or None


def skipped_rounds(entries):
    """{round: count} of FINISHED fixtures the phase filter rejected. Printed
    every run, so a round label the filter does not know is visible in the
    log the day it appears instead of a season quietly missing its group games."""
    out = {}
    for e in entries or []:
        fx = (e or {}).get("fixture") or {}
        rnd = (((e or {}).get("league") or {}).get("round") or "").strip()
        if ((fx.get("status") or {}).get("short")) in FINISHED and not in_phase(rnd):
            key = re.sub(r"\s*-\s*\d+$", " - n", rnd) or "(none)"
            out[key] = out.get(key, 0) + 1
    return out


def wanted(entries, seen):
    """Fixture ids worth fetching: finished, in phase, refereed, not recorded."""
    out = []
    for e in entries or []:
        fx = (e or {}).get("fixture") or {}
        lg = (e or {}).get("league") or {}
        fid = fx.get("id")
        if fid is None or str(fid) in seen:
            continue
        if ((fx.get("status") or {}).get("short")) not in FINISHED:
            continue
        if not in_phase(lg.get("round")) or not referee_name(fx.get("referee")):
            continue
        out.append(fid)
    return out


def _num(v):
    if v is None:
        return 0
    try:
        return int(str(v).strip().rstrip("%"))
    except ValueError:
        return None


def record(entry):
    """One full /fixtures?ids= response row as a record, or None.

    Cards and fouls come from the inlined STATISTICS block, not from counting
    events: data/probe_penalties.py found the inlined events disagree with
    /fixtures/events on the same matches. If statistics are absent the cards
    fall back to the events (a second yellow and its red counted once) and
    fouls stay unknown, which build_refs already handles: no cards-per-foul
    for that match, yellows still count.
    """
    fx = (entry or {}).get("fixture") or {}
    lg = (entry or {}).get("league") or {}
    tm = (entry or {}).get("teams") or {}
    ref = referee_name(fx.get("referee"))
    if not ref or not in_phase(lg.get("round")):
        return None
    if ((fx.get("status") or {}).get("short")) not in FINISHED:
        return None
    hid = (tm.get("home") or {}).get("id")
    side = {}
    for block in (entry or {}).get("statistics") or []:
        tid = ((block or {}).get("team") or {}).get("id")
        stats = {s.get("type"): s.get("value") for s in (block or {}).get("statistics") or []}
        side["H" if tid == hid else "A"] = stats
    rec = {"s": lg.get("season"), "r": (lg.get("round") or "").strip(), "ref": ref}
    if len(side) == 2:
        for k in ("H", "A"):
            rec[k + "Y"] = _num(side[k].get("Yellow Cards"))
            rec[k + "R"] = _num(side[k].get("Red Cards"))
            rec[k + "F"] = _num(side[k].get("Fouls"))
        if any(rec[k] is None for k in ("HY", "AY", "HR", "AR")):
            return None
        return rec
    # Events fallback: cards only.
    cards = {"H": [0, 0], "A": [0, 0]}
    per_player = {}
    for ev in (entry or {}).get("events") or []:
        if (ev or {}).get("type") != "Card":
            continue
        k = "H" if ((ev.get("team") or {}).get("id")) == hid else "A"
        who = (k, ((ev.get("player") or {}).get("id")))
        detail = (ev.get("detail") or "").lower()
        per_player.setdefault(who, []).append("R" if "red" in detail else "Y")
    for (k, _), kinds in per_player.items():
        y, r = kinds.count("Y"), kinds.count("R")
        if y >= 2 and r:
            y -= 1                    # the second yellow IS the red
        cards[k][0] += y
        cards[k][1] += r
    if not per_player and not (entry or {}).get("events"):
        return None                   # neither block came back: not a 0-0 in cards
    rec.update({"HY": cards["H"][0], "HR": cards["H"][1], "HF": None,
                "AY": cards["A"][0], "AR": cards["A"][1], "AF": None})
    return rec


def as_football_data(records):
    """Records in the row shape build_refs.tally_refs reads."""
    rows = []
    for r in records.values():
        row = {"Referee": r["ref"], "HY": r["HY"], "AY": r["AY"],
               "HR": r["HR"], "AR": r["AR"]}
        if r.get("HF") is not None and r.get("AF") is not None:
            row["HF"], row["AF"] = r["HF"], r["AF"]
        rows.append(row)
    return rows


def canonicalise(records):
    """Fold spelling variants of one official ("G. Nyberg" / "Glenn Nyberg")
    with the desks' own rule, so a career is not split across two rows."""
    import build_refs
    names = sorted({r["ref"] for r in records.values()})
    mapping, merges, _ = build_refs.canonical_referees(names)
    out = {}
    for fid, r in records.items():
        r = dict(r)
        r["ref"] = mapping.get(r["ref"], r["ref"])
        out[fid] = r
    return out, merges


def build(records, min_matches=MIN_MATCHES):
    """(referee rows, competition baseline). Pure: the tests call this."""
    import build_refs
    recs, _ = canonicalise(records)
    tally, _ = build_refs.tally_refs(as_football_data(recs))
    rows = build_refs.build_refs(tally, {}, min_matches)
    seasons = {}
    for r in recs.values():
        seasons.setdefault(r["ref"], set()).add(r["s"])
    refs = [{"n": x["name"], "matches": x["matches"], "ypg": x["ypg"],
             "red": x["red_pg"], "fpg": x["fouls_pg"], "cpf": x["cards_per_foul"],
             "seasons": sorted(s for s in seasons.get(x["name"], ()) if s)}
            for x in rows]
    # THE BASELINE IS EVERY RECORDED MATCH, including referees under the floor:
    # it is the competition's average, not the average of the rated officials.
    m = sum(d["matches"] for d in tally.values())
    y = sum(d["yellows"] for d in tally.values())
    rd = sum(d["reds"] for d in tally.values())
    fm = sum(d["foul_matches"] for d in tally.values())
    fouls = sum(d["fouls"] for d in tally.values())
    y_fm = sum(d["yellows"] * (d["foul_matches"] / d["matches"])
               for d in tally.values() if d["matches"])
    base = {"matches": m,
            "avgYpg": round(y / m, 3) if m else None,
            "avgRed": round(rd / m, 3) if m else None,
            "avgCpf": round(y_fm / fouls, 4) if fouls else None,
            "foulMatches": fm}
    return refs, base


def load_records(path=None):
    """The committed record, or {} when there is none yet. A file that will
    not parse stops the run: read as empty it would re-walk every season."""
    path = path or DATA / FIXTURES_FILE
    if not path.exists():
        return {}
    src = path.read_text(encoding="utf-8")
    start, end = src.find("{"), src.rfind("}")
    try:
        doc = json.loads(src[start:end + 1]) if start >= 0 else {}
    except ValueError:
        raise SystemExit(f"ERROR: {path.name} is present but will not parse. "
                         "Delete it deliberately to force a re-walk.")
    return doc if isinstance(doc, dict) else {}


def write(records, refs, base, out_dir=None):
    out_dir = out_dir or DATA
    seasons = sorted({r["s"] for r in records.values() if r.get("s")})
    span = f"{seasons[0]}-{seasons[-1] % 100 + 1:02d}" if seasons else "none"
    (out_dir / FIXTURES_FILE).write_text(
        "// Auto-generated by data/harvest_ucl.py --refs. Do not edit by hand.\n"
        "// UEFA Champions League referee record, one row a finished match:\n"
        "// league phase and knockouts only, excludes qualifying. Source of\n"
        "// truth for data/ucl_refs.js; each run fetches only what is new.\n"
        f"const {FIXTURES_CONST} = "
        + json.dumps(dict(sorted(records.items(), key=lambda kv: int(kv[0]))),
                     ensure_ascii=False, separators=(",", ":"))
        + ";\n", encoding="utf-8")
    lines = [
        "// Auto-generated by data/harvest_ucl.py --refs. Do not edit by hand.",
        f"// UEFA Champions League referees, {span}: {len(refs)} rated "
        f"(>= {MIN_MATCHES} matches) from {base['matches']} matches,",
        "// league phase and knockouts only, excludes qualifying. Rates are",
        "// European, not domestic; UCL_REF_BASE is the competition average",
        "// the /europe page divides by.",
        "const UCL_REF_BASE = " + json.dumps(base) + ";",
        "const UCL_REFS = [",
    ]
    for r in refs:
        lines.append("  " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) + ",")
    lines.append("];")
    (out_dir / REFS_FILE).write_text("\n".join(lines) + "\n", encoding="utf-8")


def fetch(host, key, ids):
    """Records for these fixture ids, twenty a call."""
    import harvest_apifootball as af
    out = {}
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        payload = af._get(host, key, "fixtures", {"ids": "-".join(str(x) for x in chunk)})
        errs = af.api_errors(payload)
        if errs:
            raise SystemExit(f"ERROR: /fixtures?ids= refused: {errs}")
        for e in (payload or {}).get("response") or []:
            rec = record(e)
            if rec:
                out[str(((e.get("fixture") or {}).get("id")))] = rec
    return out


def update(host, key, entries_by_season):
    """Fetch what is new across these season lists, merge, rebuild, write."""
    records = load_records()
    seen = set(records)
    ids = []
    for season, entries in sorted(entries_by_season.items()):
        got = wanted(entries, seen)
        print(f"  UCL referee record: season {season}, {len(got)} new finished "
              "match(es) to fetch")
        skip = skipped_rounds(entries)
        if skip:
            print("    finished but not counted (qualifying etc.): "
                  + ", ".join(f"{k} x{v}" for k, v in sorted(skip.items())))
        ids += got
    fresh = fetch(host, key, ids) if ids else {}
    records.update(fresh)
    if not records:
        print("  UCL referee record: nothing recorded yet, nothing written.")
        return 0
    refs, base = build(records)
    write(records, refs, base)
    print(f"  {REFS_FILE} written: {len(refs)} referee(s) rated from "
          f"{base['matches']} matches, {base['avgYpg']} yellows a game "
          f"({len(fresh)} new this run)")
    return len(fresh)


def seasons_recorded(records=None, complete=SEASON_COMPLETE):
    """Seasons holding at least `complete` matches: the ones a backfill skips."""
    records = load_records() if records is None else records
    n = {}
    for r in records.values():
        if r.get("s"):
            n[int(r["s"])] = n.get(int(r["s"]), 0) + 1
    return {s for s, c in n.items() if c >= complete}

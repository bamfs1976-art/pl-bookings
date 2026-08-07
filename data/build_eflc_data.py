#!/usr/bin/env python3
"""
Build the EFL Championship Bookings Desk dataset for 2026-27.

The second desk. It reuses the Premier League builder's arithmetic rather than
copying it — the risk formula, the per-90 conversions, the fouls-won key
fallbacks and the squad-coverage rule all come from build_pl_data.py, so the
two desks cannot drift about what a booking risk is.

WHERE THE FORM COMES FROM. The Championship desk is the mirror image of the
Premier League one. Most of its clubs were in the division last season; the
interesting minority were not:

  18 clubs  2025-26 Championship form   basis EFLC   champ_promoted.json
   3 clubs  2025-26 Premier League form basis PL     pl_af_players.json
            (Burnley, West Ham, Wolves — relegated, so last season's record is
            from a higher division. Flagged, because a foul rate earned in the
            Premier League is not the same evidence as one earned here.)
   3 clubs  2025-26 League One form     basis L1     l1_players.json
            (Lincoln, Cardiff, Bolton — promoted. Optional: absent, they carry
            no form and are flagged NEW.)

All three come from data/harvest_apifootball.py, one division per run:

    python3 data/harvest_apifootball.py --league EFLC
    python3 data/harvest_apifootball.py --league L1
    python3 data/harvest_apifootball.py --league PL --out pl_af_players.json

The last writes a SEPARATE file rather than pl_players.json. pl_data.js is
still built on a ScoutingStats basis, and changing that moves every published
number on the live Premier League desk — a decision of its own. This desk can
take the better source without making it.

CLUB CARD RATES COME FROM THE FREE MATCH RECORDS, NOT THE FEED. The Premier
League desk omits its promoted clubs' team rates because Championship minutes
in the ScoutingStats feed include cup games, which makes a per-game aggregate
incomparable. That limitation does not apply here: football-data.co.uk
publishes every Championship match with both sides' cards, so this desk counts
them directly and gets an exact league-only rate, with the home/away split
built in from the start rather than patched on afterwards. The six clubs who
were not in the division last season have no such record and stay null, which
is what the app's league-median fallback is for.

Usage:
    python3 data/build_eflc_data.py                     # fetch season 2526
    python3 data/build_eflc_data.py --season 2526
    python3 data/build_eflc_data.py --csv path/E1.csv   # offline club rates
    python3 data/build_eflc_data.py --no-club-rates     # skip them entirely

Output: data/eflc_data.js (CLUBS, EFLC_PLAYERS, REFS), the same shape as
pl_data.js so build_refs.py --league EFLC patches its REFS block unchanged.
"""

import argparse
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402
import build_pl_data as P  # noqa: E402

# Written on EVERY run, success or failure, and committed. A build that fails
# inside a continue-on-error workflow step leaves no trace in the repository:
# the run goes green, nothing is committed, and the only record is a log pane
# somebody has to open and read back. That is a poor way to run a pipeline and
# a worse way to ask someone else to.
STATUS = DATA / "eflc_status.txt"


def write_status(lines):
    STATUS.write_text("\n".join(str(x) for x in lines) + "\n", encoding="utf-8")

LEAGUE = leagues.get("EFLC")
OUT = DATA / LEAGUE.data_file
MATCHES = 46          # a Championship season, for the per-game team rates
MIN_VENUE = 8         # below this a venue split is noise


def resolve(name):
    return leagues.eflc_short(name)


def rows_for(payload, keep, basis, unmapped):
    """Source rows for the clubs in `keep`, as shipped player rows.

    Every club name that resolves to nothing is recorded rather than dropped.
    An unmapped club is the failure mode this build is most exposed to — the
    24 were derived from a chain of confirmed moves, not read off one list —
    and it looks exactly like a club that simply has no players.
    """
    out = []
    for p in payload or []:
        name = (p.get("team") or "").strip()
        short = resolve(name)
        if not short:
            # A club the PREMIER LEAGUE desk knows is not an unmapped name, it
            # is a club that changed division — Coventry, Ipswich and Hull are
            # in a 2025-26 Championship harvest and belong to the other desk.
            # Reporting those as failures buries a real misspelling among them.
            if name and name not in P.SHORT:
                unmapped[name] = unmapped.get(name, 0) + 1
            continue
        if short not in keep:
            continue
        row = P.mk(p, basis, resolve=resolve)
        if row:
            out.append(row)
    return out


def season_cards():
    """{(short, name): (cautions, minutes)} for the season BEING PLAYED.

    Separate from the form, and it has to be: everything else here is 2025-26
    evidence, while a suspension ladder is 2026-27 state. Using last season's
    `yc` would tell a reader a player is one booking from a ban on the
    strength of cards that no longer count. Absent before the season starts,
    which is why every field it feeds is allowed to be null.
    """
    rows = P.load_optional("eflc_season_cards.json")
    if not rows:
        return {}
    out = {}
    for r in rows or []:
        short = resolve((r.get("team") or "").strip())
        name = (r.get("n") or "").strip()
        if short and name:
            out[(short, name)] = (r.get("yc"), r.get("min"))
    return out


def build_players():
    """Every Championship player, one row each, best basis wins."""
    unmapped, reused = {}, []
    shipped = shipped_rows()
    all_shorts = set(leagues.EFLC_CLUBS.values())
    continuing = all_shorts - leagues.EFLC_FROM_PL - leagues.EFLC_FROM_L1

    rows = []
    # Order matters: the de-duplication below keeps the FIRST row for a
    # (club, name), so the better-evidenced basis has to be loaded first. A
    # real rate must never be overwritten by a blank one.
    for payload, keep, basis, src in (
        (source("champ_promoted.json", "EFLC", shipped, reused), continuing, "EFLC", "Championship"),
        # Burnley, West Ham and Wolves were in the Premier League last season,
        # so their form is a PL record. pl_af_players.json is the API-Football
        # harvest of that division, kept SEPARATE from pl_players.json on
        # purpose: pl_data.js is still built on a ScoutingStats basis, and
        # changing that moves every published number on the live desk. This
        # desk can use the better source without deciding that for the other.
        (source("pl_af_players.json", "PL", shipped, reused)
         or source("pl_players.json", "PL", shipped, reused),
         leagues.EFLC_FROM_PL, "PL", "Premier League"),
        (source("l1_players.json", "L1", shipped, reused), leagues.EFLC_FROM_L1, "L1", "League One"),
        (source("eflc_squads.json", "NEW", shipped, reused), all_shorts, "NEW", "squad fill"),
    ):
        got = rows_for(payload, keep, basis, unmapped)
        if got:
            print(f"  {basis:5} {len(got):4} players from the {src} feed")
        rows.extend(got)

    if reused:
        print("Reusing the previous build for sources that did not harvest:")
        for r in reused:
            print("  - " + r)

    seen, deduped = set(), []
    for r in rows:
        key = (r["c"], r["n"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)

    # This season's cautions where known. NOT defaulted to zero: "no data" and
    # "no cards yet" look identical on a strip that says a ban is one booking
    # away, and only one of them is safe to act on.
    live = season_cards()
    for r in deduped:
        got = live.get((r["c"], r["n"]))
        r["_sc"], r["_sm"] = (got if got else (None, None))
    return deduped, unmapped


def source(name, basis, shipped, reused):
    """This run's harvest for one source, or the last build's rows for it."""
    fresh = P.load_optional(name)
    if fresh:
        return fresh
    kept = shipped.get(basis, [])
    if kept:
        reused.append(f"{name} ({len(kept)} players kept from the previous build)")
    return kept


NAME_BY_SHORT = {v: k for k, v in leagues.EFLC_CLUBS.items()}


def shipped_rows():
    """The last good build, back in the source shape mk() consumes."""
    if not OUT.exists():
        return {}
    src = OUT.read_text(encoding="utf-8")
    imgs = {c["short"]: c.get("img") for c in js_array(src, "CLUBS")}
    out = {}
    for p in js_array(src, "EFLC_PLAYERS"):
        out.setdefault(p.get("b"), []).append({
            "team": NAME_BY_SHORT.get(p["c"]), "n": p["n"],
            "pos": P.POS_NAME.get(p.get("p"), p.get("p")),
            "min": p.get("min"), "yc": p.get("yc"), "rc": p.get("rc"),
            "fc90": p.get("f"), "fd90": p.get("fw"),
            "tid": None, "img": imgs.get(p["c"]),
        })
    return out


def js_array(src, name):
    """Same parse as build_pl_data's, pointed at this league's file."""
    import re
    m = re.search(r"^const " + name + r" = \[$(.*?)^\];$", src, re.S | re.M)
    if not m:
        raise SystemExit(f"ERROR: {OUT.name} has no `const {name} = [` block, so "
                         "it cannot serve as the previous build.")
    body = P.quote_keys(m.group(1)).strip().rstrip(",")
    return json.loads("[" + body + "]")


def club_card_rates(rows):
    """short -> (cards/game, home rate, away rate) from the free match records.

    Counted directly off league matches, so unlike the ScoutingStats aggregate
    this is league-only and exact. Cards are yellows plus reds, matching how
    the Premier League desk's `ca` is composed.
    """
    tally = {}
    for r in rows:
        try:
            hy, ay, hr, ar = (int(r["HY"]), int(r["AY"]), int(r["HR"]), int(r["AR"]))
        except (KeyError, TypeError, ValueError):
            continue
        h, a = resolve(r.get("HomeTeam")), resolve(r.get("AwayTeam"))
        if h:
            t = tally.setdefault(h, [0, 0, 0, 0])
            t[0] += hy + hr
            t[1] += 1
        if a:
            t = tally.setdefault(a, [0, 0, 0, 0])
            t[2] += ay + ar
            t[3] += 1
    out = {}
    for short, (hc, hn, ac, an) in tally.items():
        if hn + an < MIN_VENUE:
            continue
        overall = round((hc + ac) / (hn + an), 2)
        home = round(hc / hn, 2) if hn >= MIN_VENUE else None
        away = round(ac / an, 2) if an >= MIN_VENUE else None
        out[short] = (overall, home, away)
    return out


def build_clubs(players, rates):
    by = {}
    for p in players:
        d = by.setdefault(p["c"], {"short": p["c"], "img": None,
                                   "bases": [], "fouls": 0.0, "players": 0})
        # First NON-NULL crest — see build_pl_data.build_clubs. The FPL
        # fill-in rows carry no badge, and they sort first for some clubs.
        if d["img"] is None and p["_img"]:
            d["img"] = p["_img"]
        d["bases"].append(p["b"])
        d["fouls"] += p["_fouls"]
        d["players"] += 1
    clubs = []
    for short, d in by.items():
        ca, ca_h, ca_a = rates.get(short, (None, None, None))
        bases = set(d["bases"])
        # The club label says what the TEAM aggregate rests on, not what any
        # one player's rate does. A club with a real Championship match record
        # is EFLC whatever mix of player bases fills its squad.
        basis = "EFLC" if ca is not None else ("PL" if bases <= {"PL", "NEW"} else "L1")
        clubs.append({
            "short": short, "name": NAME_BY_SHORT.get(short, short),
            "img": d["img"], "basis": basis, "ca": ca, "caH": ca_h, "caA": ca_a,
            # Fouls per match stays off the player feed: the match records
            # carry fouls too, but per CLUB they are only in the same file the
            # cards came from, so this reuses what is already summed.
            "fm": (round(d["fouls"] / MATCHES, 1) if ca is not None else None),
            "squad": d["players"],
        })
    clubs.sort(key=lambda x: (x["ca"] is None, -(x["ca"] or 0)))
    return clubs


def build_refs():
    path = DATA / LEAGUE.refs_file
    if path.exists():
        refs = list(json.loads(path.read_text(encoding="utf-8"))["refs"])
    else:
        refs = []
        print(f"  no {LEAGUE.refs_file} — run: python3 data/build_refs.py --league EFLC")
    refs.sort(key=lambda r: -(r.get("ypg") or 0))
    return refs


def emit(clubs, players, refs):
    j = P.jsval
    lines = [
        "// Auto-generated by build_eflc_data.py. 2025-26 form.",
        "// 2026-27 EFL Championship. Clubs relegated from the Premier League carry",
        "// PL-basis player form, clubs promoted from League One carry L1 or none (NEW).",
        "// Club card rates are counted from the free football-data.co.uk E1 records.",
        "// The league's suspension rule, from data/leagues.py — shipped so the",
        "// page computes with it instead of hardcoding thresholds that could",
        "// drift from the registry.",
        "const SUSPENSION = " + json.dumps(LEAGUE.suspension_scheme) + ";",
        "const CLUBS = [",
    ]
    for c in clubs:
        lines.append("  {" + ",".join([
            f'short:{j(c["short"])}', f'name:{j(c["name"])}', f'img:{j(c["img"])}',
            f'basis:{j(c["basis"])}', f'ca:{j(c["ca"])}', f'caH:{j(c["caH"])}',
            f'caA:{j(c["caA"])}', f'fm:{j(c["fm"])}', f'squad:{c["squad"]}',
        ]) + "},")
    lines.append("];")
    lines.append("const EFLC_PLAYERS = [")
    for p in sorted(players, key=lambda x: (x["c"], x["r"] is None, -(x["r"] or 0), x["n"] or "")):
        lines.append("  {" + ",".join([
            f'c:{j(p["c"])}', f'n:{j(p["n"])}', f'p:{j(p["p"])}', f'min:{p["min"]}',
            f'yc:{j(p["yc"])}', f'rc:{j(p["rc"])}', f'y:{j(p["y"])}', f'f:{j(p["f"])}',
            f'fw:{j(p["fw"])}', f'r:{j(p["r"])}', f'ls:{j(p["ls"])}', f'b:{j(p["b"])}',
            # THIS season: cautions and minutes so far, null until harvested.
            f'sc:{j(p.get("_sc"))}', f'sm:{j(p.get("_sm"))}',
        ] + ([f'ph:{j(p["ph"])}'] if p.get("ph") else [])
          + (['inj:true'] if p.get("inj") else []) + [
        ]) + "},")
    lines.append("];")
    lines.append("const REFS = [")
    for r in refs:
        lines.append("  {" + ",".join([
            f'n:{j(r["name"])}', f'region:{j(r.get("region") or "")}',
            f'matches:{j(r.get("matches"))}', f'ypg:{j(r.get("ypg"))}',
            f'red:{j(r.get("red_pg"))}', f'pen:{j(r.get("pen_pg"))}',
            f'fpg:{j(r.get("fouls_pg"))}', f'cpf:{j(r.get("cards_per_foul"))}',
        ]) + "},")
    lines.append("];")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2526", help="football-data season code for club rates")
    ap.add_argument("--csv", help="local E1 season CSV instead of fetching")
    ap.add_argument("--no-club-rates", action="store_true",
                    help="skip the match-records step; clubs get null rates")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what the harvest resolved to, write nothing")
    args = ap.parse_args()

    print("EFL Championship 2026-27")
    status = ["EFL Championship 2026-27 — build_eflc_data.py"]
    players, unmapped = build_players()

    by_basis = {}
    for p in players:
        by_basis[p["b"]] = by_basis.get(p["b"], 0) + 1
    status.append(f"players: {len(players)}  by basis: "
                  + ", ".join(f"{k}={v}" for k, v in sorted(by_basis.items())))
    have_now = sorted({p["c"] for p in players})
    status.append(f"clubs with players: {len(have_now)} of 24")

    # Everything wrong is reported together. On a first run against a fresh
    # harvest the diagnosis IS the output — which club names a feed uses is
    # the one thing that cannot be known without seeing the feed, and finding
    # out one club at a time across four runs is a poor way to learn it.
    faults = []
    if unmapped:
        print("\nClub names nothing could be resolved to (clubs that merely "
              "changed division are not listed):")
        for name, n in sorted(unmapped.items(), key=lambda kv: -kv[1]):
            print(f"  {n:5} rows  {name!r}")
        print("  -> add each to leagues.EFLC_ALIASES (or fix EFLC_CLUBS if the "
              "lineup itself is wrong). These rows are NOT in the build.")
        status.append("unresolved club names: "
                      + ", ".join(f"{n} ({c} rows)" for n, c in
                                  sorted(unmapped.items(), key=lambda kv: -kv[1])))

    have = {p["c"] for p in players}
    missing = sorted(set(leagues.EFLC_CLUBS.values()) - have)
    if missing:
        faults.append(f"{len(missing)} of 24 clubs have no players at all: "
                      + ", ".join(missing))
    # Only the clubs that DID produce players — an absent club is already named
    # once above, and naming it 24 more times buries the squads that are merely
    # thin, which is the subtler and more dangerous fault of the two.
    faults += P.coverage_problems(players, clubs=have)

    if faults:
        print(f"\n{len(faults)} problem(s):")
        for f in faults:
            print("  - " + f)
        write_status(status + ["RESULT: NOT WRITTEN"]
                     + [f"problem: {f}" for f in faults])
        sys.exit(
            f"\n{OUT.name} was NOT written.\n\n"
            "Every club here is in the position the Premier League desk's\n"
            "promoted three are in: no higher-division feed sits behind any of\n"
            "them, so a thin squad cannot be filled in from elsewhere.\n\n"
            "The usual causes, in order:\n"
            "  1. The season ids are not pinned to 2025-26. Unset, ScoutingStats\n"
            "     returns the CURRENT season, and 2026-27 has barely kicked off —\n"
            "     so the harvest is real, recent and almost empty. Set\n"
            "     SS_SEASON_CH and SS_SEASON_PL and re-harvest.\n"
            "  2. Lincoln, Cardiff and Bolton came up from League One, which\n"
            "     nothing harvests yet. Their form needs a League One league id\n"
            "     (data/harvest.py fetches 8 and 9); without it they have no\n"
            "     rows at all.\n"
            "  3. A club is named something this build does not recognise —\n"
            "     see the unmapped list above.\n\n"
            "  --dry-run reports all of this without writing anything, which is\n"
            "  what a first run against a new harvest is for.")

    rates = {}
    if not args.no_club_rates:
        rows, where = leagues.load_rows(LEAGUE, season=args.season, csv_path=args.csv,
                                        agent="eflc-bookings")
        rates = club_card_rates(rows)
        print(f"\nclub card rates for {len(rates)} clubs from {len(rows)} matches via {where}")

    clubs = build_clubs(players, rates)
    refs = build_refs()
    rated = sum(1 for c in clubs if c["ca"] is not None)
    summary = (f"{len(clubs)} clubs ({rated} with a match-record rate), "
               f"{len(players)} players, {len(refs)} referees")
    if args.dry_run:
        print(f"\ndry run — would write {OUT.name}: {summary}")
        return
    emit(clubs, players, refs)
    write_status(status + [f"club rates from match records: {rated} of {len(clubs)}",
                           f"referees: {len(refs)}", "RESULT: WRITTEN " + OUT.name])
    print(f"\nwrote {OUT.name}: {summary}")


if __name__ == "__main__":
    main()

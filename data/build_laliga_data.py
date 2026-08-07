#!/usr/bin/env python3
"""
Build the La Liga Bookings Desk dataset for 2026-27.

The third desk, and the first outside British football. It reuses the Premier
League builder's arithmetic — the risk formula, the per-90 conversions, the
fouls-won fallbacks, the squad-coverage rule all come from build_pl_data.py —
so no desk can drift from another about what a booking risk is.

WHY SPAIN IS THE EXPENSIVE ONE, AND WHAT IT ACTUALLY COSTS

Every referee number the English desks show comes free: football-data.co.uk
names the official on every English and Scottish match and effectively nowhere
else (0 of 33 seasons for Spain — see docs/la-liga-feasibility.md). What it
DOES publish for Spain, at full coverage, is every card and every foul in every
match. So the only thing missing is a name, and the only thing bought is a
name: one /fixtures call for the completed season, joined onto the free rows by
date and both clubs, after which build_refs.py computes yellows/game,
fouls/game and cards-per-foul off data that stayed free and public domain.

Club card rates here are therefore EXACT and league-only, counted straight off
the match records with the home/away split built in — the same as the
Championship desk and better than the Premier League's feed-derived aggregate.

THE DIVISION NAMES ITSELF

Unlike the Championship, whose 24 clubs are declared in leagues.py from a chain
of six separately-confirmed promotions and relegations, La Liga's twenty are
DISCOVERED from API-Football and written to laliga_clubs.json. That chain was
already the weakest link in this repo — a wrong link produces a club with no
players and no error anywhere — and Spain's 2026-27 line-up could not be
confirmed from a primary source. So the feed that supplies the squads also
declares the division, and the two can never disagree.

WHICH CLUBS ARE PROMOTED IS ALSO DERIVED, not listed. A club in the 2026-27
registry that appears in the 2025-26 match records was in the division last
season; one that does not, came up. That falls out of two files this build
already reads, so there is no third list to keep in step with reality.

  17 clubs  2025-26 La Liga form   basis LL    laliga_players.json
   3 clubs  2025-26 Segunda form   basis SEG   segunda_players.json
            (promoted. Flagged, because a foul rate earned in the second tier
            is not the same evidence as one earned in the first.)

Run order:
    python3 data/harvest_apifootball.py --league LL --clubs      # the division
    python3 data/harvest_apifootball.py --league LL              # squads
    python3 data/harvest_apifootball.py --league SEG             # promoted squads
    python3 data/build_laliga_data.py --season 2526              # this

Output: data/laliga_data.js (CLUBS, LALIGA_PLAYERS, REFS), the same shape as
pl_data.js and eflc_data.js, so build_refs.py --league LL patches its REFS
block unchanged.
"""

import argparse
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402
import build_pl_data as P  # noqa: E402

# Written on EVERY run, success or failure, and committed — the same reason
# eflc_status.txt exists. A build that fails inside a continue-on-error
# workflow step leaves no trace in the repository otherwise: the run goes
# green, nothing is committed, and the only record is a log pane somebody has
# to open and read back.
STATUS = DATA / "laliga_status.txt"

LEAGUE = leagues.get("LL")
OUT = DATA / LEAGUE.data_file
MATCHES = 38          # a La Liga season, for the per-game team rates
MIN_VENUE = 6         # below this a venue split is noise


def write_status(lines):
    STATUS.write_text("\n".join(str(x) for x in lines) + "\n", encoding="utf-8")


def fail(msg, notes=()):
    """Refuse to write, and leave the reason in the repository.

    Never partially writes. A short La Liga is not a smaller La Liga, it is a
    desk with clubs missing and no indication which — so the previous
    laliga_data.js stays exactly as it was.
    """
    write_status(["La Liga 2026-27 — build_laliga_data.py", *notes,
                  f"RESULT: REFUSED — {msg}"])
    sys.exit(f"ERROR: {msg}\n  (laliga_data.js NOT overwritten; see "
             f"{STATUS.name})")


def clubs_registry():
    clubs = leagues.load_clubs("LL")
    if not clubs:
        fail("no club registry — the division has not been discovered yet",
             ["Run: python3 data/harvest_apifootball.py --league LL --clubs"])
    if len(clubs) != LEAGUE.clubs:
        fail(f"the club registry holds {len(clubs)} clubs, not {LEAGUE.clubs}")
    return clubs


def resolve_with(clubs):
    """A name-to-short resolver bound to one registry, so every stage of the
    build agrees about the division even if the file changes underneath."""
    return lambda name: leagues.laliga_short(name, clubs=clubs)


def previous_players():
    """The last good build's rows, back in the shape P.mk consumes.

    A source that did not harvest today falls back to what it produced last
    time rather than vanishing — the same fallback both other desks use, so a
    failed Segunda harvest means "the promoted clubs' form is unchanged", not
    "three clubs have no players".
    """
    if not OUT.exists():
        return {}
    src = OUT.read_text(encoding="utf-8")
    imgs, names = {}, {}
    for c in js_array(src, "CLUBS"):
        imgs[c["short"]] = c.get("img")
        names[c["short"]] = c.get("name")
    out = {}
    for p in js_array(src, "LALIGA_PLAYERS"):
        out.setdefault(p.get("b"), []).append({
            "team": names.get(p["c"]), "n": p["n"],
            "pos": P.POS_NAME.get(p.get("p"), p.get("p")),
            "min": p.get("min"), "yc": p.get("yc"), "rc": p.get("rc"),
            "fc90": p.get("f"), "fd90": p.get("fw"),
            "tid": None, "img": imgs.get(p["c"]),
        })
    return out


def js_array(src, name):
    """Same parse as the other builders', pointed at this league's file."""
    import re
    m = re.search(r"^const " + name + r" = \[$(.*?)^\];$", src, re.S | re.M)
    if not m:
        fail(f"{OUT.name} has no `const {name} = [` block, so it cannot serve "
             "as the previous build")
    body = P.quote_keys(m.group(1)).strip().rstrip(",")
    try:
        return json.loads("[" + body + "]")
    except ValueError as e:
        # A previous build that cannot be read back is a corrupt previous
        # build. Saying so beats a JSONDecodeError traceback thirty frames
        # deep, which is what this did the first time it happened — the cause
        # was `True` where `true` belonged, and the message named neither the
        # file nor the block.
        fail(f"{OUT.name} exists but its {name} block does not parse ({e}). "
             "It cannot serve as the previous build; delete it to rebuild from "
             "the harvests alone.")


def source(name, basis, shipped, reused):
    """This run's harvest for one source, or the last build's rows for it."""
    fresh = P.load_optional(name)
    if fresh:
        return fresh
    kept = shipped.get(basis, [])
    if kept:
        reused.append(f"{name} ({len(kept)} players kept from the previous build)")
    return kept


def rows_for(payload, keep, basis, unmapped, resolve):
    """Source rows for the clubs in `keep`, as shipped player rows.

    Every club name that resolves to nothing is recorded rather than dropped.
    A Segunda harvest legitimately contains nineteen clubs this desk does not
    want, so "unmapped" here means only names that resolved to no club at all.
    """
    out = []
    for p in payload or []:
        name = (p.get("team") or "").strip()
        short = resolve(name)
        if not short:
            if name:
                unmapped[name] = unmapped.get(name, 0) + 1
            continue
        if short not in keep:
            continue
        row = P.mk(p, basis, resolve=resolve)
        if row:
            out.append(row)
    return out


def last_seasons_clubs(rows, resolve):
    """Canonical names of every club with a match in the free records.

    This is what makes the promoted three derivable rather than declared.
    Keyed by canonical NAME, not short code: a club that has since been
    relegated has no short code, and asking for one would quietly answer
    "not in the division last season" for a club that was.
    """
    seen = set()
    for r in rows:
        for side in ("HomeTeam", "AwayTeam"):
            n = leagues.canon_name("LL", r.get(side))
            if n:
                seen.add(n)
    return seen


def club_card_rates(rows, resolve):
    """short -> (cards/game, home rate, away rate) from the free match records.

    Counted directly off league matches, so this is league-only and exact.
    Cards are yellows plus reds, matching how every other desk composes `ca`.
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
        out[short] = (
            round((hc + ac) / (hn + an), 2),
            round(hc / hn, 2) if hn >= MIN_VENUE else None,
            round(ac / an, 2) if an >= MIN_VENUE else None,
        )
    return out


def season_cards(resolve):
    """{(short, name): (cautions, minutes)} for the season BEING PLAYED.

    A separate harvest from the form, and it has to be. Everything else on
    this desk is 2025-26 evidence; a suspension cycle is 2026-27 STATE, and
    RFEF art. 112 accumulation does not carry between seasons — so reusing
    last season's `yc` would tell a reader a player is one caution from a ban
    when the rules have him on zero. That is not a rounding error, it is a
    different fact.

    Absent before the season starts, which is the normal state in August and
    the reason every field this feeds is allowed to be null.
    """
    rows = P.load_optional("laliga_season_cards.json")
    if not rows:
        return {}
    out = {}
    for r in rows or []:
        short = resolve((r.get("team") or "").strip())
        name = (r.get("n") or "").strip()
        if not short or not name:
            continue
        out[(short, name)] = (r.get("yc"), r.get("min"))
    return out


def build_players(clubs, continuing, promoted, resolve):
    """Every La Liga player, one row each, best-evidenced basis first."""
    unmapped, reused = {}, []
    shipped = previous_players()
    rows = []
    # Order matters: de-duplication below keeps the FIRST row for a
    # (club, name), so a real rate can never be overwritten by a blank one.
    for payload, keep, basis, src in (
        (source(LEAGUE.players_file, "LL", shipped, reused), continuing, "LL", "La Liga"),
        (source("segunda_players.json", "SEG", shipped, reused), promoted, "SEG", "Segunda"),
        (source("laliga_squads.json", "NEW", shipped, reused),
         set(d["short"] for d in clubs.values()), "NEW", "squad fill"),
    ):
        got = rows_for(payload, keep, basis, unmapped, resolve)
        if got:
            print(f"  {basis:4} {len(got):4} players from the {src} feed")
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

    # This season's cautions, stamped on where they are known. NOT defaulted
    # to zero: "no data" and "no cards yet" look identical on a strip that
    # tells someone a ban is one booking away, and only one is safe to act on.
    live = season_cards(resolve)
    for r in deduped:
        got = live.get((r["c"], r["n"]))
        r["_sc"], r["_sm"] = (got if got else (None, None))
    return deduped, unmapped


def build_clubs(players, rates, clubs, promoted):
    by = {}
    for p in players:
        d = by.setdefault(p["c"], {"short": p["c"], "img": None, "bases": [],
                                   "fouls": 0.0, "players": 0})
        # First NON-NULL crest — see build_pl_data.build_clubs.
        if d["img"] is None and p["_img"]:
            d["img"] = p["_img"]
        d["bases"].append(p["b"])
        d["fouls"] += p["_fouls"]
        d["players"] += 1
    name_by_short = {d["short"]: n for n, d in clubs.items()}
    out = []
    for short, d in by.items():
        ca, ca_h, ca_a = rates.get(short, (None, None, None))
        # The club label says what the TEAM aggregate rests on, not what any
        # one player's rate does. A club with a real La Liga match record is
        # LL whatever mix of player bases fills its squad.
        basis = "LL" if ca is not None else ("SEG" if short in promoted else "NEW")
        out.append({
            "short": short, "name": name_by_short.get(short, short),
            "img": d["img"], "basis": basis, "ca": ca, "caH": ca_h, "caA": ca_a,
            "fm": round(d["fouls"] / MATCHES, 1) if ca is not None else None,
            "squad": d["players"],
        })
    out.sort(key=lambda x: (x["ca"] is None, -(x["ca"] or 0)))
    return out


# The SHARED scalar emitter, not a local copy. A local one was written here
# first and got booleans wrong — str(True) is "True", which is not JavaScript,
# so every row carrying `ls` failed to parse. build_pl_data owns how a value
# reaches a data file for exactly this reason.
j = P.jsval


def emit(clubs, players, refs):
    lines = [
        "// Auto-generated by data/build_laliga_data.py. Do not edit by hand.",
        "// La Liga 2026-27, on 2025-26 form.",
        "// Club card rates are counted from the free football-data.co.uk SP1",
        "// records; the referee NAMES are joined on from API-Football, because",
        "// that free source has never published an official for Spain.",
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
    lines.append("const LALIGA_PLAYERS = [")
    for p in sorted(players, key=lambda x: (x["c"], x["r"] is None,
                                            -(x["r"] or 0), x["n"] or "")):
        lines.append("  {" + ",".join([
            f'c:{j(p["c"])}', f'n:{j(p["n"])}', f'p:{j(p["p"])}', f'min:{p["min"]}',
            f'yc:{j(p["yc"])}', f'rc:{j(p["rc"])}', f'y:{j(p["y"])}', f'f:{j(p["f"])}',
            f'fw:{j(p["fw"])}', f'r:{j(p["r"])}', f'ls:{j(p["ls"])}', f'b:{j(p["b"])}',
            # THIS season: cautions and minutes so far. Null until the season
            # has been harvested — see season_cards().
            f'sc:{j(p.get("_sc"))}', f'sm:{j(p.get("_sm"))}',
        ] + ([f'ph:{j(p["ph"])}'] if p.get("ph") else [])
          + (['inj:true'] if p.get("inj") else []) + [
        ]) + "},")
    lines.append("];")
    lines.append(refs)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def existing_refs():
    """Keep whatever REFS block is already shipped, or an empty one.

    build_refs.py --league LL owns that block and patches it in place after
    this runs. Regenerating the file must not wipe it, or the order the two
    scripts happen to run in would decide whether the desk has referees.
    """
    if OUT.exists():
        import re
        m = re.search(r"const REFS = \[.*?\];", OUT.read_text(encoding="utf-8"), re.S)
        if m:
            return m.group(0)
    path = DATA / LEAGUE.refs_file
    if path.exists():
        import build_refs
        try:
            refs = json.loads(path.read_text(encoding="utf-8")).get("refs", [])
        except (OSError, ValueError):
            refs = []
        if refs:
            return build_refs.refs_block(refs)
    return "const REFS = [\n];"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2526",
                    help="football-data season code for the CLUB CARD RATES "
                         "(the season just played, e.g. 2526)")
    ap.add_argument("--csv", help="local SP1 season CSV instead of fetching")
    ap.add_argument("--no-club-rates", action="store_true",
                    help="skip the free match records entirely")
    args = ap.parse_args()

    notes = []
    clubs = clubs_registry()
    resolve = resolve_with(clubs)
    shorts = {d["short"] for d in clubs.values()}

    match_rows = []
    if not args.no_club_rates:
        match_rows, where = leagues.load_rows(LEAGUE, season=args.season,
                                              csv_path=args.csv,
                                              agent="pl-bookings-laliga")
        notes.append(f"club rates from {where} ({len(match_rows)} matches)")

    # Promoted = in the division now, but not in last season's match records.
    # Derived from two files this build already reads rather than declared in
    # a third that would have to be kept in step with reality by hand.
    last_season = last_seasons_clubs(match_rows, resolve) if match_rows else set()
    promoted = {d["short"] for n, d in clubs.items() if n not in last_season} \
        if last_season else set()
    continuing = shorts - promoted
    if last_season:
        print(f"Division: {len(continuing)} clubs were in it last season, "
              f"{len(promoted)} came up")
        if promoted:
            up = sorted(n for n, d in clubs.items() if d["short"] in promoted)
            print("  promoted: " + ", ".join(up))

    players, unmapped = build_players(clubs, continuing, promoted, resolve)
    rates = club_card_rates(match_rows, resolve) if match_rows else {}
    club_rows = build_clubs(players, rates, clubs, promoted)

    if unmapped:
        print("Club names that resolved to nothing (NOT dropped silently):")
        for n, c in sorted(unmapped.items(), key=lambda kv: -kv[1])[:20]:
            print(f"  {c:4}  {n}")

    problems = P.coverage_problems(players, clubs=shorts)
    notes += [
        f"players: {len(players)}  by basis: "
        + ", ".join(f"{b}={sum(1 for p in players if p['b'] == b)}"
                    for b in sorted({p["b"] for p in players})),
        f"clubs with players: {len({p['c'] for p in players})} of {len(shorts)}",
        f"club rates from match records: {len(rates)} of {len(shorts)}",
        "season cautions (2026-27): "
        + (f"{sum(1 for p in players if p.get('_sc') is not None)} players"
           if any(p.get("_sc") is not None for p in players)
           else "none yet — the season has not been harvested"),
    ]
    if problems:
        fail("squad coverage is short, so the desk would ship clubs with no "
             "players and no error", notes + ["  - " + p for p in problems])

    refs = existing_refs()
    emit(club_rows, players, refs)
    nrefs = refs.count("{n:")
    notes.append(f"referees: {nrefs}")
    notes.append(f"RESULT: WRITTEN {OUT.name}")
    write_status(["La Liga 2026-27 — build_laliga_data.py", *notes])
    print("\n" + "\n".join(notes))
    if not nrefs:
        print("\n  No referees yet. Harvest the completed season's officials "
              "and join them:\n"
              "    python3 data/harvest_apifootball.py --ref-fixtures "
              "--league LL --season 2025\n"
              "    python3 data/build_refs.py --league LL --season 2526")


if __name__ == "__main__":
    main()

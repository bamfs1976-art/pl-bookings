#!/usr/bin/env python3
"""
Who has moved? The shipped Premier League squads against the live FPL feed.

WHY THIS EXISTS. data/pl_data.js carries the player-to-club mapping the desk
prices with, and for the seventeen established clubs that mapping comes from
the ScoutingStats harvest — the one leg of the refresh that needs a browser
cookie. When the cookie stops working, build_pl_data.py falls back to the
previous build BY DESIGN (a partial refresh beats a destroyed dataset), and the
refresh then reports success every morning while the squads stand still. A
transfer window is exactly when that is most wrong and least visible: the row
looks complete, the player is priced, and he is at a club he has left.

FPL's bootstrap answers it, free and keyless, and it is already what this app
trusts for fixtures and live cards — so agreeing with it is internal
consistency rather than a new dependency.

THE JOIN IS THE HARD PART, and it is already solved in this repository. The
first version of this report used a prefix match and reported 185 players
"missing" from a feed that had most of them: "Levi Samuels Colwill" is not a
prefix of "Levi Colwill", "Đorđe Petrović" folds to "dorde" against
"djordje", and "M. van Ewijk" starts with the wrong letter run entirely. So
this uses build_pl_data.same_person — exact name, then token coverage, then
initial-plus-surname — instead of inventing a third rule. Ambiguity is
reported, never guessed: more than one man answering to a name is unknown.

REPORTS, DOES NOT FIX.

  python3 data/squad_drift.py
  python3 data/squad_drift.py --json

Needs the FPL API, so it runs where that is reachable — a GitHub runner, not a
dev container behind an egress proxy. Same constraint as harvest_history.py.
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data  # noqa: E402
import harvest_fpl_squads  # noqa: E402


def club_index(teams):
    """FPL team id -> the dataset's club code.

    Matched on FPL's own short code first, which is the dataset's vocabulary
    already, then on the full name. An unmapped club is a rename we must
    notice — it would otherwise read as "that club has no players", which is
    indistinguishable from a squad the feed genuinely omits.
    """
    by_short, unmapped = {}, []
    names = {build_pl_data.leagues.strip_accents(n).lower(): s
             for n, s in build_pl_data.SHORT.items()}
    for t in teams:
        short = t.get("short_name", "").upper()
        if short in build_pl_data.NAME_BY_SHORT:
            by_short[t["id"]] = short
            continue
        key = build_pl_data.leagues.strip_accents(t.get("name", "")).lower()
        hit = names.get(key) or next(
            (s for n, s in names.items() if n.startswith(key) and key), None)
        if hit:
            by_short[t["id"]] = hit
        else:
            unmapped.append(f'{t.get("name")} ({short})')
    return by_short, unmapped


def main():
    as_json = "--json" in sys.argv
    boot = harvest_fpl_squads.get("/bootstrap-static/")
    shorts, unmapped = club_index(boot.get("teams", []))

    feed = []
    for e in boot.get("elements", []):
        short = shorts.get(e.get("team"))
        if not short:
            continue
        name = f'{e.get("first_name", "")} {e.get("second_name", "")}'.strip()
        toks = build_pl_data.name_tokens(name)
        if not toks:
            continue
        feed.append({"name": name, "club": short, "toks": toks})

    # Bucketed by every token, over the WHOLE league — the question is "where
    # is he now", not "is he still at this club". Comparing each shipped player
    # against only the feed rows sharing a token with him is exact rather than
    # an optimisation: every stage of same_tokens requires a shared token.
    buckets = defaultdict(list)
    for f in feed:
        for t in set(f["toks"]):
            buckets[t].append(f)

    rows = build_pl_data.js_array(
        (DATA / "pl_data.js").read_text(encoding="utf-8"), "PL_PLAYERS")

    moved, gone, seen, ambiguous = [], [], set(), []
    for p in rows:
        toks = build_pl_data.name_tokens(p.get("n"))
        if not toks:
            continue
        seen_ids, hits = set(), []
        for t in set(toks):
            for f in buckets.get(t, ()):
                if id(f) in seen_ids:
                    continue
                seen_ids.add(id(f))
                if build_pl_data.same_tokens(toks, f["toks"]):
                    hits.append(f)
        if not hits:
            gone.append(p)
            continue
        # More than one man answering to the name is UNKNOWN, never a pick.
        if len({h["club"] for h in hits}) > 1:
            ambiguous.append((p, hits))
            continue
        f = hits[0]
        for h in hits:
            seen.add(id(h))
        if f["club"] != p.get("c"):
            moved.append({"name": p.get("n"), "from": p.get("c"),
                          "to": f["club"], "basis": p.get("b"),
                          "feed_name": f["name"]})

    missing = [f for f in feed if id(f) not in seen]

    if as_json:
        print(json.dumps({
            "shipped": len(rows), "feed": len(feed), "unmapped": unmapped,
            "moved": moved,
            "gone": [{"name": p.get("n"), "club": p.get("c"), "basis": p.get("b")}
                     for p in gone],
            "missing": [{"name": f["name"], "club": f["club"]} for f in missing],
        }, indent=2, ensure_ascii=False))
        return

    print(f"shipped: {len(rows)} players    FPL feed: {len(feed)} players "
          f"across {len(shorts)} clubs")
    if unmapped:
        print("CLUBS NOT MAPPED: " + ", ".join(unmapped) +
              "  — a rename, not an empty squad")

    print(f"\nAT A DIFFERENT CLUB IN THE FEED: {len(moved)}")
    for m in sorted(moved, key=lambda m: (m["from"], m["name"])):
        extra = "" if m["feed_name"] == m["name"] else f'   (feed: {m["feed_name"]})'
        print(f'  {m["name"]:<28} {m["from"]} -> {m["to"]}  [{m["basis"]}]{extra}')

    print(f"\nSHIPPED BUT NOT IN THE FEED: {len(gone)}  — left the league")
    for p in sorted(gone, key=lambda p: (p.get("c") or "", p.get("n") or ""))[:30]:
        print(f'  {p.get("n"):<28} {p.get("c")}  [{p.get("b")}]  {p.get("min")} min')
    if len(gone) > 30:
        print(f"  ... and {len(gone) - 30} more")
    if gone:
        print("  by club: " + ", ".join(
            f"{c} {n}" for c, n in Counter(p.get("c") for p in gone).most_common()))

    print(f"\nIN THE FEED BUT NOT SHIPPED: {len(missing)}  — the desk cannot price them")
    for f in sorted(missing, key=lambda f: (f["club"], f["name"]))[:30]:
        print(f'  {f["name"]:<28} {f["club"]}')
    if len(missing) > 30:
        print(f"  ... and {len(missing) - 30} more")
    if missing:
        print("  by club: " + ", ".join(
            f"{c} {n}" for c, n in Counter(f["club"] for f in missing).most_common()))

    if ambiguous:
        print(f"\nNAME MATCHES MORE THAN ONE PLAYER: {len(ambiguous)}"
              "  — left alone rather than guessed")
        for p, hits in ambiguous[:15]:
            where = ", ".join(sorted({h["club"] for h in hits}))
            print(f'  {p.get("n"):<28} shipped {p.get("c")}, feed has {where}')

    # LAST, because a log read from its tail loses whatever came first.
    print(f"\nSUMMARY  moved {len(moved)} | left the league {len(gone)} | "
          f"in the feed with no row {len(missing)} | ambiguous {len(ambiguous)}"
          f"   (shipped {len(rows)}, feed {len(feed)})")


if __name__ == "__main__":
    main()

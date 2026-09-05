#!/usr/bin/env python3
"""Can penalties per referee be COUNTED from API-Football's fixture events?

    python3 data/probe_penalties.py --league 140 --season 2025 --sample 40

WHY THIS EXISTS. Every figure on a referee row in this repository is counted
from match records except one. `pen` is typed in by hand off published fixture
graphics into data/ref_pens.json, because the free football-data.co.uk archive
carries yellows, reds and fouls and NO penalties. Six officials of seventy-two
have a figure, all six Premier League, and the column is admissible only
because nothing prices off it — scripts/check-referees.mjs asserts that
assets/core.js never reads `.pen`.

La Liga already buys its referee NAMES from API-Football. If the same feed can
be made to yield penalties, the column stops being a screenshot and becomes a
measurement, for every official at once rather than one card at a time.

THE QUESTION IS NOT "DOES IT SAY PENALTY". It is whether what the feed records
is the quantity a referee is judged on. A referee AWARDS penalties; a feed that
only records penalty GOALS undercounts him by every one that was saved or
missed, and the resulting column would look entirely reasonable and run
systematically low. That is the failure this probe is built to catch, so it
does not go looking for a label it already believes in — it DUMPS THE
VOCABULARY: every distinct (type, detail) pair over a real sample, with counts,
so the reader can see what the feed does and does not distinguish.

WHAT IT ALSO HAS TO SETTLE IS THE PRICE. Events are per fixture, and a season
is 380 of them. If /fixtures?ids= returns them inlined in batches then a season
costs about twenty calls; if it does not, it costs 380, and that is a different
decision. netlify/functions/live-cards.js found that /fixtures?live= DOES
inline events, so the batch form is worth asking about rather than assuming
either way. The probe reports the measured cost from the API's own
x-ratelimit headers, not an estimate.

THREE OUTCOMES, NOT TWO. "usable", "unusable" and "unknown" — and the third is
not a formality. This sandbox cannot reach v3.football.api-sports.io at all, so
a run that fetched nothing must never print a verdict about what the feed
carries. data/probe_fd_division.py made exactly that mistake in its first
draft and reported a blocked proxy as a negative finding about Scotland.

It writes nothing except an optional recorded payload, and needs API_FOOTBALL_KEY.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import harvest_apifootball as A          # noqa: E402

# What a penalty can look like in a feed that has not been read yet. Used ONLY
# to group the vocabulary dump for the reader — never to decide the verdict,
# because a label absent from this list is exactly the discovery worth making.
PENALTY_HINTS = ("penalty", "penalties", "pen.")


def batched(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fixture_ids(host, key, league, season, limit):
    """Finished fixtures for the season, with the referee the feed has.

    Finished only: an unplayed fixture has no events and would dilute every
    rate below with matches that could not have had a penalty.
    """
    payload = A._get(host, key, "fixtures",
                     {"league": league, "season": season, "status": "FT"})
    err = A.api_errors(payload)
    if err:
        return None, f"/fixtures refused: {err}"
    rows = []
    for r in payload.get("response") or []:
        fx = (r or {}).get("fixture") or {}
        if fx.get("id") is None:
            continue
        rows.append({"id": int(fx["id"]), "ref": (fx.get("referee") or "").strip(),
                     "events_inlined": isinstance(r.get("events"), list)})
    return rows[:limit] if limit else rows, None


def try_batch(host, key, ids):
    """Does /fixtures?ids= come back with events already inlined?

    This is the whole cost question. Twenty fixtures a call against one a
    fixture is the difference between a season costing ~19 calls and 380.
    """
    joined = "-".join(str(i) for i in ids)
    payload = A._get(host, key, "fixtures", {"ids": joined})
    err = A.api_errors(payload)
    if err:
        return None, f"/fixtures?ids= refused: {err}"
    got = payload.get("response") or []
    inlined = sum(1 for r in got if isinstance(r.get("events"), list) and r["events"])
    return {"asked": len(ids), "returned": len(got), "with_events": inlined,
            "payload": payload}, None


def events_for(host, key, fid):
    payload = A._get(host, key, "fixtures/events", {"fixture": fid})
    err = A.api_errors(payload)
    if err:
        return None, err
    return payload.get("response") or [], None


def vocabulary(events):
    """Every distinct (type, detail) pair, counted. The actual finding."""
    vocab = Counter()
    for e in events:
        vocab[(str((e or {}).get("type") or ""),
               str((e or {}).get("detail") or ""))] += 1
    return vocab


def looks_like_penalty(type_, detail):
    blob = f"{type_} {detail}".lower()
    return any(h in blob for h in PENALTY_HINTS)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", default="140", help="API-Football league id (140 = La Liga)")
    ap.add_argument("--season", default="2025")
    ap.add_argument("--sample", type=int, default=40,
                    help="how many finished fixtures to read events for. The "
                         "cost of the probe itself, and it is bounded on "
                         "purpose: this answers a yes/no question, it does not "
                         "build the column.")
    ap.add_argument("--batch", type=int, default=20,
                    help="ids per /fixtures?ids= call when testing the batch form")
    ap.add_argument("--record", default="",
                    help="write one raw payload here for offline tests")
    args = ap.parse_args()

    host = A.env_or("API_FOOTBALL_HOST", "v3.football.api-sports.io")
    key = A.env_or("API_FOOTBALL_KEY", "")
    if not key:
        print("UNKNOWN: API_FOOTBALL_KEY is not set. This says NOTHING about "
              "what the feed carries — only that this run could not ask. Set "
              "the secret and run it again.", file=sys.stderr)
        return 2

    print(f"=== league {args.league}, season {args.season} ===")
    fixtures, err = fixture_ids(host, key, args.league, args.season, args.sample)
    if fixtures is None:
        print(f"UNKNOWN: could not list fixtures — {err}", file=sys.stderr)
        print(A.usage_line())
        return 2
    if not fixtures:
        print("UNKNOWN: the season returned no finished fixtures. Out of "
              "season, or the wrong league id — either way this is not a "
              "finding about penalties.", file=sys.stderr)
        return 2

    with_ref = sum(1 for f in fixtures if f["ref"])
    print(f"  {len(fixtures)} finished fixture(s); {with_ref} carry a referee "
          f"name ({with_ref / len(fixtures) * 100:.0f}%)")
    season_inlined = sum(1 for f in fixtures if f["events_inlined"])
    print(f"  /fixtures?league&season inlined events on {season_inlined} of "
          f"{len(fixtures)} — {'yes' if season_inlined else 'no'}")

    # ---- the cost question -------------------------------------------------
    print("\n  --- can events be fetched in batches? ---")
    ids = [f["id"] for f in fixtures[:args.batch]]
    batch, berr = try_batch(host, key, ids)
    if batch is None:
        print(f"    /fixtures?ids= unusable: {berr}")
        batch_ok = False
    else:
        print(f"    asked {batch['asked']}, returned {batch['returned']}, "
              f"{batch['with_events']} carrying a populated events array")
        batch_ok = batch["with_events"] > 0
        if batch_ok:
            print(f"    -> events ARE inlined; a 380-fixture season costs "
                  f"about {-(-380 // args.batch)} calls")
        else:
            print("    -> events NOT inlined; a season costs one call a "
                  "fixture, so 380")
        if args.record and batch.get("payload"):
            Path(args.record).parent.mkdir(parents=True, exist_ok=True)
            rec = {"endpoint": "fixtures", "params": {"ids": "…"},
                   "note": "recorded by data/probe_penalties.py",
                   "response_sample": (batch["payload"].get("response") or [])[:2]}
            Path(args.record).write_text(
                json.dumps(rec, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"    recorded a sample to {args.record}")

    # ---- the vocabulary question ------------------------------------------
    # TAKE THE CHEAP PATH IF IT EXISTS, AND SAY WHICH WAS TAKEN. When the batch
    # call already carried the events, reading them again one fixture at a time
    # would spend forty calls to learn what is already in hand — and it would
    # leave the cheap path itself untested, which is the path a real harvest
    # would run on. A handful of per-fixture reads are still made as a
    # CROSS-CHECK, because "inlined" and "inlined identically" are different
    # claims and only one of them is worth building on.
    print("\n  --- what does the feed actually record? ---")
    vocab = Counter()
    read = 0
    per_fixture_pens = Counter()
    by_ref = {}
    ref_of = {f["id"]: f["ref"] for f in fixtures}

    def take(fid, evs):
        nonlocal read
        read += 1
        v = vocabulary(evs)
        pens = sum(c for (t, d), c in v.items() if looks_like_penalty(t, d))
        per_fixture_pens[fid] = pens
        name = ref_of.get(fid) or ""
        if name:
            r = by_ref.setdefault(name, {"matches": 0, "pens": 0})
            r["matches"] += 1
            r["pens"] += pens
        return v

    inlined_vocab = Counter()
    if batch_ok:
        source = "inlined in /fixtures?ids= (the cheap path)"
        for r in batch["payload"].get("response") or []:
            fid = ((r or {}).get("fixture") or {}).get("id")
            if fid is None or not isinstance(r.get("events"), list):
                continue
            inlined_vocab += take(int(fid), r["events"])
        vocab += inlined_vocab
        # The cross-check: three of the same fixtures, fetched the dear way.
        checked = agreed = 0
        for fid in list(per_fixture_pens)[:3]:
            evs, eerr = events_for(host, key, fid)
            if evs is None:
                continue
            checked += 1
            if vocabulary(evs) == vocabulary(
                    next(r["events"] for r in batch["payload"]["response"]
                         if ((r.get("fixture") or {}).get("id")) == fid)):
                agreed += 1
        print(f"    cross-check: {agreed} of {checked} fixture(s) gave an "
              f"identical event list either way"
              + ("" if checked and agreed == checked else
                 "   <-- THEY DIFFER; do not build on the inlined form"))
    else:
        source = "one /fixtures/events per fixture (the dear path)"
        for f in fixtures:
            evs, eerr = events_for(host, key, f["id"])
            if evs is None:
                print(f"    fixture {f['id']}: refused ({eerr}) — skipped")
                continue
            vocab += take(f["id"], evs)
    print(f"    events read from: {source}")

    if not read:
        print("\nUNKNOWN: not one fixture's events could be read. No conclusion.",
              file=sys.stderr)
        print(A.usage_line())
        return 2

    print(f"    read {read} fixture(s)\n")
    print(f"    {'type':<12} {'detail':<24} {'count':>6}")
    for (t, d), c in sorted(vocab.items(), key=lambda kv: -kv[1]):
        mark = "  <-- penalty?" if looks_like_penalty(t, d) else ""
        print(f"    {t:<12} {d:<24} {c:>6}{mark}")

    pen_kinds = {(t, d): c for (t, d), c in vocab.items() if looks_like_penalty(t, d)}
    total_pens = sum(pen_kinds.values())
    print(f"\n    penalty-ish events: {total_pens} over {read} fixture(s) "
          f"= {total_pens / read:.3f} a game")
    print(f"    fixtures with at least one: {sum(1 for v in per_fixture_pens.values() if v)}")

    if by_ref:
        print(f"\n    per referee, over this sample:")
        for name, r in sorted(by_ref.items(), key=lambda kv: -kv[1]["matches"])[:10]:
            rate = r["pens"] / r["matches"] if r["matches"] else 0
            print(f"      {name:<32} {r['matches']:>3} match(es)  "
                  f"{r['pens']:>3} pen(s)  {rate:.2f}/game")

    # ---- the verdict -------------------------------------------------------
    print("\n" + "=" * 62)
    if not total_pens:
        print("  UNUSABLE (so far): the sample contains no penalty-labelled "
              "event at all. Either this feed does not mark them, or the "
              "sample was too small to contain one — penalties run about 0.3 a "
              "game, so a sample of this size expecting none is itself a "
              "finding to check before concluding anything.")
        verdict = "unusable"
    else:
        print("  The feed DOES label penalties. Before this column is built, "
              "read the vocabulary above and answer one question:")
        print("    does it distinguish a penalty AWARDED from one SCORED?")
        print("  A referee is judged on what he gives. If the only labels are "
              "goal-shaped, every saved and missed penalty is invisible and "
              "the column will run low in a way nothing on the page reveals.")
        verdict = "usable"
    print(f"\n  {A.usage_line()}")
    print("  NOTE: nothing was written to any dataset. This probe answers "
          "whether the column CAN be counted; building it is a separate "
          "change, and until it lands data/ref_pens.json stays hand-seeded.")
    return 0 if verdict == "usable" else 1


if __name__ == "__main__":
    sys.exit(main())

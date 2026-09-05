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

WHAT IT FOUND, 2026-09-05, La Liga (140), season 2025, 40 finished fixtures,
5 calls:

  Referee name        on 40 of 40 fixtures (100%)
  /fixtures?ids=      20 asked, 20 returned, all 20 with events inlined —
                      a 380-fixture season would cost about 19 calls
  cross-check         0 of 3 fixtures gave an IDENTICAL event list via
                      /fixtures/events. The cheap path is not the same data.
  penalty labels      Goal / Penalty          6
                      Var  / Penalty confirmed 2

  VERDICT: UNUSABLE AS IT STANDS, for two independent reasons.

  1. NO LABEL RECORDS A PENALTY THAT DID NOT SCORE. There is no "Missed
     Penalty" and no "Penalty Saved" in the sample. A count off these labels
     is penalties SCORED. A referee is judged on what he AWARDS, so the column
     would run low by every saved and missed penalty, invisibly and forever.
     "Var / Penalty confirmed" does NOT close the gap — it fires only where a
     penalty was reviewed, two against six scored, so it documents a minority
     of incidents and is silent on the rest.
  2. THE TWO LABELS OVERLAP. A VAR-confirmed penalty that is then scored
     raises both rows, so they cannot be added. The first draft of this file
     printed their sum as "0.400 a game", which is exactly the sort of number
     that gets quoted.

  The per-referee tallies it prints are a SAMPLE-SIZE CHECK, not rates: 20
  fixtures spread over 20 officials is about one match each, and the busiest
  had two. A rate off that is noise with a name on it.

  So data/ref_pens.json stays hand-seeded. What would change the answer is a
  label for penalties that did not score — worth re-running against another
  league or season before concluding the feed never carries one.
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
    cross_ok = None          # None = never tested (the dear path was taken)
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
        cross_ok = bool(checked) and agreed == checked
        print(f"    cross-check: {agreed} of {checked} fixture(s) gave an "
              f"identical event list either way"
              + ("" if cross_ok else
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

    # THESE LABELS ARE NOT DISJOINT, so their sum is not a count of penalties.
    # A VAR-confirmed penalty that is then scored raises BOTH a Var row and a
    # Goal row, and adding them counts one award twice. The kinds are reported
    # separately for that reason, and the single "a game" figure the first
    # draft printed is gone: it was the kind of number that gets quoted.
    print(f"\n    penalty-labelled events by kind, over {read} fixture(s):")
    for (t, d), c in sorted(pen_kinds.items(), key=lambda kv: -kv[1]):
        print(f"      {t:<6} {d:<22} {c:>4}   ({c / read:.3f} a game if taken alone)")
    print("    THESE OVERLAP. A VAR-confirmed penalty that is scored appears "
          "in both rows, so the kinds must not be added together.")
    print(f"    fixtures with at least one penalty-labelled event: "
          f"{sum(1 for v in per_fixture_pens.values() if v)} of {read}")

    if by_ref:
        print(f"\n    per referee, over this sample — NOT a rate, a sample size "
              f"check:")
        for name, r in sorted(by_ref.items(), key=lambda kv: -kv[1]["matches"])[:10]:
            print(f"      {name:<34} {r['matches']:>3} match(es)  "
                  f"{r['pens']:>3} penalty-labelled event(s)")
        most = max(r["matches"] for r in by_ref.values())
        print(f"    The busiest official here has {most} match(es). A penalty "
              "rate off that is noise with a name on it; the column would need "
              "the whole season, not this sample.")

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
        # THE LABELS DECIDE THIS, NOT THEIR PRESENCE. A referee is judged on
        # what he AWARDS. If every penalty label is goal-shaped then a saved or
        # missed penalty leaves no trace, and a column counted from these runs
        # systematically low while looking entirely reasonable.
        # A VAR ROW IS NOT AN AWARD RECORD, and counting it as one is how this
        # check would wave through the very feed it exists to reject. "Var /
        # Penalty confirmed" fires only when a penalty was REVIEWED — two of
        # them against six scored penalties in the first real sample — so it
        # documents a minority of incidents and says nothing about the ones
        # VAR never looked at. Only a label for a penalty that did NOT become
        # a goal makes awarded-versus-scored separable.
        awarded = [f"{t}/{d}" for (t, d) in pen_kinds
                   if any(w in d.lower() for w in ("miss", "saved", "awarded"))]
        var_rows = [f"{t}/{d}" for (t, d) in pen_kinds if t.lower() == "var"]
        goal_only = [f"{t}/{d}" for (t, d) in pen_kinds if t.lower() == "goal"]
        print("  The feed labels penalties: " + ", ".join(sorted(pen_kinds and
              [f"{t}/{d}" for (t, d) in pen_kinds])))
        if not awarded:
            print("  BUT NO LABEL RECORDS A PENALTY THAT DID NOT SCORE. "
                  "Nothing here marks one saved or missed, so a count off this "
                  "is penalties SCORED, not penalties AWARDED — the quantity a "
                  "referee is actually judged on. Building the column on it "
                  "would undercount every official by his saved and missed "
                  "penalties, invisibly.")
            if var_rows:
                print(f"  ({', '.join(var_rows)} is present but does NOT close "
                      "the gap: a VAR row fires only where a penalty was "
                      "reviewed, so it covers a minority of incidents and is "
                      "silent on the rest.)")
            verdict = "unusable"
        else:
            print(f"  Goal-shaped labels: {', '.join(goal_only) or 'none'}")
            print(f"  Award-shaped labels: {', '.join(awarded)}")
            print("  Both shapes are present, so awarded-versus-scored can be "
                  "separated — but check the overlap above before summing "
                  "anything.")
            verdict = "usable"

    # A CROSS-CHECK THAT FAILED IS A BLOCKING FINDING, NOT A FOOTNOTE. The
    # first version of this file printed "do not build on the inlined form"
    # and then exited 0, which is a probe reporting green on the one thing it
    # found wrong — the exact failure this repository keeps catching.
    if cross_ok is False:
        print("\n  AND THE CHEAP PATH IS NOT THE SAME DATA. The events inlined "
              "in /fixtures?ids= did not match /fixtures/events for the same "
              "fixtures. The batch form is what makes a season affordable, so "
              "this has to be understood before either path is built on.")
        verdict = "unusable"
    elif cross_ok is None and batch_ok:
        print("\n  (the inlined form was not cross-checked this run)")

    print(f"\n  {A.usage_line()}")
    print("  NOTE: nothing was written to any dataset. This probe answers "
          "whether the column CAN be counted; building it is a separate "
          "change, and until it lands data/ref_pens.json stays hand-seeded.")
    return 0 if verdict == "usable" else 1


if __name__ == "__main__":
    sys.exit(main())

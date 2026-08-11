#!/usr/bin/env python3
"""One command to regenerate the desks' data, with one exit code.

  python3 scripts/build_data.py                 # everything that needs no key
  python3 scripts/build_data.py --league PL     # one desk
  python3 scripts/build_data.py --dry-run       # print the plan, run nothing
  python3 scripts/build_data.py --with-keyed    # include the API-Football legs

WHY A FRONT DOOR RATHER THAN A NEW PIPELINE. Every step below already exists
and already runs — .github/workflows/data-refresh.yml calls twenty-odd of them
in a specific order, and that order is real: build_club_splits.py must follow
build_pl_data.py, because the latter regenerates CLUBS without the home/away
splits and the former puts them back. That knowledge lived only in a YAML file,
so a regeneration by hand meant reading a workflow and copying commands out of
it in the right sequence. Getting it wrong is silent: you get a dataset that
looks complete and has lost a column.

So this is a runner, not a rewrite. It shells out to the same scripts with the
same arguments. If it and the workflow ever disagree, the workflow is right and
this is the bug — which is why scripts/check-build-data.mjs asserts that every
command here appears in that workflow.

WHAT IT WILL NOT DO. It will not invent credentials, and it will not pretend a
step ran. A step needing a key that is absent is SKIPPED and named, and the
summary at the end distinguishes skipped from failed — because "the refresh
completed" while quietly doing a third of the work is how a dataset goes stale
without anyone noticing.
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# needs: an environment variable that must be present, or None for free steps.
# The order is the workflow's order, and the comments say why where it matters.
STEPS = [
    # ---- free sources: football-data.co.uk (mirror first for the PL) --------
    dict(name="Premier League referees", cmd=["python3", "data/build_refs.py"],
         leagues={"PL"}, needs=None),
    dict(name="Referee career history", cmd=["python3", "data/extend_ref_history.py"],
         leagues={"PL"}, needs=None),
    dict(name="Championship referees", cmd=["python3", "data/build_refs.py", "--league", "EFLC"],
         leagues={"EFLC"}, needs=None),

    # ---- keyed: API-Football ------------------------------------------------
    dict(name="Championship squads", cmd=["python3", "data/harvest_apifootball.py", "--league", "EFLC"],
         leagues={"EFLC"}, needs="API_FOOTBALL_KEY"),
    dict(name="Premier League squads (relegated three)",
         cmd=["python3", "data/harvest_apifootball.py", "--league", "PL", "--out", "pl_af_players.json"],
         leagues={"PL"}, needs="API_FOOTBALL_KEY"),
    dict(name="La Liga club registry",
         cmd=["python3", "data/harvest_apifootball.py", "--league", "LL", "--clubs"],
         leagues={"LL"}, needs="API_FOOTBALL_KEY"),
    dict(name="La Liga squads", cmd=["python3", "data/harvest_apifootball.py", "--league", "LL"],
         leagues={"LL"}, needs="API_FOOTBALL_KEY"),
    dict(name="Fixtures and referee appointments",
         cmd=["python3", "data/harvest_apifootball.py", "--fixtures", "--league", "{L}"],
         leagues={"PL", "EFLC", "LL"}, needs="API_FOOTBALL_KEY", per_league=True),

    # ---- the free FPL leg, which fills the promoted clubs -------------------
    dict(name="Promoted-club squads from the FPL feed",
         cmd=["python3", "data/harvest_fpl_squads.py"], leagues={"PL"}, needs=None),

    # ---- builds, in the order that matters ----------------------------------
    dict(name="Build pl_data.js", cmd=["python3", "data/build_pl_data.py"],
         leagues={"PL"}, needs=None),
    # AFTER build_pl_data: it regenerates CLUBS without the home/away splits,
    # and this puts them back. Reversing the two silently drops caH/caA.
    dict(name="Home/away card splits", cmd=["python3", "data/build_club_splits.py"],
         leagues={"PL"}, needs=None),
    dict(name="Build eflc_data.js", cmd=["python3", "data/build_eflc_data.py"],
         leagues={"EFLC"}, needs=None),
    dict(name="Build laliga_data.js", cmd=["python3", "data/build_laliga_data.py"],
         leagues={"LL"}, needs=None),
    dict(name="La Liga referees (bought names, free rates)",
         cmd=["python3", "data/build_refs.py", "--league", "LL"], leagues={"LL"}, needs=None),

    # ---- the model, from the data just written ------------------------------
    dict(name="Card model parameters", cmd=["node", "scripts/build-model.mjs"],
         leagues={"PL"}, needs=None),
]

# The guards that decide whether what was just built is shippable. Run last,
# and a failure here is a failure of the whole run: a dataset that does not
# pass its own checks must not be committed.
GUARDS = [
    ["node", "scripts/check-data.mjs"],
    ["node", "scripts/check-eflc.mjs"],
    ["node", "scripts/check-laliga.mjs"],
    ["node", "scripts/check-appointments.mjs"],
    ["node", "scripts/check-match-record.mjs"],
]


def expand(step, league):
    return [league if a == "{L}" else a for a in step["cmd"]]


def plan(args):
    """Which steps this invocation would run, and which it would skip."""
    want = set(args.league) if args.league else {"PL", "EFLC", "LL"}
    out = []
    for s in STEPS:
        if not (s["leagues"] & want):
            continue
        if s["needs"] and not args.with_keyed:
            out.append((s, None, "needs --with-keyed"))
            continue
        if s["needs"] and not os.environ.get(s["needs"]):
            out.append((s, None, f"{s['needs']} is not set"))
            continue
        if s.get("per_league"):
            for L in sorted(s["leagues"] & want):
                out.append((s, L, None))
        else:
            out.append((s, None, None))
    return out


def run(cmd, season):
    """Season is appended only where the script accepts it, which is not all
    of them — passing --season to a script that does not take it is an argparse
    error, and a runner that turns a working step into a crash is worse than no
    runner."""
    full = list(cmd)
    if season and full[0] == "python3" and any(
            n in full[1] for n in ("build_refs", "build_club_splits", "build_eflc_data", "build_laliga_data")):
        full += ["--season", season]
    started = time.time()
    res = subprocess.run(full, cwd=ROOT)
    return res.returncode, time.time() - started


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", action="append", choices=["PL", "EFLC", "LL"],
                    help="limit to one desk (repeatable). Default: all three.")
    ap.add_argument("--season", help="football-data season code, e.g. 2526")
    ap.add_argument("--with-keyed", action="store_true",
                    help="include the steps that need API_FOOTBALL_KEY")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and stop")
    ap.add_argument("--skip-guards", action="store_true",
                    help="do not run the dataset guards afterwards (not recommended)")
    args = ap.parse_args()

    steps = plan(args)
    print(f"build_data: {len([s for s in steps if s[2] is None])} step(s) to run, "
          f"{len([s for s in steps if s[2]])} skipped\n")

    if args.dry_run:
        for s, L, skip in steps:
            mark = "SKIP" if skip else "run "
            note = f"   ({skip})" if skip else ""
            print(f"  {mark}  {s['name']}{' — ' + L if L else ''}{note}")
        print("\n--dry-run: nothing was executed")
        return 0

    ran, skipped, failed = [], [], []
    for s, L, skip in steps:
        label = s["name"] + (f" — {L}" if L else "")
        if skip:
            skipped.append((label, skip))
            print(f"  SKIP  {label}  ({skip})")
            continue
        print(f"\n──  {label}")
        code, secs = run(expand(s, L or "PL"), args.season)
        if code == 0:
            ran.append((label, secs))
        else:
            failed.append((label, code))
            print(f"  FAILED ({code})")

    guard_fail = []
    if not args.skip_guards and not failed:
        print("\n──  guards")
        for g in GUARDS:
            res = subprocess.run(g, cwd=ROOT)
            if res.returncode != 0:
                guard_fail.append(" ".join(g))

    print("\n" + "─" * 60)
    print(f"ran {len(ran)}, skipped {len(skipped)}, failed {len(failed)}")
    for label, why in skipped:
        print(f"  skipped: {label} — {why}")
    for label, code in failed:
        print(f"  FAILED:  {label} (exit {code})")
    for g in guard_fail:
        print(f"  GUARD FAILED: {g}")

    if failed or guard_fail:
        print("\nThe dataset should NOT be committed from this run.")
        return 1
    if skipped:
        print("\nCompleted, with steps skipped above — the files they produce are "
              "unchanged from the last run that did have what they needed.")
    else:
        print("\nCompleted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

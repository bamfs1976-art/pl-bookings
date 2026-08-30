#!/usr/bin/env python3
"""What the app spends of its API-Football allowance in a day.

    python3 data/api_budget.py
    python3 data/api_budget.py --ceiling 5000

WHY A MODEL AT ALL, WHEN THE API COUNTS FOR US. It does, and that is the
better number: harvest_apifootball.note_usage records
x-ratelimit-requests-remaining from every response and every run ends by
printing the day's true consumption. Nothing here can be as accurate as that.

But a measurement only tells you about today. The question that actually
threatens the app is "what will this cost in MAY?", and today's log cannot
answer it, because the per-fixture feeds are incremental: they are cheap now
because 76 fixtures have been played and expensive later because 1,312 will
have been. That question is what sank the first version of harvest_extra.py —
it looked fine on August's data and would have run out of quota in March. So
this projects forward, and the measurement checks it from behind.

THE CRONS ARE READ FROM THE WORKFLOW FILES, NEVER TYPED HERE. A budget with
its own copy of the schedule is a second copy that can disagree with the first,
which is exactly the failure this is meant to catch — a step that quietly runs
four times a day because a condition said so while its name said "daily". So
the number of firings comes from parsing .github/workflows/*.yml, and if a
schedule changes, this changes with it.

WHAT IS MEASURED AND WHAT IS ASSUMED. Every per-call cost below is marked. The
extra feeds are measured: data/probes/ holds a real recorded response for each
of the eleven endpoints and every one reports paging.total == 1, so they are
one call apiece. The older harvest's costs are derived from its loops, and the
derivation is stated next to each so a reader can check it against the code
rather than trust the number.
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
ROOT = DATA.parent
FLOW = ROOT / ".github" / "workflows"

# The subscription this is measured against. Pro is 7,500 calls a day.
DAILY_ALLOWANCE = 7500

# A division's shape, read from the shipped fixture list rather than typed.
# Fixtures matter because the per-fixture feeds cost one call each, once ever,
# and the season total is what the May question turns on.
FIXTURE_FILES = {
    "PL": "pl_fixtures.js",
    "EFLC": "eflc_fixtures.js",
    "LL": "laliga_fixtures.js",
}

# Divisions the daily refresh walks that have no desk of their own: the feeder
# leagues a promoted club's form comes from.
FEEDER_CLUBS = {"SEG": 22, "L1": 24}

# API-Football pages /players at twenty to a page, and the harvest queries it
# per club, so a squad of 25-35 is two pages. Derived from PAGE_SIZE in
# harvest_apifootball.py and the squad sizes in the shipped roster files.
PLAYERS_PAGES_PER_CLUB = 2


def league_shapes():
    """Clubs and fixtures per division, from the shipped fixture lists."""
    out = {}
    for code, name in FIXTURE_FILES.items():
        src = (DATA / name).read_text(encoding="utf-8")
        rows = re.findall(r'\{id:(\d+),[^}]*?h:"([A-Z0-9]+)",a:"([A-Z0-9]+)"', src)
        if not rows:
            raise SystemExit(f"ERROR: no fixtures parsed out of {name}. The "
                             "budget cannot be computed from a file it cannot "
                             "read, and guessing the season's size is how the "
                             "May question gets answered wrong.")
        clubs = {h for _, h, _ in rows} | {a for _, _, a in rows}
        out[code] = {"clubs": len(clubs), "fixtures": len(rows)}
    return out


def crons(workflow):
    """Every cron line in a workflow file — the real firing count."""
    p = FLOW / workflow
    if not p.exists():
        raise SystemExit(f"ERROR: {workflow} is not there. The budget reads "
                         "the schedules from the workflows so the two cannot "
                         "disagree; a missing file means it would be guessing.")
    src = p.read_text(encoding="utf-8")
    # Only the schedule block's crons, not a cron quoted inside a comment.
    return [m.group(1) for m in re.finditer(r"^\s*-\s*cron:\s*'([^']+)'",
                                            src, re.M)]


def firings(workflow):
    """How many times a workflow fires in a day, across all its crons.

    NOT the number of cron LINES. lineups.yml is a single line, `5 10-21 * * *`,
    and fires twelve times; counting lines reads that as one and understates
    an hourly job by an order of magnitude. This is the whole reason
    cron_runs_per_day exists, and the first draft of this file computed it and
    then used len() anyway.
    """
    return sum(cron_runs_per_day(c) for c in crons(workflow))


def cron_runs_per_day(expr):
    """How many times a 5-field cron fires in a day.

    Only the shapes the repository actually uses: a fixed hour, a list of
    hours, or a range. Anything else is refused rather than guessed at, since
    a schedule this does not understand would silently count as one run a day
    and understate the bill.
    """
    parts = expr.split()
    if len(parts) != 5:
        raise SystemExit(f"ERROR: cron {expr!r} is not five fields.")
    minute, hour, dom, mon, dow = parts
    if minute == "*" or "/" in minute:
        raise SystemExit(f"ERROR: cron {expr!r} fires more than hourly; this "
                         "model does not cover that.")
    if hour == "*":
        hours = 24
    elif "-" in hour:
        lo, hi = hour.split("-")
        hours = int(hi) - int(lo) + 1
    elif "," in hour:
        hours = len(hour.split(","))
    elif "/" in hour:
        step = int(hour.split("/")[1])
        hours = math.ceil(24 / step)
    else:
        hours = 1
    # Day-of-week restrictions make a job cheaper on average; the budget is
    # about the WORST day, so a weekly job still counts as a full run on the
    # day it fires.
    return hours


def live_constants():
    """TTL and the fan-out cap, read from the Netlify function itself."""
    src = (ROOT / "netlify" / "functions" / "live-cards.js").read_text(encoding="utf-8")
    def num(name):
        m = re.search(rf"^const {name} = (\d+);", src, re.M)
        if not m:
            raise SystemExit(f"ERROR: live-cards.js no longer declares {name}. "
                             "The budget reads it from the function so the two "
                             "cannot disagree.")
        return int(m.group(1))
    return num("TTL"), num("MAX_FIXTURES"), num("FANOUT_TTL")


# How long, on a heavy Saturday, at least one reader has a live desk open:
# a 12:30, a 15:00, a 17:30 and a Spanish evening kick-off, back to back.
# The ticker refreshes on a timer, so this is the term that scales with
# ATTENTION rather than with football, and it is the only one in the app that
# does.
LIVE_WINDOW_HOURS = 6


def budget(shapes, day):
    """Every scheduled call, by workflow. `day` is 'typical' or 'peak'.

    A typical day is a single round across the three divisions — 32 matches,
    the ordinary Saturday. A peak day is a midweek round landing on top of a
    weekend one, which is what makes both the finished-fixture walk and the
    upcoming-fixture odds walk twice their usual size.
    """
    clubs = sum(s["clubs"] for s in shapes.values())          # 64
    per_round = sum(s["clubs"] // 2 for s in shapes.values())  # 32 matches
    played = per_round * (2 if day == "peak" else 1)
    # Odds and predictions look 72 hours ahead, so a weekend's fixtures are in
    # the window on more than one firing; the walk is the fixtures in view.
    upcoming = per_round * (2 if day == "peak" else 1)

    rows = []

    # ── data-refresh.yml: the season's form, once a day ──────────────────
    n = firings("data-refresh.yml")
    squads = sum(s["clubs"] for s in shapes.values()) * PLAYERS_PAGES_PER_CLUB
    feeders = sum(FEEDER_CLUBS.values()) * PLAYERS_PAGES_PER_CLUB
    daily = (
        1                                        # --check, /status
        + shapes["EFLC"]["clubs"] * PLAYERS_PAGES_PER_CLUB   # EFLC squads
        + shapes["EFLC"]["clubs"]                # --roster, one call a club
        + shapes["EFLC"]["clubs"] * PLAYERS_PAGES_PER_CLUB   # season cautions
        + shapes["PL"]["clubs"] * PLAYERS_PAGES_PER_CLUB     # PL (relegated 3)
        + shapes["LL"]["clubs"] * PLAYERS_PAGES_PER_CLUB     # LL squads
        + shapes["LL"]["clubs"]                  # LL --roster
        + shapes["LL"]["clubs"] * PLAYERS_PAGES_PER_CLUB     # LL cautions
        + feeders                                # SEG + L1, promoted clubs
        + 1 + 1                                  # LL --clubs, --ref-fixtures
        + 3                                      # --fixtures PL, EFLC, LL
        + 2                                      # cup/European dates, 2 seasons
    )
    rows.append(("data-refresh.yml", n, daily,
                 "season form: /players is per club and paged 20", None))

    # ── fixtures.yml: appointments, and the ledger after the football ────
    n = firings("fixtures.yml")
    # Per run: one /fixtures a division, plus the ledger's own listing call a
    # division. The per-match walk is incremental, so across the DAY it costs
    # one call per match that finished, however many runs there are.
    rows.append(("fixtures.yml", n, 3 + 3,
                 "3 x /fixtures + 3 x ledger listing, every run", None))
    rows.append(("fixtures.yml (ledger walk)", 1, played,
                 f"/fixtures/players, once per match finished ({played})", None))

    # ── lineups.yml: team sheets in the hour before kick-off ─────────────
    n = firings("lineups.yml")
    rows.append(("lineups.yml", 1, played,
                 f"--within-hours 1, so ~one call a match ({played}); "
                 f"{n} firings, most of them empty", None))

    # ── extra-feeds.yml: the eleven endpoints ───────────────────────────
    ex = firings("extra-feeds.yml")
    # The daily half is pinned to the FIRST cron (see the workflow's comment).
    rows.append(("extra-feeds.yml (daily half)", 1,
                 3                      # /standings, one a division
                 + 3                    # /teams registry, one a division, cached
                 + clubs                # /teams/statistics, one a club
                 + clubs                # /transfers, one a club
                 + 6,                   # top yellow + red cards, two a division
                 "standings, team stats, transfers, card leaders", None))
    rows.append(("extra-feeds.yml (per fixture)", 1, played * 2,
                 f"/events + /fixtures/statistics, once ever per match "
                 f"({played} finished x 2)", None))
    rows.append(("extra-feeds.yml (moving half)", ex,
                 3 + upcoming * 2,
                 f"injuries (3) + odds and predictions on {upcoming} upcoming",
                 None))

    # ── the live ticker: the only term driven by READERS, not by football ──
    #
    # Everything above is scheduled and therefore knowable. This is not: it
    # refreshes while somebody is watching, and the edge cache is what stops
    # a thousand readers costing a thousand calls. One refresh per TTL is the
    # floor and the ceiling, however many people are on the page.
    #
    # The fan-out is the risk, and it turns on something this repository has
    # never verified: whether /fixtures?live= INLINES each match's events. If
    # it does, a refresh is one call. If it does not, the function falls back
    # to one call per live match, and a refresh costs up to MAX_FIXTURES + 1.
    # Both branches are live code. The difference between them is the
    # difference between 360 calls on a Saturday and 4,000, so the budget
    # carries both rather than picking the comfortable one.
    ttl, cap, fanout_ttl = live_constants()
    concurrent = min(cap, per_round // 3 * (2 if day == "peak" else 1))
    # THE TWO BRANCHES ARE CACHED DIFFERENTLY, so they are counted differently.
    # The cheap one refreshes on TTL; the expensive one is held for FANOUT_TTL
    # precisely because it costs a call per live match.
    cheap_refreshes = int(3600 / ttl) * LIVE_WINDOW_HOURS
    fan_refreshes = int(3600 / fanout_ttl) * LIVE_WINDOW_HOURS
    # THESE TWO CANNOT BOTH HAPPEN — the live payload either inlines its
    # events or it does not — so they are marked as alternatives and the total
    # takes the worse of them rather than adding both. Summing them would
    # overstate the bill by a branch that never runs, and a budget that cries
    # wolf is a budget that gets its ceiling raised.
    rows.append(("live-cards (events inlined)", cheap_refreshes, 1,
                 f"1 call a refresh, {3600 // ttl}/hour x {LIVE_WINDOW_HOURS}h",
                 "live"))
    rows.append(("live-cards (events NOT inlined)", fan_refreshes, 1 + concurrent,
                 f"1 + {concurrent} live matches, capped at {cap}, held "
                 f"{fanout_ttl}s — UNVERIFIED branch", "live"))

    return rows, {"clubs": clubs, "played": played, "upcoming": upcoming,
                  "live_refreshes": cheap_refreshes, "live_concurrent": concurrent}


def season_worst_case(shapes):
    """The per-fixture feeds' cost on the day the LAST round is played.

    The question the incremental walk exists to answer. If these ever stopped
    skipping what is recorded, every finished fixture would be re-walked on
    every firing, and this is the number that would arrive instead.
    """
    total = sum(s["fixtures"] for s in shapes.values())
    fires = firings("extra-feeds.yml")
    return {"season_fixtures": total,
            "if_it_re_walked": total * 2 * fires,
            "as_built": 0}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ceiling", type=int, default=5000,
                    help="fail if the peak day exceeds this (default 5000, "
                         "two thirds of the 7500 allowance)")
    ap.add_argument("--json", action="store_true", help="machine-readable")
    args = ap.parse_args()

    shapes = league_shapes()
    out = {"allowance": DAILY_ALLOWANCE, "ceiling": args.ceiling, "days": {}}

    for day in ("typical", "peak"):
        rows, facts = budget(shapes, day)
        total = sum(r * c for _, r, c, _, g in rows if g is None)
        groups = {}
        for _, r, c, _, g in rows:
            if g is not None:
                groups[g] = max(groups.get(g, 0), r * c)
        total += sum(groups.values())
        out["days"][day] = {
            "total": total,
            "facts": facts,
            "lines": [{"job": j, "runs": r, "per_run": c, "total": r * c,
                       "why": w, "alternative": g} for j, r, c, w, g in rows],
        }

    if args.json:
        print(json.dumps(out, indent=2))
    else:
        for code, s in sorted(shapes.items()):
            print(f"{code:5} {s['clubs']:3} clubs, {s['fixtures']:4} fixtures a season")
        for day in ("typical", "peak"):
            d = out["days"][day]
            print(f"\n=== a {day} day "
                  f"({d['facts']['played']} matches played, "
                  f"{d['facts']['upcoming']} upcoming)")
            for ln in d["lines"]:
                mark = "  or " if ln["alternative"] else "     "
                print(f"{mark}{ln['total']:5}  = {ln['runs']:3} x {ln['per_run']:4}"
                      f"  {ln['job']:32} {ln['why']}")
            pct = d["total"] / DAILY_ALLOWANCE * 100
            print(f"  {d['total']:5}  TOTAL — {pct:.0f}% of {DAILY_ALLOWANCE}, "
                  f"{DAILY_ALLOWANCE - d['total']} spare")
        w = season_worst_case(shapes)
        print(f"\nthe incremental walk, on the last day of the season:")
        print(f"  {w['season_fixtures']} fixtures across three divisions")
        print(f"  {w['if_it_re_walked']} calls a day if the per-fixture feeds "
              f"re-walked them (they do not)")
        print(f"  {w['as_built']} extra as built — a recorded fixture is never "
              "fetched twice")

    peak = out["days"]["peak"]["total"]
    if peak > args.ceiling:
        sys.exit(f"\nERROR: a peak day is {peak} calls, over the {args.ceiling} "
                 f"ceiling. The allowance is {DAILY_ALLOWANCE}; the ceiling is "
                 "deliberately below it so that a bad day has somewhere to go.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

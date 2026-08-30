#!/usr/bin/env python3
"""The budget model, and the usage counter it is checked against.

Two separate things are proved here.

THE MODEL (api_budget) must read the schedule rather than restate it, and must
read it CORRECTLY: `5 10-21 * * *` is one cron line and twelve firings a day,
and the first draft of that file computed the twelve and then used the one.

THE COUNTER (harvest_apifootball.note_usage) is the better answer to the same
question, because the API reports the exact allowance remaining on every
response. It has to survive the shapes a real response actually arrives in —
absent headers, a header that is not a number, and a refusal that carries them
anyway — because it runs on the error path, where the number matters most and
where an exception would replace a useful message with a stack trace.
"""

import http.client
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import api_budget as B          # noqa: E402
import harvest_apifootball as af  # noqa: E402

fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


# ── the cron reader ──────────────────────────────────────────────────────
check(B.cron_runs_per_day("40 5 * * *") == 1, "a fixed hour is one firing a day")
check(B.cron_runs_per_day("5 10-21 * * *") == 12,
      "10-21 is twelve firings, not one — this is the whole bug the model had")
check(B.cron_runs_per_day("0 */4 * * *") == 6, "*/4 is six firings a day")
check(B.cron_runs_per_day("0 7,15,19 * * *") == 3, "a list is one firing each")
check(B.cron_runs_per_day("30 7 * * 1") == 1,
      "a weekly job still costs a full run on the day it fires — the budget is "
      "about the worst day, not the average one")

# A schedule the model does not understand must be REFUSED, not counted as one.
# Silently reading a per-minute cron as a daily one understates the bill by
# three orders of magnitude, and does it without a word.
for bad in ("* * * * *", "*/5 * * * *", "nonsense"):
    try:
        B.cron_runs_per_day(bad)
        fails.append(f"{bad!r} was accepted; an unrecognised schedule must be refused")
    except SystemExit:
        pass

# ── the model is wired to the real files ─────────────────────────────────
shapes = B.league_shapes()
check(set(shapes) == {"PL", "EFLC", "LL"}, "all three divisions are shaped")
for code, s in shapes.items():
    check(s["clubs"] >= 20, f"{code} has {s['clubs']} clubs, which cannot be right")
    check(s["fixtures"] >= 300, f"{code} has {s['fixtures']} fixtures")
# A division plays every other club home and away.
for code, s in shapes.items():
    expect = s["clubs"] * (s["clubs"] - 1)
    check(s["fixtures"] == expect,
          f"{code}: {s['fixtures']} fixtures for {s['clubs']} clubs, expected {expect}")

check(B.firings("extra-feeds.yml") == len(B.crons("extra-feeds.yml")),
      "extra-feeds' crons are all fixed hours, so firings and lines agree")
check(B.firings("lineups.yml") > len(B.crons("lineups.yml")),
      "lineups.yml is one cron line and many firings — if these are equal the "
      "model is counting lines again")

# ── the budget lands where it says it does ───────────────────────────────
typical, _ = B.budget(shapes, "typical")
peak, facts = B.budget(shapes, "peak")


def total(rows, worst=False):
    """The day's cost. `worst` takes the dearest branch of each alternative
    rather than the one actually observed."""
    t = sum(r * c for _, r, c, _, g, _o in rows if g is None)
    seen, dearest = {}, {}
    for _, r, c, _, g, o in rows:
        if g is None:
            continue
        dearest[g] = max(dearest.get(g, 0), r * c)
        if o:
            seen[g] = seen.get(g, 0) + r * c
    for g in dearest:
        t += dearest[g] if worst else seen.get(g, dearest[g])
    return t


check(total(peak) > total(typical), "a peak day must cost more than a typical one")
check(total(peak) < B.DAILY_ALLOWANCE,
      f"a peak day is {total(peak)} against an allowance of {B.DAILY_ALLOWANCE}")
# THE FALLBACK MUST FIT TOO. The live feed inlines its events today, which is
# why the observed figure is what it is. Nothing would announce the day it
# stops — the ticker would simply start costing twenty times more — so the
# branch we are NOT on has to sit inside the allowance as well.
check(total(peak, worst=True) < B.DAILY_ALLOWANCE,
      f"the peak-day fallback is {total(peak, worst=True)} against "
      f"{B.DAILY_ALLOWANCE}")
check(total(peak, worst=True) > total(peak),
      "the worst case must exceed the observed cost, or the alternatives are "
      "not being distinguished at all")

# EXACTLY ONE branch of each alternative is the observed one. Both marked, or
# neither, and the total is back to being a guess.
groups = {}
for _, _r, _c, _w, g, o in peak:
    if g is not None:
        groups.setdefault(g, []).append(o)
for g, flags in groups.items():
    check(sum(1 for f in flags if f) == 1,
          f"alternative group {g!r} has {sum(1 for f in flags if f)} observed "
          "branches; exactly one is right")
check(facts["played"] > 0 and facts["upcoming"] > 0, "the peak day has football in it")

# Every row must carry a reason. A budget line without one is a number nobody
# can check, and the ones that were wrong were wrong in the derivation.
for name, runs, cost, why, _g, _o in peak:
    check(bool(why and why.strip()), f"budget row {name!r} has no derivation")
    check(runs >= 0 and cost >= 0, f"budget row {name!r} has a negative term")

# ── the usage counter ────────────────────────────────────────────────────
def Headers(pairs):
    """A REAL http.client.HTTPMessage, not a stand-in.

    note_usage is handed `r.headers` from urlopen, and the thing that makes
    capitalisation a non-issue is that HTTPMessage.get is case-insensitive —
    a property of the standard library, not of this code. A hand-rolled fake
    with its own case-insensitive get would prove only that the fake works,
    which is exactly the sort of test that passes while the real path breaks.
    """
    msg = http.client.HTTPMessage()
    for k, v in pairs.items():
        msg[k] = v
    return msg


af._usage.update({"limit": None, "remaining": None, "spent_here": 0})
check(af.usage_line() is None, "nothing fetched means nothing reported")

af.note_usage(Headers({"x-ratelimit-requests-limit": "7500",
                       "x-ratelimit-requests-remaining": "7000"}))
line = af.usage_line()
check("500 of 7500" in line, f"500 spent should be reported: {line}")
check("7000 left" in line, f"the remaining figure should be reported: {line}")
check("1 call(s) this run" in line, f"this run's own count should be reported: {line}")

# The header is CASE-INSENSITIVE in HTTP and arrives capitalised from some
# proxies; a counter that only matches lower-case reports nothing and says so
# in a way that reads like the API withholding it.
af._usage.update({"limit": None, "remaining": None, "spent_here": 0})
af.note_usage(Headers({"X-RateLimit-Requests-Limit": "7500",
                       "X-RateLimit-Requests-Remaining": "6000"}))
check("1500 of 7500" in (af.usage_line() or ""),
      f"capitalised headers must count too: {af.usage_line()}")

# A garbled header must not lose the run, and must not overwrite a good value
# with a guess.
af.note_usage(Headers({"x-ratelimit-requests-remaining": "unavailable"}))
check("6000 left" in (af.usage_line() or ""),
      f"a bad header must leave the last good figure alone: {af.usage_line()}")

# No headers at all is a truthful report, not a crash and not a fabricated zero.
af._usage.update({"limit": None, "remaining": None, "spent_here": 0})
af.note_usage(None)
check("1 call(s) this run" in (af.usage_line() or ""),
      "a response with no headers still counts as a call")
check("were not returned" in (af.usage_line() or ""),
      "and says the allowance is unknown rather than implying it is fine")

if fails:
    print(f"test_api_budget: {len(fails)} FAILED")
    for f in fails:
        print(f"  - {f}")
    sys.exit(1)

# Leave the counter as we found it, so the atexit report does not print a run
# that never happened.
af._usage.update({"limit": None, "remaining": None, "spent_here": 0})

print(f"test_api_budget OK: crons counted as firings, "
      f"{len(shapes)} divisions shaped from their own fixture lists, "
      f"a peak day {total(peak)} of {B.DAILY_ALLOWANCE}, and the allowance "
      "counter surviving capitalised, garbled and absent headers")

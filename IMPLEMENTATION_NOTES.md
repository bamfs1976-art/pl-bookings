# Implementation notes

The running log for work on the Bookings Desk. One dated heading per piece of
work, newest first: what changed, what was deferred and why. Everything before
8 September 2026 (the July audit follow-up and the August portfolio review) is
in [docs/decisions.md](docs/decisions.md); the audit itself is
[docs/audit-2026-07.md](docs/audit-2026-07.md).

## Review follow-up, task 2: documentation reset (2026-09-08)

The README had grown to 71 KB and read as a changelog. It is now an orientation
page under 400 lines, and every section it used to carry moved, unchanged, into
one file per subject under `docs/`: overview, views, live-data, accounts,
calibration, model, deploy, navigation, mobile, data-pipeline, leagues,
share-cards, backtest, vendored-libraries, tests-and-ci, sources and push. Each
carries a note saying which README section it was. `docs/referees.md` is new:
the referee path crossed five of those sections, so it is an index rather than
a move.

`AUDIT.md` became `docs/audit-2026-07.md` with a status table at the top,
each finding marked closed or open with the commit or file that closed it.
`ENHANCEMENTS.md` and the previous `IMPLEMENTATION_NOTES.md` merged into
`docs/decisions.md` with their dated headings kept. This file is the short
root log that replaces them.

Checked before moving anything: no guard reads `README.md`. The only scripts
that named the three old files did so in comments, and those comments now name
the new paths. `docs/SEASON_RESEARCH_2026-08.md` and `docs/free-data-sources.md`
linked to `ENHANCEMENTS.md` and `AUDIT.md`; both links are repointed.

## Review follow-up, task 1: the per-player backtest (2026-09-08)

`backtest_report.md` read "No run yet" for two months while the Data refresh
workflow ran every morning. What the log of run 144 (8 September 2026) shows:

- The harvest step works on the GitHub runner. `data/harvest_history.py`
  fetched 387 players and wrote 929 match rows over 3 gameweeks, 115 booked.
  The FPL endpoint is reachable from `ubuntu-latest`, so no `workflow_dispatch`
  input for a hand-produced report is needed and none was added.
- `build-model.mjs --fit` kept the season prior, correctly: its gate is 1500
  rows over 5 gameweeks and the history had 929 over 3.
- `scripts/backtest.mjs --report backtest_report.md` then failed with "No
  match history at backtest_report.md". The positional-argument parser knew
  that `--label` and `--out` take a value and did not know that `--report`
  does, so the report name was read as the history path. The workflow line
  ended in `|| true`, so the failure was swallowed and the step stayed green.

Fixed by naming every valued flag in one list in `scripts/backtest.mjs`, and by
removing the `|| true` so a real failure shows as a yellow step under
`continue-on-error`. Too few rounds is no longer a failure in report mode: the
script writes a dated "no scoring run yet" report stating the rows and rounds
it had and the first round it could score, then exits clean. Three tests in
`tests/test-libs.mjs` run the script as a child process with the workflow's own
argument shapes.

Why the committed report still carries no run: this sandbox cannot reach
`fantasy.premierleague.com` (the egress proxy refuses the CONNECT), so the
history cannot be harvested here, and the fix has not yet run on the runner.
The next scheduled Data refresh after this lands writes and commits the report.
On 8 September the 2026-27 season has three completed gameweeks, so that first
report will say "no scoring run yet" with the counts, and the first scored run
lands once gameweek 5 is complete: the walk-forward warms up to round 5 and
needs 200 training rows behind it. The model is untouched by any of this.

Noted for later, not changed: `harvest_history.py --season-past` reads FPL's
`history_past`, which is one row per season rather than per match, so that
flag cannot build a walk-forward table. It is not used by the workflow.

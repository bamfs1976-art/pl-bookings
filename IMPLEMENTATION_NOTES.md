# Implementation notes

The running log for work on the Bookings Desk. One dated heading per piece of
work, newest first: what changed, what was deferred and why. Everything before
8 September 2026 (the July audit follow-up and the August portfolio review) is
in [docs/decisions.md](docs/decisions.md); the audit itself is
[docs/audit-2026-07.md](docs/audit-2026-07.md).

## Serie A desk, task 1: registry entry and the Italian suspension rule (2026-09-09)

`data/leagues.py` gains `SA` (fd_div I1, mirror slug serie-a, 20 clubs, 380
matches, API-Football league 135, referees bought from API-Football, a
three-match floor, division discovered into `seriea_clubs.json`) and a `SERB`
feeder (league 136, no referees, no desk) for the promoted clubs, mirroring
`SEG`. The Serie A spelling tables sit beside La Liga's, and the resolver that
was La Liga's alone (`laliga_short`, `canon_name`, `assign_shorts`) is now one
league-aware walk over a `DISCOVERED` table, with `registry_owner()` sending a
feeder to the registry of the division it feeds. Short codes are chosen clear
of every other desk's, because `/today` merges the colour tables: Bologna is
BGN, Milan ACM, Bari BRI, Livorno LVO. `assign_shorts` now seeds its taken set
with the other leagues' codes, so a generated code cannot collide either.

**The suspension rule is not the one the brief stated, and this is flagged
for a decision.** The brief said one match at the 5th, 10th and 15th caution
and every second caution after that. Three independent sources quoting art.
19 of the Codice di Giustizia Sportiva all give a different progression: one
match at the fifth caution, then at the fifth, fourth, third and second
caution after each ban, then at every caution. Bans at 5, 10, 14, 17, 19, 20,
21 and so on; the well-known *diffida* list of 4, 9, 13, 16, 18. The brief
also said never to guess a rule, so the desk prices what the sources say.
Neither the FIGC PDF nor the legal databases that reprint it could be opened
from this environment (the egress proxy refuses figc.it, altalex.com and
aia-figc.it), so the rule rests on corroborated quotations, exactly as La
Liga's did. `docs/italy-suspensions.md` records the quotations, the sources,
the disagreement with the brief, and what to check on an open network.

The two existing shapes could not express "and every caution after the last
rung", so the ladder shape gained an optional `then_every` tail.
`PLDCore.nextSuspension` steps past the last rung by that interval and never
declares such a player dead; `assets/suspension.js` measures the pips over
one step once the tail is reached. The English ladders carry no tail and
behave exactly as before, and the three existing guards still reject each
other's schemes by shape. Five tests in `data/test_leagues.py` and two in
`tests/test-core.mjs` pin all of it.

## Review follow-up: closing entry (2026-09-08)

Six commits on `claude/bookings-desk-review-followup-b8yztv`, one per task,
in order. Every step in `.github/workflows/ci.yml` was run locally before each
commit and again at the end: 36 guards, three node test files, fifteen Python
test files and the syntax checks, all green. No model constant, shrinkage,
card line, derby boost or referee pivot changed. No guard was added or
deleted.

What changed:

1. **The per-player backtest runs.** A flag-parsing bug in `scripts/backtest.mjs`
   and a `|| true` in the workflow had hidden two months of silent failure.
   Fixed and pinned with three child-process tests.
2. **Documentation reset.** `README.md` is a 222-line orientation page; the
   old prose is under `docs/`, one file per subject, unchanged; the audit,
   the enhancements record and the old notes are `docs/audit-2026-07.md` (with
   closure status) and `docs/decisions.md`.
3. **Branding sweep.** Nothing outside `docs/decisions.md` names the retired
   app. Page titles aligned; `og:image` absolute on the confirmed domain.
4. **Supabase client vendored** as `assets/vendor/supabase.js` (55 KB
   gzipped), pinned at 2.116.0; no CDN in `script-src`.
5. **Tabulator loaded on demand** from `assets/vendor/tabulator.js`;
   `index.html` on the wire from 289,828 to 190,645 gzipped bytes.
6. **Guard review** in `docs/guards.md`: 38 scripts, one line each, four
   flagged as cheaper unit tests and seven as splittable. A report, not a
   change.

Deferred, and why:

- **The first backtest report with numbers in it.** The fix cannot run here
  (the FPL endpoint is unreachable from this environment) and, with three
  gameweeks played, the first scored run needs gameweek 5 anyway. The next
  scheduled Data refresh writes the dated "no scoring run yet" report; the
  first scored report follows gameweek 5. Reading it is a person's job before
  anyone touches the model.
- **Sign-in on the deployed preview** with a real account, then pick sync and
  the AI review. Neither the preview nor `supabase.co` is reachable from
  here. The sign-in flow was driven in headless Chromium against a local
  server with the Supabase call intercepted, and only the library's source
  changed, but the review asked for the deployed check and it has not been
  done.
- **Moving any guard to a unit test.** Flagged in `docs/guards.md`, not
  moved: the brief asked for a report for a human decision.
- **`harvest_history.py --season-past`** reads per-season rows and cannot
  build a walk-forward table. Unused by the workflow; noted under task 1.

## Review follow-up, task 5: Tabulator is loaded on demand (2026-09-08)

Tabulator was 432 KB of the 574 KB vendored into `index.html`, and only the
Screener view uses it. Its script block is now `assets/vendor/tabulator.js`,
hash-pinned by `scripts/vendor-libs.mjs` exactly as before (same recorded
SHA-256, the bytes did not move), and `mountScreener()` in `index.html` loads
it the first time the Screener opens. While it arrives the table area reads
"Loading the grid"; if the load fails it says so and points at the Season
risk table, and the next opening tries again. One in-flight promise, so
tapping the tab twice cannot append two script tags. The other views never
wait on it. The stylesheet block stays inline at 28 KB.

`index.html` on the wire, measured with `gzip -9`: 289,828 bytes gzipped
(1,053,876 raw) before, 190,645 gzipped (613,314 raw) after. The Screener pays
100,078 gzipped bytes once, cached separately across deploys.

The service worker precaches the file (cache `plb-v21`), so the installed app
still opens the Screener offline; `scripts/check-mobile.mjs` still passes on
the atomic precache. `tests/test-libs.mjs` now compiles the file rather than
the block, and a new test pins the loader, the two states, the shell entry and
that the block is not inlined again. Driven in headless Chromium: no request
for the file on page load, the loading state on opening the Screener, then a
grid of 40 virtual rows over 652 players; with the request blocked, the
failure message and no script tag left behind.

## Review follow-up, task 4: the Supabase client is vendored (2026-09-08)

**Decision: vendor it.** `index.html` loaded `@supabase/supabase-js` from
jsDelivr at a floating `@2`: the one third-party script on a page whose
documentation said it fetched none, and a version nobody had pinned. The
package publishes only an unminified UMD build. Measured from the npm tarball
for 2.116.0: 218 KB on disk, 55 KB gzipped, inside the 150 KB gzipped budget
the review set for this route. It is vendored as published rather than
minified here, because a file minified by our script would no longer be bytes
anyone can check against upstream.

It lives as a file, `assets/vendor/supabase.js`, not inline. The script is
deferred and only needed once somebody signs in; inlining would have added its
weight to every render. `scripts/vendor-libs.mjs` gained a `target` field for
file-vendored libraries and an `--only <id>` flag; `--check` hashes a file the
same way it hashes a block, and the CI step is unchanged. `script-src` in both
the meta tag and `_headers` no longer names a CDN. The service worker precaches
the file (cache `plb-v20`). The Sources and licences view lists it.

Tested here: `tests/test-libs.mjs` evaluates the committed file in a VM and
asserts it defines `supabase.createClient`, that the page loads it by that
path, that the shell precaches it and that nothing names jsDelivr. In headless
Chromium against a local server, with requests to the Supabase project
intercepted because this sandbox cannot reach it: the client is created on
load, the account button opens the form, a sign-in posts to
`/auth/v1/token?grant_type=password` with the publishable key in the `apikey`
header, and the auth error is shown in the form. The only requests leaving
the origin were Google Fonts and that Supabase call.

Not tested here, and still to do before merging: sign-in on the deployed
preview with a real account, and pick sync and the AI review after it. The
deploy preview and `supabase.co` are both unreachable from this environment.
Nothing in the sign-in, sync or review code paths changed; only where the
client library is loaded from.

## Review follow-up, task 3: branding sweep (2026-09-08)

BAProTips is retired; Bookings Desk is the product name. Searched every file
for `BAProTips`, `playerbookings.netlify.app`, `Premier League Bookings Desk`
and the old app's long name. Outside `docs/decisions.md`, where the historical
mentions stay with a dated retirement note added, nothing now carries any of
them. What changed: the sibling-desk intro on the Championship and La Liga
pages, the calendar export's note and `PRODID`, the AI-review comments in
`index.html` and `netlify/functions/insights.js`, the `netlify.toml` and
`build_pl_data.py` headers, and three research documents. The manifest, `og.png`,
the share-card straps and wordmarks and the first-run tour already said
Bookings Desk and were left as they were; `scripts/check-share.mjs` still
proves every card carries the 18+ line.

Two small extras in the same sweep: the Championship, La Liga and Today page
titles now follow the Premier League desk's `Bookings Desk · <league>` shape,
and `og:image` and `twitter:image` on the Premier League desk are absolute
(`https://bookingsdesk.netlify.app/og.png`), which closes the item the July
notes deferred until the domain was settled. The Netlify project name was
checked before that URL was written.

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

# Implementation notes

The running log for work on the Bookings Desk. One dated heading per piece of
work, newest first: what changed, what was deferred and why. Everything before
8 September 2026 (the July audit follow-up and the August portfolio review) is
in [docs/decisions.md](docs/decisions.md); the audit itself is
[docs/audit-2026-07.md](docs/audit-2026-07.md).

## Serie A desk: the first data run, and what it caught (2026-09-09)

Data refresh run 148 on this branch, with `refresh_seriea` on and the other
desks off. Every Serie A harvest, the build and the referee join succeeded;
the guard step then failed on two of my own files and **nothing was
committed**, which is the pipeline behaving exactly as designed.

**The numbers the brief asked for, from the run log:**

| | |
|---|---|
| Referee join | **380 of 380** matches got an official, from 380 fixtures |
| `seriea_ref_fixtures.js` | 380 matches over 20 clubs, 380 with an official named |
| `seriea_fixtures.js` | 380 fixtures over 38 matchdays, 30 with a referee appointed |
| Dataset | 643 players, 20 of 20 clubs with players, 17 of 20 with a measured card rate |
| Basis split | SA 411, SB 49, NEW 183 |
| This season's cautions | 514 players |
| Referees | 32 above the 3-match floor, 11 dropped below it; 33 abbreviated spellings merged |
| League rate | 3.67 yellows a game, against the 3.70 the desk quotes |
| API cost | 60 calls for the whole Serie A leg; 1,055 of 7,500 used that day |

`check-seriea.mjs` passed on the real data: 20 clubs, 643 players, P(card) max
43.9% and median 13.6%, 32 referees over 363 counted matches, fixtures pricing
3.27 a match against the league's 3.67. `check-models.mjs` put Serie A at
15.2% priced against 14.7% observed.

**What the guards caught.** The division the feed discovered is not the one
2025-26 finished with. Frosinone, Monza and Venezia came up; Cremonese, Hellas
Verona and Pisa went down. I had written the club colour table and the derby
list from last season's twenty, so:

- `check-share.mjs`: no colour for Frosinone. A club with no entry draws a hue
  hashed from its three letters on the page and the league ink on a share
  card, which looks deliberate and is not.
- `check-derbies.mjs`: six pairs named clubs that are not in the division
  (Sampdoria, Brescia, Hellas Verona, Pisa, Empoli). A derby pair naming a
  relegated club is a fixture that can never be played and a boost that can
  never be applied.

Both are now fixed against the discovered twenty: the colour table is exactly
the division (Frosinone takes the giallazzurri yellow rather than a fourth
blue), and the derby list keeps the eleven pairs whose clubs are both in it.
The Genoa and Sampdoria, Verona and Venezia and Tuscan derbies are real and
are left out until both clubs are up, with the reason written beside them.

**The lesson, recorded rather than papered over.** A discovered division was
the right call and I still hand-wrote two lists against a division I assumed.
Nothing on the page would have shown either fault: a hashed colour looks like
a colour, and a derby that never occurs never renders. The guards that caught
them read the shipped dataset, which is why they could only fire once the
data existed, and why the desk was described in the previous entry as wired
but unproven. It is now proven on one run, and the run refused to ship what
was wrong.

**Run 149, on the fixed lists: every guard passed and the commit step failed**
on a fault of mine that neither the guards nor a local run could see.
`.gitignore` carries `*.log` and `data/*.json` as blanket rules with a
written-down exception per file that is genuinely shipped, and I had added
three Serie A files to the workflow's commit list without the matching
exceptions. `git add` on an ignored path exits non-zero, the step runs under
`bash -e`, and the run stopped there.

Two of the three would have been silent rather than loud if the log had not
been in the same list:

- `data/seriea_clubs.json`, the discovered registry. It is the only record of
  which twenty clubs the desk is about, and `check-seriea.mjs` skips its
  registry-against-dataset check when the file is absent. The desk would have
  shipped with no registry and nothing would have said so.
- `data/seriea_refs.json`, the referee table `data/appointments.py` resolves a
  published official against. Absent, every AIA name stays unresolved and
  every Serie A fixture prices at the league rate, which on the page is
  indistinguishable from a neutral referee.
- `data/seriea_harvest.log`, which is the loud one: `git add` refused it and
  took the step down, which is how the other two were found.

All three now carry the same written-down exception La Liga's equivalents
have, with the reason beside each.

**Run 150 committed the data.** `data/seriea_clubs.json`,
`seriea_data.js`, `seriea_fixtures.js`, `seriea_ref_fixtures.js`,
`seriea_refs.json`, `seriea_status.txt` and `seriea_harvest.log` are in the
repository, and the desk was rendered against them in headless Chromium at
393px: twenty clubs, thirty-two officials, 322 player rows through the
450-minute filter, the next round's fixture cards with the Italian referee
dropdown, and a suspension strip reading "2 more for 1 match" on the Italian
rungs. No console errors.

**One file the runner could not produce, and why.** `data/seriea_h2h.js` was
missing: `build_h2h.py --league SA` maps club names through the discovered
registry, and the workflow runs the head-to-head step near the top, among the
free sources, while the registry is written by the keyed discovery step much
further down. On a first run there was no registry to map with, so the step
reported itself unavailable and carried on, exactly as it is written to. The
mirror it reads is reachable from the build environment, so the file was built
here with the repository's own script (187 pairs, 1,242 meetings, 4.21 yellows
a meeting) and committed. From the next run onward the registry is in the
repository before that step reads it, which is the same reason the La Liga
step has always worked, and no reordering is needed.

**The offline shell** now carries `seriea_data.js`, `seriea_fixtures.js` and
`seriea_h2h.js`, added only once the files existed so `check-mobile.mjs` never
precaches a path that is not there. `seriea_fxstats.js` is written by
extra-feeds.yml and is deliberately not precached until it exists: `addAll` is
atomic and one missing file empties the whole shell.

**Still open**: the AIA appointments route. The fixtures workflow has not run
on this branch, so whether a GitHub runner can fetch aia-figc.it is still
unestablished, and until it is, the official on a Serie A fixture card comes
from the API-Football feed, which is what the page's Guide says.

## Serie A desk: closing entry (2026-09-09)

The fifth desk is built and wired. Eight commits, one per task, in the order
the brief set them out. What follows is what a reviewer needs before deciding
whether to merge, and every place the work stops short of the definition of
done.

**What ships.** `/seriea` renders twenty clubs, per-player rates, a referee
table, an appointments strip and a suspension strip on the Italian rungs; the
La Liga desk, its guards and its numbers are untouched. The registry
(`data/leagues.py`) carries Serie A as a discovered division on football-data
`I1` and API-Football league 135, with Serie B (`SERB`, league 136) as its
feeder. `data/build_seriea_data.py` produces the dataset through the shared La
Liga builder configured for Italy, so the two discovered leagues cannot drift
about what a booking risk is. `scripts/check-seriea.mjs` is the one new guard
the brief allowed and is wired into `ci.yml`.

**The suspension rule disagrees with the brief, deliberately.** The brief said
the 5th, 10th and 15th caution then every second one. Three independent
quotations of art. 19 of the FIGC's Codice di Giustizia Sportiva all give 5,
then 10, 14, 17, 19, then every caution, and that is what the desk prices.
`docs/italy-suspensions.md` sets out both readings, the sources, and the fact
that the Codice itself could not be opened from here. If the brief turns out
to be right, the fix is five lines in the registry and nothing else.

**The budget, from `python3 data/api_budget.py` with four divisions:**

| Day | As observed | Worst case | Worst case as a share of 7,500 |
|---|---|---|---|
| typical | 1,623 | 3,063 | 41% |
| peak | 2,127 | 4,767 | 64% |

The brief's condition was a worst case under 70% of the allowance. It is 64%,
and `check-api-budget.mjs` passes. The Serie A fixture list does not exist
yet, so `api_budget.league_shapes` shapes that division from the registry (20
clubs, 380 matches) and says so on stderr; once the harvest lands, the file
wins and a test requires the two to agree.

**What is not done, and why.**

1. **No Serie A data has been harvested.** API-Football is unreachable from
   this environment (the egress proxy refuses the CONNECT), so
   `seriea_clubs.json`, `seriea_players.json`, `serieb_players.json`,
   `sa_squads.json`, `seriea_season_cards.json`, `seriea_ref_fixtures.js`,
   `seriea_fixtures.js`, `seriea_refs.json` and `seriea_data.js` do not exist
   in the repository. Every guard that reads them skips with a printed note
   rather than failing, and `check-seriea.mjs` skips entirely. **The desk is
   therefore wired and unproven**: the definition of done asks for a page
   rendering twenty clubs with a 380-of-380 referee join, and that cannot be
   established until the Data refresh workflow has run on a runner with the
   key. That run is the next step and its output belongs in this file.
2. **The referee join count is unknown.** It must be 380 of 380; below that is
   a blocker by the brief and by `check-seriea.mjs`, which fails a table built
   on less than 95% of the season.
3. **The AIA appointments route is unproven.** `aia-figc.it` and every mirror
   tried refuse the network here, so the index shape and the block layout come
   from published excerpts of the articles rather than the pages. The parser,
   the chooser and the surname resolver are all tested against those excerpts
   without the network. Until a `fixtures.yml` run shows the fetch working,
   the official on a Serie A fixture card comes from the API-Football feed,
   and the page says so in its Guide.
4. **No `check-desk-parity` script exists.** The brief listed it among the
   guards that must pass with five desks. The repository has
   `docs/desk-parity.md` (a document, not a script); the parity checks
   themselves live across `check-nav`, `check-styles`, `check-firstrun` and
   `check-desk-widgets`, and all four now include `seriea.html`.

**Guards and page lists that gained the fifth desk**: `check-nav`,
`check-styles`, `check-mobile`, `check-clock`, `check-inline`,
`check-contrast`, `check-palette`, `check-firstrun`, `check-desk-widgets`,
`check-suspension`, `check-cross-refs`, `check-derbies`, `check-share`,
`check-models`, `check-matchday`, `check-match-record`, `check-referees`,
`check-appointments`, `check-fetch-appointments`, `check-extra-feeds`,
`check-api-budget`, `check-build-data`, plus `accas.mjs`, `form-season.mjs`
and `ref-coverage.mjs`, which now skip a division whose dataset the workflow
has not produced yet and say so on stderr rather than crashing.

**Deliberate changes to existing guards, and why**: `check-models` expected
exactly three harvests following the form transition and now expects four
(the Serie A squads join them); `check-referees` expected
`for L in PL EFLC LL` in `fixtures.yml` and now expects `SA` too, and checks
`refresh_seriea` and `season_it` alongside the other inputs;
`check-fetch-appointments` requires the appointments loop to cover Serie A;
`check-cross-refs` reads a fourth referee table. Each was updated because the
change under it was deliberate, and each was confirmed to still fail on the
old shape.

**The full CI list passes locally**, 58 steps, with the Serie A data files
absent. `python3 data/test_seriea.py` is 23 tests, `data/test_appointments.py`
36, `data/test_leagues.py` 29, `tests/test-core.mjs` 169.

## Serie A desk, task 7: budget, workflows and check-seriea.mjs (2026-09-09)

`data/api_budget.py` shapes four divisions. Until the refresh workflow has
produced `seriea_fixtures.js` the Serie A shape comes from the registry (20
clubs, 380 fixtures) and the model says so on stderr; once the file exists it
wins, and `data/test_api_budget.py` insists the two agree. The daily refresh
row gained the Serie A squads, roster and cautions, the Serie B feeder
(`FEEDER_CLUBS["SERB"] = 20`) and a second discover-and-ref-fixtures pair;
the per-division terms (fixtures, ledger listings, standings, registry, card
leaders, injuries) count the divisions rather than assuming three.

The totals, from `python3 data/api_budget.py` on this branch:

| day | as observed | of 7,500 | worst case (live feed stops inlining events) |
|---|---|---|---|
| typical | 1,623 | 22% | 3,063 (41%) |
| peak | 2,127 | 28% | 4,767 (64%) |

Before Serie A the same model read 1,298 typical, 1,682 peak and 3,842 worst
case, so the fifth desk costs about 325 calls on a typical day and 445 at
peak. The brief's 285-a-day estimate was for the harvests alone; the
difference is the per-fixture feeds and the odds walk, which grow with the
number of fixtures in view. The worst case stays under the 5,000 ceiling and
under 70% of the allowance (5,250), so the guard passes without the ceiling
moving.

Workflows: `data-refresh.yml` gained `refresh_seriea` and `season_it` inputs,
an Italian harvest log, and the Serie A block in the order the registry
demands (discover, squads on the form decision, rosters, this season's
cautions, Serie B, last season's officials, fixtures), then the build and
the referee join after Spain's, the Serie A head-to-head, the player-match
backfill loop and the commit list. `fixtures.yml` walks four divisions for
fixtures and the ledger, fetches appointments for `LL EFLC SA` with format
`aia` for Italy and stages the Serie A files. `extra-feeds.yml` and
`lineups.yml` pass `PL,EFLC,LL,SA`; `live-check.yml` compares `seriea.html`.
`scripts/build_data.py` runs the Serie A build and referee steps now that
the workflow does, which is what `check-build-data.mjs` requires.

`scripts/check-seriea.mjs` is the La Liga guard for Italy: registry against
dataset, every club a real squad, a referee join that must cover at least 95%
of 380 matches (the brief's 380-of-380 condition, allowing for officials
under the 3-match floor), the strip reading `sc` and never `yc`, and the
shipped scheme checked by shape: a cumulative ladder with rungs at 5, 10, 14,
17 and 19, every ban one match, no gate, `then_every` 1, walked through
`PLDCore.nextSuspension`; England's gated, escalating ladder and Spain's
cycle are both shown to fail the same check. The league yellow rate must sit
in the 2025-26 range (3.0 to 4.6 a game), not the old Italian six-season
figure. It skips with a printed line until the dataset exists. Wired into
`ci.yml` after the La Liga guard.

Guards updated because of deliberate changes, and said so in the commit:
`check-referees.mjs` now requires `for L in PL EFLC LL SA`, the
`refresh_seriea` input and a `season_it` default; `check-fetch-appointments`
requires the appointments loop to name SA; `check-models.mjs` expects four
harvests on the form transition (Serie A squads joined the three). The full
CI list, now 58 steps, runs green locally.

## Serie A desk, task 6: the page, navigation and share cards (2026-09-09)

`seriea.html` is `laliga.html` with every La Liga reference replaced by a
checked substitution list (each replacement asserted to occur exactly the
number of times expected, so a drifted line fails the build script rather
than surviving): `lg-sa`, the `SA` brand dot, the data files and globals
(`seriea_data.js`, `SERIEA_PLAYERS`, `SERIEA_FIXTURES`, `SERIEA_FXSTATS`,
`SERIEA_H2H`), the `seriea_desk_` storage keys, `DERBY_LEAGUE`, the share
context, the live-cards query, the app shell (code `SA`, accent `#14532d`),
the tour and the Guide. The Guide states the 2025-26 rate as 3.70 yellows a
game and says outright that older multi-season Italian averages are not used;
the suspension copy gives the 5 / 10 / 14 / 17 / 19 / then-every-caution
rule, names `docs/italy-suspensions.md`, says the Codice itself was not read
and that the commissioning brief stated a different progression; the
referee paragraph says the appointment comes from the API-Football feed until
the AIA route is confirmed from a runner. Basis pills are `SA` and `SB`.
Serie A is wired into the nav on every page, `today.html` (league bar, a
fourth data frame, `SOURCES`, `SHARE_META`, the copy that counted three
divisions), `data-frame.html`, `_redirects` (`/seriea`, `/serie-a`, before
the catch-all), the service worker shell (`/seriea.html`, version bumped to
plb-v22), `assets/core.js` (`LEAGUE_LABEL`, a Serie A derby list in the
registry's codes), `assets/share.js` (an `SA` theme: from `#052e16`, to
`#16a34a`, ink `#14532d`, its own wordmark and slug), `assets/clubcolours.js`
(a Serie A table) and `assets/tw.css` (`--sa` and `--sa-ink`, `lg-sa` in both
themes, `.lb-sa`, `.pill.sa`, `.lg.SA`, a fourth colour in the multi-league
gradients and dot rows). The Netlify functions and the pipeline scripts that
list divisions (`live-cards`, `match-record`, `model-calibration`,
`build_bookings.py`, `build_h2h.py`, `harvest_extra.py`, `accas.mjs`,
`form-season.mjs`, `ref-coverage.mjs`) know the fifth desk.

Contrast: `--sa-ink` `#166534` reads at 6.3:1 or better on every light
ground and the dark mark `#4ade80` at 9:1 or better; `check-contrast` now
covers `lg-sa` and `--sa-ink`, and `check-palette` pins the share theme to
the tokens and the page's theme-colour to the card's deep end.

Guards: every page list gained `seriea.html` (`check-nav`, `check-clock`,
`check-inline`, `check-mobile`, `check-styles`, `check-contrast`,
`check-palette`, `check-desk-widgets`, `check-firstrun`, `check-suspension`,
`check-cross-refs`, `check-derbies`, `check-extra-feeds`, `check-api-budget`,
`check-matchday`, `check-referees`, `check-share`, `check-match-record`,
`check-models`). "check-desk-parity" is named in the brief and does not
exist as a script; the parity checks live in the guards above and in
`docs/desk-parity.md`, and no new guard was invented for it. Where a guard
reads a division's dataset, the Serie A entry is skipped with a printed note
until the refresh workflow has produced the files: `accas.mjs`,
`form-season.mjs` and `ref-coverage.mjs` filter their league lists on file
existence and say so on stderr, `check-share` and `check-nav` print a
"not built yet" line for the Serie A dataset and history. The four Serie A
data files are not yet in the service-worker precache because
`check-mobile` requires every precached path to exist; they go in with the
data in task 8.

Rendered in Chromium against a local server: `/seriea.html` loads with no
page error, wears `lg-sa`, shows the five-desk league bar and, with no
fixture file yet, the "No fixture list yet" notice naming the harvest that
produces it. Every one of the 55 guards and test suites passes, and the full
CI list runs green locally.

One thing to say plainly: `seriea.html` inherits the punctuation of
`laliga.html`, including the em dashes in the prose that was copied
unchanged. None of the lines written for this desk carry one. Stripping the
inherited ones would mean rewriting a hundred lines of prose the two desks
share, and that is a decision for the reviewer rather than a side effect of
this task.

## Serie A desk, task 5: AIA appointments (2026-09-09)

The AIA publishes Serie A designations one matchday at a time as an article
on aia-figc.it ("SERIE A ENILIVE - DESIGNAZIONI 4a GIORNATA"), on the Tuesday
or Wednesday before the round. `data/fetch_appointments.py` gained a third
source: the news index (the designations category first, the plain index as
fallback) is searched for slugs naming a PENDING giornata, the highest article
id per round wins over a previous season's article for the same round, and
each article is stripped to text and parsed. It produces text only, exits
non-zero on nothing found and asks only for rounds the committed
`seriea_fixtures.js` shows uncovered, exactly like the other two.

`data/ingest_appointments.py` gained `--format aia` and `parse_aia`: one block
per fixture, "HOME – AWAY  Venerdì 11/09 h. 20.45", then the referee's
surname alone on the next line, then the assistants' pair, IV, VAR and AVAR.
The referee is the only unlabelled line, so a block whose first line is the
assistants' pair or a labelled official is refused by fixture rather than
mis-read. Dates carry no year: `--year` is the season's start year, defaulting
to the committed fixture file's heading, and a month before July belongs to
the following calendar year.

Names: the AIA prints no forenames, so the existing resolver (which reads a
forename first and refuses surname alone, for good reason) cannot reach a
single Italian official. `appointments.resolve_surname_only` is a separate
rule chosen by the format and by nothing else: the published surnames must be
a contiguous run inside one table entry's surnames, an initial after the
surname ("ROSSI C.") must match that entry's forename, and anything short of
a unique hit is left as published. `REF_TABLES["SA"]` is `seriea_refs.json`.
`harvest_apifootball.FIXTURE_FILES["SA"]` names `seriea_fixtures.js`, so the
feed's own referee field is the fallback the brief asked for: until the AIA
route is confirmed on a runner, what the page shows came from the feed, and
the page will say so (task 6).

What could not be done here, recorded exactly: `https://www.aia-figc.it/news/?c=9`
and the article pages answer `EGRESS_BLOCKED` from this environment, as do
every mirror tried (aiafrosinone.it, calcionews24.com, numericalcio.it,
spaziocalcio.it, r.jina.ai, web.archive.org). The index shape and the block
layout above are therefore taken from published excerpts of the articles
(the 4th-round designations of 9 September 2026: "VENEZIA – FIORENTINA,
Venerdì 11/09 h.20.45, FOURNEAU, ALASSIO – BARONE, IV: AYROLDI, VAR: DIONISI,
AVAR: MAGGIONI") and not from the page. Whether a GitHub runner can fetch the
site is a fact only the first run of the fixtures workflow (task 7) can
establish; if it cannot, the failure goes under a dated heading here and the
feed remains the source.

Guards and tests: `scripts/check-appointments.mjs` knows the Serie A desk;
`scripts/check-fetch-appointments.mjs` proves, without the network, that the
chooser takes pending rounds only and the newest id, finds a slug in an
anchor, a sitemap or a JSON island, and that an article survives its markup
as its blocks with a referee-less block refused. `data/test_appointments.py`
gained five tests (36 pass): the article parses with the year supplied, the
assistants and labelled officials are never the referee, surname-only
resolution is unique-or-nothing and reachable only through the AIA resolver,
clubs in the AIA's capitals (MILAN, ROMA, HELLAS VERONA) reach the registry's
codes against a temporary registry and card table, and the year rule. The
`fixtures.yml` loop gains SA with the other workflows in task 7.

## Serie A desk, task 4: the referee join (2026-09-09)

The free I1 records carry every card and every foul but name the official on
0 of 380 rows, so Serie A takes the La Liga route: one `/fixtures` call for
the completed season buys the NAMES, and `build_refs.py --league SA` joins
them onto the free rows by date and both canonical club names before
computing every rate off the free columns.

What changed: `harvest_apifootball.py` gained
`REF_FIXTURE_FILES["SA"] = ("SERIEA_REF_FIXTURES", "seriea_ref_fixtures.js")`,
which is the only thing `--ref-fixtures --league SA` and `build_refs.py` need
to agree on; everything else in the join reads the registry
(`referee_source`, `min_ref_matches`, `canon_name`). `cross_refs.py` now walks
four divisions, so an official appointed in Serie A with no Italian record
is looked for in the other tables, and the cross-refs guard reads the Serie A
table when it exists.

Tests (`data/test_seriea.py`, now 23): the file pair is configured and
distinct from Spain's; a feed row in API-Football spelling ("AC Milan",
"Hellas Verona", "D. Doveri, Italy") becomes a join row in canonical names
and joins a football-data row ("Milan", "Verona"); an emitted fixture list
reads back row for row through `build_refs.load_fixture_list`; and, once the
runner has committed `seriea_ref_fixtures.js`, the same test insists on 380
rows with 380 officials named, which is the brief's blocker condition
expressed as a test.

The join count itself is not in this entry. API-Football is unreachable from
the build environment, so the harvest and the join run on the runner once
task 7 has wired the workflow; the count from that log goes into this task's
commit message and the 380-of-380 condition is enforced by the test above and
by `check-seriea.mjs` in task 7. Below 380 is a stop, not a warning.

## Serie A desk, task 3: squads, cautions and the season file (2026-09-09)

`data/build_seriea_data.py` exists and produces `data/seriea_data.js` in the
shape of `laliga_data.js`: a `SUSPENSION` block from the registry, `CLUBS`,
`SERIEA_PLAYERS` and a `REFS` block that `build_refs.py --league SA` patches
in place. Rather than copy the 560-line La Liga builder and let two copies
drift, `data/build_laliga_data.py` became one builder parametrised by desk.
Everything that differs between Spain and Italy (data file, status file,
players file, feeder file and its basis label, squads and season-cards files,
the shipped constant, the header comment, the user agent) lives in its `DESKS`
table; `configure("LL")` runs at import so every existing caller and test is
unchanged, and the Serie A entry point is `configure("SA")` then `main()`.

What the configuration decides for Italy:

- Continuing clubs carry basis `SA` from `seriea_players.json`; promoted clubs
  are derived exactly as in Spain (in the registry, absent from last season's
  I1 records) and rated on Serie B form from `serieb_players.json` with basis
  `SB`. `SB` is the label shown beside a player, `SERB` is the registry code,
  and a test checks the code never leaks into the page.
- This season's cautions come from `seriea_season_cards.json` into `sc`; last
  season's total stays in `yc`. Neither file is read for the other number.
- Current rosters reconcile from `sa_squads.json`, which is what
  `harvest_apifootball.py --league SA --roster` writes.

Tests: `data/test_seriea.py` gained two (the configuration lands on the right
files and constant and switches back cleanly; a two-club emit to a temporary
path carries the Italian ladder verbatim with `then_every: 1`, labels the
promoted club `SB`, ships `sc` as null before a harvest and contains no
La Liga literal). `data/test_coverage.py` now also confirms the Serie A entry
point delegates to the shared builder.

`scripts/build_data.py` gained the Serie A and Serie B squad harvests. The
`Build seriea_data.js` step is deliberately NOT in the runner yet:
`check-build-data.mjs` requires every runner script to appear in
`data-refresh.yml`, and the workflow is task 7's. It goes in with the workflow
step, and the guard will hold the two in step from then on.

No harvest has run: API-Football is unreachable from this environment, so
`seriea_players.json`, `serieb_players.json`, `sa_squads.json`,
`seriea_season_cards.json` and `seriea_data.js` will be produced by the Data
refresh workflow on the runner once task 7 has wired it, and folded into this
commit's data. Nothing on the page has been written yet, so nothing describes
Serie A with any card rate.

## Serie A desk, task 2: club discovery and name resolution (2026-09-09)

`harvest_apifootball.py` no longer special-cases Spain. `known_names` and
`canonical_for` ask `leagues.is_discovered()` and resolve through the owner
registry, so `--league SA --clubs` discovers the division the way `LL` does
and `--league SERB` resolves against Serie A's registry the way `SEG` resolves
against La Liga's. `discover_clubs` takes its code table from the registry and
refuses anything but twenty clubs, unchanged.

`data/test_seriea.py` pins the 2025-26 twenty in both spellings. The
football-data spellings were read off the real `season-2526.csv` (Inter, Milan,
Roma, Verona are the short forms); the API-Football spellings are the
canonical names the alias table maps to, and the discovery run on the runner
is what proves them, since API-Football is unreachable from here. Every
variant of the four traps ("AC Milan", "AS Roma", "Hellas Verona",
"Internazionale", "Inter Milan", "Hellas Verona FC") reaches one name, a
Spanish spelling resolves to nothing in Italy and an Italian one to nothing in
Spain, accent folding works for names in no table ("Forlì", "Südtirol"), and
the whole Serie A code table is asserted clear of the other three desks. The
committed registry test skips until `seriea_clubs.json` lands and then checks
it is twenty clubs with distinct, non-colliding codes.

Not done here: running `--clubs` itself. API-Football cannot be reached from
this environment, so the registry is produced by the Data refresh workflow on
the branch and folded into this commit; the run's output is the check on the
API-Football spellings.

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
  gameweeks played, the first scored run needs gameweek 4 anyway. The next
  scheduled Data refresh writes the dated "no scoring run yet" report; the
  first scored report follows gameweek 4. Reading it is a person's job before
  anyone touches the model.

  *Corrected 9 September 2026: this entry and the closing one below first said
  gameweek 5. The warm-up in `scripts/backtest.mjs` is
  `max(first round + 3, the fifth round present)`, which on rounds 1 to 3 is
  round 4, and the report the refresh wrote on 9 September names round 4 as
  the first it could score.*
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
lands once gameweek 4 is complete: the walk-forward warms up to round 4 (the
rule is `max(first round + 3, the fifth round present)`) and needs 200 training
rows behind it. *Corrected 9 September 2026: this said gameweek 5.* The model is untouched by any of this.

Noted for later, not changed: `harvest_history.py --season-past` reads FPL's
`history_past`, which is one row per season rather than per match, so that
flag cannot build a walk-forward table. It is not used by the workflow.

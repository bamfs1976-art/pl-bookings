# What the sibling desks cannot do without a runtime feed

> Filed as `lineup-pricing.md` because a scheduled follow-up points at that
> path and the tool to edit it needed an approval that was not available. The
> file covers BOTH the lineup work and the live card ticker; they turned out
> to be one job. Rename it if you also fix the reference.

Two features, deferred together on the opening night of the 2026-27 season,
because they turn out to be one piece of infrastructure and two consumers of
it: pricing off the confirmed XI, and the live card ticker on the Championship
and La Liga desks.

Both were raised while the first fixtures were being played, and both were held
until after that weekend — the first because it changes published prices and
the worst moment to change published prices is during the round they apply to,
the second because it is new plumbing.

This note is what the next session needs to not start from nothing. It is not a
specification: the design questions are open and several are genuinely hard.

## THE SHARED DEPENDENCY, and the reason these are one job

`eflc.html` and `laliga.html` make **zero fetches at runtime**. Both are static
files by design — every number on them is whatever the last data refresh baked
in — and that is stated as a virtue in data-refresh.yml, not an accident.

Both features below need something those pages do not have: a source of truth
that changes during a match. The XI publishes about an hour before kick-off;
cards happen while people are watching. Neither can be baked at 04:10.

The Premier League desk already has the shape of the answer. It reads
`/api/fpl/...` through a Netlify function, and `assets/livecards.js` runs on
`/api/fpl/event/<gw>/live` — the only free feed carrying per-player cards in
play. FPL has no Championship or La Liga equivalent, so the sibling desks need
API-Football, which needs a key at request time and therefore a proxy function
of its own.

BUILD THAT ONCE. If the lineup work and the ticker each grow their own fetch
path, this repository will have done for the second time in a month what it did
with the referee-name join, which ended up with seven implementations that
disagreed with each other.

Two things to establish before writing any of it:

- **Quota.** The refresh already documents ~75 calls against a 7,500/day
  allowance. A live sweep should be one call per poll, not one per fixture
  (`/fixtures?live=all` returns every in-play match together) — CONFIRM THAT
  rather than assuming it, because per-fixture polling over a twelve-match
  Championship Saturday is a different order of cost.
- **Whether the static-file design survives.** Adding a runtime fetch to those
  two pages is a real architectural change and deserves to be a decision, not a
  side effect of a feature. Raise it with the user before doing it.

## The live card ticker on the sibling desks

`assets/livecards.js` exists, is tested, and is wired into `index.html` alone.
On the night the Championship opened, the desk still showed Cantwell at 33.3%
*to be booked* some minutes after he had been — which is the exact sentence the
ticker's own docstring calls the worst this product can produce. The feature is
live on the one division that had not started yet, and absent from the two that
had.

Read that docstring before extending it: the counting rules are considered
(totals from the feed's own club elements rather than the desk's baked squads,
because a January signing is not in the squads and the count would silently be
short) and the double-gameweek relabelling is a real caveat, not decoration.

What has to be decided for the other two leagues: whether API-Football's live
payload can attribute a card to a FIXTURE rather than a round — FPL cannot,
which is why the ticker relabels itself — and what the ticker shows when the
feed is unreachable, which for a paid API is a different failure from FPL's.

## Pricing off the confirmed XI

### The thing that already exists, and is not this

`assets/lineup.js` is a **confirmation flag**, not an XI. It records the
reader's own "I have seen the team sheet for this fixture", defaults to
unconfirmed, and travels onto the share card so a probability posted without
that caveat cannot overstate itself. It does not touch a single number.

Do not conflate the two. The flag answers "has anyone checked?"; this work
answers "who is actually playing?". Both are worth having and they are
independent — a desk could price off a real XI and still want the flag, since
knowing the XI for one fixture says nothing about the other nine.

### What the pricing does today

Every desk spreads an expected eleven across the squad by last season's
minutes:

- `eflc.html` / `laliga.html` — `sideProbs()`, via `C.minuteWeights(mins, 11)`
- `index.html` — `gwCandidates()` and `teamCardBoard()`, same primitive
- `scripts/accas.mjs` — `sideTop()`, again the same

So a player's expected minutes are a function of what he played LAST season.
On WOL v BLB that priced Mosquera at 56 expected minutes and João Gomes at 75
whether or not either started. A rested player prices exactly like a starter,
and nothing on the page distinguishes them.

The replacement is not complicated in itself: when an XI is known, a starter's
expected minutes are ~90 and a substitute's are ~20, rather than a share of
eleven derived from history.

### The two open questions are now SETTLED

Both were put to the user on 17 August and answered; the reasoning is recorded
here so the next session does not reopen them by accident.

**SUBSTITUTES — conserve the eleven.** A team plays 990 player-minutes and
`minuteWeights(mins, 11)` already spreads exactly that (measured across the 24
shipped Championship squads: 10.95 to 11.00 per club). So the XI weighting must
land on the same total, or fixtures with a lineup would run systematically
hotter or cooler than fixtures without one — an artefact of HAVING the team
sheet rather than of anything on it.

The bench collectively gets `SUBS_USED x SUB_MINUTES` = 100 minutes; the
starters get the remaining 890. Divided by the actual squad shape that is 80.9
minutes a starter and, for a bench of nine, 11.1 a substitute — and for a
Championship bench of seven, 14.3, because it is the same pool over a smaller
denominator. The bench size comes from the lineup payload; hardcoding either
league's would misprice the other.

The numbers this note originally suggested are wrong and it is worth saying
why. "90 for a starter, 20 for a sub" totals 13.0 elevens — eighteen per cent
more football than gets played, inflating every over-line on exactly the
fixtures the desk knows most about. "90 and 0" conserves the total but prices a
named substitute as unbookable. Both are pinned as wrong in
`scripts/check-lineup-pricing.mjs`.

`PLDCore.lineupMinutes` / `PLDCore.xiWeights`.

**THE ACCA — it keeps its logged price.** The XI weighting lives in `PLDCore`,
so the desk and the acca run ONE implementation; the acca simply records what
that implementation returned at logging time, with no XI, and never revises.

The note below called that "two numbers for one fixture, the drift this repo
keeps being bitten by". That framing was wrong, and the distinction matters:
DRIFT is two code paths disagreeing about one question. One code path evaluated
at two times, with different information, is not drift — it is a record and an
estimate, and they are allowed to differ as long as each says which it is. So
the acca card carries its pricing time.

The alternative — moving the logging to about an hour before kick-off — was
rejected because it would cut the recommendation's availability from roughly a
week to roughly an hour. `cmdBuild` logs as soon as a round has any unplayed
fixture, which is usually right after the previous round ends.

### The remaining open question

**Where the XI comes from.** API-Football has `/fixtures/lineups`, and
`data/harvest_apifootball.py` already calls `/fixtures` for the same ids, so
this is one more endpoint on a key already paid for. It publishes about an
hour before kick-off — which is late enough that the harvest cadence matters
more than the parsing does. The three-times-a-day `fixtures.yml` schedule will
usually miss the window; something closer to kick-off would be needed, or the
desk fetches at render time (which no desk currently does — all three are
static files by design, and breaking that is a bigger decision than this
feature).

**CONSERVING MINUTES DOES NOT CONSERVE EXPECTED CARDS**, and this is the thing
to decide next. Measured across the Championship's opening round, pricing off a
plausible XI comes out 0.13 cards COOLER than pricing off squad weights
(median; max 0.18) — every fixture, same direction.

That is not a bug and it is not a rounding error. Expected cards is a sum of
`1 - exp(-lambda)`, which is concave, so concentrating the same total minutes
into fewer players produces fewer expected bookings. The squad weighting
spreads minutes over twenty-odd men and slightly OVERSTATES the total; the XI
weighting is the more correct number.

But it does mean the desk will read about three per cent cooler on the fixtures
where a lineup is known, and that difference is visible between two fixtures on
one page. Either the page says so, or the weighting is calibrated on cards
rather than minutes. Not settled.

### The name of the harvested global, and why it is ugly

`data/lineups.js` exposes `window.LINEUP_SHEETS` from a file-level
`var __LINEUP_SHEETS`. The obvious name was `LINEUPS` and it was tried first;
it took index.html down.

index.html already has a top-level `const LINEUPS` — the wrapper around
`assets/lineup.js`, which is the READER'S confirmation flag, a different thing
with a name that sounds identical. Two top-level `const`s of one name in one
document is a parse error, not a shadow: the whole inline script fails to
compile and the desk renders blank. eflc.html and laliga.html survived it only
because their copies sit inside an IIFE and are function-scoped.

Nothing in the pricing was wrong; the page simply never ran. It is worth
remembering as a class of bug — a data file is not inert just because it only
declares data, and a page that renders blank looks like a fetch failure rather
than a naming one.

`scripts/check-lineup-pricing.mjs` reads the declaration out of the EMITTER and
sweeps every page's top-level bindings for it. Asserted against the emitter and
not against `data/lineups.js`, because that file is usually absent — a check
that read it would pass vacuously on nearly every run.

### What must not change

When no XI is known, every published number must be **byte-identical** to
today's. That is the guard to write first: same fixture, no lineup, same
expected cards to the decimal the page prints. A feature that silently
re-prices the fixtures it has no new information about is not this feature.

And the usual one for this repo: whatever resolves a lineup's player names
against the squad must be ONE implementation. Player-name joins have already
been the cause of a season-opening bug (`PLDCore.matchRefName`, and the three
copies of the referee join that disagreed with each other); the fouls-won fill
in `data/build_pl_data.py` has a two-stage key for exactly this problem.
Reuse, do not re-derive.

### Is it worth the cadence problem? Measured: yes, but not by much

The test this note set was "if it moves a fixture by less than a tenth of a
card, the cadence problem is not worth solving". Measured over the
Championship's whole opening round, substituting a most-used XI for the squad
weighting moves expected cards by a median of **0.13** and a maximum of 0.18 —
over the bar, but not far over.

TWO CAVEATS ON THAT NUMBER, both pushing the same way. It is a LOWER bound: the
XI used is the eleven with the most minutes, which is the lineup closest to the
squad weighting by construction, so a rotated side moves further. And it is a
weighting sensitivity, not a forecast — it says what the change is worth, not
what any fixture will produce.

WOL v BLB specifically: 4.88 on squad weights against 4.73 on a most-used XI,
a change of 0.15. (The 4.07 quoted below was from the desk's live path with the
appointed referee folded in; the figures here come from the guard's own
reduced path at the league-average whistle, so they are comparable with each
other and not with that number.)

### Where the numbers stood when this was deferred

WOL v BLB, 14 August, referee Farai Hallam (factor 1.049): 4.07 expected
cards, O3.5 60%, both-carded 79%. Priced off squad minute-weights.

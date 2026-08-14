# Pricing off the confirmed XI

Deferred deliberately. Raised an hour before the Championship's opening
kick-off on 14 August 2026 and held until after that weekend, because it
changes published prices and the worst moment to change published prices is
during the round they apply to.

This note is what the next session needs to not start from nothing. It is not
a specification — the design questions below are open, and two of them are
genuinely hard.

## The thing that already exists, and is not this

`assets/lineup.js` is a **confirmation flag**, not an XI. It records the
reader's own "I have seen the team sheet for this fixture", defaults to
unconfirmed, and travels onto the share card so a probability posted without
that caveat cannot overstate itself. It does not touch a single number.

Do not conflate the two. The flag answers "has anyone checked?"; this work
answers "who is actually playing?". Both are worth having and they are
independent — a desk could price off a real XI and still want the flag, since
knowing the XI for one fixture says nothing about the other nine.

## What the pricing does today

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

## The open questions

**Where the XI comes from.** API-Football has `/fixtures/lineups`, and
`data/harvest_apifootball.py` already calls `/fixtures` for the same ids, so
this is one more endpoint on a key already paid for. It publishes about an
hour before kick-off — which is late enough that the harvest cadence matters
more than the parsing does. The three-times-a-day `fixtures.yml` schedule will
usually miss the window; something closer to kick-off would be needed, or the
desk fetches at render time (which no desk currently does — all three are
static files by design, and breaking that is a bigger decision than this
feature).

**Substitutes.** A named substitute is not a non-entity: he has a real chance
of 20 minutes and a real chance of a card in them. Weighting him at zero would
underprice every fixture, and the over-lines are the markets most sensitive to
the tail. The naive fix — 90 for starters, 0 for the bench — is worse than
what ships today.

**The acca interaction, which is the awkward one.** `scripts/accas.mjs` logs
write-once, pre-kick-off, and deliberately never revises: that is what makes
the record gradeable at all. But the XI lands ~1 hour before kick-off and the
acca is logged well before that. So either the acca keeps pricing off squad
weights while the desk prices off the XI — two numbers for one fixture, which
is the drift this repo keeps being bitten by — or the acca's logging moves
later, which shortens the window the recommendation is actually available in.
Neither is obviously right. Decide this BEFORE writing code, because it
determines whether the XI weighting lives in `PLDCore` (shared by both) or
only on the pages.

## What must not change

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

## Where the numbers stood when this was deferred

WOL v BLB, 14 August, referee Farai Hallam (factor 1.049): 4.07 expected
cards, O3.5 60%, both-carded 79%. Priced off squad minute-weights. Worth
re-deriving off the actual XI once this is built, as a sanity check on how
much the change is worth — if it moves that fixture by less than a tenth of a
card, the cadence problem above is not worth solving.

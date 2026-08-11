# Bookings Desk — revised upgrade plan

**Written 11 August 2026, replacing the four-phase upgrade brief of the same date.**

The original brief was written against an earlier version of this app. Three of
its premises no longer hold, and roughly two-thirds of its Phases 1 and 2
already ship. Running it as written would rebuild working code and repaint a
deliberate design system. This is the same goals, re-cut against what is
actually here.

The audit behind it is in [`docs/audit-2026-08.md`](audit-2026-08.md).

---

## What the brief assumed, and what is true

| Brief says | Actually |
|---|---|
| Deployed via Netlify Drop | **Git-based continuous deployment.** Three pushes to `main` on 11 August each triggered a Netlify build (site `bookingsdesk`, ~10s). Nothing to switch. |
| Single-file HTML app | **Four desks** — `index.html` (PL), `eflc.html`, `laliga.html`, `today.html` — over shared `assets/*.js`. Deliberate, and guarded: `check-inline.mjs` fails if a dataset is ever inlined back into a page. |
| Two data files, `pl_data.js` + `pl_fixtures.js` | Those two **plus** `eflc_data.js`, `laliga_data.js`, their fixture files, `h2h`, `ref_history`, `model.js`, `sim_model.js`. Three divisions, not one. |
| Model is `(yellows/90 × 2) + fouls/90` | That risk score still ships **as a ranking**, but pricing runs through `assets/core.js`: empirical-Bayes shrinkage, a hazard model (`1 − exp(−λ)`), referee and venue factors, minute weights, Poisson-binomial card counts, booking points, fair odds and de-vigged market probabilities. |
| Build a football-data.co.uk pipeline | **It exists** — `build_pl_data.py`, `build_refs.py`, `build_club_splits.py`, `leagues.py`, `harvest_*.py`, driven by `data-refresh.yml` (daily) and `fixtures.yml` (three times a day), both with `workflow_dispatch`. |

**What the brief got right and is genuinely missing:** lineup confirmation, a
manual odds/edge input, a fitted team-level booking model, a written backtest
report, and some accessibility and icon work.

---

## Assumptions

Four questions went unanswered. Rather than block, the plan proceeds on these
readings — each is cheap to reverse, and none is load-bearing before Priority 3.

1. **"Single-file" means no build step and no runtime dependencies**, which the
   repo already honours. The four desks stay four desks; collapsing them would
   be a rewrite with no user-visible gain.
2. **The palette stays league-branded.** The app runs four accents (PL
   `#3d195b`, Championship `#4b2e83`, La Liga `#ea580c`, cross-league teal
   `#0891b2`) from one source, enforced by `check-palette.mjs` — a guard that
   exists *because* a copy-paste once shipped La Liga in the Championship's
   colour. Teal is already the cross-league accent. Welsh red enters as a
   deliberate accent on shared furniture, not as a repaint of three divisions.
   **Say the word and this reverses**, but it should be a decision, not a
   side effect.
3. **No new Python dependencies unless the FBref leg is approved.** Every
   existing `data/*.py` is standard-library only. `fbref.com` and
   `www.football-data.co.uk` are both unreachable from the working environment;
   `raw.githubusercontent.com` answers 200, which is why the pipeline already
   prefers the mirror. An FBref leg could only ever be tested in CI.
4. **The 450-minute floor stays a label, not a second mechanism.** The model
   already shrinks a short sample toward its position prior at six matches'
   weight and flags `ls` (low sample). Adding a hard floor on top would be two
   rules for one problem. 450 minutes becomes the threshold the *label* uses.

---

## Priorities

The Championship opens **14 August** (three days out) and the Premier League
**21–24 August** (ten days). Priority 1 is what changes a real decision before
those dates.

### Priority 1 — before the openers

**1.1 Lineup confirmation.** The standing rule is "no pick before confirmed
lineups", and the app cannot currently express it: the word "lineup" appears
nowhere in the codebase. A fixture shows the same numbers an hour before
kick-off as it does on a Tuesday, and nothing on screen says which.

- Per-fixture status: `unconfirmed` by default, with a manual confirm toggle,
  persisted per fixture in `localStorage` (wrapped, with the in-memory fallback
  the house rules require).
- Unconfirmed fixtures carry a visible marker on the card and in the share
  card, because a card that leaves the site should not imply a confirmation it
  never had.
- *Acceptance:* a guard asserts an unconfirmed fixture cannot render as
  confirmed, and that the state survives a redraw of the grid.
- *Effort:* small. *Risk:* low. *Touches:* three desks, `assets/share.js`.

**1.2 Manual odds entry and edge.** `assets/core.js` already has
`impliedProb`, `marketProbDeVig`, `fairOdds`, `edgePct`, `valuePoint` and
`TYPICAL_CARD_MARGIN`. There is no input anywhere to feed them — `id="odds"`
returns zero hits. So the desk can compute an edge and never does.

- A price field per player row in the match centre. Paste a bookmaker price,
  see de-vigged implied probability, model probability and edge, immediately.
- Prices are session-local and never leave the browser.
- *Acceptance:* a test drives the input and asserts the edge matches
  `edgePct` computed directly from the same numbers.
- *Effort:* small. *Risk:* low. *Touches:* the desks' fixture cards.

**1.3 `backtest_report.md`.** `scripts/backtest.mjs` computes walk-forward
Brier and log-loss today; nothing writes it down. Without a report there is no
way to judge whether a change helped.

- Brier, log-loss, and a ten-bin calibration table (predicted vs actual),
  against the naive baseline of raw per-90 rates.
- **If the model does not beat the baseline, the report says so and nothing
  ships on top of it.** That is the point of writing it.
- *Effort:* small. *Risk:* none — it is measurement.

### Priority 2 — modelling depth

**2.1 Team-level booking model.** The genuine Phase 2.1 gap. Match markets are
currently a Poisson-binomial over player probabilities, which has no term for
team aggression or opponent fouls drawn as *team* properties.

- Fit team yellows per match with terms for team aggression, opponent fouls
  drawn, venue and the referee multiplier.
- **Poisson vs Negative Binomial chosen by fit on 2025/26 data, and the choice
  stated with the numbers behind it** — not asserted.
- The existing player-level path stays; this is a second view, reconciled
  against it, not a replacement.
- *Validation is already wired:* `plb_match_predictions` (added 11 August)
  records every match forecast against the real card counts, so this model can
  be judged on published forecasts rather than in-sample fit.
- *Effort:* medium. *Risk:* medium — it is the item most likely to fail its own
  backtest, which is an acceptable outcome if reported.

**2.2 Opponent fouls-drawn term.** `fw` (fouls won per 90) is on every player
and feeds `expectedFouls`, but a player's card probability does not currently
respond to *the opponent's* propensity to draw fouls. That is a real signal the
data already carries.

- *Acceptance:* must improve Brier on the 2025/26 backtest or it does not ship.

### Priority 3 — pipeline hardening

**3.1 A front door, not a rewrite.** `scripts/build_data.py` as a single
orchestrator over the existing scripts, so a full regeneration is one command
with one exit code. The brief asked for this file; it should call what is
already there rather than duplicate it.

**3.2 The two validations not yet covered.** `check-data.mjs` already asserts
row counts, club count, referee count, promoted-club coverage and basis-flag
integrity. Missing from the brief's four: **no missing referee names**, and
**no player over a 100% card rate**. Both are cheap and both fail loudly.

**3.3 Cadence.** The brief asks for weekly on Tuesdays; the repo runs daily
plus three times a day for appointments, all with manual dispatch. **Recommend
keeping the current cadence** — referee appointments are published late and a
weekly job would miss them by days. No change unless you disagree.

**3.4 FBref leg — only on approval.** Unreachable from here, needs `pandas` and
`soccerdata`, and would be CI-only-testable. The existing mirror already
supplies fouls, cards and referee per match. My recommendation is to skip it
until something is actually missing that FBref alone provides.

### Priority 4 — interface and accessibility

**4.1 `aria-sort`.** Nine sortable headers, one `aria-sort`. A screen-reader
user can sort the screener and not be told what happened. Straightforward fix,
real WCAG 2.2 AA consequence.

**4.2 Icons at 16 and 32px.** `icons/` has 192, 512 and the Apple touch icon.
The brief asks for 16 and 32, legible at that size — worth doing properly
rather than downscaling the 512.

**4.3 Sparklines.** One sparkline exists on the Premier League desk; the
Championship and La Liga desks have none. Extend the existing implementation to
referee and team card-rate trends across all three, inline SVG, no library.

---

## Explicitly not doing

- **Rebuilding the football-data.co.uk pipeline.** It exists and runs.
- **Switching to Git deploys.** Already Git.
- **Repainting to a single teal/off-white/Welsh red palette.** It would strip
  three divisions of their identity and fight a guard written after that exact
  mistake. See assumption 2.
- **Collapsing four desks into one file.** See assumption 1.
- **`soccerdata` / FBref**, unless 3.4 is approved.

---

## Sequence

| When | Items |
|---|---|
| Before 14 August | 1.1 lineup confirmation, 1.2 odds and edge |
| Before 21 August | 1.3 backtest report, 4.1 `aria-sort` |
| After the openers, with real data | 2.1 team model, 2.2 fouls-drawn term |
| Any time | 3.1, 3.2, 4.2, 4.3 |

Priority 2 deliberately waits for real matches. `plb_match_predictions` and
`plb_card_predictions` start filling from 14 August, and a model refit judged
on a handful of published forecasts is worse than no refit — the first honest
calibration is several matchdays away.

## House rules carried forward unchanged

British English throughout. WCAG 2.2 AA with verified contrast. CSP meta tag,
XSS-safe rendering, `localStorage` wrapped with an in-memory fallback. No
runtime dependencies; heavy computation at build time. Archive superseded
files, never delete. Every claim in this plan that can be checked gets a guard,
because this repository's convention is that a check which passes vacuously is
worse than no check.

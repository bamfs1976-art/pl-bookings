# Live prediction accuracy and the match record

> Moved unchanged from the old README.md on 8 September 2026 ("Live prediction accuracy (the calibration loop)" and "The match record"). The README is now an orientation page; this file keeps the full prose.

## Live prediction accuracy (the calibration loop)

The desk grades its own forecasts in public — parity with Gameweek Edge's prediction log. A scheduled Netlify function (`netlify/functions/log-predictions.js`, `@hourly`) logs the upcoming gameweek's **season P(card)** for every player with a fixture to the `plb_predictions` table, then backfills who was actually booked from the FPL result feed once each gameweek finishes. It **reuses the shipped pure maths** (`assets/core.js` + `data/model.js` + `data/pl_data.js`, bundled via `netlify.toml` `included_files`), so what's graded is exactly what the app shows. A public read (`/api/model-calibration`) returns only aggregates — sample size, observed booking rate, Brier vs a base-rate baseline, log-loss, a reliability curve and the top-20-per-gameweek hit rate — which the Guide surfaces as **Live prediction accuracy**.

One-time setup: run `supabase/plb_predictions.sql` in the SQL editor (idempotent; RLS deny-all, service role only) and set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the Netlify environment (the same keys the AI cap uses). Without the service key the logger no-ops and the card stays hidden — everything else works with no env at all. Both functions talk to Supabase over PostgREST, so there's no `@supabase/supabase-js` dependency.

### The match record — what we said about a fixture, and what it produced

The loop above grades the desk on **players**. The numbers a fixture card actually leads with are **match** numbers — booking heat, over 3.5/4.5/5.5 cards, both teams carded, both sides 2+, booking points over 35.5/45.5/55.5 — and none of them was written down, so no claim about a fixture could be checked against the fixture. `plb_match_predictions` is that record: one row per fixture, the forecast written **once before kick-off** and never revised, the outcome filled in from the real card counts afterwards.

```sh
node scripts/accas.mjs matches        # print the record that would be written
node scripts/accas.mjs match-predict  # write it (write-once, pre-kick-off only)
node scripts/accas.mjs match-grade    # settle it from real card counts
```

Both steps run hourly in `.github/workflows/accas.yml` beside the player pool, and cost ~32 rows a matchday.

It is priced by the same functions in `scripts/accas.mjs` that build the accas and the player pool — one pricing path, three units of record — and with the pages' **own** constants: the derby list is parsed out of `eflc.html`/`laliga.html`/`assets/plmodel.js` rather than copied, and `scripts/check-match-record.mjs` fails CI if a page's shrinkage, card lines, points lines or derby boost stop matching what the record stores.

Each row keeps the context a refit needs to tell two different wrongnesses apart: the appointed **referee** and the multiplier he produced, whether we actually hold his card record (`ref_carded` — "no official" and "an official we know nothing about" both price at 1.0 and are different findings), whether it was a **derby**, and how many rated players stood behind each side. Outcomes are stored as raw counts (yellows, straight reds, second yellows, per side) as well as the derived totals, so the booking-points convention can be recomputed later without re-fetching a season of match records.

One-time setup: run `supabase/plb_match_predictions.sql`. It also creates `plb_match_accuracy`, the refit's working view — forecast beside outcome, errors and per-line hits already derived, so the first question ("is the heat number right on average, and where does it drift?") is one query rather than a join someone has to get right.

**There is no data yet.** The first Championship round kicks off on 14 August; nothing can be calibrated until matches have been played and graded. The model is deliberately unchanged by this work — this is the evidence a refit will need, not the refit.

# PL Bookings Desk — App Audit & Enhancement Recommendations

*Audit date: 2026-07-12. Read-only audit, benchmarked against world-class card-market
research tools: FootyStats (card stats, 120+ leagues), OddAlerts (referee stats, BTB%),
FootyMetrics (referee card averages), AccaPlanner (cards betting data), Statz.ai.*

## Verdict

The engineering fundamentals are the best of the three apps for its size: real CSP +
security headers, full ARIA tab pattern with roving focus, complete dark mode, progressive
enhancement with a visible data-basis pill, XSS discipline via `esc()`, and RLS-locked sync.
But it ships **one genuine correctness bug** (stale baked data missing most promoted-club
players), and it stops one layer short of being a betting tool: it ranks risk but never
connects it to the referee or to a price, which is where the actual edge lives.

## Critical findings

1. **Deployed data has diverged from the pipeline output.** The inline baked data in
   `index.html` has 462 players with only 6 promoted-club (EFL) rows; the generator output
   `data/pl_data.js` has 528 players with 72 EFL rows. Coventry, Ipswich and Hull are almost
   absent from the shipped app — missing exactly the defenders and holding midfielders who
   are the real booking risks. The manual "run `build_pl_data.py`, hand-copy consts into
   `index.html`" step is where this drifted.
2. **`/api/insights` is unauthenticated and uncapped.** `netlify/functions/insights.js`
   accepts up to 200 picks from `Access-Control-Allow-Origin: *` with no auth or rate limit,
   then calls the paid Anthropic API — any third party can spend the key's budget.
3. **Referees are never joined to fixtures.** The single strongest card signal (the official)
   lives in an isolated tab; booking-heat ignores it entirely. Only 12 referees are covered
   (a full PL season uses ~20+), several with null reds/pens, partly hand-sourced.
4. **No odds/value layer.** Risk never becomes an implied probability, and there's no
   compare-to-bookmaker step — the core job of a betting research tool. Odds exist only as
   manual tracker entry.
5. **No tests** for the load-bearing logic (risk formula, live name-matching, pick P/L), and
   no guard that inline data matches `data/pl_data.js` — which is how bug (1) shipped.
6. Minor: README claims the `data` folder is gitignored (only `data/*.json` is);
   `insights.js` uses a bare undated model id with no fallback; Tailwind ships via CDN
   (render-blocking, not production-recommended); no `og:image` despite generating share
   cards; players table silently truncates at 400 rows.

## Comparison vs world-class card-stats tools

| Capability | FootyStats / OddAlerts class | Bookings Desk today |
|---|---|---|
| Referee per fixture | Core feature (appointments + strictness) | Absent |
| Odds / implied probability / value flags | Core feature | Manual odds entry in tracker only |
| Matchup context (home/away, opponent fouls drawn, derby) | Standard | Single season-average risk number |
| Historical model accuracy | Published hit rates | Untracked |
| Coverage | 20+ PL refs, multi-league | 12 refs, PL only |
| Alerts | Strict-ref/matchup alerts | None (despite being an installed PWA) |
| Player card propensity | Yes | Yes — the app's strength |
| Pick tracker with ROI | Rare | Yes — a genuine differentiator |

## Top 10 recommendations (ranked by impact)

1. **Ship the full 528-player dataset** — fix the promoted-club data gap now; it's a
   correctness bug in exactly the clubs the README highlights.
2. **Eliminate the hand-copy step.** Load `data/pl_data.js` via `<script src>` or have the
   build write into `index.html` between markers, so generator and shipped data cannot drift.
3. **Protect `/api/insights`**: require the Supabase auth token, scope CORS to your origin,
   rate-limit per user/day.
4. **Referee-to-fixture assignment.** Even manual per-GW entry (persisted like picks) joins
   the strongest card signal to matches and makes booking-heat meaningful.
5. **Odds/value layer.** Convert risk to an implied "to be carded" probability and flag value
   against pasted bookmaker odds — the step that turns a stats page into a betting tool.
6. **Automate the data refresh** (scheduled function or GitHub Action re-harvest +
   regenerate), replacing the manual Python run.
7. **Track model accuracy.** Log each GW's top-risk players vs actual bookings and publish
   the hit rate — self-scoring is the credibility feature.
8. **Add tests**: risk formula, `attachLive` name matching, P/L-ROI math, and an assertion
   that inline data == `pl_data.js`.
9. **Add matchup context**: home/away splits, last-5 card form, opponent fouls-drawn,
   derby flags feeding the risk score.
10. **Use the PWA you built**: push alerts for "watchlist player one card from suspension"
    and "strict referee assigned to your player's fixture"; add `og:image`; replace the
    Tailwind CDN with a purged build; pin a dated AI model id with graceful fallback.

## Strengths worth keeping

Security posture (allowlisted proxy, server-side AI key, RLS, real CSP), the accessibility
work (skip link, ARIA tabs, live regions), the stale-cache→baked-data fallback ladder with an
honest basis pill, the share-card PNG generator, and the tracker with ROI — none of the
big-name competitors offer a personal pick tracker this clean.

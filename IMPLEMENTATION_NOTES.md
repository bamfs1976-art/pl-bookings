# Implementation notes — audit follow-up (2026-07-12)

What was implemented from `AUDIT.md`, and what was deliberately deferred.

## Implemented

1. **Data divergence fixed + hand-copy step eliminated.** The stale inline
   dataset in `index.html` (462 players, 6 EFL rows) is gone; the app loads
   the generated `data/pl_data.js` (528 players, 72 EFL rows) via
   `<script src>`. The service worker precaches it (network-first, like the
   shell), `_headers`/`netlify.toml` give it a short revalidating cache, and
   `scripts/check-data.mjs` (run in CI) fails the build if an inline
   `PL_PLAYERS` literal reappears or the counts regress (≥500 players,
   20 clubs). README's incorrect "data folder is gitignored" claim fixed —
   only `data/*.json` is ignored.

2. **`/api/insights` protected.** Requires a Supabase access token verified
   against `SUPABASE_URL/auth/v1/user`; CORS reflects the request Origin only
   when it matches the site's own Host (never `*`); per-user daily cap
   (default 10, `AI_DAILY_CAP`) via the service-role-locked `plb_ai_usage`
   table (`supabase/plb_ai_usage.sql`, RLS deny-all) when
   `SUPABASE_SERVICE_ROLE_KEY` is set — auth-required but uncapped without
   it. 501-when-unconfigured kept. Graceful fallback to a pinned secondary
   model on 404-model errors; 502 responses surface the upstream API reason.
   Client attaches the session token and tells signed-out users to sign in.

3. **Referee-to-fixture assignment.** Per-fixture Ref select on the Fixtures
   tab (REFS roster + unknown), persisted in `localStorage` under
   `pl_desk_refs_v1` keyed by season + fixture id. Assigned officials scale
   the fixture's booking heat by `ref_ypg / league_avg_ypg` clamped to
   0.75–1.3, with a surname + strictness chip. Watchlisted players whose next
   fixture has a strict (4.0+ ypg) official assigned are flagged in the strip
   above the players table.

4. **Odds/value layer.** Logistic mapping from risk score to implied
   P(card): base rate = total yellows per player-match in the shipped data,
   intercept anchored so the minutes-weighted league-average player lands on
   that base rate, slope fixed (`assets/core.js`, documented in the Guide as
   an estimate). Sortable P(card) column with fair decimal odds in the
   players table; implied probability on fixture top-risks; inline value
   check per player row (paste bookmaker decimal odds → edge % + verdict),
   with honest "model estimate, not a guarantee" framing.

5. **Accuracy self-tracking.** Per-GW snapshots in `pl_desk_acc_v1`: when a
   snapshotted gameweek finishes, the app scores how many of the model's
   top-20 risks picked up a card (delta in live yellow counts) and renders a
   "Model track record" card on the Guide tab (per-GW + cumulative hit rate,
   honest empty state until the season starts). Best-effort: GWs with
   missing data are skipped, and failures can never break the app.

6. **Matchup context.** Static `DERBIES` list (North London, Merseyside,
   North-West, Manchester, Roses, Chelsea–Spurs/Arsenal/Fulham, M23,
   Tyne–Wear, plus promoted-club rivalries Coventry–Villa and Hull–Leeds);
   derby fixtures get a ×1.15 heat boost and a 🔥 derby chip. Last-5-GW card
   form per player (▲n beside the yellow count) once ≥2 accuracy snapshots
   exist. Guide notes home/away splits and opponent fouls-drawn are deferred
   (see below).

7. **PWA/meta polish.** `og:image` + Twitter card meta pointing at a
   generated 1200×630 `og.png` (Pillow: dark background, fanned-cards mark,
   app name, strapline). Tailwind CDN replaced with a purged self-hosted
   build (`npx tailwindcss@3 --content index.html --minify` →
   `assets/tw.css`, ~5.8 KB) — the markup uses only the app's own classes,
   so the CDN was effectively just the preflight reset; CSP tightened
   accordingly in both the meta tag and `_headers`.

8. **Tests + CI.** Pure logic extracted to `assets/core.js` (PLDCore
   global + CommonJS export): risk formula, name normalisation, pick P/L +
   ROI, implied-probability functions. `tests/test-core.mjs` (20 tests, plain
   node) covers formula math, accent/hyphen normalisation edge cases,
   won/lost/void P/L, and implied-prob monotonicity + base-rate calibration
   (including against the real dataset). `.github/workflows/ci.yml` runs the
   tests, `node --check` on functions/SW/core/dataset/inline scripts, and
   the data guard. `sw.js` precaches `assets/core.js` (cache now `plb-v4`).

9. **Docs.** README updated for the external data file, protected AI review,
   ref assignment, value layer, tests/CI; this file lists the deferrals.

## Deferred (and why)

- **Automated ScoutingStats re-harvest** (audit rec 6). The harvest
  endpoints require a logged-in ScoutingStats session; credentials can't be
  baked into a public repo or CI. The pipeline is one command once the
  JSON is present (`python3 data/build_pl_data.py`), and CI guards the
  output. Revisit with a secrets-backed scheduled GitHub Action if an API
  token becomes available.
- **Web push alerts** (audit rec 10: suspension-risk and strict-ref pushes).
  Needs VAPID keys, a subscription store and a send pipeline — server
  infrastructure this static deploy doesn't have. Recommended path: reuse
  the Gameweek Edge push stack (same Supabase project and account model)
  rather than building a parallel one here. The in-app equivalents (the
  suspension-watch strip and the strict-ref watchlist flags) ship now.
- **Full 20+ referee roster.** The baked list covers 12 officials, some
  with null reds/pens; a full PL season uses 20+. Needs a proper data
  harvest of PGMOL appointments/stats (tips.gg or similar), which is a data
  task rather than a code change. The assignment UI takes any roster
  `pl_data.js` ships, so the fix is purely regenerating the data.
- **Home/away splits and opponent fouls-drawn** in the risk model. Not in
  the FPL feed or the current ScoutingStats extract; needs a richer per-match
  source. Documented as a known limit in the Guide.
- **Absolute `og:image` URL.** The canonical deploy domain isn't recorded in
  the repo, so the meta tags use a root-relative path; most crawlers want an
  absolute URL. Swap in `https://<site>/og.png` once the domain is settled.

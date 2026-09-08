# Deploy to Netlify

> Moved unchanged from the old README.md on 8 September 2026 ("Deploy to Netlify"). The README is now an orientation page; this file keeps the full prose.

## Deploy to Netlify

Connect the `pl-bookings` repo (preferred — the `/api/fpl/*` proxy needs the Netlify Function, which a drag-and-drop deploy of the root also carries in `netlify/functions/`). Publish directory is the root, no build command. Only the raw harvest JSON in `data/` is gitignored — the generated `data/pl_data.js` is committed and deployed, and `index.html` loads it directly. No environment variables are required — optionally set `ANTHROPIC_API_KEY` to switch on the AI review of tracker picks (plus `SUPABASE_SERVICE_ROLE_KEY` for the daily cap, `AI_DAILY_CAP` to change it, and `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` if not using the defaults). The same `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` also switch on the **Live prediction accuracy** calibration loop (run `supabase/plb_predictions.sql` once); the hourly logger and its schedule are declared in `netlify.toml`.

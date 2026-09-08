# Accounts, pick sync and the AI review

> Moved unchanged from the old README.md on 8 September 2026 ("Accounts and pick sync (Supabase)" and "AI review of picks (optional)"). The README is now an orientation page; this file keeps the full prose.

## Accounts and pick sync (Supabase)

Sign-in is optional and everything works signed out. The app uses the same Supabase project as Gameweek Edge (the publishable key is public-safe; RLS does the protecting). Picks live in `plb_picks`, locked to `auth.uid() = user_id` on every policy. On first sign-in, local and cloud picks merge (a settled result beats pending), then the merged set is pushed back up.

One-time setup in the Supabase project: run `supabase/plb_picks.sql` in the SQL editor, and add the deployed site URL to Authentication → URL Configuration → Redirect URLs so confirmation and reset emails return here. Until the table exists, sign-in still works and picks simply stay local.

## AI review of picks (optional)

The one feature worth keeping from a retired sibling app (see [decisions.md](decisions.md)), ported with the key handled properly. With three or more settled picks, the Tracker tab can send them to `netlify/functions/insights.js` (routed at `/api/insights`), which calls the Anthropic API **server-side** with `ANTHROPIC_API_KEY` from the Netlify environment and returns a short performance read — strongest and weakest markets, odds and staking patterns, three concrete adjustments. The key never reaches the browser, the prompts are fixed in the function, and only whitelisted pick fields are sent. Without the environment variable the function answers 501 and the app explains the feature is off; nothing else depends on it.

The endpoint is protected: it **requires a signed-in Supabase session** (the client sends the access token, the function verifies it against `SUPABASE_URL/auth/v1/user`), CORS is scoped to the site's own origin rather than `*`, and there's a per-user daily cap (default 10, override with `AI_DAILY_CAP`). The cap uses the `plb_ai_usage` table — run `supabase/plb_ai_usage.sql` once (RLS deny-all; only the service role touches it) and set `SUPABASE_SERVICE_ROLE_KEY` in the Netlify environment. Without the service key the review stays auth-required but uncapped. Optional envs: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (both default sensibly). The function falls back to a pinned secondary model if the primary id disappears, and surfaces the upstream error reason on failure.

-- Bookings Desk — per-user daily usage counter for the AI pick review.
-- Run once in the Supabase SQL editor (same project as plb_picks).
--
-- Service-role locked: RLS is enabled with NO policies, so the anon and
-- authenticated roles can neither read nor write it. Only the Netlify
-- insights function, holding SUPABASE_SERVICE_ROLE_KEY (which bypasses
-- RLS), touches this table. Without that env var the function simply
-- skips the cap and stays auth-required but uncapped.

create table if not exists public.plb_ai_usage (
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null default current_date,
  count      integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.plb_ai_usage enable row level security;
-- No policies on purpose: deny-all for anon/authenticated; service role bypasses RLS.

revoke all on public.plb_ai_usage from anon, authenticated;

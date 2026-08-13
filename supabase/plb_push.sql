-- Bookings Desk — Web Push subscriptions and the sender's own state.
-- Run once in the Supabase SQL editor (same project as plb_picks).
--
-- WHAT THIS IS FOR. One alert justifies the whole feature: a referee has been
-- appointed to a fixture involving a player on your watchlist. It is the most
-- time-critical fact the desk holds — PGMOL publish about a week out, the
-- appointment moves every booking probability in that fixture through the
-- referee factor, and nothing else on the site changes as much in one moment.
-- Before this, finding out meant opening the page on the right day.
--
-- WHY THE WATCHLIST LIVES ON THE SUBSCRIPTION ROW. The desk's watchlist is
-- local-first: it is kept in localStorage under pl_desk_v1 and works signed
-- out, which is deliberate — starring a player should not require an account.
-- That leaves the server with no way to know who watches whom, so the client
-- sends a copy of the keys alongside the subscription and re-sends it
-- whenever the list changes. The alternative was to sync watchlists to a
-- table and require sign-in for alerts, which trades the feature's whole
-- audience for a tidier schema.
--
-- It is a list of footballers, not a profile. No name, no email, no user id
-- unless the visitor happens to be signed in.
--
-- SERVICE-ROLE LOCKED. RLS on with no policies, so anon and authenticated can
-- neither read nor write. Only the push functions touch these, holding
-- SUPABASE_SERVICE_ROLE_KEY. A subscription endpoint is a capability — anyone
-- holding it can send that browser a notification — so it must never be
-- readable from the client, and the endpoint of one visitor must never be
-- listable by another.

create table if not exists public.plb_push_subs (
  endpoint    text primary key,
  p256dh      text not null,
  auth        text not null,
  -- The watchlist keys, exactly as the client stores them: "ARS|Gabriel".
  -- Empty array is legal and means "tell me about nothing", which is a
  -- subscription that will never fire rather than one that fires for
  -- everything — the safe direction for an alert nobody asked for.
  watch       jsonb  not null default '[]'::jsonb,
  -- Which alerts this browser wants. Absent key = on, so adding a new alert
  -- type later does not silently opt every existing subscriber out of it.
  prefs       jsonb  not null default '{"appointment":true}'::jsonb,
  user_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists plb_push_subs_updated on public.plb_push_subs (updated_at);

alter table public.plb_push_subs enable row level security;
revoke all on public.plb_push_subs from anon, authenticated;

-- The sender's memory. One row, key = 'appointments', value = the referee
-- assigned to each fixture as of the last run.
--
-- WITHOUT THIS THE JOB CANNOT WORK AT ALL. "A referee has been appointed" is
-- not a fact about the current fixture list — every appointed fixture looks
-- identical whether it was appointed a minute ago or a month ago. It is a
-- DIFFERENCE, and something has to remember the previous state to see it.
-- The failure mode of getting this wrong is not silence: it is notifying
-- every subscriber about every appointed fixture, every hour, forever.
create table if not exists public.plb_push_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.plb_push_state enable row level security;
revoke all on public.plb_push_state from anon, authenticated;

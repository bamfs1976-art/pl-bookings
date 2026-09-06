-- Bookings Desk — channel attribution.
--
-- Run once in the Supabase SQL editor (same project as Gameweek Edge:
-- knodunjnsxelmpziupwk). Re-runnable: every statement is guarded.
--
-- THE QUESTION THIS EXISTS TO ANSWER is not "which channel brings clicks".
-- That one is easy and nearly useless — a link posted somewhere busy brings
-- clicks whether or not anybody stays. The question is which channel brings
-- people who sign in, and then which brings people who go on to log a pick,
-- because those are the two things a reader does when the desk has actually
-- been useful to them.
--
-- FIRST TOUCH, NOT LAST. Somebody finds the desk through a Reddit thread,
-- comes back a fortnight later through a search, and signs up. Last-touch
-- attribution credits SEO for a reader Reddit brought, and it does it
-- systematically: a returning visitor is more likely to arrive by search
-- whatever brought them first. The browser stores `?src=` once and never
-- overwrites it (assets/core.js, PLDCore.attribution), so every row here
-- already carries first touch. The reduction below does not have to guess.
--
-- WHAT IS AND IS NOT STORED. `src` is one of eight fixed words, validated in
-- the browser against a closed list before it is ever sent, so an arbitrary
-- string on a public URL cannot reach this table. It records which link was
-- followed, not who followed it. A reader who arrived on an untagged link is
-- null, which is honest, and is the majority.

-- ---------------------------------------------------------------------------
-- 1. sign-in events
-- ---------------------------------------------------------------------------
-- ONE ROW PER SIGN-IN, not a counter on the user. A counter cannot be grouped
-- by week, and the whole point of this is the shape over time.
create table if not exists public.plb_signins (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The closed list, enforced here as well as in the browser. A CHECK is the
  -- only one of the two that a caller cannot skip.
  src     text check (src is null or src in
            ('x', 'reddit', 'telegram', 'threads', 'bluesky', 'email', 'creator', 'seo')),
  at      timestamptz not null default now()
);

create index if not exists plb_signins_at_idx on public.plb_signins (at);
create index if not exists plb_signins_user_idx on public.plb_signins (user_id);

alter table public.plb_signins enable row level security;

drop policy if exists "plb_signins_insert_own" on public.plb_signins;
drop policy if exists "plb_signins_select_own" on public.plb_signins;

-- Insert and read your own, and nothing else. There is deliberately no update
-- or delete policy: an event log that can be edited is not an event log.
create policy "plb_signins_insert_own" on public.plb_signins
  for insert with check (auth.uid() = user_id);
create policy "plb_signins_select_own" on public.plb_signins
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. the source on a pick
-- ---------------------------------------------------------------------------
-- Stored on the pick itself rather than joined from the user, so a row stays
-- readable on its own and so the FIRST pick carries the channel that was in
-- force when it was made. Safe to run on an existing table.
alter table public.plb_picks
  add column if not exists src text;

do $$
begin
  alter table public.plb_picks
    add constraint plb_picks_src_check check (src is null or src in
      ('x', 'reddit', 'telegram', 'threads', 'bluesky', 'email', 'creator', 'seo'));
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. the view
-- ---------------------------------------------------------------------------
-- Sign-ins and FIRST picks, by source, by week.
--
-- "First picks" and not "picks" on purpose. Total picks measures how much a
-- handful of heavy users log; the first one measures how many people crossed
-- from reading the desk to using it, which is the thing a channel can be
-- credited with. One row per user, at the moment they crossed.
--
-- A FULL OUTER JOIN, so a week that produced sign-ins and no picks still
-- appears — and it is the more interesting of the two rows. An inner join
-- would silently drop exactly the channels worth cutting.
--
-- security_invoker = on: the view runs with the CALLER's permissions, so the
-- row-level security above still applies through it. Without that a view over
-- an RLS-protected table runs as its owner and hands every user everybody
-- else's rows — the standard way this goes wrong. In practice this means a
-- signed-in reader sees only their own row, and the aggregate is read with
-- the service-role key, from the server, by the owner. That is the correct
-- shape for an analytics view: it is not a public leaderboard.
create or replace view public.plb_channel_weekly
with (security_invoker = on) as
with signins as (
  select
    date_trunc('week', at)   as week,
    coalesce(src, 'unknown') as src,
    count(*)                 as signins,
    count(distinct user_id)  as signin_users
  from public.plb_signins
  group by 1, 2
),
-- Each user's earliest pick, and the source that pick carried.
first_pick as (
  select distinct on (user_id)
    user_id,
    created_at,
    src
  from public.plb_picks
  order by user_id, created_at asc
),
picks as (
  select
    date_trunc('week', created_at) as week,
    coalesce(src, 'unknown')       as src,
    count(*)                       as first_picks
  from first_pick
  group by 1, 2
)
select
  coalesce(s.week, p.week)               as week,
  coalesce(s.src, p.src)                 as src,
  coalesce(s.signins, 0)                 as signins,
  coalesce(s.signin_users, 0)            as signin_users,
  coalesce(p.first_picks, 0)             as first_picks,
  -- The number the whole file is for. Null rather than zero when nobody
  -- signed in that week from that channel: a rate with no denominator is not
  -- 0%, it is unknown, and printing 0% would make a channel nobody tried look
  -- like one that failed.
  case when coalesce(s.signin_users, 0) > 0
       then round(coalesce(p.first_picks, 0)::numeric
                  / s.signin_users, 3)
       end                               as first_pick_rate
from signins s
full outer join picks p
  on p.week = s.week and p.src = s.src
order by week desc, first_picks desc, signins desc;

comment on view public.plb_channel_weekly is
  'Sign-ins and first picks by first-touch channel by week. Read with the '
  'service-role key: security_invoker means a signed-in user sees only their '
  'own rows through it.';

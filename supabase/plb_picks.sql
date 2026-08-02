-- Bookings Desk — cloud sync for the pick tracker.
-- Run once in the Supabase SQL editor (same project as Gameweek Edge:
-- knodunjnsxelmpziupwk). Follows the gwedge_* pattern: row-level security
-- with auth.uid() = user_id on every policy, so each user can only
-- read/write their own picks.

create table if not exists public.plb_picks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null,
  fixture    text not null default '',
  selection  text not null default '',
  market     text not null default '',
  odds       numeric,
  stake      numeric,
  status     text not null default 'pending'
             check (status in ('pending', 'won', 'lost', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Stale-client guard (added 2026-08-01). `schema_v` records the app version
-- that last wrote each row. A client running an older schema than the data it
-- reads goes read-only instead of pushing its stale copy over newer picks —
-- the failure that cost F1 Grid Masters a state wipe on 2026-07-16.
-- Safe to run on an existing table.
alter table public.plb_picks
  add column if not exists schema_v integer not null default 1;

alter table public.plb_picks enable row level security;

-- Policies are dropped first so the whole file stays re-runnable.
drop policy if exists "plb_picks_select_own" on public.plb_picks;
drop policy if exists "plb_picks_insert_own" on public.plb_picks;
drop policy if exists "plb_picks_update_own" on public.plb_picks;
drop policy if exists "plb_picks_delete_own" on public.plb_picks;

create policy "plb_picks_select_own" on public.plb_picks
  for select using (auth.uid() = user_id);
create policy "plb_picks_insert_own" on public.plb_picks
  for insert with check (auth.uid() = user_id);
create policy "plb_picks_update_own" on public.plb_picks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plb_picks_delete_own" on public.plb_picks
  for delete using (auth.uid() = user_id);

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

alter table public.plb_picks enable row level security;

create policy "plb_picks_select_own" on public.plb_picks
  for select using (auth.uid() = user_id);
create policy "plb_picks_insert_own" on public.plb_picks
  for insert with check (auth.uid() = user_id);
create policy "plb_picks_update_own" on public.plb_picks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plb_picks_delete_own" on public.plb_picks
  for delete using (auth.uid() = user_id);

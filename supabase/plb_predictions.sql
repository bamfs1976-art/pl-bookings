-- Bookings Desk — model prediction log (the calibration loop; parity with
-- Gameweek Edge's gwedge_predictions / P5).
--
-- One row per (season, gw, element): the season-model P(card) the desk
-- forecast for that player before the deadline, backfilled with whether he
-- was actually booked once the gameweek finishes. This lets a public read
-- (netlify/functions/model-calibration.js) grade the model in the open —
-- server-verified, not just the per-browser self-score.
--
-- This is MODEL analytics (keyed by gameweek + player, no user data), so
-- like plb_ai_usage it is written and read ONLY by the server — the
-- scheduled netlify/functions/log-predictions.js using the service-role key.
-- RLS is enabled with NO policies, so the publishable (anon) key and
-- authenticated users can neither read nor write; the service role bypasses
-- RLS. The read function re-exposes only aggregates.
--
-- The `season` column is essential: FPL renumbers gameweeks from 1 every
-- August, so without it a new season's GW1 predictions would collide with
-- (and overwrite the graded actuals of) last season's GW1 rows.
--
-- Run in the Supabase SQL editor (idempotent — safe to re-run).

create table if not exists public.plb_predictions (
  season     text    not null default '2026-27',
  gw         integer not null,
  element    integer not null,          -- FPL element id
  name       text,                      -- readable player name (debugging)
  club       text,                      -- baked club short code
  pcard      real    not null,          -- forecast P(>=1 card) — season model
  carded     integer,                   -- 1/0, filled when the gameweek finishes
  created_at timestamptz not null default now(),
  primary key (season, gw, element)
);

create index if not exists plb_predictions_gw on public.plb_predictions (gw);
create index if not exists plb_predictions_season on public.plb_predictions (season);

alter table public.plb_predictions enable row level security;

-- No policies on purpose: only the service role (which bypasses RLS) may
-- touch this table. Revoke the default grants for belt and braces.
revoke all on table public.plb_predictions from anon, authenticated;

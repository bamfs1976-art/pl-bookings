-- Bookings Desk — the match-level record: what the desk said, what happened.
--
-- WHAT WAS ALREADY RECORDED, AND WHAT WAS NOT. plb_card_predictions logs every
-- PLAYER the desk rated for the coming round and grades each one against the
-- real team sheets, so p(booked) for a player is measurable. The numbers a
-- fixture card actually leads with are not player numbers:
--
--     booking heat (expected cards), home and away expected, over 3.5 / 4.5 /
--     5.5 cards, both teams carded, both sides 2+, and booking points over
--     35.5 / 45.5 / 55.5
--
-- Every one of those is a MATCH forecast, none of them was written down, and
-- so none of them could be checked against a real match. This table is that
-- record. Without it "the desk was right about this fixture" is unfalsifiable,
-- and the match-level model cannot be refit from anything but intuition.
--
-- WRITE-ONCE ON THE FORECAST, filled in on the outcome. The forecast columns
-- are inserted before kick-off and never revised — an hourly job that updated
-- its own prediction as team news landed would grade the model on its last
-- guess rather than its published one. The outcome columns are null until the
-- match finishes and are written exactly once.
--
-- WHY THE CONTEXT COLUMNS EARN THEIR PLACE. referee, ref_factor and derby are
-- the multipliers the desk applies; rated_home/rated_away are the squad sample
-- behind the price. A settled row without them can say the forecast was wrong
-- but not WHY, and "wrong under the league's strictest official" and "wrong
-- with no official appointed" are different findings that a refit has to be
-- able to separate.
--
-- Model analytics, not user data: written and read with the service-role key,
-- like plb_card_predictions. RLS on, no policies.
--
-- Run in the Supabase SQL editor (idempotent — safe to re-run).

create table if not exists public.plb_match_predictions (
  season           text    not null,
  league           text    not null,          -- PL | EFLC | LL
  fixture_id       bigint  not null,          -- API-Football fixture id
  matchday         integer,
  kickoff          timestamptz,
  home             text    not null,          -- short codes, as the desk uses
  away             text    not null,

  -- ── the forecast, as published ──────────────────────────────────────
  exp_cards        real,                       -- booking heat: both sides added
  exp_cards_home   real,
  exp_cards_away   real,
  p_over_3_5       real,
  p_over_4_5       real,
  p_over_5_5       real,
  p_both_carded    real,
  p_both_two       real,                       -- both sides on 2+
  exp_points       real,                       -- booking points, 10 a yellow / 25 a red
  p_points_over_35_5 real,
  p_points_over_45_5 real,
  p_points_over_55_5 real,

  -- ── what it was priced with ─────────────────────────────────────────
  referee          text,                       -- null = none appointed
  ref_factor       real,                       -- 1.0 = neutral (none, or no card record)
  ref_carded       boolean,                    -- appointed AND we hold his rate
  derby            boolean,
  rated_home       integer,                    -- squad members with a usable rate
  rated_away       integer,
  model_version    text    not null,
  predicted_at     timestamptz not null default now(),

  -- ── what actually happened ──────────────────────────────────────────
  -- RAW COUNTS, not just the derived total. The desk's own convention is 10 a
  -- yellow and 25 a red (PLDCore.bookingPointsDist), but a second yellow is
  -- scored differently by different books, and second_yellows is kept separate
  -- so the total can be recomputed under another rule without re-fetching a
  -- season of match records.
  yellows_home     integer,
  yellows_away     integer,
  reds_home        integer,                    -- straight reds
  reds_away        integer,
  second_yellows_home integer,
  second_yellows_away integer,
  cards_total      integer,                    -- yellows + reds, the "cards" the over lines price
  points_total     integer,                    -- 10 * yellows + 25 * reds, the desk's convention
  settled_at       timestamptz,

  primary key (season, league, fixture_id)
);

-- The reads this table exists for: "everything settled for this league", and
-- "everything still open", both usually filtered by model version.
create index if not exists plb_match_predictions_settled
  on public.plb_match_predictions (league, settled_at);
create index if not exists plb_match_predictions_open
  on public.plb_match_predictions (kickoff) where settled_at is null;
create index if not exists plb_match_predictions_model
  on public.plb_match_predictions (model_version);

alter table public.plb_match_predictions enable row level security;
revoke all on table public.plb_match_predictions from anon, authenticated;

-- The refit's working view: forecast beside outcome, settled rows only.
-- Every column a calibration needs is here, so the first question of a refit
-- ("is the heat number right on average, and where does it drift?") is one
-- query rather than a join someone has to get right.
create or replace view public.plb_match_accuracy as
  select season, league, matchday, fixture_id, kickoff, home, away,
         model_version, referee, ref_factor, ref_carded, derby,
         exp_cards, cards_total,
         cards_total - exp_cards                      as cards_error,
         exp_points, points_total,
         points_total - exp_points                    as points_error,
         p_over_3_5, (cards_total > 3.5)              as hit_over_3_5,
         p_over_4_5, (cards_total > 4.5)              as hit_over_4_5,
         p_over_5_5, (cards_total > 5.5)              as hit_over_5_5,
         p_both_carded,
         (yellows_home + reds_home > 0
          and yellows_away + reds_away > 0)           as hit_both_carded,
         p_both_two,
         (yellows_home + reds_home >= 2
          and yellows_away + reds_away >= 2)          as hit_both_two,
         p_points_over_35_5, (points_total > 35.5)    as hit_points_over_35_5,
         p_points_over_45_5, (points_total > 45.5)    as hit_points_over_45_5,
         p_points_over_55_5, (points_total > 55.5)    as hit_points_over_55_5
    from public.plb_match_predictions
   where settled_at is not null;

revoke all on table public.plb_match_accuracy from anon, authenticated;

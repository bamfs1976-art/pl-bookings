# Referees

The referee is the largest single multiplier the desks apply to a booking
probability, and applying it to nothing looks exactly like applying it. This
page is the index to where the referee path is built, described and guarded.
The prose itself lives in the pages linked from here and is unchanged from the
old README.

## The path, end to end

1. **Card rates** are counted from the free football-data.co.uk match records
   for every official with three or more matches in the division:
   `data/build_refs.py`, described under [data-pipeline.md](data-pipeline.md).
   La Liga has to buy the official's *name* from API-Football and join it onto
   the free rows; see [leagues.md](leagues.md).
2. **Career history** back to 1992/93 comes from the MIT-licensed epldata
   package (`data/build_ref_history.py`) and is extended forward every refresh
   by `data/extend_ref_history.py`. Both are in [data-pipeline.md](data-pipeline.md).
3. **Appointments** reach the fixture list two ways: harvested from
   API-Football where it carries them, and ingested from the published
   appointment articles by `data/ingest_appointments.py` and
   `data/fetch_appointments.py`. The name resolution rules, and why surname
   alone is never enough, are in [data-pipeline.md](data-pipeline.md).
4. **Borrowing across divisions**: an official with a record in one league and
   none in another is priced from the record next door, scaled by the two
   leagues' averages, by `data/cross_refs.py`.
5. **Pricing**: `PLDCore.refCardFactor` blends yellows per game with cards per
   foul, and the fixture card shows the factor inline. The referee selector on
   each desk lets a reader assign an official before the appointment is
   published. See [model.md](model.md) and [views.md](views.md).

## Research behind it

- [referee-sourcing.md](referee-sourcing.md): where referee statistics and
  allocations can be sourced so the app updates itself.
- [la-liga-feasibility.md](la-liga-feasibility.md): why the Spanish desk has to
  buy the name and nothing else.

## Guards

Every failure on this path is silent on the page: a fixture reads "appointed"
and prices at a neutral referee. These fail CI instead:

- `scripts/check-referees.mjs`: the appointment joins across two id spaces, a
  hand pick still wins, and the dropdown shows what the model prices with.
- `scripts/check-appointments.mjs`: the published-appointments overlay is
  still applied and still resolves to an official with a card record.
- `scripts/check-fetch-appointments.mjs`: the fetcher asks for the rounds the
  desk is missing and the fixtures workflow runs it before it commits.
- `scripts/check-cross-refs.mjs` and `data/test_cross_refs.py`: a borrowed
  record is scaled, not copied, and never counted into the average it is
  measured against.
- `data/test_appointments.py` and `data/test_names.py`: name resolution, and
  the line that must not be crossed (matching on surname alone).

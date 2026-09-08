# A Champions League bookings desk: what it would cost to build

Research note. The question was whether the Bookings Desk can be pointed at the
UEFA Champions League.

**Short answer: yes, and it is a smaller job than La Liga was — but for the
opposite reason to the one you would expect.** La Liga was cheap on squads and
hit a wall on referees. The Champions League is the other way round: the
referee problem has a route through it that La Liga's did not, and the real
work is that the desk currently knows the players of two of the competition's
countries and needs the rest.

The one thing that does **not** transfer is the assumption every existing desk
rests on: that a division is a fixed list of clubs playing each other. It is
not, here, and §5 is about what that costs.

Numbers below are measured from this repository unless marked *unverified*.

---

> ## Update: step 1 has been run, and the answer is yes
>
> `scripts/probe-ucl.py`, 8 calls, 2026-09-08. Every *unverified* claim in §4
> and §6.1 is now measured:
>
> | Question | Answer |
> |---|---|
> | Does the plan serve competition id 2? | **Yes** — 232 fixtures, 81 clubs |
> | Referee on a **finished** match | **90 of 90 (100%)** |
> | Referee on an **upcoming** match | 10 of 142 (7%) |
> | Fouls per match | **Present** — 17, 9, 12 on the three sampled |
> | Yellow cards | **Present**, and 3–6 card *events* per match as well |
> | Squad for a club no desk holds | **Yes** — FC Porto, 20 on page 1 of 2 |
>
> **The referee wall does not exist here.** Fouls and cards both arrive, so
> `cards per foul` — the pillar La Liga lost — is computable for Europe. That
> was the single biggest risk in this note and it has cleared.
>
> Three cautions on the numbers above:
>
> 1. **The first run of the probe reported fouls and cards ABSENT, and it was
>    wrong.** It sampled the chronologically first finished fixture, and
>    competition id 2 includes the qualifying rounds — so it asked about a July
>    tie between Atert Bissen and Ararat-Armenia. The probe now takes the three
>    *latest* finished fixtures and prints the round it asked about. Any future
>    reading off this feed should do the same.
> 2. **7% of upcoming fixtures carrying a referee is not yet evidence of
>    "record, not appointment".** The league phase had not begun on the probe
>    date; the ten that do carry one are plausibly the imminent matches, which
>    is the same short-lead behaviour the Spanish CTA has. Settling it needs a
>    run during the league phase, checking whether those ten are the next few
>    days' fixtures. Until then, assume appointments arrive late rather than
>    never — and note the desk already has the overlay machinery for exactly
>    that case.
> 3. **"red cards ABSENT" is unexplained** and probably means no red was shown
>    in those three matches rather than that the field does not exist. Not
>    worth chasing until a backfill runs over a season.
>
> The remaining unknown is not data. It is §5.

## 1. What the desk could price today: nothing

Three cards were the prompt for this note. Here is what the desk can do with
them right now:

| Fixture | Home | Away | Priceable |
|---|---|---|---|
| Arsenal v Chelsea (PL) | ✓ `pl_data.js` | ✓ `pl_data.js` | **yes** |
| Porto v Man City (UCL) | ✗ no squad | ✓ `pl_data.js` | no |
| Real Madrid v Inter (UCL) | ✓ `laliga_data.js` | ✗ no squad | no |

Each European tie has exactly one side the desk holds players for, and one it
does not. That is not a near miss — `teamCardBoard()` in `index.html` refuses
this case deliberately:

> BOTH SIDES OR NEITHER — the match total is the sum of the two halves, and
> pricing one off its real XI and the other off last season's minutes would
> make them answer different questions.

The rule is right and should not be weakened for Europe. It also means there is
no "partial" first version: **until both squads are held, a fixture is not a
fixture.** And because UEFA does not pair clubs from the same country in the
league phase, the number of ties the desk could price today is not small — it
is zero.

## 2. What the desk holds

`data/leagues.py` registers five leagues, three of which have desks:

| Code | League | API-Football id | football-data div | Desk |
|---|---|---|---|---|
| PL | Premier League | 39 | E0 | `/pl` |
| EFLC | EFL Championship | 40 | E1 | `/eflc` |
| LL | La Liga | 140 | SP1 | `/laliga` |
| L1 | EFL League One | 41 | E2 | promoted clubs only |
| SEG | Segunda División | 141 | SP2 | promoted clubs only |

So: England and Spain. A Champions League league phase is 36 clubs drawn from
across UEFA — England and Spain supply perhaps nine or ten of them
(*unverified*: the 2026-27 participant list has not been read from any feed
here). The other twenty-six are clubs whose card and foul rates the desk has
never seen.

## 3. The insight that makes this affordable: clubs, not leagues

The obvious plan is "add Serie A, the Bundesliga, Ligue 1, the Primeira Liga
and the Eredivisie". Priced from `data/api_budget.py`, that is the expensive
plan:

- Season form in `data-refresh.yml` costs **360 calls a day for 64 clubs**
  across the three desks — `/players` is per club and paged, so ~5.6 calls per
  club per day.
- Five more whole divisions is ~92 more clubs: **≈520 calls a day**, before the
  standings, team-stats, odds and injury feeds that scale per league too.

But the desk does not need those leagues. It needs **the clubs in this
competition** — twenty-six of them, not ninety-two:

- ~26 clubs × 5.6 ≈ **150 calls a day**, roughly a seventh of the league-wide
  plan.
- The harvest is already club-keyed (`/players is per club and paged`), so this
  is a narrower call list rather than a new mechanism.

Current usage is **1,298 calls on a typical day and 1,682 at peak** against a
7,500 allowance, with a 3,842 worst case if the live feed stops inlining
events. A club-scoped European harvest lands inside that; the league-wide one
puts the worst case near 6,000 and would need `check-api-budget.mjs` re-run
before anyone believed it.

**This is the single biggest decision in the note.** Club-scoped is cheaper,
but it means the European squads are a set that changes every August with the
draw, rather than a division — see §5.

## 4. The referee question, which is NOT La Liga's

`docs/la-liga-feasibility.md` §3 measured the referee wall and it is worth
restating, because the conclusion here is different:

| League | Seasons with any referee value (of 33) |
|---|---|
| Premier League | all |
| La Liga | 0 |
| Ligue 1 | 0 |
| Serie A | 2 |
| Bundesliga | 2 |

Free referee data is a British anomaly. For La Liga that was terminal for the
free path and the referee layer had to be bought.

For the Champions League the shape is different in two ways, one helpful and
one not:

**Helpful.** The desk already buys per-fixture statistics from API-Football and
already walks them incrementally — `extra-feeds.yml` spends 2 calls per
finished match on `/events` and `/fixtures/statistics`, "once ever per match",
and `--only-new` means a recorded fixture is never fetched twice. A European
season is ~189 league-phase matches plus knockouts, call it ~200. Backfilling
five seasons is ~1,000 matches ≈ **2,000 one-off calls** — a single day's spare
capacity — and yields exactly the columns `build_refs.py` needs: cards, fouls
and the official's name. **Measured 2026-09-08 and confirmed** — see the update at the top:
fixtures, referees and per-match fouls and cards all arrive.

**Not helpful.** A referee's card rate is competition-specific. Michael Oliver
appears on one of the three cards; the desk holds his Premier League rate, and
that is not his Champions League rate — different instructions, different
tempo, and `cards per foul` is precisely the quantity that moves. So the
existing English referee records cannot be reused here even where the names
overlap. The `cross_refs` machinery already in the repo — which scales a
borrowed record by the two leagues' own averages, and marks it as borrowed on
the fixture line — is the right precedent, and `check-cross-refs.mjs` already
guards that a borrowed record is never counted into the average it is measured
against.

A European baseline (`avgYpg`, `avgCpf`, `LEAGUE_RED`) falls out of the same
backfill.

## 5. What genuinely does not transfer

Every desk in this repo assumes a **division**: a fixed club list playing a
fixed number of matches, with a table, a suspension ladder and a season-long
card record. The Champions League is none of those:

- **The club list changes every year** and is not knowable until the draw. The
  La Liga note already reached the matching conclusion for its own league —
  *"the club list could not be confirmed for 2026-27, so it is not declared at
  all"* — and read the twenty off the feed instead. Here that is not a
  convenience, it is the only option.
- **Eight matches, not thirty-eight.** Sample sizes per club in this
  competition are tiny. Player rates must come from the club's **domestic**
  season — which is what BVS themselves do: both European cards in the prompt
  say *"ALL DATA FROM 2026-27 DOMESTIC SEASON"*. That is the honest approach
  and the desk should copy it, and say so on the card.
- **The suspension ladder is different.** UEFA runs its own accumulation rules,
  not the 5/10/15 the English and Spanish desks encode. `suspension_scheme` in
  the registry would need a European entry, and `docs/suspension-rules.md`
  demands evidence before a rung is encoded. Until that evidence exists the
  ladder should be **absent**, not guessed.
- **Two-legged ties** in the knockout rounds are a fixture shape nothing in the
  repo models.

## 6. What to do, in order

1. **Measure whether API-Football serves the competition** on this plan:
   fixtures, referee names, and per-fixture statistics for league id 2. One
   read-only probe, the shape of `scripts/probe-football-data.mjs`. If the
   answer is no, everything below is moot and the note ends here.
2. **Read the participant list off the feed** and diff it against the clubs the
   desk already holds. That produces the exact call cost rather than the ~26
   estimate above.
3. **Backfill European match records** for referee rates and the competition
   baseline. Bounded, one-off, incremental.
4. **Harvest the missing clubs' domestic squads.** Club-scoped, ~150 calls/day.
5. **Only then** a desk — and it should be honest on its face about what it is:
   domestic-season player rates, a European referee record, no suspension
   ladder until the rules are evidenced.

## 7. The recommendation

Steps 1 and 2 are cheap, read-only and answer the two questions that decide
whether any of this is worth doing. They should happen before a line of desk
code is written — which is exactly what the La Liga note did, and why that
build went in with its surprises already known.

The honest risk is §5. This would be the first thing in the repo that is not a
division, and several guards, the suspension ladder and the season-record views
all assume one. That is not a reason not to build it; it is the reason to
expect it to cost more than the La Liga port did, even though the data is
cheaper.

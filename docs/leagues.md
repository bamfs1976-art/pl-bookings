# More than one competition

> Moved unchanged from the old README.md on 8 September 2026 ("More than one competition" and "La Liga"; "The models are converged" went to model.md). The README is now an orientation page; this file keeps the full prose.

## More than one competition

The desk has been generalised from one league to three: the Premier League, the EFL Championship and La Liga. `docs/la-liga-feasibility.md` is the research behind that order; the short version is that every referee number here comes from a free source that publishes the official for English and Scottish football and effectively nowhere else — measured, 0 of 33 seasons for La Liga, all of them for England's five tiers. So the Championship reuses the referee spine with a changed division code, while La Liga has to buy the referee *name* from a keyed API and keep computing the *rates* from the same free file.

**The Championship dataset is built**: 24 clubs, 974 players (753 on Championship form, 111 on Premier League form, 110 on League One form), 30 referees, and exact card rates with home/away splits for the 18 clubs that were in the division last season. `data/eflc_status.txt` records the outcome of every build, committed, so a failure inside a `continue-on-error` step leaves a trace in the repository rather than only in a log pane.

**The Championship desk is live at `/eflc`** (`eflc.html`), a second single-file app beside the Premier League one. It shares `assets/core.js` and `assets/tw.css` and reads `data/eflc_data.js`; the two pages never share state, storage keys or club maps.

- **Players** every squad player by booking probability, with club/position/search filters, a 450-minute floor and a watchlist. Assign an official from the **referee selector** and every probability rescales to his card rate.
- **Fixtures** the season's matchdays as cards ordered hottest first, each with its **booking heat** (expected cards), the four likeliest bookings a side, and a card-markets row — expected cards home and away, over 3.5/4.5/5.5 and both teams carded. Referees come from the feed where the appointment is published and are marked `appointed`; where one is not yet named, choose an official and the whole card re-prices. Built by `harvest_apifootball.py --fixtures --league EFLC` into `data/eflc_fixtures.js`, which is committed and loaded with a script tag — no key in the client.
- **Clubs** cards per game with the home and away split measured from the free match records, a discipline tier, and each club's highest risk.
- **Referees** all 30 officials by yellows per game, fouls per game and cards per foul, with the ×factor each carries against the league average.
- **Guide** the method and — at length — the limits.

**The prices come from a hazard model, not the risk score.** `P(booked) = 1 - exp(-y90 x minutes/90 x referee factor)`, over a yellow rate shrunk toward a positional prior. The risk score is deliberately foul-heavy, which makes it a good *ranking* and a poor *price*: Boženík fouls 3.94 times a 90 and was booked twice in 892 minutes, and putting his risk score through a logistic priced him at 63% when his own record says nearer 17%. Both numbers are on the page, because a gap between them is itself the information — it means small sample. `scripts/check-eflc.mjs` re-derives the prices in CI and fails if the top of the book leaves the 25-60% range a real bookings market occupies. It also re-prices every fixture neutrally and checks the average lands near the card rate the division actually produced — on 2025-26 form that is 3.51 modelled against 3.71 real, and a drift there shows nothing on screen because the cards still render, the numbers are just wrong.

What exists so far is the data layer, not a second site. The Premier League path is unchanged throughout — byte-identical output from both `build_refs.py` and `build_pl_data.py`, held there by `data/test_leagues.py`.

- `data/leagues.py` — the league registry: the 2026-27 Championship's 24 declared clubs and their feed-name aliases, La Liga's spelling tables and short-code overrides, and the discovered-registry machinery Spain uses instead of a declared roster.
- `build_refs.py --league EFLC` — the referee spine, free and keyless, from the same public-domain records the Premier League uses. Writes `data/eflc_refs.json`.
- `build_eflc_data.py` — the Championship dataset. It **reuses** the Premier League builder's arithmetic (`mk`, `coverage_problems`, `quote_keys`) rather than copying it, so the two desks cannot drift about what a booking risk is.

The Championship is the mirror image of the Premier League desk: 18 clubs on 2025-26 Championship form, 3 on Premier League form (Burnley, West Ham, Wolves — relegated, so last season's record is from a higher division, and flagged as such), and 3 on League One form or none (Lincoln, Cardiff, Bolton — promoted).

Two things fall out of that which are better here than in the Premier League desk. **21 of the 24 squads need no new harvesting**: `harvest.py` already fetches the whole of ScoutingStats league 8 and league 9, and the Premier League build keeps only a slice of each — the Championship desk wants the rest. And **club card rates are counted from the free match records rather than the player feed**, which the Premier League desk cannot do for its promoted clubs because Championship minutes in that feed include cup games. Counting E1 matches directly gives an exact league-only rate with the home/away split built in, instead of patched on afterwards by a second script.

**Squads come from API-Football, not ScoutingStats.** The cookie route was retired from this pipeline after producing six distinct ways of returning a partial league that looked complete: page one read as a whole league, a `per_page` cap below what was requested, tied rows drifting under an unstable sort, a sort field silently ignored rather than rejected, deterministic loss at page seams, and finally throttling. Not one of them errored, and every one produced a plausible dataset. `harvest_apifootball.py --league EFLC|L1|PL` fetches per **club**, so a walk is a squad rather than a slice of a league, and it is checked against the API's own `paging.total`. It needs a paid key: the free tier covers seasons 2022-2024 and the desk is built on 2025-26.

### La Liga

**The La Liga desk is at `/laliga`** (`laliga.html`), built the same way as the Championship's and reading `data/laliga_data.js`. It is the first desk outside British football, and it is the one that costs something — but far less than the feasibility note feared.

**The referee wall, and how it comes down.** `docs/la-liga-feasibility.md` measured that football-data.co.uk has never published a Spanish official: 0 of 33 seasons, against 100% for England's five tiers and Scotland's four. That is a quirk of the source covering British football, not a fact about Spain. What it *does* publish for Spain, at full coverage, is every card and every foul in every match. So the only thing missing is a name, and the only thing bought is a name:

    harvest_apifootball.py --ref-fixtures --league LL   # the COMPLETED season's officials
    build_refs.py --league LL                           # joins them onto the free rows

`build_refs.attach_referees` joins on **date plus both clubs by canonical name** — not kick-off time, which the two sources disagree about by hours, and not short code, which would drop every match played by a club that has since been relegated and rate each official on four fifths of his season. After the join, `tally_refs` and `build_refs` run unchanged: **every published rate is computed from the free public-domain file**, exactly as for the English desks. The paid dependency is one column, not the foundation.

Two fixture lists exist for this league and they are different seasons: `laliga_fixtures.js` is the season being *played* (the Fixtures tab), `laliga_ref_fixtures.js` is the season just *completed* (the referee join). Conflating them yields a desk with no referee data at all.

**The division names itself.** The Championship's 24 clubs are declared in `leagues.py`, derived from a chain of six separately-confirmed promotions and relegations — which works, but a wrong link produces a club with no players and no error anywhere. Spain's 2026-27 line-up could not be confirmed from a primary source, so rather than guess it, `harvest_apifootball.py --league LL --clubs` reads the twenty off `/teams` and writes `data/laliga_clubs.json`, which is committed and which every later stage resolves club names through. It refuses to write a division that is not twenty clubs. **Which clubs are promoted is derived too**, from two files the build already reads: a club in the registry with no match in last season's records came up. There is no third list to keep in step with reality.

**Three feeds, three spellings.** football-data.co.uk writes `Ath Madrid`, `Espanol`, `Sociedad`, `Vallecano`; API-Football writes `Atlético Madrid`, `Espanyol`, `Real Sociedad`, `Rayo Vallecano`. Every one must reach the same club or the referee join and the club card rates silently address nobody. `data/test_laliga.py` pins all twenty of 2025-26 in both spellings against each other, plus accent folding for names in no table at all.

**It is the best league of the three to point this product at.** Over the six seasons to 2025-26 Spain produced 4.71 yellows a game against the Premier League's 3.64 — 29% more — with double the reds and the highest yellows-per-foul of the big five. The desk's base rate rises from 17.0% on the Championship to about 20% here.

`scripts/check-laliga.mjs` guards two things the English guards cannot: that the discovered registry and the dataset describe the same division, and that the referee join covered a whole season rather than the fraction that happened to line up — a half-landed join yields a table that looks complete and is built on 60% of the evidence.

**Spain's suspension rungs are settled**: there are none above five. RFEF art. 112 sets a single threshold — five cautions in the same season *and competition*, one match — and then *"cumplida la sanción, se iniciará un nuevo ciclo de la misma clase y con idénticos efectos"*. England's ladder escalates and is gated by matchday; Spain's cycle just repeats, so there is nothing to price at ten or fifteen. Also: the count is per competition, the Copa threshold is three, and nothing carries into the next season. The evidence and — importantly — its limits are in `docs/spain-suspensions.md`: every primary document 403'd from this environment (a control fetch of Wikipedia failed too), so this rests on quotations of art. 112 rather than on the article itself, and one secondary source disagreed. The strip ships with that caveat stated on the page rather than hidden in a commit message.

**The La Liga suspension strip is built** (Players tab). It reads a separate `sc` field — THIS season's cautions, harvested from the season being played — never `yc`, which is last season's total: accumulation does not carry between seasons, so using `yc` would tell a reader a player is one booking from a ban when the rules have him on zero. Before the season starts every `sc` is null, and the strip says so and forecasts who reaches five first rather than pretending to a live count. `PLDCore.suspensionCycle` takes the total *modulo* five, so a player on ten has served two bans and is back on zero — not eight tenths of the way to a third. `check-laliga.mjs` asserts the strip reads `sc` and not `yc`, and that it bans at five and not at an English 10 or 15; both were confirmed to fire.

It ships with the caveat attached, on the page: the five-caution rule is corroborated across several quotations of art. 112 but was not verified from the source document, which is unreachable from here.

**The Premier League strip is built too**, and it is the only one of the three with a genuinely live count. La Liga and the Championship read `sc` from a harvested season file, refreshed when the workflow runs; this desk already pulls the FPL feed every load, so it stamps `p.sc`/`p.sm` straight from `p.live.yc`/`p.live.min` and the strip is as current as the feed. When a player has no live row the fields are *deleted* rather than set to zero — an unmatched player is uncounted, not on nought, and defaulting him to zero would put a booked player at the safe end of the watch. That leaves the ladder to be read the same way everywhere: `renderSuspension()` holds no threshold of its own, only the wiring from the desk's live rows into `PLDSuspension`.

The trap on this desk specifically is that there are now two card counts in scope. `p.yc` is 2025-26; `p.live.yc` is 2026-27. Crediting last season's total against a ladder that counts only this one would announce that half the league is a booking from a ban. `check-data.mjs` therefore asserts the strip reads `p.live.yc` and never assigns `p.sc = p.yc`, on top of pinning the scheme itself to a 5/10/15 ladder gated 19/32 with a **two**-match ten-rung. All nine mutations of those assertions — including swapping in the Championship's match-37 gate, flipping the ladder to a cycle, dropping `cumulative`, and hard-coding rungs into the page — were confirmed to fail the guard.

**All three suspension schemes are now settled and shipped**, and England and Spain are structurally different rather than variants of one rule:

| | PL | Championship | La Liga |
|---|---|---|---|
| Shape | ladder | ladder | cycle |
| Ban | 1 / **2** / 3 | 1 / **2** / 3 | 1, always |
| Gate | match 19 / 32 | match **19 / 37** | none |
| After a ban | keeps running | keeps running | resets |

Getting those the wrong way round is silent both ways, so no page implements a threshold: the rules live in `data/leagues.py`, ship with each dataset as `const SUSPENSION`, and are computed by one shared module (`assets/suspension.js` over `PLDCore.nextSuspension`). `check-data`, `check-eflc` and `check-laliga` each reject the *other* leagues' schemes: the Championship guard rejects the Premier League's match-32 gate, and the Premier League guard rejects the Championship's match-37 one — the pair that differ by five matches and by nothing visible on screen.

The gating is load-bearing and was wrong at first: a Championship player on four cautions after his club's 19th match can no longer reach that rung, so pricing his ban over a 23-match horizon showed **99%** for something already impossible. The horizon is capped at the gate. `docs/suspension-rules.md` covers all three schemes and — as with Spain — exactly how far each was verified, which is not all the way: the regulations themselves are unreachable from this environment.

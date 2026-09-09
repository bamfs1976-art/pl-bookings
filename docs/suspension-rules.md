# Suspension rules, and how far each was checked

Four desks, four schemes (Serie A added 9 September 2026), and they are not
variations on one rule: England, Spain and Italy do structurally different
things. Getting them the wrong way round is
silent in both directions: Spain's cycle applied to England forgives a player
who has already spent his 5- and 10-rungs, and England's ladder applied to
Spain invents bans nobody serves.

So the rules live in `data/leagues.py` as structured schemes, ship with each
dataset as `const SUSPENSION`, and are computed by one shared module
(`assets/suspension.js` over `PLDCore.nextSuspension`). No page implements a
threshold.

## The three shapes

| | Premier League | EFL Championship | La Liga | Serie A |
|---|---|---|---|---|
| Shape | ladder | ladder | cycle | ladder with a tail |
| Thresholds | 5 / 10 / 15 | 5 / 10 / 15 | every 5 | 5 / 10 / 14 / 17 / 19, then every 1 |
| Ban | 1 / **2** / 3 matches | 1 / **2** / 3 matches | 1 match, always | 1 match, always |
| Gate | by match 19 / 32 | by match **19 / 37** | none | none |
| After a ban | count **keeps running** | count **keeps running** | count **resets** | count **keeps running** |
| Beyond the top | 20+ → Regulatory Commission | 20+ → Regulatory Commission | cycle repeats | every caution is a ban |

Italy is the one that is easiest to mistake for one of the other two. It is
cumulative like England (ten cautions means the 5- and 10-rungs are spent)
but it never escalates and has no gate, and past the nineteenth caution it
behaves like a cycle of one. The registry carries it as a ladder with an
optional `then_every` tail; the English ladders have no tail and are
unchanged.

Two consequences that are easy to miss:

- **A gate is a deadline, not a warning.** A Championship player on four
  cautions after his club's 19th match can no longer be caught by the
  five-rung at all; the watch has to move him to the ten. The strip caps its
  horizon at the gate for exactly this reason — before that fix it priced a
  99% chance of a ban that had already become impossible.
- **England's ladder is cumulative.** Ten cautions means the 5- and 10-rungs
  are spent and fifteen is next, five away. Spain's ten means two bans served
  and five to go again. The same number, two different positions.

## Where each strip gets its count

All three strips read `sc` — cautions in the season being played — and never
`yc`, which is last season's total. Under a cycle nothing carries between
seasons, and under a ladder the count is per season too, so `yc` is the wrong
number in every league. Null means *uncounted*, not zero: a player with no row
in the season feed is left off the watch rather than placed at the safe end of
it.

Where they differ is freshness.

| Desk | Source of `sc` | Refreshed |
|---|---|---|
| Premier League | `p.live.yc` from the FPL feed, stamped at render | every page load |
| Championship | `sc`/`sm` emitted into `eflc_data.js` | when the workflow runs |
| La Liga | `sc`/`sm` emitted into `laliga_data.js` | when the workflow runs |
| Serie A | `sc`/`sm` emitted into `seriea_data.js` | when the workflow runs |

The Premier League desk was already pulling the live feed for injuries and
prices, so its strip is current rather than as-built. The cost is that it is
the one desk where two card counts are in scope at once — `p.yc` for 2025-26
and `p.live.yc` for 2026-27 — which is why `check-data.mjs` asserts the strip
reads the live one and never assigns `p.sc = p.yc`.

## Premier League — checked

Five cautions before the conclusion of the club's 19th league match is a
one-game ban; ten before the 32nd is **two**; fifteen at any point in the
season is three, with 20+ referred to a Regulatory Commission. The gates are
19 and 32 against the Championship's 19 and 37 because the season is 38 games
rather than 46 — the same ladder on a shorter runway, not a different rule.
The count does not reset when a ban is served.

The 19/32 pair carries the same evidence limit as everything else here: it is
corroborated across published summaries of the Premier League handbook rather
than read out of the handbook.

## Championship — checked

Five cautions before the conclusion of the club's 19th league match is a
one-game ban; ten before the 37th is **two**; fifteen at any point in the
season is three. Twenty or more refers the player to a Regulatory Commission,
whose sanction is discretionary and therefore **not forecast here**. The count
does not reset when a ban is served. Accumulation bans do not carry into the
play-offs.

This closes the `5 and 15 rungs TO CONFIRM` note that had been in the registry
since the desk was built — only the 10-before-37 rung had been confirmed.

## La Liga — checked, with a caveat

See `docs/spain-suspensions.md`. RFEF art. 112: five cautions in the same
season *and competition* is one match, then *"cumplida la sanción, se iniciará
un nuevo ciclo de la misma clase y con idénticos efectos"* — identical effects,
so no escalation at ten or fifteen. The caveat is that the primary document
could not be opened from this environment; the rule rests on corroborated
quotations of the article rather than the article itself.

## Serie A: checked against the primary text

See `docs/italy-suspensions.md`. Art. 9, comma 5 of the FIGC's Codice di
Giustizia Sportiva: one match at the fifth caution, then *"alla quinta, alla
quarta, alla terza, alla seconda ammonizione, ad ogni ulteriore ammonizione"*,
which puts the bans at 5, 10, 14, 17 and 19 and at every caution from there.
The count is per competition and cumulative within the season. This is the one
rule in this file read from the source document rather than from quotations of
it: the FIGC PDF is refused by the build network but not by a GitHub runner,
where `scripts/probe-codice.py` read it on 9 September 2026. The ladder came
back verbatim; the article number did not. The desk had cited art. 19, which
is *Esecuzione delle sanzioni* and contains no ladder, and every citation has
been corrected. The brief that commissioned the desk stated a different
progression (5, 10, 15, then every second caution). The Codice does not say
that, and the desk does not price it.

## What is deliberately not modelled

- **Red cards.** A dismissal is its own suspension and is not accumulation.
- **The 20+ Regulatory Commission referral** in England, and Spain's extra
  match for a fifth caution engineered within a single game. Both are
  discretionary decisions by a panel, not functions of a card count.
- **Cup cautions.** Every scheme counts one competition at a time. The desks
  hold league cards only, which is correct for all four, and pooling them
  would ban players early.

## The evidence limit that applies to all of this

WebFetch is blocked in the environment these desks are built in — a control
fetch of Wikipedia returns 403, so it is not the publishers refusing. Both
rule sets therefore rest on search results quoting the regulations rather than
on the regulations themselves. The English figures are corroborated across
several independent sources and are the widely-published PL and EFL rules; the
Spanish ones are corroborated too, but one secondary source disagreed and is
recorded in the Spain file.

Before any of the four strips is treated as authoritative, open the Premier
League handbook, the EFL regulations, the RFEF Código Disciplinario and the
FIGC Codice di Giustizia Sportiva on an unrestricted network and confirm the
thresholds, the gates and the ban lengths against the tables above.

## Sources

- Premier League and EFL yellow-card suspension rules —
  <https://news.bet365.com/en-gb/article/yellow-card-suspension-rules-explained/2025121014215153267>
- EFL cut-off points explained, with the 19th- and 37th-match gates —
  <https://www.sunderlandecho.com/sport/football/sunderland-afc/efl-disciplinary-rule-explained-as-safc-reach-cut-off-point-3606126>
- Suspensions and the Championship play-offs —
  <https://www.sunderlandecho.com/sport/football/sunderland-afc/efl-fa-confirm-championship-suspension-rules-play-off-sunderland-5083311>
- Players close to a ban, Premier League —
  <https://www.premierleague.com/en/news/4425344/which-players-are-suspended-or-close-to-a-ban-in-fantasy>
- Spain: see `docs/spain-suspensions.md` for the RFEF sources.
- Italy: see `docs/italy-suspensions.md` for the FIGC sources.

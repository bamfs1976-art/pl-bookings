# Suspension rules, and how far each was checked

Three desks, three schemes, and they are not variations on one rule — England
and Spain do structurally different things. Getting them the wrong way round is
silent in both directions: Spain's cycle applied to England forgives a player
who has already spent his 5- and 10-rungs, and England's ladder applied to
Spain invents bans nobody serves.

So the rules live in `data/leagues.py` as structured schemes, ship with each
dataset as `const SUSPENSION`, and are computed by one shared module
(`assets/suspension.js` over `PLDCore.nextSuspension`). No page implements a
threshold.

## The two shapes

| | Premier League | EFL Championship | La Liga |
|---|---|---|---|
| Shape | ladder | ladder | cycle |
| Thresholds | 5 / 10 / 15 | 5 / 10 / 15 | every 5 |
| Ban | 1 / **2** / 3 matches | 1 / **2** / 3 matches | 1 match, always |
| Gate | by match 19 / 32 | by match **19 / 37** | none |
| After a ban | count **keeps running** | count **keeps running** | count **resets** |
| Beyond the top | 20+ → Regulatory Commission | 20+ → Regulatory Commission | cycle repeats |

Two consequences that are easy to miss:

- **A gate is a deadline, not a warning.** A Championship player on four
  cautions after his club's 19th match can no longer be caught by the
  five-rung at all; the watch has to move him to the ten. The strip caps its
  horizon at the gate for exactly this reason — before that fix it priced a
  99% chance of a ban that had already become impossible.
- **England's ladder is cumulative.** Ten cautions means the 5- and 10-rungs
  are spent and fifteen is next, five away. Spain's ten means two bans served
  and five to go again. The same number, two different positions.

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

## What is deliberately not modelled

- **Red cards.** A dismissal is its own suspension and is not accumulation.
- **The 20+ Regulatory Commission referral** in England, and Spain's extra
  match for a fifth caution engineered within a single game. Both are
  discretionary decisions by a panel, not functions of a card count.
- **Cup cautions.** Every scheme counts one competition at a time. The desks
  hold league cards only, which is correct for all three, and pooling them
  would ban players early.

## The evidence limit that applies to all of this

WebFetch is blocked in the environment these desks are built in — a control
fetch of Wikipedia returns 403, so it is not the publishers refusing. Both
rule sets therefore rest on search results quoting the regulations rather than
on the regulations themselves. The Championship figures are corroborated
across several independent sources and are the widely-published EFL rule; the
Spanish ones are corroborated too, but one secondary source disagreed and is
recorded in the Spain file.

Before either strip is treated as authoritative, open the EFL regulations and
the RFEF Código Disciplinario on an unrestricted network and confirm the
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

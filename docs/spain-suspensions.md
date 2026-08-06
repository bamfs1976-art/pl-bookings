# Spanish suspension rungs: what the RFEF rules actually say

The La Liga desk shipped with its suspension thresholds recorded as
**unconfirmed**, because the question that matters for a suspension-watch strip
is not "how many cards is a ban" — everyone knows it is five — but *what
happens above five*. England's ladder escalates and is gated by matchday; if
Spain's did too, a strip would need to price three different rungs.

**It does not. There are no higher rungs.**

---

## The rule

**RFEF Código Disciplinario, art. 112.** In the Campeonato Nacional de Liga,
the accumulation of **five cautions** during the same season *and competition*
carries a **one-match suspension**, plus the financial penalty in art. 52.

Then the sentence that settles the question:

> *"Cumplida la sanción, se iniciará un nuevo ciclo de la misma clase y con
> idénticos efectos."*

**Identical effects.** Once the ban is served the counter restarts and the next
five cards cost exactly the same one match. The tenth card is a ban; so is the
fifteenth; neither is a longer one. There is nothing to escalate.

## Four consequences for anything built on this

1. **The count is per competition** — *"la misma temporada y competición"*. La
   Liga cards and Copa cards never pool. A desk that summed a player's cards
   across competitions would ban him early.
2. **The Copa threshold is three, not five** (art. 112; art. 119 applies the
   same three-card rule to promotion play-off phases).
3. **Accumulation sanctions do not carry into the following season.** The RFEF
   confirmed this change; a cycle open at the final whistle of a season dies
   with it. So a pre-season desk starts everyone at zero, which is exactly the
   state this desk is in.
4. **A fifth caution shown *within a single match*** can draw an additional
   match and a €600 fine — the provision aimed at players engineering the fifth
   card at a convenient moment. That is a referee's and a committee's decision,
   not a function of a card count, so it is not predictable from this data and
   must not be modelled.

## How this differs from England

| | Threshold | Ban | Gate |
|---|---|---|---|
| **Premier League** | 5 / 10 / 15 | 1 / **2** / 3 matches | by gameweek (19, 32, season) |
| **EFL Championship** | 5 / 10 / 15 | 1 / **2** / 3 matches | by match number (37 for the 10-rung) |
| **La Liga** | every 5 | **1 match, always** | none — the cycle just repeats |

Spain is the simplest of the three to model and the busiest to watch: with no
matchday gate, somebody is on four cards essentially every week, whereas
England's ladder goes quiet for long stretches once a cutoff passes.

## What I could NOT verify, and why it matters

**I did not read the Código Disciplinario myself.** Every attempt to fetch a
primary document returned HTTP 403 — rfef.es, the CSD tribunal resolutions, the
regional federation mirrors, and a control fetch of Wikipedia. The control
failing is the tell: the block is this environment's, not the publishers'. What
is above comes from search results that quote art. 112, corroborated across
several independent queries, not from the PDF.

That is weaker evidence than reading the article, and it is why this file
exists rather than a one-line comment.

**One source disagreed.** At least one aggregation stated that ten cards carry
a *two*-match ban in Spain. It is recorded here so a future reader does not
rediscover the conflict and assume it was missed. It is rejected because it
cannot be reconciled with *"idénticos efectos"*, which multiple quotations of
the article itself agree on, and because it looks like the English ladder
imported to the wrong country.

**Before shipping a user-facing suspension strip**, open
`https://rfef.es/es/federacion/normativas-y-circulares/codigo-disciplinario`
from an unrestricted network and confirm art. 112 reads as quoted. The rule is
almost certainly right; the point is that "almost certainly" is not the
standard for copy that tells someone a player is one card from a ban.

## Sources

- RFEF, *Código Disciplinario* (art. 112 acumulación de amonestaciones; art. 52
  accessory fines; art. 119 play-off phases) —
  <https://rfef.es/es/federacion/normativas-y-circulares/codigo-disciplinario>
- RFEF communication that accumulation sanctions no longer carry to the
  following season — <https://iusport.com/archive/112509/la-rfef-comunica-que-la-sancion-por-acumulacion-de-tarjetas-ya-no-se-aplica-la-temporada-siguiente>
- Reduction from five to three cautions in the Copa del Rey —
  <https://www.ultimahora.es/deportes/futbol/2012/08/15/78734/federacion-futbol-reduce-tarjetas-amarillas-acarrean-suspension-copa-del-rey.html>
- The fifth-caution-within-a-match provision and the €600 fine —
  <https://valenciabase.com/las-sanciones-por-acumulacion-de-la-temporada-pasada-no-se-cumpliran-y-multa-para-los-que-finjan-la-quinta-amarilla/>
- Three-caution rule in promotion play-offs —
  <https://www.eldesmarque.com/futbol/20240514/jugadores-con-riesgo-de-sancion-para-el-play-off-asi-computan-las-tarjetas-amarillas_18_017218002.html>

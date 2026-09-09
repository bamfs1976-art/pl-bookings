# Italian suspension rungs: what the FIGC rules say, and how far that was checked

Written 9 September 2026 for the Serie A desk. The same exercise as
[spain-suspensions.md](spain-suspensions.md): the question a suspension-watch
strip needs answered is not "how many cautions is a ban" but *what happens
after the first one*, because that is what decides whether the strip prices a
repeating cycle, an escalating ladder, or something else.

**Italy is something else.** It is a third shape.

---

## The rule

**Codice di Giustizia Sportiva (FIGC), art. 19.** A player who accumulates
cautions in the same competition is suspended for one match at the **fifth**
caution. In recidiva (repeat offending) the progression is:

> a) successiva squalifica per una gara alla quinta ammonizione;
> b) successiva squalifica per una gara alla quarta ammonizione;
> c) successiva squalifica per una gara alla terza ammonizione;
> d) successiva squalifica per una gara alla seconda ammonizione;
> e) successiva squalifica per una gara ad ogni ulteriore ammonizione.

So the bans fall at the **5th, 10th, 14th, 17th and 19th** caution, and at
**every caution from the 19th on**. Every ban is one match. The player is in
*diffida* (one caution from a ban) at 4, 9, 13, 16 and 18, and permanently
after that.

Three facts that follow, each corroborated by the sources below:

1. **The count is cumulative within the season.** Serving a ban does not reset
   it; the next threshold is measured from the total. That is what makes it a
   ladder and not Spain's cycle.
2. **The count is per competition.** Serie A and Coppa Italia cautions never
   pool, and the Coppa has its own thresholds. The desk holds league cards
   only, which is the correct count.
3. **There is no matchday gate and no escalation.** Unlike England, a rung
   never expires and the ban never grows. A player on twenty-three cautions
   has served eight bans and is one caution from the ninth.

## How it is expressed in the registry

`data/leagues.py` carries the two existing shapes: England's gated,
escalating `ladder` and Spain's repeating `cycle`. Neither can say "and every
caution after the last rung", so the ladder shape gained one optional field:

```
{"kind": "ladder", "cumulative": true, "review": null,
 "rungs": [{"at": 5}, {"at": 10}, {"at": 14}, {"at": 17}, {"at": 19}],   # ban 1, no gate
 "then_every": 1}
```

`PLDCore.nextSuspension` walks the rungs as before and, past the last one,
steps by `then_every` for ever; a player on such a ladder is never "dead" to
accumulation. `assets/suspension.js` measures the pips over the current step
rather than the whole climb once the tail is reached. The English ladders
carry no tail and behave exactly as they did, and the three guards still
reject each other's schemes by shape: England's rungs are gated, Italy's are
not and carry a tail, Spain has no rungs at all.

## How this differs from the other three

| | Premier League | Championship | La Liga | Serie A |
|---|---|---|---|---|
| Shape | ladder | ladder | cycle | ladder with a tail |
| Thresholds | 5 / 10 / 15 | 5 / 10 / 15 | every 5 | 5 / 10 / 14 / 17 / 19, then every 1 |
| Ban | 1 / 2 / 3 | 1 / 2 / 3 | 1, always | 1, always |
| Gate | match 19 / 32 | match 19 / 37 | none | none |
| After a ban | count keeps running | count keeps running | count resets | count keeps running |
| Beyond the top | Regulatory Commission | Regulatory Commission | cycle repeats | every caution is a ban |

## What the commissioning brief said, and why the desk does not follow it

The brief for this desk stated the rule as "suspends at the 5th, 10th and 15th
caution, then every second caution after that". No source found says that. All
three sources below, independently, give the 5, then 5, 4, 3, 2, then 1
progression, and it is the sequence Italian football writes about every week
as the *diffida* list (4, 9, 13, 16, 18). The brief also said never to guess a
rule, so the desk prices what the sources say, and this file records that the
two disagree so the reviewer can settle it.

## What could not be verified, and why it matters

**The Codice itself was not read.** `figc.it`, which publishes the PDF, and
the legal databases that reprint it (Altalex, Mondodiritto) were all refused
by the network the desk is built on, as was the AIA's own site. The rule above
therefore rests on three independent quotations of art. 19 that agree with
each other word for word, not on the article. That is the same evidential
position the La Liga desk shipped in, and the page says so in its Guide.

Before the strip is treated as authoritative, open the Codice di Giustizia
Sportiva on an unrestricted network and confirm art. 19's progression, that
the count is per competition, and that nothing in the current season's
Comunicato Ufficiale has amended it. If the brief's 5/10/15 reading turns out
to be right, the fix is five lines in `data/leagues.py` and nothing else.

## Not modelled, deliberately

- **Red cards.** A dismissal is its own sanction and is not accumulation.
- **Coppa Italia cautions.** Counted separately by the federation; the desk
  holds league cards only.
- **Discretionary additions** by the Giudice Sportivo (a caution accompanied
  by a fine, a second-yellow dismissal's own ban). These are decisions, not
  functions of a card count.

## Sources

- FIGC, Codice di Giustizia Sportiva, art. 19 (the current consolidated text
  at <https://www.figc.it/media/276306/codice-di-giustizia-sportiva-figc_modifica_-aggiornato_su_cu_18a_del_10-07-2025.pdf>,
  unreachable from the build environment; the progression is quoted from the
  secondary sources below, which reproduce it verbatim).
- Fanpage, "Regolamento diffidati Serie A: dopo quante ammonizioni scatta la
  squalifica" <https://www.fanpage.it/sport/calcio/regolamento-diffidati-serie-a-dopo-quante-ammonizioni-scatta-la-squalifica/>
- Pianeta Lecce, "Quante ammonizioni servono per la squalifica"
  <https://www.pianetalecce.it/news/495422180870/quante-ammonizioni-servono-per-squalifica>
- Mondodiritto, art. 19 of the Codice di Giustizia Sportiva
  <https://www.mondodiritto.it/codici/codice-di-giustizia-sportiva/art-19-codice-di-giustizia-sportiva-esecuzione-delle-sanzioni.html>
- Il Gazzettino, on the 2019 change to a fifth-caution threshold
  <https://m.gazzettino.it/sport/calcio/calcio_serie_ammonizioni_squalifica-1178851.html>

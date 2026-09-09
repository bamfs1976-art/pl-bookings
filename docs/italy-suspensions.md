# Italian suspension rungs: what the FIGC rules say, and how far that was checked

Written 9 September 2026 for the Serie A desk. The same exercise as
[spain-suspensions.md](spain-suspensions.md): the question a suspension-watch
strip needs answered is not "how many cautions is a ban" but *what happens
after the first one*, because that is what decides whether the strip prices a
repeating cycle, an escalating ladder, or something else.

**Italy is something else.** It is a third shape.

---

## The rule

**Codice di Giustizia Sportiva (FIGC), art. 9, comma 5.** A player who
accumulates cautions in the same competition is suspended for one match at the
**fifth** caution. In recidiva (repeat offending) the progression is:

> a) successiva squalifica per una gara alla quinta ammonizione;
> b) successiva squalifica per una gara alla quarta ammonizione;
> c) successiva squalifica per una gara alla terza ammonizione;
> d) successiva squalifica per una gara alla seconda ammonizione;
> e) successiva squalifica per una gara ad ogni ulteriore ammonizione.

So the bans fall at the **5th, 10th, 14th, 17th and 19th** caution, and at
**every caution from the 19th on**. Every ban is one match. The player is in
*diffida* (one caution from a ban) at 4, 9, 13, 16 and 18, and permanently
after that.

The sentence that opens comma 5, read from the FIGC's own PDF:

> I tesserati cui gli organi di giustizia sportiva infliggano piu ammonizioni,
> ancorche conseguenti ad infrazioni di diversa natura, alla quinta
> ammonizione incorrono nella squalifica per una gara. Nei casi di recidiva,
> si procede secondo la seguente progressione: ...

Three facts that follow, each confirmed against the primary text:

1. **The count is cumulative within the season.** Serving a ban does not reset
   it; the next threshold is measured from the total. That is what makes it a
   ladder and not Spain's cycle.
2. **The count is per competition.** Serie A and Coppa Italia cautions never
   pool, and the Coppa has its own threshold: art. 19, comma 5 gives one
   match of suspension for every two cautions there, not five. Art. 19, comma
   7 goes further and voids league cautions entirely for the play-offs, where
   a second caution is a ban. The desk holds league cards only, which is the
   correct count.
3. **There is no matchday gate and no escalation.** Unlike England, a rung
   never expires and the ban never grows. A player on twenty-three cautions
   has served eight bans and is one caution from the ninth. Cautions do lapse
   at the end of the season, and on a transfer to a club in a different Lega
   (art. 19, comma 9), neither of which the desk has to model inside a single
   league season.

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
caution, then every second caution after that". The Codice does not say that,
and neither does any secondary source found. The desk shipped the 5, then 5,
4, 3, 2, then 1 progression on three agreeing secondary quotations, and the
primary text has since confirmed it word for word. It is also the sequence
Italian football writes about every week as the *diffida* list (4, 9, 13, 16,
18). The brief is wrong on this point and the desk is right.

## Checked against the Codice, 9 September 2026

The desk shipped this ladder without having read the Codice: `figc.it` and the
legal databases that reprint it are all refused by the network the desk is
built on. A GitHub runner is not, so `scripts/probe-codice.py` reads the FIGC's
own PDF there, prints what it finds and writes nothing. Run 3 of
`.github/workflows/probe-codice.yml` settled two things.

**The rule is right.** The consolidated text (730,287 bytes, 271,453
characters of extracted text) carries the 5, then 5, 4, 3, 2, then *ogni
ulteriore ammonizione* progression verbatim, exactly as the three secondary
sources quoted it. The shipped rungs of 5, 10, 14, 17 and 19 followed by every
caution are what that sentence produces. Nothing in `data/leagues.py`,
`assets/core.js` or `assets/suspension.js` needed changing.

**The citation was wrong.** The progression sits in **art. 9, comma 5**, the
article that lists the sanctions themselves. Art. 19 is *Esecuzione delle
sanzioni*, and its nine commas cover publication, immediate enforceability,
the ban on entering the ground, Coppa Italia and the Coppe Regioni, play-offs
and play-outs, and when cautions lapse. It contains no accumulation ladder.
The "art. 19" citation came from the secondary sources, one of which is a
reprint of art. 19 headed *Esecuzione delle sanzioni*, and it propagated
through this repository unchallenged. A rule quoted under the wrong number is
a rule a reader cannot check, so every citation has been corrected.

Two smaller findings from the same read, both now recorded above: the Coppa
Italia threshold is one ban every two cautions (art. 19, comma 5), and
cautions lapse at the end of the season and on a transfer between Leghe (art.
19, comma 9).

Still unchecked: whether the current season's Comunicati Ufficiali have
amended art. 9. The probe reads the consolidated text as published, which is
the right document, but a mid-season amendment would not appear in it until
the FIGC republishes.

## Not modelled, deliberately

- **Red cards.** A dismissal is its own sanction and is not accumulation.
- **Coppa Italia cautions.** Counted separately by the federation; the desk
  holds league cards only.
- **Discretionary additions** by the Giudice Sportivo (a caution accompanied
  by a fine, a second-yellow dismissal's own ban). These are decisions, not
  functions of a card count.

## Sources

- **FIGC, Codice di Giustizia Sportiva, art. 9, comma 5.** The primary text,
  read on a GitHub runner on 9 September 2026 by `scripts/probe-codice.py`:
  <https://www.figc.it/media/276306/codice-di-giustizia-sportiva-figc_modifica_-aggiornato_su_cu_18a_del_10-07-2025.pdf>
  (consolidated to Comunicato Ufficiale 18/A of 10 July 2025). This is the
  source the ladder rests on. The three secondary sources below agree with it
  and are kept because they are what the desk shipped on.
- Fanpage, "Regolamento diffidati Serie A: dopo quante ammonizioni scatta la
  squalifica" <https://www.fanpage.it/sport/calcio/regolamento-diffidati-serie-a-dopo-quante-ammonizioni-scatta-la-squalifica/>
- Pianeta Lecce, "Quante ammonizioni servono per la squalifica"
  <https://www.pianetalecce.it/news/495422180870/quante-ammonizioni-servono-per-squalifica>
- Mondodiritto, art. 19 of the Codice di Giustizia Sportiva
  <https://www.mondodiritto.it/codici/codice-di-giustizia-sportiva/art-19-codice-di-giustizia-sportiva-esecuzione-delle-sanzioni.html>
  (this is *Esecuzione delle sanzioni*, and is the likely origin of the wrong
  article number: it is the page the desk's secondary sources pointed at)
- Il Gazzettino, on the 2019 change to a fifth-caution threshold
  <https://m.gazzettino.it/sport/calcio/calcio_serie_ammonizioni_squalifica-1178851.html>

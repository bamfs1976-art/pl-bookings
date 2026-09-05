# Data terms: the session cookie question

**Status: UNANSWERED. The harvest is untouched until it is answered.**

This file exists because the pipeline's largest dependency is also its least
examined one, and nobody has written down whether it is allowed.

## The dependency

`.github/workflows/data-refresh.yml` passes `SS_COOKIE` — a **logged-in
ScoutingStats (Sportmonks) browser session cookie**, held as a repository
secret — to `data/harvest_apifootball.py`'s ScoutingStats leg and the player
harvest. Player and club form for the Premier League desk comes through it.

That is materially different from the project's other sources. The permitted
list in the README — epldata (MIT), the DataHub football-data.co.uk mirror
(PDDL), openfootball (CC0), the official FPL API through this site's own proxy
— are all either openly licensed or a public API used as intended. A session
cookie is **a credential issued to a person for interactive use**, replayed by
a machine on a schedule. Whether that is permitted is a question about
ScoutingStats' terms, not about the code, and it cannot be settled by reading
this repository.

## Why it is being asked now rather than later

Three reasons, in order of how much they would cost to discover late:

1. **It is the single point of failure for the Premier League desk's form
   data.** If it is not permitted, the answer is not a patch — it is a
   different source, and that is weeks, not hours.
2. **A cookie expires and gets rotated.** Every rotation is a person logging in
   and pasting a credential into a secret store. That is a standing cost and a
   standing risk, and it is worth knowing it is a legitimate one.
3. **The desk publishes numbers derived from it.** If the terms forbid
   automated collection or redistribution of derived figures, that reaches the
   published pages, not just the pipeline.

## The checklist — for the account holder to complete

Answer against the **current** terms as they appear to the logged-in account,
and paste the clause text rather than a summary. A recollection of what the
terms said is not an answer to any of these.

| # | Question | Answer | Clause / evidence |
|---|---|---|---|
| 1 | Do the terms address **automated access** (scripts, bots, scheduled jobs) at all? | | |
| 2 | Is automated access **permitted, forbidden, or silent**? | | |
| 3 | Do the terms address **sharing or reusing credentials**, including a session cookie held in a CI secret store? | | |
| 4 | Is there an **official API** offered for this data, and is it available on the current plan? | | |
| 5 | Do the terms restrict **storing** the retrieved data? | | |
| 6 | Do they restrict **publishing figures derived from** it? | | |
| 7 | Do they restrict **commercial** use? (Relevant to the paid tier, even though no checkout ships in this pass.) | | |
| 8 | Is there a **rate limit** or acceptable-use clause the refresh cadence should respect? | | |
| 9 | Date the terms were read, and the URL. | | |

## What happens on each answer

- **Permitted, with conditions** — record the conditions here, make the
  workflow honour them (cadence, attribution, no redistribution), and say so in
  the README's Source data note.
- **An official API exists on the plan** — move to it. A documented endpoint
  with a real key removes the rotation cost and the ambiguity in one step, and
  it is worth doing even if the cookie turns out to be permitted.
- **Forbidden or silent-and-risky** — the harvest stops. What replaces it is a
  separate decision: the FPL API already supplies availability and squads, and
  the free football-data.co.uk archive supplies referees and cards. What it
  would cost is the ScoutingStats-only per-player form fields, and the desk
  would need to say plainly which numbers it no longer has rather than quietly
  ship staler ones.

**Until a row above is filled in, no change is made to the harvest.** That is
the instruction this pass was given, and it is the right one: a pipeline
carrying an unexamined credential should not be optimised, hardened or
extended, because every one of those makes it more entrenched.

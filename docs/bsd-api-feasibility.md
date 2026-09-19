# BSD (sports.bzzoiro.com): what it could do for the desks

Research note, 19 September 2026. Asked: what can this free football API give
the app, and does the data actually arrive?

**Nothing below was called.** The agent proxy denies `sports.bzzoiro.com` on
every route available to a Claude Code session — the shell returns
`CONNECT tunnel failed, response 403`, and the web fetch tool returns
`EGRESS_BLOCKED`. This is the same limitation `docs/free-data-sources.md` and
`docs/referee-sourcing.md` were written under, and it produced one wrong
conclusion in the second of those. So every claim about the API here is a
hypothesis with a source, and the measurement is deferred to
`scripts/probe-bsd.mjs`, which runs in CI where egress is open.

What *was* measured is the other half: the state of this repository, re-counted
from the files rather than quoted from the older notes. That half turned out to
matter more than the API.

---

## 1. Four of the six recorded gaps are already closed

`docs/free-data-sources.md` (August 2026) sets out six gaps and has not been
updated since. Re-counting today:

| Gap as recorded in August | State on 19 September |
|---|---|
| Availability — "`inj` is 0 of 2,417 players" | **Closed.** `data/pl_injuries.js`, `eflc_`, `laliga_`, `seriea_`, built daily by `data/harvest_extra.py` |
| Premier League photos — "117 of 660" | **Closed enough.** `check-photos`: PL 424/661 (64%), the other three 100% |
| Market benchmark — "Premier League odds only" | **Closed, and better than proposed.** `data/*_odds.js` carries bookmakers' **card** lines for all four leagues, not the 1x2 prices the note suggested harvesting |
| Championship and La Liga static | **Closed.** Both poll `/api/live-cards`; noted in that file's own preamble |
| Referee allocations — one supplier | **Open.** Still API-Football alone |
| Model context — no weather, match-state, travel | **Open.** Unchanged |

Anyone planning work off that August table will plan the wrong work. Read this
file first, or re-count before trusting it.

## 2. What is actually left is not a data gap

Everything in the closed column arrives through **one supplier**. Injuries,
odds, lineups, live cards, standings, transfers, team statistics and referee
appointments all ride the same API-Football key and the same 7,500-a-day
allowance. `docs/referee-sourcing.md` already makes the argument for the
referee number alone — "a single unverified supplier for a number that moves
every price is a single point of failure" — and the same sentence now applies
to almost every dynamic number on every desk.

So the case for a second source is not "it fills a hole". It is:

**2.1 Concentration.** One key expiring, one plan changing or one endpoint
being reshaped takes out four desks at once. A free second source is worth
having even if it carries nothing new.

**2.2 The one cost term nobody controls.** `data/api_budget.py` puts a peak day
at 2,128 calls observed (28% of the allowance) and 4,768 worst case (64%). The
term that moves between those two numbers is `live-cards.js` — a
browser-facing function whose cost scales with **readers**, not with matches.
Every other line is bounded by the fixture list. If BSD carries in-play card
incidents for these four leagues, moving the ticker onto it removes the only
line on the bill that grows when the site succeeds. **This is the highest-value
thing the probe can find**, and it is why the probe reports the live-event
incident count before anything else.

**2.3 One genuinely new number.** BSD advertises per-player match statistics.
`docs/decisions.md` records the promoted clubs' **fouls drawn** being entered
by hand because no permitted free source carries it. If BSD carries per-player
fouls, that hand-entry stops. Its xG and shotmaps are new to the repository too,
but nothing currently prices off either, so they are a curiosity until something
does.

## 3. What the probe asks, and why each question is there

`scripts/probe-bsd.mjs`, dispatched via `.github/workflows/probe-bsd.yml` with
`BSD_API_KEY` in Actions secrets. Read-only, writes nothing, about forty GETs.

1. **Coverage.** Premier League, Championship, La Liga, Serie A on one free
   token. This is the gate: a Premier-League-only token relieves nothing,
   because that desk already runs on the free FPL proxy.
2. **Incidents on a live event.** Card-like incidents with a player identity,
   while a match is running — §2.2.
3. **Lineups, scheduled versus finished.** Asked both ways on purpose. An XI
   that appears only after full time is a post-match record and prices nothing.
4. **Per-player fouls** — §2.3.
5. **Referee on the fixture object, before kick-off.** If the appointment rides
   along with the fixture list it costs one call a round rather than one a
   match, and it is the cross-check `referee-sourcing.md` asks for.
6. **Rate-limit headers.** Decides whether this can sit behind a browser-facing
   function at all. If no `X-RateLimit` headers come back, it cannot — not
   until the ceiling is known.

It also asks after availability, odds and images as **second** sources rather
than as gaps, per §1.

**The paths are discovered, not assumed.** The published reference at
`sports.bzzoiro.com/docs` is unreachable from here, so the probe tries a list of
candidate spellings at each rung and reports which answered, printing the field
names it receives. A 404 is recorded as a finding, not raised as a crash. The
log is therefore the schema note for whatever gets built next.

## 4. Run it during a round

Out of season, or midweek with nothing kicking off, a healthy feed and a useless
one produce identical output: no live matches, no lineups. An XI publishes about
an hour before kick-off, so a run earlier than that reads exactly like an API
with no lineups at all. The probe prints both caveats itself, but the run is
still wasted. **Dispatch it on a Saturday afternoon with matches in play.**

## 5. Before building anything on it

Three conditions, none of them about the data:

- **Licence.** Nothing about BSD's terms was readable from here. `docs/sources.md`
  is explicit that nothing in this repository is derived from FBref, WhoScored,
  FootyStats, Understat or any bookmaker. If BSD's football data is sourced from
  one of those, it cannot be used here whatever the probe returns, and the
  **Sources & licences** view has to be able to name it. Check this first — it
  can rule the API out on its own.
- **Free means free of charge, not free of limits.** A free tier behind a
  reader-facing function is a rate-limit incident waiting for the busy Saturday.
  §6 of the probe exists to settle that before, not after.
- **One proxy function, not two.** `docs/lineup-pricing.md` is emphatic about
  this, and names the referee-name join — seven implementations — as what
  happens otherwise. If BSD gets wired in, it gets one Netlify function, the
  way `/api/fpl/*` and `/api/live-cards` each have one.

## 6. Unblocking the test from a Claude Code session

The probe exists as a workflow because this session could not call the host.
Either route works:

- **Add `sports.bzzoiro.com`** to the environment's network policy at
  [code.claude.com/docs](https://code.claude.com/docs/en/claude-code-on-the-web),
  then run `BSD_API_KEY=... node scripts/probe-bsd.mjs` directly in a session.
- **Or add `BSD_API_KEY`** under Settings → Secrets and variables → Actions and
  dispatch the workflow. Note that Netlify environment variables are a separate
  store — `docs/referee-sourcing.md` §4 has caught this before.

---

*Related: [free-data-sources.md](free-data-sources.md) (stale on four rows — see §1),
[referee-sourcing.md](referee-sourcing.md), [lineup-pricing.md](lineup-pricing.md),
[sources.md](sources.md), [decisions.md](decisions.md).*

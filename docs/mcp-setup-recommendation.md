# MCP Setup Recommendation

Prepared 1 October 2026 for GameweekEdge and PLBookings developers. Companion to `sports-mcp-assessment.md`.

**Scope.** This document covers developer and research use in Claude Code only.

- No MCP described here belongs in either app's production request path, CI or scheduled jobs.
- Nothing here has been installed. Commands are given for a future, deliberate set-up.
- Steps marked **Validate** depend on details that could not be confirmed from this environment.

---

## 1. Install decision per MCP

| MCP | Install? | Where | Why |
|---|---|---|---|
| **sportsdata-mcp** (`DanielTomaro13/sportsdata-mcp`) | **Optional, yes, narrowly** | Developer machine only, local stdio | The only candidate with FPL tools, and it supports group allow-listing. Must be pinned and restricted because it also ships real-money bet-placement tools |
| **GameweekEdge MCP** (`https://gameweekedge.co.uk/api/mcp`) | **Yes (already available)** | Remote HTTP, read-only | Your own model's projections, captaincy, prices and suspension watch. Useful for QA prompts |
| **Sports Hub MCP** (`lacausecrypto/mcp-sports-hub`) | No, defer | n/a | Read-only and well built, but no FPL. Football groups duplicate API-Football, which PLBookings calls directly |
| **API-Football MCPs** (community) | No, defer | n/a | No official API-Sports MCP found. PLBookings' direct integration is more robust. The sportsdata-mcp `apisports` group covers exploration |
| **SportScore MCP** | **No** | n/a | No documented card, foul or referee fields. Opt-out install telemetry. Attribution link required. Operator not named |
| **F1 MCPs** (OpenF1, Jolpica, FastF1) | No | n/a | Out of scope for football products |

---

## 2. Minimal, least-privilege set-up for sportsdata-mcp

### Principles

1. **Pin the version.** Bet placement arrived in a minor release (v0.31.0). An unpinned install could gain new action tools silently.
2. **Allow-list groups explicitly.** Never rely on the default group set. What loads when `SPORTSDATA_MCP_GROUPS` is unset was not established (Validate), so always set it.
3. **Separate keys.** Use a free-tier API-Football key created for research only. Never the production `API_FOOTBALL_KEY`.
4. **No secrets in the repo.** Keep MCP config in user scope (`~/.claude.json`) or a git-ignored `.mcp.json`.
5. **Local process only.** Do not run the HTTP mode on a shared or public interface.

### Recommended tool groups

| Use | `SPORTSDATA_MCP_GROUPS` value | Approx. tools | Key |
|---|---|---|---|
| GameweekEdge research (default) | `fpl.players,fpl.fixtures,fpl.reference` | About 12 (Validate) | None |
| PLBookings field exploration (temporary) | `fpl.players,fpl.fixtures,fpl.reference,apisports` | About 32 (Validate) | `API_SPORTS_KEY` = dev-only free-tier key |

Group names come from the project README on 1 October 2026 (Validate against the pinned version's `--list-groups` output, or its README, before first use).

### Explicitly excluded

Do not add any of these, even temporarily:

| Category | Examples | Reason |
|---|---|---|
| Bet placement | `sportsbet_place_bet`, `tab_place_bet`, `entain_place_bet`, `unibet_place_bet`, any account group | Real-money actions |
| Bookmaker and odds feeds | `au-books`, `arb`, `odds` presets, `theoddsapi` | Not needed. Conflicts with PLBookings' research framing |
| Account-scoped tools | `fpl.managers` "your own team" tools, Yahoo and other fantasy account providers | Not needed. Risk of credential handling |
| `premierleague.com` private-API provider | Match centre and Opta metric tools | Private site APIs. The PL's terms forbid commercial reuse |
| `football-data-co-uk` group | | Its terms exclude automated and AI use |
| Social and news scrapers | Twitter and similar | Not needed |
| Email, filesystem-write, shell or any other action tools from any MCP | | Not needed for read-only research |

### Example configuration (Claude Code, user scope)

Not applied. Shown for review.

```json
{
  "mcpServers": {
    "sportsdata": {
      "type": "stdio",
      "command": "uvx",
      "args": ["--from", "sportsdata-mcp==0.33.0", "sportsdata-mcp", "serve"],
      "env": {
        "SPORTSDATA_MCP_GROUPS": "fpl.players,fpl.fixtures,fpl.reference",
        "SPORTSDATA_TELEMETRY": "0",
        "SPORTSDATA_MCP_CACHE_TTL": "300"
      }
    },
    "gameweekedge": {
      "type": "http",
      "url": "https://gameweekedge.co.uk/api/mcp"
    }
  }
}
```

Notes:

- The `uvx --from package==version` form pins the release. Confirm the entry-point name `sportsdata-mcp serve` against the pinned README (Validate).
- Telemetry is opt-in upstream. Setting it to `0` documents intent.
- A 300-second cache reduces repeat calls to FPL during a research session.
- For the PLBookings variant, add `apisports` to the groups and `"API_SPORTS_KEY": "<dev key>"`, using an environment reference rather than a literal key where your shell allows.

### Claude Code permissions

Add an allow-list for the read tools you actually use, and leave everything else on "ask". In `.claude/settings.local.json` (git-ignored):

```json
{
  "permissions": {
    "allow": [
      "mcp__gameweekedge__fpl_player_projection",
      "mcp__gameweekedge__fpl_captain_options",
      "mcp__gameweekedge__fpl_price_predictions",
      "mcp__gameweekedge__fpl_suspension_watch",
      "mcp__gameweekedge__fpl_model_record"
    ]
  }
}
```

Add individual `mcp__sportsdata__<tool>` entries after you have seen the tool list from the pinned version. Do not use a server-wide wildcard for sportsdata-mcp.

---

## 3. Test checklist

Run on first set-up and after any version change.

### Safety checks (must all pass before any research prompt)

- [ ] `claude mcp list` shows only `sportsdata` and `gameweekedge` as new servers.
- [ ] The sportsdata tool list contains **no** tool name matching `place_bet`, `bet_`, `account`, `deposit`, `withdraw`, `login`, `send`, `write`, `delete`.
- [ ] The total third-party tool count is under 30 (FPL-only set-up) or under 45 (with `apisports`).
- [ ] The installed version is exactly 0.33.0.
- [ ] No API key appears in any file tracked by git (`git grep -n "API_SPORTS_KEY\|x-apisports-key"` returns only documentation).
- [ ] The research API-Football key is a different key from production. Confirm on the API-Sports dashboard that its quota is separate.

### Functional checks (read-only prompts)

GameweekEdge research:

1. "Using the sportsdata FPL tools, list the current gameweek number and its deadline in UTC."
2. "Fetch the five most-transferred-in players this gameweek and show their price and ownership. Cite the tool used."
3. "Compare the GameweekEdge MCP's captain options for this gameweek with FPL `ep_next` for the same players. Show differences only."
4. "Using the GameweekEdge MCP, list players on four yellow cards who are one caution from a ban."

PLBookings exploration (only with `apisports` enabled):

5. "Using API-Football, fetch the events for one finished Premier League fixture from last weekend and show every card with minute and extra minute. Do not fetch more than one fixture."
6. "Show the raw `detail` strings API-Football uses for a second yellow card in that fixture or a recent one. One request only."
7. "Fetch `/fixtures/statistics` for the same fixture and list the field names returned for fouls and cards."
8. "Report the remaining daily request quota from the last response headers."

Expected behaviour for all prompts: Claude makes read calls only, cites the tool, and states data timestamps. Any prompt that leads Claude to attempt a non-read tool is a failure. Stop and roll back.

### Outcome log

Record each check run in `docs/decisions.md` (date, version, groups, pass/fail).

---

## 4. Rollback and removal plan

Each step is reversible within minutes and touches no production system.

1. **Disable immediately:** `claude mcp remove sportsdata` (and `claude mcp remove gameweekedge` if needed). Restart Claude Code.
2. **Remove the package cache:** `uv cache clean sportsdata-mcp`, or delete the uv tool environment.
3. **Revoke keys:** in the API-Sports dashboard, delete or rotate the research key. Production keys are unaffected because they were never used.
4. **Clean configuration:** remove the server entries from `~/.claude.json` or `.mcp.json`, and remove any `mcp__sportsdata__*` lines from `.claude/settings.local.json`.
5. **Verify:** `claude mcp list` no longer shows the server, and a new session's tool list contains no `mcp__sportsdata__` tools.
6. **Record:** add a dated line to `docs/decisions.md` with the reason for removal.

### Triggers for automatic rollback

- Any release note mentioning new write or action tools in a group you use.
- Any tool call that writes, places, sends or modifies anything.
- The research key's quota is used by something other than you.
- 60 days without use.

---

## 5. Hardening the in-house GameweekEdge MCP

The GameweekEdge MCP is public and unauthenticated by design. Three low-effort changes are recommended (tracked in `sports-data-backlog.csv`):

1. **Per-IP rate limit.** For example, 60 requests a minute, with a published limit in the GET description. This protects the upstream FPL API from being drained through your endpoint.
2. **Align `fpl_price_predictions`** with the app's switch to `price_change_percent` (22 August 2026). Users then get one answer from both surfaces.
3. **Fix the stale "six read-only tools" comment** in `netlify/lib/mcp.js`. The server defines seven tools.

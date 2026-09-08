# Live data

> Moved unchanged from the old README.md on 8 September 2026 ("Live data"). The README is now an orientation page; this file keeps the full prose.

## Live data

The official FPL API has no CORS, so the app calls it through `netlify/functions/fpl.js` — a whitelisted proxy (`bootstrap-static`, `fixtures`, `event-status`) routed at `/api/fpl/*`. The client caches reduced extracts in `localStorage` for 30 minutes and falls back to stale cache, then to the baked 2025-26 data, whenever the feed is unreachable — the top-bar pill says which basis is showing.

Live card counts overlay the baked squads by club + normalized-name matching. Once a player has 450 minutes of 2026-27 football, the yellow-rate half of his risk score switches to the live rate (rows show a green dot). Fouls are not in the FPL feed, so the fouls half stays on 2025-26 form.

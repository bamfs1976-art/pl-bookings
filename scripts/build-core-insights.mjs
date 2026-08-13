// Vendors this season's per-match FOULS into data/core_insights.js.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────
// The desk's risk score is
//
//     risk = yellow cards per 90 x 2 + fouls committed per 90
//
// and until this script existed only the first term could move in season.
// The FPL API carries yellow cards, so `attachLive` switches a player onto
// his live yellow rate once he has 450 minutes. It carries no fouls at all.
// So `p.f` — half the score, and the whole of the volume signal — stayed on
// the 2025-26 rate for the entire season, and a player whose game changed in
// August was still being priced on last spring in May. ENHANCEMENTS.md item 8
// records this as the structural gap; this is the fix.
//
// ── THE SOURCE ─────────────────────────────────────────────────────────
// olbauday/FPL-Core-Insights publishes, per gameweek, one row per player per
// match with `fouls_committed` on it, keyed by the OFFICIAL FPL player id,
// refreshed twice daily (07:30 and 17:30 UTC), no key and no account. The
// sibling Gameweek Edge repo has fetched this repository for two seasons —
// for exactly one column of teams.csv — so the source is already trusted at
// the portfolio level. Used freely with a link back, per its README.
//
// Verified before writing this: 2025-26 GW20 returns 298 player rows with
// fouls_committed populated on all 298, totalling 205 fouls across the
// round's ten matches. 20.5 fouls a match is the right Premier League number,
// which is why the sanity band below is what it is.
//
// ── WHY VENDOR RATHER THAN FETCH AT RUNTIME ────────────────────────────
// Same reason as build-sim-model.mjs: every other dataset here is a
// generated, committed .js loaded by a <script src>, the service worker
// precaches that shape so the app opens offline, and a runtime fetch would
// put a second origin on the critical path. 38 gameweek files is also far
// too much to pull in a browser.
//
//   node scripts/build-core-insights.mjs
//   node scripts/build-core-insights.mjs --season 2025-2026
//
// ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────
// Every guard below produces a NAMED error saying which document was read
// and what actually arrived. None of them falls back to a plausible number.
// A desk that prints last season's fouls while saying "live" is worse than
// one that says it is on last season's fouls, which is what the app does
// today and what it keeps doing if this file is absent.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data';
const REPO = 'https://github.com/olbauday/FPL-Core-Insights';

/* The Premier League plays 38 rounds. Reading past that is reading nothing. */
const MAX_GW = 38;

/* ── READ THE TOURNAMENT DIRECTORY, NOT THE GAMEWEEK ONE ────────────────
   `By Gameweek/GW<n>/` is every match the player played that week, in every
   competition. Harvesting 2025-26 from it produced 521 matches for a 38-round
   season and 19.2 fouls a match — a number that looks perfectly healthy, and
   is wrong, because 141 of those matches were European and cup ties.
   `By Tournament/Premier League/GW<n>/` is the same file filtered to the
   league.

   This is a BASIS question, not a sample-size one. The yellow-card half of
   the risk score comes from the FPL API, which counts Premier League cards
   only. Feeding the foul half a Europa League fixture makes one score out of
   two competitions and nothing on the page could say so. More evidence is
   not better evidence when it is measuring a different thing. */
const TOURNAMENT = 'Premier League';

/* Every match id in the league directory carries this marker. Checked on
   every row: if the upstream ever changes what lives behind that path, the
   harvest fails loudly here instead of quietly repricing the league on cup
   football again. */
const LEAGUE_MATCH = /-prem-/;

/* Minutes before a live rate replaces the baked one. READ FROM core.js, not
   redeclared: this script decides who is worth shipping and core.js decides
   who gets used, so a copy here that drifted by fifty minutes would ship a
   file whose contents the app silently ignores — the generator and the rule
   disagreeing, which is the failure data/pl_data.js is generated to avoid. */
const { MIN_LIVE_MINUTES } = createRequire(import.meta.url)('../assets/core.js');

/* League fouls per match. Two decades of Premier League seasons sit between
   19 and 24; this band is wide enough to survive a genuinely scrappy season
   and narrow enough that a column which has changed meaning — counted per
   team, or become fouls SUFFERED — cannot pass. Checked once, over the whole
   harvest, because a single round can legitimately be quiet. */
const FOULS_PER_MATCH_MIN = 12;
const FOULS_PER_MATCH_MAX = 32;

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

/* A Premier League season starts in August and is named for the calendar year
   it starts in. Derived rather than hardcoded so this does not quietly read
   last season's directory every August. */
function currentSeason(now = new Date()) {
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 6 ? y : y - 1; // July onwards = new season
  return `${start}-${start + 1}`;
}

const season = arg('season', currentSeason());

/* ---- CSV ------------------------------------------------------------
   The feed quotes fields containing commas (player names do). A split on
   comma would shift every column after a quoted name by one, which is the
   kind of failure that produces numbers rather than an error. */
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function toRecords(text, doc, required) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`${doc}: empty document`);
  const head = rows[0].map((h) => h.trim());
  const missing = required.filter((c) => !head.includes(c));
  if (missing.length) {
    throw new Error(
      `${doc}: expected column(s) ${missing.join(', ')} — the header that ` +
      `actually arrived was: ${head.join(', ')}`
    );
  }
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}

async function get(path) {
  const url = `${RAW}/${path}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PLBookingsDesk/1.0 (+https://github.com/bamfs1976-art/pl-bookings)' },
  });
  if (res.status === 404) return null;             // a round not yet published
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ---- players.csv: the join, and the means to check it ----------------
   We key on the FPL player id. That is the whole join and it is the whole
   risk: if the upstream ever renumbers, every foul rate lands on the wrong
   player and every number on the page stays perfectly plausible. So the web
   name travels WITH the id into the shipped file, and the app re-checks the
   pairing at runtime against the FPL bootstrap it already fetches. A join
   that has to prove itself on every page load cannot rot quietly. */
async function loadNames() {
  const text = await get(`${season}/players.csv`);
  if (text == null) throw new Error(`${season}/players.csv: not found (is the season directory named "${season}"?)`);
  const recs = toRecords(text, `${season}/players.csv`, ['player_id', 'web_name']);
  const names = {};
  recs.forEach((r) => { const id = num(r.player_id); if (id != null) names[id] = r.web_name; });
  if (!Object.keys(names).length) throw new Error(`${season}/players.csv: no usable player_id rows`);
  return names;
}

async function main() {
  const names = await loadNames();

  const agg = new Map();     // player_id -> {min, fouls, matches}
  const matchIds = new Set();
  let rounds = 0, rows = 0, totalFouls = 0;

  for (let gw = 1; gw <= MAX_GW; gw++) {
    const doc = `${season}/By Tournament/${TOURNAMENT}/GW${gw}/playermatchstats.csv`;
    const text = await get(doc.replace(/ /g, '%20'));
    if (text == null) continue;

    const recs = toRecords(text, doc, ['player_id', 'minutes_played', 'fouls_committed', 'match_id']);
    if (!recs.length) continue;                    // published but not played yet
    rounds++;

    recs.forEach((r) => {
      if (!LEAGUE_MATCH.test(r.match_id || '')) {
        throw new Error(
          `${doc}: match_id "${r.match_id}" is not a league fixture. That path is ` +
          `supposed to be the Premier League only — if the upstream has reorganised, ` +
          `fix TOURNAMENT/LEAGUE_MATCH here rather than letting cup football into a ` +
          `league foul rate.`
        );
      }
      const id = num(r.player_id);
      const min = num(r.minutes_played);
      const fouls = num(r.fouls_committed);
      /* A missing foul count is NOT nought. Reading it as nought fits a
         player as though he had played the match cleanly, which drags his
         rate down with evidence that does not exist — the same failure
         data/test_fouls_won.py exists to prevent on the other feed. */
      if (id == null || min == null || fouls == null) return;
      if (min <= 0) return;

      const a = agg.get(id) || { min: 0, fouls: 0, matches: 0 };
      a.min += min; a.fouls += fouls; a.matches++;
      agg.set(id, a);

      matchIds.add(r.match_id);
      totalFouls += fouls;
      rows++;
    });
  }

  /* ---- the sanity check that matters ---------------------------------
     Per-match fouls is the one number that tells you the column still means
     what it meant. It is checked over the whole harvest and only once there
     is enough of it to be meaningful — three rounds. Below that a quiet
     opening weekend is indistinguishable from a broken column, and refusing
     on a Saturday in August would take the desk off a source that is fine. */
  const matches = matchIds.size;
  const foulsPerMatch = matches ? totalFouls / matches : null;
  if (matches >= 30 && (foulsPerMatch < FOULS_PER_MATCH_MIN || foulsPerMatch > FOULS_PER_MATCH_MAX)) {
    throw new Error(
      `${season} playermatchstats: ${foulsPerMatch.toFixed(1)} fouls per match across ` +
      `${matches} matches, outside the plausible band ${FOULS_PER_MATCH_MIN}-${FOULS_PER_MATCH_MAX}. ` +
      `Either fouls_committed has changed meaning or the harvest is double-counting. ` +
      `Refusing to write data/core_insights.js rather than reprice the league on it.`
    );
  }

  /* Only players who can actually replace a baked rate are shipped. Everyone
     else is weight in a file the phone downloads for nothing. */
  const players = {};
  let eligible = 0;
  for (const [id, a] of agg) {
    if (a.min < MIN_LIVE_MINUTES) continue;
    players[id] = [a.min, Math.round(a.fouls * 100) / 100, names[id] || ''];
    eligible++;
  }

  const unnamed = Object.values(players).filter((v) => !v[2]).length;
  if (eligible && unnamed / eligible > 0.05) {
    throw new Error(
      `${season}: ${unnamed} of ${eligible} eligible players have no web_name in players.csv. ` +
      `The runtime join check needs that name to verify the id pairing, so shipping ` +
      `without it would remove the only guard on the join.`
    );
  }

  const out = {
    source: REPO,
    season,
    vendored: new Date().toISOString().slice(0, 10),
    minLiveMinutes: MIN_LIVE_MINUTES,
    rounds,
    matches,
    rows,
    foulsPerMatch: foulsPerMatch == null ? null : Math.round(foulsPerMatch * 100) / 100,
    players,
  };

  const header = `// Auto-generated by scripts/build-core-insights.mjs. DO NOT EDIT BY HAND.
// This season's fouls committed, per player, from ${REPO}
// (used freely with a link back, per its README). Season ${season}, ${rounds} round(s),
// ${matches} match(es), ${eligible} player(s) past ${MIN_LIVE_MINUTES} minutes. Vendored ${out.vendored}.
//
// Fills the half of the risk score the FPL API cannot: yellow cards come from
// the live feed, fouls come from here. The blend rule and the runtime check on
// the id join live in assets/core.js (liveRisk / joinLooksRight). Refresh with:
//   node scripts/build-core-insights.mjs
`;

  const body = `const CORE_INSIGHTS = ${JSON.stringify(out, null, 1)};
if (typeof module !== 'undefined' && module.exports) module.exports = CORE_INSIGHTS;
if (typeof window !== 'undefined') window.CORE_INSIGHTS = CORE_INSIGHTS;
`;

  writeFileSync(join(root, 'data', 'core_insights.js'), header + body, 'utf8');

  console.log('data/core_insights.js written');
  console.log(`  season ${season}: ${rounds} round(s) published, ${matches} match(es), ${rows} player-match rows`);
  console.log(`  ${foulsPerMatch == null ? 'no' : foulsPerMatch.toFixed(1)} fouls per match` +
    (matches >= 30 ? ' (inside the plausible band)' : ' (band not yet checked — under 30 matches)'));
  console.log(`  ${eligible} player(s) past ${MIN_LIVE_MINUTES} minutes and therefore on a live foul rate`);
  if (!eligible) {
    console.log('  nothing is eligible yet, which is correct before ~GW6. The desk stays on');
    console.log('  2025-26 fouls and says so, exactly as it did before this file existed.');
  }
}

main().catch((e) => {
  console.error('build-core-insights: ' + e.message);
  process.exit(1);
});

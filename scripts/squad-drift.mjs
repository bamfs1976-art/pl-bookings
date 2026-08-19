#!/usr/bin/env node
/* Who has moved? The shipped Premier League squads against the live FPL feed.
 *
 * WHY THIS EXISTS. data/pl_data.js carries the player→club mapping the desk
 * prices with, and for the seventeen established clubs that mapping comes from
 * the ScoutingStats harvest — the one leg of the refresh that needs a browser
 * cookie. When the cookie stops working, build_pl_data.py falls back to the
 * previous build BY DESIGN (a partial refresh beats a destroyed dataset), and
 * the refresh then reports success every morning while the squads stand still.
 * A transfer window is exactly when that is most wrong and least visible: the
 * player is priced, his row looks complete, and he is at the wrong club.
 *
 * FPL's bootstrap is the answer, and it is free and keyless. It is also what
 * the desk already trusts for fixtures and live cards, so agreeing with it is
 * not a new dependency, it is internal consistency.
 *
 * REPORTS, DOES NOT FIX. Reads nothing but the feed and the shipped file.
 *
 *   node scripts/squad-drift.mjs            # human-readable
 *   node scripts/squad-drift.mjs --json     # machine-readable
 *
 * Needs the FPL API, so it runs where that is reachable — a GitHub runner, not
 * a dev container behind an egress proxy. Same constraint as
 * data/harvest_history.py, and for the same reason.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');

/* The shipped dataset. */
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'data', 'pl_data.js'), 'utf8'), ctx);
const { CLUBS, PL_PLAYERS } = vm.runInContext('({CLUBS, PL_PLAYERS})', ctx);

/* The name rules the desk itself joins with — not a second set. */
const core = {};
vm.createContext(core);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), core);
const { normName, joinLooksRight } = vm.runInContext('PLDCore', core);

const feed = await (await fetch('https://fantasy.premierleague.com/api/bootstrap-static/')).json();

/* FPL's club names against the dataset's. Matched on the full name, then on
   the short code, then reported — an unmapped club is a rename we must notice,
   not "that club has no players". */
const byShort = new Map(CLUBS.map((c) => [c.short, c]));
const shortOfTeam = new Map();
const unmapped = [];
for (const t of feed.teams) {
  const hit = CLUBS.find((c) => normName(c.name) === normName(t.name))
    || CLUBS.find((c) => normName(c.name).startsWith(normName(t.name)))
    || byShort.get(t.short_name);
  if (hit) shortOfTeam.set(t.id, hit.short);
  else unmapped.push(t.name);
}

const feedPlayers = feed.elements
  .filter((e) => shortOfTeam.has(e.team))
  .map((e) => ({
    name: `${e.first_name} ${e.second_name}`.trim(),
    web: e.web_name,
    club: shortOfTeam.get(e.team),
    key: normName(`${e.first_name} ${e.second_name}`),
  }));

/* Exact normalised name first — it settles the overwhelming majority in one
   lookup — then joinLooksRight for the rest, which is where "Bruno G." against
   "Bruno Guimarães" gets resolved. */
const feedByKey = new Map();
for (const f of feedPlayers) {
  if (!feedByKey.has(f.key)) feedByKey.set(f.key, []);
  feedByKey.get(f.key).push(f);
}
function findInFeed(name) {
  const exact = feedByKey.get(normName(name));
  if (exact && exact.length === 1) return exact[0];
  if (exact && exact.length > 1) return { ...exact[0], ambiguous: true };
  const fuzzy = feedPlayers.filter((f) => joinLooksRight(name, f.name) || joinLooksRight(name, f.web));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) return { ...fuzzy[0], ambiguous: true };
  return null;
}

const moved = [], gone = [], matchedFeed = new Set();
for (const p of PL_PLAYERS) {
  const f = findInFeed(p.n);
  if (!f) { gone.push({ name: p.n, club: p.c, basis: p.b, min: p.min }); continue; }
  matchedFeed.add(f.name + '|' + f.club);
  if (f.club !== p.c) moved.push({ name: p.n, from: p.c, to: f.club, basis: p.b, ambiguous: !!f.ambiguous });
}
const missing = feedPlayers.filter((f) => !matchedFeed.has(f.name + '|' + f.club));

const report = {
  shipped: PL_PLAYERS.length,
  feed: feedPlayers.length,
  unmappedClubs: unmapped,
  moved, gone, missing: missing.map((f) => ({ name: f.name, club: f.club })),
};

if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const byClub = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(r.club || r.to, (m.get(r.club || r.to) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ');
};

console.log(`shipped squads: ${report.shipped} players across ${CLUBS.length} clubs`);
console.log(`FPL feed:       ${report.feed} players across ${shortOfTeam.size} clubs`);
if (unmapped.length) console.log(`CLUBS NOT MAPPED: ${unmapped.join(', ')} — a rename, not an empty squad`);

console.log(`\nAT A DIFFERENT CLUB IN THE FEED: ${moved.length}`);
for (const m of moved) {
  console.log(`  ${m.name.padEnd(28)} shipped ${m.from} -> feed ${m.to}` +
    `  [${m.basis}]${m.ambiguous ? '  (name matched more than one player — check)' : ''}`);
}

console.log(`\nSHIPPED BUT NOT IN THE FEED AT ALL: ${gone.length}` +
  ' — left the league, or a name the join cannot see');
for (const g of gone.slice(0, 40)) {
  console.log(`  ${g.name.padEnd(28)} ${g.club}  [${g.basis}]  ${g.min ?? '—'} min`);
}
if (gone.length > 40) console.log(`  ... and ${gone.length - 40} more`);
if (gone.length) console.log(`  by club: ${byClub(gone)}`);

console.log(`\nIN THE FEED BUT NOT SHIPPED: ${missing.length}` +
  ' — signings and academy call-ups the desk cannot price');
for (const f of missing.slice(0, 40)) console.log(`  ${f.name.padEnd(28)} ${f.club}`);
if (missing.length > 40) console.log(`  ... and ${missing.length - 40} more`);
if (missing.length) console.log(`  by club: ${byClub(missing)}`);

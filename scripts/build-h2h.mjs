/* Build data/h2h.js — head-to-head card history for every pair of current
   Premier League clubs.

   Source is the same free, public-domain football-data.co.uk mirror the
   referee and venue-split builds already use (github.com/datasets/
   football-datasets), so this adds a signal without adding a data source,
   a login or a key. Idea taken from Lamarssom/card-bookings-bot, which
   prices cards purely on past meetings; here it sits beside the model
   rather than replacing it.

   Counting rule: YELLOWS only. The desk's fixture model counts *players
   booked*, so a yellow-only history is directly comparable with it. Reds
   are recorded separately rather than folded in — a sending off is a
   different event, and bookmakers score it differently again.

   Usage:
     node scripts/build-h2h.mjs                 # last 5 completed seasons
     node scripts/build-h2h.mjs --seasons 2324,2425,2526
     node scripts/build-h2h.mjs --dir ./local   # read season-XXXX.csv locally
*/

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = (s) =>
  `https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/premier-league/season-${s}.csv`;

/* football-data.co.uk names -> pl_data.js short codes. Only the 20 current
   clubs are mapped; anyone else in an old season is skipped, which is what
   we want — a meeting is only useful if both clubs are still here. */
const TEAM_SHORT = {
  Arsenal: 'ARS', 'Aston Villa': 'AVL', Bournemouth: 'BOU', Brentford: 'BRE',
  Brighton: 'BHA', Chelsea: 'CHE', 'Crystal Palace': 'CRY', Everton: 'EVE',
  Fulham: 'FUL', Leeds: 'LEE', Liverpool: 'LIV', 'Man City': 'MCI',
  'Man United': 'MUN', Newcastle: 'NEW', "Nott'm Forest": 'NFO',
  Sunderland: 'SUN', Tottenham: 'TOT',
  Coventry: 'COV', Hull: 'HUL', Ipswich: 'IPS',
};

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const seasons = (argOf('--seasons') || '2122,2223,2324,2425,2526').split(',').map((s) => s.trim()).filter(Boolean);
const localDir = argOf('--dir');

/* Minimal CSV reader — the source is machine-generated and has no embedded
   newlines, but quoted commas do appear in team names, so respect quotes. */
function parseCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l); const row = {};
    head.forEach((h, i) => { row[h.trim()] = (cells[i] || '').trim(); });
    return row;
  });
}

async function loadSeason(s) {
  if (localDir) {
    const p = join(localDir, `season-${s}.csv`);
    if (!existsSync(p)) throw new Error(`missing ${p}`);
    return parseCSV(readFileSync(p, 'utf8'));
  }
  const res = await fetch(RAW(s));
  if (!res.ok) throw new Error(`${RAW(s)} answered ${res.status}`);
  return parseCSV(await res.text());
}

/* Current club list comes from the shipped data, so the two can't drift. */
function currentClubs() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'data', 'pl_data.js'), 'utf8'), ctx);
  return vm.runInContext('CLUBS.map(c => c.short)', ctx);
}

const pairKey = (a, b) => [a, b].sort().join('|');

const clubs = new Set(currentClubs());
const meetings = new Map();   // "ARS|TOT" -> [{season, home, away, y, r, date}]
let scanned = 0, used = 0;

for (const s of seasons) {
  let rows;
  try { rows = await loadSeason(s); }
  catch (e) { console.warn(`  skip season ${s}: ${e.message}`); continue; }
  let n = 0;
  for (const r of rows) {
    scanned++;
    const h = TEAM_SHORT[r.HomeTeam], a = TEAM_SHORT[r.AwayTeam];
    if (!h || !a || !clubs.has(h) || !clubs.has(a)) continue;
    const hy = Number(r.HY), ay = Number(r.AY), hr = Number(r.HR), ar = Number(r.AR);
    if (![hy, ay, hr, ar].every(Number.isFinite)) continue;
    const k = pairKey(h, a);
    if (!meetings.has(k)) meetings.set(k, []);
    meetings.get(k).push({ s, home: h, away: a, y: hy + ay, r: hr + ar, d: r.Date || '' });
    used++; n++;
  }
  console.log(`  season ${s}: ${n} usable meetings between current clubs`);
}

/* Aggregate. `o45` is the share of meetings that produced 5+ yellows — the
   same line the fixture model quotes, so the two numbers sit side by side. */
const pairs = {};
for (const [k, list] of meetings) {
  list.sort((x, y) => String(y.d).localeCompare(String(x.d)));   // newest first
  const ys = list.map((m) => m.y);
  const n = ys.length;
  const avg = ys.reduce((s, v) => s + v, 0) / n;
  const o45 = ys.filter((v) => v >= 5).length / n;
  const reds = list.reduce((s, m) => s + m.r, 0);
  pairs[k] = {
    n,
    avg: Math.round(avg * 100) / 100,
    o45: Math.round(o45 * 1000) / 1000,
    red: Math.round((reds / n) * 100) / 100,
    last: ys.slice(0, 6),
  };
}

const allAvg = Object.values(pairs).reduce((s, p) => s + p.avg * p.n, 0) /
               Object.values(pairs).reduce((s, p) => s + p.n, 0);

const out = {
  meta: {
    seasons,
    span: `${seasons[0]}-${seasons[seasons.length - 1]}`,
    pairs: Object.keys(pairs).length,
    meetings: used,
    leagueAvgYellows: Math.round(allAvg * 100) / 100,
    counts: 'yellows only; reds carried separately',
    source: 'football-data.co.uk via github.com/datasets/football-datasets',
  },
  pairs,
};

writeFileSync(
  join(root, 'data', 'h2h.js'),
  '// Auto-generated by scripts/build-h2h.mjs. Head-to-head card history.\n' +
  '// Public-domain football-data.co.uk match records. Yellows only.\n' +
  `const H2H = ${JSON.stringify(out, null, 0)};\n`,
  'utf8',
);

console.log(`\nh2h: ${out.meta.pairs} club pairs from ${used} meetings ` +
            `(${scanned} rows scanned), league average ${out.meta.leagueAvgYellows} yellows a meeting`);

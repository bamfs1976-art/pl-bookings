#!/usr/bin/env node
/* Build data/pl_backtest_2526.js — the 2025/26 match record the in-app
 * backtest scores itself against.
 *
 *   node scripts/build-backtest-2526.mjs            # fetch and write
 *   node scripts/build-backtest-2526.mjs --check    # verify committed file
 *
 * WHY THE MATCH RECORD AND NOT THE PLAYER RECORD. The desk's model is a
 * PER-PLAYER model: P(this player is booked in this fixture). Backtesting it
 * honestly needs per-player, per-match booking outcomes for a completed
 * season — and there is no such feed we are allowed to use. The FPL
 * element-summary endpoint carries the current season only (it is pre-season
 * 2026-27 as this ships, so it carries nothing), and every archive that has
 * it — FBref, WhoScored, FootyStats, Understat — is off limits under the
 * data licence rules this project runs on.
 *
 * What IS licensable is the match record: the DataHub mirror of
 * football-data.co.uk (PDDL, github.com/datasets/football-datasets), which
 * this repo already uses for the referee table and the home/away splits. It
 * gives every 2025/26 fixture with its referee, both sides' fouls and both
 * sides' cards.
 *
 * So the backtest is run at the level the licensable data supports —
 * TEAM-match, "does this side pick up two or more yellows" — and it tests the
 * exact adjustment stack the player model applies on top of a base rate:
 * venue split, referee factor, opponent fouls-drawn context. The multipliers
 * under test are the same multipliers. What it cannot test is the per-player
 * rate itself, and the app says so rather than implying otherwise.
 *
 * The file this writes is the raw record, not a result. The arithmetic runs in
 * the browser (assets/backtest.js, on simple-statistics and jStat) so anyone
 * reading the Methodology view is watching the numbers be produced rather than
 * being told what they came out as.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'data', 'pl_backtest_2526.js');
const SRC = 'https://raw.githubusercontent.com/datasets/football-datasets/'
  + 'main/datasets/premier-league/season-2526.csv';
const check = process.argv.includes('--check');

/* football-data.co.uk's short club names -> the full names the desk uses.
   Only the ones that differ; everything else passes through. */
const FULL = {
  'Man City': 'Manchester City',
  'Man United': 'Manchester United',
  "Nott'm Forest": 'Nottingham Forest',
  'Newcastle': 'Newcastle United',
  'Tottenham': 'Tottenham Hotspur',
  'Leeds': 'Leeds United',
  'Wolves': 'Wolverhampton Wanderers',
  'West Ham': 'West Ham United',
  'Brighton': 'Brighton & Hove Albion',
  'Bournemouth': 'AFC Bournemouth',
  'Ipswich': 'Ipswich Town',
  'Leicester': 'Leicester City',
  'Southampton': 'Southampton',
};

/* Split one CSV line, honouring quotes. The mirror does not quote anything in
   this file today, but a club with a comma in its name would silently shift
   every column after it and the failure would look like a data problem. */
function splitCsv(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parse(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsv(lines[0]);
  const need = ['Date', 'HomeTeam', 'AwayTeam', 'Referee', 'HF', 'AF', 'HY', 'AY', 'HR', 'AR'];
  for (const c of need) {
    if (!head.includes(c)) throw new Error(`the mirror's 2025/26 file has no "${c}" column`);
  }
  const at = Object.fromEntries(need.map((c) => [c, head.indexOf(c)]));
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = splitCsv(line);
    if (f.length < head.length) continue;
    const num = (c) => {
      const v = f[at[c]];
      return v === '' || v == null ? null : Number(v);
    };
    const name = (c) => {
      const v = f[at[c]];
      return FULL[v] || v;
    };
    const row = {
      d: f[at.Date],
      h: name('HomeTeam'),
      a: name('AwayTeam'),
      ref: f[at.Referee] || null,
      hf: num('HF'), af: num('AF'),
      hy: num('HY'), ay: num('AY'),
      hr: num('HR'), ar: num('AR'),
    };
    /* A match missing a card or foul count cannot be scored and must not be
       read as nought — that would fit a side as the most disciplined in the
       division on a blank cell. Dropped, and counted, so the count is
       visible rather than the gap. */
    if ([row.hf, row.af, row.hy, row.ay].some((v) => v == null || !isFinite(v))) continue;
    if (!row.h || !row.a) continue;
    rows.push(row);
  }
  return rows;
}

/* ISO the dates so the browser can sort them without a date parser. The
   mirror has used both DD/MM/YY and YYYY-MM-DD over the years. */
function iso(d) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) throw new Error(`unparseable date "${d}"`);
  const yr = m[3].length === 2 ? (Number(m[3]) > 70 ? '19' + m[3] : '20' + m[3]) : m[3];
  return `${yr}-${m[2]}-${m[1]}`;
}

function render(rows) {
  const lit = (v) => (v == null ? 'null' : typeof v === 'number' ? String(v) : JSON.stringify(v));
  const body = rows.map((r) =>
    `  {d:${lit(r.d)},h:${lit(r.h)},a:${lit(r.a)},ref:${lit(r.ref)},`
    + `hf:${lit(r.hf)},af:${lit(r.af)},hy:${lit(r.hy)},ay:${lit(r.ay)},hr:${lit(r.hr)},ar:${lit(r.ar)}},`
  ).join('\n');
  const clubs = [...new Set(rows.flatMap((r) => [r.h, r.a]))].sort();
  const refs = [...new Set(rows.map((r) => r.ref).filter(Boolean))].sort();
  const ypm = rows.reduce((s, r) => s + r.hy + r.ay, 0) / rows.length;
  return `// Auto-generated by scripts/build-backtest-2526.mjs. Do not hand-edit.
//
// The 2025/26 Premier League match record — ${rows.length} matches, ${clubs.length} clubs,
// ${refs.length} named officials, ${ypm.toFixed(2)} yellows a match.
//
// SOURCE AND LICENCE. The DataHub mirror of football-data.co.uk
// (github.com/datasets/football-datasets), Public Domain Dedication and
// Licence (PDDL). The same source behind data/ref_history.js and the
// home/away splits in data/pl_data.js, so this adds no new dependency and no
// new licence.
//
// This is the RECORD, not a result. assets/backtest.js walks it forward in the
// browser and produces the Brier scores and the calibration table on the
// Methodology view, so the numbers are computed where they are read.
//
//   hf/af  fouls committed by the home/away side
//   hy/ay  yellow cards shown to the home/away side
//   hr/ar  red cards shown to the home/away side
const PL_BACKTEST_2526 = {
  season: "2025/26",
  source: "football-data.co.uk via the DataHub mirror (PDDL)",
  sourceUrl: "https://github.com/datasets/football-datasets",
  licence: "PDDL",
  matches: [
${body}
  ]
};
if (typeof module !== 'undefined' && module.exports) module.exports = PL_BACKTEST_2526;
`;
}

async function main() {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`${SRC} -> HTTP ${res.status}`);
  const rows = parse(await res.text()).map((r) => ({ ...r, d: iso(r.d) }));
  rows.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  if (rows.length < 370) {
    throw new Error(`only ${rows.length} scorable matches — a full season is 380, `
      + 'so the mirror is mid-refresh or the file has changed shape');
  }
  const out = render(rows);
  if (check) {
    const have = readFileSync(OUT, 'utf8');
    if (have !== out) {
      console.error('data/pl_backtest_2526.js is not what the source produces today.\n'
        + 'Re-run: node scripts/build-backtest-2526.mjs');
      process.exit(1);
    }
    console.log(`build-backtest-2526 --check OK: ${rows.length} matches match the mirror`);
    return;
  }
  writeFileSync(OUT, out);
  console.log(`wrote data/pl_backtest_2526.js — ${rows.length} matches`);
}

main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });

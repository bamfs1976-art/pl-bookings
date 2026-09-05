#!/usr/bin/env node
/* Is the per-player model any good? Read the real outcomes and say.
 *
 *     SUPABASE_SERVICE_ROLE_KEY=... node scripts/refit-report.mjs
 *     SUPABASE_SERVICE_ROLE_KEY=... node scripts/refit-report.mjs --min 200
 *
 * WHY THIS EXISTS. The desk prices per player, and that leg has never been
 * scored. The in-page backtest runs at TEAM level because per-player,
 * per-match outcomes for a completed season are not licensable here — and it
 * says so. But `plb_predictions` has been recording this desk's own forecasts
 * against what actually happened since the season started, one row per player
 * per gameweek, `pcard` against `carded`. That is the per-player leg, from a
 * permitted source, accruing a row at a time.
 *
 * WHAT IT DOES NOT DO. It does not fit anything and it does not touch the
 * model. It reads, scores and prints. The refit is a separate, deliberate act
 * — see the November refit section of README.md — and the point of this
 * script is to make that decision on evidence rather than on the date.
 *
 * IT REFUSES TO RUN ON TOO LITTLE. Below --min rows it prints what it has and
 * exits non-zero WITHOUT a verdict. A calibration report on forty rows is a
 * plot of noise that looks exactly like a finding, and the temptation to read
 * one early is the whole reason the floor is a hard stop rather than a note in
 * the output.
 *
 * THE BASELINE IS THE THING TO BEAT. A model is not good because its Brier is
 * small; it is good because its Brier is smaller than predicting the base rate
 * for everybody. That comparison is reported with a paired standard error,
 * because "fit < base" on a few hundred rows is a coin toss dressed as a
 * result — the same rule the team-level backtest runs on.
 *
 * THE KEY IS READ FROM THE ENVIRONMENT AND NEVER PRINTED. It is a service-role
 * credential: it bypasses row-level security and is full read/write on that
 * database. It belongs in a shell or in Actions secrets, never in this repo,
 * never in a page, and never in a paste.
 */
import assert from 'node:assert';

const SUPABASE_URL = (process.env.SUPABASE_URL ||
  'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* The floor. 200 real match rows is the number the README commits to, and it
   is not a statistical threshold so much as an honesty one: below it the
   reliability table has bins holding single figures and every one of them
   swings on one booking. */
const DEFAULT_MIN = 200;

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] != null ? argv[i + 1] : fallback;
};
const MIN_ROWS = Number(argOf('--min', DEFAULT_MIN));
const SEASON = argOf('--season', '');

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

if (!KEY) {
  die('SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
      '\n' +
      'This reads the recorded forecasts and outcomes through PostgREST, which\n' +
      'needs the service-role key. Put it in your shell for a local run, or in\n' +
      'the repository Actions secrets for a scheduled one — never in the repo,\n' +
      'never in a page, and never pasted into a chat. It bypasses row-level\n' +
      'security and is full read/write on that database.\n' +
      '\n' +
      '  SUPABASE_SERVICE_ROLE_KEY=... node scripts/refit-report.mjs');
}

/* ---- reading ------------------------------------------------------------- */

async function fetchAll(table, select) {
  /* PostgREST caps a response; page rather than assume one request is the
     whole table. A silently truncated read would understate the sample and
     could flip the floor check in the flattering direction. */
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    url.searchParams.set('select', select);
    if (SEASON) url.searchParams.set('season', `eq.${SEASON}`);
    const res = await fetch(url, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
        Prefer: 'count=exact',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      die(`${table}: ${res.status} ${res.statusText}\n${body.slice(0, 400)}\n\n` +
          'A 401 here means the key is wrong or expired, NOT that the table is ' +
          'empty. Those are different answers and only one of them is about ' +
          'the model.');
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/* ---- scoring ------------------------------------------------------------- */

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const brier = (p, y) => mean(p.map((x, i) => (x - y[i]) ** 2));

/* Paired difference with a standard error. The pairing matters: both models
   score the SAME rows, so the variance of the difference is what counts, not
   the variance of either score. An unpaired comparison is far too generous. */
function pairedDiff(pA, pB, y) {
  const d = pA.map((_, i) => (pA[i] - y[i]) ** 2 - (pB[i] - y[i]) ** 2);
  const m = mean(d);
  const v = d.length > 1
    ? d.reduce((s, x) => s + (x - m) ** 2, 0) / (d.length - 1) / d.length
    : 0;
  const se = Math.sqrt(v);
  return { mean: m, se, lo: m - 1.96 * se, hi: m + 1.96 * se };
}

function reliability(p, y, bins = 10) {
  const idx = p.map((x, i) => i).sort((a, b) => p[a] - p[b]);
  const per = Math.floor(idx.length / bins);
  const out = [];
  for (let b = 0; b < bins; b++) {
    const slice = idx.slice(b * per, b === bins - 1 ? idx.length : (b + 1) * per);
    if (!slice.length) continue;
    out.push({
      bin: b + 1,
      n: slice.length,
      lo: p[slice[0]],
      hi: p[slice[slice.length - 1]],
      predicted: mean(slice.map((i) => p[i])),
      observed: mean(slice.map((i) => y[i])),
    });
  }
  return out;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/* ---- the report ---------------------------------------------------------- */

const rows = (await fetchAll('plb_predictions', 'season,gw,element,name,club,pcard,carded'))
  /* A row whose gameweek has not finished carries carded = null. That is not a
     player who avoided a booking; it is a result nobody knows yet, and
     counting it as nought would drag every observed rate toward zero and make
     the model look wildly over-confident. */
  .filter((r) => r.carded === 0 || r.carded === 1)
  .filter((r) => typeof r.pcard === 'number' && r.pcard > 0 && r.pcard < 1);

console.log('Per-player refit report');
console.log('='.repeat(64));
console.log(`source   ${SUPABASE_URL}/rest/v1/plb_predictions`);
console.log(`scored   ${rows.length} row(s) with a settled outcome` +
            (SEASON ? `, season ${SEASON}` : ''));

if (!rows.length) {
  die('\nNo settled rows at all. Either no gameweek has been scored yet, or the ' +
      'outcome backfill is not running. Neither is a finding about the model.');
}

/* by gameweek */
const byGw = new Map();
for (const r of rows) {
  const g = byGw.get(r.gw) || { gw: r.gw, n: 0, carded: 0, pred: 0 };
  g.n++; g.carded += r.carded; g.pred += r.pcard;
  byGw.set(r.gw, g);
}
console.log('\nBy gameweek');
console.log(`  ${'gw'.padStart(3)} ${'rows'.padStart(6)} ${'predicted'.padStart(10)} ${'observed'.padStart(9)}`);
for (const g of [...byGw.values()].sort((a, b) => a.gw - b.gw)) {
  console.log(`  ${String(g.gw).padStart(3)} ${String(g.n).padStart(6)} ` +
    `${pct(g.pred / g.n).padStart(10)} ${pct(g.carded / g.n).padStart(9)}`);
}

const p = rows.map((r) => r.pcard);
const y = rows.map((r) => r.carded);
const base = mean(y);
const pBase = p.map(() => base);

console.log('\nOverall');
console.log(`  observed booking rate   ${pct(base)}`);
console.log(`  mean predicted          ${pct(mean(p))}`);
console.log(`  model Brier             ${brier(p, y).toFixed(4)}`);
console.log(`  base-rate Brier         ${brier(pBase, y).toFixed(4)}`);

const d = pairedDiff(p, pBase, y);
console.log(`  difference              ${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(4)} ` +
            `(95% ${d.lo.toFixed(4)} to ${d.hi.toFixed(4)})`);
/* A positive difference means the model's Brier is HIGHER, which is worse. */
const verdict = d.lo > 0 ? 'the base rate is better'
  : d.hi < 0 ? 'the model is better'
  : 'no difference — the interval spans zero';
console.log(`  verdict                 ${verdict}`);

console.log('\nReliability, ten equal-count bins');
console.log(`  ${'bin'.padStart(3)} ${'n'.padStart(5)} ${'range'.padStart(15)} ` +
            `${'predicted'.padStart(10)} ${'observed'.padStart(9)}  gap`);
for (const b of reliability(p, y)) {
  const gap = b.observed - b.predicted;
  console.log(`  ${String(b.bin).padStart(3)} ${String(b.n).padStart(5)} ` +
    `${(pct(b.lo) + '-' + pct(b.hi)).padStart(15)} ` +
    `${pct(b.predicted).padStart(10)} ${pct(b.observed).padStart(9)}  ` +
    `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}pts`);
}

/* Top 20 — the band the desk actually acts on, and the one a Brier score
   hides. Over-confidence here costs more than the summary number says. */
const top = rows.slice().sort((a, b) => b.pcard - a.pcard).slice(0, 20);
if (top.length === 20) {
  console.log('\nTop 20 by forecast');
  console.log(`  predicted ${pct(mean(top.map((r) => r.pcard)))}, ` +
              `observed ${pct(mean(top.map((r) => r.carded)))} ` +
              `(${top.reduce((s, r) => s + r.carded, 0)} of 20 booked)`);
}

/* ---- the floor ----------------------------------------------------------- */
console.log('\n' + '='.repeat(64));
if (rows.length < MIN_ROWS) {
  die(`\nNOT ENOUGH TO CONCLUDE ANYTHING: ${rows.length} scored row(s) against a ` +
      `floor of ${MIN_ROWS}.\n\n` +
      'The figures above are printed so the collection can be watched, and they\n' +
      'are NOT a verdict. A reliability table on this many rows has bins holding\n' +
      'single figures, every one of which swings on one booking, and it will look\n' +
      'exactly like a finding to anyone who wants one. No refit on this.\n\n' +
      `Come back at ${MIN_ROWS} rows, or pass --min to say deliberately that you ` +
      'are reading a smaller sample.');
}
console.log(`\n${rows.length} scored rows, at or above the ${MIN_ROWS}-row floor. ` +
            'The verdict above stands, whichever way it went.');
console.log('This script fits nothing. The refit is a separate, deliberate step.');

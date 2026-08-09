// Which season's FORM the desks should be priced from, decided from the
// fixture files rather than from a workflow default nobody remembers to edit.
//
// THE PROBLEM THIS SOLVES. Every player rate on the three desks — yellows per
// 90, fouls per 90, minutes — comes from an API-Football squad harvest, and
// the workflow pinned that harvest to a season with a hard-coded literal:
//
//     API_FOOTBALL_SEASON: ${{ inputs.season_af || '2025' }}
//
// In August that is exactly right. Nobody has 2026-27 form because nobody has
// played, and a desk priced from an empty season would rate every player at
// the positional mean. In October it is wrong, and wrong in a way no guard
// catches and no page shows: the numbers still look like numbers, they are
// simply last year's. Nothing in the repository would ever have flipped it —
// the transition depended on a human noticing, on a schedule with no reminder.
//
// WHEN TO FLIP. The desks shrink a player's own rate toward the positional
// mean with k = 6 matches (PLDCore.shrinkRate, SHRINK_MATCHES in accas.mjs):
//
//     rate = (events + mean·k) / (matches + k)
//
// At six matches played, a player's own record and the prior carry equal
// weight. Before that the shrinkage is mostly reporting the prior back, and
// last season's completed record is the better estimate of the same quantity.
// After it, the current season is what the shrinkage was designed to consume.
// So the switch is at six rounds — not a round number chosen for being round,
// but the point the smoothing already treats as the balance.
//
// AND NEVER LATER THAN TEN, whatever else changes. FLIP_DEADLINE is a ceiling
// applied to SWITCH_AT rather than a comment beside it, so raising the switch
// later cannot quietly push the flip into November: the ceiling wins.
//
// TWO SIGNALS, WHICHEVER IS FURTHER ON. Status comes from the feed and can go
// stale — a harvest that stops updating `st` would hold the flip back for ever
// while the season played on. The calendar cannot go stale. Taking the later
// of the two means a broken status field delays nothing.
//
// Usage:
//   node scripts/form-season.mjs                 human-readable table
//   node scripts/form-season.mjs --github        key=value lines for $GITHUB_OUTPUT
//   node scripts/form-season.mjs --at <iso>      run against a simulated clock
//
// The workflow uses --github and lets an explicit `season_af` input override
// the answer, so a manual run can still harvest any season by hand.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SWITCH_AT = 6;        // rounds — the shrinkage's own half-weight point
export const FLIP_DEADLINE = 10;   // and never later than this, whatever SWITCH_AT becomes

/* A FUNCTION rather than an inline Math.min, so the ceiling can be exercised
   at values the constants do not currently take. With SWITCH_AT at 6 the
   ceiling never binds, so `Math.min(SWITCH_AT, FLIP_DEADLINE)` and a bare
   `SWITCH_AT` compute the same number today and differ only on the day someone
   raises the switch — which is precisely the day nobody is testing. The guard
   calls this with a switch past the deadline and checks the deadline wins. */
export const flipAt = (switchAt, deadline) => Math.min(switchAt, deadline);
export const FLIP_AT = flipAt(SWITCH_AT, FLIP_DEADLINE);

export const LEAGUES = [
  { code: 'PL', name: 'Premier League', file: 'data/pl_fixtures.js', konst: 'PL_FIXTURES' },
  { code: 'EFLC', name: 'EFL Championship', file: 'data/eflc_fixtures.js', konst: 'EFLC_FIXTURES' },
  { code: 'LL', name: 'La Liga', file: 'data/laliga_fixtures.js', konst: 'LALIGA_FIXTURES' },
];

const FINISHED = new Set(['FT', 'AET', 'PEN']);

function load(file, konst) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, file), 'utf8'), ctx);
  return vm.runInContext(konst, ctx) || [];
}

/* The season a fixture list belongs to, named the way API-Football names one:
   by its starting year. Read off the earliest kick-off rather than declared,
   because the file is regenerated every day and a declared constant is a
   second thing to keep in step. */
function startYear(fixtures) {
  const dates = fixtures.map((f) => f.d).filter(Boolean).sort();
  if (!dates.length) return null;
  const d = new Date(dates[0]);
  if (isNaN(d)) return null;
  /* A European season starting in January would be a different sport; the
     earliest fixture is in the season's opening month, so its calendar year
     IS the start year. */
  return d.getUTCFullYear();
}

export function progressOf(fixtures, now) {
  /* Rounds with at least one finished fixture. "At least one" rather than
     "all", because a single postponement would otherwise stop the count dead
     and hold the flip back for the rest of the season. */
  const played = new Set();
  /* Rounds whose first kick-off is in the past — the calendar's own answer to
     "which gameweek are we in", immune to a stale status field. */
  const elapsed = new Set();
  const firstOf = new Map();
  for (const f of fixtures) {
    if (f.r == null || !f.d) continue;
    const t = new Date(f.d).getTime();
    if (!isFinite(t)) continue;
    if (FINISHED.has(f.st)) played.add(f.r);
    if (!firstOf.has(f.r) || t < firstOf.get(f.r)) firstOf.set(f.r, t);
  }
  for (const [r, t] of firstOf) if (t <= now) elapsed.add(r);
  return { played: played.size, elapsed: elapsed.size };
}

export function decide(now) {
  const out = [];
  for (const L of LEAGUES) {
    let fixtures;
    try { fixtures = load(L.file, L.konst); }
    catch (e) {
      /* No fixture file is not a reason to repoint a harvest. Falling back to
         the completed season keeps today's behaviour, which is the safe half
         of the choice: last season's form is stale, an empty season is blank. */
      out.push({ ...L, error: e.message, played: 0, elapsed: 0, current: null, form: null });
      continue;
    }
    const current = startYear(fixtures);
    const { played, elapsed } = progressOf(fixtures, now);
    const progress = Math.max(played, elapsed);
    const form = current == null ? null : (progress >= FLIP_AT ? current : current - 1);
    out.push({ ...L, played, elapsed, progress, current, form });
  }
  return out;
}

/* Only report when RUN. check-models.mjs imports decide() and LEAGUES to drive
   the transition at real fixture dates, and a module that prints its own table
   on import puts that table in the middle of the guard's output — and, in
   --github mode, would put it on a stdout the workflow appends to
   $GITHUB_OUTPUT. */
const invoked = process.argv[1]
  && new URL('file://' + process.argv[1]).pathname === new URL(import.meta.url).pathname;
if (!invoked) { /* imported: expose the functions, print nothing */ } else {

const atArg = process.argv.indexOf('--at');
const now = atArg > -1 && process.argv[atArg + 1]
  ? new Date(process.argv[atArg + 1]).getTime()
  : Date.now();
if (!isFinite(now)) {
  console.error('--at needs a parseable ISO timestamp');
  process.exit(2);
}

const rows = decide(now);

if (process.argv.includes('--github')) {
  /* ONLY key=value on stdout in this mode: the workflow appends it straight to
     $GITHUB_OUTPUT, and one stray human-readable line there is a parse error
     that fails the step. The summary goes to stderr, where the job log still
     shows it. */
  for (const r of rows) {
    /* A league whose fixtures could not be read gets no key at all rather than
       a guessed one, so the workflow's own `||` fallback takes over and the
       harvest keeps whatever it was doing. */
    if (r.form == null) continue;
    console.log(`form_${r.code.toLowerCase()}=${r.form}`);
  }
  for (const r of rows) {
    console.error(r.error
      ? `${r.name}: ${r.error} — no answer emitted, the workflow default stands`
      : `${r.name}: ${r.progress} round(s) in (${r.played} played, ${r.elapsed} elapsed) ` +
        `· form season ${r.form}-${String((r.form + 1) % 100).padStart(2, '0')}` +
        (r.form === r.current ? ' (current)' : ` · flips at round ${FLIP_AT}`));
  }
} else {
  console.log(`Form season, flipping at round ${FLIP_AT} ` +
    `(switch ${SWITCH_AT}, deadline ${FLIP_DEADLINE})\n`);
  for (const r of rows) {
    if (r.error) { console.log(`${r.name.padEnd(18)} no fixture file (${r.error})`); continue; }
    console.log(
      `${r.name.padEnd(18)} season ${r.current}-${String((r.current + 1) % 100).padStart(2, '0')} · ` +
      `round ${String(r.progress).padStart(2)} of it done ` +
      `(${r.played} played, ${r.elapsed} elapsed) · ` +
      `form from ${r.form}-${String((r.form + 1) % 100).padStart(2, '0')}` +
      (r.form === r.current ? ' (current)' : ' (last completed)')
    );
  }
}

}

#!/usr/bin/env node
/* The app must stay well inside its API-Football allowance, and be able to say so.
 *
 * WHY THIS GUARD EXISTS. The allowance is 7,500 calls a day and the app was
 * using about 360 of them — until eleven endpoints arrived at once. Two things
 * then went wrong that no test could have caught, because neither is a bug in
 * any function:
 *
 *   1. A STEP RAN FOUR TIMES A DAY BECAUSE OF AN `if`. extra-feeds.yml's
 *      expensive step is named "the daily half" and its schedule comment says
 *      "things that change once a day at most", but `inputs.what == ''` is TRUE
 *      on a scheduled run, so it fired on all four crons. Two comments and a
 *      step name all described the intent; the condition was the only thing
 *      that decided, and it disagreed with every one of them.
 *
 *   2. THE UNCAPPED TERM IS THE ONE NOBODY SCHEDULES. live-cards.js is a
 *      browser-facing function on a metered API, and its cost scales with
 *      READERS. Its fan-out branch — one call per live match — is 2,520 calls
 *      on a Saturday against 360 for the cheap one, and which branch runs has
 *      never been verified.
 *
 * So the budget is computed from the workflows and the function themselves
 * (data/api_budget.py) rather than from a number somebody typed, and this
 * asserts the things that model depends on are actually true of the code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

/* ── 1. the budget itself computes, and lands under the ceiling ─────────── */
const run = spawnSync('python3', [join(root, 'data/api_budget.py'), '--json'],
  { encoding: 'utf8' });
ok(run.status === 0,
  `data/api_budget.py exited ${run.status}: ${(run.stderr || '').trim().slice(0, 400)}`);

let budget = null;
if (run.status === 0) {
  try { budget = JSON.parse(run.stdout); }
  catch (e) { problems.push(`api_budget.py --json did not produce JSON: ${e.message}`); }
}

if (budget) {
  const { allowance, ceiling } = budget;
  ok(ceiling < allowance,
    `the ceiling (${ceiling}) must be BELOW the allowance (${allowance}) — a ` +
    'budget that only fails once the quota is already spent has not warned anybody');
  for (const day of ['typical', 'peak']) {
    const d = budget.days[day];
    ok(d && typeof d.total === 'number', `no ${day} day in the budget`);
    ok(d.total <= ceiling,
      `a ${day} day is ${d.total} calls, over the ${ceiling} ceiling`);
    ok(d.total > 0, `a ${day} day computed as ${d.total} calls, which cannot be right`);
  }
  /* The peak day must genuinely cost more than the typical one. If they match,
     the "peak" arm is not varying anything and the headroom claim is hollow. */
  ok(budget.days.peak.total > budget.days.typical.total,
    'the peak day costs no more than a typical one — the model is not varying ' +
    'the thing it says it varies');
  /* AND IT MUST VARY THE RIGHT THINGS. A total that rises because one term
     moved is not a peak day; the expensive per-match walks are driven by
     matches PLAYED and the odds walk by fixtures UPCOMING, so both have to
     grow or the model understates exactly the day it exists to describe. */
  for (const [k, what] of [['played', 'matches played'],
                           ['upcoming', 'fixtures upcoming']]) {
    ok(budget.days.peak.facts[k] > budget.days.typical.facts[k],
      `the peak day has the same ${what} as a typical one ` +
      `(${budget.days.peak.facts[k]}) — the per-match feeds are priced off it, ` +
      'so a flat figure hides their busiest day');
  }

  /* THE LIVE TERM MUST BE IN THE MODEL. It is the largest single line and the
     only one driven by readers rather than by the schedule; a budget that
     quietly dropped it would read as comfortable while being wrong. */
  const live = budget.days.peak.lines.filter((l) => /live-cards/.test(l.job));
  ok(live.length === 2,
    `expected both live-cards branches in the budget, found ${live.length}`);
  ok(live.every((l) => l.alternative),
    'the two live-cards branches must be marked as alternatives — only one of ' +
    'them can run, and summing both overstates the bill');
  for (const l of live) {
    ok(l.per_run > 0 && l.runs > 0 && l.total > 0,
      `the live-cards line "${l.job}" costs ${l.total} calls, which is not a ` +
      'cost. A branch priced at zero drops out of a max() without leaving a ' +
      'gap anybody would notice');
  }
  /* The fan-out is the branch that can actually hurt; it must be modelled as
     the dearer of the two or the max() is measuring the wrong one. */
  const fan = live.find((l) => /NOT inlined/.test(l.job));
  const cheap = live.find((l) => !/NOT inlined/.test(l.job));
  ok(fan.total > cheap.total,
    'the fan-out branch is modelled as no dearer than the inlined one, which ' +
    'is the whole reason it is capped and cached for longer');
}

/* ── 2. the model reads the schedules, it does not keep its own copy ─────── */
const src = read('data/api_budget.py');
ok(/def crons\(/.test(src) && /\.github.*workflows|FLOW/.test(src),
  'api_budget.py must read the crons out of .github/workflows — a budget with ' +
  'its own copy of the schedule is the second copy this whole guard exists to catch');
ok(/def firings\(/.test(src) && /sum\(cron_runs_per_day/.test(src),
  'api_budget.py must count FIRINGS, not cron lines: `5 10-21 * * *` is one ' +
  'line and twelve runs a day');
ok(!/len\(crons\(/.test(src),
  'api_budget.py still counts cron LINES somewhere (len(crons(...))) — that ' +
  'reads an hourly schedule as one run a day');
ok(/live_constants/.test(src) && /live-cards\.js/.test(src),
  'api_budget.py must read TTL and MAX_FIXTURES from live-cards.js rather than ' +
  'restating them');

/* ── 3. the expensive live branch is cached for longer than the cheap one ── */
const fn = read('netlify/functions/live-cards.js');
const ttl = Number((fn.match(/^const TTL = (\d+);/m) || [])[1]);
const fanout = Number((fn.match(/^const FANOUT_TTL = (\d+);/m) || [])[1]);
ok(Number.isFinite(ttl) && Number.isFinite(fanout),
  'live-cards.js must declare both TTL and FANOUT_TTL');
ok(fanout > ttl,
  `FANOUT_TTL (${fanout}) must exceed TTL (${ttl}): the branch that costs one ` +
  'call per live match is the one that must refresh less often');
ok(/const ttl = needEvents\.length \? FANOUT_TTL : TTL;/.test(fn),
  'live-cards.js must choose its TTL from whether it ACTUALLY fanned out, not ' +
  'from an assumption about whether the live payload inlines events');
ok(/max-age=\$\{ttl\}/.test(fn),
  'the Cache-Control must use the chosen ttl — declaring FANOUT_TTL and then ' +
  'serving the fast one is a comment, not a cost control');
ok(/ttl,/.test(fn),
  'the response must report the ttl it was given, so a reader can pace itself');
/* That the header exists at all, that the TTL is in a sane range and that the
   fan-out has a ceiling are check-extra-feeds.mjs's, and are deliberately not
   repeated here: two guards asserting one rule is two places to change it and
   one of them will be forgotten. */

/* ── 4. no page may bypass the edge cache on the metered endpoint ────────── */
for (const page of ['eflc.html', 'laliga.html', 'index.html', 'today.html']) {
  let text;
  try { text = read(page); } catch { continue; }
  /* Find every fetch of the live function and check it does not ask the CDN
     to skip its cache. The edge cache IS the cost control: one upstream
     refresh per TTL however many readers are watching. */
  const calls = text.match(/fetch\(\s*['"][^'"]*live-cards[^'"]*['"][^)]*\)/g) || [];
  for (const c of calls) {
    ok(!/no-store|no-cache|reload/.test(c),
      `${page} asks the live endpoint to skip the cache (${c.trim().slice(0, 70)}...) ` +
      '— that turns one upstream call per minute into one per reader');
  }
}

/* ── 5. both desks poll through the one shared loop ──────────────────────── */
const shared = read('assets/livecards.js');
ok(/function pollLoop\(/.test(shared) && /pollLoop: pollLoop/.test(shared),
  'assets/livecards.js must export pollLoop — the Championship and La Liga ' +
  'desks each had their own copy, and both got the cache mode wrong the same way');
ok(/d\.ttl/.test(shared) && /setTimeout\(tick, ttl \* 1000\)/.test(shared),
  'pollLoop must pace itself from the ttl the function returns; polling faster ' +
  'than the TTL cannot produce newer data, it only spends invocations');
for (const page of ['eflc.html', 'laliga.html']) {
  const text = read(page);
  ok(/LiveCards\.pollLoop\(/.test(text),
    `${page} must poll through LiveCards.pollLoop rather than its own setInterval`);
  ok(!/setInterval\(livePoll/.test(text),
    `${page} still has its own polling interval alongside the shared one`);
}

/* ── 6. the day's real usage is recorded, on every exit path ─────────────── */
const har = read('data/harvest_apifootball.py');
ok(/x-ratelimit-requests-remaining/.test(har),
  'harvest_apifootball.py must read x-ratelimit-requests-remaining — the API ' +
  'reports the exact allowance left on every response, and a model is a poor ' +
  'substitute for being told');
ok(/note_usage\(r\.headers\)/.test(har),
  'the success path must record the allowance headers');
ok(/note_usage\(getattr\(e, "headers", None\)\)/.test(har),
  'the ERROR path must record them too: a 429 is the one moment the number is ' +
  'worth most, and it carries the headers like any other response');
ok(/atexit\.register\(report_usage\)/.test(har),
  'the usage report must be registered at exit, not printed at the end of ' +
  'main(): the run that most needs to say what it spent is the run that died');

/* ── 7. the expensive daily step is pinned to one cron ───────────────────── */
const wf = read('.github/workflows/extra-feeds.yml');
const dailyStep = wf.split('- name:').find((s) => /Standings, team card profiles/.test(s)) || '';
ok(/github\.event\.schedule == '[^']+'/.test(dailyStep),
  "extra-feeds.yml's daily half must name the ONE cron it runs on. `inputs.what " +
  "== ''` is true on every scheduled firing, so without this it runs on all " +
  'four — 572 calls a day to refresh data that changes once');
ok(/github\.event_name != 'schedule'/.test(dailyStep),
  'a manual run must still be able to ask for the daily half explicitly');

/* ── 8. the club registry is fetched once a run, not once per caller ─────── */
const extra = read('data/harvest_extra.py');
ok(/_TEAM_IDS\[\(league\.code, season\)\] = ids/.test(extra)
   && /cached = _TEAM_IDS\.get/.test(extra),
  'af_team_ids must cache: both teamstats and transfers open with it, and a ' +
  'run doing the two spent two identical /teams calls');
/* That the per-fixture walk stays incremental — the 10,496-calls-a-day-by-May
   failure — is check-extra-feeds.mjs section 3c, which proves it by running
   the merge rather than by grepping for a function name. A grep here would
   look like coverage and would survive a rename of the definition alone; it
   was written, it survived exactly that mutation, and it was deleted. */

if (problems.length) {
  console.error('check-api-budget FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const t = budget.days.typical.total, pk = budget.days.peak.total;
console.log(
  `check-api-budget OK: ${t} calls on a typical day and ${pk} at peak against ` +
  `an allowance of ${budget.allowance} (${Math.round(pk / budget.allowance * 100)}%), ` +
  'every schedule read from the workflows themselves, the live ticker\'s ' +
  'expensive branch cached longer than its cheap one and polled through one ' +
  'shared loop, and the true usage recorded from the API on every exit path');

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
 *      on a Saturday against 360 for the cheap one. The probe of 2026-08-30
 *      settled that it takes the CHEAP one — so the observed bill is 360 and
 *      the fan-out is a fallback. Both are still modelled, and the ceiling is
 *      judged on the fallback, because nothing announces the day it changes.
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
    /* THE CEILING IS JUDGED ON THE WORST CASE, not the comfortable number.
       The live feed inlines its events today, which is why the observed total
       is what it is; the day it stops, the fan-out branch runs and nobody
       finds out from a dashboard. The budget has to survive that silently. */
    ok(d.worst_case <= ceiling,
      `a ${day} day would be ${d.worst_case} calls if the live feed stopped ` +
      `inlining events, over the ${ceiling} ceiling — the fallback must fit ` +
      'inside the allowance too, because nothing announces the switch');
    ok(d.worst_case >= d.total,
      'the worst case cannot be cheaper than the observed cost');
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
  /* EXACTLY ONE BRANCH IS THE OBSERVED ONE. Marking both, or neither, means
     the total is being taken from a guess again — and the probe of
     2026-08-30 settled which it is. */
  ok(live.filter((l) => l.observed).length === 1,
    'exactly one live-cards branch must be marked as observed; the probe ' +
    'settled which one runs, and a budget that forgets that is back to ' +
    'quoting a range');
  ok(cheap.observed && !fan.observed,
    'the INLINED branch is the observed one — data/probes/fixtures_live.json, ' +
    '2026-08-30T13:22Z, three live fixtures all carrying a populated events array');
}

/* ── 1b. the script's OWN ceiling is judged on the fallback ──────────────
   Run standalone, api_budget.py exits non-zero when the day is over budget,
   and that exit is what a human sees. It has to fail on the same number this
   guard fails on, or the two disagree — the exact "N copies of one rule" this
   whole file exists to catch. So this checks the BEHAVIOUR rather than
   restating the rule: given a ceiling above the observed cost but below the
   fallback, the script must still refuse. */
if (budget) {
  const observed = budget.days.peak.total;
  const worst = budget.days.peak.worst_case;
  if (worst > observed) {
    const between = Math.floor((observed + worst) / 2);
    const probe = spawnSync('python3',
      [join(root, 'data/api_budget.py'), '--ceiling', String(between)],
      { encoding: 'utf8' });
    ok(probe.status !== 0,
      `api_budget.py accepted a ceiling of ${between}, which is above the ` +
      `observed peak (${observed}) but below the fallback (${worst}). Its own ` +
      'exit must be judged on the branch we are not currently on, because ' +
      'nothing announces the day the feed switches to it');
    const far = worst + 1000;
    const okRun = spawnSync('python3',
      [join(root, 'data/api_budget.py'), '--ceiling', String(far)],
      { encoding: 'utf8' });
    ok(okRun.status === 0,
      `api_budget.py refused a ceiling of ${far}, which is above even the ` +
      'fallback — it is now failing on something other than the budget');
  }
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
const wc = budget.days.peak.worst_case;
console.log(
  `check-api-budget OK: ${t} calls on a typical day and ${pk} at peak (${wc} ` +
  'if the live feed ever stops inlining events) against ' +
  `an allowance of ${budget.allowance} (${Math.round(wc / budget.allowance * 100)}% at worst), ` +
  'every schedule read from the workflows themselves, the live ticker\'s ' +
  'expensive branch cached longer than its cheap one and polled through one ' +
  'shared loop, and the true usage recorded from the API on every exit path');

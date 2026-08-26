// How many fixtures have a referee appointed, and how far ahead of kick-off.
//
// This exists to turn an assumption into a measurement. docs/referee-sourcing.md
// says Premier League and EFL appointments land a few days out and La Liga's
// land the day before, taken from published policy and reporting rather than
// from anything this project observed. Running this on every fixture harvest
// records what actually happens, per league, in the job log.
//
// It is also a canary. The desks price an unappointed fixture at refFactor = 1,
// so "no referees anywhere" and "the referee layer is switched off" look the
// same on the page. Here they do not: a division inside its own publication
// window with zero appointments is called out.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const LEAGUES = [
  // `lead` is the number of days before kick-off by which this competition is
  // expected to have named an official. Used only to decide whether a fixture
  // is inside its window yet — never to invent an appointment.
  { code: 'PL', name: 'Premier League', file: 'data/pl_fixtures.js', konst: 'PL_FIXTURES', lead: 5 },
  { code: 'EFLC', name: 'EFL Championship', file: 'data/eflc_fixtures.js', konst: 'EFLC_FIXTURES', lead: 5 },
  { code: 'LL', name: 'La Liga', file: 'data/laliga_fixtures.js', konst: 'LALIGA_FIXTURES', lead: 1 }
];

/* `--data <dir>` reads the fixture files from somewhere other than the
   repository. Same purpose as `--at` below, and it exists for the same
   reason: the canary's condition is a decision about a FIXTURE SET, and a
   test that exercises it against the shipped files is pinned to whatever the
   leagues happened to have published that morning. That is not hypothetical.
   On 26 August 2026 the guard failed because the EFL had named the officials
   for two rounds rather than one — the harvest working — which put an
   appointed round inside the window the test was aiming at. Never used by the
   workflow, which always reports on the real files. */
const dataArg = process.argv.indexOf('--data');
const dataRoot = dataArg > -1 && process.argv[dataArg + 1]
  ? process.argv[dataArg + 1] : root;

function load(file, konst) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(dataRoot, file), 'utf8'), ctx);
  return vm.runInContext(konst, ctx) || [];
}

/* `--at <iso>` runs the whole report against a simulated clock. It exists so
   the escalation below can be EXERCISED rather than asserted: the three levels
   differ only by how close kick-off is, and without a way to move the clock
   the only test possible is a grep of the source, which is how a threshold
   comes to be checked by the comment above it. Never used in the workflow. */
const atArg = process.argv.indexOf('--at');
const now = atArg > -1 && process.argv[atArg + 1]
  ? new Date(process.argv[atArg + 1]).getTime()
  : Date.now();
if (!isFinite(now)) {
  console.error('--at needs a parseable ISO timestamp');
  process.exit(2);
}
const DAY = 86400000;
const HOUR = 3600000;
let warned = 0;
let urgent = 0;

/* THREE SIGNALS, NOT ONE.
 *
 * The single warning below fired the moment a fixture entered its publication
 * window, which in the week before a season starts is every run of every day
 * for as long as the league takes to name its officials — normal August
 * behaviour, annotated as if something were wrong. A canary that cries for
 * four days running is one nobody reads on the fifth, which is precisely the
 * day it matters.
 *
 * So the volume now tracks the urgency:
 *
 *   notice   inside the publication window and still empty. Expected early;
 *            worth recording, not worth alarming about.
 *   warning  inside 48 hours. The league is now late by its own convention.
 *   error    inside 12 hours. Kick-off is tonight or tomorrow morning and the
 *            desk is about to price the match at a neutral referee — which
 *            for a strict official is the difference between a 3.2 and a 4.4
 *            expected-cards line, invisibly.
 *
 * It never exits non-zero. This runs BETWEEN the harvest and the commit in
 * fixtures.yml: failing here would discard the fixtures the run just fetched,
 * which is a worse outcome than any missing referee. The annotation is the
 * alarm; the job still has to finish its work.
 */
const escalate = (hours) => (hours <= 12 ? 'error' : hours <= 48 ? 'warning' : 'notice');

/* The round a league is about to play, named rather than inferred from a
   fixture count. Before a season starts "552 upcoming" is true and useless:
   the question is whether the twelve matches of the opening weekend have
   officials, and how long is left to get them. */
function nextRound(future) {
  const withRound = future.filter((f) => f.r != null);
  if (!withRound.length) return null;
  const first = withRound.slice().sort((a, b) => new Date(a.d) - new Date(b.d))[0];
  const round = withRound.filter((f) => f.r === first.r);
  const times = round.map((f) => new Date(f.d).getTime()).sort((a, b) => a - b);
  return {
    no: first.r,
    fixtures: round,
    appointed: round.filter((f) => f.ref).length,
    first: times[0],
    last: times[times.length - 1],
  };
}

const day = (t) => new Date(t).toISOString().slice(0, 10);

for (const L of LEAGUES) {
  let fixtures;
  try { fixtures = load(L.file, L.konst); }
  catch (e) { console.log(`${L.name}: no fixture file (${e.message})`); continue; }

  const future = fixtures.filter((f) => f.d && new Date(f.d).getTime() > now);
  /* "Due" means kick-off is inside the window by which this league normally
     publishes. Counting appointments against ALL future fixtures would report
     1% coverage in August and look like a fault; counting against the ones
     actually due is the number that means something. */
  const due = future.filter((f) => new Date(f.d).getTime() - now <= L.lead * DAY);
  const dueWithRef = due.filter((f) => f.ref);
  const anyRef = future.filter((f) => f.ref);

  /* Observed lead time, which is the whole point of the script: how far ahead
     of kick-off we currently know the official. */
  const leads = anyRef
    .map((f) => (new Date(f.d).getTime() - now) / DAY)
    .sort((a, b) => a - b);
  const furthest = leads.length ? leads[leads.length - 1].toFixed(1) : null;

  console.log(
    `${L.name.padEnd(18)} ${String(future.length).padStart(4)} upcoming · ` +
    `${String(anyRef.length).padStart(3)} appointed · ` +
    `due within ${L.lead}d: ${dueWithRef.length}/${due.length}` +
    (furthest ? ` · known up to ${furthest}d ahead` : '')
  );

  /* THE ROUND ABOUT TO BE PLAYED, which is the thing anyone actually wants to
     know the state of. Printed every run, so the days before a season opens
     read as a countdown rather than as a fixture count that does not move. */
  const next = nextRound(future);
  if (next) {
    const hrs = (next.first - now) / HOUR;
    const span = day(next.first) === day(next.last)
      ? day(next.first) : `${day(next.first)} to ${day(next.last)}`;
    console.log(
      `${''.padEnd(18)} round ${String(next.no).padEnd(3)} ${span} · ` +
      `${next.appointed}/${next.fixtures.length} appointed · ` +
      `first kick-off in ${hrs >= 48 ? (hrs / 24).toFixed(1) + 'd' : hrs.toFixed(1) + 'h'}`
    );
  }

  /* The canary. Fixtures are due and none has an official — either the source
     stopped carrying appointments or the harvest is silently failing. Neither
     is visible on the desk, which just prices everything at a neutral referee.

     Graded by how close the SOONEST unappointed kick-off is, not merely by
     whether the window has opened: "twelve matches this weekend, none named"
     four days out is a different fact from the same sentence twelve hours
     out, and they were being reported identically. */
  if (due.length && !dueWithRef.length) {
    const soonest = Math.min(...due.map((f) => new Date(f.d).getTime()));
    const hrs = (soonest - now) / HOUR;
    const level = escalate(hrs);
    console.log(`::${level}::${L.name}: ${due.length} fixture(s) kick off within ` +
      `${L.lead} day(s) and NONE has a referee appointed — the soonest in ` +
      `${hrs < 48 ? hrs.toFixed(1) + ' hours' : (hrs / 24).toFixed(1) + ' days'}. ` +
      (level === 'notice'
        ? 'Expected this far out; recorded so the publication lead time is measured rather than assumed.'
        : 'Either the feed has stopped publishing them or this harvest is ' +
          'failing — the desks will price every one of them at a neutral referee.'));
    if (level === 'error') urgent++; else if (level === 'warning') warned++;
  }
}

console.log(urgent
  ? `\n${urgent} league(s) kicking off within 12 hours with no official named.`
  : warned
    ? `\n${warned} league(s) late by their own publication convention.`
    : '\nAppointment coverage is as expected for the current date.');

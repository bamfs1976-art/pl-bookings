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

function load(file, konst) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, file), 'utf8'), ctx);
  return vm.runInContext(konst, ctx) || [];
}

const now = Date.now();
const DAY = 86400000;
let warned = 0;

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

  /* The canary. Fixtures are due and none has an official — either the source
     stopped carrying appointments or the harvest is silently failing. Neither
     is visible on the desk, which just prices everything at a neutral referee. */
  if (due.length && !dueWithRef.length) {
    console.log(`::warning::${L.name}: ${due.length} fixture(s) kick off within ` +
      `${L.lead} day(s) and NONE has a referee appointed. Either the feed has ` +
      `stopped publishing them or this harvest is failing — the desks will ` +
      `price every one of them at a neutral referee.`);
    warned++;
  }
}

console.log(warned
  ? `\n${warned} league(s) with no appointments inside their publication window.`
  : '\nAppointment coverage is as expected for the current date.');

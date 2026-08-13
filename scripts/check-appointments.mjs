// Guard the published-appointments overlay: article in, card factor out.
//
// data/appointments.json holds referee appointments the competition publishes
// as prose and the fixture feed does not carry (data/ingest_appointments.py
// reads them in; data/appointments.py lays them over the harvested list every
// time it is written). Two things can go wrong, and neither is a syntax error:
//
//   1. THE OVERLAY STOPS BEING APPLIED. A refactor of emit_fixtures, or a
//      fixture list rebuilt for a new season, and the appointments are simply
//      no longer in the file. The page still renders. Every fixture prices at
//      refFactor = 1 — a neutral referee, which looks exactly like no referee.
//      This is the failure scripts/check-referees.mjs was written about after
//      the Premier League desk lost its referee layer for a season.
//
//   2. THE NAME NO LONGER RESOLVES. The desk indexes referees by exact string
//      (`refByName[fx.ref]` in eflc.html) and the card table spells officials
//      two ways — "Tim Robinson" but also "A Herczeg". A rebuild of the ref
//      table that changes spellings breaks the join for every appointment at
//      once, and again nothing errors: the fixture reads "appointed" and
//      prices neutral.
//
// So this asserts the appointments are IN the committed fixture list and that
// what is written there resolves to a card record. A single official with no
// record is normal — a new referee has no history — and is reported, not
// failed. A majority with none is the systemic break above, and fails.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const overlayPath = join(root, 'data', 'appointments.json');

if (!existsSync(overlayPath)) {
  console.log('check-appointments: data/appointments.json not present — skipping.');
  process.exit(0);
}

const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
assert.ok(Array.isArray(overlay.appointments),
  'data/appointments.json has no `appointments` array');

/* Every desk that can carry an overlay: its fixture file and its card table. */
const DESKS = {
  EFLC: { fixtures: 'data/eflc_fixtures.js', global: 'EFLC_FIXTURES', data: 'data/eflc_data.js' },
  PL: { fixtures: 'data/pl_fixtures.js', global: 'PL_FIXTURES', data: 'data/pl_data.js' },
  LL: { fixtures: 'data/laliga_fixtures.js', global: 'LALIGA_FIXTURES', data: 'data/laliga_data.js' },
};

const byLeague = {};
for (const a of overlay.appointments) {
  assert.ok(a.league && a.date && a.h && a.a && a.ref,
    `incomplete appointment: ${JSON.stringify(a)}`);
  assert.ok(DESKS[a.league], `appointment for an unknown desk: ${a.league}`);
  (byLeague[a.league] ||= []).push(a);
}

let checked = 0, missingRecord = [], notApplied = [], changed = [];

for (const [code, appts] of Object.entries(byLeague)) {
  const desk = DESKS[code];
  const fixturesPath = join(root, desk.fixtures);
  const dataPath = join(root, desk.data);
  if (!existsSync(fixturesPath) || !existsSync(dataPath)) {
    console.log(`check-appointments: ${code} data not built yet — skipping that desk.`);
    continue;
  }

  /* Load the same files the page loads, and read the same globals. */
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(dataPath, 'utf8'), ctx);
  vm.runInContext(readFileSync(fixturesPath, 'utf8'), ctx);
  const fixtures = vm.runInContext(desk.global, ctx);
  const refs = vm.runInContext('typeof REFS !== "undefined" ? REFS : []', ctx);
  assert.ok(Array.isArray(fixtures) && fixtures.length,
    `${desk.fixtures} defines no ${desk.global}`);

  /* THE JOIN THE DESK ITSELF MAKES, and it must stay that — the same call,
     not a re-description of it. This guard exists to catch the desk pricing a
     named official at refFactor = 1, so a guard that resolved names more
     generously than refFor() would pass exactly the fixtures the page gets
     wrong. It used to be an exact string lookup on both sides; both are now
     PLDCore.matchRefName. */
  const C = vm.runInContext('PLDCore', ctx);
  const refNames = refs.map((r) => r.n);
  const known = new Set(refNames);
  const resolves = (n) => known.has(n) || C.matchRefName(n, refNames) != null;
  const index = new Map();
  for (const f of fixtures) index.set(`${String(f.d || '').slice(0, 10)}|${f.h}|${f.a}`, f);

  for (const a of appts) {
    checked++;
    const fx = index.get(`${a.date}|${a.h}|${a.a}`);
    if (!fx) {
      /* Not a failure on its own: a postponement removes a fixture, and the
         ingest reports an unmatched appointment when it runs. */
      notApplied.push(`${code} ${a.h} v ${a.a} ${a.date} — no such fixture`);
      continue;
    }
    if (!fx.ref) {
      notApplied.push(`${code} ${a.h} v ${a.a} ${a.date} — appointment not in the fixture file`);
      continue;
    }
    const expected = a.refResolved || a.ref;
    if (fx.ref !== expected) {
      /* The harvested feed wins over the overlay by design, so a difference
         is a changed official, not a bug. Printed so it is seen. */
      changed.push(`${code} ${a.h} v ${a.a}: file has ${fx.ref}, published ${expected}`);
    }
    if (!resolves(fx.ref)) missingRecord.push(`${code} ${fx.ref} (${a.h} v ${a.a})`);
  }
}

for (const line of changed) console.log(`  note: ${line}`);
for (const line of missingRecord) console.log(`  note: no card record for ${line} — prices at the league rate`);

/* THE ASSERTIONS. */
assert.equal(notApplied.length, 0,
  'appointments are not in the committed fixture list, so those fixtures ' +
  'price at a neutral referee:\n  - ' + notApplied.join('\n  - '));

assert.ok(missingRecord.length * 2 <= checked,
  `${missingRecord.length} of ${checked} appointed officials have no card record. ` +
  'One or two is a new referee; this many means the name join is broken — the ' +
  'card table spells officials differently from the overlay, and every one of ' +
  'these fixtures is priced as though no referee had been appointed.');

console.log(`check-appointments: ${checked} appointments applied, ` +
  `${checked - missingRecord.length} priced off a card record.`);

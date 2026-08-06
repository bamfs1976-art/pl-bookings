// Guard the Championship dataset and the page that reads it.
//
// The desk has no build step, so nothing else stands between a bad
// eflc_data.js and a published page of wrong numbers. This asserts the shape
// the page depends on and, more importantly, re-derives the prices the same
// way the page does and checks they are in a range a bookings market could
// actually contain — a model that quietly starts printing 80% is the failure
// that matters, and it is not a syntax error.
//
// Skips cleanly when eflc_data.js has not been generated: it is produced by
// the refresh workflow, and CI on a fresh clone should not fail for its
// absence.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'data', 'eflc_data.js');

if (!existsSync(dataPath)) {
  console.log('check-eflc: data/eflc_data.js not built yet — skipping.');
  process.exit(0);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(dataPath, 'utf8'), ctx);
const { CLUBS, EFLC_PLAYERS, REFS, PLDCore: C } =
  vm.runInContext('({CLUBS, EFLC_PLAYERS, REFS, PLDCore})', ctx);

/* ---- shape ------------------------------------------------------------- */
assert.equal(CLUBS.length, 24, `expected 24 clubs, got ${CLUBS.length}`);
assert.ok(EFLC_PLAYERS.length > 600, `only ${EFLC_PLAYERS.length} players`);
assert.ok(REFS.length >= 15, `only ${REFS.length} referees`);

const shorts = new Set(CLUBS.map((c) => c.short));
const orphan = [...new Set(EFLC_PLAYERS.map((p) => p.c))].filter((c) => !shorts.has(c));
assert.equal(orphan.length, 0, `players at clubs not in CLUBS: ${orphan.join(', ')}`);

/* Every club a real squad. This is the failure this repo has already shipped
   once, in the Premier League desk, as six forwards and no defenders. */
for (const c of CLUBS) {
  const squad = EFLC_PLAYERS.filter((p) => p.c === c.short);
  assert.ok(squad.length >= 15, `${c.short}: only ${squad.length} players`);
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    assert.ok(squad.some((p) => p.p === pos), `${c.short}: no ${pos}`);
  }
}

const dupes = new Set();
const seen = new Set();
for (const p of EFLC_PLAYERS) {
  const k = `${p.c}|${p.n}`;
  if (seen.has(k)) dupes.add(k);
  seen.add(k);
}
assert.equal(dupes.size, 0, `duplicate rows: ${[...dupes].slice(0, 5).join(', ')}`);

/* ---- the prices the page will actually show ---------------------------- */
/* Mirrors eflc.html: shrink the yellow rate toward a positional prior, then
   a hazard model over a full match. If these drift apart the page is lying,
   so the duplication here is deliberate and its whole purpose. */
const SHRINK_MATCHES = 6;
const acc = {};
for (const p of EFLC_PLAYERS) {
  const m = Number(p.min) || 0;
  if (!(m > 0) || p.y == null) continue;
  const a = (acc[p.p] ||= { w: 0, m: 0 });
  a.w += p.y * m;
  a.m += m;
}
const prior = (pos) => (acc[pos] && acc[pos].m ? acc[pos].w / acc[pos].m : 0.15);

const probs = [];
for (const p of EFLC_PLAYERS) {
  const m = Number(p.min) || 0;
  if (!(m > 0) || p.yc == null) continue;
  const y = C.shrinkRate(p.yc, m, prior(p.p), SHRINK_MATCHES);
  const prob = C.pCardFromLambda(C.cardLambda(y, 90, {}));
  assert.ok(prob > 0 && prob < 1, `${p.n}: impossible probability ${prob}`);
  probs.push(prob);
}
probs.sort((a, b) => b - a);
const max = probs[0];
const median = probs[Math.floor(probs.length / 2)];

/* A player is not more likely than not to be booked in a single match. The
   most-carded player in a league sits around 40%; anything past 60 means the
   model has come off its calibration, which is exactly what happened when
   this page priced off the foul-heavy risk score instead of the card rate. */
assert.ok(max < 0.6, `top P(card) is ${(max * 100).toFixed(1)}% — model off its leash`);
assert.ok(max > 0.25, `top P(card) is only ${(max * 100).toFixed(1)}% — model too flat`);
assert.ok(median > 0.05 && median < 0.35,
  `median P(card) is ${(median * 100).toFixed(1)}% — implausible for a league`);

/* ---- the page reads what the data provides ----------------------------- */
const page = readFileSync(join(root, 'eflc.html'), 'utf8');
for (const need of ['data/eflc_data.js', 'assets/core.js', 'EFLC_PLAYERS', 'cardLambda', 'shrinkRate']) {
  assert.ok(page.includes(need), `eflc.html no longer references ${need}`);
}
/* Storage keys, read off the constants rather than by searching the file for
   a substring — the first version of this check failed on a COMMENT in
   eflc.html explaining why the key is not shared. */
const keys = [...page.matchAll(/KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
assert.ok(keys.length >= 2, `expected localStorage key constants, found ${keys.length}`);
for (const k of keys) {
  assert.ok(k.startsWith('eflc_'),
    `localStorage key ${k} is not eflc-scoped — the two desks would share state ` +
    'across players who are different people with the same names');
}

const rated = CLUBS.filter((c) => c.ca != null).length;
console.log(
  `check-eflc OK: ${CLUBS.length} clubs, ${EFLC_PLAYERS.length} players, ` +
  `${REFS.length} refs, ${rated} clubs with a measured card rate; ` +
  `P(card) max ${(max * 100).toFixed(1)}%, median ${(median * 100).toFixed(1)}%`
);

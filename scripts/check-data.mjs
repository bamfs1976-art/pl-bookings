// CI guard: the dataset ships as data/pl_data.js (loaded by index.html via
// <script src>), never as inline consts. Asserts the generated file parses
// with sane counts and that index.html has not regrown an inline copy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataSrc = readFileSync(join(root, 'data', 'pl_data.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(dataSrc + '\n;({CLUBS, PL_PLAYERS, REFS})', ctx);
const { CLUBS, PL_PLAYERS, REFS } = vm.runInContext('({CLUBS, PL_PLAYERS, REFS})', ctx);

assert.ok(Array.isArray(PL_PLAYERS) && PL_PLAYERS.length >= 400,
  `expected >=400 players in data/pl_data.js, got ${PL_PLAYERS && PL_PLAYERS.length}`);
assert.equal(CLUBS.length, 20, `expected 20 clubs, got ${CLUBS.length}`);
assert.ok(Array.isArray(REFS) && REFS.length >= 10,
  `expected >=10 referees, got ${REFS && REFS.length}`);
const efl = PL_PLAYERS.filter((p) => p.b === 'EFL').length;
assert.ok(efl >= 1, `expected at least one promoted-club (EFL) row, got ${efl}`);

// No duplicate (club, name) rows — a repeated player in a prediction product
// reads as a data bug and erodes trust. The generator de-dupes; this guards
// the shipped file against a regression.
const keyCounts = new Map();
for (const p of PL_PLAYERS) {
  const k = `${p.c}|${p.n}`;
  keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
}
const dups = [...keyCounts.entries()].filter(([, n]) => n > 1);
assert.equal(dups.length, 0,
  `duplicate player rows in data/pl_data.js: ${dups.map(([k, n]) => `${k} ×${n}`).join(', ')}`);

// Schema: every player carries the fouls-won slot (fw), null until a harvest
// with the fouls-drawn field populates it. Guards generator/data drift.
const missingFw = PL_PLAYERS.filter((p) => !('fw' in p)).length;
assert.equal(missingFw, 0, `${missingFw} player rows missing the fw (fouls won) field`);

// Each of the three promoted clubs must be flagged EFL (clearly separated
// from the 17 Premier League clubs in the shipped data).
for (const short of ['COV', 'HUL', 'IPS']) {
  const club = CLUBS.find((c) => c.short === short);
  assert.ok(club && club.basis === 'EFL', `promoted club ${short} must be flagged EFL`);
}

const histSrc = readFileSync(join(root, 'data', 'ref_history.js'), 'utf8');
const hctx = {};
vm.createContext(hctx);
vm.runInContext(histSrc, hctx);
const REF_HISTORY = vm.runInContext('REF_HISTORY', hctx);
assert.equal(REF_HISTORY.seasons.length, 26,
  `expected 26 historical seasons (1992/93-2017/18), got ${REF_HISTORY.seasons.length}`);
assert.ok(REF_HISTORY.refs.length >= 40,
  `expected >=40 historical referees, got ${REF_HISTORY.refs.length}`);

const html = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(!/const\s+PL_PLAYERS\s*=\s*\[/.test(html),
  'index.html contains an inline PL_PLAYERS literal — the dataset must ship only in data/pl_data.js');
assert.ok(/<script\s+src="data\/pl_data\.js"><\/script>/.test(html),
  'index.html no longer loads data/pl_data.js');
assert.ok(/<script\s+src="data\/ref_history\.js"><\/script>/.test(html),
  'index.html no longer loads data/ref_history.js');

console.log(`data guard OK: ${PL_PLAYERS.length} players (${efl} EFL), ${CLUBS.length} clubs, ${REFS.length} refs, ` +
  `${REF_HISTORY.refs.length} historical refs over ${REF_HISTORY.seasons.length} seasons, no inline dataset`);

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

assert.ok(Array.isArray(PL_PLAYERS) && PL_PLAYERS.length >= 500,
  `expected >=500 players in data/pl_data.js, got ${PL_PLAYERS && PL_PLAYERS.length}`);
assert.equal(CLUBS.length, 20, `expected 20 clubs, got ${CLUBS.length}`);
assert.ok(Array.isArray(REFS) && REFS.length >= 10,
  `expected >=10 referees, got ${REFS && REFS.length}`);
const efl = PL_PLAYERS.filter((p) => p.b === 'EFL').length;
assert.ok(efl >= 50, `expected >=50 promoted-club (EFL) rows, got ${efl}`);

const html = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(!/const\s+PL_PLAYERS\s*=\s*\[/.test(html),
  'index.html contains an inline PL_PLAYERS literal — the dataset must ship only in data/pl_data.js');
assert.ok(/<script\s+src="data\/pl_data\.js"><\/script>/.test(html),
  'index.html no longer loads data/pl_data.js');

console.log(`data guard OK: ${PL_PLAYERS.length} players (${efl} EFL), ${CLUBS.length} clubs, ${REFS.length} refs, no inline dataset`);

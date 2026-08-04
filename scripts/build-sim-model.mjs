// Vendors Plsimulator's model bundle into data/sim_model.js.
//
// Plsimulator fits the match model weekly (tools/weekly_update.py) and
// publishes the result as one machine-readable bundle, CORS-open, at
// https://plsimulation.netlify.app/model.json. This script takes the parts
// the desk needs — the Dixon-Coles constants and the per-team attack /
// defence / home-advantage / Elo ratings — rekeys the teams from the
// simulator's club names to the desk's short codes, and writes a generated
// data/sim_model.js alongside the other baked data files.
//
//   node scripts/build-sim-model.mjs                      # published bundle
//   node scripts/build-sim-model.mjs --from ../Plsimulator/model.json
//   node scripts/build-sim-model.mjs --from https://.../model.json
//
// Why vendor rather than fetch at runtime: every other dataset here is a
// generated, committed .js loaded by a <script src>, the service worker
// precaches that shape so the app opens offline, and a runtime fetch would
// put a second origin on the critical path for a file that only changes
// once a week. The version and fetch date are recorded in the output so a
// stale bundle is visible rather than silent.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED = 'https://plsimulation.netlify.app/model.json';

const argv = process.argv.slice(2);
const fromArg = (() => {
  const i = argv.indexOf('--from');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
})();

/* The simulator names clubs in full; the desk keys everything by short
   code. Most names match a club's `name` in data/pl_data.js exactly — these
   are the ones that don't. Kept as a table rather than fuzzy-matched: a
   near-miss that silently resolves to the wrong club would misprice a whole
   fixture, and a near-miss that resolves to nothing is caught below. */
const NAME_ALIASES = {
  'Bournemouth': 'AFC Bournemouth',
  'Brighton': 'Brighton & Hove Albion',
  'Wolves': 'Wolverhampton Wanderers',
  'Spurs': 'Tottenham Hotspur',
  'West Ham': 'West Ham United',
  'Leicester': 'Leicester City',
  'Norwich': 'Norwich City',
  'Sheffield United': 'Sheffield Utd',
};

function loadClubs() {
  const src = readFileSync(join(root, 'data', 'pl_data.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const clubs = vm.runInContext('CLUBS', ctx);
  if (!Array.isArray(clubs) || !clubs.length) {
    throw new Error('data/pl_data.js did not yield a CLUBS array');
  }
  return clubs;
}

async function loadBundle(from) {
  const src = from || PUBLISHED;
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${src} returned HTTP ${res.status}`);
    return { json: await res.json(), source: src };
  }
  const path = resolve(root, src);
  return { json: JSON.parse(readFileSync(path, 'utf8')), source: src };
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(Number(n) * f) / f;
}

const bundle = await loadBundle(fromArg).catch((err) => {
  console.error(`\nCould not read the model bundle: ${err.message}`);
  console.error(`Pass a local copy with --from ../Plsimulator/model.json if the ` +
    `published bundle is unreachable.\n`);
  process.exit(1);
});

const { json, source } = bundle;
const teamsIn = json && json.teams;
if (!teamsIn || typeof teamsIn !== 'object') {
  throw new Error('bundle has no `teams` object — is this Plsimulator\'s model.json?');
}
const constIn = (json && json.constants) || {};
for (const k of ['BASE_H', 'BASE_A', 'DC_RHO']) {
  if (typeof constIn[k] !== 'number' || !isFinite(constIn[k])) {
    throw new Error(`bundle constant ${k} is missing or not a number`);
  }
}

// Name -> short, including the aliases above.
const CLUBS = loadClubs();
const byName = new Map(CLUBS.map((c) => [c.name, c.short]));
const shortFor = (simName) => byName.get(NAME_ALIASES[simName] || simName) || byName.get(simName) || null;

const teams = {};
const unmapped = [];
for (const [name, t] of Object.entries(teamsIn)) {
  const short = shortFor(name);
  if (!short) { unmapped.push(name); continue; }
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const attack = num(t.attack), defence = num(t.defence);
  if (attack == null || defence == null || !(attack > 0) || !(defence > 0)) {
    unmapped.push(`${name} (unusable ratings)`);
    continue;
  }
  teams[short] = {
    attack: round(attack, 4),
    defence: round(defence, 4),
    home: t.home == null ? 1 : round(num(t.home) || 1, 4),
    elo: t.elo == null ? null : round(num(t.elo), 1),
  };
}

// A club in the desk's list that the simulator does not rate is the case
// that matters: its fixtures get no game-state factor at all, which is
// correct but worth naming, because the usual cause is a promoted club the
// simulator has not fitted yet.
const rated = new Set(Object.keys(teams));
const unrated = CLUBS.filter((c) => !rated.has(c.short)).map((c) => `${c.short} ${c.name}`);

const out = {
  version: String(json.version || 'unknown'),
  source: /^https?:\/\//.test(source) ? source : PUBLISHED,
  vendored: new Date().toISOString().slice(0, 10),
  constants: {
    BASE_H: constIn.BASE_H,
    BASE_A: constIn.BASE_A,
    DC_RHO: constIn.DC_RHO,
  },
  meta: {
    seasons: (json.meta && json.meta.seasons) || null,
    matches: (json.meta && json.meta.matches) || null,
    season: (json.season_state && json.season_state.season) || null,
    updated: (json.season_state && json.season_state.updated) || null,
  },
  teams,
};

const header = `// Auto-generated by scripts/build-sim-model.mjs. DO NOT EDIT BY HAND.
// Plsimulator's fitted match model, rekeyed to the desk's club short codes.
// Bundle version ${out.version} from ${out.source}, vendored ${out.vendored}.
// Feeds the game-state (chase) factor and the fitted closeness signal — the
// arithmetic that turns these ratings into win probabilities lives in
// assets/core.js (simFixture). Refresh with:
//   node scripts/build-sim-model.mjs --from ../Plsimulator/model.json
`;

const body = `const SIM_MODEL = ${JSON.stringify(out, null, 2)};
if (typeof module !== 'undefined' && module.exports) module.exports = SIM_MODEL;
if (typeof window !== 'undefined') window.SIM_MODEL = SIM_MODEL;
`;

writeFileSync(join(root, 'data', 'sim_model.js'), header + body, 'utf8');

console.log(`data/sim_model.js written`);
console.log(`  bundle version ${out.version} (${out.meta.matches || '?'} matches, seasons ${(out.meta.seasons || []).join(', ') || '?'})`);
console.log(`  ${Object.keys(teams).length} of ${CLUBS.length} clubs rated`);
if (unmapped.length) console.log(`  skipped (not in the desk's club list): ${unmapped.join(', ')}`);
if (unrated.length) {
  console.log(`  NOT RATED by the simulator — these fixtures get no game-state factor:`);
  unrated.forEach((c) => console.log(`    ${c}`));
}

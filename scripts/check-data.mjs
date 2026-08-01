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

// Tightened 2026-08-01. The old ">=400 players, >=1 EFL row" was loose enough
// to hide a real hole. Note the "528 players / 72 EFL" figure in AUDIT.md was
// never real: those 72 rows were 6 unique forwards repeated 12x each, and the
// de-dup in 6ffde1e correctly collapsed them to 6. So the promoted clubs have
// never had a defender or midfielder in this dataset — a count assert alone
// can't see that, which is why the per-club and per-position floors below are
// the load-bearing ones.
assert.ok(Array.isArray(PL_PLAYERS) && PL_PLAYERS.length >= 450,
  `expected >=450 players in data/pl_data.js, got ${PL_PLAYERS && PL_PLAYERS.length} — re-run the harvest (data/harvest.py + build_pl_data.py)`);
assert.equal(CLUBS.length, 20, `expected 20 clubs, got ${CLUBS.length}`);
assert.ok(Array.isArray(REFS) && REFS.length >= 10,
  `expected >=10 referees, got ${REFS && REFS.length}`);
const efl = PL_PLAYERS.filter((p) => p.b === 'EFL').length;
assert.ok(efl >= 40,
  `expected >=40 promoted-club (EFL) player rows, got ${efl} — the Championship harvest has not landed`);

// The one that actually bites: a squad can only go missing club by club, and
// a club with a handful of rows is worse than useless in a risk table — it
// silently under-rates exactly the defenders and holding midfielders the
// promoted sides are picked for.
const squads = new Map();
for (const p of PL_PLAYERS) squads.set(p.c, (squads.get(p.c) || 0) + 1);
const thin = [...squads.entries()].filter(([, n]) => n < 15).sort((a, b) => a[1] - b[1]);
assert.equal(thin.length, 0,
  `clubs with under 15 players in data/pl_data.js: ${thin.map(([c, n]) => `${c} (${n})`).join(', ')} — ` +
  `the harvest is incomplete; every club needs a full squad before this ships`);
const missingClub = CLUBS.filter((c) => !squads.has(c.short)).map((c) => c.short);
assert.equal(missingClub.length, 0,
  `clubs with no players at all: ${missingClub.join(', ')}`);

// A squad of only forwards is a harvest that half-failed. Bookings come from
// defenders and holding midfielders, so a club with no DF/MF row is actively
// misleading in a card-risk table, not merely incomplete.
const shapeless = [];
for (const c of CLUBS) {
  const squad = PL_PLAYERS.filter((p) => p.c === c.short);
  if (!squad.length) continue;
  const positions = new Set(squad.map((p) => p.p));
  if (!positions.has('DF') || !positions.has('MF')) {
    shapeless.push(`${c.short} (${[...positions].join('/') || 'none'})`);
  }
}
assert.equal(shapeless.length, 0,
  `clubs with no defenders or midfielders: ${shapeless.join(', ')} — ` +
  `a forwards-only squad under-rates exactly the players who collect cards`);

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
// The history starts at the 26-season epldata baseline and GROWS as
// data/extend_ref_history.py merges finished seasons, so assert a floor and
// the invariants rather than an exact count.
assert.ok(REF_HISTORY.seasons.length >= 26,
  `expected >=26 historical seasons (the 1992/93-2017/18 baseline), got ${REF_HISTORY.seasons.length}`);
assert.ok(REF_HISTORY.refs.length >= 40,
  `expected >=40 historical referees, got ${REF_HISTORY.refs.length}`);
// Spread into host arrays and compare as strings: the objects come from a vm
// realm, so deepStrictEqual would trip on prototype identity, not content.
const histLabels = [...REF_HISTORY.seasons].map((s) => s.s);
assert.equal(new Set(histLabels).size, histLabels.length,
  'duplicate season in ref_history.js — the extend script should replace, not append');
assert.equal(histLabels.join('|'), [...histLabels].sort().join('|'),
  'ref_history.js seasons are not in chronological order');
assert.equal(histLabels[0], '1992/93',
  `history should still start at the 1992/93 baseline, got ${histLabels[0]}`);
assert.ok(REF_HISTORY.seasons.every((s) => s.ypg > 0 && s.g > 0),
  'a historical season has a non-positive cautions-per-game or game count');
assert.ok(REF_HISTORY.span.endsWith(histLabels[histLabels.length - 1]),
  `span "${REF_HISTORY.span}" does not match the last season ${histLabels[histLabels.length - 1]}`);

// Card/fouls model (scripts/build-model.mjs). Assert the shape the app depends on.
const mctx = {};
vm.createContext(mctx);
vm.runInContext(readFileSync(join(root, 'data', 'model.js'), 'utf8'), mctx);
const MODEL = vm.runInContext('CARD_MODEL', mctx);
assert.ok(MODEL && MODEL.glm && MODEL.glm.weights && MODEL.glm.intercept != null,
  'data/model.js missing a glm {intercept, weights}');
for (const key of ['yc90', 'foul90']) assert.ok(Number.isFinite(MODEL.glm.weights[key]), `model glm weight ${key} not finite`);
assert.ok(MODEL.shrink && MODEL.shrink.strengthMatches > 0 && MODEL.shrink.ycMean && MODEL.shrink.foulMean,
  'data/model.js missing shrinkage priors');
assert.ok(MODEL.twoStage && MODEL.twoStage.baseHazard > 0, 'data/model.js missing twoStage.baseHazard');
assert.ok(MODEL.nbFouls && MODEL.nbFouls.dispersion > 0, 'data/model.js missing nbFouls.dispersion');
assert.ok(MODEL.baseRate > 0.05 && MODEL.baseRate < 0.4, `model baseRate ${MODEL.baseRate} implausible`);

const html = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(!/const\s+PL_PLAYERS\s*=\s*\[/.test(html),
  'index.html contains an inline PL_PLAYERS literal — the dataset must ship only in data/pl_data.js');
assert.ok(/<script\s+src="data\/pl_data\.js"><\/script>/.test(html),
  'index.html no longer loads data/pl_data.js');
assert.ok(/<script\s+src="data\/ref_history\.js"><\/script>/.test(html),
  'index.html no longer loads data/ref_history.js');
assert.ok(/<script\s+src="data\/model\.js"><\/script>/.test(html),
  'index.html no longer loads data/model.js');

console.log(`data guard OK: ${PL_PLAYERS.length} players (${efl} EFL), ${CLUBS.length} clubs, ${REFS.length} refs, ` +
  `${REF_HISTORY.refs.length} historical refs over ${REF_HISTORY.seasons.length} seasons, no inline dataset`);

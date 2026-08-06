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
// Promoted-club coverage is counted by CLUB, not by basis. The old assert here
// wanted 40 EFL rows, which could only ever be met by a Championship harvest
// that returns full squads — and it doesn't; it returns whoever cleared its
// minutes floor, which was six forwards. The squads are now filled from the
// free FPL feed with the rates left null (basis NEW), so what matters is that
// the three clubs have real squads, whatever each row's form came from.
const PROMOTED = ['COV', 'HUL', 'IPS'];
const efl = PL_PLAYERS.filter((p) => p.b === 'EFL').length;
const promotedRows = PL_PLAYERS.filter((p) => PROMOTED.includes(p.c)).length;
assert.ok(promotedRows >= 60,
  `expected >=60 promoted-club player rows across ${PROMOTED.join('/')}, got ${promotedRows} — ` +
  `run data/harvest_fpl_squads.py, then rebuild with data/build_pl_data.py`);

// The basis vocabulary is closed. A fourth value would silently render as no
// chip at all, which is how a player with no form comes to look like one with
// average form.
const BASES = new Set(['PL', 'EFL', 'NEW']);
const oddBasis = [...new Set(PL_PLAYERS.map((p) => p.b))].filter((b) => !BASES.has(b));
assert.equal(oddBasis.length, 0,
  `unknown player basis values: ${oddBasis.join(', ')} — expected one of ${[...BASES].join(', ')}`);

// The load-bearing one. NEW means "no card record yet", so its rates must be
// null and never zero: a zero yellow rate would rank a player the calmest
// defender in the division and put him top of every "safe" screen, which is a
// worse error than leaving him out was.
const fakedNew = PL_PLAYERS.filter((p) => p.b === 'NEW' &&
  (p.y != null || p.f != null || p.r != null || p.yc != null));
assert.equal(fakedNew.length, 0,
  `${fakedNew.length} NEW rows carry a rate instead of null (e.g. ${fakedNew.slice(0, 3).map((p) => `${p.c} ${p.n}`).join(', ')}) — ` +
  `a fabricated zero rates a player who has never played as the calmest in the league`);

// And NEW only exists because the promoted clubs have no other source. A NEW
// row at an established club means a harvest fell through to the wrong feed.
const strayNew = PL_PLAYERS.filter((p) => p.b === 'NEW' && !PROMOTED.includes(p.c));
assert.equal(strayNew.length, 0,
  `NEW-basis rows outside the promoted clubs: ${[...new Set(strayNew.map((p) => p.c))].join(', ')}`);

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

// A club's `img` is its BADGE. Three harvesters feed this one field and two
// of them once filled it with the player's face, so Coventry, Hull and Ipswich
// shipped a squad member's headshot as the club crest — visible on the live
// page, invisible to every other check here. Nothing about a photo URL is
// malformed; it is just the wrong picture, which is why it needs saying out
// loud rather than being caught by a shape assertion.
const faces = CLUBS.filter((c) => c.img && /\/(players|photos)\//.test(c.img))
  .map((c) => `${c.short} -> ${c.img}`);
assert.equal(faces.length, 0,
  `clubs whose crest is a player photo, not a badge:\n  ${faces.join('\n  ')}`);

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
// from the 17 Premier League clubs in the shipped data). At CLUB level EFL
// means "not on Premier League data", which stays true once most of the squad
// is NEW — the club aggregate is withheld either way, and the EFL/NEW
// distinction lives on the player row where it changes what to believe.
for (const short of PROMOTED) {
  const club = CLUBS.find((c) => c.short === short);
  assert.ok(club && club.basis === 'EFL', `promoted club ${short} must be flagged EFL`);
  assert.equal(club.ca, null, `promoted club ${short} must not ship a team cards-against rate`);
  assert.equal(club.fm, null, `promoted club ${short} must not ship a team fouls-per-match rate`);
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

// Head-to-head card history (scripts/build-h2h.mjs). Public-domain match
// records, so the shape is guaranteed; assert it stays sane and that the
// counting rule has not silently changed from yellows to all cards.
const h2hCtx = {};
vm.createContext(h2hCtx);
vm.runInContext(readFileSync(join(root, 'data', 'h2h.js'), 'utf8'), h2hCtx);
const H2H = vm.runInContext('H2H', h2hCtx);
assert.ok(H2H && H2H.pairs && H2H.meta, 'data/h2h.js missing {meta, pairs}');
assert.ok(H2H.meta.meetings >= 500,
  `expected >=500 head-to-head meetings, got ${H2H.meta.meetings}`);
assert.ok(H2H.meta.pairs >= 100,
  `expected >=100 club pairs with history, got ${H2H.meta.pairs}`);
// A yellows-only average lands near 4 a game. If this drifts past 6 the
// build has started counting reds, or booking points, into the same field.
assert.ok(H2H.meta.leagueAvgYellows > 2.5 && H2H.meta.leagueAvgYellows < 6,
  `h2h league average ${H2H.meta.leagueAvgYellows} implausible for yellows-only counting`);
for (const [k, p] of Object.entries(H2H.pairs)) {
  assert.ok(p.n > 0 && p.avg >= 0 && p.o45 >= 0 && p.o45 <= 1, `h2h pair ${k} has impossible values`);
  const [x, y] = k.split('|');
  assert.ok(x < y, `h2h pair key ${k} is not in sorted order — lookups will miss`);
}

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

// The match model (scripts/build-sim-model.mjs), vendored from Plsimulator.
// The desk degrades cleanly without it, so nothing here is fatal-by-absence —
// but a file that IS present and wrong would quietly misprice the game-state
// factor on every fixture, so what ships is checked hard.
const sctx = {};
vm.createContext(sctx);
vm.runInContext(readFileSync(join(root, 'data', 'sim_model.js'), 'utf8'), sctx);
const SIM_MODEL = vm.runInContext('SIM_MODEL', sctx);
assert.ok(SIM_MODEL && SIM_MODEL.teams && SIM_MODEL.constants,
  'data/sim_model.js missing teams/constants — re-run scripts/build-sim-model.mjs');
for (const key of ['BASE_H', 'BASE_A', 'DC_RHO']) {
  assert.ok(Number.isFinite(SIM_MODEL.constants[key]), `sim model constant ${key} not finite`);
}
assert.ok(SIM_MODEL.constants.DC_RHO < 0 && SIM_MODEL.constants.DC_RHO > -0.5,
  `sim model DC_RHO ${SIM_MODEL.constants.DC_RHO} outside the plausible fitted range`);
// Every club the desk lists must be rated, or that club's fixtures silently
// lose the game-state factor. The usual cause is a rename on either side —
// which is exactly the failure the short-code rekey exists to catch early.
const simRated = new Set(Object.keys(SIM_MODEL.teams));
const simMissing = CLUBS.filter((c) => !simRated.has(c.short)).map((c) => c.short);
assert.equal(simMissing.length, 0,
  `clubs unrated by the match model: ${simMissing.join(', ')} — re-run scripts/build-sim-model.mjs ` +
  `(a club renamed on either side needs an entry in its NAME_ALIASES table)`);
for (const [code, t] of Object.entries(SIM_MODEL.teams)) {
  assert.ok(t.attack > 0.3 && t.attack < 3, `sim model ${code} attack ${t.attack} implausible`);
  assert.ok(t.defence > 0.3 && t.defence < 3, `sim model ${code} defence ${t.defence} implausible`);
  assert.ok(t.home > 0.5 && t.home < 2, `sim model ${code} home advantage ${t.home} implausible`);
}
// A bundle nobody has refreshed for a season is worse than none: the ratings
// go stale silently while the factor keeps applying them with full confidence.
// Warn rather than fail — a stale model is still better than no model, and CI
// should not go red because a weekend passed.
const simAge = Math.round((Date.now() - Date.parse(SIM_MODEL.vendored)) / 86400000);
if (!Number.isFinite(simAge)) {
  console.warn('  warning: data/sim_model.js has no readable "vendored" date');
} else if (simAge > 45) {
  console.warn(`  warning: data/sim_model.js was vendored ${simAge} days ago (bundle ${SIM_MODEL.version}) — ` +
    `re-run scripts/build-sim-model.mjs to pick up Plsimulator's latest fit`);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(!/const\s+PL_PLAYERS\s*=\s*\[/.test(html),
  'index.html contains an inline PL_PLAYERS literal — the dataset must ship only in data/pl_data.js');
assert.ok(/<script\s+src="data\/pl_data\.js"><\/script>/.test(html),
  'index.html no longer loads data/pl_data.js');
assert.ok(/<script\s+src="data\/ref_history\.js"><\/script>/.test(html),
  'index.html no longer loads data/ref_history.js');
assert.ok(/<script\s+src="data\/h2h\.js"><\/script>/.test(html),
  'index.html no longer loads data/h2h.js');
assert.ok(/<script\s+src="data\/model\.js"><\/script>/.test(html),
  'index.html no longer loads data/model.js');
assert.ok(/<script\s+src="data\/sim_model\.js"><\/script>/.test(html),
  'index.html no longer loads data/sim_model.js');

console.log(`data guard OK: ${PL_PLAYERS.length} players (${promotedRows} at promoted clubs, ${efl} of them on Championship form), ` +
  `${CLUBS.length} clubs, ${REFS.length} refs, ` +
  `${REF_HISTORY.refs.length} historical refs over ${REF_HISTORY.seasons.length} seasons, ` +
  `match model ${SIM_MODEL.version} rating all ${simRated.size}, no inline dataset`);

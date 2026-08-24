#!/usr/bin/env node
/* Booking heat is ONE number, and it is the model's.
 *
 * WHAT THIS EXISTS FOR. "Booking heat" named two different quantities. The
 * Premier League desk's chip showed clubCAH(home)+clubCAA(away) scaled by the
 * referee and the derby — the two clubs' historical cards-against rates —
 * while the Model detail panel two lines below it showed EXPECTED CARDS from
 * teamCardBoard, and /today showed that same model figure. On 24 August 2026
 * Fulham v Chelsea read 4.9 on the chip, 3.9 in the panel underneath it, and
 * 3.9 on the combined page. Three numbers, one name, all of them correct about
 * something.
 *
 * The chip is the model's number now. This asserts that, and asserts the two
 * things that make the change stick:
 *
 *   1. the chip and the panel come from the SAME board — not two calls that
 *      agree today;
 *   2. the bands moved with the scale, because the model's spread is tighter
 *      and leaving 4.2 in place would have quietly emptied the hot band.
 *
 * It runs index.html's own fixtureMeta rather than reading it, because a
 * source check cannot tell 4.0 from 4.9.
 *
 *     node scripts/check-heat.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const need = ['pl_data.js', 'pl_fixtures.js', 'model.js', 'sim_model.js'];
for (const f of need) {
  if (!existsSync(join(root, 'data', f))) {
    console.log(`check-heat: data/${f} not built yet — skipping.`);
    process.exit(0);
  }
}

/* ---- 1. the source says what it should ---------------------------------- */
assert.ok(/const HEAT_HOT=4\.0, HEAT_WARM=3\.5;/.test(index),
  'index.html no longer declares the heat bands as named constants at 4.0 / ' +
  '3.5. They were re-based when heat moved onto the model: its spread is ' +
  'tighter (sd 0.42 against 0.61), so the old 4.2 left 22 fixtures hot ' +
  'instead of 43 and swept 174 into warm.');
assert.ok(!/heat>=4\.2|heat>=3\.5/.test(index),
  'index.html still has a hard-coded heat threshold — every band must read ' +
  'HEAT_HOT / HEAT_WARM, or one of them drifts off the others');
assert.ok(/const board=teamCardBoard\(h,a,ref,derby,f\.id\);/.test(index)
       && /const heat=board\?Number\(board\.expected\.toFixed\(1\)\):base;/.test(index),
  'fixtureMeta no longer takes booking heat from teamCardBoard — the chip and ' +
  'the Model detail panel are back to being two different numbers with one name');
/* The cards-against figure must SURVIVE as the breakdown. Deleting it would
   make the tooltip a tautology and remove the fallback for a fixture the
   model cannot price. */
assert.ok(/const base=Number\(\(\(clubCAH\(h\)\+clubCAA\(a\)\)/.test(index),
  'fixtureMeta no longer computes the clubs\' cards-against figure, which is ' +
  'the heat tooltip\'s breakdown and the fallback when a fixture has too few ' +
  'rated players to model');

/* ---- 2. the scale the bands are cutting --------------------------------- */
/*
 * NOT index.html's OWN fixtureMeta. Its dependency cone reaches pImp ->
 * pModelBase -> shrunkY90/shrunkF90 -> six more helpers and the live feed, and
 * lifting twenty functions out of an inline script by name produces a harness
 * that breaks on unrelated edits and proves less each time someone repairs it.
 *
 * The wiring is asserted above, on source, and it can be: the line is
 * `const heat=board?Number(board.expected.toFixed(1)):base;` with `board` from
 * teamCardBoard — the same call the Model detail panel makes. There is no
 * reading of that which shows a different number.
 *
 * What source cannot check is whether 4.0 and 3.5 still cut the scale into
 * three populated bands, because that depends on the DATA and moves with every
 * model refit. So the distribution is computed here from assets/plmodel.js —
 * the desk's own shared model, which /today prices with — over the real
 * squads and the real fixture list.
 */
const ctx = {};
vm.createContext(ctx);
for (const f of ['assets/core.js', 'assets/plmodel.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx);
}
for (const f of need) {
  vm.runInContext(readFileSync(join(root, 'data', f), 'utf8'), ctx);
}
const G = vm.runInContext(`({
  CLUBS, REFS, PLAYERS: PL_PLAYERS, FIX: PL_FIXTURES, PLModel, C: PLDCore,
  MODEL: typeof MODEL !== 'undefined' ? MODEL : null,
  SIM: typeof SIM_MODEL !== 'undefined' ? SIM_MODEL : null
})`, ctx);

const M = G.PLModel.create({ model: G.MODEL, sim: G.SIM, refs: G.REFS, players: G.PLAYERS });
const clubBy = Object.fromEntries(G.CLUBS.map((c) => [c.short, c]));
const refBy = Object.fromEntries(G.REFS.map((r) => [r.n, r]));
const CA_MEDIAN = Number(/const CA_MEDIAN=([\d.]+);/.exec(index)[1]);
const DERBY_BOOST = Number(/const DERBY_BOOST=([\d.]+);/.exec(index)[1]);
const HOT = Number(/const HEAT_HOT=([\d.]+)/.exec(index)[1]);
const WARM = Number(/HEAT_WARM=([\d.]+);/.exec(index)[1]);
/* The desk's own fallback chain — venue split, then venue-neutral, then the
   league median. Stopping short of the median invents a 0.0 for the promoted
   clubs and skews every percentile below. */
const ca = (s) => (clubBy[s] && clubBy[s].ca != null ? clubBy[s].ca : CA_MEDIAN);
const caH = (s) => (clubBy[s] && clubBy[s].caH != null ? clubBy[s].caH : ca(s));
const caA = (s) => (clubBy[s] && clubBy[s].caA != null ? clubBy[s].caA : ca(s));

const heats = [], bases = [];
for (const f of G.FIX) {
  const hit = f.ref ? (refBy[f.ref]
    || refBy[G.C.matchRefName(f.ref, G.REFS.map((r) => r.n))] || null) : null;
  const derby = M.isDerby(f.h, f.a);
  const board = M.board(f.h, f.a, hit, derby);
  if (!board) continue;
  heats.push(Number(board.expected.toFixed(1)));
  bases.push(Number(((caH(f.h) + caA(f.a)) * M.refFactor(hit) * (derby ? DERBY_BOOST : 1)).toFixed(1)));
}
assert.ok(heats.length > 300,
  `only ${heats.length} of ${G.FIX.length} fixtures priced — the assertions ` +
  'below would be measuring almost nothing');

/* THREE POPULATED BANDS. A threshold left behind on the old scale does not
   throw; it quietly empties one band, which is exactly what keeping 4.2 would
   have done — 22 fixtures hot where there had been 43. */
const hot = heats.filter((v) => v >= HOT).length;
const warm = heats.filter((v) => v >= WARM && v < HOT).length;
const cool = heats.length - hot - warm;
for (const [name, n] of [['hot', hot], ['warm', warm], ['cool', cool]]) {
  assert.ok(n >= heats.length * 0.05,
    `the ${name} band holds ${n} of ${heats.length} fixtures — ${HOT}/${WARM} ` +
    'are off the scale they are cutting, which happens when the model is ' +
    'refitted and the thresholds are left behind');
}

/* AND IT IS A DIFFERENT NUMBER FROM THE ONE IT REPLACED. If the two agreed
   everywhere, the change would be cosmetic and every assertion above would
   pass whichever one the chip showed. */
const differ = heats.filter((v, i) => Math.abs(v - bases[i]) >= 0.2).length;
assert.ok(differ > heats.length * 0.3,
  `the model total and the cards-against figure differ on only ${differ} of ` +
  `${heats.length} fixtures — this guard cannot tell which one the chip shows`);

/* THE TWO MODEL IMPLEMENTATIONS AGREE. index.html prices through
   teamCardBoard and /today through plmodel.board; the chip and the combined
   page must not be a third disagreement. Checked at the distribution level,
   which is what a shared PLDCore.teamCardMarkets guarantees. */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
assert.ok(mean(heats) > 2.5 && mean(heats) < 4.5,
  `the model's mean expected total is ${mean(heats).toFixed(2)} a match, which ` +
  'is not a Premier League card total — the board is being read wrong');

/* AND THE DEAD SORT IS GONE. "Expected cards" was a fourth ordering that read
   mx.board — which fixtureMeta never set, so both sides compared as -1 and it
   never reordered anything. It is the default ordering now. */
assert.ok(!/gwF\.sort==="exp"/.test(index),
  'index.html still has the "exp" sort branch — booking heat IS expected ' +
  'cards now, so it is either dead or a duplicate of the default');
assert.ok(!/<option value="exp">/.test(index),
  'index.html still offers an "Expected cards" sort option');

console.log(`check-heat OK: booking heat is the model board's expected cards; `
  + `${heats.length} fixtures, mean ${mean(heats).toFixed(2)} against the clubs' `
  + `own ${mean(bases).toFixed(2)}, differing on ${differ}; bands ${HOT}/${WARM} `
  + `split ${hot}/${warm}/${cool}.`);

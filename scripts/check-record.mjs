// Guard the track record — the view that grades the desk against what happened.
//
// This is the only page on the site that is not a forecast, which makes its
// failure modes different from everything else here. A fixture card that is
// wrong is wrong about one match. A calibration table that is wrong is wrong
// about the model, and it is the number somebody would change the model BY.
//
// Three ways it can go wrong quietly, and each is checked below.
//
//   1. THE BANDS DRIFT FROM THE CARD. "Hot" on this table has to mean what the
//      chip means, or the table grades a band nobody was shown. The reader is
//      a Netlify function and cannot import the page, so it declares HOT and
//      WARM itself — which is exactly the shape of duplication this repository
//      keeps finding in its own guards. They are compared here.
//   2. THE REFEREE SPLIT IS AVERAGED AWAY. Most of the early record was logged
//      before the officials were appointed, at refFactor = 1. Pooling those
//      rows with the rest reports a bias the model does not have: on the first
//      44 matches it is +0.62 without an official and +0.19 with one. The
//      split has to survive.
//   3. THE ROUTE IS STAMPED BUT NOT KNOWN. today.html serves five routes; the
//      head stamps data-route and the script keeps its OWN list of routes it
//      understands. A route missing from that list is silent in the worst way
//      — the CSS shows the right blocks and the script builds the home page
//      underneath them. That is not hypothetical: it happened to this route.
//
//     node scripts/check-record.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const require_ = createRequire(import.meta.url);

/* ---- 1. the bands are the desk's own ------------------------------------ */
const fn = read('netlify/functions/match-record.js');
const index = read('index.html');
const hot = /const HOT = ([\d.]+), WARM = ([\d.]+);/.exec(fn);
assert.ok(hot, 'match-record.js no longer declares its band cuts');
const deskHot = /const HEAT_HOT=([\d.]+)/.exec(index);
const deskWarm = /HEAT_WARM=([\d.]+)/.exec(index);
assert.ok(deskHot && deskWarm, 'index.html no longer declares HEAT_HOT/HEAT_WARM');
assert.equal(Number(hot[1]), Number(deskHot[1]),
  `the record calls a fixture hot at ${hot[1]} and the desk's chip at ${deskHot[1]} — ` +
  'the table would be grading a band no reader was ever shown');
assert.equal(Number(hot[2]), Number(deskWarm[1]),
  `the record's warm cut is ${hot[2]}, the desk's ${deskWarm[1]}`);

/* ---- 2. the arithmetic, on rows written here ---------------------------- */
/* Hand-built rather than pulled from the table: the assertions below are about
   what the reader COMPUTES, and a live sample would make them a test of last
   weekend's football. */
const row = (league, exp, cards, refCarded, o35) => ({
  season: '2026-27', league, matchday: 1, kickoff: '2026-08-15T14:00:00+00:00',
  home: 'AAA', away: 'BBB', exp_cards: exp, cards_total: cards,
  p_over_3_5: o35, p_over_4_5: 0.3, exp_points: exp * 10, points_total: cards * 10,
  referee: refCarded ? 'A Referee' : null, ref_carded: refCarded, ref_factor: 1,
  derby: false, model_version: 'test',
});
/* THE FOURTH ROW IS THE POINT OF THE SET. Rated 4.0 and returning exactly
   four, it CLEARS the line the card quotes and does NOT beat its own number —
   the one case that proves the two columns are counting different things, and
   the case a fixture set of clear hits and clear misses cannot express. It
   also sits exactly on the hot cut, so it pins the boundary as inclusive. */
const rows = [
  row('PL', 4.5, 6, true, 0.7),     // hot: beats its rating and clears 4
  row('PL', 4.0, 4, false, 0.6),    // hot, at the cut: clears 4, does NOT beat 4.0
  row('EFLC', 3.5, 5, true, 0.5),   // warm: beats its rating and clears 4
  row('LL', 3.0, 2, false, 0.4),    // cool: neither
];

const realFetch = globalThis.fetch;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
globalThis.fetch = async () => ({ ok: true, json: async () => rows });
delete require_.cache[require_.resolve(join(root, 'netlify', 'functions', 'match-record.js'))];
const mod = require_(join(root, 'netlify', 'functions', 'match-record.js'));
const d = JSON.parse((await mod.handler({ queryStringParameters: {} })).body);
globalThis.fetch = realFetch;

assert.equal(d.overall.n, 4);
assert.equal(d.overall.rated, 3.75);            // (4.5+4+3.5+3)/4
assert.equal(d.overall.actual, 4.25);           // (6+4+5+2)/4
assert.equal(d.overall.bias, 0.5);
/* THE TWO QUESTIONS ARE DIFFERENT, and the whole table is worthless if they
   are conflated. Three of the four cleared their own rating; two of the four
   produced four cards or more. Same fixtures, different counts. */
assert.equal(d.overall.beatRating, 2,
  'beatRating counts fixtures that produced MORE than their own number');
assert.equal(d.overall.hitOver35, 0.75,
  'hitOver35 counts fixtures that produced four cards or more');
assert.notEqual(d.overall.beatRating / d.overall.n, d.overall.hitOver35,
  'the fixture set no longer separates the two questions — pick one where ' +
  'they differ, or the assertion above proves nothing');

assert.equal(d.bands.hot.n, 2, 'the 4.0 fixture belongs in the hot band, at the cut');
assert.equal(d.bands.warm.n, 1);
assert.equal(d.bands.cool.n, 1);
assert.equal(d.bands.hot.hitOver35, 1, 'both hot fixtures cleared 4');

/* ---- 3. the referee split survives -------------------------------------- */
assert.ok(d.withRatedRef && d.withoutRatedRef,
  'the record no longer splits on whether the referee was known when the row ' +
  'was logged — that split is most of the apparent bias in the early season, ' +
  'and pooling it reports a bias the model does not have');
assert.equal(d.withRatedRef.n, 2);
assert.equal(d.withoutRatedRef.n, 2);
assert.equal(d.withRatedRef.actual, 5.5);       // (6+5)/2
assert.equal(d.withoutRatedRef.actual, 3);      // (4+2)/2

/* AND THE SPREAD IS CARRIED. The bias is the number a reader would correct the
   model by; printed without its standard error it invites exactly that on a
   sample far too small to support it. */
assert.ok(d.overall.se != null && d.overall.sd != null,
  'the record reports a bias with no spread beside it');

/* ---- 4. the logger waits for the official ------------------------------- */
/* The row is written once and never revised, so WHEN it is written decides
   what the record grades. Written the moment a round became "next", it froze
   every forecast at refFactor = 1 days before anyone was appointed. */
const accas = read('scripts/accas.mjs');
assert.ok(/r\.ref_carded \|\| due\(r\)/.test(accas),
  'scripts/accas.mjs logs a match forecast without waiting for the official — ' +
  'the row is never revised, so the record would go back to grading a ' +
  'refFactor = 1 forecast the desk had stopped showing by kick-off');
assert.ok(/DEADLINE_H/.test(accas),
  'the logger has no deadline, so a fixture nobody is ever appointed to would ' +
  'never be logged at all');

/* ---- 5. the route is one the script knows ------------------------------- */
const today = read('today.html');
const known = /\[([^\]]*)\]\.indexOf\(ROUTE\) < 0/.exec(today);
assert.ok(known, "today.html no longer keeps a list of the routes its script understands");
const stamped = new Set([...(/var route = ([\s\S]*?);\s*\n/.exec(today) || ['', ''])[1]
  .matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
for (const r of stamped) {
  if (r === 'home') continue;
  assert.ok(known[1].includes(`'${r}'`),
    `today.html stamps data-route="${r}" but its script does not know that ` +
    'route, so the CSS shows that view and the script builds the home page ' +
    'underneath it — silent, and exactly how this route shipped broken once');
}
assert.ok(stamped.has('record'), 'today.html no longer stamps the /record route');

console.log(`check-record OK: bands match the desk (${hot[1]}/${hot[2]}), the two ` +
  'questions stay separate, the referee split survives, the logger waits for the ' +
  `official, and all ${stamped.size} stamped routes are known to the script`);

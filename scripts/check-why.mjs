// Guard for "Why this price": `node scripts/check-why.mjs`.
//
// The breakdown is only worth showing if its last step IS the printed price.
// So, against the committed data of all four divisions, every rated player's
// price is rebuilt through PLDCore.priceSteps and compared with the figure
// the desk's own arithmetic prints:
//   1. the full-match price, with no referee and with every rated referee;
//   2. the fixture price for the next round: expected minutes from the
//      squad's minute shares, the fixture's referee factor and the derby
//      uplift, priced the way the desks price (scripts/accas.mjs's sideTop);
//   3. the Premier League's odds-scale chain (referee, derby, venue, game
//      state), through contextProb, for a spread of factors.
// Then the wiring: every desk marks its prices with data-why, sets a
// resolver, carries the keyboard route, and the sheet keeps the 18+ line and
// no tipping language.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const C = require('../assets/core.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = await import('./accas.mjs');
const read = (p) => readFileSync(join(root, p), 'utf8');
const BANNED = /\b(tips?|tipster|locks?|banker|nailed|sure thing|guaranteed|value bets?|must[- ]bet|best bets?|stake|punt)\b/i;

let season = 0, fixture = 0, odds = 0, sentences = 0;
const allText = [];
for (const L of A.LEAGUES) {
  const d = A.loadConsts(L.data, [L.players, 'REFS']);
  const f = A.loadConsts(L.fixtures, [L.fx]);
  const players = d[L.players] || [], refs = d.REFS || [], fixtures = f[L.fx] || [];
  const pr = A.priors(players);
  for (const p of players) p._y90 = A.shrunk(p, pr);
  const avgs = A.leagueAverages(refs);
  const rateOf = (p) => ({ yc: p.yc, minutes: p.min,
    prior: !p.p || pr[p.p] == null ? pr._league : pr[p.p], priorLabel: 'midfielder', strength: A.SHRINK_MATCHES });
  const rated = players.filter((p) => p._y90 != null && Number(p.min) > 0);
  const refFactors = [1, ...refs.slice(0, 8).map((r) => C.refCardFactor(r, avgs, {}))];

  /* 1. Full-match prices. */
  for (const p of rated) {
    for (const rf of refFactors) {
      const price = C.pCardSeason(p._y90, { ref: rf });
      const r = C.priceSteps({ engine: 'lambda', rate: rateOf(p), expMin: null,
        factors: [{ key: 'referee', value: rf, name: rf === 1 ? null : 'R' }], price, leagueRate: pr._league });
      assert.ok(r.ok, `${L.code} ${p.n}: full-match price ${price} rebuilt as ${r.final}`);
      season++;
      if (season % 97 === 0) allText.push(...r.steps.map((s) => s.sentence), r.versus ? r.versus.sentence : '');
    }
  }

  /* 2. Fixture prices for the next round. */
  const { round } = A.matchesFor(L);
  for (const fx of fixtures.filter((x) => x.r === round)) {
    const hit = fx.ref ? C.matchRefName(fx.ref, refs.map((r) => r.n)) : null;
    const ref = hit ? refs.find((r) => r.n === hit) : null;
    const factor = ref ? C.refCardFactor(ref, avgs, {}) : 1;
    for (const derby of [false, true]) {
      const boost = derby ? A.DERBY_BOOST_FOR(L.code) : 1;
      for (const club of [fx.h, fx.a]) {
        const squad = players.filter((p) => p.c === club && p._y90 != null);
        const w = C.minuteWeights(squad.map((p) => p.min), 11);
        const top = A.sideTop(players, club, factor * boost);
        squad.forEach((p, i) => {
          const expMin = Math.max(0, w[i]) * 90;
          const shown = top.find((t) => t.p === p);
          const r = C.priceSteps({ engine: 'lambda', rate: rateOf(p), expMin, minutesSource: 'share',
            factors: [{ key: 'referee', value: factor, name: ref ? ref.n : null }, { key: 'derby', value: boost }],
            price: shown.prob, leagueRate: pr._league });
          assert.ok(r.ok, `${L.code} ${fx.id} ${p.n}: fixture price ${shown.prob} rebuilt as ${r.final}`);
          fixture++;
        });
      }
    }
  }

  /* 3. The odds-scale chain the Premier League desk uses. */
  for (const p of rated.slice(0, 60)) {
    const base = C.pCardSeason(p._y90);
    for (const [rf, df, vf, cf] of [[1, 1, 0.95, null], [1.15, 1.08, 1.08, 1.05], [0.9, 1, 0.95, 0.96]]) {
      const price = C.contextProb(base, rf, df, vf, cf);
      const r = C.priceSteps({ engine: 'odds', rate: rateOf(p), base, price, leagueRate: pr._league,
        factors: [{ key: 'referee', value: rf, name: 'R' }, { key: 'derby', value: df },
          { key: 'venue', value: vf, isHome: vf < 1 }, { key: 'gameState', value: cf }] });
      assert.ok(r.ok, `${L.code} ${p.n}: odds chain ${price} rebuilt as ${r.final}`);
      odds++;
      if (odds % 41 === 0) allText.push(...r.steps.map((s) => s.sentence), r.note || '');
    }
  }
}
assert.ok(season > 1000 && fixture > 100 && odds > 100, `too little checked: ${season}/${fixture}/${odds}`);

for (const t of allText) {
  sentences++;
  assert.ok(!BANNED.test(t), `a breakdown sentence uses tipping language: "${t}"`);
  assert.ok(!/—|NaN|undefined|Infinity/.test(t), `a breakdown sentence prints a broken value: "${t}"`);
}

/* The wiring. */
for (const page of ['eflc.html', 'laliga.html', 'seriea.html']) {
  const html = read(page);
  assert.ok(html.includes('<script src="assets/why.js"></script>'), `${page} does not load the sheet`);
  assert.ok((html.match(/data-why="fx\|/g) || []).length >= 2, `${page}: fixture prices are not marked`);
  assert.ok((html.match(/data-why="pl\|/g) || []).length >= 2, `${page}: player-list prices are not marked`);
  assert.ok(/PLDWhy\.setResolver\(whyFor\)/.test(html), `${page} sets no resolver`);
  assert.ok(/whyKey:/.test(html), `${page}: the player record has no keyboard route to the breakdown`);
  assert.ok(/expMin: expMin/.test(html) && /expMin: row\.expMin/.test(html),
    `${page}: the breakdown does not use the expected minutes the price was made from`);
  assert.ok(/price: row\.prob/.test(html) && /price: probFor\(p, ref\)/.test(html),
    `${page}: the breakdown is not checked against the price the desk prints`);
}
const pl = read('index.html');
assert.ok(pl.includes('<script src="assets/why.js"></script>') && /PLDWhy\.setResolver\(plWhyFor\)/.test(pl),
  'the Premier League desk does not wire the sheet');
assert.ok(/data-why="fx\|/.test(pl) && /data-why="pl\|/.test(pl), 'the Premier League desk does not mark its prices');
assert.ok(/const price=fixtureProb\(p,M\.ref,M\.derby,isHome,M\.sim\)/.test(pl),
  'the Premier League breakdown is not checked against fixtureProb, the function the desk prints');
assert.ok(/function fixtureProb\(p,ref,derby,isHome,sim\)\{[\s\S]{0,500}contextProb\(base,rf,df,vf,cf\)/.test(pl),
  'fixtureProb no longer chains referee, derby, venue and game state; update the breakdown to match');
assert.ok(/data-why=/.test(read('assets/profile.js')), 'the shared player record lost its Why this price button');
const sheet = read('assets/why.js');
assert.ok(/Research, not advice/.test(sheet) && /18\+ only/.test(sheet) && /BeGambleAware/.test(sheet),
  'the sheet lost its 18+ research framing');
assert.ok(!BANNED.test(sheet.replace(/\/\*[\s\S]*?\*\//g, '')), 'the sheet uses tipping language');
assert.ok(/priceSteps\(/.test(sheet), 'the sheet does its own arithmetic instead of PLDCore.priceSteps');
assert.ok(read('sw.js').includes("'/assets/why.js'"), 'the service worker does not precache the sheet');

console.log(`check-why OK: ${season} full-match, ${fixture} fixture and ${odds} odds-scale prices rebuilt step by `
  + `step to the printed figure across all four divisions; ${sentences} sample sentences read clean; every desk `
  + 'marks its prices, sets a resolver and keeps a keyboard route, and the sheet is 18+ research');

// Guard for the in-play view: `node scripts/check-inplay.mjs`.
//
// The view's promise is that every number is the desk's own until the match
// moves it. So, against the committed data of all four divisions:
//   1. every league has a card clock, built from the minute of every card this
//      season, that starts at 1, never rises and ends in added time;
//   2. at kick-off the view reproduces the desk's match lines to the digit,
//      for every fixture of the next round, priced the way the desks price;
//   3. replayed over every finished match with recorded card minutes, "over
//      3.5 now" at full time is exactly what happened, and the cards-so-far
//      count at every minute matches a recount of the events;
//   4. every desk offers the view, under its own league code, refreshes it
//      on each poll, and the panel keeps the 18+ research framing, prints no
//      odds and sends nothing off the device.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const C = require('../assets/core.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = await import('./accas.mjs');
const read = (p) => readFileSync(join(root, p), 'utf8');

const EVENTS = { PL: ['data/pl_cardevents.js', 'PL_CARDEVENTS'], EFLC: ['data/eflc_cardevents.js', 'EFLC_CARDEVENTS'],
  LL: ['data/laliga_cardevents.js', 'LALIGA_CARDEVENTS'], SA: ['data/seriea_cardevents.js', 'SERIEA_CARDEVENTS'] };

let clocks = 0, fixturesPriced = 0, replayed = 0, minutesChecked = 0;
for (const L of A.LEAGUES) {
  const [evPath, evConst] = EVENTS[L.code];
  assert.ok(existsSync(join(root, evPath)), `${L.code}: ${evPath} is missing, so the view has no card clock`);
  const events = A.loadConsts(evPath, [evConst])[evConst] || {};

  /* 1. The clock. */
  const clock = C.cardClock(events);
  assert.ok(clock, `${L.code}: fewer than ${C.CLOCK_MIN_CARDS} card minutes, no clock`);
  assert.equal(clock.after.length, 91, `${L.code}: the clock does not cover minutes 0 to 90`);
  assert.equal(clock.after[0], 1, `${L.code}: some card is filed at minute 0`);
  for (let t = 1; t <= 90; t++) {
    assert.ok(clock.after[t] <= clock.after[t - 1] + 1e-12, `${L.code}: the share still to come rises at minute ${t}`);
  }
  assert.ok(clock.after[45] > 0.5 && clock.after[45] < 0.85,
    `${L.code}: ${(clock.after[45] * 100).toFixed(1)}% of cards after half-time is outside any league's range`);
  assert.ok(clock.after[90] > 0 && clock.after[90] < 0.3, `${L.code}: added-time share ${clock.after[90]} looks wrong`);
  clocks++;

  /* 2. Kick-off reproduces the desk. */
  const d = A.loadConsts(L.data, [L.players, 'REFS']);
  const f = A.loadConsts(L.fixtures, [L.fx]);
  const players = d[L.players] || [], refs = d.REFS || [], fixtures = f[L.fx] || [];
  const pr = A.priors(players);
  for (const p of players) p._y90 = A.shrunk(p, pr);
  const avgs = A.leagueAverages(refs);
  const { round } = A.matchesFor(L);
  for (const fx of fixtures.filter((x) => x.r === round)) {
    const hit = fx.ref ? C.matchRefName(fx.ref, refs.map((r) => r.n)) : null;
    const ref = hit ? refs.find((r) => r.n === hit) : null;
    const factor = ref ? C.refCardFactor(ref, avgs, {}) : 1;
    const home = A.sideTop(players, fx.h, factor), away = A.sideTop(players, fx.a, factor);
    const desk = C.teamCardMarkets(home.map((c) => c.prob), away.map((c) => c.prob), [3.5]);
    const list = [...home, ...away].map((c) => ({ name: c.p.n, club: c.p.c, pre: c.prob }));
    for (const minute of [null, 0]) {
      const r = C.inPlayFixture({ home: fx.h, away: fx.a, players: list, minute, clock });
      assert.equal(r.expected.pre, desk.expected, `${L.code} ${fx.id}: expected cards differ from the desk`);
      assert.equal(r.over[3.5].pre, desk.over[3.5], `${L.code} ${fx.id}: over 3.5 differs from the desk`);
      assert.ok(Math.abs(r.over[3.5].now - desk.over[3.5]) < 1e-12,
        `${L.code} ${fx.id}: at kick-off "now" is not the desk's price`);
      for (const p of r.players) assert.equal(p.now, p.pre, `${L.code} ${fx.id}: ${p.name} moved before a ball was kicked`);
    }
    fixturesPriced++;
  }

  /* 3. Replay finished matches. */
  const byId = new Map(fixtures.map((x) => [String(x.id), x]));
  for (const id of Object.keys(events)) {
    const fx = byId.get(id);
    if (!fx || fx.st !== 'FT') continue;
    const cards = events[id] || [];
    const tally = (minute) => {
      const t = { home: { yc: 0, rc: 0 }, away: { yc: 0, rc: 0 } };
      for (const c of cards) {
        if (minute != null && !(Number(c.m) <= minute)) continue;
        const side = c.c === fx.h ? 'home' : c.c === fx.a ? 'away' : null;
        if (!side) continue;
        if (c.k === 'Y') t[side].yc++;
        else if (c.k === 'Y2') { t[side].yc++; }
        else t[side].rc++;
      }
      return t;
    };
    const list = [{ name: 'x', club: fx.h, pre: 0.3 }, { name: 'y', club: fx.a, pre: 0.3 }];
    for (const minute of [15, 45, 60, 75, 90]) {
      const t = tally(minute);
      const r = C.inPlayFixture({ home: fx.h, away: fx.a, players: list, minute, cards: t, clock });
      const want = t.home.yc + t.home.rc + t.away.yc + t.away.rc;
      assert.equal(r.cards.total, want, `${L.code} ${id}: cards so far at ${minute}' do not match the events`);
      if (want >= 4) assert.equal(r.over[3.5].now, 1, `${L.code} ${id}: four cards shown but over 3.5 is not settled`);
      minutesChecked++;
    }
    const t = tally(null);
    const total = t.home.yc + t.home.rc + t.away.yc + t.away.rc;
    const ft = C.inPlayFixture({ home: fx.h, away: fx.a, players: list, minute: 90, finished: true, cards: t, clock });
    assert.equal(ft.over[3.5].now, total > 3.5 ? 1 : 0, `${L.code} ${id}: at full time over 3.5 is not what happened`);
    assert.equal(ft.expected.rest, 0, `${L.code} ${id}: cards still expected after full time`);
    replayed++;
  }
}
assert.equal(clocks, 4, 'not every division has a card clock');
assert.ok(fixturesPriced > 0 && replayed > 100, `too little checked: ${fixturesPriced} priced, ${replayed} replayed`);

/* 4. Wiring and wording. */
const DESKS = [['index.html', 'PL'], ['eflc.html', 'EFLC'], ['laliga.html', 'LL'], ['seriea.html', 'SA']];
for (const [page, code] of DESKS) {
  const html = read(page);
  assert.ok(html.includes('<script src="assets/inplay.js"></script>'), `${page} does not load the in-play view`);
  assert.ok(/data-inplay=/.test(html) && />Live view</.test(html), `${page} has no Live view button`);
  assert.ok(new RegExp(`league\\s*:\\s*['"]${code}['"]\\s*,\\s*build`).test(html), `${page} opens the view without its league code ${code}`);
  assert.ok(/PLDInPlay\.refresh\(\)/.test(html), `${page} does not refresh an open view when the live feed polls`);
}
const pl = read('index.html');
assert.ok(/function teamCardBoard[\s\S]{0,200}plBoardSides\(/.test(pl),
  'the Premier League board no longer prices off plBoardSides, so the view could describe different players');
const panel = read('assets/inplay.js');
const code = panel.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(/18\+ research, not advice/.test(panel) && /BeGambleAware/.test(panel), 'the in-play view lost its 18+ framing');
assert.ok(/never a live price|none of these numbers is a live price/.test(panel), 'the in-play view no longer says it is not a live price');
assert.ok(!/toFixed\(2\)\s*\+\s*['"]\s*\/|decimal odds|\bstake\b|value bet|\btips?\b/i.test(code), 'the in-play view prints odds or tipping language');
assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|supabase/.test(code), 'the in-play view sends data off the device');
assert.ok(/inPlayFixture\(/.test(code) && /cardClock\(/.test(code), 'the in-play view does its own arithmetic instead of PLDCore');
assert.ok(read('sw.js').includes("'/assets/inplay.js'"), 'the service worker does not precache the in-play view');

console.log(`check-inplay OK: ${clocks} card clocks from this season's card minutes; kick-off reproduces the desk `
  + `for ${fixturesPriced} fixtures; ${replayed} finished matches replayed (${minutesChecked} minute checks) with `
  + 'cards so far and full-time over 3.5 matching the events; every desk offers and refreshes the view under '
  + 'its own league code, and the panel is 18+ research, prints no odds and stays on the device');

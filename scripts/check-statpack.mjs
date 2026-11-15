// Guard for the weekly stat pack: run with `node scripts/check-statpack.mjs`.
//
// The pack's promise is that every number in it is re-derivable: the prices
// are the desk's own priced rows passed straight through, and the averages
// are the feed's per-fixture counts divided by the games they cover. This
// builds a pack for the next round of all four divisions from the committed
// data, through the same primitives scripts/accas.mjs prices with, and checks
// the pack, its image-card text and both text formats against an independent
// recount. It also holds the wording: research, 18+, no tipping language.
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

const FXSTATS = { PL: ['data/pl_fxstats.js', 'PL_FXSTATS'], EFLC: ['data/eflc_fxstats.js', 'EFLC_FXSTATS'],
  LL: ['data/laliga_fxstats.js', 'LALIGA_FXSTATS'], SA: ['data/seriea_fxstats.js', 'SERIEA_FXSTATS'] };

/* Words a research pack must not use. "Tip", "lock", "banker" and their kin
   are how a tipster sells; the pack states numbers and says what they are. */
const BANNED = /\b(tips?|tipster|locks?|banker|bankers|nailed|sure thing|guaranteed|value bets?|must[- ]bet|best bets?|stake|punt)\b/i;

let packs = 0, fixturesSeen = 0;
for (const L of A.LEAGUES) {
  const d = A.loadConsts(L.data, [L.players, 'REFS']);
  const f = A.loadConsts(L.fixtures, [L.fx]);
  const players = d[L.players] || [], refs = d.REFS || [], fixtures = f[L.fx] || [];
  const [fxPath, fxConst] = FXSTATS[L.code];
  const fxstats = existsSync(join(root, fxPath)) ? (A.loadConsts(fxPath, [fxConst])[fxConst] || {}) : {};
  const pr = A.priors(players);
  for (const p of players) p._y90 = A.shrunk(p, pr);
  const avgs = A.leagueAverages(refs);
  const { round } = A.matchesFor(L);
  if (round == null) continue;

  /* Priced rows in the desks' shape, built the way the acca builder prices. */
  const rows = fixtures.filter((x) => x.r === round).map((fx) => {
    const hit = fx.ref ? C.matchRefName(fx.ref, refs.map((r) => r.n)) : null;
    const ref = hit ? refs.find((r) => r.n === hit) : null;
    const factor = ref ? C.refCardFactor(ref, avgs, {}) : 1;
    const home = A.sideTop(players, fx.h, factor), away = A.sideTop(players, fx.a, factor);
    const m = C.teamCardMarkets(home.map((c) => c.prob), away.map((c) => c.prob), [3.5]);
    return { fx, m, ref: { ref, name: fx.ref || null, appointed: !!fx.ref }, factor,
             home: { top: home.slice(0, 5) }, away: { top: away.slice(0, 5) } };
  });
  const pack = C.statPack({ league: L.code, leagueName: L.code, round, roundWord: 'Matchday',
    rows, fixtures, fxstats });
  packs++;

  /* 1. Prices pass straight through, untouched. */
  assert.equal(pack.fixtures.length, rows.length, `${L.code}: the pack dropped a fixture`);
  for (const pf of pack.fixtures) {
    fixturesSeen++;
    const r = rows.find((x) => x.fx.id === pf.id);
    assert.ok(r, `${L.code}: pack fixture ${pf.id} is not one of the round's rows`);
    assert.equal(pf.model.expectedCards, r.m.expected, `${L.code} ${pf.id}: expected cards changed in the pack`);
    assert.equal(pf.model.over35, r.m.over[3.5], `${L.code} ${pf.id}: over 3.5 changed in the pack`);
    assert.equal(pf.model.bothCarded, r.m.bothCarded, `${L.code} ${pf.id}: both-carded changed in the pack`);
    const all = [...r.home.top, ...r.away.top].map((c) => c.prob).sort((a, b) => b - a);
    assert.deepEqual(pf.top.map((t) => t.prob), all.slice(0, C.PACK_TOP),
      `${L.code} ${pf.id}: the highest-priced players are not the round's own highest prices`);
    if (r.ref.ref) assert.equal(pf.referee.yellowsPerGame, r.ref.ref.ypg, `${L.code} ${pf.id}: referee rate changed`);

    /* 2. Averages equal an independent recount from the feed's counts. */
    for (const side of ['home', 'away']) {
      const code = side === 'home' ? pf.home : pf.away, t = pf.teams[side];
      let n = 0, yf = 0, ya = 0;
      for (const x of fixtures) {
        if (x.st !== 'FT' || (x.h !== code && x.a !== code)) continue;
        const st = fxstats[String(x.id)], opp = x.h === code ? x.a : x.h;
        if (!st || !st[code] || !st[opp]) continue;
        n++; yf += st[code].yc || 0; ya += st[opp].yc || 0;
      }
      assert.equal(t.played, n, `${L.code} ${code}: games counted ${t.played}, recount ${n}`);
      if (n) {
        assert.ok(Math.abs(t.yellowsFor - yf / n) < 1e-9, `${L.code} ${code}: yellows for disagrees with the recount`);
        assert.ok(Math.abs(t.yellowsAgainst - ya / n) < 1e-9, `${L.code} ${code}: yellows against disagrees with the recount`);
      } else {
        assert.equal(t.yellowsFor, null, `${L.code} ${code}: no games but an average was printed`);
      }
    }
  }

  /* 3. The three outputs print the pack's own numbers, and only research language. */
  const md = C.statPackMarkdown(pack), discord = C.statPackDiscord(pack), cards = C.statPackCardRows(pack);
  for (const pf of pack.fixtures) {
    const exp = pf.model.expectedCards == null ? '—' : pf.model.expectedCards.toFixed(1);
    assert.ok(md.includes(`Model: ${exp} expected cards`), `${L.code} ${pf.id}: Reddit block lost the expected cards`);
    assert.ok(discord.join('\n').includes(`Model: ${exp} expected cards`), `${L.code} ${pf.id}: Discord lost the expected cards`);
    const card = cards.find((c) => c.home === pf.home && c.away === pf.away);
    assert.equal(card.expected, exp, `${L.code} ${pf.id}: the image card prints a different expected-cards figure`);
    for (const t of pf.top) {
      const s = `${t.name} (${t.club}) ${(t.prob * 100).toFixed(1)}%`;
      assert.ok(md.includes(s) && card.top.includes(s), `${L.code}: ${s} missing from an output`);
    }
  }
  for (const part of discord) {
    assert.ok(part.length <= C.DISCORD_LIMIT, `${L.code}: a Discord part is ${part.length} characters`);
    assert.ok(part.includes('18+ only'), `${L.code}: a Discord part has no 18+ line`);
  }
  assert.ok(md.includes('18+ only') && md.includes('Research, not advice'), `${L.code}: Reddit block lost the footer`);
  for (const [name, text] of [['Reddit', md], ['Discord', discord.join('\n')],
    ['card', JSON.stringify(cards)]]) {
    assert.ok(!/&(apos|#39|quot|amp|lt|gt);/.test(text), `${L.code}: the ${name} output prints an HTML code instead of a character`);
    const hit = BANNED.exec(text.replace(/bookingsdesk\.netlify\.app/g, ''));
    assert.ok(!hit, `${L.code}: the ${name} output says "${hit && hit[0]}", which is tipping language`);
  }
}
assert.ok(packs >= 2, `only ${packs} division(s) produced a pack`);

/* 4. Every desk offers the pack, builds it through PLDCore.statPack with its
   own fixture stats, and loads the panel; the panel and card add no wording
   of their own that breaks the rules above. */
const DESKS = [['index.html', 'PL_FXSTATS'], ['eflc.html', 'EFLC_FXSTATS'],
  ['laliga.html', 'LALIGA_FXSTATS'], ['seriea.html', 'SERIEA_FXSTATS']];
for (const [page, fxv] of DESKS) {
  const html = read(page);
  assert.ok(html.includes('<script src="assets/statpack.js"></script>'), `${page} does not load the stats pack panel`);
  assert.ok(/>Stats pack</.test(html), `${page} has no Stats pack button`);
  assert.ok(/statPack\(\{/.test(html) && html.includes(fxv), `${page} does not build the pack from ${fxv}`);
}
const panel = read('assets/statpack.js');
assert.ok(/18\+ research, not advice/.test(panel), 'the stats pack panel lost its 18+ research line');
assert.ok(!BANNED.test(panel.replace(/\/\*[\s\S]*?\*\//g, '')), 'the stats pack panel uses tipping language');
assert.ok(!/blob:|createObjectURL/.test(panel.replace(/\/\*[\s\S]*?\*\//g, '')),
  'the panel previews through blob: URLs, which the CSP (img-src self data:) blocks');

console.log(`check-statpack OK: ${packs} division packs, ${fixturesSeen} fixtures — prices pass through `
  + 'untouched, every average equals a recount of the feed’s counts, the card, Reddit and Discord '
  + 'outputs print the same numbers, Discord parts stay under 2,000 characters, every output carries '
  + 'the 18+ research line, and none uses tipping language');

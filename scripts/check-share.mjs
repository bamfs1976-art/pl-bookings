// Guard the share cards.
//
// A share card is the one artefact that leaves the site — it gets posted, and
// nobody who sees it can check it against the page it came from. So the two
// things worth pinning are that it says the same numbers as the desk, and that
// it cannot silently lose a league's identity.
//
// This runs assets/share.js in a VM with a stub canvas that RECORDS every draw
// call instead of rasterising. That is deliberate: rendering a PNG in CI and
// diffing pixels would fail on a font substitution and pass on a wrong number,
// which is exactly backwards. What matters is the text drawn.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* A 2d context that measures plausibly and remembers what it was told to
   draw. measureText has to return something monotonic in length or the
   fit()/truncation paths never exercise. */
function stubCtx(drawn, placed) {
  const noop = () => {};
  return {
    canvas: null,
    set fillStyle(v) {}, get fillStyle() { return '#000'; },
    set strokeStyle(v) {}, set lineWidth(v) {},
    set font(v) { this._font = v; }, get font() { return this._font || ''; },
    /* textAlign is TRACKED, not swallowed. The card sets it to 'right' for
       every price and back to 'left' after, and a stub that always answers
       'left' makes every right-aligned label look like it starts where it
       actually ends — which turns the overlap check below into noise. */
    set textAlign(v) { this._align = v; }, get textAlign() { return this._align || 'left'; },
    set textBaseline(v) {}, get textBaseline() { return 'alphabetic'; },
    fillRect: noop, beginPath: noop, moveTo: noop, arcTo: noop, closePath: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: (t) => ({ width: String(t).length * 11 }),
    fillText(t, x, y) {
      drawn.push(String(t));
      if (placed) {
        const w = String(t).length * 11;
        const a = this._align || 'left';
        const x0 = a === 'right' ? x - w : a === 'center' ? x - w / 2 : x;
        placed.push({ t: String(t), y, x0, x1: x0 + w });
      }
    }
  };
}

function makeSandbox(drawn, placed) {
  const ctx = {
    document: {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => stubCtx(drawn, placed),
        toBlob: (cb) => cb({ __blob: true, size: 1024 })
      }),
      fonts: { ready: Promise.resolve() }
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    setTimeout, console, Promise
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  /* accas.js FIRST: share.js's combo strip calls it rather than carrying its
     own copy of the double/treble rule, and throws by design if it is absent.
     A stub here would defeat the point — the assertions below about what a
     combo strip draws have to run against the real rule. */
  vm.runInContext(readFileSync(join(root, 'assets', 'accas.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(root, 'assets', 'share.js'), 'utf8'), ctx);
  return ctx;
}

const drawn = [];
const placed = [];
const sb = makeSandbox(drawn, placed);
const S = sb.PLDShare;
assert.ok(S, 'assets/share.js did not export PLDShare');

/* ---- every desk has an identity ---------------------------------------- */
for (const code of ['PL', 'EFLC', 'LL', 'ALL']) {
  const t = S.theme(code);
  assert.ok(t && t.strap && t.mark && t.slug, `theme ${code} is incomplete`);
  assert.ok(/^#[0-9a-f]{6}$/i.test(t.from) && /^#[0-9a-f]{6}$/i.test(t.to),
    `theme ${code} has a malformed gradient`);
}
/* Two desks sharing a wordmark would make their cards indistinguishable once
   posted, which is the whole job of the wordmark. */
const marks = ['PL', 'EFLC', 'LL', 'ALL'].map((c) => S.theme(c).mark);
assert.equal(new Set(marks).size, marks.length, `duplicate wordmarks: ${marks.join(', ')}`);
const slugs = ['PL', 'EFLC', 'LL', 'ALL'].map((c) => S.theme(c).slug);
assert.equal(new Set(slugs).size, slugs.length,
  `duplicate filename slugs — cards would overwrite each other in Downloads: ${slugs.join(', ')}`);

/* ---- the adapter says what the desk says -------------------------------- */
/* Built from the shape priceFixture() returns, so a change to that shape
   fails here rather than on someone's timeline. */
const priced = {
  fx: { id: 42, d: '2026-08-15T14:00:00+00:00', r: 1, h: 'CHA', a: 'DER', ref: null },
  ref: { ref: { n: 'A Referee', ypg: 4.86 }, name: 'A Referee', appointed: true },
  factor: 1.12,
  home: { ps: [0.2, 0.1], top: [{ p: { n: 'H One', p: 'DF', f: 1.2 }, prob: 0.21 }] },
  away: { ps: [0.3, 0.1], top: [{ p: { n: 'A One', p: 'MF', f: 1.4 }, prob: 0.33 }] },
  m: { expected: 4.04, expectedHome: 1.9, expectedAway: 2.1,
       over: { 3.5: 0.586, 4.5: 0.379, 5.5: 0.212 }, bothCarded: 0.776 }
};
const ctx = {
  league: 'EFLC', seasonLabel: 'EFL Championship 2026-27', roundWord: 'Matchday',
  clubBy: { CHA: { name: 'Charlton Athletic' }, DER: { name: 'Derby County' } },
  whenText: () => 'Sat, Aug 15, 15:00'
};
const spec = S.deskMatchSpec(priced, ctx);
assert.equal(spec.title, 'Charlton Athletic v Derby County', spec.title);
assert.ok(spec.subtitle.includes('Matchday 1'), spec.subtitle);
assert.ok(spec.refLine.includes('A Referee') && spec.refLine.includes('4.86'), spec.refLine);
assert.equal(spec.heat, 4.04);
/* Candidates must be BOTH sides, sorted — a card that lists only the home
   team's names looks complete and is half a match. */
assert.equal(spec.candidates.length, 2, JSON.stringify(spec.candidates));
assert.equal(spec.candidates[0].name, 'A One', 'candidates are not sorted by probability');
assert.ok(spec.candidates.some((c) => c.club === 'CHA')
       && spec.candidates.some((c) => c.club === 'DER'), 'one side is missing');
/* The markets on the card are the markets on the page. */
const mk = Object.fromEntries(spec.markets.map((m) => [m.label, m.value]));
assert.equal(mk['Home expected'], '1.9');
assert.equal(mk['Away expected'], '2.1');
assert.equal(mk['Over 3.5'], '59%');
assert.equal(mk['Both teams carded'], '78%');
assert.ok(/\.png$/.test(spec.filename) && spec.filename.startsWith('eflc-bookings-'), spec.filename);

/* ---- the basis the price was computed on travels with the card ---------- */
/* A card is read by people who cannot see the desk it came from, so a
   probability posted without its condition is a stronger claim than the model
   supports. This USED to be `lineupsConfirmed`, a button the reader clicked
   once they had seen the team sheet — so the card asserted something nobody
   had checked unless somebody remembered to. The desks harvest the XI now, so
   the pricing itself knows, and `pricedOffXI` states it.
   Guarded here because the check that covered the old flag lived in the file
   that was removed with it. Three states, because silence is one of them. */
{
  const off = S.deskMatchSpec(priced, { ...ctx, pricedOffXI: false });
  assert.ok(/lineups not out/i.test(off.subtitle),
    `a card priced off expected minutes does not say so: ${off.subtitle}`);
  const on = S.deskMatchSpec(priced, { ...ctx, pricedOffXI: true });
  assert.ok(/confirmed XI/i.test(on.subtitle),
    `a card priced off a real team sheet does not say so: ${on.subtitle}`);
  assert.ok(!/lineups not out/i.test(on.subtitle),
    'a card priced off the XI still carries the expected-minutes caveat');
  /* Silence when the desk reports no basis: saying "lineups not out" for a
     caller that never answered would be inventing the caveat. */
  const quiet = S.deskMatchSpec(priced, ctx);
  assert.ok(!/lineups|confirmed XI/i.test(quiet.subtitle),
    `a card whose desk reports no basis still claims one: ${quiet.subtitle}`);
}

/* A fixture with no referee must say so rather than implying one. */
const noRef = S.deskMatchSpec(
  { ...priced, ref: { ref: null, name: null, appointed: false } }, ctx);
assert.ok(/not yet appointed/i.test(noRef.refLine), noRef.refLine);

/* ---- the round card ----------------------------------------------------- */
const round = S.deskRoundSpec([priced], { ...ctx, round: 1 });
assert.ok(round.title.includes('Matchday 1'), round.title);
assert.equal(round.fixtures.length, 1);
assert.equal(round.fixtures[0].heat, 4.04);
assert.equal(round.legs.length, 1, 'the acca leg pool is empty');
assert.equal(round.legs[0].name, 'A One');

/* ---- it actually draws, and draws the numbers --------------------------- */
drawn.length = 0;
const blob = await S.matchCard(spec);
assert.ok(blob && blob.__blob, 'matchCard did not produce a blob');
const text = drawn.join('\n');
for (const need of ['Charlton Athletic v Derby County', 'A One', 'H One',
                    'MOST LIKELY BOOKED', 'TEAM CARD MARKETS', '1.9', '2.1', '59%',
                    'CHAMPIONSHIP BOOKINGS']) {
  assert.ok(text.includes(need), `the match card never drew ${JSON.stringify(need)}`);
}
/* The probabilities on the card are the probabilities in the spec. */
assert.ok(text.includes('33%') && text.includes('21%'),
  'the card drew probabilities that are not the ones it was given');
/* Every card carries the 18+ line. It is the one piece of text that is not
   negotiable, and it is easy to lose in a layout change. */
assert.ok(/18\+/.test(text) && /begambleaware/.test(text),
  'a share card went out without the 18+ / BeGambleAware line');

drawn.length = 0;
const blob2 = await S.roundCard(round);
assert.ok(blob2 && blob2.__blob, 'roundCard did not produce a blob');
const text2 = drawn.join('\n');
assert.ok(/18\+/.test(text2) && /begambleaware/.test(text2),
  'the round card went out without the 18+ / BeGambleAware line');
assert.ok(text2.includes('CHA') && text2.includes('DER'), 'the round card lost its clubs');

/* A combined card must label each row's league — without the tag a reader
   cannot tell which competition a fixture belongs to. */
drawn.length = 0;
/* The subtitle deliberately does NOT name the leagues: with "EFLC · LL" in it
   the assertion below passed even when the per-row tag was never drawn, which
   is precisely the regression it exists to catch. */
await S.roundCard({
  league: 'ALL', title: 'Sat, Aug 15, 2026', subtitle: 'two leagues, hottest first',
  fixtures: [{ home: 'CHA', away: 'DER', heat: 4.0, heatLabel: 'cards', tag: 'EFLC',
               top: { name: 'A One', prob: 0.33 } },
             { home: 'RMA', away: 'BAR', heat: 5.1, heatLabel: 'cards', tag: 'LL',
               top: { name: 'B Two', prob: 0.41 } }],
  legs: [{ name: 'B Two', club: 'RMA', prob: 0.41 }, { name: 'A One', club: 'CHA', prob: 0.33 }]
});
const text3 = drawn.join('\n');
assert.ok(text3.includes('EFLC') && text3.includes('LL'),
  'the combined card did not label which league each fixture is from');
assert.ok(text3.includes('BOOKINGS DESK'), 'the combined card lost its wordmark');

/* ---- the calendar card --------------------------------------------------- */
/* This one summarises ~1,300 fixtures in eight rows, so the assertions are
   mostly about what it must NOT be allowed to imply. */
drawn.length = 0;
const calBlob = await S.calendarCard({
  league: 'ALL', title: 'The season\'s hottest cards', subtitle: 'Aug – May',
  /* Deliberately NOT the same numbers as `coverage` below. With 128/1312 in
     the stat band too, the denominator assertion passed with the coverage line
     deleted — the band was satisfying it. Same trap as the league-tag test
     above, and it caught nothing until the numbers were separated. */
  stats: [{ value: 7, label: 'match dates' }, { value: 9, label: 'fixtures priced' }],
  fixtures: [
    { date: 'Sun, Nov 1', home: 'GET', away: 'SEV', tag: 'LL', heat: 4.8,
      top: { name: 'Carmona', prob: 0.27 } },
    { date: 'Sat, Oct 24', home: 'CHE', away: 'TOT', tag: 'PL', heat: 4.5,
      top: { name: 'Romero', prob: 0.38 } }],
  /* Carmona twice, as ranking across dates genuinely produces. */
  legs: [{ name: 'Carmona', club: 'SEV', prob: 0.27 },
         { name: 'Carmona', club: 'SEV', prob: 0.27 },
         { name: 'Romero', club: 'TOT', prob: 0.38 },
         { name: 'Veltman', club: 'BHA', prob: 0.33 }],
  coverage: { dates: 128, matches: 1312, shown: 2, filter: 'from today' }
});
assert.ok(calBlob && calBlob.__blob, 'calendarCard did not produce a blob');
const cal = drawn.join('\n');
assert.ok(/18\+/.test(cal) && /begambleaware/.test(cal),
  'the calendar card went out without the 18+ / BeGambleAware line');
/* THE DENOMINATOR. Eight rows out of 1,312 matches is a severe cut, and a card
   that shows the cut without the total reads as a complete picture of the
   season. This line is the difference between a summary and an overclaim. */
assert.ok(/of 1312 matches across 128 dates/.test(cal),
  'the calendar card never drew how much of the calendar it left out');
assert.ok(cal.includes('LL') && cal.includes('PL'),
  'the calendar card did not label which league each fixture is from');
assert.ok(cal.includes('Sun, Nov 1'),
  'the calendar card lost the date column, which is what makes it a calendar');

/* NO PLAYER TWICE IN A COMBO. Multiplying a player's probability by his own is
   the same event counted twice. It cannot happen on a single date, so it is
   only ever reachable from this card — and the dedupe must survive the cut to
   three, not be applied to an already-cut list. */
const combo = drawn.filter((t) => / \+ /.test(t));
assert.ok(combo.length, 'the calendar card drew no acca rows at all');
for (const line of combo) {
  const names = line.split(' + ').map((s) => s.trim());
  assert.equal(new Set(names).size, names.length,
    `an acca repeats a player: ${JSON.stringify(line)}`);
}
assert.ok(combo.some((l) => l.split(' + ').length === 3),
  'the acca never reached a treble — the dedupe is cutting before it selects, ' +
  'which is what left a card of eight rated fixtures saying "not enough players"');

/* ---- the acca card ------------------------------------------------------ */
/*
 * These cards are the tracker's record leaving the site, and the tracker only
 * means anything because it publishes losses. So the assertions below are
 * mostly about the LOSING card: a winners-only share button turns a record
 * built to be checked back into an advert, and it would do that while every
 * test about drawing a card still passed.
 *
 * The numbers are chosen so no assertion can be satisfied by a different piece
 * of text on the same card — the stake, the price, the returns and the P/L are
 * all distinct, which is the trap that has caught several checks in this file.
 */
const accaRow = {
  id: 'PL:2026-27:1', league: 'PL', season: '2026-27', matchday: 1,
  kickoff_first: '2026-08-22T14:00:00+00:00',
  legs: 3, stake: 0.5, fair_odds: 72.67, priced_odds: 60.36, status: 'open', pl: null
};
const accaLegs = [
  { leg: 1, player: 'James Garner', club: 'EVE', prob: 0.26, priced_odds: 3.62, carded: null },
  { leg: 2, player: 'Moisés Caicedo', club: 'CHE', prob: 0.238, priced_odds: 3.95, carded: null },
  { leg: 3, player: 'Ethan Ampadu', club: 'LEE', prob: 0.223, priced_odds: 4.23, carded: null }
];

const aSpec = S.accaRowSpec(accaRow, accaLegs);
assert.equal(aSpec.league, 'PL');
assert.equal(aSpec.title, 'Matchday 1', aSpec.title);
assert.equal(aSpec.odds, 60.36, 'the spec did not take the PRICED odds');
assert.notEqual(aSpec.odds, accaRow.fair_odds,
  'the card is showing the fair price — nobody could have backed that number');
assert.equal(aSpec.legs.length, 3);
assert.equal(aSpec.legs[0].odds, 3.62, 'a leg lost its priced odds');
assert.ok(/\.png$/.test(aSpec.filename) && aSpec.filename.startsWith('pl-bookings-'),
  aSpec.filename);

/* matchday null is not missing data — it is what makes an acca the
   cross-league one, and a spec that defaulted it away would title every
   cross-league card "Matchday undefined". */
const allSpec = S.accaRowSpec(
  { ...accaRow, id: 'ALL:2026-27:2026-08-15', league: 'ALL', matchday: null,
    kickoff_first: '2026-08-15T14:00:00+00:00' }, accaLegs);
assert.equal(allSpec.title, 'Across the leagues', allSpec.title);
assert.notEqual(allSpec.filename, aSpec.filename,
  'two accas share a filename — the second would overwrite the first in Downloads');

drawn.length = 0;
const openBlob = await S.accaCard(aSpec);
assert.ok(openBlob && openBlob.__blob,
  'accaCard did not produce a blob — download() would save a 0-byte PNG');
const aOpen = drawn.join('\n');
for (const need of ['Matchday 1', 'James Garner', 'EVE', 'Ethan Ampadu',
                    '26%', '3.62', '£0.50', '60.36', '£30.18', 'PL BOOKINGS DESK']) {
  assert.ok(aOpen.includes(need), `the open acca card never drew ${JSON.stringify(need)}`);
}
assert.ok(aOpen.includes('OPEN · 3 LEGS'), 'the open card does not say it is open');
assert.ok(!/\bWON\b|\bLOST\b/.test(aOpen),
  'an unsettled acca card claims a result');
assert.ok(/18\+/.test(aOpen) && /begambleaware/.test(aOpen),
  'the acca card went out without the 18+ / BeGambleAware line');
/* The margin disclosure. 60.36 is a fair-price treble shaded once per leg, and
   a card that prints it without saying so is advertising a number that was
   never on offer. */
assert.ok(/margin/i.test(aOpen),
  'the acca card shows a treble price without disclosing the margin');

/* THE LOSING CARD. This is the one that matters. */
drawn.length = 0;
await S.accaCard(S.accaRowSpec(
  { ...accaRow, status: 'lost', pl: -0.5 },
  [{ ...accaLegs[0], carded: true }, { ...accaLegs[1], carded: false },
   { ...accaLegs[2], carded: true }]));
const aLost = drawn.join('\n');
assert.ok(aLost.includes('LOST'), 'a lost acca card does not say it lost');
assert.ok(!aLost.includes('WON'), 'a lost acca card also says WON');
assert.ok(aLost.includes('−£0.50'),
  'the lost card does not show the loss — the P/L is the point of the record');
/* Per-leg marks: "it lost" says nothing about the model, and a card that
   hides WHICH leg failed cannot be checked against the fixture it came from. */
assert.ok(aLost.includes('✗') && aLost.includes('✓'),
  'the settled card does not mark which legs came in');
assert.ok(/WOULD HAVE RETURNED/.test(aLost),
  'the settled card presents its return as if the acca were still live');

drawn.length = 0;
await S.accaCard(S.accaRowSpec({ ...accaRow, status: 'won', pl: 29.68 },
  accaLegs.map((l) => ({ ...l, carded: true }))));
const aWon = drawn.join('\n');
assert.ok(aWon.includes('WON') && !aWon.includes('LOST'), 'the won card is mislabelled');
assert.ok(aWon.includes('+£29.68'), 'the won card does not show the profit');
assert.ok(!aWon.includes('✗'), 'a won card marks one of its legs as failed');
assert.ok(/RETURNED/.test(aWon) && !/WOULD HAVE RETURNED/.test(aWon),
  'a winning acca is labelled "would have returned" — it did return');
assert.ok(/RETURNS/.test(aOpen) && !/RETURNED/.test(aOpen),
  'an open acca is labelled in the past tense');

/* THE CROSS-LEAGUE CARD MUST NAME ITS DIVISIONS. Three club codes and no tag
   leaves the reader to work out which competition each leg came from — the
   same defect the combined round card is guarded against above. */
drawn.length = 0;
await S.accaCard(S.accaRowSpec(
  { ...accaRow, league: 'ALL', matchday: null },
  [{ ...accaLegs[0], club: 'SEV', league: 'LL' },
   { ...accaLegs[1], club: 'GET', league: 'LL' },
   { ...accaLegs[2], club: 'QPR', league: 'EFLC' }]));
const aAll = drawn.join('\n');
/* Asserted on the LEG list, not the whole card: the wordmark and strap say
   "BOOKINGS DESK · ALL LEAGUES", and an earlier version of this check passed
   on the strap alone with every per-leg tag deleted. */
const legTags = drawn.filter((t) => t === 'LL' || t === 'EFLC');
assert.ok(legTags.filter((t) => t === 'LL').length === 2
       && legTags.filter((t) => t === 'EFLC').length === 1,
  'the cross-league acca card does not tag each leg with its division — it ' +
  `drew ${JSON.stringify(legTags)}`);
assert.ok(aAll.includes('Across the leagues'), 'the cross-league card lost its title');

/* A single-division card must NOT repeat its own league on every row: the
   band already says it, and three redundant tags is noise. */
drawn.length = 0;
await S.accaCard(S.accaRowSpec(accaRow,
  accaLegs.map((l) => ({ ...l, league: 'PL' }))));
assert.equal(drawn.filter((t) => t === 'PL').length, 0,
  'a single-division card tags every leg with the league already in its header');

/* NINE LEGS MUST FIT. The nine-folds made eight and nine reachable, and the
   cap was seven — so this card would have drawn seven rows under a price for
   all nine, which is the false claim the truncation notice exists to prevent.
   Every leg has to be on the card. */
drawn.length = 0;
const many = Array.from({ length: 9 }, (_, i) => ({
  leg: i + 1, player: 'Player ' + (i + 1), club: 'ABC', prob: 0.2,
  priced_odds: 5, carded: null
}));
await S.accaCard(S.accaRowSpec({ ...accaRow, legs: 9 }, many));
const aNine = drawn.join('\n');
assert.ok(aNine.includes('OPEN · 9 LEGS'), 'the nine-leg card miscounts itself');
for (let i = 1; i <= 9; i++) {
  assert.ok(aNine.includes('Player ' + i),
    `leg ${i} of nine was never drawn — the card is short of the price it prints`);
}
assert.ok(!/not shown/.test(aNine),
  'a nine-leg card claims it was truncated when every leg fits');

/* Truncation must still disclose itself ABOVE the new cap. Unreachable today,
   which is exactly why it would ship broken. */
drawn.length = 0;
const tooMany = Array.from({ length: 13 }, (_, i) => ({
  leg: i + 1, player: 'Player ' + (i + 1), club: 'ABC', prob: 0.2,
  priced_odds: 5, carded: null
}));
await S.accaCard(S.accaRowSpec({ ...accaRow, legs: 13 }, tooMany));
const aCut = drawn.join('\n');
assert.ok(aCut.includes('OPEN · 13 LEGS'),
  'a truncated card counts only the legs it drew, describing itself as complete');
assert.ok(/not shown/.test(aCut) && /all 13/.test(aCut),
  'the card dropped legs without saying so, while pricing all of them');

/* ---- the nine-folds ------------------------------------------------------
 * Their legs are MATCH markets, not players, and they reach the card through
 * nineFoldSpec. Two things could go wrong quietly: the market could be lost,
 * leaving nine fixture names with no indication of what was bet on them; and
 * a cross-league card could drop its per-leg division tags, which on this one
 * matters more than anywhere else because six of the nine legs come from a
 * different competition than the other three.
 */
drawn.length = 0;
placed.length = 0;
const nineSpec = S.nineFoldSpec({
  league: 'ALL',
  title: 'Card nine-fold',
  subtitle: 'Fri, 21 Aug 2026 – Thu, 27 Aug 2026',
  legs: [
    { fx: 'ARS v COV', market: 'ARS to win', prob: 0.689, code: 'PL' },
    { fx: 'HUL v MUN', market: 'MUN to win', prob: 0.612, code: 'PL' },
    { fx: 'MCI v BOU', market: 'MCI to win', prob: 0.542, code: 'PL' },
    { fx: 'MAL v DEP', market: 'Both teams carded', prob: 0.800, code: 'LL' },
    { fx: 'OSA v LEV', market: 'Both teams carded', prob: 0.798, code: 'LL' },
    { fx: 'BET v RSO', market: 'Both teams carded', prob: 0.765, code: 'LL' },
    { fx: 'GET v RAC', market: 'Over 2.5 cards', prob: 0.868, code: 'LL' },
    { fx: 'BUR v WHU', market: 'Over 2.5 cards', prob: 0.824, code: 'EFLC' },
    { fx: 'FUL v CHE', market: 'Over 2.5 cards', prob: 0.799, code: 'PL' }
  ],
  price: { legs: 9, prob: 0.0637, fairOdds: 15.69, pricedOdds: 8.99, marginDrag: 0.427 }
});
const nineBlob = await S.accaCard(nineSpec);
assert.ok(nineBlob && nineBlob.__blob, 'the nine-fold card produced no blob');
const aNF = drawn.join('\n');
for (let i = 1; i <= 9; i++) void i;
for (const need of ['ARS v COV', 'BET v RSO', 'FUL v CHE', 'OPEN · 9 LEGS', '8.99']) {
  assert.ok(aNF.includes(need), `the nine-fold card never drew ${JSON.stringify(need)}`);
}
/* THE MARKET, on every leg. Nine fixtures with no market is a card that says
   nothing about what was actually bet — and each of the three markets has to
   survive, not just whichever one happened to be first. */
for (const mkt of ['ARS to win', 'Both teams carded', 'Over 2.5 cards']) {
  assert.ok(aNF.includes(mkt), `the nine-fold card lost the market "${mkt}"`);
}
/* Per-leg division tags: 4 PL, 4 LL, 1 EFLC. Counted, not merely present —
   the band says "ALL LEAGUES" and an earlier version of the sibling check
   passed on the strap alone with every per-leg tag deleted. */
const nfTags = drawn.filter((t) => t === 'PL' || t === 'LL' || t === 'EFLC');
assert.equal(nfTags.filter((t) => t === 'PL').length, 4,
  `the nine-fold card tagged ${nfTags.filter((t) => t === 'PL').length} legs PL, not 4`);
assert.equal(nfTags.filter((t) => t === 'LL').length, 4);
assert.equal(nfTags.filter((t) => t === 'EFLC').length, 1);
/* MODEL CHANCE comes from the acca's own fair odds, not from remultiplying
   rounded leg probabilities — 1/15.69 is 6.37%, and the product of the nine
   rounded percentages is not. */
assert.ok(aNF.includes('6.37%'),
  'the nine-fold card recomputed its own model chance instead of using the ' +
  'fair odds the page printed');
/* The legs are FAIR odds and the total is MARGINED, which are not the same
   kind of number — the footer has to say so or the card reads as an
   arithmetic error. */
assert.ok(/fair odds/i.test(aNF) && /margin/i.test(aNF),
  'the nine-fold card does not say its legs and its total are priced differently');
/* NOTHING ON A ROW MAY SIT ON TOP OF ANYTHING ELSE. The compact row draws the
   division chip, the fixture, the market and two numbers on ONE baseline, and
   the first version placed the chip and the fixture at the same x — so every
   tagged row rendered as "PL⟩S v COV", the chip painted over the first two
   characters of the fixture. Nothing threw, every text was drawn, and every
   assertion above passed: they check WHAT was drawn, and this is a question
   about WHERE.

   Found by rendering a card and looking at it. This is the check that would
   have found it instead: same-baseline texts, sorted by x, must not overlap. */
{
  /* A VERTICAL TOLERANCE, not an exact baseline match. The chip's baseline is
     five pixels above the fixture's — different `y`, same visual line, and
     glyphs 28px tall. Grouping on exact y was the first version of this check
     and it passed on the very bug it was written for. 18px is under the
     smallest row (56) and over the largest within-row baseline offset (5). */
  const SAME_LINE = 18;
  const overlaps = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (Math.abs(a.y - b.y) >= SAME_LINE) continue;
      if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5) {
        overlaps.push(`"${a.t}" (${Math.round(a.x0)}–${Math.round(a.x1)}) and ` +
                      `"${b.t}" (${Math.round(b.x0)}–${Math.round(b.x1)}) near y=${a.y}`);
      }
    }
  }
  assert.equal(overlaps.length, 0,
    'the nine-fold card draws text over text: ' + overlaps.slice(0, 3).join('; '));
  /* And the check has to have had something to look at — an empty `placed`
     would pass silently and pin nothing at all. */
  assert.ok(placed.length > 20,
    `only ${placed.length} placed texts recorded — the geometry check is not running`);
}

/* AND THE NOTE HAS TO SURVIVE THE WIDEST WORDMARK. footer() gives the note
   whatever room the 18+ line and the mark leave and truncates the remainder,
   so a note written against "BOOKINGS DESK · ALL LEAGUES" was cut mid-word on
   the Premier League card ("Research, not …"). Checked on the card with the
   longest mark, not on a convenient one. */
{
  const note = S.nineFoldSpec({ league: 'PL', title: 'T', subtitle: 'S',
                                legs: [], price: {} }).note;
  for (const league of Object.keys(S.THEMES)) {
    drawn.length = 0;
    await S.accaCard(S.nineFoldSpec({
      league, title: 'Nine-fold', subtitle: 'x',
      legs: [{ fx: 'A v B', market: 'm', prob: 0.5, code: league }],
      price: { fairOdds: 2, pricedOdds: 1.9 }
    }));
    assert.ok(drawn.includes(note),
      `the footer note is truncated on the ${league} card — it drew ` +
      `${JSON.stringify(drawn.filter((t) => /margined|fair odds/i.test(t)))} ` +
      `rather than ${JSON.stringify(note)}`);
  }
}

/* A SINGLE-DIVISION nine-fold must not tag every row with the league its own
   band already names. This is the goals acca on the Premier League desk. */
drawn.length = 0;
await S.accaCard(S.nineFoldSpec({
  league: 'PL', title: 'Goals nine-fold', subtitle: '2026-27 · Gameweek 1',
  legs: [
    { fx: 'ARS v COV', market: 'ARS to win', prob: 0.689, code: 'PL' },
    { fx: 'NEW v LIV', market: 'Both teams to score', prob: 0.667, code: 'PL' },
    { fx: 'BHA v AVL', market: 'Over 1.5 goals', prob: 0.784, code: 'PL' }
  ],
  price: { legs: 3, prob: 0.36, fairOdds: 2.78, pricedOdds: 2.36, marginDrag: 0.15 }
}));
const aGoals = drawn.join('\n');
assert.ok(aGoals.includes('Goals nine-fold') && aGoals.includes('ARS v COV'));
assert.equal(drawn.filter((t) => t === 'PL').length, 0,
  'the Premier League goals card tags every leg with the league in its own header');

/* roundRect must bound its own radius. arcTo does not: a pill drawn with
   r=999 swept arcs across the entire card the first time this was tried, and
   nothing threw. */
{
  const radii = [];
  const rec = { beginPath() {}, moveTo() {}, closePath() {},
                arcTo(_a, _b, _c, _d, r) { radii.push(r); } };
  sb.globalThis.PLDShare.roundRect(rec, 0, 0, 200, 26, 999);
  assert.ok(radii.length && Math.max(...radii) <= 13,
    `roundRect passed a radius of ${Math.max(...radii)} for a 26px-tall box`);
}

/* ---- the pages are wired to it ------------------------------------------ */
for (const [page, needs] of [
  ['eflc.html', ['assets/share.js', 'PLDShare', 'deskMatchSpec', 'fxShareBtn', 'data-share']],
  ['laliga.html', ['assets/share.js', 'PLDShare', 'deskMatchSpec', 'fxShareBtn', 'data-share']],
  ['today.html', ['assets/share.js', 'PLDShare', 'roundCard', 'data-frame.html']]
]) {
  if (!existsSync(join(root, page))) continue;
  const src = readFileSync(join(root, page), 'utf8');
  for (const n of needs) {
    assert.ok(src.includes(n), `${page} no longer references ${n}`);
  }
}

/* today.html reads the frames' published __data, never their globals. The
   datasets use `const`, which never becomes a window property, so reading
   contentWindow.CLUBS silently yields nothing at all. */
/* Source assertions must look at CODE, not prose. Three checks in this file
   have already been fooled by a comment containing the exact string they were
   searching for — including the one immediately below, which passed while the
   PL frame had stopped loading the card model. */
function codeOnly(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/* THE /today PAGE IS TWO FILES NOW. Its cross-league engine — the frames, the
   per-fixture pricing, the day index — moved to assets/deskboards.js so the
   /accas page could price the same fixtures without a second engine. These
   assertions are about that code, so they read both halves. */
const todaySrc = readFileSync(join(root, 'today.html'), 'utf8')
  + '\n' + readFileSync(join(root, 'assets', 'deskboards.js'), 'utf8');
assert.ok(todaySrc.includes('__data'),
  'today.html must read the frame\'s published __data — contentWindow.CLUBS is ' +
  'always undefined for a top-level const');
/* Comments stripped first. The previous version of this check tripped on the
   COMMENT that explains the bug — the same way an earlier guard in
   check-eflc.mjs failed on a comment rather than on code. A check that cannot
   tell prose from code will eventually be deleted by whoever it annoys. */
const todayCode = codeOnly(todaySrc);
assert.ok(!/contentWindow\.(CLUBS|REFS)\b/.test(todayCode),
  'today.html reads a const off contentWindow, which is always undefined');

/* The frame only loads files from its allow-list: it writes a script tag out
   of the URL hash, which anyone can put in a link. */
const frameSrc = codeOnly(readFileSync(join(root, 'data-frame.html'), 'utf8'));
assert.ok(/ALLOWED\s*=/.test(frameSrc) && frameSrc.includes('location.hash'),
  'data-frame.html must keep its allow-list');
assert.ok(!/document\.write\([^)]*location\.hash/.test(frameSrc),
  'data-frame.html interpolates the hash straight into a script tag');

/* ---- the Premier League model is shared, not copied ---------------------- */
/* /today prices a PL fixture through assets/plmodel.js, and so does the desk.
   Two implementations of that wiring would print different numbers for the
   same match on two pages of the same site, which is the one thing a combined
   view must not do. These checks are cheap; the failure is not. */
const plCtx = { PLDCore: JSON.parse('{}'), console };
plCtx.globalThis = plCtx;
vm.createContext(plCtx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), plCtx);
vm.runInContext(readFileSync(join(root, 'assets', 'plmodel.js'), 'utf8'), plCtx);
const PLModel = plCtx.PLModel;
assert.ok(PLModel && typeof PLModel.create === 'function',
  'assets/plmodel.js did not export PLModel');
assert.ok(Array.isArray(PLModel.DERBIES) && PLModel.DERBIES.length >= 8,
  `the derby list looks wrong: ${PLModel.DERBIES && PLModel.DERBIES.length} entries`);
for (const d of PLModel.DERBIES) {
  assert.ok(Array.isArray(d) && d.length === 2 && d.every((x) => /^[A-Z]{3}$/.test(x)),
    `malformed derby entry ${JSON.stringify(d)}`);
}

/* index.html must READ that list rather than keep its own. A second copy is
   not a syntax error and not visible on either page — it just quietly moves
   every player's number on a derby, on one page only. */
const deskSrc = readFileSync(join(root, 'index.html'), 'utf8');
assert.ok(deskSrc.includes('assets/plmodel.js'),
  'index.html no longer loads assets/plmodel.js');
assert.ok(/const DERBIES\s*=\s*\(typeof PLModel/.test(deskSrc),
  'index.html has its own derby list again — it must read PLModel.DERBIES, or ' +
  'the desk and /today will disagree about which fixtures are derbies');

/* The model reproduces the desk's calls over the shipped data. */
const plDataCtx = {};
vm.createContext(plDataCtx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), plDataCtx);
vm.runInContext(readFileSync(join(root, 'data', 'pl_data.js'), 'utf8'), plDataCtx);
const { PL_PLAYERS, REFS: PLREFS, CLUBS: PLCLUBS } =
  vm.runInContext('({PL_PLAYERS, REFS, CLUBS})', plDataCtx);
const model = existsSync(join(root, 'data', 'model.js'))
  ? JSON.parse(JSON.stringify((await import(
      'file://' + join(root, 'data', 'model.js'))).default)) : null;
const M = PLModel.create({ model, sim: null, refs: PLREFS, players: PL_PLAYERS });
const someBoard = M.board(PLCLUBS[0].short, PLCLUBS[1].short, null, false);
assert.ok(someBoard && someBoard.expected > 1 && someBoard.expected < 9,
  `the PL model priced a fixture at ${someBoard && someBoard.expected} expected cards`);
assert.ok(M.isDerby('ARS', 'TOT') && !M.isDerby('ARS', 'BOU'),
  'the derby lookup is not working');
/* Order must not matter: a derby is a derby whichever club is at home. */
assert.equal(M.isDerby('TOT', 'ARS'), M.isDerby('ARS', 'TOT'));

/* ---- /today carries every league it can ---------------------------------- */
const frameSrc2 = codeOnly(readFileSync(join(root, 'data-frame.html'), 'utf8'));
for (const code of ['pl', 'eflc', 'laliga']) {
  assert.ok(new RegExp(`\\b${code}:\\s*\\[`).test(frameSrc2),
    `data-frame.html cannot load the ${code} dataset`);
}
assert.ok(/data\/model\.js/.test(frameSrc2) && /data\/sim_model\.js/.test(frameSrc2),
  'the PL frame must load the card model and the match model, or /today would ' +
  'price the Premier League with a reduced model and print a different number ' +
  'for the same match than the desk does');
assert.ok(todaySrc.includes('PLModel'),
  'today.html must price the Premier League through the shared model');
for (const code of ['PL', 'EFLC', 'LL']) {
  assert.ok(new RegExp(`code:\\s*'${code}'`).test(todaySrc),
    `today.html no longer lists ${code} as a source`);
}

/* ---- the two views must stay one implementation -------------------------- */
/* One date at a time, or every date consolidated into a calendar. These are
   now two ROUTES off one file — `/` and /today — rather than two radio
   buttons, but nothing below changes because of that: they are still two
   renderings of the same priced rows, and the whole value of that is that a
   fixture reads identically either way. The things worth pinning are the ones
   that would let them drift apart silently.
   ONE FILE IS THE POINT. Splitting today.html in two would have forked the
   pricing, the confirmed-XI join and both card builders — so the first thing
   asserted is that the split is a route, not a copy. */
assert.ok(/data-route/.test(todaySrc),
  'today.html no longer reads a route, so `/` and /today are not two views of ' +
  'one file — check that the second page is not a forked copy of this one');
for (const v of ['renderOne', 'renderAll']) {
  assert.ok(new RegExp(`function ${v}\\(`).test(todayCode),
    `today.html has lost its ${v}() view`);
}
assert.ok(/if \(all\) renderAll\(\); else renderOne\(\);/.test(todayCode),
  'render() no longer chooses between the two views, so one route can no ' +
  'longer reach its own content');

/* ONE row renderer. Two would let the calendar and the single date show
   different columns, or sort differently, for the same match. */
assert.equal((todayCode.match(/function rowHTML\b/g) || []).length, 1,
  'today.html must build a fixture row in exactly one place');
/* Both paths must reach it: the single date calls rowHTML directly, the
   calendar reaches it through dayGroupHTML. Checked as a chain rather than by
   scanning each function for the name, because only one of them calls it. */
const body = (name) => {
  const m = new RegExp(`function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(todayCode);
  assert.ok(m, `today.html has no ${name}()`);
  return m[1];
};
assert.ok(/rowHTML/.test(body('renderOne')),
  'renderOne() does not use the shared row renderer');
assert.ok(/dayGroupHTML/.test(body('renderAll')),
  'renderAll() does not build its dates from dayGroupHTML');
assert.ok(/rowHTML/.test(body('dayGroupHTML')),
  'dayGroupHTML() does not use the shared row renderer, so the calendar and ' +
  'the single date could show the same fixture differently');
/* And both must order a date the same way, or a match would sit in one place
   when picked and another when scrolled to. */
assert.ok(/rowsFor/.test(body('dayGroupHTML')) && /rowsFor/.test(body('selected')),
  'the two views do not share rowsFor(), so they can sort a date differently');

/* ONE card builder, and it must take the date as an argument. This is the
   failure that motivated the assertion: the calendar draws a share button per
   date, so a shareDay() that read the #day dropdown instead of its argument
   would make all ~128 buttons export the SAME card — every one of them
   downloading successfully, with the wrong day's fixtures on it. */
assert.equal((todayCode.match(/S\.roundCard\(/g) || []).length, 1,
  'today.html must build the combined card in exactly one place');
const share = /function shareDay\(([^)]*)\)([\s\S]*?)\n  \}/.exec(todayCode);
assert.ok(share, 'today.html has no shareDay()');
assert.ok(/^\s*key\b/.test(share[1]),
  `shareDay takes (${share[1].trim()}) — it must take the date, not read the dropdown`);
assert.ok(!/#day/.test(share[2]),
  'shareDay reads the #day dropdown, so every calendar date would export the ' +
  'selected date\'s card rather than its own');

/* The calendar's buttons are rebuilt on every render, so they must be handled
   by delegation — per-node listeners would stack a fresh set per redraw. */
assert.ok(/#list'\)\.addEventListener\(\s*'click'/.test(todayCode),
  'the calendar\'s per-date share buttons are not delegated off #list');

/* ---- the calendar card is wired to the calendar it describes ------------- */
assert.equal((todayCode.match(/S\.calendarCard\(/g) || []).length, 1,
  'today.html must build the calendar card in exactly one place');
const cardFn = body('shareCalendar');
/* It must summarise WHAT IS ON SCREEN. Building it from DAYKEYS instead of
   calendarKeys() would export the whole season while the reader is looking at
   a filtered calendar — a card that quietly disagrees with the page that
   produced it, which is the one thing a share card cannot do. */
assert.ok(/calendarKeys\(\)/.test(cardFn),
  'shareCalendar does not read the filtered calendar, so the card would ' +
  'describe something other than what is on screen');
assert.ok(!/\bDAYKEYS\b/.test(cardFn),
  'shareCalendar reads DAYKEYS directly, ignoring the multi-league and ' +
  'past-date filters the reader has applied');
/* The diversity caps. Without them the top eight were eight La Liga fixtures,
   six of them one club — a cross-league card showing one league. */
/* The CAPS, not merely the variables. Asserting that `perLeague` appears
   passed with the comparison deleted and only the counter left behind — the
   bookkeeping survives, the limit does not, and every row is La Liga again. */
assert.ok(/perLeague\[[^\]]+\][^;]*>=\s*3/.test(cardFn),
  'shareCalendar counts per league but no longer caps at three, so the ' +
  'highest-carding division will fill every row');
assert.ok(/if\s*\(usedClub\[/.test(cardFn),
  'shareCalendar tracks clubs but no longer skips a repeat, so one club can ' +
  'take most of the card');
assert.ok(/max 3 a league/.test(cardFn),
  'the card does not disclose that its ranking was diversified');

/* ---- the Premier League desk's goals nine-fold ---------------------------
 * Same two risks as its cross-league sibling, plus one of its own: this card
 * is the only place a reader can check the desk's own nine-fold against the
 * page, so it must draw the acca that was rendered rather than a fresh one.
 */
assert.ok(/S\.nineFoldSpec\(/.test(deskSrc) || /nineFoldSpec\(\{/.test(deskSrc),
  'index.html no longer builds its nine-fold card through the shared mapping');
{
  const i = deskSrc.indexOf('function shareRoundAcca(');
  assert.ok(i > -1, 'index.html no longer defines shareRoundAcca');
  const body = deskSrc.slice(i, deskSrc.indexOf('\nfunction ', i + 1));
  assert.equal((body.match(/S\.accaCard\(/g) || []).length, 1,
    'the desk nine-fold must build its card in exactly one place');
  assert.ok(/ROUND_BUILT\[id\]/.test(body) && !/accaAllocate/.test(body),
    'shareRoundAcca re-derives the acca instead of sharing the one rendered — ' +
    'the card and the page could then disagree');
  assert.ok(/league:"PL"/.test(body),
    'the desk nine-fold no longer declares its own league, so every leg would ' +
    'be tagged with a division the header already names');
}
assert.ok(/ROUND_BUILT=\{\};/.test(deskSrc),
  'the held nine-fold is never cleared, so hiding the card leaves a stale acca ' +
  'behind the share button');
assert.ok(/data-share-acca/.test(deskSrc),
  'the desk nine-fold has no share button');
/* Emitted only when share.js is present AND knows this spec shape — but it
   must be emitted, so the flag has to be computed rather than pinned off. */
assert.ok(/SHARE_OK\?'<button[^']*data-share-acca/.test(deskSrc),
  'the desk nine-fold share button is not gated on share.js being loadable');
/* EVALUATED, NOT READ. `SHARE_OK = false && <the right expression>` satisfies
   any regex that looks for the right expression, and pins the button off for
   everyone. So the statement is lifted out and RUN against two stub windows:
   it has to come out true when share.js is loaded and knows the spec, and
   false when it does not. No always-false prefix survives that. */
{
  const m = deskSrc.match(/const SHARE_OK=[^;]+;/);
  assert.ok(m, 'index.html no longer declares SHARE_OK');
  const evalWith = (win) => {
    const c = { window: win };
    vm.createContext(c);
    vm.runInContext(m[0].replace(/^const /, 'var ') + ' SHARE_OK;', c);
    return vm.runInContext('SHARE_OK', c);
  };
  assert.equal(evalWith({ PLDShare: { nineFoldSpec: () => {} } }), true,
    'SHARE_OK is false even with a share.js that knows nineFoldSpec — the desk ' +
    'nine-fold has no share button for anyone');
  assert.equal(evalWith({ PLDShare: {} }), false,
    'SHARE_OK ignores whether the loaded share.js knows nineFoldSpec — a cached ' +
    'older copy would draw a card with nine blank rows');
  assert.equal(evalWith({}), false, 'SHARE_OK is true with no share.js at all');
}
/* Delegated, because renderRoundAccas replaces the card body on every
   gameweek render and per-button listeners would leak one set a redraw. */
assert.ok(/accaRound"\)[\s\S]{0,200}addEventListener\("click"/.test(deskSrc),
  'the nine-fold share button is not delegated off the card');

/* Scope an assertion to one function body rather than to a 1,400-line file,
   which is how a check ends up satisfied by code three screens away. */
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i > -1, `today.html no longer defines ${name}`);
  const j = src.indexOf('\n  function ', i + 1);
  return src.slice(i, j > -1 ? j : i + 3000);
}

/* ---- the tracker offers a card for every acca, not just the good ones ---- */
/* TWO CALL SITES NOW, and they are different products: the tracker draws a
   LOGGED acca from the database, the nine-fold draws the one currently on
   screen. Counted per function rather than per file — the thing worth
   preventing is one feature building its card two ways, not the page having
   two features. */
const shareAccaFn = fnBody(todayCode, 'shareAcca');
const shareNineFn = fnBody(todayCode, 'shareNine');
assert.equal((shareAccaFn.match(/S\.accaCard\(/g) || []).length, 1,
  'the tracker must build its acca card in exactly one place');
assert.equal((shareNineFn.match(/S\.accaCard\(/g) || []).length, 1,
  'the nine-fold must build its card in exactly one place');
assert.ok(/S\.accaRowSpec\(/.test(shareAccaFn),
  'today.html builds its own acca spec instead of using the shared mapping, ' +
  'so the card and the database row can drift apart');
assert.ok(/var spec = S\.nineFoldSpec\(\{/.test(shareNineFn),
  'the nine-fold builds its own card spec instead of the shared mapping — two ' +
  'pages share a nine-fold now, and a mapping beside one reader gets copied');
/* ALL, not a league code. Six of the nine legs come from a different
   competition than the other three, so this is the one card here where the
   per-leg tags matter most — and nineFoldSpec only emits them for legs whose
   division differs from the card's own. Declaring 'LL' here would silently
   drop the tag from every La Liga row. */
assert.ok(/league: 'ALL',/.test(shareNineFn),
  'the cross-league nine-fold declares a single division, so every leg from ' +
  'that division loses its tag and the card stops naming its competitions');
/* THE CARD DRAWS WHAT IS ON SCREEN. Rebuilding the acca inside the share
   handler would let the PNG and the page print different legs, and nobody
   looking at the image could tell which was right. */
assert.ok(/NINE_BUILT/.test(shareNineFn) && !/accaAllocate/.test(shareNineFn),
  'shareNine re-derives the acca instead of sharing the one rendered — the ' +
  'card and the page could then disagree');
/* EVERY path that hides the card must drop the held acca — there are three
   (the calendar view, an unfillable window, an unpriceable one) and a stale
   one behind a hidden button is a card sharing a nine-fold the page is not
   showing. Counted, because guarding one path leaves the other two. */
assert.equal((fnBody(todayCode, 'renderNine').match(/NINE_BUILT = null/g) || []).length, 3,
  'not every hide path in renderNine clears the held nine-fold — the share ' +
  'button would draw an acca the page has stopped showing');
assert.ok(/nineShare'\)\.addEventListener\(\s*'click'/.test(todayCode),
  'the nine-fold share button is not wired');
/* AND IT HAS TO BE REVEALED. It ships `hidden` so an older cached share.js
   cannot offer a card it would draw blank, which means a render that never
   un-hides it is a feature that silently does not exist — this repo has
   shipped two whole desks that way. */
assert.ok(/\$\('#nineShare'\)\.hidden = !\(S && typeof S\.nineFoldSpec === 'function'\)/
  .test(fnBody(todayCode, 'renderNine')),
  'renderNine never reveals the nine-fold share button, so the card can only ' +
  'be shared by someone who knows the handler exists');
/* Delegated, because renderTrack replaces the whole list on every load and
   listeners bound to the buttons would be discarded with them. */
assert.ok(/#trackList'\)\.addEventListener\(\s*'click'/.test(todayCode),
  'the per-acca share buttons are not delegated off #trackList');

/* THE BUTTON IS UNCONDITIONAL. A `status === 'won'` guard around it would pass
   every other check in this file and quietly turn the record into a showreel.
   *
   * RUN, not read. The first version of this check filtered renderTrack's
   * source for the line carrying `data-share-acca` and asserted no status test
   * appeared on it — and the markup spans three lines, so the condition landed
   * on the line above and the assertion never saw it. Wrapping the emit in
   * `a.status === 'won' ? … : ''` passed. So today.html builds the row in a
   * named function and this runs it, once per status. */
const rowFn = /\n  function accaRowHTML\(a, legs\) \{([\s\S]*?)\n  \}\n/.exec(todaySrc);
assert.ok(rowFn, 'today.html has no accaRowHTML() — the tracker row must be a ' +
  'named function so this check can execute it rather than pattern-match it');
const rowCtx = { esc: (s) => String(s), money: (v) => '£' + Number(v || 0).toFixed(2) };
vm.createContext(rowCtx);
vm.runInContext(`function accaRowHTML(a, legs) {${rowFn[1]}\n}`, rowCtx);

const sampleLegs = [{ leg: 1, player: 'A Player', club: 'ABC', prob: 0.26,
                      priced_odds: 3.62, carded: false }];
for (const status of ['open', 'won', 'lost']) {
  const html = rowCtx.accaRowHTML(
    { id: 'X:1:' + status, league: 'PL', matchday: 1, legs: 3, stake: 0.5,
      priced_odds: 60.36, status, pl: status === 'won' ? 29.68 : -0.5 }, sampleLegs);
  assert.ok(/data-share-acca="X:1:/.test(html),
    `a ${status} acca gets no share button — every logged acca must be ` +
    'shareable, or the record stops being a record');
  assert.ok(html.includes('A Player'), `the ${status} row lost its legs`);
}
/* And a lost one must show the loss on the row, not only on the card — in the
   past tense, because "returns £30.18 if it lands" under the word LOST reads
   as a bet that is still running. */
const lostRow = rowCtx.accaRowHTML(
  { id: 'X', league: 'PL', matchday: 1, legs: 3, stake: 0.5, priced_odds: 60.36,
    status: 'lost', pl: -0.5 }, sampleLegs);
assert.ok(/LOST/.test(lostRow), 'the tracker row does not label a lost acca');
assert.ok(!/if it lands/.test(lostRow),
  'a settled acca row is still written as though it could still land');
assert.ok(/if it lands/.test(rowCtx.accaRowHTML(
  { id: 'X', league: 'PL', matchday: 1, legs: 3, stake: 0.5, priced_odds: 60.36,
    status: 'open', pl: null }, sampleLegs)),
  'an open acca row does not say its return is conditional');

/* The handler must take the id it was clicked with. Reading a "current" acca
   instead would make all forty buttons export the same card — every one of
   them downloading successfully, with the wrong acca on it. Same failure the
   calendar's shareDay() had. */
const shareAcca = /function shareAcca\(([^)]*)\)([\s\S]*?)\n  \}/.exec(todayCode);
assert.ok(shareAcca, 'today.html has no shareAcca()');
assert.ok(/^\s*id\b/.test(shareAcca[1]),
  `shareAcca takes (${shareAcca[1].trim()}) — it must take the acca's id`);
assert.ok(/\[id\]/.test(shareAcca[2]),
  'shareAcca does not look its acca up by the id it was given');

/* ---- the buttons are actually wired ------------------------------------- *
 *
 * Everything above tests the DRAWING. None of it touches the click, which is
 * how two dead buttons shipped on two desks:
 *
 *   1. fixtureCard() renders "Share match" into BOTH fixture grids — #fxList
 *      on Fixtures and #mdList on This Matchday — and the delegation was
 *      bound to #fxList alone. The button on the tab people land on did
 *      nothing.
 *   2. #fxShareBtn called shareRound(btn) instead of shareRound(round, btn),
 *      so the fixture filter matched nothing and `if (!list.length) return`
 *      swallowed it.
 *
 * Neither throws. Neither logs. A dead button and a working one look exactly
 * alike until somebody clicks, which is why this RUNS the page's own wiring
 * against a stub DOM and dispatches real clicks rather than reading the
 * source for a pattern.
 */
function stubEl(tag) {
  const node = {
    tagName: tag, dataset: {}, _l: {}, _parent: null, _children: [],
    textContent: '', hidden: false, disabled: false, _html: '',
    classList: { add() {}, remove() {}, contains: () => false },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    addEventListener(type, fn) { (this._l[type] || (this._l[type] = [])).push(fn); },
    append(child) { child._parent = this; this._children.push(child); return child; },
    closest(sel) {
      let n = this;
      while (n) {
        if (sel === '[data-share]' && n.dataset && n.dataset.share != null) return n;
        n = n._parent;
      }
      return null;
    },
    click() {                       /* bubble, like a real listener chain */
      let n = this;
      while (n) {
        for (const fn of (n._l.click || [])) fn({ target: this });
        n = n._parent;
      }
    }
  };
  return node;
}

for (const page of ['eflc.html', 'laliga.html']) {
  const src = readFileSync(join(root, page), 'utf8');
  const from = src.indexOf('  function shareBusy(btn, on) {');
  const to = src.indexOf('/* ---- provenance', from);
  assert.ok(from > 0 && to > from, `${page}: the share-wiring block has moved or been renamed`);
  const wiring = src.slice(from, to);

  const nodes = {
    '#fxList': stubEl('div'), '#mdList': stubEl('div'),
    '#fxShareBtn': stubEl('button'), '#fxRound': stubEl('select')
  };
  nodes['#fxRound'].value = '7';
  nodes['#fxShareBtn'].textContent = '⬇ Share matchday';

  const calls = { match: [], round: [] };
  const shareStub = {
    deskMatchSpec: (priced) => ({ filename: 'm.png', _id: priced.fx.id }),
    deskRoundSpec: (list, ctx) => ({ filename: 'r.png', _round: ctx.round }),
    matchCard: (spec) => { calls.match.push(spec._id); return Promise.resolve({}); },
    roundCard: (spec) => { calls.round.push(spec._round); return Promise.resolve({}); },
    download() {}
  };

  const sandbox = {
    $: (sel) => nodes[sel] || null,
    document: { documentElement: { classList: { add() {} } } },
    console: { error() {} },
    S: shareStub,
    SHARE_CTX: { league: 'X' },
    FIXTURES: [{ id: 101, r: 7 }, { id: 102, r: 7 }, { id: 103, r: 8 }],
    priceFixture: (fx) => ({ fx, m: { expected: 4, xi: false } })
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(wiring, sandbox);

  /* A share button in each grid, exactly as fixtureCard() renders it. */
  for (const [host, id] of [['#fxList', '101'], ['#mdList', '102']]) {
    const btn = stubEl('button');
    btn.dataset.share = id;
    btn.textContent = '⬇ Share match';
    nodes[host].append(btn);
    btn.click();
    assert.ok(calls.match.includes(Number(id)) || calls.match.includes(id),
      `${page}: the "Share match" button in ${host} does nothing when clicked — ` +
      'the grid is not wired, so the button is inert on that tab');
  }

  /* And the matchday button must share the SELECTED round, not whatever it
     was handed. Asserting on the round proves the argument order, which a
     truthiness check would not: a button passed as `round` is truthy. */
  nodes['#fxShareBtn'].click();
  assert.deepEqual(calls.round, [7],
    `${page}: "Share matchday" did not export the selected round (got ` +
    `${JSON.stringify(calls.round)}) — check the arguments to shareRound(round, btn)`);
}

console.log('check-share: both fixture grids and the matchday button are wired on eflc.html and laliga.html');

console.log(
  `check-share OK: ${['PL', 'EFLC', 'LL', 'ALL'].length} themes, match + round + ` +
  'combined cards render, adapters agree with the desks, every card carries 18+, ' +
  '/today renders one date and the whole calendar from one row builder and one card builder, ' +
  'and every logged acca — won, lost and open — has a card that states its result'
);

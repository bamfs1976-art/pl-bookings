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
function stubCtx(drawn) {
  const noop = () => {};
  return {
    canvas: null,
    set fillStyle(v) {}, get fillStyle() { return '#000'; },
    set strokeStyle(v) {}, set lineWidth(v) {},
    set font(v) { this._font = v; }, get font() { return this._font || ''; },
    set textAlign(v) {}, get textAlign() { return 'left'; },
    set textBaseline(v) {}, get textBaseline() { return 'alphabetic'; },
    fillRect: noop, beginPath: noop, moveTo: noop, arcTo: noop, closePath: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: (t) => ({ width: String(t).length * 11 }),
    fillText: (t) => { drawn.push(String(t)); }
  };
}

function makeSandbox(drawn) {
  const ctx = {
    document: {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => stubCtx(drawn),
        toBlob: (cb) => cb({ __blob: true, size: 1024 })
      }),
      fonts: { ready: Promise.resolve() }
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    setTimeout, console, Promise
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'assets', 'share.js'), 'utf8'), ctx);
  return ctx;
}

const drawn = [];
const sb = makeSandbox(drawn);
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
const todaySrc = readFileSync(join(root, 'today.html'), 'utf8');
assert.ok(todaySrc.includes('__data'),
  'today.html must read the frame\'s published __data — contentWindow.CLUBS is ' +
  'always undefined for a top-level const');
/* Comments stripped first. The previous version of this check tripped on the
   COMMENT that explains the bug — the same way an earlier guard in
   check-eflc.mjs failed on a comment rather than on code. A check that cannot
   tell prose from code will eventually be deleted by whoever it annoys. */
const todayCode = todaySrc
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
assert.ok(!/contentWindow\.(CLUBS|REFS)\b/.test(todayCode),
  'today.html reads a const off contentWindow, which is always undefined');

/* The frame only loads files from its allow-list: it writes a script tag out
   of the URL hash, which anyone can put in a link. */
const frameSrc = readFileSync(join(root, 'data-frame.html'), 'utf8');
assert.ok(/ALLOWED\s*=/.test(frameSrc) && frameSrc.includes('location.hash'),
  'data-frame.html must keep its allow-list');
assert.ok(!/document\.write\([^)]*location\.hash/.test(frameSrc),
  'data-frame.html interpolates the hash straight into a script tag');

console.log(
  `check-share OK: ${['PL', 'EFLC', 'LL', 'ALL'].length} themes, match + round + ` +
  'combined cards render, adapters agree with the desks, every card carries 18+'
);

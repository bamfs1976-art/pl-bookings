// Guard the suspension watch: what it counts, and how it lays out.
//
// Two failures motivated this file, and neither threw anything.
//
// 1. COUNTING LAST SEASON'S CAUTIONS. The Premier League desk stamps the FPL
//    feed's card counts onto the rows the shared module reads. Every other
//    reader of p.live.yc in index.html — nine of them — first checks
//    LIVE.seasonStarted, because during the rollover the feed still serves
//    last season's totals and English cautions do not carry over. This panel
//    did not. On 7 August 2026, before a ball had been kicked, it showed seven
//    players "one booking from" a ban on the strength of 2025-26 yellows.
//
// 2. COLUMNS THAT WERE NOT COLUMNS. The row was a wrapping flex box with the
//    three percentages as siblings. That holds only while every label is
//    short: once one grew, the third percentage dropped onto a line of its
//    own, left-aligned under the prose, reading as a stray number.
//
// Both are invisible to every other guard in this repo: the first renders a
// perfectly plausible list of the wrong players, the second is valid CSS.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'assets', 'tw.css'), 'utf8');

/* ---- the module, loaded the way a page loads it ------------------------- */
const ctx = { window: undefined, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'suspension.js'), 'utf8'), ctx);
const SU = ctx.PLDSuspension;
assert.ok(SU && typeof SU.render === 'function', 'assets/suspension.js did not export PLDSuspension');
assert.ok(typeof SU.header === 'function', 'the strip has no column header');

/* An English-style ladder, as the Premier League and Championship use. */
const LADDER = { kind: 'ladder', cumulative: true, review: 20,
  rungs: [{ at: 5, ban: 1, by: 19 }, { at: 10, ban: 2, by: 32 }, { at: 15, ban: 3, by: null }] };
const squad = [
  { n: 'A Player With A Long Name', p: 'MF', c: 'ABC', _y90: 0.32, min: 2800 },
  { n: 'B Two', p: 'DF', c: 'ABC', _y90: 0.28, min: 2600 },
  { n: 'C Three', p: 'MF', c: 'DEF', _y90: 0.26, min: 2500 }
];

/* ---- the figures live in one cell, and cannot reflow -------------------- */
const pre = SU.rows(squad.map((p) => ({ ...p })), LADDER, { seasonMatches: 38, playedFor: () => 0 });
assert.ok(pre.rows.length, 'the strip produced no rows at all');
assert.equal(pre.known, false, 'a squad with no sc must read as season-not-started');
const html = SU.render(null, pre, LADDER, {});

/* THE LAYOUT ASSERTION. Not "does .susp-p exist" — it did before, as three
   siblings of a wrapping row, which is exactly the broken state. What matters
   is that all three sit inside ONE .susp-nums cell. */
const cells = [...html.matchAll(/<span class="susp-nums">([\s\S]*?)<\/span>\s*<\/div>/g)];
assert.equal(cells.length, pre.rows.length,
  'not every row wraps its figures in a single .susp-nums cell');
for (const [, inner] of cells) {
  assert.equal((inner.match(/class="susp-p"/g) || []).length, pre.horizons.length,
    `a row has the wrong number of figures in its cell: ${inner}`);
}
/* And no stray .susp-p outside a cell, which is what the old markup produced. */
const stray = html.replace(/<span class="susp-nums">[\s\S]*?<\/span>\s*<\/div>/g, '');
assert.ok(!/class="susp-p"/.test(stray),
  'a figure is emitted outside .susp-nums, so it can reflow away from its column');

/* The name and the pips get a row of their own, or the figures' fixed width is
   taken out of the name and it breaks across two lines on a phone. */
assert.ok(/<span class="susp-top">/.test(html),
  'the name and pips are not on a row of their own');

/* ---- the columns are labelled ------------------------------------------- */
/* The horizons CHANGE with the time of year, so the same three positions
   answer different questions in August and October. Unlabelled, the desks are
   not comparable and nothing on screen says so. */
const hdr = SU.header(pre);
for (const k of pre.horizons) {
  assert.ok(new RegExp('>' + k + '<').test(hdr),
    `the header does not name the ${k}-match horizon: ${hdr}`);
}
assert.ok(/matches/i.test(hdr), 'the header does not say what unit the columns are in');

/* The live horizons are different numbers, and the header must follow them
   rather than being hard-coded to the pre-season set. */
const live = SU.rows(squad.map((p) => ({ ...p, sc: 2, sm: 900 })), LADDER,
  { seasonMatches: 38, playedFor: () => 10 });
assert.equal(live.known, true, 'a squad with sc set must read as season underway');
assert.notDeepEqual(live.horizons, pre.horizons,
  'the live and pre-season horizons are the same, so this check proves nothing');
const liveHdr = SU.header(live);
for (const k of live.horizons) {
  assert.ok(new RegExp('>' + k + '<').test(liveHdr),
    `the live header does not name the ${k}-match horizon: ${liveHdr}`);
}

/* Every desk must actually draw it. */
for (const page of ['index.html', 'eflc.html', 'laliga.html']) {
  const s = readFileSync(join(root, page), 'utf8');
  assert.ok(/SU\.header\(res\)/.test(s),
    `${page} renders the strip without its column header`);
}

/* ---- the Premier League counts THIS season only ------------------------- */
/* RUN, not grepped. The stamping block is lifted out of index.html and
   executed against a feed that still carries last season's totals — which is
   precisely what the FPL API serves in August. */
/* The whole stamping block, gate included — the gate now sits above the loop,
   so extracting only the loop would test half the logic. */
const fn = index.slice(index.indexOf('function renderSuspension()'));
const a = fn.indexOf('const banActive=');
assert.ok(a > 0, 'index.html no longer gates the live counts in renderSuspension()');
const b = fn.indexOf('\n  });', a);
assert.ok(b > a, 'could not find the end of the stamping loop');
const blockSrc = fn.slice(a, b + '\n  });'.length);

/* The stub MODELS THE ACTUAL FAILING FEED, which the first version of this
   check did not. It passed a clean `{seasonStarted:false}` — a state that
   cannot occur while the bug is live — so it proved the code did what was
   written rather than that what was written was right. The shipped fix gated
   on seasonStarted, which is `elements.some(el => el.minutes > 0)`: read off
   the same stale rows as the card counts, therefore true exactly when they
   are untrustworthy. Nothing changed on the phone.

   What August actually looks like: the feed still carries last season's
   minutes and yellows, and NO event is finished. */
function stamp(feed) {
  const players = [{ n: 'X', p: 'MF', c: 'ABC', yc: 4, min: 2000,
    live: { yc: feed.yc, min: feed.minutes } }];
  const events = Array.from({ length: 38 }, (_, i) => ({ finished: i < feed.finished }));
  const finished = () => events.filter((e) => e.finished).length;
  const c = {
    PL_PLAYERS: players,
    /* Reproduces the real derivation, so any fix leaning on it fails here. */
    LIVE: { bootstrap: { events }, seasonStarted: feed.minutes > 0 },
    banWatchActive: () => finished() >= 1 && finished() < events.length,
    playedGW: finished,
    shrunkY90: () => 0.3,
    console
  };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(blockSrc, c);
  return players[0];
}

/* AUGUST: last season's totals, nothing finished. Must NOT be read as live. */
const august = stamp({ yc: 4, minutes: 2400, finished: 0 });
assert.equal(august.sc, undefined,
  'the Premier League suspension watch is reading the FPL feed\'s card counts ' +
  'while no match of this season has been played. Those are LAST season\'s ' +
  'yellows, which do not carry over — the strip shows players one booking ' +
  'from a ban having played no matches at all.');
assert.equal(august.sm, undefined, 'stale minutes are stamped alongside the stale cards');

/* A COMPLETED season still on the feed: every event finished. Also untrusted. */
assert.equal(stamp({ yc: 4, minutes: 2400, finished: 38 }).sc, undefined,
  'a fully finished season on the feed is being read as the current one');

/* MID-SEASON: ten rounds played, four cautions — plausible, and must be used,
   or the strip would never go live at all. */
assert.equal(stamp({ yc: 4, minutes: 900, finished: 10 }).sc, 4,
  'with the season genuinely underway the live count must be used');

/* Mid-season but an impossible count: two rounds played, fourteen cautions. */
assert.equal(stamp({ yc: 14, minutes: 180, finished: 2 }).sc, undefined,
  'a caution count that could not have been earned in the matches played is ' +
  'being taken at face value');

assert.equal(SU.seasonKnown([august]), false,
  'a row with no sc still reads as a live season');

/* ---- one copy of the styling ------------------------------------------- */
for (const sel of ['.susp-row', '.susp-nums', '.susp-top', '.susp-cols', '.pip']) {
  assert.ok(css.includes(sel + '{') || new RegExp(`\\${sel}[.{ ]`).test(css),
    `${sel} has no rule in assets/tw.css`);
}
/* It was defined three times, byte-identical, in three pages. A fix to one
   would have left the other two desks broken. */
for (const page of ['index.html', 'eflc.html', 'laliga.html']) {
  const s = readFileSync(join(root, page), 'utf8');
  assert.ok(!/\.susp-row\s*\{/.test(s),
    `${page} has its own copy of the suspension styling again`);
}
/* Grid, not a wrapping flex row — the wrap IS the bug. */
const rule = /\.susp-row\{([^}]*)\}/.exec(css);
assert.ok(rule, 'assets/tw.css has no .susp-row rule');
assert.ok(/display:grid/.test(rule[1]),
  `.susp-row is not a grid: ${rule[1]}`);
assert.ok(!/flex-wrap:\s*wrap/.test(rule[1]),
  '.susp-row wraps again, which is what pushed the third percentage onto its ' +
  'own line');

assert.ok(existsSync(join(root, 'assets', 'suspension.js')));
console.log('check-suspension OK: figures stay in one cell under labelled ' +
  'columns, the name keeps its own row, the styling is shared, and the ' +
  'Premier League strip counts this season only');

#!/usr/bin/env node
/* The transfer overlay describes the dataset it ships beside.
 *
 * WHAT THE OVERLAY IS. data/transfers.json carries moves the free squad feed
 * has not published yet. FPL's bootstrap decides who plays for whom, and it is
 * current for most purposes — but not instant: on 22 August 2026 the refresh
 * ran cleanly against a 600-player feed and kept Cristian Romero at Tottenham,
 * days after he had left, because as far as the feed was concerned he was
 * still there. For those days the desk priced him into Tottenham's fixtures.
 *
 * WHY IT IS THE DANGEROUS KIND OF FILE. Every other overlay in this repository
 * yields to its harvest. This one OVERRULES the feed, because it is a person
 * who has read the news and the feed is the one lagging. That makes it the
 * only hand-written input that can move a player, and hand-written inputs rot:
 * an entry nobody deletes becomes a second, unreviewed source of truth that
 * quietly fights the feed for years.
 *
 * SO THIS GUARD IS ABOUT DECAY, not about the mechanics — those are pinned in
 * data/test_reconcile.py, mutation by mutation. Here:
 *
 *   1. every entry is well formed and names real clubs, because a typo'd club
 *      code matches nothing and an entry that matches nothing is invisible;
 *   2. the shipped dataset AGREES with the overlay, or the entry is young
 *      enough not to have been through a build yet;
 *   3. an entry that has stopped doing anything is named so it gets deleted;
 *   4. the file cannot quietly become a hand-maintained division.
 *
 *     node scripts/check-transfers.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const overlayPath = join(root, 'data', 'transfers.json');

if (!existsSync(overlayPath)) {
  console.log('check-transfers OK: no overlay file, nothing to check');
  process.exit(0);
}

const payload = JSON.parse(readFileSync(overlayPath, 'utf8'));
const entries = payload.transfers || [];

/* The shipped Premier League dataset — the thing the overlay claims to have
   corrected. */
const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'data', 'pl_data.js'), 'utf8'), ctx);
const CLUBS = vm.runInContext('CLUBS', ctx);
const PLAYERS = vm.runInContext('PL_PLAYERS', ctx);
const codes = new Set(CLUBS.map((c) => c.short));

/* THE SAME NAME RULE THE BUILDER USES, and for the same reason: the two sides
   must agree about what one person looks like, or this guard passes on an
   entry the build never matched. Tokens, accent-folded, whole-name — never a
   surname alone, which would find a namesake. */
const tokens = (name) => String(name || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
const covers = (a, b) => a.every((t) => b.some((u) => u === t
  || (t.length === 1 && u.startsWith(t))));
const sameName = (a, b) => a.length && b.length && (covers(a, b) || covers(b, a));

/* ---- 4. it has not become a hand-maintained division --------------------- */
assert.ok(entries.length <= 25,
  `${entries.length} entries in data/transfers.json. This file is for the few ` +
  'days a feed lags behind a move; at this size the feed is not lagging, it is ' +
  'broken, and the squads are being maintained by hand where nobody reviews ' +
  'them. Fix the harvest instead');

const stale = [];
const pending = [];
const redundant = [];

for (const [i, e] of entries.entries()) {
  const where = `entry ${i + 1} (${e.player || 'unnamed'})`;

  /* ---- 1. well formed, and naming clubs that exist ----------------------- */
  assert.ok(e.player && tokens(e.player).length >= 2,
    `${where}: a transfer must name a player by FULL name. A single token ` +
    'matches every player who shares it, and the builder moves only on a ' +
    'unique match — so a one-word entry either does nothing or does something ' +
    'unrepeatable');
  assert.ok(e.source, `${where}: no source. This file overrules a live feed; ` +
    'an entry nobody can check is an entry nobody can argue with');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date || ''),
    `${where}: no date (YYYY-MM-DD). The date is what tells a later reader ` +
    'whether an unapplied entry is merely new or actually broken');

  const league = String(e.league || 'PL').toUpperCase();
  if (league !== 'PL') continue;          // only the PL dataset ships here yet

  assert.ok(codes.has(e.from),
    `${where}: 'from' is ${JSON.stringify(e.from)}, which is not a club in the ` +
    `shipped dataset. Known: ${[...codes].sort().join(', ')}`);
  assert.ok(e.to === null || codes.has(e.to),
    `${where}: 'to' is ${JSON.stringify(e.to)} — use null for a move out of the ` +
    'division, or a club code in it');
  assert.notEqual(e.from, e.to, `${where}: moved from a club to itself`);

  /* ---- 2 and 3. does the shipped dataset agree? -------------------------- */
  const toks = tokens(e.player);
  const rows = PLAYERS.filter((p) => sameName(toks, tokens(p.n)));
  const atFrom = rows.filter((p) => p.c === e.from);
  const atTo = e.to ? rows.filter((p) => p.c === e.to) : [];

  if (atFrom.length) {
    /* Not applied. Young entries have simply not been through a build — the
       refresh runs three times a day, so a week is many chances. */
    const ageDays = (Date.now() - Date.parse(e.date)) / 86400000;
    if (ageDays > 7) {
      stale.push(`${e.player} is still at ${e.from} in data/pl_data.js, ` +
        `${Math.floor(ageDays)} days after the entry was written`);
    } else {
      pending.push(`${e.player} (${e.from} -> ${e.to || 'out'}) — not yet ` +
        'through a build');
    }
    continue;
  }

  if (e.to && !atTo.length && !rows.length) {
    /* He is nowhere. The overlay said MOVE, and a move that ends with no row
       has deleted a player instead of relocating him. */
    stale.push(`${e.player} was to move ${e.from} -> ${e.to} but appears at no ` +
      'club at all — the overlay removed him instead of moving him');
    continue;
  }
  if (e.to && rows.length && !atTo.length) {
    stale.push(`${e.player} was to move ${e.from} -> ${e.to} but the dataset ` +
      `has him at ${[...new Set(rows.map((r) => r.c))].join(', ')}`);
    continue;
  }
  redundant.push(`${e.player} (${e.from} -> ${e.to || 'out'})`);
}

for (const line of pending) console.log(`  pending: ${line}`);
for (const line of redundant) {
  /* Done its job. Kept as a note rather than a failure — deleting entries is
     housekeeping, and failing a build over housekeeping teaches people to
     delete the guard. */
  console.log(`  spent, safe to delete: ${line}`);
}

assert.equal(stale.length, 0,
  'the overlay does not describe the dataset it ships with:\n  - ' +
  stale.join('\n  - ') +
  '\nEither the name never matched a row (check the spelling against ' +
  'data/pl_data.js) or the entry is wrong.');

console.log(`check-transfers OK: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, ` +
  `${pending.length} awaiting a build, ${redundant.length} spent, ` +
  'every club code real and every player named in full');

#!/usr/bin/env node
/* One closed list of channels, agreed by the browser, the table and the view.
 *
 * `?src=` is a free text field on a public URL. Everything downstream of it —
 * a column, a CHECK constraint, a GROUP BY, eventually a chart — assumes it is
 * one of eight words, and the only thing making that true is a list. A list
 * written down in three places is a list that will disagree in two of them,
 * and the disagreement is silent in the worst direction: the browser sends a
 * value the CHECK rejects, the insert fails, the write is fire-and-forget, and
 * the sign-in is simply never recorded. Nothing on any page would show it.
 *
 * So the three copies are compared here, character for character.
 *
 * THE OTHER HALF IS FIRST TOUCH. Somebody finds the desk through a Reddit
 * thread, comes back a fortnight later through a search, and signs up.
 * Last-touch attribution credits SEO for a reader Reddit brought, and it does
 * it systematically — a returning visitor is likelier to arrive by search
 * whatever brought them first. The rule is one line of code and it is exactly
 * the line somebody "simplifies" while tidying, so it is exercised rather
 * than read.
 *
 *     node scripts/check-attribution.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = require(join(root, 'assets', 'core.js'));
const read = (f) => readFileSync(join(root, f), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const EXPECTED = ['x', 'reddit', 'telegram', 'threads', 'bluesky', 'email',
                  'creator', 'seo'];

/* ---- 1. the browser's list is the list that was asked for --------------- */
assert.deepStrictEqual(C.SRC_VALUES.slice().sort(), EXPECTED.slice().sort(),
  'assets/core.js no longer carries the eight channels this was specified with');
checks++;

/* ---- 2. and SQL agrees with it, in both places ------------------------- */
const sql = read('supabase/plb_channel.sql');
const checkLists = [...sql.matchAll(/src\s+in\s*\(([^)]*)\)/gi)].map((m) =>
  m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean));

ok(checkLists.length >= 2,
  `supabase/plb_channel.sql has ${checkLists.length} CHECK list(s); the sign-ins table ` +
  'and the picks column must each constrain the column, or one of them accepts anything');

checkLists.forEach((list, i) => {
  assert.deepStrictEqual(list.slice().sort(), EXPECTED.slice().sort(),
    `CHECK list ${i + 1} in supabase/plb_channel.sql does not match PLDCore.SRC_VALUES. ` +
    'The browser would send a value the constraint rejects, the insert would fail, ' +
    'the write is fire-and-forget, and the sign-in would simply never be recorded — ' +
    'with nothing on any page to show it.');
  checks++;
});

/* ---- 3. first touch wins, exercised rather than read -------------------- */
{
  const store = () => {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } };
  };
  const s = store();
  ok(C.attribution(s, '?src=reddit') === 'reddit', 'the first tagged visit is not captured');
  /* THE ONE THAT MATTERS. Every subsequent visit, tagged or not. */
  for (const later of ['?src=seo', '?src=x', '?src=email', '', '?gw=4']) {
    assert.strictEqual(C.attribution(s, later), 'reddit',
      `a later visit (${later || 'untagged'}) overwrote the first touch. Last-touch ` +
      'attribution credits search for readers another channel brought, and it does so ' +
      'systematically, because a returning visitor is likelier to arrive by search.');
    checks++;
  }
  /* An unlisted value is dropped rather than stored, so an arbitrary string
     on a public URL never reaches a column or a chart. */
  const u = store();
  ok(C.attribution(u, '?src=facebook') === null, 'an unlisted channel was stored');
  ok(C.attribution(u, '?src=<script>alert(1)</script>') === null, 'arbitrary text was stored');
  ok(C.attribution(u, '?src=telegram') === 'telegram',
    'an untagged first visit blocked a later real one');
}

/* ---- 4. the desks capture it, and the pick carries it ------------------- */
{
  const core = read('assets/core.js');
  ok(/PLDCore\.attribution\(\s*localStorage/.test(core.replace(/\s+/g, ' ')),
    'assets/core.js never records the source. It is mounted here for the same reason ' +
    'the calibration notice is: a ?src= link can point at any of the four desks, and ' +
    'wiring it per page is four edits and four chances to miss one.');
  /* NOT on DOMContentLoaded. A reader may leave before that fires, and a first
     visit is the only visit this can be captured on. */
  ok(!/DOMContentLoaded[\s\S]{0,200}attribution/.test(core),
    'the source is captured on DOMContentLoaded — a reader who leaves before it fires ' +
    'is never attributed, and a first visit is the only visit it can be captured on');

  const idx = read('index.html');
  ok(/src:PLDCore\.currentSource\(/.test(idx.replace(/\s+/g, '')),
    'a logged pick does not carry the channel, so first-pick-by-source cannot be computed');
  ok(/row\.src=/.test(idx.replace(/\s+/g, '')),
    'the channel is not synced with the pick, so it is lost on another device');
  ok(/plb_signins/.test(idx), 'index.html never records a sign-in event');
  /* A token refresh is not a sign-in. onAuthStateChange fires roughly hourly
     on an open tab, and counting those would make a desk left open overnight
     look like the best-converting channel on the board. */
  ok(/uid\(\)!==was/.test(idx.replace(/\s+/g, '')),
    'sign-ins are logged on every auth event rather than on a change of user — a token ' +
    'refresh fires roughly hourly on an open tab, so a desk left open overnight would ' +
    'look like the best-converting channel there is');
}

/* ---- 5. the view answers the question, and does not leak ---------------- */
/* The DDL clause, not the prose. This file's own comment explains what
   security_invoker is for, so a bare search for the word is satisfied by the
   explanation of the setting after the setting itself has been deleted —
   which is the "assertion satisfied by the wrong text" this repo has been
   bitten by repeatedly. Caught here by mutation, not by reading. */
ok(/with\s*\(\s*security_invoker\s*=\s*on\s*\)\s*as/i.test(sql),
  'supabase/plb_channel.sql creates the view without security_invoker. A view over an ' +
  'RLS-protected table runs as its OWNER by default and hands every signed-in user ' +
  "everybody else's rows — the standard way this goes wrong.");
ok(/full\s+outer\s+join/i.test(sql),
  'the view inner-joins sign-ins to picks, so a week that produced sign-ins and no ' +
  'picks disappears — which is the more interesting of the two rows and exactly the ' +
  'channel worth cutting');
ok(/distinct on \(user_id\)/i.test(sql),
  'the view counts every pick rather than each user\'s FIRST one. Total picks measures ' +
  'how much a handful of heavy users log; the first measures how many people crossed ' +
  'from reading the desk to using it, which is what a channel can be credited with.');
ok(/date_trunc\('week'/.test(sql), 'the view is not grouped by week');
ok(/enable row level security/i.test(sql), 'plb_signins ships without row-level security');
/* An event log that can be edited is not an event log. */
ok(!/for update|for delete/i.test(sql),
  'plb_signins has an update or delete policy — an event log that can be rewritten is ' +
  'not a record of what happened');

console.log(`check-attribution OK: ${EXPECTED.length} channels agreed by core.js and `
  + `${checkLists.length} SQL constraints, first touch survives every later visit, the `
  + `pick and the sign-in both carry it, and the view is invoker-scoped (${checks} checks)`);

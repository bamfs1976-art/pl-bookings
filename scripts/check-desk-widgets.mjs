#!/usr/bin/env node
// Two desk widgets that fail silently, and the checks that make them speak up.
//
// WAS check-lineups.mjs. That file guarded THREE things: the reader's
// confirmed/unconfirmed lineup mark, sortable-table announcements, and the
// price checker. The lineup mark has been removed from the product — the desks
// now harvest the real XI, so a button asking the reader whether they had seen
// the team sheet was asking for something the app already knew — and with it
// gone the old filename described none of what remained. Worse, it sat beside
// check-lineup-pricing.mjs, which guards the actual team sheets: two files a
// letter apart, one of which checked neither lineups nor pricing.
//
// What is left, and why each is here:
//
//   * SORTABLE TABLES. Every desk moves an arrow onto the sorted column. An
//     arrow is not a signal to a screen reader, so the table silently reordered
//     while the header still read "Risk" — WCAG 2.2 AA, and invisible to
//     anyone who can see it.
//   * THE PRICE CHECK. The failure that matters is not a crash, it is a
//     cheerful green number on a bet that does not pay.
//
// Both are RUN against a stub DOM rather than read for a pattern.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- 10. sortable tables announce their state -------------------------- *
 * Every desk already moved an arrow onto the sorted column. An arrow is not
 * a signal to a screen reader, so the table silently reordered and the header
 * still read "Risk" — WCAG 2.2 AA, and invisible to anyone who can see it.
 */
const A11Y = readFileSync(join(root, 'assets', 'a11y.js'), 'utf8');
{
  const ctx = { window: null, document: { querySelector: () => null } };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(A11Y, ctx);

  /* A stub table of three headers, one of which is sorted. */
  const mk = (key) => ({ attrs: { 'data-sort': key },
    getAttribute(k) { return this.attrs[k] ?? null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    closest() { return table; } });
  const ths = [mk('n'), mk('r'), mk('min')];
  const table = { querySelectorAll: () => ths };

  ctx.PLDA11y.markSorted(ths[1], -1);
  assert.equal(ths[1].getAttribute('aria-sort'), 'descending', 'the sorted column is not announced');
  assert.equal(ths[0].getAttribute('aria-sort'), 'none', 'an unsorted column claims a sort');
  assert.equal(ths.filter((t) => t.getAttribute('aria-sort') !== 'none').length, 1,
    'more than one column claims to be sorted — a reader believes that');
  ctx.PLDA11y.markSorted(ths[0], 1);
  assert.equal(ths[0].getAttribute('aria-sort'), 'ascending', 'direction is not tracked');
  assert.equal(ths[1].getAttribute('aria-sort'), 'none', 'the previous column was not cleared');

  ctx.PLDA11y.syncSorted(table, 'min', -1);
  assert.equal(ths[2].getAttribute('aria-sort'), 'descending', 'the loaded sort state is not announced');
}

/* And every desk actually calls it — a helper nothing invokes is decoration. */
for (const page of ['index.html', 'eflc.html', 'laliga.html']) {
  const src = readFileSync(join(root, page), 'utf8');
  assert.ok(/<script src="assets\/a11y\.js">/.test(src), `${page} does not load assets/a11y.js`);
  assert.ok(/PLDA11y\.(markSorted|syncSorted)\(/.test(src),
    `${page} never announces a sort — its tables reorder silently`);
}

console.log('check-desk-widgets: sortable tables announce aria-sort on all three desks');

/* ---- 11. price check: the edge must not flatter ------------------------ *
 * assets/core.js has carried the odds maths since the beginning with nowhere
 * to type a price into. Now there is one, and the failure that matters is not
 * a crash — it is a cheerful green number on a bet that does not pay.
 *
 * The distinction the desk has to keep: a model reading HIGHER than the fair
 * (de-vigged) probability but LOWER than the priced one beats the bookmaker's
 * opinion and still loses to his margin. Calling that value would be the most
 * expensive lie the page could tell.
 */
{
  const core = await import(join(root, 'assets', 'core.js')).then((m) => m.default || m);
  const ctx = { window: null, PLDCore: core, CSS: null };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'assets', 'price.js'), 'utf8'), ctx);
  const P = ctx.PLDPrice.create({ core });

  /* Odds parsing refuses what is not a price. */
  assert.equal(P.parseOdds('3.5'), 3.5, 'decimal odds do not parse');
  assert.equal(P.parseOdds('5/2'), 3.5, 'fractional odds do not parse');
  assert.equal(P.parseOdds('3,5'), 3.5, 'a comma decimal does not parse');
  for (const junk of ['', '  ', 'evens', '1', '0.5', '-2', '900', 'NaN']) {
    assert.equal(P.parseOdds(junk), null, `"${junk}" was accepted as a price`);
  }

  /* A clear value bet reads as value, and the edge is the textbook number. */
  const model = 0.40, odds = 3.5;                    /* fair would be 2.5 */
  const out = P.readout(model, odds);
  assert.ok(/^Value \+/.test(out), `a 40% chance at 3.5 did not read as value: ${out}`);
  const expectedEdge = (odds * model - 1) * 100;     /* 40% */
  assert.ok(out.includes(expectedEdge.toFixed(1)),
    `the edge shown is not (odds × prob − 1): ${out}`);
  assert.equal(P.cls(model, odds), 'px-good');

  /* THE CASE THAT MUST NOT FLATTER. Priced at 2.00 → 50% as offered; the
     card-market margin makes the bookmaker's real opinion 47%. A model on 48%
     beats his opinion and loses to his price. */
  const mid = P.readout(0.48, 2.0);
  assert.ok(/Inside the margin/.test(mid),
    `a model inside the margin was not labelled as such: ${mid}`);
  assert.equal(P.cls(0.48, 2.0), 'px-mid',
    'a bet that loses to the margin is coloured as though it wins');

  /* And a plain bad price says so with a negative number, not silence. */
  const bad = P.readout(0.20, 2.0);
  assert.ok(/^No value -/.test(bad), `a losing price did not say so: ${bad}`);
  assert.equal(P.cls(0.20, 2.0), 'px-bad');

  /* No price, no claim. */
  assert.equal(P.readout(0.4, ''), '', 'an empty field produced a verdict');
  assert.equal(P.readout(null, '3.5'), '', 'a player with no model number produced a verdict');

  /* Nothing is persisted: a price is true for minutes, and a stale edge
     against a moved price is worse than none. */
  assert.ok(!/localStorage/.test(readFileSync(join(root, 'assets', 'price.js'), 'utf8')),
    'price.js touches localStorage — a stored price goes stale and lies later');

  /* XSS through the label and the key, both of which reach markup. */
  const nasty = P.row('1"><img src=x>', '<script>alert(1)</script>', 0.3);
  assert.ok(!/<img|<script>/.test(nasty), 'the price row interpolates unescaped input');

  /* The three desks render it and wire it. A block nobody wired is a set of
     inputs that compute nothing. */
  for (const page of ['index.html', 'eflc.html', 'laliga.html']) {
    const src = readFileSync(join(root, page), 'utf8');
    assert.ok(/<script src="assets\/price\.js">/.test(src), `${page} does not load assets/price.js`);
    assert.ok(/PRICES\s*\?\s*PRICES\.block\(|PRICES\.block\(/.test(src), `${page} never renders the price check`);
    assert.ok(/PRICES\.wire\(/.test(src), `${page} never wires the price inputs`);
  }
}

console.log('check-desk-widgets: price check parses odds, and a model inside the ' +
  'margin is never reported as value');

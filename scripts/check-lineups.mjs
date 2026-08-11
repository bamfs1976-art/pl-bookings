// Guard the lineup rule: unconfirmed by default, and it stays that way until
// somebody says otherwise.
//
// The standing rule is "no pick before confirmed lineups". The desks now carry
// a per-fixture mark, and every way it can fail is silent:
//
//   1. A CONTROL THAT DOES NOTHING. Both fixture grids on all three desks draw
//      the same card, so both need wiring — the exact defect the share buttons
//      shipped with. A dead toggle looks identical to a live one.
//   2. A DEFAULT THAT DRIFTS TO CONFIRMED. The whole value of the mark is that
//      it starts false. A bug that made it default true would turn the rule
//      into decoration and nothing would look wrong.
//   3. A CAVEAT THAT DOES NOT TRAVEL. A share card is read by people who
//      cannot see the desk. If an unconfirmed price posts without saying so,
//      the claim leaving the site is stronger than the model supports.
//   4. STORAGE THAT SILENTLY FORGETS. localStorage throws in a Safari private
//      window; the desks' existing try/catch blocks swallow it. The module has
//      to keep working for the session and say so.
//
// So this RUNS the module against a stub DOM and storage rather than reading
// the source for a pattern.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- a stub DOM and a storage that can be told to fail ----------------- */
function stubEl() {
  const node = {
    dataset: {}, _l: {}, _parent: null, attrs: {},
    addEventListener(t, fn) { (this._l[t] || (this._l[t] = [])).push(fn); },
    append(c) { c._parent = this; return c; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    closest(sel) {
      let n = this;
      while (n) {
        if (sel === '[data-lineup]' && n.attrs['data-lineup'] != null) return n;
        n = n._parent;
      }
      return null;
    },
    click() { let n = this; while (n) { for (const fn of (n._l.click || [])) fn({ target: this }); n = n._parent; } }
  };
  return node;
}

function makeStorage(mode) {
  const map = new Map();
  return {
    getItem: (k) => (mode === 'throw-read' ? (() => { throw new Error('denied'); })() : (map.has(k) ? map.get(k) : null)),
    setItem: (k, v) => { if (mode === 'throw-write') throw new Error('quota'); map.set(k, String(v)); },
    _map: map
  };
}

function load(storage) {
  const ctx = { window: null, console: { warn() {} }, localStorage: storage, Date, JSON, Object, Number, isFinite, String };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'assets', 'lineup.js'), 'utf8'), ctx);
  return ctx.PLDLineup;
}

/* ---- 1. the default is unconfirmed ------------------------------------- */
const store = makeStorage('ok');
const L = load(store).create({ key: 'test_v1' });
assert.equal(L.isConfirmed(1563083), false,
  'a fixture nobody has marked reads as confirmed — the rule is decoration');
assert.equal(L.count(), 0, 'a fresh store is not empty');
assert.ok(/unconfirmed/i.test(L.control(1563083)), 'the control does not say it is unconfirmed');
assert.ok(/unconfirmed/i.test(L.tag(1563083)), 'an unmarked fixture carries no tag');

/* ---- 2. marking works, and only for the fixture marked ----------------- */
L.set(1563083, true);
assert.equal(L.isConfirmed(1563083), true, 'a mark did not stick');
assert.equal(L.isConfirmed(1563084), false, 'marking one fixture marked another');
assert.equal(L.tag(1563083), '', 'a confirmed fixture still carries the unconfirmed tag');
assert.ok(/aria-pressed="true"/.test(L.control(1563083)),
  'the control does not expose its state to a screen reader');
assert.ok(/aria-pressed="false"/.test(L.control(1563084)), 'aria-pressed is not tracking state');
L.toggle(1563083);
assert.equal(L.isConfirmed(1563083), false, 'toggle did not clear the mark');

/* ---- 3. it persists, and survives a reload ----------------------------- */
L.set(999, true);
const L2 = load(store).create({ key: 'test_v1' });
assert.equal(L2.isConfirmed(999), true, 'a mark did not survive a reload');
assert.equal(L2.persists(), true, 'a working store reports itself as not persisting');

/* ---- 4. storage that throws degrades rather than losing the session ---- */
const hostile = load(makeStorage('throw-write')).create({ key: 'test_v1' });
hostile.set(42, true);
assert.equal(hostile.isConfirmed(42), true,
  'a mark was lost because the browser refused to persist it — it must still ' +
  'hold for the session');
assert.equal(hostile.persists(), false, 'a failed write still claims to persist');
const unreadable = load(makeStorage('throw-read')).create({ key: 'test_v1' });
assert.equal(unreadable.isConfirmed(1), false, 'a store that cannot be read threw on construction');

/* ---- 5. a stale mark is dropped --------------------------------------- */
const aged = makeStorage('ok');
aged._map.set('test_v1', JSON.stringify({ 111: Date.now() - (31 * 24 * 60 * 60 * 1000), 222: Date.now() }));
const L3 = load(aged).create({ key: 'test_v1' });
assert.equal(L3.isConfirmed(111), false, 'a month-old mark is still being honoured');
assert.equal(L3.isConfirmed(222), true, "today's mark was pruned");

/* ---- 6. the click is wired, and re-renders --------------------------- */
const host = stubEl();
let renders = 0;
L.wire(host, () => { renders++; });
const btn = stubEl();
btn.attrs['data-lineup'] = '5000';
host.append(btn);
btn.click();
assert.equal(L.isConfirmed(5000), true, 'clicking the control did not mark the fixture');
assert.equal(renders, 1, 'the grid was not re-rendered, so the control would not change on screen');
btn.click();
assert.equal(L.isConfirmed(5000), false, 'a second click did not unmark');
/* Wiring twice must not double-fire — the desks call wire() per grid and a
   re-entrant call would toggle twice and appear to do nothing. */
L.wire(host, () => { renders++; });
renders = 0; btn.click();
assert.equal(renders, 1, 'wire() bound the same host twice');

/* ---- 7. XSS: the id is interpolated into markup ------------------------ */
const nasty = L.control('1"><img src=x onerror=alert(1)>');
assert.ok(!/<img/.test(nasty), 'the control interpolates a fixture id unescaped');
assert.ok(nasty.includes('&quot;') || nasty.includes('&lt;'), 'the id was not escaped at all');

/* ---- 8. every desk carries it, on BOTH grids --------------------------- */
const DESKS = {
  'index.html': ['gwFixtures', 'fixtureList'],
  'eflc.html': ['#fxList', '#mdList'],
  'laliga.html': ['#fxList', '#mdList']
};
for (const [page, grids] of Object.entries(DESKS)) {
  const src = readFileSync(join(root, page), 'utf8');
  assert.ok(/<script src="assets\/lineup\.js">/.test(src), `${page} does not load assets/lineup.js`);
  assert.ok(/PLDLineup\.create\(/.test(src), `${page} never creates a lineup store`);
  assert.ok(/LINEUPS\s*\?\s*LINEUPS\.control\(/.test(src), `${page} never renders the control`);
  for (const g of grids) {
    const re = new RegExp('LINEUPS\\.wire\\(\\s*\\$\\(\\s*["\']' + g.replace(/[#$]/g, '\\$&') + '["\']');
    assert.ok(re.test(src),
      `${page}: the ${g} grid is not wired — its lineup control would be inert, ` +
      'exactly as the share button was');
  }
}

/* ---- 9. the caveat travels on the share card -------------------------- */
const share = readFileSync(join(root, 'assets', 'share.js'), 'utf8');
assert.ok(/lineupsConfirmed === false \? 'lineups unconfirmed' : null/.test(share),
  'assets/share.js no longer marks an unconfirmed card, so a price can leave ' +
  'the site without the condition it was computed under');
for (const page of ['eflc.html', 'laliga.html']) {
  const src = readFileSync(join(root, page), 'utf8');
  assert.ok(/lineupsConfirmed:\s*LINEUPS\.isConfirmed\(/.test(src),
    `${page} does not pass the lineup state into its share card`);
}

console.log('check-lineups OK: unconfirmed by default, marks persist and prune, ' +
  'hostile storage degrades without losing the session, both grids wired on all ' +
  'three desks, and the caveat travels on the share card');

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

console.log('check-lineups: sortable tables announce aria-sort on all three desks');

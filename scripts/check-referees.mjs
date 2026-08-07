// Guard the referee path: appointment in, factor out, on every desk.
//
// The referee is the largest single multiplier the desks apply, and until
// recently the Premier League one applied it to almost nothing: index.html
// never loaded data/pl_fixtures.js, so refFor() saw only the manual dropdown
// and every unassigned fixture priced at refFactor = 1. That is invisible on
// the page — a neutral referee looks exactly like no referee — which is why it
// survived so long and why these assertions RUN the code rather than read it.
//
// The join is the fragile part. The Premier League desk runs on the live FPL
// feed, whose fixture ids are its own; data/pl_fixtures.js comes from
// API-Football. The two id spaces have nothing to do with each other, so the
// join is on club short codes. Anyone "simplifying" that to an id lookup gets
// a desk that silently finds no appointments at all.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(join(root, 'index.html'), 'utf8');

/* ---- the desk loads the harvested fixtures at all ------------------------ */
assert.ok(/<script src="data\/pl_fixtures\.js"><\/script>/.test(index),
  'index.html does not load data/pl_fixtures.js, so it cannot see any ' +
  'appointment — every fixture would price at a neutral referee');

/* ---- run the join ------------------------------------------------------- */
function slice(from, to) {
  const a = index.indexOf(from);
  assert.ok(a >= 0, `index.html no longer contains ${JSON.stringify(from)}`);
  const b = index.indexOf(to, a);
  assert.ok(b > a, `index.html no longer contains ${JSON.stringify(to)} after it`);
  return index.slice(a, b);
}

const src = slice('let APPOINTED=null;', '// Heat multiplier');
const selSrc = slice('function refSelect(fid){', '\n// Next unfinished fixture');

const ctx = {
  SEASON: '2026-27',
  REFS: [{ n: 'Michael Oliver', ypg: 3.4 }, { n: 'Anthony Taylor', ypg: 4.1 }],
  refAssign: {},
  esc: (s) => String(s),
  refByName(n) { return ctx.REFS.find((r) => r.n === n) || null; },
  /* API-Football ids, deliberately nothing like the FPL ones below. */
  PL_FIXTURES: [
    { id: 1557367, d: '2026-08-21T19:00:00+00:00', r: 1, h: 'ARS', a: 'COV', ref: 'Michael Oliver' },
    { id: 1557368, d: '2026-08-22T14:00:00+00:00', r: 1, h: 'EVE', a: 'CHE', ref: null },
    { id: 1557369, d: '2026-08-22T14:00:00+00:00', r: 1, h: 'LEE', a: 'TOT', ref: 'A Promoted Official' }
  ],
  LIVE: {
    teamMap: { 1: 'ARS', 2: 'COV', 3: 'EVE', 4: 'CHE', 5: 'LEE', 6: 'TOT' },
    fixtures: [
      { id: 11, team_h: 1, team_a: 2 },     // ARS v COV → Michael Oliver
      { id: 12, team_h: 3, team_a: 4 },     // EVE v CHE → none appointed
      { id: 13, team_h: 5, team_a: 6 }      // LEE v TOT → appointed, no card record
    ]
  },
  console
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src + '\n' + selSrc, ctx);

/* The join finds the appointment across two unrelated id spaces. */
assert.equal(ctx.appointedRefName(11), 'Michael Oliver',
  'the appointment join found nothing — it must key on club codes, because ' +
  'the FPL fixture id and the API-Football fixture id are different numbers ' +
  'for the same match');
assert.equal(ctx.appointedRefName(12), null, 'invented an appointment that was not published');

/* It must NOT be keyed on the API-Football id: 1557367 is not a fixture id
   this desk will ever be handed. If this ever passes, the join has been
   "simplified" back to the thing that cannot work. */
assert.equal(ctx.appointedRefName(1557367), null,
  'the join is keyed on the API-Football fixture id, which the FPL-driven ' +
  'desk never sees');

/* refFor turns it into an actual referee record, so the factor applies. */
const ref = ctx.refFor(11);
assert.ok(ref && ref.n === 'Michael Oliver' && ref.ypg === 3.4,
  'refFor did not resolve the appointment to a referee record, so refFactor ' +
  'would still be 1 on an appointed fixture');
assert.equal(ctx.refFor(12), null, 'refFor invented a referee for an unappointed fixture');

/* A HAND PICK WINS. Appointments change after publication; a desk that cannot
   be corrected is worse than one that must be told. */
ctx.refAssign['2026-27|11'] = 'Anthony Taylor';
assert.equal(ctx.refFor(11).n, 'Anthony Taylor',
  'the harvested appointment overrode a manual assignment — it is the ' +
  'default, not the authority');
assert.equal(ctx.refIsAppointed(11), false, 'an overridden fixture still claims to be appointed');
delete ctx.refAssign['2026-27|11'];
assert.equal(ctx.refIsAppointed(11), true, 'an appointed fixture is not labelled as one');
assert.equal(ctx.refIsAppointed(12), false, 'an unappointed fixture claims to be appointed');

/* ---- the control agrees with the numbers beside it ---------------------- */
/* The dropdown must SHOW the referee the desk is pricing with. Leaving it on
   "unknown" while refFor() used a harvested name puts a different official in
   the control than in the model. */
const sel = ctx.refSelect(11);
assert.ok(/<option value="Michael Oliver" selected>/.test(sel),
  'the dropdown does not preselect the appointed referee, so the control and ' +
  `the pricing disagree: ${sel.slice(0, 200)}`);
assert.ok(/appointed<\/span>/.test(sel), 'the appointed fixture carries no label');

/* An appointed official with no card record still has to be selectable, or a
   promoted referee in his first season silently reverts the control to
   "unknown" while the desk shows his name elsewhere. */
const sel13 = ctx.refSelect(13);
assert.ok(/A Promoted Official \(no card record\)/.test(sel13),
  'an appointed referee absent from REFS vanishes from the dropdown');

/* Blank means "use the appointment", because clearing the override falls
   straight back to it. Labelling that "unknown" was simply wrong. */
assert.ok(/Use the appointment \(Michael Oliver\)/.test(sel),
  'the blank option is mislabelled — picking it restores the appointment ' +
  'rather than clearing the referee');
assert.ok(/Ref: unknown/.test(ctx.refSelect(12)),
  'a fixture with no appointment should still offer a plain unknown option');

/* ---- the cache cannot outlive the fixture list it was built from -------- */
assert.ok(/APPOINTED=null;/.test(index.slice(index.indexOf('LIVE={bootstrap:bs'))),
  'the appointment cache is not reset when LIVE is rebuilt, so it would keep ' +
  'pointing at the previous load\'s fixture ids');

/* ---- the other two desks still read their appointments ------------------ */
for (const page of ['eflc.html', 'laliga.html']) {
  const s = readFileSync(join(root, page), 'utf8');
  assert.ok(/fx\.ref && refByName\[fx\.ref\]/.test(s),
    `${page} no longer resolves the appointed referee from its fixture list`);
}

/* ---- the coverage reporter exists and is wired to the harvest ----------- */
const wf = readFileSync(join(root, '.github', 'workflows', 'fixtures.yml'), 'utf8');
assert.ok(/ref-coverage\.mjs/.test(wf),
  'the fixture harvest does not report appointment coverage, so a feed that ' +
  'stops publishing referees would look identical to a quiet week');
assert.ok(/--fixtures --league \$L/.test(wf) && /for L in PL EFLC LL/.test(wf),
  'the fixture workflow does not harvest all three leagues');
/* Three schedules: the Spanish appointments land the afternoon before, so a
   single nightly run cannot carry them. */
assert.ok((wf.match(/- cron:/g) || []).length >= 3,
  'the fixture harvest runs too infrequently to catch a La Liga appointment, ' +
  'which is published the day before the match');

/* ---- the daily refresh actually runs on a schedule ---------------------- */
const refresh = readFileSync(join(root, '.github', 'workflows', 'data-refresh.yml'), 'utf8');
assert.ok(/^\s*schedule:/m.test(refresh),
  'data-refresh.yml has no cron, so transfers, injuries and cautions only ' +
  'update when somebody clicks Run workflow');
/* On a scheduled run every input is empty. A boolean input read bare is
   therefore falsy, which would skip the Championship and La Liga steps on
   every cron run while the workflow still reported success. */
for (const name of ['refresh_eflc', 'refresh_laliga', 'fit_model']) {
  const bare = new RegExp(`if: \\$\\{\\{[^}]*[^|] inputs\\.${name}(?!\\w)`);
  const guarded = new RegExp(`github\\.event_name != 'workflow_dispatch' \\|\\| inputs\\.${name}`);
  assert.ok(guarded.test(refresh),
    `inputs.${name} is read bare in a condition — on a scheduled run it is ` +
    'empty, so that step would silently never run');
  void bare;
}
for (const [name, dflt] of [['refs_season', '2526'], ['season_af', '2025'],
                            ['season_fixtures', '2026'], ['season_sp', '2526']]) {
  assert.ok(new RegExp(`inputs\\.${name} \\|\\| '${dflt}'`).test(refresh),
    `inputs.${name} has no default, so a scheduled run would pass an empty ` +
    'season to the harvester');
}

console.log('check-referees OK: the appointment joins across two id spaces, a ' +
  'hand pick still wins, the dropdown shows what the model prices with, all ' +
  'three leagues are harvested on a schedule that can catch them');

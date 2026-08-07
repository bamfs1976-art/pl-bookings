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

/* ---- the calibration loop has exactly one writer ------------------------ */
/* Two writers logging the same Premier League forecast from two code paths is
   how every pair of things in this project has drifted. The Netlify hourly
   logger was retired for that reason AND because it could only ever cover one
   league: it keyed on the FPL `element` id and graded from the FPL result
   feed, neither of which exists for the Championship or La Liga. */
import { existsSync } from 'node:fs';
assert.ok(!existsSync(join(root, 'netlify', 'functions', 'log-predictions.js')),
  'the retired Netlify prediction logger is back — there must be one writer ' +
  'for the calibration set, and it must cover all three leagues');

const accas = readFileSync(join(root, 'scripts', 'accas.mjs'), 'utf8');

/* ---- every forecast carries the model that made it ---------------------- */
/* RUN, not read. The pool is built inside candidatesFor(), so the only way to
   be sure the stamp survives is to build one and look at the rows. */
{
  const A = await import('file://' + join(root, 'scripts', 'accas.mjs'));
  assert.ok(A.MODEL_VERSION, 'accas.mjs exports no MODEL_VERSION');
  let checked = 0;
  for (const L of A.LEAGUES) {
    const { pool } = A.candidatesFor(L);
    for (const row of pool || []) {
      assert.equal(row.model_version, A.MODEL_VERSION,
        `a ${L.code} forecast is written without the model that made it — the ` +
        'first refit would pool two models with nothing to separate them');
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} forecast rows checked`);

  /* And the acca legs, which are the record of what was advised. */
  for (const b of A.collect()) {
    for (const leg of b.legs) {
      assert.equal(leg.model_version, A.MODEL_VERSION,
        'an acca leg is logged without the model that priced it');
    }
  }

  /* DERIVED FROM THE CONSTANT, not a literal. Shrinkage strength is the first
     thing the calibration work will tune, so tuning it must bump the version
     by itself — a hand-maintained string is one someone forgets, and
     forgetting silently re-creates the bug this column exists to prevent.
     This one has to read the source: a value check cannot tell a derived
     'k6' from a hard-coded one while k is still 6. */
  assert.ok(/MODEL_VERSION = `desk-hazard\/k\$\{SHRINK_MATCHES\}`/.test(accas),
    'MODEL_VERSION is hard-coded rather than derived from SHRINK_MATCHES, so ' +
    'retuning the shrinkage would not bump it and the two models would pool');
  assert.equal(A.MODEL_VERSION, `desk-hazard/k${A.SHRINK_MATCHES}`);
}

for (const cmd of ['predict', 'grade']) {
  assert.ok(new RegExp(`cmd === '${cmd}'`).test(accas),
    `scripts/accas.mjs has no ${cmd} command`);
}
const accasWf = readFileSync(join(root, '.github', 'workflows', 'accas.yml'), 'utf8');
for (const cmd of ['predict', 'grade']) {
  assert.ok(new RegExp(`accas\\.mjs ${cmd}`).test(accasWf),
    `nothing runs \`accas.mjs ${cmd}\` on a schedule, so the calibration set ` +
    'never fills or never grades');
}

/* The forecast pool must be EVERY candidate, not the acca legs. The legs are
   by construction the top of the distribution; calibrating on them would bake
   that selection in, and 12 rows a matchday cannot calibrate anything. */
assert.ok(/plb_card_predictions/.test(accas),
  'accas.mjs does not write the league-agnostic prediction table');
assert.ok(/home\.slice\(0, 8\), \.\.\.away\.slice\(0, 8\)/.test(accas),
  'the calibration pool is no longer both sides of every fixture');
/* Write-once. `merge-duplicates` would let an hourly job revise its own
   earlier forecast as kick-off approached, grading the model on its last
   guess rather than its published one. */
assert.ok(/resolution=ignore-duplicates/.test(accas),
  'forecasts are upserted rather than written once, so a later run could ' +
  'revise a published prediction');

/* Ambiguity must not be recorded as "not booked". Two players sharing a
   surname is not evidence of anything, and calling it a miss drags the
   observed rate below the forecast one in exactly those matches. */
assert.ok(/if \(hits > 1\) return null;/.test(accas),
  'wasBooked() resolves an ambiguous surname to false again — that is not ' +
  '"we do not guess", it is guessing "not booked"');

const calib = readFileSync(join(root, 'netlify', 'functions', 'model-calibration.js'), 'utf8');
assert.ok(/plb_card_predictions/.test(calib) && !/rest\/v1\/plb_predictions/.test(calib),
  'model-calibration still reads the PL-only table, so the Championship and ' +
  'La Liga can never be graded in public');

/* RUN the reader against a known set rather than grepping it. A text check for
   "byLeague" passed with the variable renamed at its declaration — the return
   still mentioned it, so the assertion matched a word that no longer computed
   anything. The scores below are hand-checkable. */
{
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const rows = [
    /* PL: two forecasts at 50%, one booked. Brier = ((.5-1)^2+(.5-0)^2)/2 = .25
       Observed rate .5, so the base-rate Brier is also .25 — a model that
       knows nothing beyond the average must NOT look ahead. */
    { season: '2026-27', league: 'PL', md: 1, prob: 0.5, carded: true },
    { season: '2026-27', league: 'PL', md: 1, prob: 0.5, carded: false },
    /* EFLC: perfectly separated, so Brier ~0 and clearly ahead of base rate. */
    { season: '2026-27', league: 'EFLC', md: 1, prob: 0.99, carded: true },
    { season: '2026-27', league: 'EFLC', md: 1, prob: 0.01, carded: false },
    /* An older season, which must never be mixed in — matchday numbers repeat. */
    { season: '2025-26', league: 'PL', md: 1, prob: 0.9, carded: false }
  ].map((r) => ({ ...r, model_version: 'desk-hazard/k6' }));
  /* A SUPERSEDED MODEL's rows, in the same season and league. Pooling these
     with the current model's would report the average of two different things
     as one — the failure model_version exists to prevent. They are deliberately
     terrible forecasts, so pooling them is visible in the score. */
  rows.push(
    { season: '2026-27', league: 'PL', md: 1, prob: 0.99, carded: false,
      model_version: 'desk-hazard/k2' },
    { season: '2026-27', league: 'PL', md: 1, prob: 0.99, carded: false,
      model_version: 'desk-hazard/k2' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => rows });
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
  delete req.cache[req.resolve(join(root, 'netlify', 'functions', 'model-calibration.js'))];
  const mod = req(join(root, 'netlify', 'functions', 'model-calibration.js'));
  const out = JSON.parse((await mod.handler({ queryStringParameters: {} })).body);
  globalThis.fetch = realFetch;

  assert.equal(out.season, '2026-27', 'the reader mixed seasons or picked the wrong one');
  assert.equal(out.n, 4, `seasons are being mixed: n=${out.n}, expected 4`);
  assert.ok(out.byLeague && out.byLeague.PL && out.byLeague.EFLC,
    'calibration is not broken out per league — an aggregate hides a badly ' +
    'calibrated division, which is the thing a reader most wants separated');
  assert.equal(out.byLeague.PL.n, 2, 'the PL breakdown has the wrong sample');
  /* The superseded rows must be excluded from the score and DECLARED, not
     silently dropped — a record that quietly truncates itself is the same
     failure as one that quietly pools. */
  assert.equal(out.modelVersion, 'desk-hazard/k6',
    `the reader scored the wrong model: ${out.modelVersion}`);
  assert.equal(out.superseded['desk-hazard/k2'], 2,
    'rows from a superseded model are not reported at all');
  assert.equal(out.byLeague.PL.brier, 0.25, `PL Brier ${out.byLeague.PL.brier}, expected 0.25`);
  /* Coin-flip forecasts must not beat the base rate. If this ever passes, the
     baseline is being computed on something other than the observed rate and
     the desk would claim an edge it does not have. */
  assert.ok(out.byLeague.PL.brier >= out.byLeague.PL.baseBrier,
    'a 50/50 forecast is being scored as better than the base rate');
  assert.ok(out.byLeague.EFLC.brier < out.byLeague.EFLC.baseBrier,
    'a perfectly separated forecast is not being scored ahead of the base rate');
  assert.ok(out.byLeague.EFLC.brier < 0.01, `EFLC Brier ${out.byLeague.EFLC.brier}`);
}

console.log('check-referees OK: the appointment joins across two id spaces, a ' +
  'hand pick still wins, the dropdown shows what the model prices with, all ' +
  'three leagues are harvested on a schedule that can catch them');

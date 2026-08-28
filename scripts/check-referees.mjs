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

/* The real PLDCore, for the desk snippets below that call into it. */
function coreOf() {
  const c = {};
  vm.createContext(c);
  vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), c);
  return vm.runInContext('PLDCore', c);
}

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
  REF_AVG_YPG: 3.71,
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
/* refSelect() builds its markup through the shared RefereePicker now, so the
   module has to be in the context. Loading it here rather than stubbing it is
   deliberate: a stub would let refSelect() pass this guard while calling a
   primitive that does not do what it is asked. */
/* core.js first, exactly as index.html loads it: the picker shortens names
   through PLDCore.refShort rather than carrying its own rule, and refuses to
   render without it. */
vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'assets', 'refpicker.js'), 'utf8'), ctx);
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
/* The control must SHOW the referee the desk is pricing with. Leaving it on
   "unknown" while refFor() used a harvested name puts a different official in
   the control than in the model.

   The markup changed — a native <select> of 22 options sorted alphabetically
   became a picker whose rows carry the card rate and a delta — so these
   assertions moved with it. The claims did not: preselection, the appointed
   label, an official with no record still reachable, and a default state that
   says what the model is doing rather than "Ref —". */
const sel = ctx.refSelect(11);
assert.ok(/class="rp-row on" data-ref="Michael Oliver"|data-ref="Michael Oliver" role="option" aria-selected="true"/.test(sel)
       || /<button type="button" class="rp-row on" data-ref="Michael Oliver"/.test(sel),
  'the picker does not preselect the appointed referee, so the control and ' +
  `the pricing disagree: ${sel.slice(0, 240)}`);
assert.ok(/class="rp-appointed"/.test(sel), 'the appointed fixture carries no label');
/* And it must NOT be dressed as a simulation — a published appointment
   labelled "Simulated" is the same lie in the opposite direction. */
assert.ok(!/class="rp-sim"/.test(sel),
  'an appointed referee is labelled as a simulated pick');

/* A hand pick MUST be labelled simulated, with a way back. A hypothetical
   that looks exactly like a published appointment is the one genuinely
   misleading thing a research tool can do. */
ctx.refAssign['2026-27|11'] = 'Anthony Taylor';
const picked = ctx.refSelect(11);
assert.ok(/class="rp-sim"/.test(picked),
  'a hand-picked referee is not marked as simulated — it is indistinguishable ' +
  'from a published appointment while changing every number on the card');
assert.ok(/data-ref-reset="11"/.test(picked), 'a simulated pick offers no way back');
delete ctx.refAssign['2026-27|11'];

/* An appointed official with no card record still has to be selectable, or a
   promoted referee in his first season silently vanishes from the control
   while the desk shows his name elsewhere. */
const sel13 = ctx.refSelect(13);
assert.ok(/data-ref="A Promoted Official"/.test(sel13),
  'an appointed referee absent from REFS vanishes from the picker');
assert.ok(/no card record/.test(sel13),
  'a referee with no card record is listed without saying so');

/* The default state is a statement about the PRICE. "Ref —" read as missing
   data; what it means is that the model is using the league average — and the
   number shown must be the one refFactor() actually divides by. */
const sel12 = ctx.refSelect(12);
assert.ok(/Referee not announced/.test(sel12),
  'a fixture with no appointment still reads as missing data rather than ' +
  'saying what the model is doing');
assert.ok(sel12.includes(ctx.REF_AVG_YPG.toFixed(2)),
  'the default state advertises an average that is not REF_AVG_YPG — the ' +
  'number the model divides by. A control quoting a different average than ' +
  'the maths uses is off by a third of the spread across the whole list.');

/* Ordered by card rate, descending. The reason to open the list is to find a
   strict whistle; the old alphabetical <select> put him wherever his surname
   fell. Taylor (4.1) must precede Oliver (3.4). */
/* A REFEREE WHOSE NAME AND RATE DISAGREE. The two fixture officials happen to
   sort the same way alphabetically as by card rate — Anthony Taylor 4.10
   before Michael Oliver 3.40, A before M — so this assertion passed with the
   sort reverted to localeCompare and proved nothing. It took a mutation to
   notice; the fixture, not the assertion, was the weak part. */
ctx.REFS.push({ n: 'Zachary Whistle', ypg: 4.80, matches: 20 });
const ordered = ctx.refSelect(12);
assert.ok(ordered.indexOf('data-ref="Zachary Whistle"') < ordered.indexOf('data-ref="Anthony Taylor"'),
  'the picker is not ordered by cards per game — the strictest official (4.80) ' +
  'sits below a more lenient one because his surname is later in the alphabet, ' +
  'which is exactly what the old <select> did');
ctx.REFS.pop();

/* THIN SAMPLES SINK. Sorted on rate alone the top of the list was an official
   on 5.00 over THREE matches — so the first pick anyone makes applies a ×1.35
   multiplier to every player on the card off three afternoons. He stays in the
   list and keeps his number; he does not sit above a season's evidence. */
ctx.REFS.push({ n: 'Three Match Wonder', ypg: 5.0, matches: 3 });
const thinSel = ctx.refSelect(12);
assert.ok(thinSel.indexOf('data-ref="Anthony Taylor"') < thinSel.indexOf('data-ref="Three Match Wonder"'),
  'a referee with three matches behind a 5.00 rate sorts above officials with ' +
  'a full season — the first pick a reader makes would rest on three afternoons');
assert.ok(/too few to rely on/.test(thinSel),
  'a thin-sample referee is listed without saying how little is behind the number');
ctx.REFS.pop();

/* ---- the cache cannot outlive the fixture list it was built from -------- */
assert.ok(/APPOINTED=null;/.test(index.slice(index.indexOf('LIVE={bootstrap:bs'))),
  'the appointment cache is not reset when LIVE is rebuilt, so it would keep ' +
  'pointing at the previous load\'s fixture ids');

/* ---- and the Premier League desk resolves a name it is spelt differently ---
   Its JOIN is different — club codes across two id spaces, not a name — but
   the last step is the same name lookup, and it was the same exact match. This
   desk has had no appointment published yet, so nothing would have caught it
   until the season opened. */
{
  /* RUN the real refByName, not a stub of it. The context above supplies its
     own exact-match stub so the join could be tested in isolation, which meant
     this desk's actual name lookup was never executed by anything — and it was
     an exact match, the same bug the Championship hit, eight days from its own
     openers. */
  const realLookup = slice('function refByName(n){', '\n/* ---- the appointed');
  const ctx2 = {
    REFS: [{ n: 'Michael Oliver', ypg: 3.4 }, { n: 'Anthony Taylor', ypg: 4.1 }],
    PLDCore: coreOf(), console,
  };
  vm.createContext(ctx2);
  vm.runInContext(realLookup, ctx2);
  assert.ok(ctx2.refByName('Michael Oliver'),
    'the exact name no longer resolves at all');
  const abbrev = ctx2.refByName('M. Oliver');
  assert.ok(abbrev && abbrev.n === 'Michael Oliver' && abbrev.ypg === 3.4,
    'index.html cannot resolve "M. Oliver" to Michael Oliver. The appointment ' +
    'overlay abbreviates and the card table does not, so every published ' +
    'appointment would price at refFactor = 1 — which on the page is ' +
    'indistinguishable from no official being named.');
  /* And it must still refuse a guess. */
  ctx2.REFS.push({ n: 'Matthew Oliver', ypg: 3.9 });
  assert.equal(ctx2.refByName('M. Oliver'), null,
    'two Olivers sharing an initial resolved to one of them — pricing a match ' +
    'off the wrong referee is worse than pricing it off none');
}

/* ---- the other two desks still read their appointments ------------------ */
for (const page of ['eflc.html', 'laliga.html']) {
  const s = readFileSync(join(root, page), 'utf8');
  /* THROUGH THE SHARED RESOLVER, not an exact lookup. The overlay and the
     card table are different feeds: eleven of the Championship's twelve
     opening appointments arrived abbreviated ("F. Hallam" against "Farai
     Hallam") and an exact `refByName[fx.ref]` matched none of them, pricing
     each fixture at refFactor = 1 — indistinguishable, on the page, from no
     official being named. */
  assert.ok(/C\.matchRefName\(fx\.ref, refByName\)/.test(s),
    `${page} no longer resolves the appointed referee through ` +
    'PLDCore.matchRefName, so an appointment spelt differently from the card ' +
    'table prices at a neutral referee and looks like no appointment at all');
  assert.ok(!/if \(fx\.ref && refByName\[fx\.ref\]\) return/.test(s),
    `${page} is back to an exact-string appointment lookup`);
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

  /* THE FORECAST POOL PRICES OFF THE APPOINTED OFFICIAL, not just the match
     record beside it. candidatesFor() resolves the referee on its own path,
     and that path had its own exact-string lookup: with the Championship's
     twelve openers named, every forecast row was being logged at ref_factor 1
     — permanently, because forecasts are written once and never revised. A
     string comparison recorded for ever as a fact about football.

     Asserted on the OPEN ROUND of whichever league has appointments, so it
     starts working the day they are published rather than needing a season. */
  for (const L of A.LEAGUES) {
    const { pool } = A.candidatesFor(L);
    const appointed = (pool || []).filter((r) => r.referee);
    if (appointed.length < 4) continue;          // nothing named yet in this league
    const priced = appointed.filter((r) => Number(r.ref_factor) !== 1).length;
    assert.ok(priced * 2 >= appointed.length,
      `${L.code}: ${priced} of ${appointed.length} forecast rows with a named ` +
      'official carry a referee factor. The rest are logged as if nobody had ' +
      'been appointed — the overlay and the card table spell officials ' +
      'differently and this path is not going through PLDCore.matchRefName.');
  }

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

/* ---- the appointment canary gets louder as kick-off approaches ---------- */
/*
 * The canary fired identically four days out and four hours out, and in the
 * week before a season opens the four-days-out case is every run of every day
 * — normal behaviour, annotated as a warning. A canary that cries for four
 * days running is one nobody reads on the fifth.
 *
 * RUN AT THREE CLOCKS rather than grepped for three thresholds. The levels
 * differ only by how close the soonest unappointed kick-off is, so a source
 * check here would be a check of the comment above the code: the `--at` flag
 * exists precisely so the escalation can be exercised. The clocks below are
 * pinned to the real opening fixtures, so this also fails if a season's
 * fixtures go missing from the repository entirely.
 */
/*
 * ON A FIXTURE SET THIS GUARD WRITES, not on the shipped one.
 *
 * It used to aim the three clocks at the first unappointed Championship
 * fixture in data/eflc_fixtures.js, on the reasoning that hard-coding a date
 * would need editing every August. But that made the test a question about
 * which rounds the EFL had published officials for on the morning it ran, and
 * on 26 August 2026 it failed for the best possible reason: the EFL had named
 * two rounds instead of one, so 96 hours before the first UNAPPOINTED
 * kick-off there was an APPOINTED round inside the same five-day window, the
 * canary correctly stayed silent, and the guard called it a fault.
 *
 * The harvest regenerates that file, so the failing input never reaches the
 * repository and a local run cannot see it — the same trap this file's
 * neighbour recorded in August 2025. Writing the fixtures here removes both
 * problems at once: the levels are exercised against a set whose appointment
 * pattern is stated rather than discovered, and the real files are checked
 * separately for the thing they can actually speak to.
 */
{
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');

  const KICK = Date.parse('2026-09-05T14:00:00Z');
  const before = (hours) => new Date(KICK - hours * 3600000).toISOString();
  /* One Championship round, kicking off together, with `appointed` of its
     twelve carrying an official. The other two leagues are present and empty
     so that every annotation in the output is the Championship's. */
  const setup = (appointed) => {
    const dir = mkdtempSync(join(tmpdir(), 'refcov-'));
    mkdirSync(join(dir, 'data'));
    const round = Array.from({ length: 12 }, (_, i) => ({
      id: 9000 + i, h: 'AAA', a: 'BBB', r: 7,
      d: new Date(KICK + i * 3600000).toISOString(),
      ref: i < appointed ? 'A Referee' : null
    }));
    const put = (file, konst, rows) => writeFileSync(join(dir, 'data', file),
      `const ${konst} = ${JSON.stringify(rows)};\n`);
    put('eflc_fixtures.js', 'EFLC_FIXTURES', round);
    put('pl_fixtures.js', 'PL_FIXTURES', []);
    put('laliga_fixtures.js', 'LALIGA_FIXTURES', []);
    return dir;
  };
  const at = (iso, dir) => execFileSync('node',
    [join(root, 'scripts', 'ref-coverage.mjs'), '--at', iso]
      .concat(dir ? ['--data', dir] : []), { encoding: 'utf8' });

  const empty = setup(0);
  for (const [hours, level] of [[96, 'notice'], [30, 'warning'], [6, 'error']]) {
    const out = at(before(hours), empty);
    assert.ok(new RegExp('::' + level + '::EFL Championship').test(out),
      `${hours}h before a Championship round with no official named, the ` +
      `canary should annotate at ${level}, and it printed:\n${out}`);
    /* And NOT at either neighbouring level — a canary stuck on `error` would
       pass a check that only looked for the level it expected. */
    for (const other of ['notice', 'warning', 'error']) {
      if (other === level) continue;
      assert.ok(!new RegExp('::' + other + '::EFL Championship').test(out),
        `at ${hours}h the Championship is annotated ${other} as well as ` +
        `${level}. One kick-off, one level.`);
    }
  }

  /* AND SILENT WHEN THE WINDOW IS PARTLY APPOINTED, which is the case that
     broke the old version of this block and which it had no way to state.
     The canary answers "has the source stopped carrying appointments, or is
     the harvest failing" — one unnamed official six hours out is neither, and
     a canary that fired on it would be back to crying every day. */
  const partial = setup(1);
  const quiet = at(before(6), partial);
  assert.ok(!/::(notice|warning|error)::EFL Championship/.test(quiet),
    'the canary fired for a Championship round that has an official named — ' +
    'it is a check for the feed going dark, not for a complete team sheet ' +
    'of referees:\n' + quiet);
  assert.ok(/1\/12 appointed/.test(quiet),
    'the countdown no longer counts a partly appointed round:\n' + quiet);

  /* The countdown line, which is what makes the days before an opener legible:
     the round about to be played, how many of it have officials, and how long
     is left — not "552 upcoming", which is true and does not move. Read off
     the REAL files, at the real clock, because that is the run this exists to
     protect and it is also what fails if a season's fixtures go missing from
     the repository entirely. */
  const real = at(new Date().toISOString(), null);
  for (const name of ['Premier League', 'EFL Championship', 'La Liga']) {
    assert.ok(new RegExp(name + '\\s+\\d+ upcoming').test(real),
      `ref-coverage reported nothing for ${name} — its fixture file is ` +
      `missing or empty:\n${real}`);
  }
  assert.ok(/round \d+\s+\d{4}-\d{2}-\d{2}[\s\S]*?\d+\/\d+ appointed[\s\S]*?first kick-off in/.test(real),
    'ref-coverage no longer reports the round about to be played, its ' +
    'appointment count and the time to its first kick-off:\n' + real);
}

/* ---- the shortened name, and the surname it must not be ---------------- */
/* A Spanish name carries two surnames, paternal then maternal, and it is the
   PATERNAL one people use. Four pages each had their own refAbbr and three of
   them took the LAST token, so every La Liga official was displayed by the
   surname nobody says: the desk read "Ref Vega" while the RFEF's own
   designation sheet said Adrián Cordero.
   Now one implementation, PLDCore.refShort, checked here against the shipped
   tables rather than against invented names. */
{
  const core = coreOf();
  const shortOf = (n) => core.refShort(n);
  const load = (file, konst) => {
    const c = {};
    vm.createContext(c);
    vm.runInContext(readFileSync(join(root, file), 'utf8'), c);
    return vm.runInContext(konst, c);
  };

  /* THE BUG ITSELF: no official may be shown by their maternal surname alone.
     Checked over every La Liga name in the file, not a chosen few. */
  const llRefs = load('data/laliga_data.js', 'REFS').map((r) => r.n);
  assert.ok(llRefs.length >= 15, `only ${llRefs.length} La Liga referees to check`);
  for (const n of llRefs) {
    const parts = n.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const maternal = parts[parts.length - 1];
    assert.notEqual(shortOf(n), maternal,
      `${n} is shown as "${maternal}", the maternal surname — the paternal one ` +
      'is the name they are known by');
    assert.ok(shortOf(n).includes(parts[parts.length - 2]) || shortOf(n).includes(maternal),
      `${n} is shown as "${shortOf(n)}", which contains neither surname`);
  }

  /* A PARTICLE BELONGS TO THE SURNAME IT BEGINS. Both shapes appear in the
     shipped twenty and they need different handling — "De Burgos" starts a
     surname, the "de" in "Díaz de Mera" sits inside one. Taking the particle
     alone drops Díaz. */
  assert.equal(shortOf('Ricardo De Burgos Bengoetxea'), 'R. De Burgos Bengoetxea');
  assert.equal(shortOf('Isidro Diaz de Mera Escuderos'), 'I. Diaz de Mera Escuderos');

  /* NO TWO OFFICIALS IN ONE COMPETITION MAY SHARE A CELL. This is why the
     given initial is kept: without it the Championship's E Bell and J Bell,
     and Lewis and Josh Smith, were the same line. */
  for (const [file, code] of [['data/pl_data.js', 'PL'], ['data/eflc_data.js', 'EFLC'],
                              ['data/laliga_data.js', 'LL']]) {
    const names = load(file, 'REFS').map((r) => r.n);
    const seen = new Map();
    for (const n of names) {
      const s = shortOf(n);
      assert.ok(!seen.has(s),
        `${code}: "${n}" and "${seen.get(s)}" both display as "${s}" — two ` +
        'officials, one cell, and they price differently');
      seen.set(s, n);
    }
  }

  /* ONE IMPLEMENTATION. Six places had their own: four pages, two of which
     disagreed with the other two, plus the referee control and the referee
     strip, which both took the last token. Nothing on a card shortens a name
     any other way. */
  for (const page of ['index.html', 'eflc.html', 'laliga.html', 'today.html',
                      'assets/refpicker.js', 'assets/charts.js']) {
    const src = readFileSync(join(root, page), 'utf8');
    assert.ok(/refShort\(/.test(src),
      `${page} does not use PLDCore.refShort — it has grown its own rule again`);
    assert.ok(!/parts\[parts\.length - 1\]|p\[0\]\[0\] *\+ *"\. "/.test(src),
      `${page} still carries a local name-shortening rule`);
  }
  /* The two modules took the LAST TOKEN of the name, which is the shape this
     whole block exists to remove. Neither may do it to a referee again. */
  for (const mod of ['assets/refpicker.js', 'assets/charts.js']) {
    const src = readFileSync(join(root, mod), 'utf8');
    for (const m of src.matchAll(/^(?!\s*\*).*?\.split\(' '\)\.pop\(\)/gm)) {
      assert.fail(`${mod} shortens a name by its last token again: ` +
        `${m[0].trim()} — on a Spanish name that is the maternal surname`);
    }
  }

  /* AND THE CONTROL ACTUALLY RENDERS IT. The regexes above are tripwires on
     the source; this runs the thing. */
  {
    const ctl = {};
    vm.createContext(ctl);
    vm.runInContext(readFileSync(join(root, 'assets', 'core.js'), 'utf8'), ctl);
    vm.runInContext(readFileSync(join(root, 'assets', 'refpicker.js'), 'utf8'), ctl);
    const picker = vm.runInContext('PLDRefPicker', ctl);
    const name = 'Ricardo De Burgos Bengoetxea';
    const out = picker.html({ fid: 1, refs: [{ n: name, ypg: 4.6, matches: 30 }],
                              current: name, appointed: name, avg: 4.41 });
    assert.ok(out.includes('R. De Burgos Bengoetxea'),
      'the referee control does not show the appointed official by the ' +
      `surname they are known by:\n${out}`);
    assert.ok(!/>Bengoetxea[ <·(]/.test(out),
      `the referee control still labels the official by their maternal surname:\n${out}`);
  }
  console.log('  ok - referee names shorten through one implementation, never to ' +
    'the maternal surname, and no two officials share a cell');
}

/* ---- the COMBINED page resolves an appointment too ----------------------- */
/*
 * EVERY PAGE THAT PRICES A FIXTURE, not just the three desks. today.html was
 * the fourth, and the only one that looked appointments up by exact key:
 *
 *     L.refBy[fx.ref]        // "J. Brooks" — the record is "John Brooks"
 *
 * The competitions publish appointments in their own form and the card records
 * are keyed on whatever the history carries, so the exact lookup missed 28 of
 * the 50 appointed fixtures across the three divisions. A miss returns
 * undefined, which is indistinguishable from no appointment: the fixture drew
 * "Ref —" and priced at refFactor = 1 while the desk one tap away applied the
 * official — Ed Duckworth at 1.571 on QPR v Bolton, Ben Speedie at 0.539 on
 * Charlton v Derby.
 *
 * This is the same failure the header of this file describes, one page over,
 * and every guard was green while it shipped. So the assertion is not "does
 * today.html mention matchRefName" — it RUNS the resolver against the real
 * shipped data, which is what a source check would have missed.
 */
{
  const C = coreOf();
  const today = readFileSync(join(root, 'today.html'), 'utf8');
  /* From the two `var`s the closure captures, not from `L.refFor =` — a slice
     that starts at the assignment leaves refNames and refCache undeclared and
     the resolver throws on its first miss. */
  const from = today.indexOf('var refNames = ');
  assert.ok(from > 0 && today.indexOf('L.refFor = function (published)') > from,
    'today.html no longer builds a referee resolver — if it is back to ' +
    'L.refBy[fx.ref], every appointment published in an abbreviated form ' +
    'prices at the neutral league rate and reads as "Ref —"');
  const body = today.slice(from, today.indexOf('\n    };', from) + 7);
  const L = { refBy: {}, refs: [] };
  const ctx = { C, L, Object };
  vm.createContext(ctx);

  const DESKS = [
    ['PL', 'pl_data.js', 'pl_fixtures.js', 'PL_FIXTURES'],
    ['EFLC', 'eflc_data.js', 'eflc_fixtures.js', 'EFLC_FIXTURES'],
    ['LL', 'laliga_data.js', 'laliga_fixtures.js', 'LALIGA_FIXTURES'],
  ];
  let joined = 0, appointed = 0, unrated = 0;
  for (const [code, dataFile, fxFile, fxGlobal] of DESKS) {
    const dCtx = {};
    vm.createContext(dCtx);
    vm.runInContext(readFileSync(join(root, 'data', dataFile), 'utf8'), dCtx);
    vm.runInContext(readFileSync(join(root, 'data', fxFile), 'utf8'), dCtx);
    const REFS = vm.runInContext('typeof REFS !== "undefined" ? REFS : []', dCtx);
    const FX = vm.runInContext(fxGlobal, dCtx);

    L.refs = REFS;
    L.refBy = {};
    REFS.forEach((r) => { L.refBy[r.n] = r; });
    vm.runInContext(body, ctx);          // rebuild the resolver over this desk

    const withRef = FX.filter((f) => f.ref);
    appointed += withRef.length;
    for (const f of withRef) {
      const got = L.refFor(f.ref);
      if (got) {
        /* THE RIGHT RECORD, not merely a record. Counting non-null answers
           passes a resolver that returns the first referee in the list for
           every miss — it would raise the join count, not lower it, and every
           fixture would price off a stranger. */
        const want = L.refBy[f.ref] ? f.ref : C.matchRefName(f.ref, REFS.map((r) => r.n));
        assert.equal(got.n, want,
          `${code} ${f.h} v ${f.a}: "${f.ref}" resolved to "${got.n}", but the ` +
          `shared rule says ${want ? `"${want}"` : 'no official at all'} — the ` +
          'fixture is priced off the wrong referee');
        joined += 1;
        continue;
      }
      /* Null is a legitimate answer — an official with no card record, or an
         abbreviation matchRefName refuses because two officials share it. It
         must NOT be the answer for a name that plainly reaches a record. */
      const direct = C.matchRefName(f.ref, REFS.map((r) => r.n));
      assert.ok(!direct,
        `${code} ${f.h} v ${f.a}: today.html's resolver returns nothing for ` +
        `"${f.ref}", but it reaches "${direct}" — that fixture prices at the ` +
        'neutral league rate on the combined page and at the official\'s own ' +
        'rate on its desk');
      unrated += 1;
    }
    /* An empty resolver would satisfy every assertion above by never being
       asked, so assert it actually joined this desk's appointments. */
    assert.ok(withRef.length === 0 || joined > 0,
      `${code} has ${withRef.length} appointed fixtures and today.html ` +
      'resolved none of them');
  }
  assert.ok(joined >= 40,
    `today.html resolves only ${joined} of ${appointed} appointed fixtures — ` +
    'it resolved 47 when this guard was written, so the join has regressed');

  /* AND THE PRICING PATH MUST CALL IT. Everything above runs the resolver in
     isolation, which says nothing about whether price() still asks it: the
     first version of this guard passed with L.refFor defined and both call
     sites reverted to the exact lookup. Testing a function while the caller
     has stopped using it is the same mistake in miniature as the bug itself. */
  assert.ok(!/L\.refBy\[fx\.ref\]/.test(today),
    'today.html prices off L.refBy[fx.ref] again — the resolver exists but ' +
    'the fixture path is back to the exact lookup that misses every ' +
    'abbreviated appointment');
  const calls = (today.match(/L\.refFor\(fx\.ref\)/g) || []).length;
  assert.equal(calls, 2,
    `today.html routes ${calls} of its 2 pricing paths through the resolver ` +
    '(the Premier League model path and the shrink-then-hazard path) — both ' +
    'price a fixture, so both need the appointment');

  /* AND THE LABEL, ON ALL FOUR PAGES THAT DRAW ONE. An appointed official with
     no card record must not read the same as no appointment — that was the
     visible half of the same bug.
     This used to pin today.html's own expression, `p.ref && p.ref.name`, and
     it pinned the wrong thing twice over: it said nothing about the two league
     desks, which had the two-state version and shipped "Ref —" over an
     appointed official for months, and it failed the day the rule was lifted
     into core for all three to share. The rule is one function now, so this
     tests the FUNCTION's three answers and then that every page asks it. */
  {
    const core = coreOf();
    const rated = core.refLabel({ ref: { n: 'Mateo Busquets Ferrer' }, appointed: true });
    const unrated = core.refLabel({ ref: null, appointed: true, name: 'Rob Jones' });
    const none = core.refLabel({ ref: null, appointed: false });
    assert.equal(rated.state, 'rated');
    assert.equal(unrated.state, 'unrated');
    assert.equal(none.state, 'none');
    assert.notEqual(unrated.text, none.text,
      'an appointed official with no card record reads the same as no ' +
      'appointment — a neutral referee looking exactly like no referee is ' +
      'the bug this whole file opens with');
    assert.ok(/Rob Jones|R\. Jones/.test(unrated.text),
      `the unrated label does not name the official: ${unrated.text}`);
    assert.ok(unrated.title && /league rate/.test(unrated.title),
      'the unrated label does not say why the match prices at the league rate');
    assert.equal(none.text, 'Ref —');
    for (const page of ['today.html', 'eflc.html', 'laliga.html']) {
      const src = readFileSync(join(root, page), 'utf8');
      assert.ok(/C\.refLabel\(/.test(src),
        `${page} does not build its referee line through PLDCore.refLabel — ` +
        'it has grown its own, and the two that did could only draw two of ' +
        'the three states');
      assert.ok(!/\?\s*'Ref '\s*\+/.test(src),
        `${page} still carries a local "Ref ..." ternary beside the shared rule`);
    }
  }
  console.log(`  ok - the combined page joins ${joined} of ${appointed} ` +
    `appointments (${unrated} appointed with no card record, priced at the ` +
    'league rate and labelled as such)');
}

console.log('check-referees OK: the appointment joins across two id spaces, a ' +
  'hand pick still wins, the dropdown shows what the model prices with, all ' +
  'three leagues are harvested on a schedule that can catch them, and every ' +
  'official shortens through one rule to the surname they are known by, ' +
  'distinct from every colleague in their competition');

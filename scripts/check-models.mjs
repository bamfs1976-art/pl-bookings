// Are the desks pricing the same thing?
//
// Three competitions now appear on one page (/today) and in one share card, so
// a player's percentage on one desk is read against a player's percentage on
// another. That only means anything if the desks agree about what a percentage
// IS — and for a year they did not:
//
//   the Premier League priced through a logistic over yellows, fouls and
//   position; the Championship and La Liga through a Poisson hazard over the
//   shrunk yellow rate alone.
//
// Run over the SAME squads, those two produced a mean of 20.2% against 16.0%
// and a top end of 62% against 40%. Nothing was broken and nothing looked
// wrong; the two desks simply answered different questions, and putting them
// side by side invited a comparison neither supported.
//
// This guard pins the convergence. It is a CALIBRATION check, not a
// same-numbers check: the desks are allowed to differ because their leagues
// differ, and are not allowed to differ because their code does.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = readFileSync(join(root, 'assets', 'core.js'), 'utf8');
const model = (await import('file://' + join(root, 'data', 'model.js'))).default;

function load(file, playersKey) {
  const path = join(root, 'data', file);
  if (!existsSync(path)) return null;
  const c = {};
  vm.createContext(c);
  vm.runInContext(core, c);
  vm.runInContext(readFileSync(path, 'utf8'), c);
  const got = vm.runInContext(`({P: ${playersKey}, R: REFS})`, c);
  return { C: c.PLDCore, players: got.P, refs: got.R };
}

const DESKS = [
  { code: 'PL', name: 'Premier League', file: 'pl_data.js', key: 'PL_PLAYERS' },
  { code: 'EFLC', name: 'EFL Championship', file: 'eflc_data.js', key: 'EFLC_PLAYERS' },
  { code: 'LL', name: 'La Liga', file: 'laliga_data.js', key: 'LALIGA_PLAYERS' }
];

const S = model.shrink;
const mpick = (o, k, fb) => (o && o[k] != null ? o[k] : fb);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const quant = (a, x) => {
  const s = a.slice().sort((u, v) => u - v);
  return s[Math.floor(x * (s.length - 1))];
};

const seen = [];
for (const d of DESKS) {
  const got = load(d.file, d.key);
  if (!got) { console.log(`check-models: ${d.file} not built yet — skipping ${d.code}.`); continue; }
  const { C, players } = got;
  assert.ok(typeof C.pCardSeason === 'function',
    'assets/core.js no longer exports pCardSeason — the desks have no shared ' +
    'definition of a booking probability');

  const rows = players.filter((p) => (Number(p.min) || 0) > 0 && p.yc != null);
  assert.ok(rows.length > 100, `${d.code}: only ${rows.length} rated players`);

  const probs = [];
  let yc = 0, mins = 0;
  for (const p of rows) {
    const y = C.shrinkRate(p.yc || 0, p.min || 0,
      mpick(S.ycMean, p.p, S.ycLeague), S.strengthMatches);
    probs.push(C.pCardSeason(y));
    yc += p.yc || 0;
    mins += p.min || 0;
  }
  /* What the division ACTUALLY produced, as a probability: cards per 90 is a
     rate, and P(at least one) is 1 - exp(-rate). Comparing a mean probability
     to a mean rate is the mistake that makes a calibrated model look 8% low. */
  const rate = yc / (mins / 90);
  const observed = 1 - Math.exp(-rate);
  const got_ = mean(probs);

  /* Within a tenth of the league's own observed rate. Loose enough for
     shrinkage and squad composition, tight enough that a model answering a
     different question cannot pass — the logistic sat 26% high here. */
  const ratio = got_ / observed;
  assert.ok(ratio > 0.9 && ratio < 1.1,
    `${d.name}: the desk prices a mean ${(got_ * 100).toFixed(1)}% against a ` +
    `division that produced ${(observed * 100).toFixed(1)}% ` +
    `(ratio ${ratio.toFixed(2)}) — it is not calibrated to its own league`);

  /* No player is booked in most of his matches. The most-carded player in a
     top division picks up about twelve yellows in thirty-eight games, which
     is a third of them. The logistic reached 62-70% here. */
  const max = Math.max(...probs);
  assert.ok(max < 0.55,
    `${d.name}: top P(card) is ${(max * 100).toFixed(1)}% — no player is ` +
    'booked in half his matches; the most-carded manage about a third');

  seen.push({ code: d.code, mean: got_, observed, max, median: quant(probs, 0.5) });
}

assert.ok(seen.length >= 2,
  'fewer than two desks are built, so nothing was actually compared');

/* THE POINT OF THE FILE. Every desk must be calibrated to its OWN league, and
   the leagues genuinely differ — Spain cards more than England. So this does
   not demand equal means; it demands that each desk's error against its own
   league is small and in the same direction. Two desks that are each within a
   tenth of their own division are comparable to each other by construction. */
for (const s of seen) {
  const err = s.mean / s.observed;
  assert.ok(err > 0.9 && err < 1.1, `${s.code} drifted: ratio ${err.toFixed(2)}`);
}
const spread = Math.max(...seen.map((s) => s.mean / s.observed))
             - Math.min(...seen.map((s) => s.mean / s.observed));
assert.ok(spread < 0.08,
  `the desks' calibration errors differ by ${(spread * 100).toFixed(1)} points — ` +
  'they are answering different questions again, which is what makes a ' +
  'cross-league percentage misleading:\n  ' +
  seen.map((s) => `${s.code} ${(s.mean / s.observed).toFixed(3)}`).join('\n  '));

/* The Premier League desk must not have quietly gone back to the logistic. */
const pm = readFileSync(join(root, 'assets', 'plmodel.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
assert.ok(/pCardSeason/.test(pm),
  'assets/plmodel.js no longer prices through PLDCore.pCardSeason');
assert.ok(!/glmProb\s*\(/.test(pm),
  'assets/plmodel.js is calling glmProb again — that is the model that sat 26% ' +
  'high and topped out at 62%, and it is what made the Premier League ' +
  'incomparable with the other two desks');

/* And neither has index.html. It keeps its own copy of pModelBase — the desk
   is a single-file app and that is not changing today — so the convergence has
   to be pinned in BOTH places or the desk and /today drift apart again, which
   is exactly what happened for one commit while this change was being made:
   the shared module was converged and the desk was not. */
const deskCode = readFileSync(join(root, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const deskBase = /function pModelBase\(p\)\{([\s\S]*?)\n\}/.exec(deskCode);
assert.ok(deskBase, 'could not find pModelBase in index.html');
assert.ok(/pCardSeason/.test(deskBase[1]),
  'index.html prices through something other than PLDCore.pCardSeason — the ' +
  'desk and /today would show different numbers for the same player');
assert.ok(!/glmProb/.test(deskBase[1]),
  'index.html is pricing through glmProb again — that is the model that sat ' +
  '26% high and made this desk incomparable with the other two');

/* ---- a match fit must not replace the prior on one round of football ----- */
/*
 * The gate was 200 rows and a Premier League gameweek produces about 280, so
 * on the Sunday night after the opening weekend a six-parameter logistic
 * estimated from a single round silently replaced a prior derived from a whole
 * season of aggregates. Nothing threw and nothing on the page said so.
 *
 * Events per parameter was never the binding constraint. What binds is that
 * one round is one sample of the referees, the weather and the team news, and
 * the recency weighting concentrates rather than dilutes it.
 *
 * RUN, with synthetic histories, because the gate is two conditions and a
 * source check would pass on either of them alone. The fits go to a scratch
 * file via --out: a guard that saves and restores data/model.js leaves it
 * corrupted the one time it is interrupted.
 */
{
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'fitgate-'));
  const basisOf = (rows) => {
    const hist = join(dir, 'h.json'), out = join(dir, 'm.js');
    writeFileSync(hist, JSON.stringify(rows));
    const log = execFileSync('node',
      [join(root, 'scripts', 'build-model.mjs'), '--fit', hist, '--out', out],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = /basis=([a-z-]+)/.exec(log);
    assert.ok(m, `build-model printed no basis:\n${log}`);
    return m[1];
  };
  /* Deterministic rows — a fixed pattern, so a run cannot pass or fail on the
     luck of a seed. The features are irrelevant to the gate; only the count of
     rows and of distinct rounds decide it. */
  const rows = (gws, perGw) => {
    const out = [];
    for (let gw = 1; gw <= gws; gw++) {
      for (let i = 0; i < perGw; i++) {
        out.push({ round: gw, pos: ['DF', 'MF', 'FW'][i % 3],
          yc90: (i % 7) / 20, foul90: 0.5 + (i % 11) / 8, y: i % 6 === 0 ? 1 : 0 });
      }
    }
    return out;
  };
  try {
    assert.equal(basisOf(rows(1, 280)), 'season-prior',
      'ONE gameweek of football is being fitted over a whole season of ' +
      'aggregates. That is not an estimate of how a foul becomes a card, it ' +
      'is an estimate of how it did on that Saturday.');
    /* Rows without rounds: enough rows, but nothing showing they span more
       than one, so the gate must refuse rather than assume. */
    assert.equal(basisOf(rows(1, 280).map(({ round, ...r }) => r)), 'season-prior',
      'a history with no gameweek numbering is being fitted — the rows cannot ' +
      'be shown to span more than one round, so they must be treated as if ' +
      'they do not');
    /* EACH BAR ISOLATED. Both of these clear one bar and fail the other, which
       is the only way to tell a two-condition gate from whichever single
       condition happens to decide every case you thought to write down. */
    assert.equal(basisOf(rows(4, 280)), 'season-prior',
      'four gameweeks (1,120 rows) clears the fit gate: plenty of rounds, not ' +
      'enough rows, so the ROW bar is not being applied');
    assert.equal(basisOf(rows(2, 800)), 'season-prior',
      'two gameweeks of 1,600 rows clears the fit gate: plenty of rows, two ' +
      'rounds of football, so the GAMEWEEK bar is not being applied. A fit ' +
      'on two rounds still estimates two weekends of referees.');
    assert.equal(basisOf(rows(5, 60)), 'season-prior',
      'five near-empty gameweeks (300 rows) clears the fit gate — a round ' +
      'where half the division was postponed must not buy a refit');
    /* Rounds counted from the ROWS THAT WERE FITTED, not from the file. Five
       rounds in the file, one of them entirely unusable outcomes, is four
       rounds of evidence — and counting the file lets a round that
       contributed nothing vote for its own inclusion. */
    assert.equal(
      basisOf([...rows(4, 400), ...rows(1, 400).map((r) => ({ ...r, round: 5, y: null }))]),
      'season-prior',
      'a fifth round of unusable outcomes is being counted toward the ' +
      'gameweek bar — the rounds are read off the file rather than off the ' +
      'rows that actually entered the fit');
    assert.equal(basisOf(rows(6, 280)), 'match-fit',
      'six full gameweeks (1,680 rows) is being refused, so the gate can ' +
      'never open and the fit machinery is dead code');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---- the desks stop pricing from last season, and by a stated round ------ */
/*
 * Every player rate came from a squad harvest pinned to a literal season in
 * data-refresh.yml. Right in August, wrong in October, and wrong invisibly:
 * the numbers still look like numbers, they are simply last year's. Nothing in
 * the repository would ever have changed it.
 *
 * RUN AT REAL DATES from the shipped fixture lists, so this also fails if a
 * league's fixtures or round numbering go missing.
 */
{
  const F = await import('file://' + join(root, 'scripts', 'form-season.mjs'));
  assert.ok(F.FLIP_AT <= 10,
    `the form season flips at round ${F.FLIP_AT}, past the round-10 ceiling.`);
  assert.ok(F.FLIP_AT >= 2,
    `flipping at round ${F.FLIP_AT} prices the desks off a season barely ` +
    'begun — before the k=6 shrinkage gives a player his own record any weight');
  assert.ok(F.FLIP_DEADLINE <= 10,
    `the deadline itself has moved to round ${F.FLIP_DEADLINE}`);
  /* THE CEILING, EXERCISED PAST THE VALUES IT CURRENTLY TAKES. With the switch
     at 6 the deadline never binds, so a real ceiling and a decorative one
     compute the same number today and differ only on the day someone raises
     the switch — the day nobody is testing. Called here with a switch beyond
     the deadline, which is the only way to tell them apart. */
  assert.equal(F.flipAt(14, 10), 10,
    'the round-10 deadline is decorative: raising the switch would push the ' +
    'flip past it, and the desks would price off last season into November');
  assert.equal(F.flipAt(3, 10), 3, 'the deadline is overriding an earlier switch');
  assert.equal(F.FLIP_AT, F.flipAt(F.SWITCH_AT, F.FLIP_DEADLINE),
    'FLIP_AT is no longer the ceiling applied to the switch');

  const firstKick = (fixtures, round) => Math.min(...fixtures
    .filter((f) => f.r === round && f.d).map((f) => new Date(f.d).getTime()));

  for (const L of F.LEAGUES) {
    const ctx = {}; vm.createContext(ctx);
    vm.runInContext(readFileSync(join(root, L.file), 'utf8'), ctx);
    const fixtures = vm.runInContext(L.konst, ctx) || [];
    assert.ok(fixtures.length, `${L.name} has no fixtures to decide a season from`);

    const beforeAny = firstKick(fixtures, 1) - 3600000;   // an hour before the opener
    const atTen = firstKick(fixtures, 10) + 3600000;      // an hour into round 10
    const byRound = (t) => F.decide(t).find((r) => r.code === L.code);

    const pre = byRound(beforeAny);
    assert.equal(pre.form, pre.current - 1,
      `${L.name} is priced off ${pre.form}-form before a ball is kicked in ` +
      `${pre.current}. An unplayed season rates every player at the ` +
      'positional mean.');

    const ten = byRound(atTen);
    assert.equal(ten.form, ten.current,
      `${L.name} is STILL priced off ${ten.form}-form once round 10 has ` +
      `started. The deadline is round 10 and this is ${ten.progress} rounds in.`);

    /* THE CALENDAR ALONE MUST CARRY IT — proved by REMOVING the statuses,
       not by asserting the shipped file has none.
     *
     * The first version of this asserted `ten.played === 0`, on the grounds
     * that every shipped fixture was "NS" and so a status-dependent flip
     * could never have fired. That was true the day it was written and false
     * the following evening, when the Championship played its opening match
     * and the file came back carrying an FT. The guard failed on correct
     * data, took the whole data refresh down with it, and did so on the
     * morning La Liga opened.
     *
     * A guard that encodes "the season has not started yet" as a permanent
     * invariant is a time bomb with a known fuse. The PROPERTY is what
     * matters: strip the status field and the calendar must still reach the
     * flip, because that is the stale-feed failure the two signals exist to
     * survive. */
    const statusless = fixtures.map((f) => ({ ...f, st: 'NS' }));
    const blind = F.progressOf(statusless, atTen);
    assert.equal(blind.played, 0, 'the test fixtures were not actually stripped');
    assert.ok(blind.elapsed >= 10,
      `${L.name}: with the status field removed the calendar counted only ` +
      `${blind.elapsed} rounds an hour into round 10, so the flip depends on ` +
      'a feed that can go stale');
    /* And the real data must agree with the blind version, so a status field
       that IS present can only ever confirm the answer, never change it. */
    assert.ok(ten.progress >= blind.elapsed,
      `${L.name}: the shipped statuses moved the answer backwards ` +
      `(${ten.progress} against ${blind.elapsed} from the calendar alone)`);
  }
}

/* ---- and the workflow actually asks ------------------------------------- */
/*
 * A transition nothing calls is a script with a passing test. The three FORM
 * harvests must read the computed answer; the four PINNED ones must not — a
 * promoted club has no top-flight record to transition to, and the referee
 * join needs the completed season by construction.
 */
{
  const wf = readFileSync(join(root, '.github', 'workflows', 'data-refresh.yml'), 'utf8');
  assert.ok(/id: form\b[\s\S]{0,200}?form-season\.mjs --github >> "\$GITHUB_OUTPUT"/.test(wf),
    'nothing runs form-season.mjs into the job outputs, so the transition ' +
    'below can never fire');
  const uses = [...wf.matchAll(/API_FOOTBALL_SEASON: \$\{\{([^}]*)\}\}/g)].map((m) => m[1]);
  const transitioning = uses.filter((u) => /steps\.form\.outputs\.form_/.test(u));
  assert.equal(transitioning.length, 3,
    `${transitioning.length} harvest(s) follow the form transition, expected 3 ` +
    '(Championship squads, the relegated three, La Liga squads). Either a form ' +
    'harvest has been left on last season for ever, or a pinned one — a ' +
    'promoted club\'s prior-tier record, or the completed-season referee join ' +
    '— has been swept along with them.');
  /* Every pinned use says so in the line above it, so the next reader making
     them consistent has to argue with a reason rather than a blank. */
  const pinned = wf.split('\n').map((l, i, all) =>
    /API_FOOTBALL_SEASON: \$\{\{/.test(l) && !/steps\.form\.outputs/.test(l)
      && /season_af/.test(l) ? all.slice(Math.max(0, i - 5), i).join(' ') : null)
    .filter(Boolean);
  for (const before of pinned) {
    assert.ok(/PINNED/.test(before),
      'a season_af harvest is pinned to last season with no note saying why — ' +
      'the next reader will "fix" it for consistency with the three that ' +
      'transition, and repoint the referee join or a promoted-club backfill');
  }
}

console.log(
  'check-models OK: ' + seen.map((s) =>
    `${s.code} prices ${(s.mean * 100).toFixed(1)}% against ` +
    `${(s.observed * 100).toFixed(1)}% observed ` +
    `(max ${(s.max * 100).toFixed(0)}%)`).join('; ')
);

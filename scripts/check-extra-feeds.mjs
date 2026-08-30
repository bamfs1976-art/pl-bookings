// Guard the eleven feeds the desk was not calling.
//
// These files are DIFFERENT IN KIND from everything else in data/. Every other
// dataset here was built by a parser somebody watched work against a real
// payload. These were written from the documented v3 shape by a process that
// could not reach the API and held no key, so until the probes land, each one
// is an assumption wearing a filename.
//
// That produces failure modes the rest of the repository does not have:
//
//   1. A FEED THAT IS SILENTLY EMPTY. A parser that reaches for a key which is
//      not there and returns [] writes a well-formed file containing nothing,
//      and "nothing" is indistinguishable from a quiet week. The defence is in
//      the parsers (expect() refuses), and what is checked HERE is that the
//      defence is still wired: every parser must declare required keys.
//   2. A FILE NOTHING TOLERATES BEING ABSENT. None of these exist yet. A page
//      that assumed one would break for every reader until the first harvest.
//   3. A SECOND WRITER. Four workflows now push to main; two of them writing
//      one file is this repository's most reliable way of producing two that
//      disagree.
//   4. AN IMAGE OR HOST THE CSP DOES NOT ALLOW, arriving from a new feed.
//
//     node scripts/check-extra-feeds.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const src = read('data/harvest_extra.py');

/* ---- 1. every parser still refuses a shape it was not written for ------- */
/* The parsers are the only thing standing between an unrecognised payload and
   a file full of nothing. `expect()` is that refusal; a parser that stops
   calling it fails open. */
const parsers = [...src.matchAll(/^def (parse_\w+)\(/gm)].map((m) => m[1]);
assert.ok(parsers.length >= 10,
  `data/harvest_extra.py declares ${parsers.length} parsers; eleven endpoints ` +
  'were meant to have one each');
for (const p of parsers) {
  const body = new RegExp(`^def ${p}\\([\\s\\S]*?(?=\\n\\ndef |\\n\\n# ─)`, 'm').exec(src);
  assert.ok(body, `could not read the body of ${p}`);
  assert.ok(/expect\(|ShapeError/.test(body[0]),
    `${p} neither calls expect() nor raises ShapeError, so a payload that is ` +
    'not the shape it was written for produces an empty result instead of a ' +
    'refusal. An empty feed reads as a quiet week, and nothing downstream can ' +
    'tell the difference.');
}

/* AND expect() STILL LOOKS AT THE KEYS. Written as a no-op it would satisfy
   every assertion above while protecting nothing. */
const expectFn = /def expect\(rows, required, what\):[\s\S]*?\n\ndef /.exec(src);
assert.ok(expectFn, 'expect() is gone');
assert.ok(/_dig\(first, p\) is _MISSING/.test(expectFn[0]),
  'expect() no longer checks the required keys against the payload');
assert.ok(/raise ShapeError/.test(expectFn[0]),
  'expect() no longer raises — it reports and continues, which is the same as ' +
  'not checking');
/* An empty response is a STATE, not a shape failure: no fixtures today is the
   normal condition for most of these, and refusing it would fail every night. */
assert.ok(/if not rows:\s*\n\s*return rows/.test(expectFn[0]),
  'expect() treats an empty response as a shape failure — a division with no ' +
  'injuries, or a day with no fixtures, would fail the harvest');

/* ---- 2. and the probe exists, because the shapes are still assumptions --- */
assert.ok(/def probe\(/.test(src) && /PROBE_CALLS = \[/.test(src),
  'data/harvest_extra.py has no --probe mode. Every parser in it was written ' +
  'without access to the API; the probe is the only way the assumptions ever ' +
  'become evidence.');
const probed = (src.match(/^\s{4}\("(\w+)", "/gm) || []).length;
assert.ok(probed >= 10,
  `--probe covers ${probed} endpoint(s); it must cover every one a parser ` +
  'exists for, or the unprobed ones stay guesses forever');
/* THE DOCSTRING MUST KEEP SAYING SO. This is the one caveat a reader needs
   before trusting an output file, and it is exactly the kind of warning that
   gets tidied away once the code looks finished. */
assert.ok(/WITHOUT ACCESS TO THE API/.test(src),
  'the module no longer says that its response shapes were never verified. ' +
  'Delete that only when the probes have landed and the parsers have been ' +
  'reconciled against them — not because the code looks settled.');

/* ---- 3. every output file is OPTIONAL --------------------------------- */
/* None of these exist yet, and most will not exist for a division until its
   first successful harvest. A page that assumed one would break for every
   reader in the meantime. */
const OUTPUTS = [];
for (const lg of ['pl', 'eflc', 'laliga']) {
  for (const n of ['injuries', 'cardleaders', 'standings', 'teamstats',
                   'cardevents', 'fxstats', 'predictions', 'odds']) {
    OUTPUTS.push(`data/${lg}_${n}.js`);
  }
}
for (const page of ['index.html', 'today.html', 'eflc.html', 'laliga.html',
                    'data-frame.html']) {
  const html = read(page);
  for (const f of OUTPUTS) {
    if (!html.includes(f)) continue;
    const line = html.split('\n').find((l) => l.includes(f)) || '';
    assert.ok(/onerror="void 0"/.test(line) || /ALLOWED/.test(html),
      `${page} loads ${f} without onerror="void 0". None of these files exist ` +
      'yet; a missing one falls through the /data/* rule to a 404 and, without ' +
      'the guard, breaks the page for every reader until the first harvest.');
  }
}
/* A shipped file must at least parse and be the shape the page will read. */
let shipped = 0;
for (const f of OUTPUTS) {
  if (!existsSync(join(root, f))) continue;
  shipped++;
  const c = {};
  vm.createContext(c);
  vm.runInContext(read(f), c);
  const konst = /const (\w+) =/.exec(read(f));
  assert.ok(konst, `${f} declares no const`);
  const val = vm.runInContext(konst[1], c);
  assert.ok(val !== undefined, `${f} declares ${konst[1]} as nothing`);
}

/* ---- 3a. availability reaches the board, on the SHARED name join ------- */
/* A player who is out cannot be booked, and the boards rated him exactly as
   though he were playing. The join is the danger: the injury feed spells a
   player its own way and the squads spell him theirs, which is the join this
   repository has been bitten by more than any other. */
{
  const core = read('assets/core.js');
  assert.ok(/function unavailable\(/.test(core),
    'assets/core.js has no availability lookup');
  const fn = /function unavailable\([\s\S]*?\n  \}/.exec(core);
  assert.ok(fn && /matchSquadName\(/.test(fn[0]),
    'unavailable() does its own name matching instead of calling ' +
    'matchSquadName — a fifth implementation of the join that has gone wrong ' +
    'more often than any other here. Unique or nothing is the rule, and a ' +
    'looser one flags the wrong man as injured.');
  assert.ok(/r\.c === club/.test(fn[0]),
    'unavailable() does not scope to the club, so a player who shares a name ' +
    'with an injured man at another club is flagged as out');

  /* A FLAG, NOT A PRICE. The feed says "Questionable" as readily as "Missing
     Fixture"; a desk that zeroed a doubtful player would be making the
     selection call the reader came for. */
  const today = read('today.html');
  assert.ok(/availFlag\(/.test(today), 'today.html does not show availability');
  const flag = /function availFlag\([\s\S]*?\n  \}/.exec(today);
  assert.ok(flag, 'today.html has no availFlag builder');
  assert.ok(!/prob|\bp\.m\b|expected/.test(flag[0]),
    'the availability flag touches a probability. It annotates a price it must ' +
    'not change: "Questionable" is not "not playing", and deciding that for ' +
    'the reader is the judgement they came here to make.');
  assert.ok(/if \(!L \|\| !L\.injuries\) return/.test(flag[0]),
    'today.html assumes an injuries file exists. None does for any division ' +
    'until the first extra-feeds run lands.');
  assert.ok(/injuries: d\.injuries \|\| null/.test(today)
    && /injuries:/.test(read('data-frame.html')),
    'the injuries file is not published through the data frame, so /today ' +
    'cannot see it whatever the harvest writes');
  /* Both states reach the stylesheet, or one of them is invisible. */
  const css = read('assets/tw.css');
  for (const cls of ['avail-out', 'avail-doubt']) {
    assert.ok(css.includes('.' + cls), `${cls} has no rule, so that state is invisible`);
  }
}

/* ---- 4. one owner, and it checks before it pushes ---------------------- */
const wf = join(root, '.github', 'workflows');
const flows = readdirSync(wf).filter((f) => /\.ya?ml$/.test(f));
const owners = flows.filter((f) =>
  /python3 data\/harvest_extra\.py/.test(readFileSync(join(wf, f), 'utf8')));
assert.equal(owners.length, 1,
  `${owners.length} workflow(s) run harvest_extra.py (${owners.join(', ')}). ` +
  'Four workflows already push to main; two writing one file is how the two ' +
  'come to disagree.');
const owner = readFileSync(join(wf, owners[0]), 'utf8');
assert.ok(/HARVEST_EXTRA_STRICT/.test(owner),
  `${owners[0]} does not set HARVEST_EXTRA_STRICT. Without it a shape ` +
  'mismatch prints and the run goes green — which is the failure this whole ' +
  'design exists to make loud.');
assert.ok(owner.indexOf('check-all.mjs') < owner.indexOf('git push'),
  `${owners[0]} pushes before running the guards`);

/* AND THE COST IS BOUNDED. Two of these are per-fixture and one is per-player;
   an unscoped walk is how a 5%-of-quota app becomes a 100%-of-quota one. */
assert.ok(/--within-hours/.test(owner),
  `${owners[0]} runs the forward-looking feeds (odds, predictions) without ` +
  '--within-hours, so they would walk a whole season of fixtures rather than ' +
  'the next few days. One call each.');
assert.ok(!/--what[^\n]*sidelined/.test(owner),
  `${owners[0]} schedules /sidelined, which is ONE CALL PER PLAYER — about ` +
  '2,040 across the three divisions, 27% of a day\'s allowance in one walk. ' +
  'It is deliberately manual and --limit-only.');

console.log(`check-extra-feeds OK: ${parsers.length} parsers, each refusing a ` +
  `shape it was not written for; ${probed} endpoints probeable; ${shipped} ` +
  `output file(s) shipped so far and every one optional; ${owners[0]} the sole ` +
  'owner, strict about shape, guarded before it pushes, and bounded in cost');

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
/* The caveat has EARNED its change: the probes landed and the parsers were
   reconciled, so the module no longer claims nothing is verified. What it must
   still do is name what is NOT — the two that were never probed. A module that
   quietly stops distinguishing verified from assumed is back where it started
   with a more confident tone. */
assert.ok(/STILL UNVERIFIED/.test(src),
  'data/harvest_extra.py no longer names which endpoints are still unverified. ' +
  'Ten of eleven were reconciled against recorded probes; /sidelined was not, ' +
  'and neither was whether /fixtures?live= inlines events. Saying so is the ' +
  'difference between evidence and a confident tone.');
assert.ok(/sidelined/.test(src.slice(0, src.indexOf('import argparse'))),
  'the docstring no longer names /sidelined as unprobed');
/* AND THE FINDING ITSELF, which is the one a future edit is most likely to
   undo because it looks like defensive noise. */
assert.ok(/def collapse_second_yellow\(/.test(src),
  'collapse_second_yellow is gone. The feed sends a second-yellow dismissal ' +
  'as two yellows AND a red at the same minute — no "Second Yellow card" ' +
  'detail exists — so counting the events straight gives three cards for one ' +
  'sending-off, which is the arithmetic build_bookings.cards_in() exists to ' +
  'prevent, on a leaderboard, inflating the players at the top of it.');
{
  const lc2 = read('assets/livecards.js');
  assert.ok(/idx\[k\]\.yc >= 2 && idx\[k\]\.rc > 0/.test(lc2),
    'assets/livecards.js does not collapse a second yellow. The live ticker ' +
    'reads the same events feed and has the same exposure: two yellows and a ' +
    'red for one man would count as three cards, in front of a reader.');
}

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

/* ---- 3b. the live ticker for the divisions FPL does not cover ---------- */
/* assets/livecards.js has said since it was written that "a bookings desk
   saying a carded player is a 52% chance of being carded is the worst sentence
   this product can produce" — and it was loaded on index.html alone, because
   its source is the FPL live feed and FPL is the Premier League and nothing
   else. /api/live-cards fills that for the other two.
   IT IS METERED, WHICH THE FPL FEED IS NOT, and that is the whole difference:
   this function is called by BROWSERS, so an uncached one spends a call per
   reader per poll. */
{
  const fn = read('netlify/functions/live-cards.js');

  /* THE CACHE IS THE COST CONTROL. Without it a hundred readers polling once a
     minute is a hundred calls a minute, which empties a 7,500 allowance inside
     an hour of one busy Saturday. */
  assert.ok(/max-age=\$\{TTL\}/.test(fn),
    'netlify/functions/live-cards.js serves the live payload without an edge ' +
    'cache. It is called by browsers and every call is metered: uncached, one ' +
    'popular Saturday afternoon costs the week\'s quota.');
  const ttl = /const TTL = (\d+)/.exec(fn);
  assert.ok(ttl && Number(ttl[1]) >= 30 && Number(ttl[1]) <= 120,
    `the live TTL is ${ttl ? ttl[1] : 'missing'}s. Too short spends the ` +
    'allowance; too long and the page says "not booked" about a man who was ' +
    'booked, which is the sentence this whole layer exists to prevent.');
  assert.ok(/const MAX_FIXTURES = \d+/.test(fn),
    'the live function fans out over in-play fixtures with no ceiling. An ' +
    'unbounded fan-out on a metered endpoint behind a public URL is a bill.');

  /* AN ALLOWLIST, NOT A PASSTHROUGH. The league arrives in a query string a
     reader controls; without one this is an open, authenticated proxy to
     somebody else's metered API. */
  assert.ok(/const LEAGUES = \{/.test(fn),
    'live-cards.js takes a league id straight from the query string — that is ' +
    'an open proxy to a metered API that anyone can point anywhere');

  /* AND THE KEY STAYS ON THE SERVER. */
  assert.ok(/process\.env\.API_FOOTBALL_KEY/.test(fn),
    'live-cards.js does not read the key from the environment');
  for (const page of ['index.html', 'today.html', 'eflc.html', 'laliga.html',
                      'assets/livecards.js']) {
    assert.ok(!/API_FOOTBALL_KEY|x-apisports-key/.test(read(page)),
      `${page} mentions the API-Football key. It is a metered credential and ` +
      'belongs only in the function.');
  }
  /* A DESK WITH NO KEY IS NOT A BROKEN DESK — it is where the other two have
     been all along, and the forecast view is still correct. */
  assert.ok(/if \(!KEY\)[\s\S]{0,500}statusCode: 200/.test(fn),
    'live-cards.js errors when no key is configured. A missing key must render ' +
    'as the ordinary forecast view, not as a broken page.');
  /* WHAT IT SPENT, in the response rather than a log, so "what is the live
     layer costing" is answerable from the page. */
  assert.ok(/upstream,/.test(fn), 'the live function does not report what it spent');

  assert.ok(/\/api\/live-cards/.test(read('_redirects')),
    '/api/live-cards has no route, so the function is unreachable');

  /* ONE TICKER, TWO SOURCES. A second implementation of the tally is exactly
     the failure this repository keeps meeting. */
  const lc = read('assets/livecards.js');
  assert.ok(/function indexApiLive\(/.test(lc),
    'assets/livecards.js has no indexer for the events feed');
  assert.equal((lc.match(/function fixtureTicker\(/g) || []).length, 1,
    'there is more than one fixture-ticker builder');
  for (const page of ['eflc.html', 'laliga.html']) {
    const src2 = read(page);
    assert.ok(/LiveCards\.fixtureTicker\(/.test(src2),
      `${page} does not go through the shared LiveCards.fixtureTicker`);
    assert.ok(/assets\/livecards\.js/.test(src2),
      `${page} does not load assets/livecards.js`);
    assert.ok(!/\['FT', 'AET', 'PEN'\]/.test(src2),
      `${page} carries its own finished-status list in the live path`);
  }

  /* THE SECOND YELLOW, COUNTED ONCE. This was wrong first time: recording it
     as both a yellow and a red made a booking and a dismissal read as THREE
     cards on a live page — the arithmetic data/build_bookings.py's cards_in()
     exists to prevent, arriving where a reader would watch it happen. */
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(lc, ctx);
  const LC = vm.runInContext('LiveCards', ctx);
  const R = (n) => ({ Home: 'HOM', Away: 'AWY' }[n] || null);
  const got = LC.indexApiLive({
    h: 'Home', a: 'Away', minute: 40,
    cards: [{ c: 'Home', n: 'P', k: 'Y' }, { c: 'Home', n: 'P', k: 'Y2' },
            { c: 'Away', n: 'Q', k: 'R' }],
  }, R);
  const t = LC.fixtureTicker(got.idx, got.elClub, 'HOM', 'AWY',
                             { minute: 40, started: true });
  assert.equal(t.cards, 3,
    `a booking, a second yellow and a straight red total ${t.cards} cards on ` +
    'the live ticker. The convention everywhere else here — the ledger, the ' +
    'match record, outcomeTotals — is that the two yellows ARE the two cards: ' +
    'the answer is 3, and 4 means the dismissal is being counted as a card of ' +
    'its own.');
  assert.equal(LC.playerState(got.idx, 'HOM|P'), 'sent-off',
    'a player dismissed for a second yellow does not read as sent off');
  assert.equal(t.minute, 40,
    'the ticker does not take the fixture\'s own clock from the events feed');
  /* A LIVE 0-0 WITH NO CARDS IS THE MOST USEFUL THING A CARD DESK CAN SAY. */
  const clean = LC.indexApiLive({ h: 'Home', a: 'Away', minute: 22, cards: [] }, R);
  assert.ok(LC.fixtureTicker(clean.idx, clean.elClub, 'HOM', 'AWY',
                             { minute: 22, started: true }),
    'a live fixture with no cards yet shows nothing. "22 minutes gone, no ' +
    'cards" is exactly what this desk is for.');
  /* AND THE FPL SOURCE IS UNTOUCHED. */
  assert.equal(LC.playerState(LC.indexLive({ elements: [
    { id: 1, stats: { yellow_cards: 1, red_cards: 0, minutes: 90 } }] }), 1), 'booked',
    'the Premier League ticker changed behaviour when the second source landed');
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

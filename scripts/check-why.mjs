#!/usr/bin/env node
/* The Why line must explain the price that is actually beside it.
 *
 * Every candidate on a fixture card carries a percentage. Until now nothing
 * said where it came from, so a reader could see that one player was 46% and
 * another 41% with no way to tell whether the gap was the players, the
 * referee, the venue or the fixture — the difference between a number to act
 * on and a number to take on trust.
 *
 * THE FAILURE THIS GUARD EXISTS FOR is not a missing sentence. It is a
 * sentence that is present, plausible, well-written and quoting a figure the
 * model did not use. That is strictly worse than saying nothing: it looks
 * like an explanation and is a second, quieter model disagreeing with the
 * first, and nothing on the page would ever show the disagreement. So what is
 * checked here is that each desk's whyFacts() reads the SAME factor sources
 * its own pricing function reads.
 *
 * THE SECOND FAILURE is the template. A line that says the same thing about
 * everyone with different nouns in it is read three times and then never
 * again, and it would pass any "is there a sentence" check. What must vary is
 * WHICH CLAUSES APPEAR — an average referee is not why, so he is not
 * mentioned — and that is asserted by running the real function across
 * fixtures that differ in one input at a time.
 *
 *     node scripts/check-why.mjs
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
const DESKS = ['index.html', 'eflc.html', 'laliga.html', 'today.html'];

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. one clause per thing that is actually true --------------------- */
const BASE = { y90: 0.31, posMean: 0.199, pos: 'MF', minutes: 2400,
               derbyFactor: 1, venueFactor: 1, isHome: true };

/* An average referee moves nothing, so naming him would be filler on every
   card in a round. Swept across the whole neutral band rather than tried at
   one value, because a threshold is exactly what gets nudged. */
for (let f = 0.98; f <= 1.021; f += 0.005) {
  const line = C.whyLine({ ...BASE, ref: { name: 'Oliver', factor: f } });
  assert.ok(!/Oliver/.test(line),
    `a referee moving ${((f - 1) * 100).toFixed(1)}% is named in the why line: "${line}"`);
}
checks++;
/* And one who does move it is named, with the size of what he does — in both
   directions, because "adds" and "takes off" are different sentences and only
   one of them tends to get written. */
const strict = C.whyLine({ ...BASE, ref: { name: 'Oliver', factor: 1.18 } });
const lenient = C.whyLine({ ...BASE, ref: { name: 'Sesma', factor: 0.86 } });
ok(/Oliver adds 18%/.test(strict), `a strict referee is not explained: "${strict}"`);
ok(/Sesma takes 14% off/.test(lenient), `a lenient referee is not explained: "${lenient}"`);
ok(strict !== lenient, 'a strict and a lenient referee produce the same sentence');

/* ---- 2. only the biggest multiplier, and it is genuinely the biggest ---- */
{
  const many = { ...BASE, ref: { name: 'Oliver', factor: 1.04 },
                 derbyFactor: 1.08, venueFactor: 1.05, chaseFactor: 1.03 };
  const line = C.whyLine(many);
  ok(/a derby adds 8%/.test(line), `the largest effect is not the one named: "${line}"`);
  ok(!/Oliver/.test(line) && !/at home|away/.test(line) && !/tight match/.test(line),
    `more than one multiplier reached the line: "${line}"`);
  /* Make the referee the biggest and it must swap. A guard that only ever saw
     the derby win would pass an implementation that always printed the derby. */
  const swapped = C.whyLine({ ...many, ref: { name: 'Oliver', factor: 1.30 } });
  ok(/Oliver adds 30%/.test(swapped) && !/derby/.test(swapped),
    `the named multiplier does not follow the data: "${swapped}"`);
}

/* ---- 3. the comparison is against his own position --------------------- */
/* 0.19 a 90 is ordinary for a midfielder and high for a forward. One shared
   league average would tell one of the two something false, on every card. */
{
  const mid = C.whyLine({ ...BASE, y90: 0.19, posMean: 0.199, pos: 'MF' });
  const fwd = C.whyLine({ ...BASE, y90: 0.19, posMean: 0.1488, pos: 'FW' });
  ok(/in line with/.test(mid), `the positional mean does not read as ordinary: "${mid}"`);
  ok(/above/.test(fwd), `the same rate is not above a forward's mean: "${fwd}"`);
  ok(/midfielder/.test(mid) && /forward/.test(fwd),
    'the line does not name the position it is comparing against');
  ok(mid !== fwd, 'two positions with the same rate get an identical sentence');
}

/* ---- 4. a thin sample qualifies, it does not replace -------------------- */
{
  const thin = C.whyLine({ ...BASE, minutes: 210 });
  ok(/210 minutes/.test(thin) && /provisional/.test(thin),
    `a rate off 210 minutes is presented as settled: "${thin}"`);
  ok(/yellows a 90/.test(thin),
    'the caveat replaced the explanation instead of qualifying it');
  ok(!/provisional/.test(C.whyLine(BASE)), 'a full season is called provisional');
}

/* ---- 5. nothing is invented -------------------------------------------- */
ok(C.whyLine({ ...BASE, y90: null }) === null, 'a player with no card rate got a sentence');
ok(C.whyLine({ ...BASE, y90: 0 }) === null, 'a zero rate got a sentence');
ok(C.whyLine(null) === null, 'whyLine invented a sentence from nothing');
ok(strict.includes('0.31') && strict.includes('0.20'),
  `the line quotes figures the caller did not supply: "${strict}"`);

/* ---- 6. every desk renders one ----------------------------------------- */
for (const f of DESKS) {
  const page = read(f);
  ok(/\.whyLine\(/.test(page), `${f} never calls PLDCore.whyLine`);
  ok(/function whyFacts\s*\(/.test(page), `${f} has no whyFacts()`);
  ok(/cand-why/.test(page), `${f} never renders the Why line`);
}
ok(read('assets/tw.css').includes('.cand-why'),
  'assets/tw.css no longer styles .cand-why, so the sentence renders as body text');

/* ---- 7. THE ONE THAT MATTERS: it explains the price beside it ----------
 *
 * A Why line quoting a factor the model did not apply is worse than none. So
 * each desk's whyFacts() is required to read the same factor SOURCES its own
 * pricing function reads — not similar names, the same calls.
 */
{
  const body = (src, name) => {
    const at = src.indexOf('function ' + name + '(');
    assert.notStrictEqual(at, -1, `${name}() not found`);
    let i = src.indexOf('{', at), depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    return src.slice(i, j + 1);
  };

  /* index.html — the price is fixtureProb(); the factors are refFactor,
     PLDCore.venueFactor and chaseFor. All three must appear in whyFacts. */
  const idx = read('index.html');
  const price = body(idx, 'fixtureProb'), facts = body(idx, 'whyFacts');
  for (const call of ['refFactor(', 'venueFactor(', 'chaseFor(']) {
    ok(price.includes(call),
      `index.html's fixtureProb no longer calls ${call} — this guard has lost track ` +
      'of how the price is built');
    ok(facts.includes(call),
      `index.html's whyFacts does not call ${call}, so the Why line explains the price ` +
      'with a factor the price did not use');
  }
  /* THE DERBY FIGURE IS THE PLAYER ONE, NOT THE TEAM ONE. This desk has two:
     DERBY_BOOST (1.15) scales a fixture's expected card TOTAL, and the
     per-player price applies 1.08. Quoting 1.15 beside a percentage built
     from 1.08 is precisely the silent disagreement this section exists for. */
  ok(price.includes('PLAYER_DERBY_BOOST') && facts.includes('PLAYER_DERBY_BOOST'),
    "index.html's Why line and its price no longer share one derby factor — the desk " +
    'carries two (×1.15 for a match total, ×1.08 for one player) and they are not ' +
    'interchangeable');
  /* The bare name, with PLAYER_ stripped out first — otherwise the check is
     satisfied by the very token it is looking for, since PLAYER_DERBY_BOOST
     contains DERBY_BOOST. */
  ok(!/[^_]DERBY_BOOST\b/.test(facts.replace(/PLAYER_DERBY_BOOST/g, '')),
    "index.html's whyFacts quotes the team-level DERBY_BOOST (×1.15), which scales a " +
    'match total, beside a percentage the price built from the per-player ×1.08');

  /* The sibling desks price through refFactor() and their own DERBY_BOOST,
     and apply no venue or game-state factor — so their lines must not claim
     one. An absent clause is the correct output, not a gap. */
  for (const f of ['eflc.html', 'laliga.html']) {
    const fx = body(read(f), 'whyFacts');
    ok(/priorFor\(/.test(fx),
      `${f}'s whyFacts does not compare against priorFor(), which is the mean its own ` +
      'shrinkRate pulls a thin rate towards');
    ok(!/venueFactor|chaseFactor/.test(fx),
      `${f}'s whyFacts claims a venue or game-state factor this desk never applies`);
  }
  /* /today prices each league through that league's own model, so the
     positional mean has to come from the league, not a shared constant: a
     Championship midfielder and a La Liga midfielder are not measured against
     the same average, and one constant would tell one of them something
     false. This is the page where that would be least visible. */
  const tf = body(read('today.html'), 'whyFacts');
  ok(/p\.L\.prior/.test(tf),
    "today.html's whyFacts does not use the per-league positional mean, so one " +
    "division's players are compared against another's average");
}

console.log(`check-why OK: the line names only what moved the price, compares against `
  + `the position the model shrank towards, caveats a thin sample, invents nothing, `
  + `and reads the same factors the price did on all ${DESKS.length} desks (${checks} checks)`);

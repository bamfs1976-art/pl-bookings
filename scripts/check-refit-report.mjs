#!/usr/bin/env node
/* The refit report refuses to conclude anything on too little data.
 *
 * WHY A BEHAVIOURAL CHECK. Grepping refit-report.mjs for "200" would prove a
 * number is in the file, not that the script stops. The floor is the whole
 * safeguard — a calibration report on forty rows is a plot of noise that looks
 * exactly like a finding, and the pull to read one early is strongest when
 * there is least to read — so it is exercised by RUNNING the script against a
 * stub PostgREST that serves a chosen number of rows, and checking the exit
 * code and what it printed.
 *
 * The stub also lets the scoring be checked on data whose answer is known,
 * which is otherwise impossible without the real database and a service-role
 * key that must never be in CI for a read-only test.
 *
 *     node scripts/check-refit-report.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* A deterministic set of rows: `carded` is decided by a fixed rule rather than
   at random, so the observed rate and every bin are reproducible and a change
   in the scoring shows up as a failure rather than as noise. */
function rows(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const pcard = 0.05 + (i % 40) * 0.02;        // 0.05 .. 0.83
    out.push({
      season: '2026-27', gw: 1 + (i % 5), element: 1000 + i,
      name: `Player ${i}`, club: 'ARS',
      pcard: Number(pcard.toFixed(4)),
      carded: i % 3 === 0 ? 1 : 0,               // 1 in 3 booked
    });
  }
  return out;
}

function serve(data) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      /* Honour the Range header the script pages with, so the paging path is
         exercised rather than bypassed by a single fat response. */
      const m = /(\d+)-(\d+)/.exec(req.headers.range || '');
      const from = m ? Number(m[1]) : 0;
      const to = m ? Number(m[2]) : data.length - 1;
      const slice = data.slice(from, to + 1);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(slice));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function run(url, extraArgs = []) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath,
      [join(root, 'scripts', 'refit-report.mjs'), ...extraArgs],
      { env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'stub-key-not-real' } });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

const server = await serve(rows(120));
const { port } = server.address();
const url = `http://127.0.0.1:${port}`;

/* ---- 1. below the floor: refuses, and says the figures are not a verdict -- */
{
  const r = await run(url);
  ok(r.code !== 0, 'the report exited 0 on 120 rows against a 200-row floor');
  ok(/NOT ENOUGH TO CONCLUDE/.test(r.err),
    'it did not say why it stopped; a silent non-zero exit is a broken script, ' +
    'not a refusal');
  ok(/120 scored row/.test(r.err), 'it did not report the sample it actually had');
  /* It must still PRINT the figures — the point is to watch collection without
     drawing a conclusion, not to hide the data until a date passes. */
  ok(/By gameweek/.test(r.out) && /Reliability/.test(r.out),
    'it withheld the figures entirely; below the floor they are still printed, ' +
    'just not concluded from');
  ok(!/verdict\s+the model is better/.test(r.out) || /NOT ENOUGH/.test(r.err),
    'a verdict was allowed to stand below the floor');
}

/* ---- 2. an explicit smaller floor is honoured ---------------------------- */
{
  const r = await run(url, ['--min', '50']);
  ok(r.code === 0, `--min 50 on 120 rows should pass, exited ${r.code}: ${r.err.slice(0, 200)}`);
  ok(/at or above the 50-row floor/.test(r.out), 'the chosen floor is not reported back');
}

/* ---- 3. the scoring is right on data whose answer is known --------------- */
{
  const r = await run(url, ['--min', '1']);
  ok(r.code === 0, 'a floor of 1 should pass');
  /* Every third row carded, so exactly 40 of 120. */
  ok(/observed booking rate\s+33\.3%/.test(r.out),
    `observed rate wrong; got:\n${r.out.split('\n').filter((l) => /observed booking/.test(l)).join('\n')}`);
  ok(/base-rate Brier\s+0\.2222/.test(r.out),
    'the base-rate Brier is not p(1-p) on the observed rate, which is what it must be');
  /* The interval must be reported and the verdict must follow it, not the
     point estimate — the rule the whole project runs on. */
  ok(/95% .* to /.test(r.out), 'no interval on the paired difference');
  ok(/verdict\s+(no difference|the model is better|the base rate is better)/.test(r.out),
    'no verdict line');
  ok(/Reliability, ten equal-count bins/.test(r.out), 'no reliability table');
  ok((r.out.match(/^\s+\d+\s+\d+\s+/gm) || []).length >= 10, 'fewer than ten bins');
}

/* ---- 4. an unsettled row is never counted as "not booked" ---------------- */
{
  const mixed = rows(60).concat(rows(60).map((r) => ({ ...r, carded: null })));
  const s2 = await serve(mixed);
  const u2 = `http://127.0.0.1:${s2.address().port}`;
  const r = await run(u2, ['--min', '1']);
  s2.close();
  ok(/scored\s+60 row\(s\)/.test(r.out),
    'rows with carded = null were scored. A gameweek nobody has settled is not ' +
    'a player who avoided a booking, and counting it as nought drags every ' +
    'observed rate toward zero and makes the model look over-confident.');
}

/* ---- 5. it never prints the key ------------------------------------------ */
{
  const r = await run(url, ['--min', '1']);
  ok(!/stub-key-not-real/.test(r.out + r.err),
    'the service-role key appeared in the output. It bypasses row-level ' +
    'security; it must never reach a log.');
}

server.close();
console.log(`check-refit-report OK: refuses below the floor while still printing ` +
  `the figures, honours an explicit floor, scores a known set correctly, never ` +
  `counts an unsettled row as a non-booking, and never logs the key ` +
  `(${checks} checks)`);

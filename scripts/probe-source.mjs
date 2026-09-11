#!/usr/bin/env node
// What is actually AT a URL? A read-only look, run from CI.
//
//   node scripts/probe-source.mjs <url> [<url> ...]
//
// WHY THIS EXISTS. The agent proxy this repository is worked through denies
// almost every external host — rfef.es, efl.com, api.football-data.org and
// myfootballfacts.com among them — so a source can only be judged from its
// documentation, or from a guess about its markup. Both have now cost real
// work: the EFL scraper was written against a news index that turns out to be
// assembled in the browser, and found nothing twice before the byte counts
// said why. CI is not restricted. So this is the same move
// scripts/probe-football-data.mjs makes for one API, generalised: go and look,
// print what is there, then decide what to build.
//
// IT WRITES NOTHING AND COMMITS NOTHING. Every request is a GET and the only
// output is the log.
//
// WHAT IT REPORTS, and why each one earns its place:
//
//   THE TEXT YIELD — bytes in, characters of prose out. This is the number
//   that diagnosed the EFL: 138,745 bytes yielding 582 characters is not a
//   thin article, it is an empty shell whose content arrives by JavaScript.
//   Anything under a few per cent means the HTML is not where the data is.
//
//   THE JSON ISLANDS. When a page IS rendered in the browser, its content is
//   usually still in the response — sitting in a <script> tag as JSON, which
//   the text yield above deliberately strips. Naming those scripts and their
//   sizes is what turns "we cannot scrape this" into "parse this object".
//
//   THE TABLES. For a statistics page the question is simply whether the
//   numbers are in plain <table> markup, and if so under what headings. A
//   dozen tables of real rows is a source that can be read with no library at
//   all; zero tables and a large JSON island is a different job.
//
// Nothing here is specific to one site, and nothing here parses for keeps.
// This tells you which of the two jobs you have.

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('usage: node scripts/probe-source.mjs <url> [<url> ...]');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (compatible; BookingsDesk/1.0; '
  + '+https://bookingsdesk.netlify.app) source-probe';

/* The same stripper assets/../data/fetch_appointments.py uses, so the yield
   reported here is the yield that script would actually get. */
function toText(html) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|br)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean).join('\n');
}

function scripts(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '', body = m[2] || '';
    if (/\bsrc=/i.test(attrs)) continue;          // external file, not a payload
    if (body.trim().length < 200) continue;       // a tag manager snippet
    const id = (/\bid="([^"]+)"/i.exec(attrs) || [])[1] || '';
    const type = (/\btype="([^"]+)"/i.exec(attrs) || [])[1] || '';
    /* Does it LOOK like data? A payload starts as an object or an array, or is
       assigned to one of the handful of globals frameworks use. */
    const t = body.trim();
    const json = t.startsWith('{') || t.startsWith('[')
      || /window\.__(INITIAL_STATE|NUXT|APOLLO_STATE|DATA)__|__NEXT_DATA__|self\.__next_f/.test(t);
    out.push({ id, type, bytes: body.length, json });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

function tables(html) {
  const out = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[0];
    const heads = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
      .map((h) => toText(h[1]).replace(/\n/g, ' ').trim()).filter(Boolean);
    const rows = (t.match(/<tr[\s>]/gi) || []).length;
    /* The first body row, as a reader would see it: what the columns actually
       contain matters more than what they are called. */
    const firstBody = /<tbody[^>]*>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(t)
      || /<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<tr/i.exec(t);
    const cells = firstBody
      ? [...firstBody[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((c) => toText(c[1]).replace(/\n/g, ' ').trim())
      : [];
    out.push({ rows, heads, cells });
  }
  return out;
}

function links(html, base) {
  const seen = new Set();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    try { seen.add(new URL(m[1], base).href); } catch { /* not a URL */ }
  }
  return [...seen];
}

/* THE HEADERS AN ORDINARY BROWSER SENDS. A bare User-Agent is a common
   crude filter, and a refusal aimed at it is not an access control — there is
   no login, no paywall and no rate limit involved. Sent only as the SECOND
   attempt and always reported as such, so a page that needs it is recorded as
   a page that needs it rather than quietly worked around. */
const BROWSER = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
};

/* WHAT THE SITE ITSELF SAYS. Asked before any retry: a refusal that robots.txt
   also states is a policy, not a filter, and the answer there is to stop
   rather than to send different headers. */
async function robots(base) {
  try {
    const u = new URL('/robots.txt', base).href;
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) return `  robots.txt -> HTTP ${r.status} (none published)`;
    const body = (await r.text()).slice(0, 4000);
    const path = new URL(base).pathname;
    const rules = body.split(/\r?\n/)
      .filter((l) => /^\s*(user-agent|disallow|allow|crawl-delay)/i.test(l));
    const dis = rules.filter((l) => /^\s*disallow:\s*\S/i.test(l))
      .map((l) => l.split(':').slice(1).join(':').trim());
    const hits = dis.filter((d) => d !== '/' ? path.startsWith(d) : true);
    return `  robots.txt -> ${rules.length} rule line(s); `
      + (hits.length
        ? `THIS PATH IS DISALLOWED by ${JSON.stringify(hits.slice(0, 3))} — stop here`
        : 'this path is not disallowed');
  } catch (e) {
    return `  robots.txt -> ${e.name}: ${e.message}`;
  }
}

/* A refusal usually says who refused. Server, the Cloudflare markers, and the
   first line of the body name the mechanism — which is the difference between
   a filter worth a second attempt and a challenge that is not. */
function whoRefused(res, body) {
  const bits = [];
  for (const h of ['server', 'cf-ray', 'cf-mitigated', 'x-served-by', 'retry-after']) {
    const v = res.headers.get(h);
    if (v) bits.push(`${h}: ${v}`);
  }
  const snippet = toText(body || '').split('\n').slice(0, 3).join(' / ').slice(0, 240);
  if (snippet) bits.push(`body: ${snippet}`);
  return bits;
}

let failed = 0;
for (const url of urls) {
  console.log('\n' + '='.repeat(72));
  console.log(url);
  console.log('='.repeat(72));
  let res, html;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    html = await res.text();
  } catch (e) {
    console.log(`  FETCH FAILED: ${e.name}: ${e.message}`);
    failed++;
    continue;
  }
  console.log(`  HTTP ${res.status}  ${res.headers.get('content-type') || '?'}`);
  if (res.url !== url) console.log(`  redirected to ${res.url}`);

  if (!res.ok) {
    for (const b of whoRefused(res, html)) console.log(`    ${b}`);
    console.log(await robots(url));
    /* THE SECOND ATTEMPT, reported as one. If ordinary browser headers are
       enough then the block was a user-agent filter and the page is readable;
       if it refuses these too, it is a real challenge and a fetch will not
       get past it whatever headers it sends. */
    try {
      const r2 = await fetch(url, { headers: BROWSER, redirect: 'follow' });
      const b2 = await r2.text();
      console.log(`  retry with ordinary browser headers -> HTTP ${r2.status} `
        + `(${b2.length} bytes)`);
      if (r2.ok) {
        console.log('  READABLE with browser headers: the refusal was a '
          + 'user-agent filter, not a challenge.');
        res = r2; html = b2;
      } else {
        for (const b of whoRefused(r2, b2)) console.log(`    ${b}`);
        console.log('  STILL REFUSED: this is a challenge or an IP-based '
          + 'block, and no set of headers will get a plain fetch past it. A '
          + 'real browser, or another source, or a paste.');
        failed++;
        continue;
      }
    } catch (e) {
      console.log(`  retry failed: ${e.name}: ${e.message}`);
      failed++;
      continue;
    }
  }

  const text = toText(html);
  const yieldPct = html.length ? (text.length / html.length) * 100 : 0;
  console.log(`  ${html.length} bytes -> ${text.length} chars of text `
    + `(${yieldPct.toFixed(1)}% yield)`);
  if (yieldPct < 3) {
    console.log('  LOW YIELD: the content is not in the HTML. Look at the '
      + 'inline scripts below — a page rendered in the browser usually still '
      + 'ships its data as JSON in the response.');
  }

  const sc = scripts(html).slice(0, 6);
  if (sc.length) {
    console.log(`  inline script payloads (largest first):`);
    for (const s of sc) {
      console.log(`    ${String(s.bytes).padStart(8)} bytes  `
        + `${s.json ? 'JSON-ish' : 'code    '}  `
        + `${s.id ? 'id=' + s.id : ''} ${s.type ? 'type=' + s.type : ''}`.trim());
    }
  } else {
    console.log('  no inline script payloads over 200 bytes');
  }

  const tb = tables(html);
  console.log(`  ${tb.length} <table>(s)`);
  for (const t of tb.slice(0, 8)) {
    console.log(`    ${String(t.rows).padStart(5)} rows  `
      + `headings: ${t.heads.slice(0, 12).join(' | ') || '(none)'}`);
    if (t.cells.length) {
      console.log(`           first row: ${t.cells.slice(0, 12).join(' | ')}`);
    }
  }
  if (tb.length > 8) console.log(`    ... and ${tb.length - 8} more`);

  /* Sibling pages, which is how a statistics site says what else it has. */
  const all = links(html, res.url);
  const same = all.filter((h) => { try { return new URL(h).host === new URL(res.url).host; } catch { return false; } });
  console.log(`  ${all.length} link(s), ${same.length} on the same host`);
  /* IN THE SITE'S OWN LANGUAGE, not only in English. This filter was written
     against English statistics sites and then pointed at rfef.es, where every
     word it looks for is spelled differently: the Spanish federation calls an
     appointment a DESIGNACION and a referee an ARBITRO. It reported "208
     link(s), 164 on the same host" and printed exactly one of them — an
     English-titled inclusion campaign — so the designations section could have
     been three links away and the probe would have said nothing about it.
     A diagnostic that is blind in the language of the source it was aimed at
     is worse than no diagnostic: it answers confidently and wrongly. */
  const interesting = same.filter((h) => new RegExp(
    'referee|discipline|card|foul|booking'              // English
    + '|arbitr|designacion|designaciones|jornada|sancion'  // Spanish (RFEF)
    + '|designazion|arbitri|giornata',                     // Italian (AIA)
    'i').test(h));
  for (const h of interesting.slice(0, 20)) console.log(`    ${h}`);
  if (interesting.length > 20) console.log(`    ... and ${interesting.length - 20} more`);
}

/* ALWAYS ZERO, and that is not the same rule the appointment fetcher follows.
   There, an empty result must fail loudly: nobody is watching, and a week with
   no appointments has to be distinguishable from a week nobody ingested.
   Here a person asked a question and is reading the answer, and the answer
   "that host refuses us" is a SUCCESSFUL probe — the tool did exactly its job.
   Exiting non-zero for it marked the run red and sent the repository owner a
   "Run failed: Probe a source / All jobs have failed" email about a diagnostic
   that had worked perfectly, which is how a useful alert becomes noise people
   learn to ignore. The finding is in the log, where it was asked for. */
console.log(`\nprobe complete — ${urls.length - failed} of ${urls.length} `
  + `readable, nothing was written or committed.`);

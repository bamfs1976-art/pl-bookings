#!/usr/bin/env node
/* Guard the appointment FETCHER: the part that finds a published sheet.
 *
 * data/ingest_appointments.py has always been fed by hand, and its docstring
 * says why it does not fetch — "a scraper for one publisher's prose that
 * silently returns nothing when the markup moves is worse than a paste: a week
 * with no appointments looks identical to a week that was not ingested."
 *
 * data/fetch_appointments.py automates the finding without giving that up, and
 * the properties that make it safe are the ones asserted here. None of them
 * needs the network, which is the point: the fetch itself can only be proved
 * on a runner, so everything AROUND it is proved before it gets there.
 *
 *   1. IT ASKS FOR WHAT IS MISSING. Both leagues' pending rounds come out of
 *      the committed fixture file, so a covered week fetches nothing and a
 *      covered week is not an error.
 *
 *   2. THE SPANISH URL PATTERN IS THE ONE THE RFEF ACTUALLY USES. Three real
 *      sheet URLs are recorded in data/appointments.json from earlier manual
 *      ingests. The prober must generate each of them for its own jornada and
 *      date — this is the assertion that would have caught the pattern being
 *      edited on a hunch.
 *
 *   3. THE ENGLISH ARTICLE SURVIVES BEING MARKUP. The EFL publishes its
 *      appointments in three layouts and the parser handles all three, but
 *      only once the tags are off and the line breaks are still there: collapse
 *      an article to one line and a full round reads as nothing at all.
 *
 *   4. THE WORKFLOW RUNS IT FOR BOTH LEAGUES, with the PDF tool installed and
 *      the failure absorbed — a publisher having a bad day must not take the
 *      fixture harvest down with it.
 *
 *     node scripts/check-fetch-appointments.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const py = (code) =>
  execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8' });

/* ---- 1. it asks for exactly what is missing ----------------------------- */
for (const league of ['LL', 'EFLC']) {
  const out = execFileSync('python3',
    ['data/fetch_appointments.py', '--league', league, '--list', '--days', '8'],
    { cwd: root, encoding: 'utf8' });
  assert.ok(/fixture\(s\) without a referee/.test(out),
    `--list for ${league} did not report what is uncovered:\n${out}`);
  /* Either it names what it would fetch, or it says the week is covered.
     A third outcome — silence — is the failure this whole script is about. */
  assert.ok(/would probe|would search|nothing to fetch/.test(out),
    `--list for ${league} neither named a source nor said the week is ` +
    `covered:\n${out}`);
}

/* ---- 2. the Spanish filename pattern, against real observed URLs --------- */
{
  const overlay = JSON.parse(
    readFileSync(join(root, 'data', 'appointments.json'), 'utf8'));
  const real = (overlay.sources || []).filter(
    (s) => typeof s === 'string' && /rfef\.es\/.*designaciones.*\.pdf$/.test(s));
  assert.ok(real.length >= 3,
    'data/appointments.json no longer records any real RFEF sheet URL, so the ' +
    'prober has nothing to be checked against — keep the URLs of sheets that ' +
    'are ingested by hand');

  /* Regenerate each real URL from the three facts the fetcher works off: the
     season, the jornada and the date. Parsed back OUT of the URL so this
     stays true when the season rolls over. */
  for (const url of real) {
    const m = /temp_(\d{4}-\d{2})_-_jornada_(\d+)_([a-z]+)_?(\d{1,2})?\.pdf$/.exec(url);
    assert.ok(m, `RFEF URL no longer matches the shape the prober builds: ${url}`);
    const [, season, round, weekday, dom] = m;
    const built = py(
      'import sys; sys.path.insert(0,"data")\n' +
      'import datetime as dt, fetch_appointments as F\n' +
      `wd = F.ES_WEEKDAYS.index(${JSON.stringify(weekday)})\n` +
      /* Any date with that weekday and day-of-month will do — the prober only
         reads those two off it. */
      `dom = ${dom ? Number(dom) : 'None'}\n` +
      'cands = []\n' +
      'for off in range(0, 400):\n' +
      '    d = dt.date(2026, 8, 1) + dt.timedelta(days=off)\n' +
      '    if d.weekday() == wd and (dom is None or d.day == dom):\n' +
      `        cands = F.rfef_candidates([((d, ${Number(round)}), 1)], ${JSON.stringify(season)})\n` +
      '        break\n' +
      'print("\\n".join(cands))\n').trim().split('\n');
    assert.ok(built.includes(url),
      `the prober would never ask for a sheet the RFEF actually published:\n` +
      `  wanted ${url}\n  builds ${built.join('\n         ')}`);
  }
}

/* ---- 3. an article survives being markup -------------------------------- */
{
  /* All three layouts the EFL has published in, in one document, wrapped in
     the kind of markup a news page carries. What must come out is three
     appointments — not two, and not a single unparseable line. */
  const article = [
    '<html><head><style>.x{a:b}</style><script>var t=1</script></head><body>',
    '<div><h1>Referee appointments: 11-13 September</h1>',
    '<p>Saturday, 12th September 2026</p><p><strong>Sky Bet Championship</strong></p>',
    '<p>Norwich City v West Bromwich Albion (15:00)<br>Referee: Tim Robinson<br>',
    'Assistants: Hugh Gilroy and Ian Cooper</p>',
    '<ul><li>Swansea City v Watford (12:30)</li><li>Referee: Andrew Kitchen</li></ul>',
    '<p>Sunday 13 September</p><p>Sky Bet Championship</p>',
    '<p>Cardiff City v Millwall</p><p>16:30</p><p>Referee: Farai Hallam</p>',
    '</div></body></html>'
  ].join('\n');
  const got = JSON.parse(py(
    'import sys, json; sys.path.insert(0,"data")\n' +
    'import fetch_appointments as F, ingest_appointments as I\n' +
    `t = F.to_text(${JSON.stringify(article)})\n` +
    'rows, unknown, undated = I.parse(t, default_year=2026)\n' +
    'print(json.dumps({"rows": rows, "unknown": unknown, "undated": undated, '
    + '"script": ("var t=1" in t), "style": (".x{a:b}" in t)}))\n'));
  assert.equal(got.rows.length, 3,
    `the EFL article reduced to ${got.rows.length} appointments, not 3 — the ` +
    'tag stripper has lost the line breaks the parser reads fixtures on');
  assert.deepEqual(got.rows.map((r) => r.ref),
    ['Tim Robinson', 'Andrew Kitchen', 'Farai Hallam'],
    'the referees came out of the article wrong');
  assert.deepEqual(got.undated, [],
    'a date heading was not recognised once it had been through the markup');
  /* Script and style bodies are not prose. Left in, they put "var t=1" where a
     fixture line should be, and BARE_FIXTURE_RE matches almost anything. */
  assert.ok(!got.script && !got.style,
    'script or style content survived into the article text');
}

/* ---- 3b. the article URL is found however the page names it ------------- */
{
  /* The first live run found no article at all: the news index returned bytes
     and not one matching link, which is what a listing rendered in the browser
     looks like to a fetch. So the sitemap went into the candidates and the
     matcher stopped being about href. It has to find the same URL in all three
     places a site can put one — an anchor, a sitemap <loc>, and a quoted
     string in a JSON island — because which of the three it will be is not
     something this repository gets to decide. */
  const url = '/news/2026/september/08/referee-appointments--11-13-september/';
  const abs = 'https://www.efl.com' + url;
  const got = JSON.parse(py(
    'import sys, json; sys.path.insert(0,"data")\n' +
    'import fetch_appointments as F\n' +
    'docs = {\n'
    + `  "href": ${JSON.stringify(`<a href="${url}">x</a>`)},\n`
    + `  "sitemap": ${JSON.stringify(`<url><loc>${abs}</loc></url>`)},\n`
    + `  "json": ${JSON.stringify(`{"url":"${abs}"}`)},\n`
    + '}\n'
    + 'print(json.dumps({k: F.EFL_SLUG.findall(v) for k, v in docs.items()}))\n'));
  for (const [shape, expect] of [['href', url], ['sitemap', abs], ['json', abs]]) {
    assert.deepEqual(got[shape], [expect],
      `the article matcher misses a URL published as ${shape} — it found ` +
      `${JSON.stringify(got[shape])}`);
  }
  const wf = readFileSync(join(root, 'data', 'fetch_appointments.py'), 'utf8');
  assert.ok(/sitemap\.xml/.test(wf),
    'the EFL sitemap is no longer among the candidates — it is the one source ' +
    'that cannot be a page rendered in the browser, which is what the first ' +
    'live run appears to have hit');

  /* AND THE NEWEST ARTICLE IS READ FIRST. A news index is in order and a
     SITEMAP IS NOT: the first run off the sitemap found 172 articles and read
     the three at the top of the file, which were from the previous January.
     The slug carries the publication date, so the ordering is in the URL. The
     cup rounds sort behind the league article for the same reason — the EFL
     publishes Carabao and Vertu sheets under the same stem and the ingester
     skips them by competition, but only after they have used up a slot. */
  const order = JSON.parse(py(
    'import sys, json, datetime as dt; sys.path.insert(0,"data")\n' +
    'import fetch_appointments as F\n' +
    'urls = [\n'
    + '  "https://efl.com/news/2026/january/05/vertu-trophy-referee-appointments--2-september/",\n'
    + '  "https://efl.com/news/2026/january/05/carabao-cup-quarter-final-referee-appointments/",\n'
    + '  "https://efl.com/news/2026/january/05/referee-appointments--4---5-january/",\n'
    + '  "https://efl.com/news/2026/september/08/referee-appointments--11-13-september/",\n'
    + '  "https://efl.com/news/2026/september/01/referee-appointments--5-9-september/",\n'
    + ']\n'
    + 'out = []\n'
    + 'for u in urls:\n'
    + '    m = F.URL_DATE.search(u)\n'
    + '    d = dt.date(int(m.group(1)), F.MONTHS[m.group(2).lower()], int(m.group(3)))\n'
    + '    out.append((bool(F.CUP_SLUG.search(u)), -d.toordinal(), u))\n'
    + 'out.sort()\n'
    + 'print(json.dumps([u for _, _, u in out]))\n'));
  assert.match(order[0], /september\/08/,
    `the newest league article is not read first — got ${order[0]}`);
  assert.match(order[1], /september\/01/,
    `the second article read is not the next newest — got ${order[1]}`);
  assert.ok(/carabao|vertu/.test(order[3]) && /carabao|vertu/.test(order[4]),
    'a cup round is being read before a league article, and the ingester ' +
    'skips cup competitions — the slot is spent for nothing');
}

/* ---- 4. and the workflow actually runs it ------------------------------- */
{
  const wf = readFileSync(join(root, '.github', 'workflows', 'fixtures.yml'), 'utf8');
  assert.ok(/fetch_appointments\.py/.test(wf),
    '.github/workflows/fixtures.yml never runs data/fetch_appointments.py — ' +
    'the appointments are automated in the repository and not in CI');
  for (const league of ['LL', 'EFLC']) {
    assert.ok(new RegExp(`for L in [^\\n]*\\b${league}\\b`).test(wf),
      `fixtures.yml does not fetch appointments for ${league}`);
  }
  assert.ok(/poppler-utils/.test(wf),
    'fixtures.yml does not install poppler-utils — parse_rfef splits the two ' +
    'clubs on a run of spaces, so the Spanish sheet needs layout-preserving ' +
    'extraction and pdftotext is what provides it');
  /* The leg must absorb its own failure. The fetcher exits non-zero when it
     finds nothing — that is what makes a silent failure impossible — and
     without continue-on-error every quiet week would take the fixture harvest
     down with it. */
  const leg = /- name: Published referee appointments\n([\s\S]*?)\n      - name:/.exec(wf);
  assert.ok(leg, 'fixtures.yml has no "Published referee appointments" step');
  assert.ok(/continue-on-error:\s*true/.test(leg[1]),
    'the appointments fetch is not continue-on-error — a publisher having a ' +
    'bad day would fail the whole fixture harvest, which erases nothing but ' +
    'reports every run as broken');
  /* And it must run BEFORE the guards and the commit, or a fetched appointment
     waits eight hours for the next run to be checked and committed. */
  assert.ok(wf.indexOf('fetch_appointments.py') < wf.indexOf('check-all.mjs'),
    'the appointments are fetched after the guards run — they would not be ' +
    'checked, and the commit step would push them unverified');
}

console.log('check-fetch-appointments OK: both leagues ask only for the rounds '
  + 'they are missing, the Spanish prober rebuilds every sheet URL the RFEF has '
  + 'actually published, an EFL article survives its own markup in all three '
  + 'layouts, and the fixture workflow runs the fetch before it guards and '
  + 'commits — absorbing a failed fetch rather than erasing an overlay.');

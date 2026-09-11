/* Render one page in a real browser and print its visible text.
 *
 * WHY THIS EXISTS. data/fetch_appointments.py reads the EFL's weekly referee
 * article with a plain GET, and on 7 September that started returning a page
 * of chrome and nothing else: 144,243 bytes of HTML yielding 556 characters of
 * text. The byte count is the tell — the markup arrives, the article body does
 * not, because efl.com assembles it in the browser from a separate request.
 * No set of headers fixes that. The page has to be executed, not fetched.
 *
 * So this is deliberately the narrowest thing that can work: one URL in, the
 * rendered text out, nothing written and nothing committed. It has no idea
 * what an appointment is — the parsing, the club resolution and the refusal to
 * guess all stay in ingest_appointments.py, which already handled this text
 * correctly the moment it was given it by hand.
 *
 * NO BROWSER DOWNLOAD. `playwright install chromium` fetches about 170MB, and
 * the fixtures workflow runs seven times a day. This uses playwright-core
 * against a Chromium that is already on the machine — the runner's own Chrome,
 * or a Playwright bundle if one happens to be installed — and says so plainly
 * when it cannot find one, rather than silently producing nothing.
 *
 * Usage: node scripts/render-page.mjs <url> [--timeout ms] [--settle ms]
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
function opt(name, dflt) {
  const i = args.indexOf('--' + name);
  const v = i > -1 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
}
const TIMEOUT = opt('timeout', 45000);
/* After the network goes quiet, a beat for the framework to paint. Without it
   a client-rendered article can be "loaded" and still be an empty <main>. */
const SETTLE = opt('settle', 1500);

if (!url || !/^https?:\/\//i.test(url)) {
  console.error('usage: node scripts/render-page.mjs <http(s) url> [--timeout ms] [--settle ms]');
  process.exit(2);
}

/* The browser, wherever this machine keeps one. PW_CHROMIUM wins so a caller
   can be explicit; after that the Playwright bundle this image ships, then the
   usual system installs. `which` is last because it is the only one that
   costs a process. */
function findBrowser() {
  if (process.env.PW_CHROMIUM && existsSync(process.env.PW_CHROMIUM)) {
    return process.env.PW_CHROMIUM;
  }
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH
      ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`
      : null,
    '/opt/pw-browsers/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const p = execFileSync('which', [name], { encoding: 'utf8' }).trim();
      if (p && existsSync(p)) return p;
    } catch { /* not installed; try the next */ }
  }
  return null;
}

/* playwright or playwright-core, whichever the machine has. They expose the
   same chromium.launch, and the difference is only whether browsers were
   bundled — which does not matter here because the executable is supplied.
 *
 * BY PATH AS WELL AS BY NAME. A GLOBALLY installed module is not resolvable by
 * bare specifier from a script outside its tree — `import('playwright')` threw
 * MODULE_NOT_FOUND on a machine with playwright sitting in
 * /opt/node22/lib/node_modules. Node is behaving correctly; the fix is to say
 * where it is rather than to install a second copy. PW_MODULE overrides. */
async function loadChromium() {
  const globals = [
    '/opt/node22/lib/node_modules',
    '/usr/lib/node_modules',
    '/usr/local/lib/node_modules',
  ];
  const specs = [process.env.PW_MODULE, 'playwright', 'playwright-core'];
  for (const g of globals) {
    for (const n of ['playwright', 'playwright-core']) {
      specs.push(`${g}/${n}/index.js`);
    }
  }
  for (const spec of specs.filter(Boolean)) {
    try {
      const pw = await import(spec);
      const chromium = (pw.default || pw).chromium;
      if (chromium) return chromium;
    } catch { /* try the next */ }
  }
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.error('RENDERER UNAVAILABLE: neither playwright nor playwright-core '
    + 'is installed. Install one (npm i -g playwright-core) — no browser '
    + 'download is needed, this script points at a Chromium already present.');
  process.exit(3);
}
const executablePath = findBrowser();
if (!executablePath) {
  console.error('RENDERER UNAVAILABLE: no Chromium or Chrome found. Set '
    + 'PW_CHROMIUM to one, or install a system browser.');
  process.exit(3);
}

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const ctx = await browser.newContext({
    /* An ordinary desktop browser, because that is what this is. The point is
       to execute the page the way a reader would, not to disguise anything:
       the article is public and linked from the EFL's own sitemap. */
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await ctx.newPage();
  let res;
  try {
    res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  } catch (e) {
    /* A READABLE LINE, NOT A STACK. This is called from
       fetch_appointments.py and its output is read by a person looking at a
       workflow log; an uncaught Playwright error buries the one fact that
       matters — that the page was never reached — under fifteen lines of
       call log. ERR_TUNNEL_CONNECTION_FAILED in particular is what an egress
       proxy looks like, and is worth naming because it is not the site's
       fault and no retry will fix it. */
    console.error(`  could not reach ${url}: ${String(e.message).split('\n')[0]}`);
    process.exitCode = 5;
    process.exit(5);
  }
  if (res && !res.ok()) console.error(`  HTTP ${res.status()} from ${url}`);
  try {
    await page.waitForLoadState('networkidle', { timeout: TIMEOUT });
  } catch {
    /* Some pages keep a socket open for ever (analytics, chat widgets). The
       body is usually long since painted, so a timeout here is not a failure
       — take what has rendered rather than throwing the page away. */
    console.error('  networkidle timed out; reading what has rendered');
  }
  await page.waitForTimeout(SETTLE);
  const text = await page.evaluate(() => {
    /* innerText, not textContent: it respects layout, so block elements come
       back on separate lines. The EFL parser reads line by line — "Referee:
       Sam Barrott" has to be its own line — and textContent would run the
       whole article into one string and parse to nothing. */
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    return main ? main.innerText : '';
  });
  process.stdout.write(text);
  /* The measurement that made the original diagnosis possible, kept on stderr
     so it never contaminates the text on stdout. */
  console.error(`  rendered ${url} -> ${text.length} chars`);
  process.exitCode = text.trim() ? 0 : 4;
} finally {
  await browser.close();
}

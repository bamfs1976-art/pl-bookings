/* Load the deployed desks and print the referee lines a visitor actually sees.
   Run by .github/workflows/live-check.yml, which has the network access this
   repo's dev containers do not. */
import { chromium } from 'playwright';

const SITE = 'https://bookingsdesk.netlify.app';
const b = await chromium.launch();
let bad = 0;

for (const [path, width] of [['/laliga', 1200], ['/laliga', 390], ['/eflc', 1200], ['/', 390]]) {
  const p = await b.newPage({ viewport: { width, height: 1200 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await p.goto(SITE + path, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => errs.push('goto: ' + e.message));
  await p.waitForTimeout(3000);

  const o = await p.evaluate(() => {
    const txt = (e) => e.textContent.replace(/\s+/g, ' ').trim();
    const refs = [...document.querySelectorAll('.fx-refline')].map(txt);
    return {
      refs,
      named: refs.filter((t) => !/^Ref\s*[—-]?$/.test(t)),
      picker: [...document.querySelectorAll('.rp-appointed, .rp-sim')].map(txt).slice(0, 5),
      strip: [...document.querySelectorAll('.chart-name')].map(txt).slice(0, 8),
      hasRefShort: typeof window.PLDCore?.refShort === 'function',
      sample: window.PLDCore?.refShort ? [
        window.PLDCore.refShort('Adrian Cordero Vega'),
        window.PLDCore.refShort('Isidro Diaz de Mera Escuderos'),
        window.PLDCore.refShort('Michael Oliver'),
      ] : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  console.log(`\n=== ${path} @${width} ===`);
  console.log(`PLDCore.refShort present: ${o.hasRefShort}`);
  if (o.sample) console.log(`shortens to: ${JSON.stringify(o.sample)}`);
  console.log(`referee lines: ${o.refs.length} (${o.named.length} with a name)`);
  for (const t of o.named) console.log('   ' + t);
  if (o.picker.length) console.log('referee control: ' + JSON.stringify(o.picker));
  if (o.strip.length) console.log('strictness strip: ' + JSON.stringify(o.strip));
  console.log(`page overflow: ${o.overflow}px`);
  if (errs.length) { console.log('PAGE ERRORS: ' + JSON.stringify(errs)); bad++; }

  /* The bug this is checking for, stated as the thing it must not be: a
     maternal surname standing alone where the paternal one belongs. */
  const MATERNAL = ['Vega', 'Escuderos', 'Bengoetxea', 'Apezteguia', 'Maeso', 'Manzano'];
  for (const t of o.named) {
    const shown = t.replace(/^Ref\s*/, '').split(/\s+·|\s+\(/)[0].trim();
    const last = shown.split(/\s+/).pop();
    if (MATERNAL.includes(shown) || (MATERNAL.includes(last) && shown.split(/\s+/).length <= 2)) {
      console.log(`   ^^ WRONG: "${shown}" is a maternal surname standing alone`);
      bad++;
    }
  }
  await p.close();
}

await b.close();
console.log(bad ? `\n${bad} problem(s) above` : '\nnothing wrong found');

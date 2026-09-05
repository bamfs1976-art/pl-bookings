#!/usr/bin/env node
/* The standing calibration caveat: one string, four desks, never on a card.
 *
 * WHY IT EXISTS AT ALL. The backtest says the model ranks well and prices low
 * — 54.8% predicted against 59.1% observed at the headline threshold, after
 * the under-dispersion fix closed about a quarter of that gap. A reader
 * looking at a percentage deserves to know which way it is wrong, so the
 * sentence sits beside the prices and not only in the Methodology view.
 *
 * WHY IT NEEDS GUARDING. It is TEMPORARY. It comes out when the mean is
 * fixed, and a sentence pasted into four single-file apps is four things to
 * forget on that day — the failure mode being a desk still apologising for a
 * bias it no longer has, which is its own kind of wrong number. So the text
 * lives in PLDCore and the pages carry an empty element for it.
 *
 * AND IT MUST NOT REACH A SHARE CARD. Cards are the thing that leaves the
 * site; they carry the 18+ line and the numbers and nothing else. A caveat
 * about a model's calibration on a shared image is clutter at best and, once
 * the caveat is stale, a claim the desk no longer stands behind, travelling
 * without a way to correct it.
 *
 *     node scripts/check-calibration-notice.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const DESKS = ['index.html', 'eflc.html', 'laliga.html', 'today.html'];
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. the text exists exactly once, in core ---------------------------- */
const core = read('assets/core.js');
const m = core.match(/var CALIBRATION_NOTICE = '([^']+)'/);
ok(m, 'assets/core.js no longer defines CALIBRATION_NOTICE');
const NOTICE = m[1];
ok(/prices low/.test(NOTICE),
  `the notice no longer says which way the model is wrong: "${NOTICE}"`);

/* ---- 2. every desk carries the element, and none carries the words ------- */
for (const f of DESKS) {
  const page = read(f);
  const els = page.match(/data-calib\b/g) || [];
  ok(els.length === 1,
    `${f} has ${els.length} [data-calib] elements; it must have exactly one`);
  /* THE ONE THAT MATTERS. A page that hard-codes the sentence looks identical
     in the browser and survives the removal of the real one. */
  ok(!page.includes(NOTICE),
    `${f} hard-codes the notice text. It must come from PLDCore.CALIBRATION_NOTICE, ` +
    'or removing the caveat will leave this copy behind.');
  /* Shipped empty: styling an empty element as a banner would leave a coloured
     bar with no text if the script failed. */
  ok(/data-calib[^>]*>\s*<\/p>/.test(page),
    `${f}'s notice element is not shipped empty`);
}

/* ---- 3. it mounts itself, and not only in one desk ----------------------- */
ok(/mountCalibrationNotice/.test(core), 'core.js exports no mount function');
ok(/DOMContentLoaded[\s\S]{0,200}mountCalibrationNotice/.test(core) ||
   /mountCalibrationNotice\(document\)/.test(core),
  'core.js never mounts the notice, so every desk would ship an empty element');
ok(/typeof document !== 'undefined'/.test(core),
  'the mount is not guarded on document — the Node test suites require() this file');

/* ---- 4. never on a share card ------------------------------------------- */
const share = read('assets/share.js');
ok(!share.includes(NOTICE) && !/CALIBRATION_NOTICE/.test(share),
  'assets/share.js carries the calibration caveat. Cards stay uncluttered, and ' +
  'a stale caveat on a shared image cannot be corrected after it leaves.');

console.log(`check-calibration-notice OK: "${NOTICE}" defined once in core, ` +
  `mounted on ${DESKS.length} desks, hard-coded on none, absent from share cards ` +
  `(${checks} checks)`);

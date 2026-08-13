// Guards data/core_insights.js — the vendored per-player fouls for THIS
// season. Runs offline against the committed file, so CI catches a bad or
// stale harvest before it is deployed rather than after somebody notices the
// numbers look odd.
//
// The failure this exists for is not a crash. It is the file being FINE and
// being about last season: `--season 2025-2026` left in a workflow, or a
// harvest that simply stopped running in July. The desk would then show
// 2025-26 fouls with a green dot next to them saying "live rate", which is
// worse than the frozen rates this whole feature replaced — those at least
// said what they were.
//
//   node scripts/check-core-insights.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'data', 'core_insights.js');

const fail = [];
const note = (m) => console.log('  ' + m);

/* Absent is a legal state — the desk runs on baked fouls without it, which is
   exactly what it did before this feature. A file that is present and wrong
   is not. */
if (!existsSync(file)) {
  console.log('data/core_insights.js absent — the desk runs on 2025-26 fouls. Not a failure.');
  process.exit(0);
}

const CI = require(file);
const core = require(join(root, 'assets', 'core.js'));

function currentSeason(now = new Date()) {
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${start + 1}`;
}

/* ---- it is about this season ---------------------------------------- */
const expected = currentSeason();
if (CI.season !== expected) {
  fail.push(
    `season is "${CI.season}" but we are in ${expected}. The desk would label ` +
    `last season's fouls as this season's live rate. Re-run ` +
    `scripts/build-core-insights.mjs without a --season override.`
  );
} else note(`season ${CI.season}`);

/* ---- the generator and the app agree what "live" means --------------- */
if (CI.minLiveMinutes !== core.MIN_LIVE_MINUTES) {
  fail.push(
    `minLiveMinutes is ${CI.minLiveMinutes} but PLDCore.MIN_LIVE_MINUTES is ` +
    `${core.MIN_LIVE_MINUTES}. The file ships players the app will ignore, or ` +
    `withholds players it would have used.`
  );
} else note(`minutes floor ${CI.minLiveMinutes}, agreeing with core.js`);

/* ---- every row is usable -------------------------------------------- */
const players = CI.players || {};
const ids = Object.keys(players);
let bad = 0, unnamed = 0, totalFouls = 0, totalMin = 0;
ids.forEach((id) => {
  const v = players[id];
  if (!Array.isArray(v) || v.length !== 3) { bad++; return; }
  const [min, fouls, name] = v;
  if (!Number.isFinite(min) || !Number.isFinite(fouls)) { bad++; return; }
  if (min < CI.minLiveMinutes) { bad++; return; }   // would never be used
  if (fouls < 0) { bad++; return; }
  if (!/^\d+$/.test(id)) { bad++; return; }         // must be an FPL element id
  if (!name) unnamed++;
  totalFouls += fouls; totalMin += min;
});
if (bad) fail.push(`${bad} of ${ids.length} player rows are unusable (shape, minutes floor or id)`);

/* The name is the ONLY guard on the id join — without it the runtime check in
   attachLive cannot tell a renumbering from a transfer. */
if (ids.length && unnamed / ids.length > 0.05) {
  fail.push(`${unnamed} of ${ids.length} rows carry no web name, so the runtime join check is blind for them`);
}

/* ---- the numbers are football ---------------------------------------- */
if (CI.matches >= 30) {
  if (!(CI.foulsPerMatch >= 12 && CI.foulsPerMatch <= 32)) {
    fail.push(`${CI.foulsPerMatch} fouls per match over ${CI.matches} matches is not a league season`);
  } else note(`${CI.foulsPerMatch} fouls per match over ${CI.matches} matches`);

  /* A per-90 rate derived from the shipped rows, independently of the
     harvest's own arithmetic. Individual Premier League players run about
     0.5-2.5 fouls per 90; a squad-wide mean far outside that means minutes and
     fouls have been paired wrongly, which the per-match figure would not
     catch because it is computed from different columns. */
  const mean90 = totalMin ? totalFouls / (totalMin / 90) : null;
  if (mean90 != null && (mean90 < 0.4 || mean90 > 3)) {
    fail.push(`shipped rows average ${mean90.toFixed(2)} fouls per 90, which is not a squad of footballers`);
  } else if (mean90 != null) note(`${mean90.toFixed(2)} fouls per 90 across ${ids.length} shipped players`);
} else {
  note(`${CI.matches} match(es) so far — too early to check the rate, correctly`);
}

if (!ids.length) note('no player is past the minutes floor yet, which is right before about GW6');

if (fail.length) {
  console.error('\ncore_insights guard FAILED:');
  fail.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('core_insights guard OK');

/* Bookings Desk — public model-calibration read (the calibration loop).
   Returns AGGREGATE accuracy of the logged forecasts vs actual bookings:
   sample size, observed booking rate, Brier score, log loss, a reliability
   curve, and the top-20-per-matchday hit rate — server-verified and shared
   across everyone rather than scored in each visitor's own storage.

   READS plb_card_predictions, which covers ALL THREE leagues. It used to read
   plb_predictions, which is keyed (season, gw, element) where `element` is an
   FPL id — a key only the Premier League has, so two thirds of the desk could
   never be graded. The writer is now scripts/accas.mjs (`predict` / `grade`),
   which has both the fixture ids and the API-Football key the other two
   divisions need, and which identifies a booked player with the SAME
   wasBooked() the acca settler uses. One forecast record, one grading path.

   No user data is exposed — these are model forecasts keyed by fixture and
   player. Read with the service-role key over PostgREST; served publicly and
   cached so the Guide can show the model graded in the open. No-ops if
   unconfigured.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');

const json = (o, maxAge) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + (maxAge || 1800) },
  body: JSON.stringify(o),
});

/* Brier, log-loss, reliability and the top-20 hit rate over one set of rows.
   Pulled out so the overall figure and each league's are computed by the same
   code — a per-league breakdown that scored differently from the total would
   be worse than no breakdown. */
function score(rows) {
  const B = 10;
  let brier = 0, logloss = 0, booked = 0;
  const mds = new Set();
  const acc = Array.from({ length: B }, () => ({ sp: 0, sy: 0, n: 0 }));
  const byMd = {};
  for (const r of rows) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, Number(r.prob) || 0));
    const y = r.carded ? 1 : 0;
    brier += (p - y) * (p - y);
    logloss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    booked += y;
    mds.add(r.md);
    const b = acc[Math.min(B - 1, Math.floor(p * B))]; b.sp += p; b.sy += y; b.n++;
    (byMd[r.md] = byMd[r.md] || []).push({ p, y });
  }
  const n = rows.length;
  if (!n) return null;

  let topHits = 0, topTot = 0;
  for (const md of Object.keys(byMd)) {
    byMd[md].sort((a, b) => b.p - a.p).slice(0, 20).forEach((r) => { topHits += r.y; topTot++; });
  }

  const obs = booked / n;
  const baseBrier = rows.reduce((s, r) => s + (obs - (r.carded ? 1 : 0)) ** 2, 0) / n;

  return {
    n,
    mds: mds.size,
    obsRate: Math.round(obs * 1000) / 1000,
    brier: Math.round((brier / n) * 10000) / 10000,
    baseBrier: Math.round(baseBrier * 10000) / 10000,
    logloss: Math.round((logloss / n) * 10000) / 10000,
    topHits, topTot,
    buckets: acc.filter((b) => b.n).map((b) => ({
      pMean: Math.round((b.sp / b.n) * 1000) / 1000,
      oFreq: Math.round((b.sy / b.n) * 1000) / 1000,
      n: b.n,
    })),
  };
}

exports.handler = async (event) => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json({ configured: false, n: 0 }, 60);

  const rest = SUPABASE_URL + '/rest/v1/plb_card_predictions';
  const H = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };

  /* ?league=PL narrows it. Validated against the known set rather than
     interpolated, so the query string cannot shape the PostgREST filter. */
  const want = ((event && event.queryStringParameters) || {}).league;
  const league = ['PL', 'EFLC', 'LL'].includes(want) ? want : null;

  let all;
  try {
    const r = await fetch(`${rest}?carded=not.is.null&select=season,league,md,prob,carded&limit=50000`,
      { headers: H });
    all = r.ok ? await r.json() : [];
  } catch (_) { return json({ n: 0 }, 300); }
  if (!all || !all.length) return json({ configured: true, n: 0 }, 300);

  /* Latest season with graded data — never mix seasons (matchday numbers
     repeat every year). */
  const season = all.reduce((m, r) => (r.season > m ? r.season : m), all[0].season || '');
  const inSeason = all.filter((r) => (r.season || '') === season);
  const data = league ? inSeason.filter((r) => r.league === league) : inSeason;
  const overall = score(data);
  if (!overall) return json({ configured: true, n: 0, season, league }, 300);

  /* Per league, always — the three divisions have different card cultures and
     an aggregate that hides a badly calibrated one is the number a reader
     would most want broken out. */
  const byLeague = {};
  for (const code of ['PL', 'EFLC', 'LL']) {
    const s = score(inSeason.filter((r) => r.league === code));
    if (s) byLeague[code] = s;
  }

  return json({
    configured: true,
    season,
    league,
    /* `gws` kept as an alias of `mds` so an older cached page does not lose
       its sentence when this deploys. */
    gws: overall.mds,
    ...overall,
    byLeague,
  }, 1800);
};

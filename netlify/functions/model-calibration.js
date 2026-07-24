/* Bookings Desk — public model-calibration read (the calibration loop).
   Returns AGGREGATE accuracy of the logged season-P(card) forecasts vs
   actual bookings: sample size, observed booking rate, Brier score, log
   loss, a reliability curve, and the top-20-per-gameweek hit rate the app
   already reports locally — now server-verified and shared across everyone.

   No user data is exposed — plb_predictions is model analytics keyed by
   gameweek and player only. Read with the service-role key over PostgREST
   (no @supabase/supabase-js dependency); served publicly and cached so the
   Guide can show the model graded in the open. No-ops if unconfigured.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');

const json = (o, maxAge) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + (maxAge || 1800) },
  body: JSON.stringify(o),
});

exports.handler = async () => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json({ configured: false, n: 0 }, 60);

  const rest = SUPABASE_URL + '/rest/v1/plb_predictions';
  const H = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  let all;
  try {
    const r = await fetch(`${rest}?carded=not.is.null&select=season,gw,pcard,carded&limit=50000`, { headers: H });
    all = r.ok ? await r.json() : [];
  } catch (_) { return json({ n: 0 }, 300); }
  if (!all || !all.length) return json({ n: 0 }, 300);

  /* Latest season with graded data — never mix seasons (gw numbers repeat). */
  const season = all.reduce((m, r) => (r.season > m ? r.season : m), all[0].season || '');
  const data = all.filter((r) => (r.season || '') === season);
  if (!data.length) return json({ n: 0, season }, 300);

  const B = 10;
  let brier = 0, logloss = 0, booked = 0;
  const gws = new Set();
  const acc = Array.from({ length: B }, () => ({ sp: 0, sy: 0, n: 0 }));
  const byGw = {};
  for (const r of data) {
    const p = Math.max(1e-6, Math.min(1 - 1e-6, r.pcard || 0)), y = r.carded ? 1 : 0;
    brier += (p - y) * (p - y);
    logloss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    booked += y;
    gws.add(r.gw);
    const b = acc[Math.min(B - 1, Math.floor(p * B))]; b.sp += p; b.sy += y; b.n++;
    (byGw[r.gw] = byGw[r.gw] || []).push({ p, y });
  }
  const n = data.length;

  /* Top-20-per-gameweek hit rate — the same headline the browser track
     record shows, aggregated server-side over every graded gameweek. */
  let topHits = 0, topTot = 0;
  for (const gw of Object.keys(byGw)) {
    const top = byGw[gw].sort((a, b) => b.p - a.p).slice(0, 20);
    top.forEach((r) => { topHits += r.y; topTot++; });
  }

  /* Base-rate baseline Brier: predict the observed booking rate for all. */
  const obs = booked / n;
  const baseBrier = data.reduce((s, r) => s + (obs - (r.carded ? 1 : 0)) ** 2, 0) / n;

  const buckets = acc.filter((b) => b.n).map((b) => ({
    pMean: Math.round((b.sp / b.n) * 1000) / 1000,
    oFreq: Math.round((b.sy / b.n) * 1000) / 1000,
    n: b.n,
  }));

  return json({
    configured: true,
    n,
    season,
    gws: gws.size,
    obsRate: Math.round(obs * 1000) / 1000,
    brier: Math.round((brier / n) * 10000) / 10000,
    baseBrier: Math.round(baseBrier * 10000) / 10000,
    logloss: Math.round((logloss / n) * 10000) / 10000,
    topHits, topTot,
    buckets,
  }, 1800);
};

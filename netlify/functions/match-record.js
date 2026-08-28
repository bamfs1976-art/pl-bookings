/* Bookings Desk — public match-record read (the MATCH-level calibration loop).
   Returns, per league and overall: how many fixtures the desk rated in each
   heat band, what those fixtures actually produced, and the fixtures
   themselves — rated against actual, named.

   READS plb_match_predictions, the row scripts/accas.mjs writes once before
   kick-off and never revises. Its sibling /api/model-calibration answers the
   PLAYER-level question ("was this man booked"); this one answers the question
   the fixture card actually poses: a match rated 4.2 — did four cards turn up.

   THE BAND CUTS ARE THE PAGES' OWN, 4.0 and 3.5, so "hot" here means what the
   chip means. A reader comparing this table to the board is comparing the same
   thing or the table is worthless.

   WHY THE REFEREE SPLIT IS REPORTED AND NOT AVERAGED AWAY. A row logged before
   the official was appointed is a forecast at refFactor = 1, and for a good
   while the logger wrote every row days early — so most of the early record
   grades a model without its largest input. Those rows are real and are kept,
   but pooling them with the rest reports a bias the model does not have. The
   split is the finding, so it is a field.

   No user data is exposed — these are model forecasts keyed by fixture. Read
   with the service-role key over PostgREST; served publicly and cached.
   No-ops if unconfigured.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');

const json = (o, maxAge) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + (maxAge || 900) },
  body: JSON.stringify(o),
});

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/* The desks' own bands. HOT and WARM are the constants index.html declares;
   duplicated here rather than imported because a Netlify function cannot read
   the page, and pinned by scripts/check-record.mjs so the two cannot drift. */
const HOT = 4.0, WARM = 3.5;
const bandOf = (v) => (v >= HOT ? 'hot' : v >= WARM ? 'warm' : 'cool');

/* One set of rows, scored. The headline is deliberately NOT a single accuracy
   number: a rating is an expectation, and "did it hit 4+" and "did it beat its
   own number" are different questions that a single percentage would blur. */
function score(rows) {
  if (!rows.length) return null;
  const n = rows.length;
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const diffs = rows.map((r) => Number(r.cards_total) - Number(r.exp_cards));
  const bias = diffs.reduce((a, b) => a + b, 0) / n;
  /* The standard error is carried because the bias is the number somebody will
     want to correct the model by, and on a sample this size it is usually
     indistinguishable from zero. Reporting the estimate without its spread
     invites exactly that mistake. */
  const sd = n > 1
    ? Math.sqrt(diffs.reduce((s, d) => s + (d - bias) ** 2, 0) / (n - 1)) : null;
  return {
    n,
    rated: r2(sum((r) => Number(r.exp_cards)) / n),
    actual: r2(sum((r) => Number(r.cards_total)) / n),
    bias: r2(bias),
    sd: sd == null ? null : r2(sd),
    se: sd == null ? null : r2(sd / Math.sqrt(n)),
    /* Forecast probability against realised frequency, on the two lines the
       card shows. This is the honest test of a rating: not whether the mean
       matched, but whether the line landed as often as it said it would. */
    fcOver35: r3(sum((r) => Number(r.p_over_3_5) || 0) / n),
    hitOver35: r3(sum((r) => (Number(r.cards_total) >= 4 ? 1 : 0)) / n),
    fcOver45: r3(sum((r) => Number(r.p_over_4_5) || 0) / n),
    hitOver45: r3(sum((r) => (Number(r.cards_total) >= 5 ? 1 : 0)) / n),
    beatRating: sum((r) => (Number(r.cards_total) > Number(r.exp_cards) ? 1 : 0)),
    ratedRef: sum((r) => (r.ref_carded ? 1 : 0)),
    points: { rated: r2(sum((r) => Number(r.exp_points) || 0) / n),
              actual: r2(sum((r) => Number(r.points_total) || 0) / n) },
  };
}

exports.handler = async (event) => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return json({ configured: false, n: 0 }, 60);

  const rest = SUPABASE_URL + '/rest/v1/plb_match_predictions';
  const H = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };

  /* Validated against the known set rather than interpolated, so the query
     string cannot shape the PostgREST filter. */
  const want = ((event && event.queryStringParameters) || {}).league;
  const league = ['PL', 'EFLC', 'LL'].includes(want) ? want : null;

  let all;
  try {
    const r = await fetch(`${rest}?settled_at=not.is.null&cards_total=not.is.null` +
      '&select=season,league,matchday,kickoff,home,away,exp_cards,p_over_3_5,p_over_4_5,' +
      'exp_points,points_total,cards_total,referee,ref_carded,ref_factor,derby,model_version' +
      '&order=kickoff.desc&limit=5000', { headers: H });
    all = r.ok ? await r.json() : [];
  } catch (_) { return json({ configured: true, n: 0 }, 300); }
  if (!all || !all.length) return json({ configured: true, n: 0 }, 300);

  /* Never mix seasons — matchday numbers repeat every year. */
  const season = all.reduce((m, r) => (r.season > m ? r.season : m), all[0].season || '');
  const inSeason = all.filter((r) => (r.season || '') === season);
  const rows = league ? inSeason.filter((r) => r.league === league) : inSeason;
  if (!rows.length) return json({ configured: true, n: 0, season }, 300);

  const bands = {};
  for (const b of ['hot', 'warm', 'cool']) {
    const s = score(rows.filter((r) => bandOf(Number(r.exp_cards)) === b));
    if (s) bands[b] = s;
  }
  const byLeague = {};
  for (const code of ['PL', 'EFLC', 'LL']) {
    const s = score(rows.filter((r) => r.league === code));
    if (s) byLeague[code] = s;
  }

  return json({
    configured: true, season, league: league || 'ALL',
    cuts: { hot: HOT, warm: WARM },
    overall: score(rows),
    /* The split that explains most of the early record. */
    withRatedRef: score(rows.filter((r) => r.ref_carded)),
    withoutRatedRef: score(rows.filter((r) => !r.ref_carded)),
    bands, byLeague,
    matches: rows.map((r) => ({
      league: r.league, md: r.matchday, kickoff: r.kickoff,
      home: r.home, away: r.away,
      rated: r2(Number(r.exp_cards)), actual: Number(r.cards_total),
      band: bandOf(Number(r.exp_cards)),
      ratedPoints: r2(Number(r.exp_points) || 0), points: Number(r.points_total),
      referee: r.referee || null, ratedRef: !!r.ref_carded, derby: !!r.derby,
    })),
  }, 900);
};

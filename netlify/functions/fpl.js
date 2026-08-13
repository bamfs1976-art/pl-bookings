/* Bookings Desk — FPL API proxy (Netlify Function)
   The official FPL API blocks direct browser calls (no CORS), so the app's
   live-data requests are routed through here. Pattern shared with the
   Gameweek Edge proxy: whitelist only the endpoints the desk needs (no open
   proxy / SSRF), add a browser-like User-Agent, return CORS headers, and
   cache slow-changing data at the edge.

   Invoked at /api/fpl/<endpoint> via the rewrite in _redirects. */

/* WHY THESE FIVE. Every entry is a feed the desk reads; nothing is here
   "in case". The last two were added for the 2026-27 season and are the
   most on-topic feeds this proxy carries, because they are the only free
   source of a card that has ALREADY HAPPENED, in the match, while it is
   being played:

     event/<gw>/live      per-element `stats.yellow_cards` / `red_cards`
                          for every player in the gameweek, updated in
                          play. The desk's whole subject is bookings and
                          until now it could only show a forecast.
     element-summary/<id> that player's per-gameweek history — the backing
                          for card form, and the only per-match card series
                          available without a vendor.

   Both are proven shapes: the sibling Gameweek Edge proxy has whitelisted
   them for two seasons. */
const ALLOW = [
  /^bootstrap-static$/,
  /^fixtures$/,
  /^event-status$/,
  /^event\/\d+\/live$/,
  /^element-summary\/\d+$/
];

/* Cacheability is a property of the ENDPOINT, not of the moment. A live
   gameweek feed cached for five minutes is a live feed that is wrong for
   five minutes — and on this desk "wrong" means a player is shown as
   uncarded after he has been booked, which is the single worst thing the
   page can say. event-status flips on matchdays for the same reason.

   Deliberately NOT time-of-day aware: an edge cache keyed on "is a match
   on right now" is a cache that serves the stale answer at exactly the
   moment someone looks. */
const LIVE = /^event\/\d+\/live$|^event-status$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };

  /* Strip the routing prefix to get the bare FPL endpoint. */
  const sub = (event.path || '')
    .replace(/^\/(\.netlify\/functions\/fpl|api\/fpl)\/?/, '')
    .replace(/\/+$/, '');

  if (!ALLOW.some((re) => re.test(sub))) {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Endpoint not allowed', endpoint: sub }) };
  }

  const qs = event.rawQuery ? '?' + event.rawQuery : '';
  const url = 'https://fantasy.premierleague.com/api/' + sub + '/' + qs;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PLBookingsDesk/1.0)',
        'Accept': 'application/json'
      }
    });
    const body = await r.text();
    return {
      statusCode: r.status,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        /* Bootstrap / fixtures move slowly; the live feeds must not be held. */
        'Cache-Control': LIVE.test(sub) ? 'no-store' : 'public, max-age=300, stale-while-revalidate=600'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream fetch failed' }) };
  }
};

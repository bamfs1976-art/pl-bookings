/* Bookings Desk — FPL API proxy (Netlify Function)
   The official FPL API blocks direct browser calls (no CORS), so the app's
   live-data requests are routed through here. Pattern shared with the
   Gameweek Edge proxy: whitelist only the endpoints the desk needs (no open
   proxy / SSRF), add a browser-like User-Agent, return CORS headers, and
   cache slow-changing data at the edge.

   Invoked at /api/fpl/<endpoint> via the rewrite in _redirects. */

const ALLOW = [
  /^bootstrap-static$/,
  /^fixtures$/,
  /^event-status$/
];

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
        /* Bootstrap / fixtures move slowly; event-status flips on matchdays. */
        'Cache-Control': sub === 'event-status' ? 'no-store' : 'public, max-age=300, stale-while-revalidate=600'
      },
      body
    };
  } catch (e) {
    return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Upstream fetch failed' }) };
  }
};

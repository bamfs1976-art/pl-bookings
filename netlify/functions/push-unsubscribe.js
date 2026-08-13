/* Removes a subscription. POST { endpoint }.

   Deliberately unauthenticated, like subscribe: holding the endpoint is the
   only credential there is, and the worst a hostile caller can do with one is
   stop notifications the endpoint's owner asked for. Requiring an account to
   turn alerts OFF would be worse than this. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!srv) return json(503, { error: 'Push not configured' });
  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  if (!b.endpoint || typeof b.endpoint !== 'string') return json(400, { error: 'Bad request' });
  try {
    await fetch(SUPABASE_URL + '/rest/v1/plb_push_subs?endpoint=eq.' + encodeURIComponent(b.endpoint), {
      method: 'DELETE',
      headers: { apikey: srv, Authorization: 'Bearer ' + srv, Prefer: 'return=minimal' },
    });
    return json(200, { ok: true });
  } catch (_) { return json(502, { error: 'Could not remove subscription' }); }
};

/* The public VAPID key, so the browser can subscribe.

   503 rather than a placeholder when push is unconfigured: the client uses
   the status to decide whether to offer alerts at all, and a fake key would
   produce a subscription no notification can ever be sent to. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Push not configured' }) };
  }
  return { statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify({ key }) };
};

/* Stores or refreshes a Web Push subscription and the watchlist it wants
   alerts for. POST { subscription, watch: ["ARS|Gabriel", ...], prefs?, userId? }

   Called on every watchlist change, not only on first subscribe — the server
   has no other way to learn that a player was starred, because the watchlist
   is local-first and works signed out. Upsert on endpoint, so re-sending is
   free and idempotent.

   Supabase over its REST API with plain fetch, like every other function
   here: this repo has no package.json and no build step. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (c, o) => ({ statusCode: c, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');

/* FPL element ids for the same players, where the client knows them. Ints
   only, bounded the same way — this is what the ban alert targets on. */
function cleanEls(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const n of v) {
    const i = Number(n);
    if (!Number.isInteger(i) || i <= 0 || i > 100000) continue;
    out.push(i);
    if (out.length >= 200) break;
  }
  return out;
}

/* A watchlist key is "CLUB|Player Name". Bounded and shape-checked because it
   arrives from the client and is later matched against club codes: a hostile
   or broken value should be dropped here, not stored and puzzled over later.
   200 keys is far more than anyone stars and far less than a payload worth
   worrying about. */
function cleanWatch(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const k of v) {
    if (typeof k !== 'string') continue;
    if (k.length > 80 || k.indexOf('|') < 1) continue;
    out.push(k);
    if (out.length >= 200) break;
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!srv || !process.env.VAPID_PUBLIC_KEY) return json(503, { error: 'Push not configured' });

  let b; try { b = JSON.parse(event.body || '{}'); } catch (_) { return json(400, { error: 'Bad request' }); }
  const s = b.subscription;
  if (!s || typeof s.endpoint !== 'string' || !s.keys || !s.keys.p256dh || !s.keys.auth) {
    return json(400, { error: 'Invalid subscription' });
  }
  /* Only real push endpoints. Without this the table is an open relay: anyone
     could store a URL of their choosing and have this server POST to it on a
     schedule. */
  let host;
  try { host = new URL(s.endpoint); } catch (_) { return json(400, { error: 'Invalid endpoint' }); }
  if (host.protocol !== 'https:') return json(400, { error: 'Invalid endpoint' });

  const row = {
    endpoint: s.endpoint,
    p256dh: s.keys.p256dh,
    auth: s.keys.auth,
    watch: cleanWatch(b.watch),
    els: cleanEls(b.els),
    prefs: (b.prefs && typeof b.prefs === 'object') ? b.prefs : { appointment: true, ban: true },
    user_id: (typeof b.userId === 'string' && b.userId) ? b.userId : null,
    updated_at: new Date().toISOString(),
  };

  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/plb_push_subs?on_conflict=endpoint', {
      method: 'POST',
      headers: {
        apikey: srv, Authorization: 'Bearer ' + srv,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) return json(502, { error: 'Could not save subscription' });
    return json(200, { ok: true, watching: row.watch.length, identified: row.els.length });
  } catch (_) {
    return json(502, { error: 'Could not save subscription' });
  }
};

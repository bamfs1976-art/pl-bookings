// What does our football-data.org key actually return? A read-only probe.
//
// docs/referee-sourcing.md rates football-data.org v4 as "⚠️ Free tier
// reportedly thin on match detail. Probe before committing." That verdict was
// written from documentation and search, because the agent proxy denies
// api.football-data.org and every other external host. CI is not restricted —
// the fixtures job already reaches API-Football from here — so this script is
// how the ⚠️ gets replaced with a measurement.
//
// It answers three questions the sourcing note left open:
//
//   1. Does the key see all three of our leagues? The free tier covers twelve
//      competitions, and PL (2021), Championship (2016) and La Liga (2014) are
//      all supposed to be among them. If that holds it is the first free source
//      spanning the whole desk footprint — the two frozen desks included.
//
//   2. Do `referees` populate BEFORE kick-off? This is the one that decides
//      whether the endpoint is worth anything to us. An appointment we learn
//      before the match reprices the fixture; a referee recorded after it has
//      been played is something football-data.co.uk already gives us free.
//      The probe asks both ways and contrasts them, because only the contrast
//      distinguishes the two.
//
//   3. Which fields are silently empty rather than absent? A restricted field
//      on this API comes back as an empty array, not an error, so a card built
//      on lineups would render blank forever and look like a data gap.
//
// It WRITES NOTHING and commits nothing. Every call is a GET. Run it, read the
// log, then decide what to build — that order is the entire point.

const TOKEN = process.env.FOOTBALL_DATA_TOKEN || '';
const BASE = 'https://api.football-data.org/v4';

/* The free tier is 10 requests/minute. Pacing at 6.5s keeps us inside it with
   room for clock skew, which matters because a 429 mid-run would otherwise be
   indistinguishable from an entitlement failure — exactly the confusion this
   script exists to remove. ~20 calls, so budget about two and a half minutes. */
const MIN_INTERVAL_MS = 6500;

const COMPS = [
  { code: 'PL', id: 2021, name: 'Premier League', desk: 'index.html (live)' },
  { code: 'ELC', id: 2016, name: 'EFL Championship', desk: 'eflc.html (frozen)' },
  { code: 'PD', id: 2014, name: 'La Liga', desk: 'laliga.html (frozen)' }
];

if (!TOKEN) {
  console.log('::error::FOOTBALL_DATA_TOKEN is not set — nothing can be probed.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
let calls = 0;

/* Returns a result object rather than throwing. A 403 IS the finding when the
   question is "what is this key entitled to", so it must not abort the run. */
async function api(path) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);

  for (let attempt = 0; attempt < 2; attempt++) {
    lastCall = Date.now();
    calls++;
    let res;
    try {
      res = await fetch(BASE + path, { headers: { 'X-Auth-Token': TOKEN } });
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }

    /* Back off once on a rate limit rather than reporting it as a restriction.
       Retry-After is the documented signal; the fallback covers it being absent. */
    if (res.status === 429 && attempt === 0) {
      const after = Number(res.headers.get('retry-after')) || 60;
      console.log(`   … rate limited, waiting ${after}s`);
      await sleep(after * 1000);
      continue;
    }

    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error pages exist */ }
    return {
      ok: res.ok,
      status: res.status,
      json: body,
      // The API explains restrictions in prose; it is the most useful thing
      // in a 403 and worth surfacing verbatim.
      message: body && (body.message || body.error) || null
    };
  }
  return { ok: false, status: 429, error: 'still rate limited after backoff' };
}

/* Restricted fields come back as [] rather than missing, so "has the field"
   and "the field has anything in it" are different questions. */
const filled = (v) => Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '';
const mark = (b) => b ? 'yes' : 'no';

const rows = [];
function record(endpoint, r, note) {
  /* A 403 from the API always explains itself in the body. A 403 with no
     message is somebody else's — a corporate proxy or the agent proxy refusing
     the tunnel — and filing that as "restricted plan" would answer the
     entitlement question with a network fault. */
  const state = r.ok ? 'ok'
    : r.status === 403 && r.message ? 'RESTRICTED'
    : r.status === 403 ? 'BLOCKED'
    : `HTTP ${r.status}`;
  rows.push({ endpoint, state, note: note || r.message || '' });
  console.log(`  ${state.padEnd(11)} ${endpoint}${note ? ` — ${note}` : (r.message ? ` — ${r.message}` : '')}`);
}

const iso = (d) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------

console.log('football-data.org v4 — what this key can actually see\n');

// 1. Reference data. Static, so if we ever use it we fetch once and commit it.
console.log('Reference');
const areas = await api('/areas');
record('/v4/areas', areas, areas.ok ? `${(areas.json?.areas || []).length} areas` : null);

// 2. Entitlement per competition — the free tier's twelve, and whether our
//    three are inside them.
console.log('\nCompetition access');
const reachable = [];
for (const c of COMPS) {
  const r = await api(`/v4/competitions/${c.id}`);
  if (r.ok) reachable.push(c);
  record(`/v4/competitions/${c.id}  ${c.name}`, r,
    r.ok ? `season ${r.json?.currentSeason?.startDate?.slice(0, 4) ?? '?'} · desk: ${c.desk}` : null);
}

if (!reachable.length) {
  const blocked = rows.some((r) => r.state === 'BLOCKED' || r.state === 'HTTP 0');
  console.log(blocked
    ? '\n::error::Nothing was reached and the API never answered — this looks like a ' +
      'blocked network rather than a plan limit. Run it in CI; the agent proxy denies ' +
      'api.football-data.org, which is why this script exists as a workflow.'
    : '\n::error::The key reached none of the three competitions. Either it is invalid ' +
      'or the plan does not cover PL, Championship or La Liga. Nothing further to probe.');
  process.exit(1);
}

// 3. Top scorers — the cheapest new card, and the one the table calls obvious.
console.log('\nScorers');
for (const c of reachable) {
  const r = await api(`/v4/competitions/${c.id}/scorers`);
  record(`/v4/competitions/${c.id}/scorers  ${c.code}`, r,
    r.ok ? `${(r.json?.scorers || []).length} returned` : null);
}

// 4. THE REFEREE QUESTION. Scheduled first, finished second, and the contrast
//    between them is the answer. Asking only one way cannot distinguish
//    "publishes allocations" from "records officials after the fact".
console.log('\nReferees — before kick-off vs after');
const refVerdict = [];
for (const c of reachable) {
  const sched = await api(`/v4/competitions/${c.id}/matches?status=SCHEDULED`);
  const fin = await api(`/v4/competitions/${c.id}/matches?status=FINISHED`);

  const count = (r) => {
    const m = (r.json?.matches || []).slice(0, 50);
    return { n: m.length, withRef: m.filter((x) => filled(x.referees)).length };
  };
  const s = sched.ok ? count(sched) : { n: 0, withRef: 0 };
  const f = fin.ok ? count(fin) : { n: 0, withRef: 0 };

  refVerdict.push({ comp: c, s, f, ok: sched.ok && fin.ok });
  record(`/v4/competitions/${c.id}/matches  ${c.code}`, sched,
    `scheduled ${s.withRef}/${s.n} with referees · finished ${f.withRef}/${f.n} with referees`);
}

// 5. Single-match detail. The table claims referees, half-time score and
//    lineups; lineups are the paid half and will show up here as empty.
console.log('\nMatch detail');
let sampleMatchId = null, sampleTeamId = null;
{
  const c = reachable[0];
  const list = await api(`/v4/competitions/${c.id}/matches?status=SCHEDULED`);
  const m = (list.json?.matches || [])[0];
  sampleMatchId = m?.id ?? null;
  sampleTeamId = m?.homeTeam?.id ?? null;

  if (!sampleMatchId) {
    console.log('  skipped     no scheduled match to sample (out of season?)');
  } else {
    const d = await api(`/v4/matches/${sampleMatchId}`);
    const j = d.json?.match || d.json || {};
    record(`/v4/matches/${sampleMatchId}`, d, d.ok
      ? `referees ${mark(filled(j.referees))} · lineup ${mark(filled(j.homeTeam?.lineup))} · ` +
        `bench ${mark(filled(j.homeTeam?.bench))} · bookings ${mark(filled(j.bookings))} · ` +
        `half-time ${mark(filled(j.score?.halfTime?.home))}`
      : null);

    const h2h = await api(`/v4/matches/${sampleMatchId}/head2head?limit=10`);
    record(`/v4/matches/${sampleMatchId}/head2head`, h2h,
      h2h.ok ? `${(h2h.json?.matches || []).length} prior meetings` : null);
  }
}

// 6. Squad, coach, venue.
console.log('\nTeam');
if (sampleTeamId) {
  const t = await api(`/v4/teams/${sampleTeamId}`);
  const j = t.json || {};
  record(`/v4/teams/${sampleTeamId}`, t, t.ok
    ? `squad ${(j.squad || []).length} · coach ${mark(filled(j.coach?.name))} · ` +
      `venue ${mark(filled(j.venue))} · founded ${mark(filled(j.founded))} · colours ${mark(filled(j.clubColors))}`
    : null);
} else {
  console.log('  skipped     no team id sampled');
}

// 7. Person detail, and the match history behind it — the half the table
//    assumes is free and probably is not.
console.log('\nPerson');
{
  const c = reachable[0];
  const sc = await api(`/v4/competitions/${c.id}/scorers`);
  const pid = (sc.json?.scorers || [])[0]?.player?.id ?? null;
  if (!pid) {
    console.log('  skipped     no player id sampled');
  } else {
    const p = await api(`/v4/persons/${pid}`);
    record(`/v4/persons/${pid}`, p, p.ok
      ? `position ${mark(filled(p.json?.position))} · dob ${mark(filled(p.json?.dateOfBirth))}` : null);
    const pm = await api(`/v4/persons/${pid}/matches?limit=10`);
    record(`/v4/persons/${pid}/matches`, pm,
      pm.ok ? `${(pm.json?.matches || []).length} matches` : null);
  }
}

// 8. Cross-competition window. Ten days is the documented cap; asking for
//    exactly ten confirms it rather than assuming it.
console.log('\nCross-competition window');
{
  const from = new Date();
  const to = new Date(Date.now() + 9 * 86400000);
  const r = await api(`/v4/matches?dateFrom=${iso(from)}&dateTo=${iso(to)}`);
  record(`/v4/matches?dateFrom=${iso(from)}&dateTo=${iso(to)}`, r,
    r.ok ? `${(r.json?.matches || []).length} matches across all competitions` : null);
}

// ---------------------------------------------------------------------------
// The verdict, stated plainly, because the whole point is to settle an argument
// in docs/referee-sourcing.md rather than to produce a wall of statuses.

console.log(`\n${'='.repeat(70)}\nVerdict\n${'='.repeat(70)}`);

console.log(`\nLeagues reachable: ${reachable.map((c) => c.code).join(', ') || 'none'}` +
  ` (of ${COMPS.map((c) => c.code).join(', ')})`);
for (const c of COMPS) {
  if (!reachable.some((r) => r.id === c.id)) {
    console.log(`::warning::${c.name} is NOT reachable with this key — ${c.desk} gains nothing here.`);
  }
}

const anyPre = refVerdict.some((v) => v.s.withRef > 0);
const anyPost = refVerdict.some((v) => v.f.withRef > 0);

console.log('\nReferees:');
for (const v of refVerdict) {
  console.log(`  ${v.comp.code.padEnd(5)} pre-match ${String(v.s.withRef).padStart(3)}/${String(v.s.n).padEnd(3)}` +
    ` · post-match ${String(v.f.withRef).padStart(3)}/${String(v.f.n)}`);
}

if (anyPre) {
  console.log('\n  → Appointments ARE published before kick-off. This is a genuine second\n' +
    '    allocation source and can cross-check API-Football, which docs/referee-sourcing.md\n' +
    '    calls a single point of failure for a number that moves every price.');
} else if (anyPost) {
  console.log('\n  → Referees appear only AFTER the match. That is a post-match record, which\n' +
    '    football-data.co.uk already gives us free via data/build_refs.py. It adds nothing\n' +
    '    to the referee layer — judge this API on the frozen desks instead.');
} else {
  console.log('\n  → No referees at all, played or unplayed. The `referees` array is not\n' +
    '    populated for this key. Close the referee question against this source.');
}

/* One caveat the numbers cannot carry on their own: in the weeks before a
   season starts, no league has appointed anyone, so "0 pre-match" is the
   expected reading rather than a restriction. Saying so here stops a run in
   August being filed as a negative result. */
if (!anyPre && anyPost) {
  console.log('\n  Caveat: if this ran well before a round, zero pre-match appointments is\n' +
    '  also what a working feed looks like. Re-run inside a publication window\n' +
    '  (see scripts/ref-coverage.mjs for the observed lead times) before concluding.');
}

const restricted = rows.filter((r) => r.state === 'RESTRICTED');
if (restricted.length) {
  console.log(`\nRestricted on this plan (${restricted.length}):`);
  for (const r of restricted) console.log(`  ${r.endpoint}${r.note ? ` — ${r.note}` : ''}`);
}

console.log(`\n${calls} requests used.`);

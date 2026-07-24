/* Bookings Desk — scheduled model-prediction logger (the calibration loop;
   parity with Gameweek Edge's log-predictions / P5).

   Runs hourly. Before each deadline it logs the shipping SEASON model's
   forecast — P(>=1 card) per player with a fixture in the upcoming
   gameweek — into public.plb_predictions; once a gameweek finishes it
   backfills each row's actual (was the player booked?). The read function
   (model-calibration.js) then grades the model in public.

   Fidelity: the exact pure maths the browser runs is REUSED, not
   re-implemented — assets/core.js (PLDCore) and the model/data files ship
   with this function via netlify.toml included_files and are evaluated
   here. The forecast logged is the referee-independent season P(card) the
   Season table shows (per-fixture referee scaling is a client-local
   assignment and cannot be graded server-side).

   No secrets in the client. Talks to Supabase over PostgREST with the
   service-role key (same pattern as insights.js — no @supabase/supabase-js
   dependency). No-ops cleanly if unconfigured.

   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */

const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (compatible; BookingsDesk/1.0; +https://pl-bookings.netlify.app)';
const SEASON = '2026-27';
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://knodunjnsxelmpziupwk.supabase.co').replace(/\/+$/, '');

/* ── load the shipped pure maths + data (bundled via included_files) ── */
function readFirst(rels) {
  for (const rel of rels) {
    for (const base of [__dirname, path.join(__dirname, '..', '..'), process.cwd()]) {
      try { return fs.readFileSync(path.join(base, rel), 'utf8'); } catch (_) { /* next */ }
    }
  }
  return null;
}
// core.js is an IIFE that sets module.exports = PLDCore.
function evalCore(txt) { const m = { exports: {} }; new Function('module', 'window', txt)(m, undefined); return m.exports; }
// pl_data.js / model.js declare bare consts; capture them out of the scope.
function evalData(txt) {
  return new Function(txt + '\n;return {CLUBS: typeof CLUBS!=="undefined"?CLUBS:null, PL_PLAYERS: typeof PL_PLAYERS!=="undefined"?PL_PLAYERS:null, REFS: typeof REFS!=="undefined"?REFS:null};')();
}
function evalModel(txt) {
  const m = { exports: {} };
  new Function('module', 'window', txt + '\n;if(typeof CARD_MODEL!=="undefined"&&!module.exports.slope)module.exports=CARD_MODEL;')(m, undefined);
  return m.exports;
}

const mpick = (o, k, fb) => (o && o[k] != null ? o[k] : fb);

/* Build the season-P(card) engine — the same computation as pModelBase() in
   index.html, on baked (pre-fixture) rates. */
function buildEngine() {
  const coreTxt = readFirst(['assets/core.js']);
  const dataTxt = readFirst(['data/pl_data.js']);
  const modelTxt = readFirst(['data/model.js']);
  if (!coreTxt || !dataTxt) return null;
  const PLD = evalCore(coreTxt);
  const { CLUBS, PL_PLAYERS } = evalData(dataTxt);
  const MODEL = modelTxt ? evalModel(modelTxt) : null;
  if (!PLD || !PL_PLAYERS || !CLUBS) return null;
  const CALIB = PLD.calibrate(PL_PLAYERS);
  const OK = !!(MODEL && typeof PLD.shrinkRate === 'function' && typeof PLD.glmProb === 'function');

  function pCard(p) {
    if (!OK) return PLD.impliedProb(p.r, CALIB);
    const S = MODEL.shrink;
    const sy = PLD.shrinkRate(p.yc || 0, p.min || 0, mpick(S.ycMean, p.p, S.ycLeague), S.strengthMatches);
    if (p.f == null) return PLD.impliedProb(p.r, CALIB);
    const sf = PLD.shrinkRate((p.f || 0) * ((p.min || 0) / 90), p.min || 0, mpick(S.foulMean, p.p, S.foulLeague), S.strengthMatches);
    return PLD.glmProb({ yc90: sy, foul90: sf, DF: p.p === 'DF' ? 1 : 0, MF: p.p === 'MF' ? 1 : 0, FW: p.p === 'FW' ? 1 : 0 }, MODEL.glm);
  }
  return { PLD, CLUBS, PL_PLAYERS, pCard };
}

/* Match FPL elements to baked players by club + normalized name (full, web,
   then unique surname) — the server-side twin of attachLive(). Returns a map
   baked-player -> FPL element id, and each player's FPL team id. */
function matchElements(eng, boot) {
  const { PLD, CLUBS, PL_PLAYERS } = eng;
  const normName = PLD.normName;
  const CLUBMAP = {}; CLUBS.forEach((c) => { CLUBMAP[c.short] = c; });
  const byName = {}; CLUBS.forEach((c) => { byName[normName(c.name)] = c.short; });
  const teamMap = {}; // fpl team id -> club short
  (boot.teams || []).forEach((t) => {
    if (CLUBMAP[t.short_name]) teamMap[t.id] = t.short_name;
    else if (byName[normName(t.name)]) teamMap[t.id] = byName[normName(t.name)];
  });
  const byClub = {}; PL_PLAYERS.forEach((p) => { (byClub[p.c] = byClub[p.c] || []).push(p); });
  const index = {};
  Object.keys(byClub).forEach((c) => {
    const m = {};
    byClub[c].forEach((p) => {
      const k = normName(p.n); m[k] = (k in m) ? null : p;
      const lk = 'last:' + (k.split(' ').pop() || ''); m[lk] = (lk in m) ? null : p;
    });
    index[c] = m;
  });
  const out = new Map(); // player -> {element, team}
  (boot.elements || []).forEach((el) => {
    const c = teamMap[el.team]; if (!c || !index[c]) return;
    const m = index[c];
    const full = normName(el.first_name + ' ' + el.second_name), web = normName(el.web_name);
    const p = m[full] || m[web] || m['last:' + (normName(el.second_name).split(' ').pop() || '')] || m['last:' + (web.split(' ').pop() || '')] || null;
    if (!p || out.has(p)) return;
    out.set(p, { element: el.id, team: el.team });
  });
  return out;
}

/* Pure core: rows to log for the upcoming gameweek. No network/DB. */
function computePredictions(eng, boot, fixtures) {
  const events = boot.events || [];
  const upcoming = events.find((e) => !e.finished) || null;
  if (!upcoming) return { gw: null, deadline: null, rows: [] };
  const gw = upcoming.id;
  const playingTeams = new Set(
    (fixtures || []).filter((f) => f.event === gw).flatMap((f) => [f.team_h, f.team_a])
  );
  const matched = matchElements(eng, boot);
  const rows = [];
  for (const [p, info] of matched) {
    if (!playingTeams.has(info.team)) continue;
    const pc = eng.pCard(p);
    if (!(pc > 0)) continue;
    rows.push({ season: SEASON, gw, element: info.element, name: p.n, club: p.c, pcard: Math.round(pc * 10000) / 10000 });
  }
  return { gw, deadline: upcoming.deadline_time, rows };
}

const fplGet = (p) => fetch('https://fantasy.premierleague.com/api/' + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } }).then((r) => r.json());

exports.config = { schedule: '@hourly' };

exports.handler = async () => {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { statusCode: 200, body: 'not configured' };
  const eng = buildEngine();
  if (!eng) return { statusCode: 200, body: 'model/data not bundled' };

  let boot, fixtures;
  try { [boot, fixtures] = await Promise.all([fplGet('bootstrap-static/'), fplGet('fixtures/')]); }
  catch (_) { return { statusCode: 200, body: 'fpl unavailable' }; }

  const rest = SUPABASE_URL + '/rest/v1/plb_predictions';
  const H = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  let logged = 0, graded = 0;

  /* 1) Log the upcoming gameweek's forecast, but only while the deadline is
        still ahead (freeze once the gameweek locks). */
  try {
    const { gw, deadline, rows } = computePredictions(eng, boot, fixtures);
    if (gw && deadline && Date.now() < new Date(deadline).getTime() && rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        await fetch(rest + '?on_conflict=season,gw,element', {
          method: 'POST',
          headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows.slice(i, i + 500)),
        });
      }
      logged = rows.length;
    }
  } catch (e) { /* leave logged at 0 */ }

  /* 2) Backfill actuals for this season's finished gameweeks still missing
        them (scoped to SEASON so other seasons' same-numbered rows are safe). */
  try {
    const finishedGws = (boot.events || []).filter((e) => e.finished).map((e) => e.id);
    const q = await fetch(`${rest}?season=eq.${encodeURIComponent(SEASON)}&carded=is.null&gw=in.(${finishedGws.join(',') || '-1'})&select=gw,element,name,club,pcard`, { headers: H });
    const pending = q.ok ? await q.json() : [];
    const byGw = {}; pending.forEach((r) => { (byGw[r.gw] = byGw[r.gw] || []).push(r); });
    const toGrade = Object.keys(byGw).map(Number).sort((a, b) => b - a).slice(0, 3);
    for (const gw of toGrade) {
      let live; try { live = await fplGet('event/' + gw + '/live/'); } catch (_) { continue; }
      const booked = {};
      (live.elements || []).forEach((e) => {
        const s = e.stats || {};
        booked[e.id] = ((s.yellow_cards || 0) + (s.red_cards || 0)) > 0 ? 1 : 0;
      });
      const upd = byGw[gw]
        .filter((r) => booked[r.element] != null)
        .map((r) => ({ season: SEASON, gw, element: r.element, name: r.name, club: r.club, pcard: r.pcard, carded: booked[r.element] }));
      for (let i = 0; i < upd.length; i += 500) {
        await fetch(rest + '?on_conflict=season,gw,element', {
          method: 'POST',
          headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(upd.slice(i, i + 500)),
        });
        graded += Math.min(500, upd.length - i);
      }
    }
  } catch (e) { /* leave graded at 0 */ }

  return { statusCode: 200, body: JSON.stringify({ logged, graded }) };
};

// exported for unit testing
module.exports.computePredictions = computePredictions;
module.exports.buildEngine = buildEngine;
module.exports.matchElements = matchElements;

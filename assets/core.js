/* PLDCore — the desk's pure logic, extracted so it can be unit-tested.
   Loaded by index.html before the app script (functions on the PLDCore
   global) and required directly by tests/test-core.mjs under node.
   No DOM, no fetch, no state — every function here is a pure calculation. */

(function (global) {
  'use strict';

  /* ---- booking risk ----
     risk = yellow cards per 90 × 2 + fouls committed per 90.
     Yellow rate is weighted double because the market pays on cards;
     fouls per 90 carries the volume signal. */
  function riskScore(y90, f90) {
    if (y90 == null || f90 == null || !isFinite(y90) || !isFinite(f90)) return null;
    return Math.round((y90 * 2 + f90) * 1000) / 1000;
  }

  /* ---- name normalisation ----
     Used to match FPL feed players to the baked squads: strip accents,
     lowercase, collapse every non-letter run to a single space. */
  function normName(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z]+/g, ' ')
      .trim();
  }

  /* ---- pick tracker money math ---- */
  function pickPL(p) {
    if (!p) return 0;
    if (p.status === 'won') return (Number(p.stake) || 0) * ((Number(p.odds) || 0) - 1);
    if (p.status === 'lost') return -(Number(p.stake) || 0);
    return 0; /* pending and void return the stake: zero P/L */
  }

  function summarisePicks(picks) {
    const arr = Array.isArray(picks) ? picks.filter(Boolean) : [];
    const settled = arr.filter((p) => p.status === 'won' || p.status === 'lost');
    const won = arr.filter((p) => p.status === 'won').length;
    const lost = arr.filter((p) => p.status === 'lost').length;
    const pending = arr.filter((p) => p.status === 'pending').length;
    const hit = settled.length ? (100 * won / settled.length) : null;
    const staked = settled.reduce((s, p) => s + (Number(p.stake) || 0), 0);
    const pl = arr.reduce((s, p) => s + pickPL(p), 0);
    const roi = staked ? (100 * pl / staked) : null;
    return { count: arr.length, won, lost, pending, settled: settled.length, hit, staked, pl, roi };
  }

  /* ---- implied booking probability ----
     Maps a risk score to a model-implied P(booked in a match) with a
     logistic curve. Calibration anchors the curve to the data itself:
     the league base booking rate is total yellows per player-match
     (Σ yc / Σ min/90) over the baked season, and the intercept is chosen
     so the minutes-weighted league-average risk lands exactly on that
     base rate. The slope is fixed — one anchor point only pins the
     intercept — at a value that keeps the spread sensible across the
     observed risk range. An estimate, not a market price. */
  const LOGISTIC_SLOPE = 1.1;

  function calibrate(players) {
    let yc = 0, matches = 0, riskW = 0, w = 0;
    (players || []).forEach((p) => {
      if (!p) return;
      const m = Number(p.min) || 0;
      if (m > 0 && p.yc != null) { yc += Number(p.yc) || 0; matches += m / 90; }
      if (p.r != null && m > 0) { riskW += p.r * m; w += m; }
    });
    const baseRate = matches > 0 ? Math.min(0.9, Math.max(0.01, yc / matches)) : 0.12;
    const avgRisk = w > 0 ? riskW / w : 1.0;
    const b = LOGISTIC_SLOPE;
    const a = Math.log(baseRate / (1 - baseRate)) - b * avgRisk;
    return { a, b, baseRate, avgRisk };
  }

  function impliedProb(risk, calib) {
    if (risk == null || !isFinite(risk) || !calib) return null;
    const p = 1 / (1 + Math.exp(-(calib.a + calib.b * risk)));
    return Math.min(0.95, Math.max(0.005, p));
  }

  function fairOdds(prob) {
    if (prob == null || !(prob > 0)) return null;
    return 1 / prob;
  }

  /* Edge of a bookmaker's decimal price against the model probability:
     (odds × p − 1) × 100. Positive means the price pays more than the
     model thinks the chance is worth. */
  function edgePct(bookOdds, prob) {
    const o = Number(bookOdds);
    if (!isFinite(o) || o <= 1 || prob == null || !(prob > 0)) return null;
    return (o * prob - 1) * 100;
  }

  const PLDCore = { riskScore, normName, pickPL, summarisePicks, calibrate, impliedProb, fairOdds, edgePct, LOGISTIC_SLOPE };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLDCore;
  global.PLDCore = PLDCore;
})(typeof window !== 'undefined' ? window : globalThis);

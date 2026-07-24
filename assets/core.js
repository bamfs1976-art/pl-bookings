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

  /* ══════════════════════════════════════════════════════════════════
     MODEL v2 — accuracy work (see docs/modelling-review.md).
     All pure, all unit-tested. Three families:
       Tier 1  empirical-Bayes shrinkage + log-odds context (ref/derby)
               + calibration metrics (Brier, log-loss, reliability).
       Tier 2  a fitted logistic GLM (glmProb) whose coefficients live in
               data/model.js — season-prior until a match-level fit runs.
       Tier 3  a Negative-Binomial fouls forecast + a mechanistic
               two-stage fouls→card model.
     ══════════════════════════════════════════════════════════════════ */

  /* ---- Tier 1a: empirical-Bayes shrinkage ----
     A per-90 rate off few minutes is mostly noise (1 yellow in 500 mins
     reads as 0.18/90). Shrink the raw count toward a prior mean, weighted by
     exposure in matches (mins/90): rate = (events + mean·k) / (matches + k).
     k is the prior strength in matches — larger k pulls harder. As matches
     grow the estimate approaches the raw rate. */
  function shrinkRate(events, mins, priorMean90, strengthMatches) {
    const ex = (Number(mins) || 0) / 90;
    const k = strengthMatches > 0 ? strengthMatches : 6;
    const m = priorMean90 == null ? 0 : priorMean90;
    if (!(ex > 0)) return m;
    return ((Number(events) || 0) + m * k) / (ex + k);
  }

  /* ---- Tier 1b: log-odds context ----
     A referee's card rate (or a derby) should multiply the ODDS, not the
     probability. prob×1.3 sends a 72% pick to 94%; odds×1.3 sends it to 77%.
     scaleOdds multiplies the odds of p by factor f; contextProb chains the
     referee and derby odds-factors and clamps. */
  function logit(p) { return Math.log(p / (1 - p)); }
  function invLogit(x) { return 1 / (1 + Math.exp(-x)); }
  function scaleOdds(p, f) {
    if (p == null || !(p > 0) || !(p < 1) || !(f > 0)) return p;
    const o = (p / (1 - p)) * f;
    return o / (1 + o);
  }
  function contextProb(baseP, refFactor, derbyFactor) {
    if (baseP == null) return null;
    let p = scaleOdds(baseP, refFactor == null ? 1 : refFactor);
    p = scaleOdds(p, derbyFactor == null ? 1 : derbyFactor);
    return Math.min(0.95, Math.max(0.005, p));
  }

  /* ---- Tier 1c: calibration metrics ----
     preds is an array of {p, y} with y in {0,1}. */
  function brier(preds) {
    const a = (preds || []).filter((d) => d && d.p != null && (d.y === 0 || d.y === 1));
    if (!a.length) return null;
    return a.reduce((s, d) => s + (d.p - d.y) * (d.p - d.y), 0) / a.length;
  }
  function logLoss(preds) {
    const a = (preds || []).filter((d) => d && d.p != null && (d.y === 0 || d.y === 1));
    if (!a.length) return null;
    const e = 1e-15;
    return -a.reduce((s, d) => {
      const p = Math.min(1 - e, Math.max(e, d.p));
      return s + (d.y * Math.log(p) + (1 - d.y) * Math.log(1 - p));
    }, 0) / a.length;
  }
  function reliability(preds, bins) {
    const nb = bins > 0 ? bins : 10;
    const a = (preds || []).filter((d) => d && d.p != null && (d.y === 0 || d.y === 1));
    const acc = Array.from({ length: nb }, (_, i) => ({ lo: i / nb, hi: (i + 1) / nb, n: 0, sp: 0, sy: 0 }));
    a.forEach((d) => { const i = Math.min(nb - 1, Math.max(0, Math.floor(d.p * nb))); acc[i].n++; acc[i].sp += d.p; acc[i].sy += d.y; });
    return acc.map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.n ? b.sp / b.n : null, obs: b.n ? b.sy / b.n : null }));
  }

  /* ---- Tier 2: logistic GLM inference ----
     coef = {intercept, weights:{feature:beta}}; feats = {feature:value}.
     Missing features contribute nothing (treated as 0). */
  function glmProb(feats, coef) {
    if (!coef || coef.intercept == null) return null;
    let z = coef.intercept;
    const w = coef.weights || {};
    for (const k in w) { const v = feats ? feats[k] : null; if (v != null && isFinite(v)) z += w[k] * v; }
    return Math.min(0.999, Math.max(0.001, invLogit(z)));
  }

  /* ---- Tier 3: fouls forecast + two-stage card ---- */
  function gammaln(x) {
    const g = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) { y++; ser += g[j] / y; }
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  /* Expected fouls in a match = per-90 rate × expected 90s played. */
  function expectedFouls(foulRate90, expMinutes) {
    if (foulRate90 == null || !isFinite(foulRate90)) return null;
    return foulRate90 * ((expMinutes == null ? 90 : expMinutes) / 90);
  }
  /* P(count > line) for a Negative Binomial with mean mu and size r
     (variance = mu + mu²/r; r→∞ is Poisson). For an over-line.5 market pass
     the integer line (e.g. 1 for over 1.5). */
  function nbTailProb(mu, r, line) {
    if (mu == null || !(mu > 0)) return null;
    const size = r > 0 ? r : 8;
    const p = size / (size + mu);
    let cdf = 0;
    for (let k = 0; k <= line; k++) {
      const logpmf = gammaln(k + size) - gammaln(size) - gammaln(k + 1) + size * Math.log(p) + k * Math.log(1 - p);
      cdf += Math.exp(logpmf);
    }
    return Math.min(1, Math.max(0, 1 - cdf));
  }
  /* Mechanistic card chance: bookings ~ Poisson(expFouls × perFoulHazard),
     so P(≥1 caution) = 1 − exp(−expFouls × hazard). The hazard is the
     league cards-per-foul, scaled by the referee. */
  function cardProbFromFouls(expFouls, perFoulHazard) {
    if (expFouls == null || perFoulHazard == null || !(perFoulHazard >= 0)) return null;
    return Math.min(0.95, Math.max(0.005, 1 - Math.exp(-expFouls * perFoulHazard)));
  }
  /* Exponential recency weight for a match `gwsAgo` gameweeks in the past
     (0 = the most recent). `decay` is the per-gameweek retention (0.97 keeps
     97% of the weight each week back), matching the match-model recency
     decay on gameweekedge.co.uk. Weights the GLM fit so recent form counts
     for more than early-season noise. decay 1 = no decay (uniform). */
  function recencyWeight(gwsAgo, decay) {
    const d = (decay == null) ? 0.97 : decay;
    const g = Math.max(0, Number(gwsAgo) || 0);
    if (!(d > 0 && d <= 1)) return 1;
    return Math.pow(d, g);
  }

  const PLDCore = {
    riskScore, normName, pickPL, summarisePicks, calibrate, impliedProb, fairOdds, edgePct, LOGISTIC_SLOPE,
    shrinkRate, logit, invLogit, scaleOdds, contextProb,
    brier, logLoss, reliability, glmProb,
    gammaln, expectedFouls, nbTailProb, cardProbFromFouls, recencyWeight,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLDCore;
  global.PLDCore = PLDCore;
})(typeof window !== 'undefined' ? window : globalThis);

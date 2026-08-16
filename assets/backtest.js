/* The backtest. Does the adjustment stack actually beat doing nothing?
 *
 * WHAT IS BEING TESTED. The desk prices a booking by taking a base card rate
 * and multiplying it by three things: a VENUE split, a REFEREE factor and an
 * OPPONENT fouls-drawn context. Those three multipliers are the claim. This
 * walks the 2025/26 season forwards, one match at a time, and asks whether a
 * model carrying them predicts better than one that does not.
 *
 * WHAT IS *NOT* BEING TESTED, and why. The desk's model is per-player:
 * P(this player is booked in this fixture). Scoring that needs per-player,
 * per-match booking outcomes for a completed season, and there is no such feed
 * this project is allowed to use — the FPL element-summary endpoint carries
 * the current season only (pre-season, so nothing), and every archive that has
 * it is on the forbidden list. So the test runs at TEAM level, on the match
 * record we can licence: "does this side pick up two or more yellows".
 *
 * That is a real market and it is the same multiplier stack — but it is not
 * the per-player leg, and a win here is not evidence the per-player rates are
 * any good. Said in the app, not buried here.
 *
 * WALK-FORWARD, NOT IN-SAMPLE. Every rate a prediction uses is computed from
 * matches strictly BEFORE the one being predicted. Nothing about a match is
 * available to its own forecast. Fitting on the whole season and scoring on
 * the whole season would flatter both models and the model with more knobs
 * most of all, which is precisely the error this is here to avoid.
 *
 * DEPENDENCIES. simple-statistics (MIT) for the summary statistics and the
 * decile bucketing; jStat (MIT) for the Poisson tail. Both are vendored into
 * index.html. Injectable so this file can be exercised from node.
 */
(function (root) {
  'use strict';

  /* The league pivot. A referee with fewer than MIN_REF_MATCHES matches on the
     record is not evidence, he is noise — three strict games is a coincidence
     — so he is priced at the division's own rate rather than his. 3.71 yellows
     a match is the pivot the desk uses everywhere. */
  var PIVOT_YPM = 3.71;
  var MIN_REF_MATCHES = 10;

  /* Clamps. A single official may not swamp the model (the desk's own
     ±0.75-1.30) and a context signal built from a couple of dozen matches gets
     a tighter one still. */
  var REF_LO = 0.75, REF_HI = 1.30;
  var OPP_LO = 0.88, OPP_HI = 1.14;

  /* Shrinkage half-weights, in matches. A side with SHRINK_TEAM matches on the
     board carries half its own rate and half the league's. */
  var SHRINK_TEAM = 6;
  var SHRINK_VENUE = 5;
  var SHRINK_OPP = 6;

  /* Warm-up. Nothing is scored until there is something to compute a rate
     from — otherwise the first rounds test the prior, not the model. */
  var WARM_TEAM = 6;        // prior matches for the side being predicted
  var WARM_VENUE = 2;       // of which, at this venue
  var WARM_LEAGUE = 100;    // prior team-matches league-wide

  /* The event. Two or more yellows for one side in one match: a market that
     exists, a base rate near enough a coin flip to be worth predicting, and
     the direct team-level aggregate of the per-player card model.

     It is the HEADLINE threshold, and it was chosen before the numbers were
     seen. The app runs 1, 2 and 3 and shows all three, because a single
     threshold is exactly the knob you would turn to make a model look good,
     and the only defence against that suspicion is to publish the other
     settings alongside it. */
  var THRESHOLD = 2;
  var THRESHOLDS = [1, 2, 3];

  function num(x) { return typeof x === 'number' && isFinite(x) ? x : null; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  /* Shrink an observed rate toward a prior by sample size. */
  function shrink(sum, n, prior, k) {
    if (!(n > 0)) return prior;
    return (sum + k * prior) / (n + k);
  }

  /* P(at least `t` events) for a Poisson with mean `lam`, through jStat's
     cdf. Guarded to a real probability: jStat returns NaN on a negative mean
     and 1 on an enormous one, and an NaN here would poison every summary
     statistic downstream without throwing. */
  function pAtLeast(jStat, lam, t) {
    var l = num(lam);
    if (l == null || l < 0) return null;
    if (!(jStat && jStat.poisson && typeof jStat.poisson.cdf === 'function')) return null;
    var below = jStat.poisson.cdf(t - 1, l);
    if (!isFinite(below)) return null;
    return clamp(1 - below, 1e-6, 1 - 1e-6);
  }

  /* ---- the running state: everything known BEFORE the current match ---- */
  function newState() {
    return {
      team: Object.create(null),   // name -> counters
      ref: Object.create(null),    // name -> {m, y}
      league: { teamMatches: 0, yellows: 0, fouls: 0, homeY: 0, awayY: 0, matches: 0 }
    };
  }
  function teamOf(state, name) {
    var t = state.team[name];
    if (!t) {
      t = state.team[name] = {
        matches: 0, yellows: 0,
        home: { m: 0, y: 0 }, away: { m: 0, y: 0 },
        foulsDrawn: 0            // fouls the OPPOSITION committed against them
      };
    }
    return t;
  }
  function observe(state, m) {
    var h = teamOf(state, m.h), a = teamOf(state, m.a);
    h.matches++; h.yellows += m.hy; h.home.m++; h.home.y += m.hy; h.foulsDrawn += m.af;
    a.matches++; a.yellows += m.ay; a.away.m++; a.away.y += m.ay; a.foulsDrawn += m.hf;
    if (m.ref) {
      var r = state.ref[m.ref] || (state.ref[m.ref] = { m: 0, y: 0 });
      r.m++; r.y += m.hy + m.ay;
    }
    var L = state.league;
    L.matches++; L.teamMatches += 2;
    L.yellows += m.hy + m.ay; L.homeY += m.hy; L.awayY += m.ay;
    L.fouls += m.hf + m.af;
  }

  /* ---- the two forecasts ------------------------------------------------ */

  /* The naive baseline: the season-average card rate so far, and nothing else.
     Every side in every match gets the same number. This is the thing to
     beat, and it is a harder opponent than it looks — a Poisson on the league
     mean is already well calibrated on average, and only loses where it
     cannot discriminate. */
  function baselineLambda(state) {
    var L = state.league;
    if (!(L.teamMatches > 0)) return null;
    return L.yellows / L.teamMatches;
  }

  /* The model: base rate, venue split, referee, opponent fouls drawn.
     Returns the working as well as the number — the same object the app's
     "why" expander reads, so what is shown is what was scored. */
  function modelLambda(state, name, oppName, isHome, refName) {
    var L = state.league;
    if (!(L.teamMatches > 0)) return null;
    var leagueMean = L.yellows / L.teamMatches;
    var t = state.team[name];
    if (!t) return null;

    /* 1. The side's own rate, shrunk toward the league's. */
    var teamRate = shrink(t.yellows, t.matches, leagueMean, SHRINK_TEAM);

    /* 2. Venue. The league's own home/away split scales the side's rate, and
          the side's own record at this venue is shrunk toward that. A team
          with two home games on the board barely moves off the league split;
          one with fifteen mostly carries its own. */
    var leagueVenueMean = (isHome ? L.homeY : L.awayY) / L.matches;
    var venueRatio = leagueMean > 0 ? leagueVenueMean / leagueMean : 1;
    var v = isHome ? t.home : t.away;
    var venueRate = shrink(v.y, v.m, teamRate * venueRatio, SHRINK_VENUE);

    /* 3. Referee. Only officials with a real record price differently; the
          rest are priced at the league pivot, which is very nearly neutral by
          construction and is meant to be. */
    var leagueYpm = L.yellows / L.matches;
    var r = refName ? state.ref[refName] : null;
    var refKnown = !!(r && r.m >= MIN_REF_MATCHES);
    var refYpm = refKnown ? r.y / r.m : PIVOT_YPM;
    var refFactor = leagueYpm > 0 ? clamp(refYpm / leagueYpm, REF_LO, REF_HI) : 1;

    /* 4. Opponent context. A side that draws a lot of fouls makes its
          opponents concede a lot of them, and fouls are what referees book.
          Fouls drawn per match against the league's fouls per team-match. */
    var o = state.team[oppName];
    var leagueFouls = L.fouls / L.teamMatches;
    var oppDrawn = o ? shrink(o.foulsDrawn, o.matches, leagueFouls, SHRINK_OPP) : leagueFouls;
    var oppFactor = leagueFouls > 0 ? clamp(oppDrawn / leagueFouls, OPP_LO, OPP_HI) : 1;

    var lam = venueRate * refFactor * oppFactor;
    return {
      lambda: lam,
      working: {
        leagueMean: leagueMean,
        teamRate: teamRate,
        venue: isHome ? 'home' : 'away',
        venueRatio: venueRatio,
        venueRate: venueRate,
        ref: refName || null,
        refMatches: r ? r.m : 0,
        refKnown: refKnown,
        refYpm: refYpm,
        leagueYpm: leagueYpm,
        refFactor: refFactor,
        oppDrawn: oppDrawn,
        leagueFouls: leagueFouls,
        oppFactor: oppFactor
      }
    };
  }

  /* ---- scoring ---------------------------------------------------------- */

  /* Brier. Written out rather than taken from a library so the definition on
     screen is the definition that ran; simple-statistics supplies the mean. */
  function brier(ss, preds, actual) {
    if (!preds.length) return null;
    return ss.mean(preds.map(function (p, i) {
      var e = p - actual[i];
      return e * e;
    }));
  }
  function logLoss(ss, preds, actual) {
    if (!preds.length) return null;
    return ss.mean(preds.map(function (p, i) {
      var q = Math.min(1 - 1e-9, Math.max(1e-9, p));
      return -(actual[i] * Math.log(q) + (1 - actual[i]) * Math.log(1 - q));
    }));
  }

  /* Calibration by decile. Bins on the PREDICTED probability: ten equal-count
     buckets by rank, because equal-width bins on a model whose predictions
     cluster in a narrow band put nine-tenths of the rows in one box and report
     a flat line for both models.

     A constant-prediction model (the baseline is exactly that, within a round)
     cannot be split into ten distinct bins at all. It gets one row per
     distinct value, honestly labelled, rather than ten copies of the same
     number dressed up as a calibration curve. */
  function deciles(ss, preds, actual, bins) {
    var n = preds.length;
    if (!n) return [];
    var k = bins || 10;
    var idx = preds.map(function (p, i) { return i; })
      .sort(function (x, y) { return preds[x] - preds[y]; });
    var distinct = new Set(preds.map(function (p) { return p.toFixed(6); })).size;
    if (distinct < k) k = Math.max(1, distinct);
    var out = [];
    for (var b = 0; b < k; b++) {
      var lo = Math.floor((b * n) / k), hi = Math.floor(((b + 1) * n) / k);
      if (hi <= lo) continue;
      var slice = idx.slice(lo, hi);
      var p = slice.map(function (i) { return preds[i]; });
      var y = slice.map(function (i) { return actual[i]; });
      out.push({
        bin: out.length + 1,
        n: slice.length,
        lo: ss.min(p), hi: ss.max(p),
        predicted: ss.mean(p),
        observed: ss.mean(y),
        hits: y.reduce(function (s, v) { return s + v; }, 0)
      });
    }
    return out;
  }

  /* The paired comparison, which is the only honest way to say one model beat
     another. Per row, d_i = (model error)^2 - (baseline error)^2; the mean of
     d is the Brier difference and its standard error says whether the
     difference is distinguishable from nothing. A season is 700-odd rows, and
     over 700 rows a Brier gap of 0.002 is not a result. */
  function pairedDiff(ss, aPreds, bPreds, actual) {
    var d = aPreds.map(function (p, i) {
      var ea = p - actual[i], eb = bPreds[i] - actual[i];
      return ea * ea - eb * eb;
    });
    var mean = ss.mean(d);
    var se = d.length > 1 ? ss.standardDeviation(d) / Math.sqrt(d.length) : null;
    return { mean: mean, se: se, n: d.length, lo: se == null ? null : mean - 1.96 * se, hi: se == null ? null : mean + 1.96 * se };
  }

  /* ---- the run ---------------------------------------------------------- */
  function run(opts) {
    var o = opts || {};
    var ss = o.ss || root.ss;
    var jStat = o.jStat || root.jStat;
    var data = o.data || root.PL_BACKTEST_2526;
    if (!ss || !jStat || !data || !Array.isArray(data.matches)) return null;
    var threshold = o.threshold == null ? THRESHOLD : o.threshold;

    var matches = data.matches.slice().sort(function (x, y) {
      return x.d < y.d ? -1 : x.d > y.d ? 1 : 0;
    });
    var state = newState();
    var rows = [];
    var skipped = 0;

    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var sides = [
        { name: m.h, opp: m.a, isHome: true, y: m.hy },
        { name: m.a, opp: m.h, isHome: false, y: m.ay }
      ];
      for (var s = 0; s < sides.length; s++) {
        var side = sides[s];
        var t = state.team[side.name];
        var v = t ? (side.isHome ? t.home : t.away) : null;
        var warm = t && t.matches >= WARM_TEAM && v && v.m >= WARM_VENUE
          && state.league.teamMatches >= WARM_LEAGUE;
        if (!warm) { skipped++; continue; }
        var mod = modelLambda(state, side.name, side.opp, side.isHome, m.ref);
        var base = baselineLambda(state);
        var pm = pAtLeast(jStat, mod && mod.lambda, threshold);
        var pb = pAtLeast(jStat, base, threshold);
        if (pm == null || pb == null) { skipped++; continue; }
        rows.push({
          date: m.d,
          team: side.name,
          opponent: side.opp,
          venue: side.isHome ? 'H' : 'A',
          ref: m.ref || null,
          yellows: side.y,
          actual: side.y >= threshold ? 1 : 0,
          model: pm,
          baseline: pb,
          lambda: mod.lambda,
          baseLambda: base,
          working: mod.working
        });
      }
      observe(state, m);
    }

    if (!rows.length) return null;
    var actual = rows.map(function (r) { return r.actual; });
    var mp = rows.map(function (r) { return r.model; });
    var bp = rows.map(function (r) { return r.baseline; });

    var mB = brier(ss, mp, actual), bB = brier(ss, bp, actual);
    var diff = pairedDiff(ss, mp, bp, actual);

    /* The verdict, stated once, here, so every surface says the same thing.
       "Beats" requires the interval to clear zero — a point estimate on the
       right side of nothing is not a finding. */
    var verdict;
    if (diff.lo != null && diff.hi < 0) verdict = 'model-better';
    else if (diff.lo != null && diff.lo > 0) verdict = 'model-worse';
    else verdict = 'indistinguishable';

    return {
      season: data.season,
      source: data.source,
      sourceUrl: data.sourceUrl,
      licence: data.licence,
      threshold: threshold,
      event: 'A side picks up ' + threshold + ' or more yellow cards in a match',
      level: 'team-match',
      n: rows.length,
      matches: matches.length,
      skipped: skipped,
      baseRate: ss.mean(actual),
      model: {
        brier: mB,
        logLoss: logLoss(ss, mp, actual),
        mean: ss.mean(mp),
        calibration: deciles(ss, mp, actual)
      },
      baseline: {
        brier: bB,
        logLoss: logLoss(ss, bp, actual),
        mean: ss.mean(bp),
        calibration: deciles(ss, bp, actual)
      },
      diff: diff,
      verdict: verdict,
      rows: rows,
      constants: {
        pivotYpm: PIVOT_YPM,
        minRefMatches: MIN_REF_MATCHES,
        threshold: threshold,
        warmTeam: WARM_TEAM,
        warmVenue: WARM_VENUE,
        warmLeague: WARM_LEAGUE
      }
    };
  }

  var PLBacktest = {
    run: run,
    modelLambda: modelLambda,
    baselineLambda: baselineLambda,
    pAtLeast: pAtLeast,
    brier: brier,
    logLoss: logLoss,
    deciles: deciles,
    pairedDiff: pairedDiff,
    shrink: shrink,
    newState: newState,
    observe: observe,
    PIVOT_YPM: PIVOT_YPM,
    MIN_REF_MATCHES: MIN_REF_MATCHES,
    THRESHOLD: THRESHOLD
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLBacktest;
  root.PLBacktest = PLBacktest;
})(typeof window !== 'undefined' ? window : globalThis);

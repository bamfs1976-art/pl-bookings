/* The Premier League fixture model, shared between the desk and /today.
 *
 * WHY THIS EXISTS. index.html prices a fixture through a dozen small wrappers
 * — shrunkY90, pModelBase, refFactor, fixtureProb, teamCardBoard — every one
 * of which is a thin call into PLDCore over data that is already committed
 * (data/model.js, data/sim_model.js, data/pl_data.js). /today needs exactly
 * those numbers for the combined view, and there are only two ways to get
 * them: copy the wrappers, or share them.
 *
 * Copying was not an option. The whole point of the combined view is that a
 * fixture carries ONE price; two implementations of the wiring would drift and
 * the same match would read differently on two pages of the same site, with
 * nothing to catch it. So the wrappers live here and both pages call them.
 *
 * WHAT IS NOT HERE: anything that needs the live FPL feed. The desk refines
 * these numbers once the feed loads — a player's live card count replaces his
 * season one, and the injured and suspended drop out of the candidate list.
 * Every function below takes the live-aware value when a player carries one
 * and the committed value when he does not, which is precisely what the desk
 * does before its feed arrives.
 */
(function (root) {
  'use strict';
  var C = root.PLDCore;

  /* The recognised rivalries among the twenty. A derby runs hotter with the
     referee, and this list is DATA rather than a model output — it lived in
     index.html, and moving it here is what stops the two pages disagreeing
     about which fixtures are derbies. */
  var DERBIES = [
    ['ARS', 'TOT'],   // North London
    ['LIV', 'EVE'],   // Merseyside
    ['LIV', 'MUN'],   // North-West
    ['MUN', 'MCI'],   // Manchester
    ['MUN', 'LEE'],   // Roses
    ['CHE', 'TOT'],
    ['CHE', 'ARS'],
    ['CHE', 'FUL'],   // West London
    ['CRY', 'BHA'],   // M23
    ['NEW', 'SUN'],   // Tyne-Wear
    ['AVL', 'COV'],   // West Midlands
    ['LEE', 'HUL'],   // Yorkshire
  ];
  var DERBY_SET = new Set(DERBIES.map(function (d) {
    return d.slice().sort().join('|');
  }));
  var DERBY_BOOST = 1.15;

  function create(opts) {
    var MODEL = opts.model || null;
    var SIM = opts.sim || null;
    var REFS = opts.refs || [];
    var PLAYERS = opts.players || [];
    var CALIB = opts.calib || (C && C.calibrate ? C.calibrate(PLAYERS) : null);

    /* Only use the v2 model when BOTH the parameters and the v2 pure
       functions are present — the same guard the desk applies, so the two
       cannot fall back at different moments. */
    var MODEL_OK = !!(MODEL && C && typeof C.shrinkRate === 'function'
      && typeof C.glmProb === 'function' && typeof C.contextProb === 'function');
    var SIM_OK = !!(SIM && SIM.teams && C && typeof C.simFixture === 'function');

    var avgYpg = (function () {
      var v = REFS.map(function (r) { return r.ypg; }).filter(function (x) { return x != null; });
      return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : 3.7;
    })();
    var avgCpf = (function () {
      var v = REFS.map(function (r) { return r.cpf; })
        .filter(function (x) { return typeof x === 'number' && x > 0; });
      return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
    })();

    function mpick(o, k, fb) { return o && o[k] != null ? o[k] : fb; }
    /* Live-aware where a player carries live figures, committed otherwise. */
    function effMin(p) { return (p.liveRate && p.live) ? p.live.min : (p.min || 0); }
    function effYc(p) { return (p.liveRate && p.live) ? p.live.yc : (p.yc || 0); }
    function yEff(p) { return p.yLive != null ? p.yLive : p.y; }
    function rEff(p) { return p.rLive != null ? p.rLive : p.r; }

    function shrunkY90(p) {
      if (!MODEL_OK) return yEff(p);
      var S = MODEL.shrink;
      return C.shrinkRate(effYc(p), effMin(p), mpick(S.ycMean, p.p, S.ycLeague),
                          S.strengthMatches);
    }
    function shrunkF90(p) {
      if (p.f == null) return null;
      if (!MODEL_OK) return p.f;
      var S = MODEL.shrink;
      return C.shrinkRate(p.f * ((p.min || 0) / 90), (p.min || 0),
                          mpick(S.foulMean, p.p, S.foulLeague), S.strengthMatches);
    }
    /* The season base probability — now the SAME function all three desks
       use (PLDCore.pCardSeason), where this used to be the logistic over
       yellows, fouls and position.
     *
     * The change was measured, not assumed. Over the shipped squads the GLM
     * averaged 20.2% against an observed 17.4% cards per 90 and topped out at
     * 62%; the hazard averages 16.0%, which is exactly 1 - exp(-0.174), and
     * tops out at 40%. Running the GLM over CHAMPIONSHIP data produced the
     * same 70% top end, which is what proved the gap between the desks was
     * the model rather than the league.
     *
     * The fouls signal is not lost — it still drives the risk score, which is
     * what the desk ranks by. It is no longer allowed to set the price, for
     * the same reason it was taken off the Championship's a year ago: a
     * foul-heavy player and a booked player are different things. */
    function pModelBase(p) {
      var y = shrunkY90(p);
      if (y == null || !isFinite(y)) return C.impliedProb(rEff(p), CALIB);
      return C.pCardSeason(y);
    }

    function refFactor(ref) {
      if (!ref || ref.ypg == null) return 1;
      if (typeof C.refCardFactor === 'function') {
        return C.refCardFactor(ref, { avgYpg: avgYpg, avgCpf: avgCpf });
      }
      return Math.min(1.3, Math.max(0.75, ref.ypg / avgYpg));
    }

    function isDerby(h, a) { return DERBY_SET.has([h, a].sort().join('|')); }

    var simCache = new Map();
    function simFor(h, a) {
      if (!SIM_OK || !h || !a) return null;
      var k = h + '|' + a;
      if (simCache.has(k)) return simCache.get(k);
      var v = null;
      try { v = C.simFixture(h, a, SIM); } catch (e) { v = null; }
      simCache.set(k, v);
      return v;
    }
    function chaseFor(sim, isHome) {
      if (!sim || typeof C.chaseFactor !== 'function'
          || typeof C.simResultShare !== 'function') return null;
      var share = C.simResultShare(sim, isHome);
      if (share == null) return null;
      return C.chaseFactor(share);
    }

    function fixtureProb(p, ref, derby, isHome, sim) {
      var base = pModelBase(p);
      if (base == null) return null;
      var rf = ref ? refFactor(ref) : 1;
      var df = derby ? 1.08 : 1;
      var vf = (typeof C.venueFactor === 'function') ? C.venueFactor(isHome) : 1;
      var cf = chaseFor(sim, isHome);
      if (MODEL_OK && typeof C.contextProb === 'function') {
        return C.contextProb(base, rf, df, vf, cf);
      }
      return Math.min(0.95, Math.max(0.005, base * rf * df * vf * (cf == null ? 1 : cf)));
    }

    /* Every rated, available player on either side, hottest first. The
       availability filter only bites when a player carries live status; with
       no feed nobody is excluded, which is the desk's own pre-season state. */
    function candidates(h, a, ref, derby, sim) {
      var s = sim === undefined ? simFor(h, a) : sim;
      return PLAYERS
        .filter(function (p) {
          return (p.c === h || p.c === a) && rEff(p) != null && pModelBase(p) != null
            && !p.ls && !(p.live && 'isu'.indexOf(p.live.st) >= 0);
        })
        .map(function (p) {
          return { p: p, prob: fixtureProb(p, ref, derby, p.c === h, s) };
        })
        .filter(function (c) { return c.prob != null; })
        .sort(function (x, y) { return y.prob - x.prob; });
    }

    /* The team-card board. Each candidate's probability assumes a full 90, so
       it is scaled by the share of his side's minutes he actually takes —
       otherwise a 25-man squad prices a match with 50 players on the pitch.

       `lines` is optional and defaults to the three every desk prints, so no
       existing caller's board changes by a digit. today.html passes [2.5] for
       the week's card nine-fold — a market no desk shows and the acca needs.
       A PARAMETER, not a second board builder: the minute-weighting above is
       the thing that must not exist twice, and it is the reason this function
       is shared by the desk and the cross-league page at all.

       `roles` is optional and is `{home: map, away: map}` from
       PLDCore.lineupRoles — a confirmed team sheet, when one has been
       harvested. Omitted or null, every number below is the one this function
       has always returned; that is the ordinary state, since sheets publish
       about an hour before kick-off. BOTH SIDES OR NEITHER: the match total is
       the sum of two halves, and pricing one off a real XI and the other off
       last season's minutes would make them answer different questions. */
    function board(h, a, ref, derby, sim, lines, roles) {
      var cands = candidates(h, a, ref, derby, sim);
      if (!cands.length) return null;
      var rh = roles && roles.home, ra = roles && roles.away;
      if (!rh || !ra) { rh = null; ra = null; }
      var side = function (c, r) {
        var s = cands.filter(function (x) { return x.p.c === c; });
        /* THE ONLY BRANCH, and both arms end in the same clamp — without roles
           this is the identical call it always was. */
        return r
          ? C.lambdasFromWeights(s.map(function (x) { return x.prob; }),
              C.xiWeights(s.map(function (x) { return r[x.p.n] || null; })))
          : C.matchLambdas(s.map(function (x) { return x.prob; }),
                           s.map(function (x) { return x.p.min; }));
      };
      var b = C.teamCardMarkets(side(h, rh), side(a, ra), lines || [3.5, 4.5, 5.5]);
      b.thin = cands.length < 12;
      b.xi = !!(rh && ra);
      return b;
    }

    return {
      MODEL_OK: MODEL_OK, SIM_OK: SIM_OK,
      avgYpg: avgYpg, avgCpf: avgCpf, calib: CALIB,
      mpick: mpick, effMin: effMin, effYc: effYc, yEff: yEff, rEff: rEff,
      shrunkY90: shrunkY90, shrunkF90: shrunkF90, pModelBase: pModelBase,
      refFactor: refFactor, isDerby: isDerby, simFor: simFor, chaseFor: chaseFor,
      fixtureProb: fixtureProb, candidates: candidates, board: board
    };
  }

  root.PLModel = { create: create, DERBIES: DERBIES, DERBY_BOOST: DERBY_BOOST };
})(typeof globalThis !== 'undefined' ? globalThis : this);

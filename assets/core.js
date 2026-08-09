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

  /* ---- the market side of the value chart ----
     A decimal price turned back into the probability it implies. This is the
     RAW implied chance and it is deliberately not called "the market's view",
     because it is not: it includes the bookmaker's margin, so it is biased
     high. A 2.50 shot reads as 40% when the bookmaker's own opinion might be
     37% with 3 points of margin on top.

     THE MARGIN CANNOT BE REMOVED FROM ONE PRICE. De-vigging needs every
     outcome in the market — for "player booked" that means the unbooked side
     too, which no one publishes. Anything else is a guess with a formula
     wrapped round it, so this returns the raw number and the caller is
     expected to show the margin as a band rather than pretend it away. */
  function marketProb(bookOdds) {
    const o = Number(bookOdds);
    if (!isFinite(o) || o <= 1) return null;
    return 1 / o;
  }

  /* The same price with an ASSUMED margin stripped out, for drawing the
     "this is still inside the bookmaker's cut" band. `margin` is the
     overround as a fraction (0.06 = 6%). Explicitly an assumption: it is a
     band on the chart, never a number quoted at a player. */
  const TYPICAL_CARD_MARGIN = 0.06;
  function marketProbDeVig(bookOdds, margin) {
    const raw = marketProb(bookOdds);
    if (raw == null) return null;
    const m = margin == null ? TYPICAL_CARD_MARGIN : Number(margin);
    if (!isFinite(m) || m < 0 || m >= 1) return raw;
    return raw * (1 - m);
  }

  /* One row of the value chart, and the two thresholds are not the same
     thing — which is the distinction the chart exists to draw.

     To be +EV you must beat the RAW implied probability: stake × odds pays
     only if prob × odds > 1, i.e. prob > 1/odds. The margin makes that bar
     HARDER, not easier, because it inflates the implied number you have to
     clear.

     The de-vigged line sits BELOW the raw one and is the bookmaker's own
     opinion. A model landing between the two disagrees with him — it thinks
     the event likelier than he does — and still loses money, because the
     disagreement is smaller than his cut. That band is where a naive "our
     number is higher than his" read manufactures value out of the vig, and
     it is drawn on the chart for exactly that reason. */
  function valuePoint(prob, bookOdds, margin) {
    const market = marketProb(bookOdds);
    if (prob == null || market == null) return null;
    const fair = marketProbDeVig(bookOdds, margin);
    return {
      model: prob,
      market,
      fair,
      edge: edgePct(bookOdds, prob),
      /* The only one of these worth acting on. */
      beatsPrice: prob > market,
      /* Beats the bookmaker's opinion but not his margin: a disagreement
         that does not pay. */
      insideMargin: prob > fair && prob <= market
    };
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
  /* Chains the fixture's odds-factors and clamps. `chaseFactorV` is
     optional and defaults to neutral, so a caller that predates the
     simulator wiring — or a service worker serving a stale index.html —
     gets exactly the old three-factor answer. */
  function contextProb(baseP, refFactor, derbyFactor, venueFactorV, chaseFactorV) {
    if (baseP == null) return null;
    let p = scaleOdds(baseP, refFactor == null ? 1 : refFactor);
    p = scaleOdds(p, derbyFactor == null ? 1 : derbyFactor);
    p = scaleOdds(p, venueFactorV == null ? 1 : venueFactorV);
    p = scaleOdds(p, chaseFactorV == null ? 1 : chaseFactorV);
    return Math.min(0.95, Math.max(0.005, p));
  }

  /* ---- venue ----
     Away sides collect more cards than home sides, consistently and across
     every season in the record. The desk already applies this at fixture
     level through the home/away cards-against split; these are the
     per-player equivalents, taken from the forecast branch's model.py. */
  const HOME_FACTOR = 0.95, AWAY_FACTOR = 1.08;
  function venueFactor(isHome) {
    if (isHome == null) return 1;
    return isHome ? HOME_FACTOR : AWAY_FACTOR;
  }

  /* ---- game state (chase) ----
     A side being outplayed chases the game and fouls tactically; a
     comfortable favourite does not. Fed by the match model below, which
     vendors Plsimulator's fitted ratings.

     The argument is the player's OWN side's expected result share
     (simResultShare: P(win) + P(draw)/2), not its raw win probability —
     see the note there, it is the difference between redistributing risk
     across a mismatch and inflating it league-wide. So an underdog prices
     up and a heavy favourite prices down. Neutral at 1.0 when nothing is
     supplied, so an unrated fixture behaves exactly as it did before the
     wiring. Clamped hard — this is a nudge, not a re-rating. */
  const CHASE_SLOPE = 0.30, CHASE_MIN = 0.85, CHASE_MAX = 1.20;
  function chaseFactor(winProb) {
    /* Guard the value before coercing: Number(null) and Number('') are both
       0, which would read "no simulator input" as "certain to lose" and
       quietly mark up every unwired fixture. */
    if (winProb == null || winProb === '' || typeof winProb === 'boolean') return 1;
    const w = Number(winProb);
    if (!isFinite(w) || w < 0 || w > 1) return 1;
    return Math.min(CHASE_MAX, Math.max(CHASE_MIN, 1 + (0.5 - w) * CHASE_SLOPE));
  }

  /* ══════════════════════════════════════════════════════════════════
     THE MATCH MODEL — Plsimulator's fitted ratings, reproduced exactly.

     The desk models cards. It has never modelled the match those cards
     are shown in, so `chaseFactor` above sat inert: nothing could tell it
     who was likely to be chasing. Plsimulator fits that model weekly and
     publishes it as a bundle (`model.json`), which `data/sim_model.js`
     vendors in club-code form.

     What follows is the bundle's own arithmetic, ported function for
     function from `plsim/models.py` so the two products cannot drift:

       lambda_home = BASE_H x attack(home) x defence(away) x homeAdv(home)
       lambda_away = BASE_A x attack(away) x defence(home)

     then a Poisson product over the scoreline grid with the Dixon-Coles
     (1997) low-score correction, which lifts 0-0 and 1-1 and trims 1-0 and
     0-1 — the four scorelines independent Poisson is known to get wrong.
     Note the asymmetry is deliberate and matches the source: the home
     side's own home-advantage rating multiplies its rate, the away side
     has no equivalent term.

     Two numbers come out that the desk wants:
       - win probability per side, which is what `chaseFactor` consumes;
       - P(margin <= 1), the fitted closeness of the fixture.
     ══════════════════════════════════════════════════════════════════ */

  /* Per-team goal cap for the grid, matching the source model's MAX_GOALS.
     P(11+ goals for one side) is ~3e-4 at the highest rate the bundle
     produces and the residual is normalised across the grid below, which
     leaves the recovered mean a hair under the goal rate. Same cap, same
     normalisation, same tiny bias as Plsimulator — deliberately, so the
     two products agree to floating point. */
  const SIM_MAX_GOALS = 10;

  function simPositive(v) {
    const n = Number(v);
    return (isFinite(n) && n > 0) ? n : null;
  }

  /* Goal rates for one fixture. `home`/`away` are keys into model.teams —
     club short codes in the vendored bundle. Null when either side is
     unknown or its ratings are unusable, which is the honest answer: a
     promoted club the simulator has not rated yet must not be silently
     handed league-average strength. */
  function simLambdas(home, away, model) {
    if (!model || !model.teams) return null;
    const th = model.teams[home], ta = model.teams[away];
    if (!th || !ta) return null;
    const c = model.constants || {};
    const bh = simPositive(c.BASE_H), ba = simPositive(c.BASE_A);
    if (bh == null || ba == null) return null;
    const attH = simPositive(th.attack), defH = simPositive(th.defence);
    const attA = simPositive(ta.attack), defA = simPositive(ta.defence);
    if (attH == null || defH == null || attA == null || defA == null) return null;
    /* Per-club home advantage defaults to neutral, exactly as the source
       model does (`th.get("home", 1.0)`). */
    const advH = simPositive(th.home) == null ? 1 : simPositive(th.home);
    return { lh: bh * attH * defA * advH, la: ba * attA * defH };
  }

  /* Poisson pmf for 0..n, built by recurrence (p_k = p_{k-1} x lam / k) so
     no factorial table is needed and nothing overflows. */
  /* ---- suspension watch ------------------------------------------------
   *
   * P(a player collects at least `need` more cautions over `matches`), from a
   * per-90 yellow rate and the share of a match he is expected to play.
   * Cautions in a season behave close enough to Poisson for this: they are
   * rare, roughly independent between matches, and the alternative — a
   * binomial on P(carded) — throws away the fact that a player can be booked
   * only once per match anyway, which is the same thing to two decimals at
   * these rates.
   *
   * This exists because a suspension strip has to answer "how likely is a ban
   * in the next three matches", not "what is his card rate". The second is
   * not a substitute for the first: a defender on four cautions and a modest
   * rate is in far more danger than a wild midfielder on none.
   */
  function pCardsAtLeast(y90, expMin, matches, need) {
    /* Same rule as suspensionCycle: a null rate is unknown, not zero. Without
       this, a player with no card rate reads as "0% chance of a ban" — the
       most reassuring possible answer about someone nobody has measured. */
    if (y90 == null || expMin == null || matches == null || need == null) return null;
    const y = Number(y90), m = Number(expMin), k = Number(matches), n = Number(need);
    if (!isFinite(y) || y < 0 || !isFinite(m) || m <= 0) return null;
    if (!isFinite(k) || k <= 0 || !isFinite(n)) return null;
    if (n <= 0) return 1;                       // already there
    const lam = y * (m / 90) * k;
    if (!(lam > 0)) return 0;
    /* 1 - P(fewer than `need`), summed on the low side where the terms are
       largest, so the subtraction never loses the answer to rounding. */
    let term = Math.exp(-lam), below = term;
    for (let i = 1; i < n; i++) {
      term *= lam / i;
      below += term;
    }
    return Math.min(1, Math.max(0, 1 - below));
  }

  /* Where a player sits in his current cycle, and what he needs for a ban.
   * Spain: every five cautions is one match, the counter restarts, and the
   * next five carry the same penalty (RFEF art. 112 — see
   * docs/spain-suspensions.md). So the position in the cycle is the season
   * total modulo the threshold, NOT the total itself: a player on ten has
   * served two bans and is on zero again, not eight-tenths of the way to a
   * third. */
  /* The next ban a player is heading for, under whichever scheme his league
   * actually uses. ONE function, because the two schemes are easy to mix up
   * and the failure is silent both ways round: England's ladder applied to
   * Spain invents bans nobody serves, and Spain's cycle applied to England
   * forgives a player who has already used up his 5- and 10-rungs.
   *
   * scheme, from data/leagues.py and shipped in each dataset:
   *   {kind:'cycle',  at, ban}                    Spain — repeats, no gate
   *   {kind:'ladder', rungs:[{at,ban,by}], review} England — cumulative,
   *                                                escalating, gated by the
   *                                                club's match number
   *
   * `played` is how many league matches the player's CLUB has played, which
   * is what the English gates are measured in. It is ignored by a cycle.
   *
   * Returns {need, ban, at, by, dead} or null:
   *   need  cautions still required for the next ban
   *   ban   matches that ban costs
   *   at    the threshold it is counted to
   *   by    the club match it must be reached by, null if ungated
   *   dead  true when every rung is out of reach — the player cannot be
   *         suspended by accumulation again this season, which is a real
   *         state a watchlist must not hide by showing the last rung anyway
   */
  function nextSuspension(seasonCards, played, scheme) {
    if (seasonCards == null || !scheme) return null;
    const c = Number(seasonCards);
    if (!isFinite(c) || c < 0) return null;

    if (scheme.kind === 'cycle') {
      const cyc = suspensionCycle(c, scheme.at);
      if (!cyc) return null;
      return { need: cyc.need, ban: scheme.ban || 1, at: scheme.at,
               by: null, dead: false, inCycle: cyc.inCycle, served: cyc.served };
    }

    const rungs = (scheme.rungs || []).slice().sort((a, b) => a.at - b.at);
    const p = Number(played);
    for (const r of rungs) {
      if (c >= r.at) continue;                     // already passed this rung
      /* A gate is a DEADLINE on the club's match number. Once it is behind
         you the rung can no longer be reached however many cautions follow,
         so the watch has to move on to the next one rather than keep
         counting toward a ban that cannot happen. */
      if (r.by != null && isFinite(p) && p >= r.by) continue;
      return { need: r.at - c, ban: r.ban, at: r.at, by: r.by, dead: false,
               inCycle: c, served: rungs.filter((x) => c >= x.at).length };
    }
    return { need: null, ban: null, at: null, by: null, dead: true,
             inCycle: c, served: rungs.filter((x) => c >= x.at).length };
  }

  function suspensionCycle(seasonCards, threshold) {
    /* null and undefined are REJECTED, not coerced. Number(null) is 0, so
       without this an unknown card count becomes "on zero, needs five" —
       which is a confident claim about a player nobody has counted. The whole
       strip rests on "no data" and "no cards" being different answers, and
       this is where that distinction is either kept or quietly lost. */
    if (seasonCards == null || threshold == null) return null;
    const c = Number(seasonCards), t = Number(threshold);
    if (!isFinite(c) || c < 0 || !isFinite(t) || t <= 0) return null;
    const inCycle = Math.floor(c) % t;
    return { inCycle, need: t - inCycle, served: Math.floor(Math.floor(c) / t) };
  }

  function simPoissonPmf(lam, n) {
    const p = [Math.exp(-lam)];
    for (let k = 1; k <= n; k++) p[k] = p[k - 1] * lam / k;
    return p;
  }

  /* The Dixon-Coles correction, applied to the four low scorelines only.
     Returned normalised, so the grid is a proper distribution whatever the
     correction and the goal cap did to the total. */
  function simScoreGrid(lh, la, rho, maxGoals) {
    if (!(lh > 0) || !(la > 0)) return null;
    const n = (maxGoals == null || !(maxGoals >= 1)) ? SIM_MAX_GOALS : Math.floor(maxGoals);
    const G = n + 1;
    const ph = simPoissonPmf(lh, n), pa = simPoissonPmf(la, n);
    const grid = new Array(G * G);
    for (let h = 0; h < G; h++) {
      for (let a = 0; a < G; a++) grid[h * G + a] = ph[h] * pa[a];
    }
    const r = Number(rho);
    if (isFinite(r) && r !== 0) {
      /* Clamped at zero: at the fitted rho (~-0.09) no real goal rate can
         drive a tau negative, but a corrupt bundle should degrade to a
         zero cell rather than a negative probability. */
      const tau = (i, t) => { grid[i] = Math.max(0, grid[i] * t); };
      tau(0, 1 - lh * la * r);        // 0-0
      tau(1, 1 + lh * r);             // 0-1
      tau(G, 1 + la * r);             // 1-0
      tau(G + 1, 1 - r);              // 1-1
    }
    let total = 0;
    for (let i = 0; i < grid.length; i++) total += grid[i];
    if (!(total > 0)) return null;
    for (let i = 0; i < grid.length; i++) grid[i] /= total;
    return grid;
  }

  /* Fold a grid into the numbers the desk uses. `close` is P(margin <= 1)
     — a draw or a one-goal win either way. That is the fitted "tight
     match" signal: cards follow games that stay live, which is not the
     same set as the historic rivalries in the derby list. */
  function simOutcomes(grid, maxGoals) {
    if (!Array.isArray(grid) || !grid.length) return null;
    const n = (maxGoals == null || !(maxGoals >= 1)) ? SIM_MAX_GOALS : Math.floor(maxGoals);
    const G = n + 1;
    if (grid.length !== G * G) return null;
    let home = 0, draw = 0, away = 0, close = 0, expH = 0, expA = 0;
    for (let h = 0; h < G; h++) {
      for (let a = 0; a < G; a++) {
        const p = grid[h * G + a];
        if (h > a) home += p; else if (h === a) draw += p; else away += p;
        if (Math.abs(h - a) <= 1) close += p;
        expH += h * p; expA += a * p;
      }
    }
    return { home, draw, away, close, expH, expA };
  }

  /* A side's expected RESULT SHARE: P(win) + P(draw)/2.

     This, not the raw win probability, is what the game-state factor must
     be fed, and the reason is calibration rather than taste. `chaseFactor`
     is neutral at 0.5, but a win probability cannot average 0.5 across a
     three-way market — the draw takes roughly a quarter of the mass, so
     the average side's win probability is nearer 0.37. Feeding it raw
     marks up BOTH sides of an even fixture (measured: x1.013 and x1.068 on
     Arsenal-City), drifting every player's number upward by a few percent
     league-wide on no evidence at all, and pulling the model off the base
     rate the logistic is anchored to.

     Result share is the standard two-way reduction of a three-way market —
     the same W + D/2 that points-share and win-expectancy use. The two
     sides' shares sum to exactly 1, so their chase factors are mirror
     images about 1.0 and the league's expected card total is unchanged:
     the factor redistributes risk between the sides of a mismatch instead
     of inflating it everywhere. Null in, null out. */
  function simResultShare(sim, isHome) {
    if (!sim || isHome == null) return null;
    const w = Number(isHome ? sim.home : sim.away), d = Number(sim.draw);
    if (!isFinite(w) || !isFinite(d)) return null;
    return Math.min(1, Math.max(0, w + d / 2));
  }

  /* One call per fixture: ratings in, everything the desk needs out.
     Null when the fixture cannot be rated — callers treat that as "no
     simulator input" and every factor downstream stays neutral. */
  function simFixture(home, away, model, opts) {
    const lam = simLambdas(home, away, model);
    if (lam == null) return null;
    const n = (opts && opts.maxGoals) || SIM_MAX_GOALS;
    const rho = (model.constants || {}).DC_RHO;
    const grid = simScoreGrid(lam.lh, lam.la, rho, n);
    if (grid == null) return null;
    const o = simOutcomes(grid, n);
    if (o == null) return null;
    return {
      lh: lam.lh, la: lam.la,
      home: o.home, draw: o.draw, away: o.away,
      close: o.close, expH: o.expH, expA: o.expA,
    };
  }

  /* ---- hazard form of the card forecast ----
     lambda = yellows/90 x (expected minutes / 90) x every match factor,
     P(card) = 1 - exp(-lambda).

     This is the forecast branch's structure and it is the more defensible
     one: minutes enter explicitly rather than being buried in a season
     average, the factors compose multiplicatively on the rate rather than
     on an already-squashed probability, and the exponential cannot leave
     [0,1) however large lambda gets.

     It runs alongside the shipped logistic mapping rather than replacing
     it — swapping the number every row displays is a decision for a
     backtest, not a refactor. Surfaced as a cross-check today. */
  function cardLambda(y90, expMin, factors) {
    const y = Number(y90), m = Number(expMin);
    if (!isFinite(y) || y < 0 || !isFinite(m) || m <= 0) return null;
    const f = factors || {};
    const mul = [f.ref, f.venue, f.derby, f.opponent, f.chase]
      .reduce((acc, v) => acc * (isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 1), 1);
    return y * (m / 90) * mul;
  }
  /* THE season base probability, for every desk.
   *
   * P(booked at least once in a full match) from a per-90 yellow rate, via
   * the Poisson hazard: 1 - exp(-y90). One definition, because until this
   * existed the three desks had two, and the difference was visible the
   * moment they appeared on one page together.
   *
   * WHY NOT THE GLM. data/model.js also carries a logistic over (yellow rate,
   * foul rate, position), and the Premier League desk priced through it. Run
   * over the shipped squads it comes out at a mean of 20.2% against an
   * observed 17.4% cards per 90, with a top end of 62%; the hazard gives
   * 16.0% and 40%. Those are not close calls:
   *
   *   - 1 - exp(-0.174) IS 16.0%. The hazard reproduces the league's own
   *     rate by construction; the GLM is four points over.
   *   - The most-carded player in a division picks up about twelve yellows
   *     in thirty-eight matches. That is ~32%, not 62%.
   *   - The GLM's foul term (weight 1.1 per foul/90) dominates its top end,
   *     and a foul-heavy player is not the same as a booked player. That is
   *     the same finding that took the Championship desk off the foul-heavy
   *     risk score as a PRICE a year ago — it stayed a good RANKING, which
   *     is what the risk column still is.
   *
   * The GLM is not deleted: `basis` in data/model.js is still "season-prior",
   * meaning those coefficients were set rather than fitted. If the Tier 2
   * fitter ever accumulates enough real match rows to flip it to "match-fit",
   * a fitted logistic may well beat this — but it would have to be shown to
   * be calibrated first, which is what scripts/check-models.mjs now measures.
   */
  function pCardSeason(y90, factors) {
    return pCardFromLambda(cardLambda(y90, 90, factors));
  }

  function pCardFromLambda(lam) {
    const l = Number(lam);
    if (!isFinite(l) || l < 0) return null;
    /* Capped just below certainty. Past lambda ~37 the exponential
       underflows and 1 - exp(-l) rounds to exactly 1, which would hand the
       value layer a fair price of 1.00 and an infinite implied edge. No
       real player gets near it — lambda 7 is already 0.999 — so the cap
       only ever catches a bad input. */
    return Math.min(0.999, 1 - Math.exp(-l));
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
  /* Minutes-weighted league mean of a per-90 rate. The same weighting
     build-model.mjs uses, because a rate averaged over PLAYERS rather than
     over MINUTES is dominated by squad players with 90 minutes and a fluke. */
  function leagueRate90(players, key) {
    var sw = 0, sv = 0;
    (players || []).forEach(function (p) {
      var m = Number(p && p.min) || 0, v = p ? p[key] : null;
      if (m > 0 && v != null && isFinite(v)) { sw += m; sv += v * m; }
    });
    return sw > 0 ? sv / sw : null;
  }
  /* THE TWO-STAGE HAZARD, in one place.
   *
   * Cards per foul, anchored so a player on the league's average foul rate
   * comes out at the league's base card rate:
   *
   *     P(card) = 1 - exp(-fouls x hazard),  solved at the league average
   *     =>  hazard = -ln(1 - baseRate) / foulLeague
   *
   * This is NOT the raw cards-per-foul the referee table carries. On Premier
   * League data the referee tables average 0.174 and this anchoring gives
   * 0.196 — a 12% gap, because the referee figure counts every card in the
   * match against every foul in it, while this one is calibrated to the
   * per-player probability the desk actually prints.
   *
   * It lives here because build-model.mjs bakes it for the Premier League and
   * the other two desks have no model file and must derive it at runtime. Two
   * implementations of that line is how the three desks would go back to
   * pricing different things — which is what check-models.mjs exists to catch.
   */
  function twoStageHazard(baseRate, foulLeague) {
    if (!(baseRate > 0) || !(baseRate < 1) || !(foulLeague > 0)) return null;
    return -Math.log(1 - baseRate) / foulLeague;
  }
  /* A referee's card multiplier, from two signals rather than one.

     Yellows per game (ypg) is the obvious measure but it is contaminated: a
     referee shows more cards partly because the fixtures he draws are more
     foul-heavy. Cards per foul (cpf) divides that out and isolates how
     readily HE reaches for the card given the same provocation — and since
     the desk already models each club's foul and card propensity separately,
     leaning on ypg alone double-counts the teams.

     Both inputs are ratios against the league average, so they are combined
     as a weighted geometric mean (the natural average of ratios, neutral at
     1.0) and clamped. With cpf missing — an official with no fouls data yet —
     it degrades to the shipped ypg-only behaviour, so nothing regresses. */
  function refCardFactor(ref, league, opts) {
    const o = opts || {};
    const w = (o.cpfWeight == null) ? 0.5 : o.cpfWeight;
    const lo = (o.lo == null) ? 0.75 : o.lo, hi = (o.hi == null) ? 1.3 : o.hi;
    const L = league || {};
    const pos = (x) => (typeof x === 'number' && isFinite(x) && x > 0);
    const rY = (ref && pos(ref.ypg) && pos(L.avgYpg)) ? ref.ypg / L.avgYpg : null;
    const rC = (ref && pos(ref.cpf) && pos(L.avgCpf)) ? ref.cpf / L.avgCpf : null;
    let f;
    if (rY != null && rC != null) f = Math.pow(rY, 1 - w) * Math.pow(rC, w);
    else if (rY != null) f = rY;
    else if (rC != null) f = rC;
    else return 1;
    return Math.min(hi, Math.max(lo, f));
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

  /* ---- team card markets ----
     The desk prices individual players, but the liquid card markets are
     team-level: total cards over/under, and both teams to be carded. Both
     fall straight out of the per-player probabilities we already compute.

     Each player is one Bernoulli trial (booked or not) with his own p, so
     the number of cards in a match is Poisson-binomial. That has an exact
     distribution — no simulation needed — built by folding one player in at
     a time: after each player the array holds P(exactly k cards so far).
     n players cost O(n^2), which at ~30 rated players a side is nothing.

     The independence assumption is the honest limit: cards cluster (a
     flashpoint books two players at once), so the tails are slightly
     thinner than reality. Stated in the Guide rather than fudged. */
  /* Expected-minutes weights for a squad.
     A player's implied P(card) is P(booked | he plays 90). Summing that over
     a 25-man squad prices a match with 50 players on the pitch, which is how
     you end up quoting 9 expected cards instead of 4. Only 11 a side start,
     so each player's chance is weighted by the share of the team's minutes
     he actually takes: w_i = min_i / Σmin × 11, capped at 1.

     Normalising within the squad rather than dividing by a fixed season
     length keeps it honest for the promoted clubs, whose minutes come from a
     46-game Championship season, and for any partial harvest.

     This is the minutes-aware correction the forecast branch applies as
     `expected minutes / 90`, in the form the shipped data can support. */
  function minuteWeights(mins, xi) {
    const n = (xi == null) ? 11 : Number(xi);
    const list = (Array.isArray(mins) ? mins : []).map((m) => {
      const v = Number(m);
      return isFinite(v) && v > 0 ? v : 0;
    });
    const total = list.reduce((s, v) => s + v, 0);
    if (!(total > 0)) return list.map(() => 0);
    return list.map((v) => Math.min(1, (v / total) * n));
  }

  /* Per-player card chances for a side, scaled to expected minutes. */
  function matchLambdas(probs, mins, xi) {
    const w = minuteWeights(mins, xi);
    return (Array.isArray(probs) ? probs : []).map((p, i) => {
      const v = Number(p);
      return isFinite(v) && v > 0 ? Math.min(0.999, v) * (w[i] || 0) : 0;
    });
  }

  function cardCountDist(ps) {
    const list = (Array.isArray(ps) ? ps : [])
      .map(Number)
      .filter((p) => isFinite(p) && p > 0)
      .map((p) => Math.min(0.999, p));
    let dist = [1];
    for (const p of list) {
      const next = new Array(dist.length + 1).fill(0);
      for (let k = 0; k < dist.length; k++) {
        next[k] += dist[k] * (1 - p);
        next[k + 1] += dist[k] * p;
      }
      dist = next;
    }
    return dist;
  }

  /* P(total cards > line). Lines are the market's .5 values, so "over 4.5"
     means 5 or more; a whole number is treated as strictly greater. */
  function probOverCards(ps, line) {
    const dist = cardCountDist(ps);
    const need = Math.floor(Number(line) || 0) + 1;
    let acc = 0;
    for (let k = need; k < dist.length; k++) acc += dist[k];
    return Math.min(1, Math.max(0, acc));
  }

  function expectedCards(ps) {
    return (Array.isArray(ps) ? ps : [])
      .map(Number)
      .filter((p) => isFinite(p) && p > 0)
      .reduce((s, p) => s + Math.min(0.999, p), 0);
  }

  /* Both teams carded: neither side gets through clean. */
  function probBothCarded(homePs, awayPs) {
    const clean = (ps) => (Array.isArray(ps) ? ps : [])
      .map(Number)
      .filter((p) => isFinite(p) && p > 0)
      .reduce((acc, p) => acc * (1 - Math.min(0.999, p)), 1);
    return Math.min(1, Math.max(0, (1 - clean(homePs)) * (1 - clean(awayPs))));
  }

  /* ---- booking points ---------------------------------------------------
   * The market bookmakers actually price for cards is BOOKING POINTS, not a
   * card count: 10 a yellow, 25 a red. The desks priced only the count, so
   * the one line a punter is most likely to be shown was the one number the
   * app could not give.
   *
   * It needs no new data. The yellow side is the exact Poisson-binomial the
   * over/under lines already use. The red side is the referee's OWN red rate
   * — REFS carry `red`, reds per game, measured the same way as `ypg` — so a
   * fixture with an official appointed is priced by him, and one without by
   * the league average. That is the same rule the yellow side already
   * follows, rather than a second convention invented for reds.
   *
   * Reds are modelled as Poisson and truncated: at a realistic rate (0.0-0.8
   * a game) the tail past six is ~1e-8, but a bad feed could hand this a
   * nonsense rate, so the truncated mass is normalised back rather than
   * silently dropped. Without that, a corrupt λ would quietly return
   * probabilities that do not sum to one. */
  const YELLOW_POINTS = 10;
  const RED_POINTS = 25;
  const MAX_REDS = 6;

  function bookingPointsDist(ps, lambdaRed) {
    const yd = cardCountDist(ps);
    const lam = Math.max(0, Number(lambdaRed) || 0);
    const rd = [];
    let p = Math.exp(-lam);
    for (let r = 0; r <= MAX_REDS; r++) { rd.push(p); p = (p * lam) / (r + 1); }
    const mass = rd.reduce((s, v) => s + v, 0) || 1;
    for (let r = 0; r < rd.length; r++) rd[r] /= mass;

    const out = new Array(YELLOW_POINTS * (yd.length - 1) + RED_POINTS * MAX_REDS + 1).fill(0);
    for (let y = 0; y < yd.length; y++) {
      if (!yd[y]) continue;
      for (let r = 0; r <= MAX_REDS; r++) {
        out[YELLOW_POINTS * y + RED_POINTS * r] += yd[y] * rd[r];
      }
    }
    return out;
  }

  function expectedPoints(ps, lambdaRed) {
    return YELLOW_POINTS * expectedCards(ps) + RED_POINTS * Math.max(0, Number(lambdaRed) || 0);
  }

  /* P(points > line). Same convention as probOverCards: a .5 line means the
     next whole number up. Points come in steps of 5, so "over 35.5" is 40 or
     more from yellows alone, or 35 with a red — the granularity is real and
     the line should be read against it rather than as a smooth quantity. */
  function probOverPoints(ps, lambdaRed, line) {
    const d = bookingPointsDist(ps, lambdaRed);
    const need = Math.floor(Number(line) || 0) + 1;
    let acc = 0;
    for (let k = need; k < d.length; k++) acc += d[k];
    return Math.min(1, Math.max(0, acc));
  }

  /* The league's red rate, weighted by matches refereed. Used when no
     official is appointed. Weighted, because an unweighted mean lets a
     referee with three games swing the league rate as hard as one with
     thirty — which is the same reason ypg is shrunk elsewhere. */
  function leagueRedRate(refs) {
    let n = 0, m = 0;
    for (const r of (Array.isArray(refs) ? refs : [])) {
      const g = Number(r && r.matches), v = Number(r && r.red);
      if (isFinite(g) && g > 0 && isFinite(v) && v >= 0) { n += v * g; m += g; }
    }
    return m > 0 ? n / m : 0;
  }

  function bookingPointsMarkets(homePs, awayPs, lambdaRed, lines) {
    const all = [].concat(homePs || [], awayPs || []);
    const ls = (Array.isArray(lines) && lines.length) ? lines : [35.5, 45.5, 55.5];
    const over = {};
    for (const l of ls) over[l] = probOverPoints(all, lambdaRed, l);
    return {
      expected: Math.round(expectedPoints(all, lambdaRed) * 10) / 10,
      lambdaRed: Math.round(Math.max(0, Number(lambdaRed) || 0) * 100) / 100,
      over,
    };
  }

  /* One call for a fixture: the whole team-card board. */
  function teamCardMarkets(homePs, awayPs, lines) {
    const all = [].concat(homePs || [], awayPs || []);
    const ls = (Array.isArray(lines) && lines.length) ? lines : [3.5, 4.5, 5.5];
    const over = {};
    for (const l of ls) over[l] = probOverCards(all, l);
    return {
      expected: Math.round(expectedCards(all) * 100) / 100,
      expectedHome: Math.round(expectedCards(homePs) * 100) / 100,
      expectedAway: Math.round(expectedCards(awayPs) * 100) / 100,
      over,
      bothCarded: probBothCarded(homePs, awayPs),
    };
  }

  const PLDCore = {
    riskScore, normName, pickPL, summarisePicks, calibrate, impliedProb, fairOdds, edgePct, LOGISTIC_SLOPE,
    marketProb, marketProbDeVig, valuePoint, TYPICAL_CARD_MARGIN,
    cardCountDist, probOverCards, expectedCards, probBothCarded, teamCardMarkets,
    bookingPointsDist, expectedPoints, probOverPoints, leagueRedRate,
    bookingPointsMarkets, YELLOW_POINTS, RED_POINTS,
    minuteWeights, matchLambdas,
    venueFactor, chaseFactor, cardLambda, pCardFromLambda, pCardSeason,
    HOME_FACTOR, AWAY_FACTOR,
    simLambdas, simPoissonPmf, simScoreGrid, simOutcomes, simFixture, simResultShare, SIM_MAX_GOALS,
    shrinkRate, logit, invLogit, scaleOdds, contextProb,
    pCardsAtLeast, suspensionCycle, nextSuspension,
    brier, logLoss, reliability, glmProb,
    gammaln, expectedFouls, nbTailProb, cardProbFromFouls, recencyWeight, refCardFactor,
    leagueRate90, twoStageHazard,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLDCore;
  global.PLDCore = PLDCore;
})(typeof window !== 'undefined' ? window : globalThis);

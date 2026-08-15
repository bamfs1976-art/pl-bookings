/* The card probability model — P(booked) for one player in one fixture.
 *
 * WHAT IT DOES. Takes a player's yellow-card rate per 90, shrinks it by how
 * much football he has actually played, and multiplies it by three fixture
 * factors — the venue split, the appointed referee and the opponent's
 * fouls-drawn context. The product is an expected number of cards; jStat's
 * Poisson turns that into P(at least one).
 *
 *     lambda = y90* x (expected minutes / 90) x venue x referee x opponent
 *     P(card) = 1 - Poisson(0 | lambda)
 *
 * WHY POISSON AND NOT A LOGISTIC. A card is a count with a rate, not a coin
 * flip with a probability, and the hazard form reproduces the division's own
 * card rate by construction. The desk's existing pricing (PLDCore.pCardSeason)
 * already uses 1 - exp(-lambda), which is the same thing written out; this
 * module goes through jStat so the distribution is a named, tested
 * implementation rather than an exponential in the source, and so the tail
 * (two or more cards, the second-yellow question) comes for free.
 *
 * EVERY NUMBER SHOWS ITS WORKING. `playerFixture` returns a `working` object
 * carrying each input, each factor and where it came from. The "why" expander
 * in the app renders exactly that object, so what is displayed is what was
 * computed — there is no second, prettier derivation written out in the view.
 *
 * WHAT IT DOES NOT KNOW, and does not pretend to:
 *   - Whether he is playing. Nothing here is a pick until lineup_confirmed.
 *   - The three promoted clubs' fouls-drawn context. That comes from the
 *     2025/26 Premier League match record, and they were not in it. They get
 *     a neutral factor, flagged `source: "none"`, and the import view accepts
 *     the number by hand.
 *   - In-play anything. It is a pre-match rate.
 *
 * DEPENDENCIES: jStat (MIT), vendored into index.html. Injectable for node.
 */
(function (root) {
  'use strict';

  /* The reliability floor. Below this many minutes a per-90 rate is an
     artefact of the denominator, so it is shown greyed and badged rather than
     hidden — a squad with a missing centre-back is worse than one that admits
     it does not know yet. Doubles as the shrinkage half-weight: at exactly the
     floor a player carries half his own rate and half his position's. */
  var MIN_FLOOR = 450;

  /* The league pivot, in yellows per match across both sides. An official with
     fewer than MIN_REF_MATCHES on the record is priced at this rather than at
     his own rate, so his factor is exactly 1.00 and the model says "no
     information" instead of inventing some. */
  var PIVOT_YPM = 3.71;
  var MIN_REF_MATCHES = 10;

  var REF_LO = 0.75, REF_HI = 1.30;
  var VENUE_LO = 0.80, VENUE_HI = 1.25;
  var OPP_LO = 0.88, OPP_HI = 1.14;

  /* League venue factors, the fallback when a club has no split of its own
     (the promoted three). Carried over from the desk's forecast pipeline. */
  var LEAGUE_HOME = 0.95, LEAGUE_AWAY = 1.08;

  /* Conviction. How much the number deserves to be believed, 0-100, which is
     a different question from how high it is. Two inputs, both about evidence
     rather than form: minutes played, and whether the rate is Premier League
     football at all. */
  var BASIS_WEIGHT = { PL: 1, EFL: 0.65, NEW: 0 };

  function num(x) {
    var v = typeof x === 'string' ? Number(x) : x;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

  function create(opts) {
    var o = opts || {};
    var jStat = o.jStat || root.jStat;
    var PLAYERS = o.players || [];
    var CLUBS = o.clubs || [];
    var REFS = o.refs || [];
    var RECORD = o.record || null;      // PL_BACKTEST_2526, for fouls drawn

    /* ---- position priors, for the shrinkage -------------------------------
       Minutes-weighted, over players clearing the floor only. Including the
       low-sample rows in the prior would let the noise the shrinkage exists to
       damp set the target it shrinks toward. */
    var priors = (function () {
      var acc = Object.create(null), all = { y: 0, f: 0, m: 0 };
      PLAYERS.forEach(function (p) {
        var mins = num(p.min), y = num(p.y), f = num(p.f);
        if (mins == null || mins < MIN_FLOOR || y == null) return;
        var pos = p.p || 'MF';
        var a = acc[pos] || (acc[pos] = { y: 0, f: 0, m: 0 });
        a.y += y * mins; a.f += (f || 0) * mins; a.m += mins;
        all.y += y * mins; all.f += (f || 0) * mins; all.m += mins;
      });
      var out = { _all: all.m > 0 ? all.y / all.m : 0.17 };
      Object.keys(acc).forEach(function (k) {
        out[k] = acc[k].m > 0 ? acc[k].y / acc[k].m : out._all;
      });
      return out;
    })();

    function positionPrior(pos) {
      var v = priors[pos];
      return v == null ? priors._all : v;
    }

    /* ---- the club index -------------------------------------------------- */
    var byShort = Object.create(null), byName = Object.create(null);
    CLUBS.forEach(function (c) { byShort[c.short] = c; byName[c.name] = c; });
    function club(k) {
      if (!k) return null;
      return byShort[k] || byName[k] || null;
    }

    /* ---- opponent fouls-drawn context ------------------------------------
       Fouls DRAWN, not committed: how many free kicks a side wins. A team that
       draws a lot of fouls makes its opponents concede a lot of them, and
       fouls are what a referee books. Computed from the 2025/26 Premier League
       match record (DataHub mirror of football-data.co.uk, PDDL) — for each
       club, the fouls its OPPONENTS committed, per match.

       The three promoted clubs were not in that record, so they have no
       number. They get a neutral factor with source "none" rather than the
       league average dressed up as a measurement. */
    var foulsDrawn = (function () {
      if (!RECORD || !Array.isArray(RECORD.matches)) return null;
      var acc = Object.create(null), total = 0, teamMatches = 0;
      RECORD.matches.forEach(function (m) {
        var hf = num(m.hf), af = num(m.af);
        if (hf == null || af == null) return;
        var h = acc[m.h] || (acc[m.h] = { drawn: 0, m: 0 });
        var a = acc[m.a] || (acc[m.a] = { drawn: 0, m: 0 });
        h.drawn += af; h.m++;        // the away side's fouls were drawn by the home side
        a.drawn += hf; a.m++;
        total += hf + af; teamMatches += 2;
      });
      var league = teamMatches > 0 ? total / teamMatches : null;
      var byClub = Object.create(null);
      Object.keys(acc).forEach(function (n) {
        if (acc[n].m > 0) byClub[n] = acc[n].drawn / acc[n].m;
      });
      return { byClub: byClub, league: league, season: RECORD.season, licence: RECORD.licence };
    })();

    /* Manual entries, for the clubs the licensable record cannot cover. The
       import view writes here; nothing else does, and an entry is labelled as
       manual wherever it is used. */
    var manualDrawn = Object.create(null);
    function setManualFoulsDrawn(clubKey, perMatch) {
      var c = club(clubKey);
      var v = num(perMatch);
      if (!c) return false;
      if (v == null || v <= 0) { delete manualDrawn[c.short]; return true; }
      manualDrawn[c.short] = v;
      return true;
    }

    function opponentContext(oppKey) {
      var c = club(oppKey);
      var league = foulsDrawn && foulsDrawn.league;
      var out = {
        club: c ? c.short : (oppKey || null),
        name: c ? c.name : (oppKey || null),
        drawn: null, league: league, factor: 1, source: 'none'
      };
      if (!(league > 0)) return out;
      if (c && manualDrawn[c.short] != null) {
        out.drawn = manualDrawn[c.short]; out.source = 'manual';
      } else if (c && foulsDrawn.byClub[c.name] != null) {
        out.drawn = foulsDrawn.byClub[c.name]; out.source = 'record';
      } else if (!c && oppKey && foulsDrawn.byClub[oppKey] != null) {
        out.drawn = foulsDrawn.byClub[oppKey]; out.source = 'record';
      }
      if (out.drawn == null) return out;
      out.factor = clamp(out.drawn / league, OPP_LO, OPP_HI);
      return out;
    }

    /* ---- the venue split -------------------------------------------------
       A club's OWN cards-against split where the data has it (caH/caA against
       ca), the league's home/away factors where it does not. Not the league
       average of the two — a side that is disciplined at home and combustible
       away is exactly the thing this column exists to show. */
    function venueContext(clubKey, isHome) {
      var c = club(clubKey);
      var out = {
        club: c ? c.short : (clubKey || null),
        venue: isHome ? 'home' : 'away',
        ca: c ? num(c.ca) : null,
        caVenue: c ? num(isHome ? c.caH : c.caA) : null,
        factor: isHome ? LEAGUE_HOME : LEAGUE_AWAY,
        source: 'league'
      };
      if (out.ca != null && out.ca > 0 && out.caVenue != null) {
        out.factor = clamp(out.caVenue / out.ca, VENUE_LO, VENUE_HI);
        out.source = 'club';
      }
      return out;
    }

    /* ---- the referee ----------------------------------------------------- */
    var refByName = Object.create(null);
    REFS.forEach(function (r) { if (r && r.n) refByName[r.n] = r; });
    function refereeContext(refName) {
      var r = refName ? refByName[refName] : null;
      var matches = r ? num(r.matches) : null;
      var qualified = !!(r && matches != null && matches >= MIN_REF_MATCHES && num(r.ypg) != null);
      var ypg = qualified ? num(r.ypg) : PIVOT_YPM;
      return {
        name: refName || null,
        matches: matches,
        qualified: qualified,
        ypg: ypg,
        pivot: PIVOT_YPM,
        factor: clamp(ypg / PIVOT_YPM, REF_LO, REF_HI),
        /* Why the factor is what it is, in one word, for the expander. */
        source: !refName ? 'unassigned' : qualified ? 'referee' : 'pivot'
      };
    }

    /* ---- the player's rate ----------------------------------------------- */
    function shrunkRate(player) {
      var mins = num(player.min) || 0;
      var y90 = num(player.y);
      var prior = positionPrior(player.p);
      if (y90 == null) {
        /* NEW: no card record at all. There is no rate to shrink, and the
           position prior is not this player's rate — it is the shape of the
           hole. Returned as such, so callers can refuse to price him. */
        return { rate: null, raw: null, prior: prior, weight: 0, minutes: mins };
      }
      var w = mins > 0 ? mins / (mins + MIN_FLOOR) : 0;
      return {
        rate: w * y90 + (1 - w) * prior,
        raw: y90,
        prior: prior,
        weight: w,
        minutes: mins
      };
    }

    /* ---- conviction ------------------------------------------------------
       0-100. Minutes give the sample weight (the same w the shrinkage uses,
       so the two cannot disagree); the basis says whether those minutes were
       Premier League football. A Championship rate is a WIDE-ERROR PRIOR, not
       an absence — it counts, at about two-thirds — and a player with no
       record at all scores zero rather than inheriting his position's. */
    function conviction(player) {
      var s = shrunkRate(player);
      if (s.rate == null) return 0;
      var basis = BASIS_WEIGHT[player.b] == null ? 1 : BASIS_WEIGHT[player.b];
      return Math.round(100 * s.weight * basis);
    }

    /* ---- the model ------------------------------------------------------- */
    /* fixture: {opponent, isHome, ref, expMin}
       expMin defaults to 90 — this is P(booked | he plays the match), which is
       the number a bookings market quotes. Availability is a separate question
       and the desk answers it separately. */
    function playerFixture(player, fixture) {
      var fx = fixture || {};
      var s = shrunkRate(player);
      if (s.rate == null || !jStat || !jStat.poisson) {
        return {
          p: null, lambda: null, rated: false,
          reason: s.rate == null ? 'no card record' : 'Poisson unavailable',
          working: null
        };
      }
      var expMin = num(fx.expMin);
      if (expMin == null || expMin <= 0) expMin = 90;
      expMin = Math.min(90, expMin);

      var venue = venueContext(player.c, fx.isHome !== false);
      var ref = refereeContext(fx.ref);
      var opp = opponentContext(fx.opponent);

      var minuteShare = expMin / 90;
      var lambda = s.rate * minuteShare * venue.factor * ref.factor * opp.factor;
      /* jStat's Poisson, explicitly: P(card) is the complement of P(no card). */
      var pNone = jStat.poisson.pdf(0, lambda);
      var p = isFinite(pNone) ? clamp(1 - pNone, 0.001, 0.95) : null;
      /* The second yellow. Free from the same distribution, and the reason
         this is a count model rather than a coin flip. */
      var pTwo = isFinite(pNone)
        ? clamp(1 - pNone - jStat.poisson.pdf(1, lambda), 0, 0.5) : null;

      return {
        p: p,
        pTwoPlus: pTwo,
        lambda: lambda,
        rated: true,
        lowSample: (num(player.min) || 0) < MIN_FLOOR,
        conviction: conviction(player),
        working: {
          player: player.n,
          club: player.c,
          position: player.p,
          minutes: s.minutes,
          floor: MIN_FLOOR,
          rawRate: s.raw,
          positionPrior: s.prior,
          sampleWeight: s.weight,
          shrunkRate: s.rate,
          expMin: expMin,
          minuteShare: minuteShare,
          venue: venue,
          referee: ref,
          opponent: opp,
          lambda: lambda,
          p: p,
          pTwoPlus: pTwo,
          basis: player.b || 'PL'
        }
      };
    }

    /* The venue split as a pair, for the screener column: the same player,
       the same everything, home and away. Neutral referee and opponent, so
       the column is the VENUE effect and nothing else. */
    function venueSplit(player) {
      var h = playerFixture(player, { isHome: true, expMin: 90 });
      var a = playerFixture(player, { isHome: false, expMin: 90 });
      if (!h.rated || !a.rated) return { home: null, away: null, spread: null, source: null };
      return {
        home: h.p, away: a.p,
        spread: a.p - h.p,
        source: h.working.venue.source
      };
    }

    return {
      playerFixture: playerFixture,
      venueSplit: venueSplit,
      conviction: conviction,
      shrunkRate: shrunkRate,
      venueContext: venueContext,
      refereeContext: refereeContext,
      opponentContext: opponentContext,
      positionPrior: positionPrior,
      setManualFoulsDrawn: setManualFoulsDrawn,
      foulsDrawn: foulsDrawn,
      priors: priors,
      MIN_FLOOR: MIN_FLOOR,
      PIVOT_YPM: PIVOT_YPM,
      MIN_REF_MATCHES: MIN_REF_MATCHES
    };
  }

  var PLCardModel = {
    create: create,
    MIN_FLOOR: MIN_FLOOR,
    PIVOT_YPM: PIVOT_YPM,
    MIN_REF_MATCHES: MIN_REF_MATCHES,
    BASIS_WEIGHT: BASIS_WEIGHT
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLCardModel;
  root.PLCardModel = PLCardModel;
})(typeof window !== 'undefined' ? window : globalThis);

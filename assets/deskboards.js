/* The cross-league board engine: three datasets, one priced row per fixture.
 *
 * WHY IT IS A FILE. This was 207 lines inside today.html, and /accas needs
 * every one of them — the same three iframes, the same per-fixture pricing,
 * the same day index. Copying it would have produced two engines that price
 * the same match, and "two prices for one fixture" is the exact thing the
 * comment on SOURCES below says this page was restructured to avoid. So the
 * code MOVED rather than being duplicated: today.html now calls it.
 *
 * IT PRICES NOTHING ITSELF. Every step is a PLDCore call, or assets/plmodel.js
 * for the Premier League, which is that desk's own wiring. This file decides
 * WHICH numbers to ask for and in what order, never what they are.
 *
 * NEEDS, IN THE DOCUMENT THAT LOADS IT: three <iframe> elements with the ids
 * in SOURCES, PLDCore, and optionally PLModel and LINEUP_SHEETS.
 */
(function (root) {
  'use strict';
  var C = root.PLDCore;
  var document = root.document;

  var SOURCES = [
    { code: 'PL', name: 'Premier League', href: '/pl', frame: 'f-pl' },
    { code: 'EFLC', name: 'EFL Championship', href: '/eflc', frame: 'f-eflc' },
    { code: 'LL', name: 'La Liga', href: '/laliga', frame: 'f-laliga' }
  ];

  function readFrames() {
    return SOURCES.map(function (s) {
      /* The __data READ must be inside the try, not just the contentWindow
         lookup. Getting contentWindow on a blocked frame succeeds; touching a
         property on it is what throws SecurityError. That one line outside the
         guard turned a header misconfiguration into a blank page: with
         X-Frame-Options DENY the browser refused these same-origin frames,
         they became opaque origins, and the throw escaped readFrames and took
         the entire boot with it. The header is fixed; this makes the page
         survive it happening again, by losing a league rather than the lot. */
      var w, d;
      try {
        w = document.getElementById(s.frame).contentWindow;
        if (!w) return null;
        d = w.__data || {};
      } catch (e) { return null; }
      /* Read from the frame's published __data, NOT from its globals: the
         data files use `const`, which is lexical and never becomes a window
         property, so contentWindow.CLUBS is always undefined. */
      var L = {
        code: s.code, name: s.name, href: s.href,
        clubs: d.CLUBS, refs: d.REFS, players: d.players, fixtures: d.fixtures,
        model: d.model, sim: d.sim
      };
      return (L.clubs && L.clubs.length && L.players && L.players.length
              && L.fixtures && L.fixtures.length) ? L : null;
    }).filter(Boolean);
  }
  var LEAGUES = [];

  function framesReady() {
    return SOURCES.every(function (s) {
      var f = document.getElementById(s.frame);
      try { return !!(f && f.contentWindow && f.contentWindow.__ready); }
      catch (e) { return true; }   // cannot see it: stop waiting rather than hang
    });
  }

  /* Waits for the frames, but never forever. A dataset that fails to load is
     a league missing from the page, which is a normal state here — hanging on
     a spinner because one file 404'd is not. */
  function whenReady(fn) {
    var tries = 0;
    (function poll() {
      if (framesReady() || ++tries > 60) { fn(); return; }
      setTimeout(poll, 50);
    })();
  }

  /* ---- pricing, identical to each desk's own ---------------------------- */
  /* The same shrink-then-hazard path both desks use, from the same tested
     core, so a fixture on this page reads exactly as it does on its own desk.
     Duplicating the CALL is fine; duplicating the MODEL would not be, which is
     why every step below is a PLDCore function. */
  var SHRINK_MATCHES = 6;

  function prepare(L) {
    L.clubBy = {};
    L.clubs.forEach(function (c) { L.clubBy[c.short] = c; });
    L.refBy = {};
    (L.refs || []).forEach(function (r) { L.refBy[r.n] = r; });

    /* The Premier League desk prices a fixture through a fitted GLM, a
       referee factor, a derby boost, a venue term and the match model's
       game-state term. assets/plmodel.js is that wiring, shared with the desk
       itself, so this page cannot print a different number for the same
       match. The other two desks have no such model and use the shrink-then-
       hazard path below, which is what THEY show. */
    if (L.code === 'PL' && window.PLModel) {
      L.pl = window.PLModel.create({
        model: L.model, sim: L.sim, refs: L.refs, players: L.players
      });
      return;
    }
    var acc = {};
    L.players.forEach(function (p) {
      var m = Number(p.min) || 0;
      if (!(m > 0) || p.y == null) return;
      var a = acc[p.p] || (acc[p.p] = { w: 0, m: 0 });
      a.w += p.y * m; a.m += m;
    });
    L.prior = function (pos) {
      return acc[pos] && acc[pos].m ? acc[pos].w / acc[pos].m : 0.15;
    };
    L.players.forEach(function (p) {
      var m = Number(p.min) || 0;
      p._y90 = (m > 0 && p.yc != null)
        ? C.shrinkRate(p.yc, m, L.prior(p.p), SHRINK_MATCHES) : null;
    });
    /* The league's own average card rate, which the referee factor is
       relative to. Match-weighted, because REFS carries a rate and a count. */
    var mm = 0, tot = 0;
    (L.refs || []).forEach(function (r) {
      var k = Number(r.matches) || 0; mm += k; tot += (Number(r.ypg) || 0) * k;
    });
    L.leagueYpg = mm ? tot / mm : null;
  }

  function refFactor(L, ref) {
    if (!ref || !L.leagueYpg || ref.ypg == null) return 1;
    return Math.max(0.75, Math.min(1.30, ref.ypg / L.leagueYpg));
  }

  /* The confirmed team sheets, when a harvest has landed one. Absent is the
     ordinary state — sheets publish about an hour before kick-off — and an
     absent file must leave every number on this page exactly where it was. */
  function sheets() {
    return (typeof window !== 'undefined' && window.LINEUP_SHEETS) || null;
  }

  /* One club's roles for a fixture, or null to price it the way it always was.
     Null covers no file, no sheet for this fixture, and a sheet whose XI does
     not fully resolve against the squad — the answer to all three is the same.
     Squad names come from the league the fixture belongs to, so a name is
     never joined against another division's players. */
  function rolesFor(L, fx, short) {
    var XI_SHEETS = sheets();
    if (!XI_SHEETS || !fx || fx.id == null) return null;
    if (typeof C.lineupRoles !== 'function') return null;
    var sheet = XI_SHEETS[String(fx.id)];
    if (!sheet || !sheet[short]) return null;
    return C.lineupRoles(sheet[short], L.players
      .filter(function (p) { return p.c === short; })
      .map(function (p) { return p.n; }));
  }

  function sideProbs(L, short, factor, roles) {
    var squad = L.players.filter(function (p) {
      return p.c === short && p._y90 != null;
    });
    if (!squad.length) return null;
    /* THE ONLY BRANCH. Without a sheet this is the identical call it always
       was; with one the same eleven is spread over the named XI instead of
       last season's minutes. Both totals conserve eleven players' worth of
       football, so a fixture with a sheet does not run hot against one
       without. */
    var w = roles
      ? C.xiWeights(squad.map(function (p) { return roles[p.n] || null; }))
      : C.minuteWeights(squad.map(function (p) { return p.min; }), 11);
    var rows = squad.map(function (p, i) {
      var lam = C.cardLambda(p._y90, Math.max(0, w[i]) * 90, { ref: factor });
      return { p: p, prob: C.pCardFromLambda(lam) || 0 };
    });
    return {
      ps: rows.map(function (r) { return r.prob; }),
      top: rows.slice().sort(function (a, b) { return b.prob - a.prob; }).slice(0, 4)
    };
  }

  function price(L, fx) {
    /* BOTH SIDES OR NEITHER, on either path below: the match total is the sum
       of two halves, and pricing one off a real XI and the other off last
       season's minutes would make them answer different questions. */
    var rh = rolesFor(L, fx, fx.h), ra = rolesFor(L, fx, fx.a);
    if (!rh || !ra) { rh = null; ra = null; }
    if (L.pl) {
      var pref = fx.ref ? L.refBy[fx.ref] : null;
      var derby = L.pl.isDerby(fx.h, fx.a);
      var b = L.pl.board(fx.h, fx.a, pref, derby, undefined, undefined,
                         rh ? { home: rh, away: ra } : null);
      if (!b) return null;
      var cands = L.pl.candidates(fx.h, fx.a, pref, derby);
      return {
        L: L, fx: fx, ref: { ref: pref, name: fx.ref || null, appointed: !!fx.ref },
        factor: L.pl.refFactor(pref), derby: derby,
        roles: rh ? { home: rh, away: ra } : null,
        home: { ps: [], top: cands.filter(function (c) { return c.p.c === fx.h; }).slice(0, 4) },
        away: { ps: [], top: cands.filter(function (c) { return c.p.c === fx.a; }).slice(0, 4) },
        m: b
      };
    }
    var ref = fx.ref ? L.refBy[fx.ref] : null;
    var factor = refFactor(L, ref);
    var home = sideProbs(L, fx.h, factor, rh), away = sideProbs(L, fx.a, factor, ra);
    if (!home || !away) return null;
    var m = C.teamCardMarkets(home.ps, away.ps, [3.5, 4.5, 5.5]);
    /* Whether a harvested team sheet was actually used, so a shared card can
       say which basis it was priced on. The Premier League path gets this from
       plmodel.board; this is the sibling half of the same fact. */
    m.xi = !!(rh && ra);
    return {
      L: L, fx: fx, ref: { ref: ref, name: fx.ref || null, appointed: !!fx.ref },
      factor: factor, home: home, away: away, m: m
    };
  }

  /* ---- the day --------------------------------------------------------- */
  function dayKey(iso) { return String(iso || '').slice(0, 10); }

  /* INDEXED PER CALL, not into module state. today.html indexes once at boot
     and so does /accas; module-level accumulators would mean the second page
     to call this appended to the first one's rows if both ever ran in one
     document, and "why are there two of every fixture" is a bad afternoon. */
  function index(leagues) {
    var ALL = [], DAYS = {}, DAYKEYS = [];
    (leagues || []).forEach(function (L) {
      L.fixtures.forEach(function (fx) {
        if (!fx.d) return;
        var p = price(L, fx);
        if (p) ALL.push(p);
      });
    });
    ALL.forEach(function (p) {
      (DAYS[dayKey(p.fx.d)] = DAYS[dayKey(p.fx.d)] || []).push(p);
    });
    DAYKEYS = Object.keys(DAYS).sort();
    return { ALL: ALL, DAYS: DAYS, DAYKEYS: DAYKEYS };
  }

  root.PLDBoards = {
    SOURCES: SOURCES,
    readFrames: readFrames, framesReady: framesReady, whenReady: whenReady,
    prepare: prepare, refFactor: refFactor, rolesFor: rolesFor,
    sideProbs: sideProbs, price: price, dayKey: dayKey, index: index
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

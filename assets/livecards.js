/* Live card ticker — what has actually happened, against what was forecast.
 *
 * THE PROBLEM THIS FIXES. The desk is a forecast and it never stopped being
 * one. At 4.30pm on a Saturday a fixture card still read "Gabriel — 52%",
 * with the same confidence as it had on Thursday, for a player who had been
 * booked in the twentieth minute. A forecast that does not know the event has
 * happened is not merely unhelpful, it is wrong on the page, and a bookings
 * desk saying a carded player is a 52% chance of being carded is the worst
 * sentence this product can produce.
 *
 * WHERE THE DATA COMES FROM. The official FPL live endpoint,
 * /api/fpl/event/<gw>/live, which carries yellow_cards and red_cards per
 * player and updates in play. It is the only free feed that does. The proxy
 * holds it uncacheable for that reason.
 *
 * WHAT IS COUNTED, AND WHY IT IS COMPLETE. Totals are summed over the FPL
 * ELEMENTS of each club, taken from the bootstrap, not over the desk's baked
 * squads. The baked squads are a subset — a January signing or a youth debut
 * is not in them — so counting from them would undercount a fixture's cards
 * and the number would look fine. The NAMES beside the total are best-effort
 * from the matched squads, so a total can legitimately exceed the names
 * shown, and the UI says so rather than implying the list is the count.
 *
 * DOUBLE GAMEWEEKS. `stats` on the live feed is a GAMEWEEK total, not a match
 * one. When a club has two fixtures in the round, a card cannot be attributed
 * to one of them from this feed. Rather than guess, the ticker relabels
 * itself: "this gameweek" instead of "this match". The `explain` array would
 * resolve it, but nothing in this portfolio has ever read that field, so it
 * is not a shape either repo can claim to know — and a wrong attribution here
 * would be invisible.
 *
 * THE MINUTE comes from the live feed too — the largest `minutes` among the
 * two clubs' players, which is the elapsed time as long as anyone has played
 * the whole match. The fixtures feed carries a minute as well, but the proxy
 * caches it for five minutes, and a clock five minutes behind on a live page
 * is worse than no clock.
 */
(function (root) {
  'use strict';

  /* Kick-off plus this much is when a fixture stops being worth polling for.
     90 minutes of football, a half-time, and generous stoppage. */
  var WINDOW_MS = 150 * 60 * 1000;

  /* ---- pure: index the live payload -------------------------------------
     { elementId: {yc, rc, min} }. Missing stats are read as absent, not as
     zero: an element with no stats object has not been reported on, which is
     different from having been reported as clean. */
  function indexLive(payload) {
    var out = {};
    var els = (payload && payload.elements) || [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (!e || e.id == null || !e.stats) continue;
      out[e.id] = {
        yc: Number(e.stats.yellow_cards) || 0,
        rc: Number(e.stats.red_cards) || 0,
        min: Number(e.stats.minutes) || 0
      };
    }
    return out;
  }

  /* ---- pure: index an API-Football live payload -------------------------
   *
   * THE SECOND SOURCE, AND DELIBERATELY NOT A SECOND TICKER. FPL covers the
   * Premier League and nothing else, so the Championship and La Liga desks
   * had no live layer at all. /api/live-cards fills that, and everything
   * below this line — clubTally, fixtureTicker, playerState — is reused
   * unchanged. Only the INDEXING differs, because the two feeds answer
   * different questions: FPL gives a gameweek total per player, the events
   * feed gives the cards themselves.
   *
   * That difference is why this is the better feed for a card desk. A
   * gameweek total cannot be split between a club's two fixtures (see the
   * DOUBLE GAMEWEEKS note above); a card event belongs to one match by
   * construction, so there is no gameweek-scope caveat here.
   *
   * `row` is one fixture from the function: {h, a, minute, status, cards[]}.
   * `resolve(feedName)` turns the feed's club spelling into the desk's short
   * code — passed in because each desk holds its own map and this file holds
   * none. Returns {idx, elClub} in exactly the shape clubTally consumes.
   *
   * MINUTES PLAYED ARE NOT AVAILABLE and are not invented. Every carded
   * player is recorded with the FIXTURE's elapsed minute, which is what makes
   * clubTally's `played` count "has been involved" rather than a minutes
   * total — and the fixture's own minute is passed to fixtureTicker directly
   * rather than derived from a maximum. */
  function indexApiLive(row, resolve) {
    if (!row) return { idx: {}, elClub: {} };
    var idx = {}, elClub = {};
    var minute = Number(row.minute) || 0;
    var cards = row.cards || [];
    for (var i = 0; i < cards.length; i++) {
      var e = cards[i];
      if (!e || !e.n) continue;
      var club = resolve ? resolve(e.c) : e.c;
      if (!club) continue;
      var key = club + '|' + e.n;
      if (!idx[key]) { idx[key] = { yc: 0, rc: 0, min: minute }; elClub[key] = club; }
      /* A SECOND YELLOW IS ONE DISMISSAL AND TWO CARDS — the convention the
         ledger, the match record and the outcome totals all already use. The
         events feed states it as its own kind, so unlike everywhere else in
         this repository it does not have to be inferred from yc=2, rc=1.

         AND IT MUST NOT BE COUNTED TWICE. fixtureTicker totals yc + rc, so
         recording a second yellow as BOTH a yellow and a red made a booking
         and a dismissal read as three cards — the exact arithmetic
         data/build_bookings.py's cards_in() exists to prevent, arriving on the
         live page where it would be watched happening. The dismissal is
         therefore a separate `off` flag: the two yellows ARE the two cards,
         and `off` is what playerState reads. FPL sets no `off`, so that source
         is untouched. */
      if (e.k === 'Y') idx[key].yc += 1;
      else if (e.k === 'Y2') { idx[key].yc += 1; idx[key].off = true; }
      else if (e.k === 'R') { idx[key].rc += 1; idx[key].off = true; }
      else idx[key].yc += 1;   /* an unrecognised label is still a card shown */
    }
    return { idx: idx, elClub: elClub };
  }

  /* ---- pure: one club's cards this gameweek -----------------------------
     `elClub` maps FPL element id -> club short code. Complete by construction
     because it is built from the bootstrap. */
  function clubTally(idx, elClub, club) {
    var t = { yc: 0, rc: 0, min: 0, played: 0 };
    for (var id in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, id)) continue;
      if (elClub[id] !== club) continue;
      var s = idx[id];
      t.yc += s.yc; t.rc += s.rc;
      if (s.min > 0) t.played++;
      if (s.min > t.min) t.min = s.min;
    }
    return t;
  }

  /* ---- pure: the ticker for one fixture ---------------------------------
     Returns null when there is nothing to say — no live data, or the fixture
     has not started. `fixturesFor(club)` returns how many fixtures that club
     has in this gameweek, which is what decides match-scope vs gameweek-scope. */
  function fixtureTicker(idx, elClub, h, a, opts) {
    if (!idx) return null;
    var o = opts || {};
    var H = clubTally(idx, elClub, h), A = clubTally(idx, elClub, a);
    /* Nobody has kicked a ball in this fixture yet.
       `o.started` is the events-feed case: a live 0-0 with no cards yet has an
       empty index, and for a BOOKINGS desk "37 minutes gone, no cards" is the
       most useful thing the ticker can say — not silence. The FPL source
       passes no `started` and keeps its original behaviour exactly. */
    if (!H.played && !A.played && !o.started) return null;
    var multi = (o.fixturesFor ? (o.fixturesFor(h) > 1 || o.fixturesFor(a) > 1) : false);
    return {
      home: H,
      away: A,
      cards: H.yc + A.yc + H.rc + A.rc,
      yellows: H.yc + A.yc,
      reds: H.rc + A.rc,
      /* THE FIXTURE'S OWN CLOCK when the source has one. FPL has no minute
         field on the live feed, so that source derives it from the largest
         `minutes` played; the events feed carries the elapsed minute itself,
         which is right rather than inferred. */
      minute: o.minute != null ? Number(o.minute) : Math.max(H.min, A.min),
      finished: !!o.finished,
      /* 'match' means every card counted belongs to this fixture. 'gameweek'
         means at least one of these clubs plays twice and the total cannot be
         split between the two. */
      scope: multi ? 'gameweek' : 'match'
    };
  }

  /* ---- pure: how a forecast reads once the event is known ---------------
     A player who has been booked is not a probability any more. Returns one
     of: 'booked' (yellow shown), 'sent-off' (straight red or second yellow),
     'clean' (has played, no card yet — the forecast still stands but the
     window is shorter), or null (not playing / unknown). */
  function playerState(idx, elementId) {
    if (!idx || elementId == null) return null;
    var s = idx[elementId];
    if (!s) return null;
    if (s.rc > 0 || s.off) return 'sent-off';
    if (s.yc > 0) return 'booked';
    if (s.min > 0) return 'clean';
    return null;
  }

  /* ---- is anything worth polling for right now? -------------------------
     Decided from the SCHEDULE, not from the fixtures feed's `started` flag,
     because that flag arrives through a five-minute edge cache and would have
     us start polling late and stop polling late. Kick-off times do not go
     stale. */
  function anyLive(fixtures, now) {
    var t = now == null ? Date.now() : now;
    for (var i = 0; i < (fixtures || []).length; i++) {
      var f = fixtures[i];
      if (!f || f.finished) continue;
      if (!f.kickoff_time) continue;
      var ko = Date.parse(f.kickoff_time);
      if (!isFinite(ko)) continue;
      if (t >= ko && t < ko + WINDOW_MS) return true;
    }
    return false;
  }

  /* ---- the live layer ---------------------------------------------------
     Polls only while `anyLive` says a match is on. Never caches: the whole
     point is the number being current, and a stale card count is the one
     thing this file exists to prevent. A failed poll keeps the previous
     index rather than blanking the page — a dropped request is not news
     that the cards were rescinded. */
  function create(opts) {
    var o = opts || {};
    var fetchJson = o.fetchJson;                 /* (path) -> Promise<any> */
    var everyMs = o.everyMs || 60000;
    var idx = null, elClub = {}, timer = null, gw = null, failures = 0, lastAt = 0;

    function setClubs(map) { elClub = map || {}; }

    async function poll() {
      if (gw == null) return;
      try {
        var data = await fetchJson('event/' + gw + '/live');
        idx = indexLive(data);
        failures = 0;
        lastAt = Date.now();
        if (o.onUpdate) o.onUpdate();
      } catch (e) {
        failures++;
        /* Keep whatever we had. Four consecutive misses is a feed that is
           gone rather than a blip, and the UI stops claiming to be live. */
        if (failures >= 4) { idx = null; if (o.onUpdate) o.onUpdate(); }
      }
    }

    function schedule(fixtures) {
      if (timer) { clearInterval(timer); timer = null; }
      if (!anyLive(fixtures)) return;
      poll();
      timer = setInterval(function () {
        if (!anyLive(fixtures)) { clearInterval(timer); timer = null; return; }
        poll();
      }, everyMs);
    }

    return {
      start: function (gameweek, fixtures, clubMap) {
        gw = gameweek; setClubs(clubMap); schedule(fixtures);
      },
      stop: function () { if (timer) { clearInterval(timer); timer = null; } },
      /* null until a poll has succeeded — every reader must handle that, and
         "no live data" renders as the desk's ordinary forecast view. */
      index: function () { return idx; },
      updatedAt: function () { return lastAt; },
      ticker: function (h, a, opts2) { return fixtureTicker(idx, elClub, h, a, opts2); },
      state: function (elementId) { return playerState(idx, elementId); },
      refresh: poll
    };
  }

  var api = { create: create, indexLive: indexLive, indexApiLive: indexApiLive,
    clubTally: clubTally,
    fixtureTicker: fixtureTicker, playerState: playerState, anyLive: anyLive,
    WINDOW_MS: WINDOW_MS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LiveCards = api;
})(typeof window !== 'undefined' ? window : globalThis);

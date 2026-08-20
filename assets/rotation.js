/* PLDRotation — rest days, and how many changes they buy.
 *
 * A STANDALONE FILE SO IT CAN BE VENDORED. Gameweek Edge wants this and
 * nothing else from the desk; slicing it out of a 1,700-line core.js would
 * make a second copy of the rule, and a second copy of a rule is how this
 * project has lost a Premier League season's worth of data three times in one
 * day. One definition, here; assets/core.js re-exports it so PLDCore.restDays
 * and friends keep working for everything that already calls them.
 *
 * NO DEPENDENCIES, no DOM, no fetch, no state. Load it BEFORE core.js.
 *
 * WHAT IT ANSWERS. How long a club has actually had off — days since its last
 * COMPETITIVE match in any competition, not since its last league match — and
 * what that implies for team selection.
 *
 * WHAT IT DOES NOT ANSWER. Cards. Rest days do not move a team's yellow count:
 * measured over 740 team-fixtures of 2025-26 the effect is -0.09 per team per
 * match and the 95% interval EXCLUDES an effect the size of the desk's 0.2
 * gate. Selection is a different question and it has a different answer.
 */
(function (global) {
  'use strict';

  /* ---- fatigue: rest days, and what counts as rest ----------------------
   *
   * REST IS DAYS SINCE THE LAST COMPETITIVE MATCH IN ANY COMPETITION, which is
   * why data/pl_other_fixtures.js exists. Computed from league dates alone,
   * 74.2% of the 2025-26 team-fixtures land in the "fresh" bucket — three
   * quarters of a season with no midweek football in it. The clubs that rule
   * mislabels are precisely the European ones, so a fatigue factor measured
   * that way is biased toward finding nothing.
   *
   * ONE IMPLEMENTATION, used by the shipped fixture build and by the backtest,
   * so the buckets a reader sees are the buckets the factor was judged on.
   */
  const REST_FRESH = 6;      // days or more
  const REST_CONGESTED = 3;  // days or fewer
  const EURO_COMPS = new Set(['UCL', 'UEL', 'UECL']);
  const EURO_AWAY_HOURS = 72;

  function dayGap(fromISO, toISO) {
    const a = Date.parse(fromISO), b = Date.parse(toISO);
    if (!isFinite(a) || !isFinite(b) || b < a) return null;
    return Math.floor((b - a) / 86400000);
  }

  /* The club's previous competitive match before `kickoff`, from a list of
     {d, comp, v} entries. Strictly before: a fixture is never its own
     predecessor, and two ties on one day (which the cup feeds do produce for
     replays) resolve to the later one. */
  function previousMatch(entries, kickoff) {
    const t = Date.parse(kickoff);
    if (!isFinite(t)) return null;
    let best = null;
    for (const e of entries || []) {
      const u = Date.parse(e && e.d);
      if (!isFinite(u) || u >= t) continue;
      if (!best || u > Date.parse(best.d)) best = e;
    }
    return best;
  }

  /* Days of rest, or null when there is no previous match — the first fixture
     of a season is not a well-rested side, it is a side with no evidence, and
     scoring it as fresh would put every club in the bucket once a year. */
  function restDays(entries, kickoff) {
    const prev = previousMatch(entries, kickoff);
    return prev ? dayGap(prev.d, kickoff) : null;
  }

  function restBucket(days) {
    if (days == null || !isFinite(days)) return null;
    if (days >= REST_FRESH) return 'fresh';
    if (days <= REST_CONGESTED) return 'congested';
    return 'normal';
  }

  /* Away in Europe inside three days. Derived rather than hand-flagged: a
     manual boolean for something the dates already state is a field that rots
     the first time nobody remembers to set it. */
  function euroAway72h(entries, kickoff) {
    const prev = previousMatch(entries, kickoff);
    if (!prev || !EURO_COMPS.has(prev.comp) || prev.v !== 'A') return false;
    const hours = (Date.parse(kickoff) - Date.parse(prev.d)) / 3600000;
    return isFinite(hours) && hours <= EURO_AWAY_HOURS;
  }

  /* ---- rotation risk ----------------------------------------------------
   *
   * HOW MANY CHANGES A MANAGER IS LIKELY TO MAKE, from the fixture calendar
   * alone. The point of it is the timing: congestion is knowable days before
   * team news, which is what makes it usable rather than merely true.
   *
   * MEASURED, NOT ASSUMED. On the 2025-26 season a congested side changed
   * 2.55 of its eleven against a fresh side's 1.94 — and, crucially, +0.346
   * ABOVE that club's own average (95% CI 0.11 to 0.58, z = 2.90). Club habit
   * is the big term: Chelsea changed 3.27 a match, Everton 1.57. Without the
   * club baseline this would rediscover squad depth and call it fatigue.
   *
   * NOT A CARD FACTOR, and the distinction is the whole finding. Rest days do
   * not move a team's yellow count; the same season excludes an effect the
   * size of the desk's 0.2 gate. What congestion moves is SELECTION.
   *
   * Takes the model as an argument rather than reaching for a global, so a
   * sibling app can pass its own fit — the coefficients are a property of the
   * season they came from, not of this file.
   */
  function rotationRisk(model, club, entries, kickoff) {
    if (!model || !model.rest) return null;
    const days = restDays(entries, kickoff);
    const bucket = restBucket(days);
    /* No previous match is not "well rested", it is no evidence — the opening
       weekend, or a club the fixture list does not yet cover. Returning the
       club's own baseline says "nothing known about rest here" rather than
       inventing a fresh side. */
    const base = (model.clubBaseline && model.clubBaseline[club]) != null
      ? model.clubBaseline[club] : model.leagueMean;
    if (base == null) return null;
    const rest = bucket == null ? 0 : (model.rest[bucket] || 0);
    const euro = bucket === 'congested' && euroAway72h(entries, kickoff)
      ? (model.euroAwayExtra || 0) : 0;
    const expected = base + rest + euro;
    return {
      club, days, bucket,
      euroAway72h: euro !== 0,
      baseline: base,
      expected: Math.round(expected * 100) / 100,
      /* Against the club's OWN habit, which is the number a reader wants: a
         Chelsea line saying "3.4 changes" is unremarkable, "+0.4 on their own
         average" is the signal. */
      lift: Math.round((expected - base) * 100) / 100,
      band: rotationBand(expected - base),
      /* An honest label for the case with nothing behind it. */
      known: bucket != null,
    };
  }

  /* Bands for display. Cut on the LIFT rather than the absolute, so a club
     that always rotates is not permanently flagged and a settled side that
     suddenly faces three games in seven days is. */
  function rotationBand(lift) {
    if (lift == null || !isFinite(lift)) return null;
    if (lift >= 0.30) return 'high';
    if (lift >= 0.10) return 'raised';
    if (lift <= -0.10) return 'settled';
    return 'normal';
  }

  const PLDRotation = {
    restDays, restBucket, previousMatch, euroAway72h,
    rotationRisk, rotationBand,
    REST_FRESH, REST_CONGESTED, EURO_AWAY_HOURS, EURO_COMPS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLDRotation;
  global.PLDRotation = PLDRotation;
})(typeof window !== 'undefined' ? window : globalThis);

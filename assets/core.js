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

  /* ---- this season's rates, and when to trust them --------------------
   *
   * Both halves of the risk score have a baked 2025-26 rate and, eventually,
   * a 2026-27 one. Yellow cards arrive from the FPL API; fouls arrive from
   * data/core_insights.js. They are governed by ONE rule, here, for a reason
   * that took a season to become visible: if the two halves switched onto
   * live data at different thresholds, the score would be part this season
   * and part last, and no label on the page could honestly describe it.
   *
   * The rule is a switch, not a blend. 450 minutes — five full matches — is
   * where a rate stops being noise, and it is the threshold the desk has
   * always used for yellows. A blend would be defensible too, but it would
   * mean every displayed rate is a number the player has never had, and this
   * desk shows its rates.
   *
   * Below the threshold the baked rate is returned unchanged, so a player
   * with two appearances is priced on a full season of last year rather than
   * on 180 minutes of this one.
   */
  const MIN_LIVE_MINUTES = 450;

  function per90(count, minutes) {
    const c = Number(count), m = Number(minutes);
    if (!isFinite(c) || !isFinite(m) || m <= 0) return null;
    return c / (m / 90);
  }

  /* Returns {rate, live}. `live` is what the page's "live rate" marker means:
     this number came from this season. A null baked rate with too few live
     minutes stays null — an unknown rate is not a zero one. */
  function liveRate(bakedRate, count, minutes, minMinutes) {
    const floor = minMinutes == null ? MIN_LIVE_MINUTES : Number(minMinutes);
    const m = Number(minutes);
    if (isFinite(m) && m >= floor) {
      const r = per90(count, minutes);
      if (r != null) return { rate: r, live: true };
    }
    return { rate: bakedRate == null ? null : Number(bakedRate), live: false };
  }

  /* ---- the id join, re-checked on every page load ---------------------
   *
   * core_insights.js is keyed by the official FPL player id and so is the
   * bootstrap, so the join is an integer lookup — which is exactly why it
   * needs guarding. If the upstream ever renumbers, every foul rate lands on
   * the wrong player and every number on the page stays plausible. There is
   * no shape guard for "correct data about the wrong person".
   *
   * So the vendored file carries the web name beside the id and the app
   * checks the pairing against the feed it already has. Comparison is on
   * normalised names because the two sources punctuate differently
   * ("Bruno G." against "Bruno Guimarães"); a prefix match either way is
   * enough to say it is the same person and not enough to accept a different
   * one.
   */
  /* normName strips COMBINING accents, via NFD. It cannot touch letters that
     are their own character rather than a letter plus a mark — ø, æ, ß, đ, ł
     decompose to nothing, so "Nørgaard" normalises to "n rgaard" and would
     never match a feed that writes "Norgaard". Folded here rather than in
     normName because normName is what the REFEREE join uses, and loosening
     that would let two officials collide. */
  function foldLetters(s) {
    return s.replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
      .replace(/ß/g, 'ss').replace(/đ/g, 'd').replace(/ð/g, 'd')
      .replace(/ł/g, 'l').replace(/þ/g, 'th');
  }

  /* ---- pricing off a confirmed XI ---------------------------------------
   *
   * When a lineup is known, a player's expected minutes stop being a share of
   * last season's and become a fact about tonight. The replacement has one
   * hard constraint and it is arithmetic, not taste.
   *
   * CONSERVE THE ELEVEN. A team plays 990 player-minutes in a match — eleven
   * shirts for ninety minutes — and `minuteWeights(mins, 11)` already spreads
   * exactly that much across a squad (measured on the shipped Championship
   * data: 10.95 to 11.00 per club). Any XI weighting must land on the same
   * total, or fixtures with a known lineup would run systematically hotter or
   * cooler than fixtures without one, and that difference would be an artefact
   * of HAVING the team sheet rather than of anything on it.
   *
   * This is where the obvious numbers fail. "90 for a starter, 20 for a
   * substitute" is the intuitive rule and it totals 11 + 9x0.22 = 13.0 — about
   * eighteen per cent more football than gets played, inflating every over-line
   * on every fixture the desk knows most about. "90 and 0" conserves the total
   * but prices a named substitute as though he could not be booked, which is
   * false and worst in the tails where the over-lines live.
   *
   * So the minutes are shared out rather than assigned: the bench collectively
   * gets SUBS_USED x SUB_MINUTES, the starters get what remains, and each side
   * of that split is divided by however many players are actually on it. The
   * bench size comes from the lineup itself — a Championship seven and a
   * Premier League nine are different denominators for the same pool of
   * substitute minutes, and hardcoding either would misprice the other.
   */
  const MATCH_MINUTES = 90;
  const XI_SIZE = 11;
  /* Five substitutions, which is the rule in all three divisions the desks
     cover. Not a modelling choice — a competition rule, and the day it changes
     this is where it changes. */
  const SUBS_USED = 5;
  /* The mean a substitute plays GIVEN he comes on. Substitutions cluster
     between the 60th and 80th minute, so a shade over twenty is the honest
     middle; it is the one free parameter here and it moves the split rather
     than the total, which is why the total is the thing guarded. */
  const SUB_MINUTES = 20;

  /* Expected minutes for one starter and one named substitute, given the
     shape of a lineup. Returned as MINUTES, not weights, so a caller can see
     what it is being told: 81 and 11 reads as a claim about football, 0.9 and
     0.12 reads as a number that fell out of something. */
  function lineupMinutes(starters, bench) {
    const ns = Math.max(0, Math.floor(Number(starters) || 0));
    const nb = Math.max(0, Math.floor(Number(bench) || 0));
    if (!ns) return null;
    const pool = XI_SIZE * MATCH_MINUTES;              // 990 player-minutes
    /* A bench shorter than the permitted substitutions cannot supply more
       than it has; a longer one shares the same pool more thinly. */
    const benchPool = Math.min(SUBS_USED, nb) * SUB_MINUTES;
    return {
      starter: (pool - benchPool) / ns,
      sub: nb ? benchPool / nb : 0,
      total: pool,
    };
  }

  /* The weights themselves, aligned to whatever order the caller passed.
     `roles` is one entry per squad member: 'start', 'sub', or anything else
     (including null) for a player not in the squad list at all, who gets zero
     because he is not at the ground. */
  function xiWeights(roles) {
    const list = Array.isArray(roles) ? roles : [];
    const ns = list.filter((r) => r === 'start').length;
    const nb = list.filter((r) => r === 'sub').length;
    const m = lineupMinutes(ns, nb);
    if (!m) return list.map(() => 0);
    return list.map((r) => (r === 'start' ? m.starter / MATCH_MINUTES
      : r === 'sub' ? m.sub / MATCH_MINUTES : 0));
  }

  /* ---- one player, two feeds --------------------------------------------
   *
   * THE JS TWIN OF data/build_pl_data.py's `name_keys`, and deliberately the
   * same rule rather than a new one: full name first, initial-plus-surname
   * second. Ported because the lineup layer runs on the desks and that rule
   * only existed in Python, and because the alternative — reaching for
   * `joinLooksRight` — is wrong here in a way that is easy to miss.
   *
   * THE TWO JOINS ARE COMPLEMENTARY, NOT INTERCHANGEABLE. Measured on real
   * pairs:
   *
   *                                  joinLooksRight   playerKeys
   *   "Bruno G."  <- Bruno Guimarães       yes            no
   *   "Toti"      <- Toti Gomes            yes            no
   *   "C. Nørgaard" <- Christian Nørgaard   no            yes
   *   "J. Strand Larsen" <- Jørgen ...      no            yes
   *
   * joinLooksRight absorbs a TRAILING abbreviation, which is what a vendored
   * bundle does to a long surname. API-Football abbreviates the FORENAME,
   * which is the opposite end of the string. A previous attempt at this
   * feature used one rule and lost Toti Gomes and A. Guðjohnsen — a
   * single-token name and a letter NFD cannot decompose — so both tiers run,
   * in this order, and neither is dropped as redundant.
   */
  function playerKeys(name) {
    const flat = normName(foldLetters(String(name || '').toLowerCase()));
    const parts = flat.split(' ').filter(Boolean);
    if (!parts.length) return null;
    return { full: parts.join(' '), initial: parts[0][0] + ' ' + parts[parts.length - 1] };
  }

  /* One squad name for a published one, or null. UNIQUE OR NOTHING, the rule
     every join in this repository already follows: two players at a club who
     share an initial and a surname collapse to one key, and picking either
     would attach one man's minutes to the other silently. `squad` is a list of
     names; the return is the matching entry or null. */
  function matchSquadName(published, squad) {
    const names = Array.isArray(squad) ? squad : [];
    const want = playerKeys(published);
    if (!want) return null;
    const keyed = names.map((n) => ({ n, k: playerKeys(n) })).filter((x) => x.k);
    const uniq = (hits) => (hits.length === 1 ? hits[0].n : null);
    let hit = uniq(keyed.filter((x) => x.k.full === want.full));
    if (hit) return hit;
    hit = uniq(keyed.filter((x) => x.k.initial === want.initial));
    if (hit) return hit;
    /* The trailing-abbreviation tier, which is the one playerKeys cannot see.
       Last, so it can never override an exact or initial match. */
    return uniq(keyed.filter((x) => joinLooksRight(x.n, published)));
  }

  /* One club's sheet as a squad-name -> role map, or NULL.
   *
   * ALL ELEVEN OR NONE, and this is the rule that stops the conservation above
   * turning into a weapon. xiWeights divides the starters' share by however
   * many starters it is GIVEN: hand it nine because two names did not resolve
   * against the squad and it hands each of them 99 minutes, which is not a
   * football match. A partial join is exactly what this repository keeps being
   * bitten by, so a sheet that does not fully resolve is not used at all and
   * the fixture keeps the squad weighting it always had.
   *
   * The bench is allowed to resolve partially. A substitute who cannot be
   * found is simply not on the list — he takes no share and the other named
   * substitutes divide the same pool — whereas an unresolved STARTER would
   * silently promote his ten team-mates.
   */
  /* THE MATCHDAY A DESK OPENS ON. One implementation, because it was four:
   * eflc.html and laliga.html each had a `nextRound()` for the This Matchday
   * tab and a separate rule inside `initRounds()` for the Fixtures dropdown,
   * and the two answered differently for several hours of every matchday.
   *
   * The dropdown advanced at the LAST KICK-OFF of the round; the tab advanced
   * at midnight after the last fixture's DATE. So on 17 August 2026, with
   * Cardiff v Wrexham kicking off at 19:00 as the last game of Matchday 1, the
   * Fixtures tab offered Matchday 2 from 19:00 while This Matchday still
   * showed Matchday 1 — and it did so from the moment the game kicked off,
   * with the match still being played.
   *
   * DAY GRANULARITY WINS, and the reason is the same one the live-ticker
   * docstring gives: a desk that drops a match while people are watching it is
   * the worst thing this product can do. A fixture in progress has not been
   * played, and neither has one that kicked off an hour ago.
   *
   * Dates are compared as UTC calendar days (`YYYY-MM-DD`), which is how the
   * fixture files store them, so this does not depend on the reader's clock
   * beyond which day it is for them.
   *
   * `now` is injectable so the guard can walk an hour at a time across a real
   * boundary rather than trusting a description of what it does.
   */
  function currentRound(fixtures, now) {
    const list = Array.isArray(fixtures) ? fixtures : [];
    const today = new Date(now == null ? Date.now() : now).toISOString().slice(0, 10);
    let upcoming = null, latest = null;
    for (const f of list) {
      if (!f || f.r == null) continue;
      if (latest == null || f.r > latest) latest = f.r;
      /* Today counts as upcoming all day, whatever the kick-off time. That IS
         the fix — anything finer re-introduces the mid-match rollover. */
      if (f.d && String(f.d).slice(0, 10) >= today) {
        if (upcoming == null || f.r < upcoming) upcoming = f.r;
      }
    }
    /* Nothing ahead means the list is spent, and the answer is the LAST round,
       not the first. Both of the old rules fell back to the lowest round, so
       on the day after the season ended each desk would have swung from
       Matchday 46 to Matchday 1 — a fixture list from nine months ago
       presented as the next thing to happen. Caught by the never-goes-
       backwards property in check-matchday.mjs, which is the sort of thing a
       guard written as a property finds and one written as an example does
       not. Also the right answer for a stale fixture file, which is the same
       state arrived at by a different route.
       ROUNDS ARE NOT A PARTITION OF THE CALENDAR — La Liga's jornada 1 carries
       postponed fixtures after the whole of jornada 2 — so this is max of the
       round numbers, not the round of the latest date. */
    return upcoming != null ? upcoming : latest;
  }

  function lineupRoles(sheet, squadNames) {
    if (!sheet || !Array.isArray(sheet.start)) return null;
    const squad = Array.isArray(squadNames) ? squadNames : [];
    if (!squad.length) return null;
    const roles = {};
    for (const n of sheet.start) {
      const hit = matchSquadName(n, squad);
      if (!hit) return null;                 // an unresolved starter voids the sheet
      roles[hit] = 'start';
    }
    /* Eleven DISTINCT squad members. Two feed names collapsing onto one squad
       entry would leave the side ten strong and the check above would not see
       it, because eleven names each resolved to something. */
    if (Object.keys(roles).length !== 11) return null;
    for (const n of (sheet.sub || [])) {
      const hit = matchSquadName(n, squad);
      if (hit && !roles[hit]) roles[hit] = 'sub';
    }
    return roles;
  }

  function joinLooksRight(vendoredName, feedName) {
    const a = normName(foldLetters(String(vendoredName || '').toLowerCase()));
    const b = normName(foldLetters(String(feedName || '').toLowerCase()));
    if (!a || !b) return false;
    if (a === b) return true;
    /* A prefix match either way absorbs "Bruno G." against "Bruno Guimarães".
       It must stay a PREFIX: a substring match would pair "Rice" with
       "Maurice", and a renumbering by one is exactly what this guards. */
    const as = a.replace(/ /g, ''), bs = b.replace(/ /g, '');
    return as.startsWith(bs) || bs.startsWith(as);
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

  /* ---- one official, two feeds ------------------------------------------
   *
   * The appointment overlay and the card table are different sources and they
   * spell the same referee differently. On the Championship's opening round
   * the overlay named all twelve officials and the desk matched ONE of them:
   * "Andrew Kitchen", because that feed happened to write him in full. The
   * other eleven arrived as "F. Hallam", "M. Donohue", "A. Herczeg" against a
   * card table holding "Farai Hallam", "Matthew Donohue" and "A Herczeg" — an
   * abbreviation, a fuller name, and the same abbreviation with a full stop.
   *
   * An exact string lookup misses all three, and misses them SILENTLY: an
   * appointment the desk cannot resolve is priced at refFactor = 1, which
   * looks exactly like a fixture with no official appointed. The referee is
   * the largest single multiplier these desks apply, so eleven of twelve
   * matches were about to be priced as though nobody had been named.
   *
   * This is build_refs.canonical_referees' problem in the other direction —
   * there, folding two spellings in one feed into one official; here, finding
   * which official in one feed a spelling from another feed means — and it is
   * deliberately the same rule, so the two cannot disagree about what one
   * person looks like:
   *
   *   same first initial, and one name's surnames are a CONTIGUOUS RUN of the
   *   other's, in order.
   *
   * Contiguous and ordered because surname order is identity: "Busquets
   * Ferrer" and "Ferrer Busquets" are two families. Ambiguity resolves to
   * null rather than to a guess — "J. Smith" against a table holding both
   * Josh and Jarred Smith is not a lookup, and pricing a match off the wrong
   * referee is worse than pricing it off none.
   */
  function refNameParts(s) {
    const parts = normName(s).split(' ').filter(Boolean);
    return parts.length ? { initial: parts[0][0], surnames: parts.slice(1) } : null;
  }

  /* A referee's name, shortened for a cell that has room for about twenty
   * characters. ONE implementation, because there were four and they
   * disagreed: eflc.html, laliga.html and today.html each took the LAST token,
   * index.html took the initial plus everything after the first.
   *
   * THE LAST TOKEN IS WRONG FOR SPANISH NAMES, which carry two surnames —
   * paternal then maternal — and it is the paternal one people use. Every La
   * Liga official was displayed by the surname nobody says: "Vega" for Adrián
   * Cordero Vega, "Escuderos" for Isidro Díaz de Mera Escuderos, "Apezteguia"
   * for Iosu Galech Apezteguia. The RFEF's own designation sheet says
   * "Adrián Cordero" while the desk said "Vega".
   *
   * WHY NOT THE PATERNAL SURNAME ALONE, which is what the federation prints:
   * it collides. The shipped twenty contain both Alejandro Hernández and
   * Francisco Hernández Maeso, and Gil, García and Martínez are as common in
   * Spain as Smith is in England. Spanish football commentary names referees by
   * BOTH surnames for exactly that reason — Gil Manzano, Soto Grado, Martínez
   * Munuera — so that is what this returns.
   *
   * THE HARD PART IS WHERE THE GIVEN NAMES END, and token count does not say:
   *   José Luis Munuera Montero      2 given + 2 surnames
   *   Ricardo De Burgos Bengoetxea   1 given + 2 surnames, one with a particle
   * Both are four tokens. The particle is the signal — "de", "del", "la" and
   * their kin only ever begin a surname — so this takes the last two tokens and
   * extends left while the token before is one. That resolves
   * "Isidro Díaz de Mera Escuderos" to "Díaz de Mera Escuderos" correctly, at
   * five tokens.
   *
   * ENGLISH DESKS ARE UNTOUCHED. All 22 Premier League and all 30 Championship
   * officials are two tokens, and two tokens returns the surname exactly as
   * before — checked across the three shipped tables, not assumed.
   */
  const NAME_PARTICLES = new Set([
    'de', 'del', 'la', 'las', 'lo', 'los', 'y', 'da', 'das', 'do', 'dos',
    'van', 'von', 'di', 'du', "d'", 'st', 'mc', 'mac'
  ]);

  function refShort(name) {
    const parts = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    /* The given name survives as an initial. Dropping it entirely reads
       better, and it made "E Bell" and "J Bell" — both Championship officials —
       the same cell, along with Lewis and Josh Smith. index.html already kept
       the initial for that reason; the three copies that did not were the ones
       with the ambiguity. */
    const initial = parts[0] ? parts[0][0].toUpperCase() + '. ' : '';
    /* One or two tokens is "Given Surname" — every English official, and the
       single-surname Spanish case. */
    if (parts.length <= 2) return initial + parts[parts.length - 1];
    let from = parts.length - 2;
    /* A particle can sit in two places and they need different handling:
         Ricardo | De Burgos | Bengoetxea      it STARTS the paternal surname
         Isidro  | Díaz de Mera | Escuderos    it is INSIDE one
       Taking the particle alone gets the first right and the second wrong —
       "de Mera Escuderos", which drops Díaz. So absorb the particle, and if it
       was not the first thing after the given name, absorb the token before it
       too. Stopping at index 1 is what keeps the given name out. */
    while (from > 1 && NAME_PARTICLES.has(parts[from - 1].toLowerCase())) {
      from--;
      if (from > 1) from--;
    }
    return initial + parts.slice(from).join(' ');
  }

  function matchRefName(name, known) {
    const names = Array.isArray(known) ? known : Object.keys(known || {});
    if (!name) return null;
    /* Exact first, so a table that already agrees is never reinterpreted. */
    if (names.indexOf(name) > -1) return name;
    const want = refNameParts(name);
    if (!want || !want.surnames.length) return null;
    /* Then on the normalised form, which is what closes "A. Herczeg" against
       "A Herczeg" — the same abbreviation differing only by a full stop. */
    const flat = normName(name);
    const same = names.filter((n) => normName(n) === flat);
    if (same.length === 1) return same[0];
    if (same.length > 1) return null;

    const runIn = (a, b) => a.length <= b.length
      && b.some((_, i) => b.slice(i, i + a.length).join(' ') === a.join(' '));
    const hits = names.filter((n) => {
      const has = refNameParts(n);
      if (!has || has.initial !== want.initial || !has.surnames.length) return false;
      return runIn(want.surnames, has.surnames) || runIn(has.surnames, want.surnames);
    });
    return hits.length === 1 ? hits[0] : null;
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
  /* The same assumption for the GOALS markets, which are cut finer than the
     card markets: match odds, both-teams-to-score and the goal over-lines are
     the most competitive books on a football match, card markets among the
     least. A separate constant rather than one number reused, because pricing
     a 1X2 leg at the card margin would overstate the drag and quietly flatter
     nothing — it is simply a different market. Assumption, not a quote: it is
     stated wherever a priced number derived from it is printed. */
  const TYPICAL_GOAL_MARGIN = 0.05;
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

  /* The goal lines folded out of the grid alongside the result. Not a
     parameter with a default scattered at each call site, because two callers
     with two default lists is how the desk ends up publishing two different
     "over 2.5" numbers for one fixture. */
  const SIM_GOAL_LINES = [0.5, 1.5, 2.5, 3.5];

  /* Fold a grid into the numbers the desk uses. `close` is P(margin <= 1)
     — a draw or a one-goal win either way. That is the fitted "tight
     match" signal: cards follow games that stay live, which is not the
     same set as the historic rivalries in the derby list.
   *
   * BTTS AND THE OVER-LINES COME OUT OF THE SAME WALK, deliberately. They are
   * sums over the identical grid the result probabilities are read from, so
   * computing them anywhere else would be a second implementation of one
   * distribution — and the two would drift the first time the goal cap or the
   * Dixon-Coles correction moved. The extra cost is four comparisons a cell.
   *
   * `over` is keyed by line and strictly OVER: a 2-2 draw does not settle
   * over 3.5. The half-lines mean no scoreline sits on the line, but the
   * comparison is written `>` rather than `>=` so an integer line passed by a
   * caller settles the way a book would settle it. */
  function simOutcomes(grid, maxGoals, lines) {
    if (!Array.isArray(grid) || !grid.length) return null;
    const n = (maxGoals == null || !(maxGoals >= 1)) ? SIM_MAX_GOALS : Math.floor(maxGoals);
    const G = n + 1;
    if (grid.length !== G * G) return null;
    const ls = (Array.isArray(lines) && lines.length) ? lines : SIM_GOAL_LINES;
    let home = 0, draw = 0, away = 0, close = 0, expH = 0, expA = 0, btts = 0;
    const over = {};
    for (const l of ls) over[l] = 0;
    for (let h = 0; h < G; h++) {
      for (let a = 0; a < G; a++) {
        const p = grid[h * G + a];
        if (h > a) home += p; else if (h === a) draw += p; else away += p;
        if (Math.abs(h - a) <= 1) close += p;
        expH += h * p; expA += a * p;
        if (h >= 1 && a >= 1) btts += p;
        const tot = h + a;
        for (const l of ls) if (tot > l) over[l] += p;
      }
    }
    return { home, draw, away, close, expH, expA, btts, over };
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
    const o = simOutcomes(grid, n, opts && opts.goalLines);
    if (o == null) return null;
    return {
      lh: lam.lh, la: lam.la,
      home: o.home, draw: o.draw, away: o.away,
      close: o.close, expH: o.expH, expA: o.expA,
      btts: o.btts, over: o.over,
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
    /* r -> infinity IS Poisson, and this function said so in its own comment
       while returning NaN for it: gammaln(k + Infinity) is Infinity, and the
       log-pmf then differences two infinities. sumNegBin hands back an
       infinite size whenever the moment match comes out under-dispersed, so
       this is reachable, and a NaN here renders as "NaN%" on a fixture card. */
    if (!isFinite(size)) {
      let cdfP = 0, term = Math.exp(-mu);
      for (let k = 0; k <= line; k++) {
        cdfP += term;
        term *= mu / (k + 1);
      }
      return Math.min(1, Math.max(0, 1 - cdfP));
    }
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
  /* MATCH FOULS: the sum of a set of player-level Negative Binomials.
   *
   * A sum of independent NB(mu_i, r) is NOT itself Negative Binomial unless
   * every mu_i is equal, so this moment-matches one instead — exact in the
   * mean and the variance, approximate only in the shape:
   *
   *     mu  = SUM mu_i
   *     var = SUM (mu_i + mu_i^2 / r)      each player's own NB variance
   *     r_eff = mu^2 / (var - mu)
   *
   * REUSING THE PLAYER-LEVEL r WOULD BE WRONG, and wrong in the direction
   * that matters: a match total of ~22 fouls with r = 6 implies a standard
   * deviation near 10, which prices the tails of a foul market at roughly
   * twice their real width. Twenty-odd fouls from twenty-two players is a
   * much tighter thing than one player's two.
   *
   * Falls back to Poisson (r_eff -> Infinity) when the matched variance is
   * not above the mean, which is what under-dispersed input means.
   */
  function sumNegBin(mus, r) {
    var list = (Array.isArray(mus) ? mus : []).map(Number)
      .filter(function (m) { return isFinite(m) && m > 0; });
    if (!list.length) return null;
    var size = r > 0 ? r : 8, mu = 0, vr = 0;
    list.forEach(function (m) { mu += m; vr += m + (m * m) / size; });
    if (!(mu > 0)) return null;
    var eff = vr > mu ? (mu * mu) / (vr - mu) : Infinity;
    return { mu: mu, size: eff };
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
  /* Per-player lambdas from probabilities and a WEIGHTING, whatever produced
     it. Split out of matchLambdas so the XI path and the squad path share one
     clamp instead of two copies of it — the byte-identity the lineup work
     promises is then true by construction rather than by inspection. */
  function lambdasFromWeights(probs, weights) {
    const w = Array.isArray(weights) ? weights : [];
    return (Array.isArray(probs) ? probs : []).map((p, i) => {
      const v = Number(p);
      return isFinite(v) && v > 0 ? Math.min(0.999, v) * (w[i] || 0) : 0;
    });
  }

  function matchLambdas(probs, mins, xi) {
    return lambdasFromWeights(probs, minuteWeights(mins, xi));
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

  /* BOTH TEAMS TO GET n OR MORE CARDS — the generalisation of the above.
   *
   * probBothCarded is this at n = 1, and its shortcut (1 minus the product of
   * every player staying clean) only works at n = 1. For n >= 2 the side's
   * whole Poisson-binomial distribution is needed, which cardCountDist
   * already builds.
   *
   * THE TWO SIDES ARE TREATED AS INDEPENDENT, and that is an assumption, not
   * a derivation. They are not independent: one flashpoint books a man from
   * each team, and a referee losing control books five across both. The error
   * runs one way — real matches produce joint outcomes more often than
   * independence predicts — so this UNDERSTATES the true chance, and the
   * understatement grows with n. Treat BTC2 as a floor rather than a price,
   * the same caution the Guide already gives for O5.5 and above.
   */
  function probBothAtLeast(homePs, awayPs, n) {
    const need = Math.max(1, Math.floor(Number(n) || 1));
    const side = (ps) => {
      const dist = cardCountDist(ps);
      if (!dist || !dist.length) return 0;
      let acc = 0;
      for (let k = need; k < dist.length; k++) acc += dist[k];
      return Math.min(1, Math.max(0, acc));
    };
    return Math.min(1, Math.max(0, side(homePs) * side(awayPs)));
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
      /* Both sides on two or more. The liquid step up from BTC, and the one
         the desk had every input for and did not price. */
      bothTwo: probBothAtLeast(homePs, awayPs, 2),
    };
  }

  /* ---- accas over MATCH markets -----------------------------------------
   *
   * The desks already log a player acca — three men most likely to be booked
   * in a round. This is the same idea one level up: the markets on the board
   * above, one leg a match.
   *
   * TWO RULES, and they are the whole of it.
   *
   * ONE LEG PER MATCH. Over 3.5 and both-teams-carded in the same fixture are
   * two readings of one distribution: the outcomes that produce four cards are
   * largely the outcomes that book both sides. Multiplying them prices a
   * strong correlation as independence, which is the single most flattering
   * mistake an acca can make. So a board contributes at most one leg, and the
   * caller picks which.
   *
   * ACROSS MATCHES IS NOT INDEPENDENT EITHER — it is only much closer. Two
   * fixtures on one afternoon share nothing but the competition's temperament
   * and whatever a round of football has in common; different referees,
   * different players, different grounds. The residual correlation is positive
   * (a strict weekend is strict everywhere), so the product OVERSTATES a
   * multi-leg acca's chance slightly, in the opposite direction to BTC2's
   * floor. Both are stated where the number is printed.
   */
  function matchLegOptions(board) {
    if (!board) return [];
    const out = [];
    const push = (market, label, prob) => {
      const p = Number(prob);
      /* A leg at 0 or 1 is not a leg: one cannot be won and the other pays
         nothing, and both would poison the product. */
      if (isFinite(p) && p > 0 && p < 1) out.push({ market, label, prob: p });
    };
    push('BTC', 'Both teams carded', board.bothCarded);
    push('BTC2', 'Both teams 2+ cards', board.bothTwo);
    Object.keys(board.over || {}).forEach((line) => {
      push('O' + line, 'Over ' + line + ' cards', board.over[line]);
    });
    return out.sort((a, b) => b.prob - a.prob);
  }

  /* The same shape as matchLegOptions, over the GOALS markets the match model
     prices. Fed a simFixture() result, so the numbers are the fitted grid's
     own and not a second opinion about the same fixture.
   *
   * ONE SIDE OF THE MATCH ODDS, never both. Home-win and away-win are
   * mutually exclusive readings of one distribution — the most extreme
   * correlation on the board, and an acca that took both would be pricing a
   * guaranteed loser as a product of two live chances. The stronger side is
   * offered and the other is not on the list at all, so no caller can reach
   * it by accident. The draw is left out for the same reason.
   *
   * Note what this does NOT include: the two sides' individual over-lines and
   * correct score. They are on the same grid and would break the one-leg-per-
   * match rule from the inside if a caller took two of them. */
  function simLegOptions(sim, home, away) {
    if (!sim) return [];
    const out = [];
    const push = (market, label, prob) => {
      const p = Number(prob);
      if (isFinite(p) && p > 0 && p < 1) out.push({ market, label, prob: p });
    };
    const hp = Number(sim.home), ap = Number(sim.away);
    if (isFinite(hp) && isFinite(ap)) {
      const homeBest = hp >= ap;
      push('WIN', (homeBest ? (home || 'Home') : (away || 'Away')) + ' to win',
        homeBest ? hp : ap);
    }
    push('BTTS', 'Both teams to score', sim.btts);
    Object.keys(sim.over || {}).forEach((line) => {
      push('OG' + line, 'Over ' + line + ' goals', sim.over[line]);
    });
    return out.sort((a, b) => b.prob - a.prob);
  }

  /* ---- building a multi-market acca with no fixture used twice -----------
   *
   * The one-leg-per-match rule above says a board contributes at most one
   * leg. That is easy to honour for a single-market acca — take the top N
   * boards — and easy to get wrong the moment an acca spans markets, because
   * the fixture that tops the over-lines is very often the fixture that tops
   * both-teams-carded. Picking each market's best three independently is the
   * natural thing to write and it silently double-counts a fixture.
   *
   * So the allocation is the whole job here: fill every bucket's quota from
   * the boards available, using no fixture more than once, at the highest
   * joint probability the board allows.
   *
   * WHY NOT JUST TAKE EACH BUCKET'S BEST IN TURN. Filling buckets in order
   * spends the strongest fixtures on whichever market happens to be listed
   * first: a fixture can be the best available in two buckets at once, and
   * which bucket gets it should be decided by what the OTHER bucket loses,
   * not by the order the markets were written down in.
   *
   * BE HONEST ABOUT THE SIZE OF THAT. Measured on the 2026-27 opening round,
   * optimal allocation beat bucket-order by 0.59% of the joint probability —
   * real, and nearly a rounding difference. The optimisation is not why this
   * function exists. It exists because filling buckets independently REPEATS
   * A FIXTURE, and that is a correctness bug rather than a small loss; having
   * to solve the conflict anyway, solving it well costs little.
   *
   * SO IT IS SOLVED, NOT APPROXIMATED. Greedy runs first — it is a good
   * answer and it seeds the bound — then a branch-and-bound over the
   * remaining assignments improves it to the optimum. The search is bounded
   * by `maxNodes`; a board big enough to hit that cap keeps the greedy
   * answer and reports `exact: false`, so a slow page is never the failure
   * mode and a wrong claim about optimality never ships.
   *
   * Scored in LOG probability, not probability: the product of nine legs
   * around 0.6 is ~1e-2, and the comparisons that drive the pruning are
   * better behaved as a sum than as a float that small.
   *
   * `buckets` is [{ key, need, options: [{ id, prob, keys?, ... }] }].
   *
   * WHAT MUST NOT REPEAT IS THE CALLER'S TO DECLARE, via `keys` — a list of
   * exclusivity tokens, defaulting to [id]. Two options sharing any token
   * cannot both be picked. Options may carry any other fields; they come
   * back untouched.
   *
   * THE DEFAULT IS NOT ALWAYS ENOUGH, and finding that out cost a rendered
   * page. Excluding on the fixture id alone is exactly right for an acca over
   * ONE ROUND, where each club plays once and distinct fixtures therefore
   * means distinct clubs. Over a SEVEN-DAY WINDOW it is not: a club can play
   * twice, and the first build of the cross-league nine-fold duly took
   * "both teams carded" in two different Osasuna matches. Distinct fixtures,
   * both legs leaning on one side's discipline, priced as independent.
   *
   * So a caller whose window can contain a club twice passes both clubs as
   * keys, which subsumes fixture-distinctness — two legs on one match share
   * both clubs and collide on the first.
   */
  function accaAllocate(buckets, opts) {
    const tokens = (o) => (Array.isArray(o.keys) && o.keys.length
      ? o.keys.filter((k) => k != null).map(String)
      : [String(o.id)]);
    const bs = (Array.isArray(buckets) ? buckets : []).map((b) => ({
      key: b && b.key,
      need: Math.max(0, Math.floor(Number(b && b.need) || 0)),
      options: (b && Array.isArray(b.options) ? b.options : [])
        .filter((o) => o && (o.id != null || (Array.isArray(o.keys) && o.keys.length))
          && isFinite(Number(o.prob)) && Number(o.prob) > 0 && Number(o.prob) < 1)
        /* Sorted descending so the optimistic bound below is sound: the first
           `need` entries are the most any bucket could contribute. */
        .sort((x, y) => Number(y.prob) - Number(x.prob)),
    })).filter((b) => b.need > 0);
    if (!bs.length) return null;
    /* A bucket with fewer options than its quota cannot be filled, and a
       partly-filled acca is not the acca that was asked for. Null, not a
       short one — a five-leg answer to a nine-fold question is the kind of
       silent substitution the caller cannot see. */
    if (bs.some((b) => b.options.length < b.need)) return null;

    const lg = (o) => Math.log(Number(o.prob));

    /* GREEDY: repeatedly take the single best (bucket, fixture) still going.
       Note this cannot be improved by swapping a chosen option for an unused
       fixture within the same bucket — when that slot was filled, every
       still-unused fixture was already available and lost the comparison. So
       the only move that can improve it is a swap BETWEEN buckets, which is
       exactly what the search below explores. */
    const gPick = bs.map(() => []);
    const gUsed = new Set();
    for (;;) {
      let bi = -1, bo = null;
      for (let i = 0; i < bs.length; i++) {
        if (gPick[i].length >= bs[i].need) continue;
        for (const o of bs[i].options) {
          if (tokens(o).some((k) => gUsed.has(k))) continue;
          if (!bo || Number(o.prob) > Number(bo.prob)) { bi = i; bo = o; }
          break;   // options are sorted, so the first free one is this bucket's best
        }
      }
      if (bi < 0) break;
      gPick[bi].push(bo); tokens(bo).forEach((k) => gUsed.add(k));
    }

    /* GREEDY CAN STRAND ITSELF, and an incomplete greedy is not evidence the
       board is unfillable. Two buckets can both be able to price the same
       three fixtures while only one of them can price a fourth; greedy hands
       the shared fixture to whichever bucket wanted it most and leaves the
       narrow bucket a slot short, even though swapping would have filled
       both. So a short greedy seeds nothing and the search below decides
       feasibility — it is exhaustive, so a null from here means no assignment
       exists, not that the first heuristic gave up. */
    const gFull = gPick.every((p, i) => p.length === bs[i].need);
    let best = gFull ? gPick.map((a) => a.slice()) : null;
    let bestScore = gFull
      ? best.reduce((s, a) => s + a.reduce((t, o) => t + lg(o), 0), 0)
      : -Infinity;

    /* The most each bucket could score in isolation, and the suffix sums of
       that — an upper bound on everything still to be assigned. */
    const head = bs.map((b) => {
      let s = 0;
      for (let i = 0; i < b.need; i++) s += lg(b.options[i]);
      return s;
    });
    const tail = new Array(bs.length + 1).fill(0);
    for (let i = bs.length - 1; i >= 0; i--) tail[i] = tail[i + 1] + head[i];

    const cap = (opts && opts.maxNodes) || 400000;
    let nodes = 0, capped = false;
    const used = new Set();
    const pick = bs.map(() => []);

    function bucket(bi, score) {
      if (capped) return;
      if (bi === bs.length) {
        if (score > bestScore) { bestScore = score; best = pick.map((a) => a.slice()); }
        return;
      }
      if (score + tail[bi] <= bestScore) return;    // cannot catch up, whatever it picks
      combo(bi, 0, score);
    }
    /* Options are chosen in increasing index order within a bucket, so the
       three ways to write one set of three do not get searched three times. */
    function combo(bi, from, score) {
      if (capped) return;
      const b = bs[bi];
      if (pick[bi].length === b.need) { bucket(bi + 1, score); return; }
      if (++nodes > cap) { capped = true; return; }
      const last = b.options.length - (b.need - pick[bi].length);
      for (let i = from; i <= last; i++) {
        const o = b.options[i];
        const tk = tokens(o);
        if (tk.some((k) => used.has(k))) continue;
        tk.forEach((k) => used.add(k)); pick[bi].push(o);
        combo(bi, i + 1, score + lg(o));
        pick[bi].pop(); tk.forEach((k) => used.delete(k));
        if (capped) return;
      }
    }
    bucket(0, 0);
    if (!best) return null;      // no assignment fills every quota without repeating

    const groups = bs.map((b, i) => ({ key: b.key, options: best[i].slice() }));
    return { exact: !capped, groups, picks: groups.reduce((a, g) => a.concat(g.options), []) };
  }

  /* Price a set of legs. `margin` defaults to the card-market margin the app
     already models; the priced odds are what a book would actually offer, and
     the drag is how much of the fair price the margin takes once it has
     compounded over every leg — which is the honest argument against adding a
     fourth. */
  function accaPrice(legs, margin) {
    const ps = (Array.isArray(legs) ? legs : [])
      .map((l) => Number(l && typeof l === 'object' ? l.prob : l))
      .filter((p) => isFinite(p) && p > 0 && p < 1);
    if (ps.length < 2) return null;             // a single is not an acca
    const m = margin == null ? TYPICAL_CARD_MARGIN : Number(margin);
    const prob = ps.reduce((a, p) => a * p, 1);
    const fair = ps.reduce((a, p) => a / p, 1);
    const priced = ps.reduce((a, p) => a * ((1 / p) * (1 - m)), 1);
    return {
      legs: ps.length,
      prob,
      fairOdds: fair,
      pricedOdds: priced,
      marginDrag: fair > 0 ? 1 - priced / fair : 0,
    };
  }

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

  /* ---- derbies -----------------------------------------------------------
   * A MANUAL LIST, and it has to be: no feed carries "these two dislike each
   * other". Kept here so the backtest's control and any future display read
   * the same pairs.
   *
   * The four clusters named in the brief, plus fixtures with documented
   * rivalry history that happen to fall inside the 2026-27 division. Clubs
   * come and go — Wolves, West Ham and Burnley went down, so the West Midlands
   * cluster is Villa and Coventry this season and will be a different set next
   * — which is why this is a pair list rather than a cluster list.
   */
  const DERBIES = [
    ['LIV', 'EVE'],   // Merseyside
    ['ARS', 'TOT'],   // North London
    ['MCI', 'MUN'],   // Manchester
    ['AVL', 'COV'],   // West Midlands
    ['LIV', 'MUN'],   // North West
    ['NEW', 'SUN'],   // Tyne-Wear
    ['LEE', 'MUN'],   // Roses
    ['LEE', 'HUL'],   // Yorkshire
    ['CRY', 'BHA'],   // M23
    ['CHE', 'TOT'],   // London
    ['ARS', 'CHE'],   // London
    ['CHE', 'FUL'],   // West London
    ['BRE', 'FUL'],   // West London
  ];
  const DERBY_KEYS = new Set(DERBIES.map((p) => p.slice().sort().join('|')));

  function isDerby(home, away) {
    return DERBY_KEYS.has([String(home || ''), String(away || '')].sort().join('|'));
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

  const PLDCore = {
    rotationRisk, rotationBand,
    restDays, restBucket, previousMatch, euroAway72h, isDerby, DERBIES,
    REST_FRESH, REST_CONGESTED, EURO_AWAY_HOURS,
    riskScore, normName, matchRefName, refShort, pickPL, summarisePicks, calibrate, impliedProb, fairOdds, edgePct, LOGISTIC_SLOPE,
    per90, liveRate, joinLooksRight, foldLetters, MIN_LIVE_MINUTES,
    lineupMinutes, xiWeights, SUBS_USED, SUB_MINUTES,
    playerKeys, matchSquadName, lineupRoles, currentRound,
    marketProb, marketProbDeVig, valuePoint, TYPICAL_CARD_MARGIN, TYPICAL_GOAL_MARGIN,
    cardCountDist, probOverCards, expectedCards, probBothCarded, probBothAtLeast, teamCardMarkets,
    bookingPointsDist, expectedPoints, probOverPoints, leagueRedRate,
    bookingPointsMarkets, YELLOW_POINTS, RED_POINTS,
    minuteWeights, matchLambdas, lambdasFromWeights,
    venueFactor, chaseFactor, cardLambda, pCardFromLambda, pCardSeason,
    HOME_FACTOR, AWAY_FACTOR,
    simLambdas, simPoissonPmf, simScoreGrid, simOutcomes, simFixture, simResultShare,
    SIM_MAX_GOALS, SIM_GOAL_LINES,
    shrinkRate, logit, invLogit, scaleOdds, contextProb,
    pCardsAtLeast, suspensionCycle, nextSuspension,
    brier, logLoss, reliability, glmProb,
    gammaln, expectedFouls, nbTailProb, cardProbFromFouls, recencyWeight, refCardFactor,
    leagueRate90, twoStageHazard, sumNegBin,
    matchLegOptions, simLegOptions, accaAllocate, accaPrice,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLDCore;
  global.PLDCore = PLDCore;
})(typeof window !== 'undefined' ? window : globalThis);

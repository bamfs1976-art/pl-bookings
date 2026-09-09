/* Club colours — one table, four desks.
 *
 * WHAT THESE ARE. Each entry is the colour a supporter would name if you asked
 * what their club plays in: the primary shirt colour, or the badge colour where
 * the shirt is white (a white chip is an invisible chip). They are readable
 * approximations chosen to work as a solid block behind text, NOT licensed
 * brand values — no club has supplied a hex to this project, and none of these
 * should be presented as an official colour.
 *
 * WHY A MODULE. The Premier League desk kept its table inline and the other
 * three had none, which is why every stat sheet drew both of its halves in the
 * league's ink: assets/share.js falls back to the league colour when a spec
 * carries no palette, and no desk carried one. Four copies of a colour table
 * is the exact failure scripts/check-palette.mjs was written after — three
 * places naming a colour and two of them agreeing — so there is one table and
 * the desks read it.
 *
 * WHY NOT tw.css. The palette guard is right that the stylesheet is the only
 * place a TOKEN may be declared, and these are not tokens. They are data about
 * 64 clubs, they are needed by assets/share.js — which draws to a canvas and
 * so cannot read a stylesheet at all — and the set changes every summer with
 * promotion and relegation. scripts/check-share.mjs asserts every club in
 * every shipped dataset has an entry here, so the churn cannot go unnoticed.
 *
 * CONTRAST IS THE CALLER'S JOB, and there is one helper for it: textOn() in
 * assets/share.js and the CSS the desks use both pick black or white off the
 * colour's luminance, so Watford's yellow and Millwall's navy both come back
 * legible without an entry here saying which.
 */
(function (root) {
  'use strict';

  /* Premier League. Lifted verbatim from index.html, which is where it lived
     before three other desks needed it. */
  var PL = {
    ARS: '#EF0107', AVL: '#670E36', BOU: '#DA291C', BRE: '#E30613',
    BHA: '#0057B8', CHE: '#034694', CRY: '#1B458F', EVE: '#003399',
    FUL: '#1A1A1A', LEE: '#FFCD00', LIV: '#C8102E', MCI: '#6CABDD',
    MUN: '#DA291C', NEW: '#241F20', NFO: '#DD0000', SUN: '#EB172B',
    TOT: '#132257', COV: '#4B92DB', IPS: '#3A64A3', HUL: '#F7A800'
  };

  /* EFL Championship. Three of these play in white — Derby, Swansea, Preston —
     so they take the dark half of their pairing rather than the shirt. */
  var EFLC = {
    DER: '#1B1B1B', BLB: '#009EE0', WAT: '#FBEE23', CHA: '#D4021D',
    PRE: '#002F6C', STK: '#E03A3E', SWA: '#121212', NOR: '#FFF200',
    BIR: '#223B7B', POR: '#001489', MIL: '#001D5B', SOU: '#D71920',
    QPR: '#1D5BA4', SHU: '#EE2737', BRC: '#E21C38', WBA: '#122F67',
    WRE: '#FF0000', MID: '#DE1B22', WOL: '#FDB913', LIN: '#DA291C',
    BUR: '#6C1D45', BOL: '#263C7E', WHU: '#7A263A', CAR: '#0070B5'
  };

  /* La Liga. Real Madrid takes the blue of the badge for the same reason
     Swansea takes black: the shirt is white and a white block is not a mark. */
  var LL = {
    GET: '#005999', SEV: '#D81A20', RAY: '#E53027', ALA: '#0761AF',
    OSA: '#D91A21', ESP: '#007FC8', RSO: '#0067B1', LEV: '#0053A0',
    ATH: '#EE2523', ELC: '#007A3D', ATM: '#CB3524', VIL: '#FFD100',
    RMA: '#00529F', BET: '#00954C', CEL: '#8AC3EE', VAL: '#FF7F00',
    BAR: '#A50044', RAC: '#009B48', MAL: '#0B4EA2', DEP: '#0A5CA8'
  };

  /* Serie A, in the codes data/leagues.py assigns. Juventus and Udinese play
     in white and black and take the black; Parma's white shirt takes the
     badge's blue; Inter and Atalanta, both blue and black, take their blues,
     which are different enough to tell apart on a card. */
  var SA = {
    ATA: '#1E71B8', BGN: '#1A2F48', CAG: '#B01E23', COM: '#1E4A9E',
    CRE: '#C8102E', FIO: '#482E92', GEN: '#AE1C28', INT: '#0068A8',
    JUV: '#000000', LAZ: '#87D8F7', LEC: '#D0021B', ACM: '#FB090B',
    NAP: '#12A0D7', PAR: '#1B3F8B', PIS: '#0B3B79', ROM: '#8E1F2F',
    SAS: '#00A752', TOR: '#881425', UDI: '#000000', VER: '#003C82',
    EMP: '#0F5DA8', MON: '#E30613', VEN: '#F58220', SAM: '#0D4C9A',
    PAL: '#E7418D', BSC: '#1B3A93'
  };

  var BY = { PL: PL, EFLC: EFLC, LL: LL, SA: SA };

  /* One league's table, or an empty one. Empty rather than null on purpose:
     every caller passes the result straight to something that indexes it, and
     a missing league should cost a card its club colours, not throw. */
  function of(code) { return BY[code] || {}; }

  /* One club's colour, or null when this project has no entry for it. Null and
     not a default: a caller that wants the league's ink behind an unknown club
     already has the league's ink, and one that wants a hashed hue already has
     the hash — neither is this module's decision to make. */
  function colour(code, short) {
    var t = BY[code];
    return (t && t[short]) || null;
  }

  /* All three divisions in one lookup, for /today — which holds three datasets
     at once and draws crests for clubs from all of them in a single list, so
     it has nowhere to hang a per-league table. Safe only while no two DIFFERENT
     clubs share a short code across the three, which scripts/check-share.mjs
     asserts: a club that is promoted appears in two tables with one colour and
     merges harmlessly, but two clubs answering to the same three letters would
     silently take each other's colour. Cards on that page still use of(code) —
     the league is known there, so there is no reason to guess. */
  function merged() {
    var out = {}, k;
    for (k in PL) if (PL.hasOwnProperty(k)) out[k] = PL[k];
    for (k in EFLC) if (EFLC.hasOwnProperty(k)) out[k] = EFLC[k];
    for (k in LL) if (LL.hasOwnProperty(k)) out[k] = LL[k];
    for (k in SA) if (SA.hasOwnProperty(k)) out[k] = SA[k];
    return out;
  }

  var api = { of: of, colour: colour, merged: merged,
              PL: PL, EFLC: EFLC, LL: LL, SA: SA, leagues: BY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PLDClubColours = api;
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof window !== 'undefined' ? window : this);

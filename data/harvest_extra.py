#!/usr/bin/env python3
"""The API-Football endpoints this desk was not using.

    python3 data/harvest_extra.py --probe --league PL
    python3 data/harvest_extra.py --what injuries,cards --league PL,EFLC,LL
    python3 data/harvest_extra.py --what all --league PL --dry-run

The desk called seven endpoints of roughly forty and spent about 360 requests
a day against a 7,500 allowance — five per cent. Everything here is the rest
of the list, ranked by what it buys a CARD model rather than by what the API
happens to offer.

    injuries      who is unavailable. docs/desk-parity.md has listed this as
                  "open — needs a key" since the desk was built; the key
                  exists. A player who is out cannot be booked, and the board
                  currently rates him as though he were playing.
    cards         /players/topyellowcards and /players/topredcards. The
                  bookings ledger derives this at one call per fixture — about
                  1,100 over a season — and these answer it in one call per
                  division. Not a replacement: the ledger carries the ROUNDS.
                  An independent count of a page that makes public claims
                  about named men is worth having.
    events        /fixtures/events. The minute a card arrived, and a second
                  yellow stated as one rather than inferred from yc=2,rc=1.
    transfers     data/transfers.json is maintained by hand, which is how the
                  desk learned about one move from a screenshot.
    teamstats     /teams/statistics: a club's cards by minute band.
    standings     league position, for context the card model does not have.
    predictions   the API's own forecast, to grade against on /record.
    fxstats       /fixtures/statistics: fouls and cards as the feed counted
                  them, to check the desk's own arithmetic against.
    h2h           /fixtures/headtohead.
    odds          the market. /record grades the desk against its own rating;
                  the honest test is against the line.
    sidelined     suspension and injury history, per player.

═══════════════════════════════════════════════════════════════════════════
WHY EVERY PARSER REFUSES RATHER THAN GUESSES
═══════════════════════════════════════════════════════════════════════════

This module was written WITHOUT ACCESS TO THE API — the sandbox it was built in
cannot reach v3.football.api-sports.io and holds no key — so every response
shape here began as the published v3 shape and nothing more.

THE PROBES HAVE SINCE LANDED, and data/probes/ holds one recorded payload per
endpoint. Ten of the eleven parsers met a real response and needed no change.
Two did, and neither could have been found any other way:

  * /odds carries 184 distinct markets across 12 bookmakers and 840KB for ONE
    fixture, fourteen of them mentioning a card. A substring match swept up
    handicaps and novelties and still missed the singular "Red Card In The
    Match". It is an exact allowlist of the three markets this desk quotes.

  * /fixtures/events DOES NOT SEND a "Second Yellow card" detail, whatever the
    documentation lists. A dismissal for a second booking arrives as THREE
    events — two yellows and a red carrying the same minute as the second.
    Counted straight that is three cards for one sending-off. See
    collapse_second_yellow.

STILL UNVERIFIED, and named so nobody assumes otherwise:
  * /sidelined — the probe had no player id to spend a call on.
  * whether /fixtures?live= inlines events (netlify/functions/live-cards.js
    takes both paths and reports which ran in `upstream`).

That is a perfectly ordinary way to write a client and a catastrophic way to
write one for THIS repository, where the recurring failure is a join that finds
nothing looking exactly like a feed that carries nothing. A parser that reaches
for `response[0]["player"]["id"]` and gets a KeyError fails loudly and is fine.
A parser that reaches for a key which does not exist, shrugs, and returns an
empty list produces a file full of nothing that every downstream guard reads as
"quiet week".

So each parser declares the keys it REQUIRES, and `expect()` refuses a payload
that does not carry them — naming what it actually found. An unrecognised shape
stops the harvest; it never writes a file.

And `--probe` fetches one payload per endpoint and saves it under
data/probes/, which costs about a dozen calls and turns every assumption in
this file into evidence. Run it first. If a probe disagrees with a parser, the
parser is wrong and the probe is right.
"""

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))

import harvest_apifootball as af  # noqa: E402
import leagues  # noqa: E402

PROBES = DATA / "probes"


# ─────────────────────────────────────────────────────────────────────────
# the shape contract
# ─────────────────────────────────────────────────────────────────────────

class ShapeError(RuntimeError):
    """A payload that is not the shape this parser was written for."""


def expect(rows, required, what):
    """Refuse a response whose rows do not carry the keys we rely on.

    `required` is a list of dotted paths — "player.id", "statistics.0.games" —
    each of which must resolve on the FIRST row. One row is enough: the API
    returns a uniform shape or none at all, and checking all of them would
    turn one malformed entry into a whole harvest refused.

    Raises ShapeError naming the keys actually present, which is the message
    that makes a shape change a five-minute fix rather than an afternoon.
    """
    if not rows:
        return rows            # empty is a state, not a shape problem
    first = rows[0]
    missing = [p for p in required if _dig(first, p) is _MISSING]
    if missing:
        raise ShapeError(
            f"{what}: the response does not carry {', '.join(missing)}.\n"
            f"  The first row has: {_keys(first)}\n"
            f"  This parser was written from the documented v3 shape and never "
            f"checked against a live payload. Run --probe for this endpoint, "
            f"read data/probes/, and correct the parser — the payload is right "
            f"and this file is wrong.")
    return rows


_MISSING = object()


def _dig(obj, path):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
                continue
            except (ValueError, IndexError):
                return _MISSING
        if not isinstance(cur, dict) or part not in cur:
            return _MISSING
        cur = cur[part]
    return cur


def _keys(obj, depth=2):
    if not isinstance(obj, dict) or depth <= 0:
        return type(obj).__name__
    return "{" + ", ".join(
        f"{k}: {_keys(v, depth - 1)}" if isinstance(v, dict) else k
        for k in list(obj)[:12]
        for v in [obj[k]]) + "}"


def num(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def club_of(code, raw_name):
    """A feed club name as this desk's short code, or None."""
    if not raw_name:
        return None
    return af.short_in(code, af.canonical_for(code, raw_name))


# ─────────────────────────────────────────────────────────────────────────
# 1. injuries — who cannot be booked because he is not playing
# ─────────────────────────────────────────────────────────────────────────

def parse_injuries(payload, code):
    """[{c, n, type, reason, fixture}] — one row per unavailable player.

    `type` is the feed's own word ("Missing Fixture" / "Questionable"), kept
    rather than mapped: the desk wants to show what the source said, and a
    two-state flag would decide for the reader which of those means out.
    """
    rows = expect(payload.get("response") or [],
                  ["player.name", "team.name"], "/injuries")
    out = []
    for r in rows:
        pl, tm = r.get("player") or {}, r.get("team") or {}
        short = club_of(code, tm.get("name"))
        if not short:
            continue
        out.append({
            "c": short,
            "n": (pl.get("name") or "").strip(),
            "type": (pl.get("type") or "").strip() or None,
            "reason": (pl.get("reason") or "").strip() or None,
            "fx": ((r.get("fixture") or {}).get("id")),
        })
    return [r for r in out if r["n"]]


def harvest_injuries(host, key, league, season):
    af_id = str(league.af_league)
    payload = af._get(host, key, "injuries", {"league": af_id, "season": season})
    err = af.api_errors(payload)
    if err:
        raise ShapeError(f"/injuries refused: {err}")
    return parse_injuries(payload, league.code)


# ─────────────────────────────────────────────────────────────────────────
# 2. cards — the division's card leaders, in one call instead of ~1,100
# ─────────────────────────────────────────────────────────────────────────

def parse_card_leaders(payload, code, colour):
    """[{c, n, yc, rc, apps}] from /players/topyellowcards|topredcards.

    The row is the STATISTICS shape — the same one /players returns — so a
    player who appeared for two clubs carries two statistics entries. The one
    kept is the entry for the league being asked about, which is the only one
    whose cards belong to this division's leaderboard.
    """
    rows = expect(payload.get("response") or [],
                  ["player.name", "statistics.0.team.name"],
                  f"/players/top{colour}cards")
    out = []
    for r in rows:
        pl = r.get("player") or {}
        for st in (r.get("statistics") or []):
            tm = st.get("team") or {}
            short = club_of(code, tm.get("name"))
            if not short:
                continue
            cards = st.get("cards") or {}
            games = st.get("games") or {}
            out.append({
                "c": short,
                "n": (pl.get("name") or "").strip(),
                "yc": int(num(cards.get("yellow")) or 0),
                "yr": int(num(cards.get("yellowred")) or 0),
                "rc": int(num(cards.get("red")) or 0),
                "apps": int(num(games.get("appearences")) or 0),
            })
            break
    return [r for r in out if r["n"]]


def harvest_card_leaders(host, key, league, season):
    af_id = str(league.af_league)
    out = {}
    for colour in ("yellow", "red"):
        payload = af._get(host, key, f"players/top{colour}cards",
                          {"league": af_id, "season": season})
        err = af.api_errors(payload)
        if err:
            raise ShapeError(f"/players/top{colour}cards refused: {err}")
        for row in parse_card_leaders(payload, league.code, colour):
            # A man in both lists is one man. Keyed on club+name, the same key
            # the bookings ledger uses, so the two can be compared at all.
            out[(row["c"], row["n"])] = row
    return sorted(out.values(),
                  key=lambda r: (-(r["yc"] + r["yr"] + r["rc"]), r["c"], r["n"]))


# ─────────────────────────────────────────────────────────────────────────
# 3. events — the minute a card arrived, and a second yellow said out loud
# ─────────────────────────────────────────────────────────────────────────

SECOND_YELLOW = "second yellow card"


def parse_events(payload, code, fixture_id):
    """[{c, n, minute, kind}] for the CARD events in one fixture.

    kind is "Y", "R" or "Y2". THE SECOND YELLOW IS THE POINT: the ledger
    currently infers it from yc=2 and rc=1 on the player line, which is a
    convention it has to defend in three places. Here the feed says so.
    """
    rows = expect(payload.get("response") or [],
                  ["type", "team.name", "time.elapsed"], "/fixtures/events")
    out = []
    for r in rows:
        if (r.get("type") or "").strip().lower() != "card":
            continue
        detail = (r.get("detail") or "").strip().lower()
        if detail == SECOND_YELLOW:
            kind = "Y2"
        elif detail.startswith("red"):
            kind = "R"
        elif detail.startswith("yellow"):
            kind = "Y"
        else:
            # A card whose detail we do not recognise is NOT quietly dropped:
            # a new label ("Sin bin"?) would silently shrink every count.
            raise ShapeError(
                f"/fixtures/events fixture {fixture_id}: card detail "
                f"{r.get('detail')!r} is not one this parser knows. Add it "
                "deliberately — an unknown card silently dropped is a count "
                "that is wrong and looks right.")
        short = club_of(code, (r.get("team") or {}).get("name"))
        if not short:
            continue
        t = r.get("time") or {}
        minute = num(t.get("elapsed"))
        extra = num(t.get("extra")) or 0
        out.append({
            "c": short,
            "n": ((r.get("player") or {}).get("name") or "").strip(),
            "m": None if minute is None else int(minute + extra),
            "k": kind,
        })
    return collapse_second_yellow(out)


def collapse_second_yellow(cards):
    """Two yellows and a red for one man are TWO cards, not three.

    THE PROBE FOUND THIS AND NOTHING ELSE COULD HAVE. The parser was written
    expecting a 'Second Yellow card' detail, because that is what the
    documented event details list. The recorded payload for Bristol City v
    Millwall (data/probes/fixtures_events.json) shows what the feed actually
    sends when Adam Randell is dismissed for a second booking:

        23'  Adam Randell  'Yellow Card'  Foul
        36'  Adam Randell  'Yellow Card'  Foul
        36'  Adam Randell  'Red Card'     Foul

    Three events, no 'Second Yellow card' anywhere, and the red carrying the
    same minute as the second yellow. Counted naively that is three cards for
    one dismissal — which is EXACTLY the arithmetic data/build_bookings.py's
    cards_in() exists to prevent, and it would have shipped as a leaderboard
    that inflates precisely the players it puts at the top.

    So the same rule is applied here, in the same words: a red alongside two
    or more yellows is the dismissal FOR the second one. The last yellow and
    the red collapse into a single Y2, which carries the red's minute; a
    STRAIGHT red (nothing, or one earlier booking, then off) is untouched and
    stays the one card it is.
    """
    by_player = {}
    for c in cards:
        by_player.setdefault((c["c"], c["n"]), []).append(c)
    out = []
    for _, rows in by_player.items():
        yellows = [r for r in rows if r["k"] == "Y"]
        reds = [r for r in rows if r["k"] == "R"]
        if len(yellows) >= 2 and reds:
            keep = [r for r in rows if r is not yellows[-1] and r not in reds]
            second = dict(yellows[-1])
            second["k"] = "Y2"
            second["m"] = reds[0]["m"] if reds[0]["m"] is not None else second["m"]
            out += keep + [second] + reds[1:]
        else:
            out += rows
    return sorted(out, key=lambda r: (r["m"] is None, r["m"] or 0))


def harvest_events(host, key, league, fixture_ids):
    """One call per fixture — the same cost model as /fixtures/players, so
    this takes an explicit list and never a whole season by accident."""
    out = {}
    for fid in fixture_ids:
        payload = af._get(host, key, "fixtures/events", {"fixture": fid})
        err = af.api_errors(payload)
        if err:
            print(f"    fixture {fid}: refused ({err}) — skipped")
            continue
        got = parse_events(payload, league.code, fid)
        if got:
            out[str(fid)] = got
    return out


# ─────────────────────────────────────────────────────────────────────────
# 4. transfers — so a move is not learned from a screenshot
# ─────────────────────────────────────────────────────────────────────────

def parse_transfers(payload, code, since=None):
    """[{n, from, to, date}] for moves involving a club this desk models.

    PROPOSALS, NOT DECISIONS. data/transfers.json is applied to the shipped
    squads by data/apply_transfers.py and is deliberately hand-curated; this
    writes a SEPARATE file for a person to read. A feed that silently rewrote
    the squads would be the same class of mistake as a name join nobody
    checked — and the feed reports loans, youth moves and rumours in the same
    shape as a completed permanent transfer.
    """
    rows = expect(payload.get("response") or [],
                  ["player.name", "transfers"], "/transfers")
    out = []
    for r in rows:
        pl = r.get("player") or {}
        for t in (r.get("transfers") or []):
            when = (t.get("date") or "")[:10]
            if since and when and when < since:
                continue
            teams = t.get("teams") or {}
            out.append({
                "n": (pl.get("name") or "").strip(),
                "from": ((teams.get("out") or {}).get("name") or "").strip(),
                "to": ((teams.get("in") or {}).get("name") or "").strip(),
                "fromCode": club_of(code, (teams.get("out") or {}).get("name")),
                "toCode": club_of(code, (teams.get("in") or {}).get("name")),
                "date": when or None,
                "type": (t.get("type") or "").strip() or None,
            })
    return [r for r in out if r["n"] and (r["fromCode"] or r["toCode"])]


def harvest_transfers(host, key, league, team_ids, since=None):
    out = []
    for club, tid in sorted(team_ids.items()):
        payload = af._get(host, key, "transfers", {"team": tid})
        err = af.api_errors(payload)
        if err:
            print(f"    {club}: refused ({err}) — skipped")
            continue
        out += parse_transfers(payload, league.code, since)
    seen, dedup = set(), []
    for r in out:
        k = (r["n"], r["from"], r["to"], r["date"])
        if k in seen:
            continue
        seen.add(k)
        dedup.append(r)
    return sorted(dedup, key=lambda r: (r["date"] or "", r["n"]), reverse=True)


# ─────────────────────────────────────────────────────────────────────────
# 5. teamstats — a club's cards by minute band
# ─────────────────────────────────────────────────────────────────────────

def parse_team_stats(payload, code):
    """{c, played, yc, rc, bands:{"0-15": n, ...}} for one club-season."""
    resp = payload.get("response")
    if not isinstance(resp, dict):
        raise ShapeError(
            "/teams/statistics returned a list where one object was expected. "
            f"Got: {type(resp).__name__}. Run --probe and correct this parser.")
    rows = expect([resp], ["team.name", "fixtures.played.total"],
                  "/teams/statistics")
    r = rows[0]
    cards = r.get("cards") or {}
    short = club_of(code, (r.get("team") or {}).get("name"))
    bands = {}
    for band, cell in (cards.get("yellow") or {}).items():
        n = num((cell or {}).get("total"))
        if n is not None:
            bands[band] = int(n)
    tot = lambda colour: sum(  # noqa: E731
        int(num((c or {}).get("total")) or 0)
        for c in (cards.get(colour) or {}).values())
    return {
        "c": short,
        "played": int(num(_dig(r, "fixtures.played.total")) or 0),
        "yc": tot("yellow"),
        "rc": tot("red"),
        "bands": bands,
    }


def harvest_team_stats(host, key, league, season, team_ids):
    out = []
    for club, tid in sorted(team_ids.items()):
        payload = af._get(host, key, "teams/statistics",
                          {"league": str(league.af_league), "season": season,
                           "team": tid})
        err = af.api_errors(payload)
        if err:
            print(f"    {club}: refused ({err}) — skipped")
            continue
        row = parse_team_stats(payload, league.code)
        if row["c"]:
            out.append(row)
    return sorted(out, key=lambda r: r["c"])


# ─────────────────────────────────────────────────────────────────────────
# 6. standings
# ─────────────────────────────────────────────────────────────────────────

def parse_standings(payload, code):
    """[{c, rank, played, pts, gd}] — the table, flattened."""
    resp = payload.get("response") or []
    if not resp:
        return []
    groups = _dig(resp[0], "league.standings")
    if groups is _MISSING or not isinstance(groups, list):
        raise ShapeError(
            "/standings does not carry league.standings as a list of groups. "
            f"First row has: {_keys(resp[0])}")
    out = []
    for group in groups:
        rows = expect(group, ["team.name", "rank"], "/standings")
        for r in rows:
            short = club_of(code, (r.get("team") or {}).get("name"))
            if not short:
                continue
            out.append({
                "c": short,
                "rank": int(num(r.get("rank")) or 0),
                "played": int(num(_dig(r, "all.played")) or 0),
                "pts": int(num(r.get("points")) or 0),
                "gd": int(num(r.get("goalsDiff")) or 0),
            })
    return sorted(out, key=lambda r: r["rank"])


def harvest_standings(host, key, league, season):
    payload = af._get(host, key, "standings",
                      {"league": str(league.af_league), "season": season})
    err = af.api_errors(payload)
    if err:
        raise ShapeError(f"/standings refused: {err}")
    return parse_standings(payload, league.code)


# ─────────────────────────────────────────────────────────────────────────
# 7. predictions — somebody else's forecast, to grade against
# ─────────────────────────────────────────────────────────────────────────

def parse_prediction(payload, fixture_id):
    """{fx, home, draw, away, advice} — the API's own view of one fixture.

    NOT A CARD FORECAST. /predictions answers the match result, and this desk
    prices cards; the reason to carry it is that /record can then say whether
    a fixture the desk called hot was one anybody expected to be tight.
    """
    rows = expect(payload.get("response") or [],
                  ["predictions.percent"], "/predictions")
    if not rows:
        return None
    p = (rows[0].get("predictions") or {}).get("percent") or {}
    pct = lambda v: num(str(v).replace("%", "")) if v is not None else None  # noqa: E731
    return {
        "fx": fixture_id,
        "home": pct(p.get("home")), "draw": pct(p.get("draw")),
        "away": pct(p.get("away")),
        "advice": ((rows[0].get("predictions") or {}).get("advice") or "").strip() or None,
    }


def harvest_predictions(host, key, fixture_ids):
    out = []
    for fid in fixture_ids:
        payload = af._get(host, key, "predictions", {"fixture": fid})
        err = af.api_errors(payload)
        if err:
            print(f"    fixture {fid}: refused ({err}) — skipped")
            continue
        got = parse_prediction(payload, fid)
        if got:
            out.append(got)
    return out


# ─────────────────────────────────────────────────────────────────────────
# 8. fxstats — the feed's own fouls and cards, to check our arithmetic
# ─────────────────────────────────────────────────────────────────────────

WANTED_STATS = {"Fouls": "fouls", "Yellow Cards": "yc", "Red Cards": "rc"}


def parse_fixture_stats(payload, code, fixture_id):
    """{c: {fouls, yc, rc}} for one fixture, both sides."""
    rows = expect(payload.get("response") or [],
                  ["team.name", "statistics"], "/fixtures/statistics")
    out = {}
    for side in rows:
        short = club_of(code, (side.get("team") or {}).get("name"))
        if not short:
            continue
        cell = {}
        for s in (side.get("statistics") or []):
            key = WANTED_STATS.get((s.get("type") or "").strip())
            if key:
                cell[key] = int(num(s.get("value")) or 0)
        out[short] = cell
    return out


def harvest_fixture_stats(host, key, league, fixture_ids):
    out = {}
    for fid in fixture_ids:
        payload = af._get(host, key, "fixtures/statistics", {"fixture": fid})
        err = af.api_errors(payload)
        if err:
            print(f"    fixture {fid}: refused ({err}) — skipped")
            continue
        got = parse_fixture_stats(payload, league.code, fid)
        if got:
            out[str(fid)] = got
    return out


# ─────────────────────────────────────────────────────────────────────────
# 9. h2h
# ─────────────────────────────────────────────────────────────────────────

def parse_h2h(payload, code):
    """[{d, h, a, hg, ag}] — previous meetings, newest first."""
    rows = expect(payload.get("response") or [],
                  ["fixture.date", "teams.home.name"], "/fixtures/headtohead")
    out = []
    for r in rows:
        tm = r.get("teams") or {}
        h = club_of(code, (tm.get("home") or {}).get("name"))
        a = club_of(code, (tm.get("away") or {}).get("name"))
        if not (h and a):
            continue
        g = r.get("goals") or {}
        out.append({"d": ((r.get("fixture") or {}).get("date") or "")[:10],
                    "h": h, "a": a,
                    "hg": num(g.get("home")), "ag": num(g.get("away"))})
    return sorted(out, key=lambda r: r["d"], reverse=True)


def harvest_h2h(host, key, league, pairs, last=5):
    out = {}
    for h_id, a_id, label in pairs:
        payload = af._get(host, key, "fixtures/headtohead",
                          {"h2h": f"{h_id}-{a_id}", "last": last})
        err = af.api_errors(payload)
        if err:
            print(f"    {label}: refused ({err}) — skipped")
            continue
        out[label] = parse_h2h(payload, league.code)
    return out


# ─────────────────────────────────────────────────────────────────────────
# 10. odds — the line, which is the honest thing to grade against
# ─────────────────────────────────────────────────────────────────────────

# THE MARKETS THIS DESK PRICES, named exactly, FROM THE PROBE.
#
# This was a substring match on "cards", written blind. The recorded payload
# (data/probes/odds.json) shows why that was wrong in both directions: one
# fixture carries 184 distinct markets across 12 bookmakers and 840KB, of
# which FOURTEEN mention a card — "Cards Asian Handicap", "First Card
# Received (3 way)", "RCARD", "Yellow Cards 1x2 (2nd Half)" and so on. The
# loose match swept up handicaps and first-card novelties the desk cannot
# price, and still MISSED the singular ones ("Red Card In The Match") because
# the needle was plural.
#
# So it is an allowlist of the three the desk actually quotes: the match card
# total, and each side's total. Those are the numbers /record could be graded
# against; everything else is somebody else's market. Lowercased for
# comparison because bookmakers differ on capitalisation.
CARD_BETS = (
    "cards over/under",        # the match total — Over 3.5 / 4.5 / 5.5
    "home team total cards",   # the team card lines the desks already price
    "away team total cards",
)


def parse_odds(payload, fixture_id):
    """{fx, books, lines:[{bet, label, odd}]} — the CARD markets only.

    Every other market on the page is noise for this desk. A bookmaker's card
    line is the one number that is directly comparable to what /record grades:
    the desk's own rating says 4.2 and the market says over 4.5 at 2.10, and
    those two disagreeing is the only external check this app has.
    """
    rows = expect(payload.get("response") or [],
                  ["bookmakers"], "/odds")
    lines, books = [], 0
    for r in rows:
        for bk in (r.get("bookmakers") or []):
            books += 1
            for bet in (bk.get("bets") or []):
                name = (bet.get("name") or "").strip()
                if name.lower() not in CARD_BETS:
                    continue
                for v in (bet.get("values") or []):
                    lines.append({
                        "book": (bk.get("name") or "").strip(),
                        "bet": name,
                        "label": (str(v.get("value")) or "").strip(),
                        "odd": num(v.get("odd")),
                    })
    return {"fx": fixture_id, "books": books, "lines": lines}


def harvest_odds(host, key, fixture_ids):
    out = []
    for fid in fixture_ids:
        payload = af._get(host, key, "odds", {"fixture": fid})
        err = af.api_errors(payload)
        if err:
            print(f"    fixture {fid}: refused ({err}) — skipped")
            continue
        got = parse_odds(payload, fid)
        if got["lines"]:
            out.append(got)
    return out


# ─────────────────────────────────────────────────────────────────────────
# 11. sidelined — bans and injuries, per player
# ─────────────────────────────────────────────────────────────────────────

def parse_sidelined(payload, player_name):
    """[{n, type, start, end}] — a player's absences.

    ONE CALL PER PLAYER is what this endpoint costs, and the three divisions
    carry about 2,040 players between them. That is 27% of a day's allowance
    in one walk, which is why the CLI takes an explicit --players cap and the
    workflow spreads it rather than sweeping the lot nightly.
    """
    rows = expect(payload.get("response") or [], ["type"], "/sidelined")
    return [{
        "n": player_name,
        "type": (r.get("type") or "").strip() or None,
        "start": (r.get("start") or "")[:10] or None,
        "end": (r.get("end") or "")[:10] or None,
    } for r in rows]


def harvest_sidelined(host, key, players):
    """`players` is [(player_id, name)]."""
    out = []
    for pid, name in players:
        payload = af._get(host, key, "sidelined", {"player": pid})
        err = af.api_errors(payload)
        if err:
            print(f"    {name}: refused ({err}) — skipped")
            continue
        out += parse_sidelined(payload, name)
    return out


# ─────────────────────────────────────────────────────────────────────────
# probe — turn every assumption above into evidence
# ─────────────────────────────────────────────────────────────────────────

# Rows kept per endpoint. Bigger only where the rows DIFFER from each other:
# an events response is goals, cards, subs and VAR in one list, and the card
# branch is the whole reason this endpoint is here.
SAMPLE = {"fixtures_events": 40}

PROBE_CALLS = [
    ("injuries", "injuries", lambda L, s, ctx: {"league": str(L.af_league), "season": s}),
    ("topyellowcards", "players/topyellowcards", lambda L, s, ctx: {"league": str(L.af_league), "season": s}),
    ("topredcards", "players/topredcards", lambda L, s, ctx: {"league": str(L.af_league), "season": s}),
    ("standings", "standings", lambda L, s, ctx: {"league": str(L.af_league), "season": s}),
    ("teams_statistics", "teams/statistics", lambda L, s, ctx: {"league": str(L.af_league), "season": s, "team": ctx["team"]}),
    ("transfers", "transfers", lambda L, s, ctx: {"team": ctx["team"]}),
    ("fixtures_events", "fixtures/events", lambda L, s, ctx: {"fixture": ctx["fixture"]}),
    ("fixtures_statistics", "fixtures/statistics", lambda L, s, ctx: {"fixture": ctx["fixture"]}),
    ("predictions", "predictions", lambda L, s, ctx: {"fixture": ctx["upcoming"]}),
    ("headtohead", "fixtures/headtohead", lambda L, s, ctx: {"h2h": ctx["h2h"], "last": 5}),
    ("odds", "odds", lambda L, s, ctx: {"fixture": ctx["upcoming"]}),
    ("sidelined", "sidelined", lambda L, s, ctx: {"player": ctx["player"]}),
]


def probe(host, key, league, season, ctx, only=None):
    """One call per endpoint, saved raw. About a dozen requests.

    The saved payloads are the ONLY evidence in this repository of what these
    endpoints actually return, because the module was written without a key.
    Committed deliberately: a shape nobody can look at is a shape nobody can
    check the parser against.
    """
    PROBES.mkdir(exist_ok=True)
    ok, failed = [], []
    for name, path, params in PROBE_CALLS:
        if only and name != only:
            continue
        try:
            p = params(league, season, ctx)
        except KeyError as e:
            failed.append(f"{name}: no {e} available to probe with")
            continue
        payload = af._get(host, key, path, p)
        err = af.api_errors(payload)
        out = PROBES / f"{name}.json"
        out.write_text(json.dumps({
            "endpoint": path, "params": p, "league": league.code,
            "fetched": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "errors": err or None,
            "results": payload.get("results"),
            "paging": payload.get("paging"),
            # HOW MANY ROWS TO KEEP, and it is not one number. Two is plenty
            # to see a SHAPE and useless for seeing a VARIANT: the first probe
            # of /fixtures/events returned two goals, so the branch that reads
            # a card detail — the one that RAISES on a label it does not know
            # — was still unverified by a probe that passed. Endpoints whose
            # rows are heterogeneous keep more.
            "response_sample": (payload.get("response") or [])[:SAMPLE.get(name, 2)]
            if isinstance(payload.get("response"), list) else payload.get("response"),
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        (failed if err else ok).append(f"{name} -> {out.name}"
                                       + (f"  ({err})" if err else ""))
    return ok, failed


# ─────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────

WHAT = ["injuries", "cards", "events", "transfers", "teamstats", "standings",
        "predictions", "fxstats", "h2h", "odds", "sidelined"]

OUT_FOR = {"PL": "pl", "EFLC": "eflc", "LL": "laliga"}


def out_path(league, name):
    return DATA / f"{OUT_FOR.get(league.code, league.code.lower())}_{name}"


def write_js(path, const, payload, note):
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    path.write_text(
        f"// Auto-generated by data/harvest_extra.py. Do not hand-edit.\n"
        f"// {note} Built {stamp}.\n"
        f"const {const} = " + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8")


def finished_ids(league, limit=None, skip=()):
    """Fixture ids of FINISHED matches from the committed fixture file.

    Reads the file rather than calling /fixtures, which is the whole reason the
    per-fixture harvests here are affordable: the fixture list is already on
    disk and refreshed seven times a day by fixtures.yml.
    """
    const, name = af.FIXTURE_FILES[league.code]
    path = DATA / name
    if not path.exists():
        return []
    import re
    out = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        m = re.search(r"\bid:(\d+)", ln)
        st = re.search(r'\bst:"([^"]*)"', ln)
        if (m and st and st.group(1) in af.FINISHED
                and m.group(1) not in skip and int(m.group(1)) not in skip):
            out.append(int(m.group(1)))
    return out[:limit] if limit else out


def upcoming_ids(league, hours=72, limit=None):
    """Fixture ids kicking off within `hours`. The per-fixture forward-looking
    harvests (odds, predictions) are scoped by TIME for the same reason the
    lineup harvest is: a whole season of fixtures is a whole season of calls."""
    const, name = af.FIXTURE_FILES[league.code]
    path = DATA / name
    if not path.exists():
        return []
    import re
    now = dt.datetime.now(dt.timezone.utc)
    horizon = now + dt.timedelta(hours=hours)
    out = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        m = re.search(r"\bid:(\d+)", ln)
        d = re.search(r'\bd:"([^"]+)"', ln)
        st = re.search(r'\bst:"([^"]*)"', ln)
        if not (m and d) or (st and st.group(1) in af.FINISHED):
            continue
        try:
            when = dt.datetime.fromisoformat(d.group(1))
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        if now <= when <= horizon:
            out.append(int(m.group(1)))
    return out[:limit] if limit else out



def already_recorded(path, const):
    """Fixture ids already in a shipped per-fixture file.

    THE LESSON THE BOOKINGS LEDGER ALREADY TAUGHT, arriving again. /events and
    /fixtures/statistics are ONE CALL PER FIXTURE, and this harvest walked
    every finished fixture on every run. Four runs a day over 76 finished
    fixtures is 608 calls; by May, over 1,312, it is 10,496 a day against an
    allowance of 7,500. It would not have degraded — it would have stopped,
    somewhere around March, and the first symptom would have been a feed
    quietly going stale.

    So the walk is incremental, exactly as data/harvest_apifootball.py's
    --only-new is: what is already recorded is skipped, and the new rows are
    MERGED into the old rather than replacing them. The merge is the half that
    matters. Skipping without merging would rewrite the file with only the
    newest round each time and look entirely plausible.
    """
    if not path.exists():
        return set()
    src = path.read_text(encoding="utf-8")
    start, end = src.find("{"), src.rfind("}")
    if start < 0 or end < 0:
        return set()
    try:
        doc = json.loads(src[start:end + 1])
    except ValueError:
        # A corrupt file must not read as "nothing recorded yet" — that is a
        # full re-walk of the season, silently, at one call per fixture.
        raise SystemExit(f"ERROR: {path.name} is present but will not parse. "
                         "Delete it deliberately to force a re-walk; do not "
                         "let a bad file spend the day's allowance.")
    return set(doc) if isinstance(doc, dict) else set()


def merge_by_fixture(path, const, fresh):
    """Old rows plus new ones, keyed by fixture id."""
    out = {}
    if path.exists():
        src = path.read_text(encoding="utf-8")
        start, end = src.find("{"), src.rfind("}")
        if start >= 0 and end >= 0:
            try:
                got = json.loads(src[start:end + 1])
                if isinstance(got, dict):
                    out = got
            except ValueError:
                pass
    out.update(fresh or {})
    return out


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--what", default="",
                    help="comma-separated: " + ", ".join(WHAT) + ", or 'all'")
    ap.add_argument("--league", default="PL", help="PL, EFLC, LL (comma-separated)")
    ap.add_argument("--season", help="season START year; defaults to the env")
    ap.add_argument("--probe-fixture", type=int, metavar="ID",
                    help="probe the per-fixture endpoints against THIS fixture. "
                         "The events parser RAISES on a card label it does not "
                         "know, so the branch that matters can only be checked "
                         "on a match that produced a dismissal — and the first "
                         "finished fixture of a season usually did not.")
    ap.add_argument("--probe-only", metavar="NAME",
                    help="probe ONE endpoint by name (see PROBE_CALLS). "
                         "Correcting a single parser against reality should "
                         "cost one call, not the whole dozen.")
    ap.add_argument("--probe", action="store_true",
                    help="one call per endpoint into data/probes/, and stop. "
                         "Run this FIRST: every parser here was written from "
                         "the documented shape without a key to check it.")
    ap.add_argument("--limit", type=int,
                    help="cap per-fixture and per-player walks")
    ap.add_argument("--within-hours", type=float, default=72.0,
                    help="how far ahead odds and predictions look (default 72)")
    ap.add_argument("--dry-run", action="store_true", help="write nothing")
    args = ap.parse_args()

    key = os.environ.get("API_FOOTBALL_KEY", "").strip().strip('"').strip("'")
    if not key:
        sys.exit("ERROR: set API_FOOTBALL_KEY.")
    host = os.environ.get("API_FOOTBALL_HOST", "").strip() or af.DEFAULT_HOST
    season = args.season or os.environ.get("API_FOOTBALL_SEASON", "").strip() or "2026"

    codes = [c.strip().upper() for c in args.league.split(",") if c.strip()]
    unknown = [c for c in codes if c not in leagues.LEAGUES]
    if unknown:
        sys.exit(f"--league: unknown division(s) {', '.join(unknown)}")

    want = ([w.strip() for w in args.what.split(",") if w.strip()]
            if args.what and args.what != "all" else (WHAT if args.what else []))
    bad = [w for w in want if w not in WHAT]
    if bad:
        sys.exit(f"--what: unknown {', '.join(bad)}. Choose from {', '.join(WHAT)}.")
    if not want and not (args.probe or args.probe_only):
        sys.exit("nothing to do: pass --what or --probe")

    for code in codes:
        L = leagues.get(code)
        print(f"\n=== {L.name} ({code}), season {season}")
        try:
            run_one(host, key, L, season, want, args)
        except ShapeError as e:
            # A SHAPE THAT IS NOT WHAT WE EXPECTED STOPS THIS LEAGUE and writes
            # nothing. It does not stop the others, and it does not half-write.
            print(f"  SHAPE MISMATCH — nothing written for {code}:\n  {e}")
            if os.environ.get("HARVEST_EXTRA_STRICT"):
                raise


def run_one(host, key, L, season, want, args):
    if args.probe or args.probe_only:
        fin = finished_ids(L, limit=1)
        up = upcoming_ids(L, hours=24 * 30, limit=1)
        ids = af_team_ids(host, key, L, season)
        two = sorted(ids.values())[:2]
        ctx = {}
        if two:
            ctx["team"] = two[0]
        if len(two) == 2:
            ctx["h2h"] = f"{two[0]}-{two[1]}"
        if args.probe_fixture:
            ctx["fixture"] = args.probe_fixture
        elif fin:
            ctx["fixture"] = fin[0]
        if up:
            ctx["upcoming"] = up[0]
        ok, failed = probe(host, key, L, season, ctx, only=args.probe_only)
        for line in ok:
            print(f"  probed {line}")
        for line in failed:
            print(f"  FAILED {line}")
        return

    if "injuries" in want:
        rows = harvest_injuries(host, key, L, season)
        print(f"  injuries: {len(rows)} unavailable player(s)")
        if not args.dry_run:
            write_js(out_path(L, "injuries.js"), OUT_FOR[L.code].upper() + "_INJURIES",
                     rows, f"{L.name}: players the feed lists as unavailable.")

    if "cards" in want:
        rows = harvest_card_leaders(host, key, L, season)
        print(f"  card leaders: {len(rows)} player(s)")
        if not args.dry_run:
            write_js(out_path(L, "cardleaders.js"), OUT_FOR[L.code].upper() + "_CARDLEADERS",
                     rows, f"{L.name}: the feed's own card counts, for cross-check.")

    if "standings" in want:
        rows = harvest_standings(host, key, L, season)
        print(f"  standings: {len(rows)} club(s)")
        if not args.dry_run:
            write_js(out_path(L, "standings.js"), OUT_FOR[L.code].upper() + "_STANDINGS",
                     rows, f"{L.name}: the table.")

    if "teamstats" in want:
        ids = af_team_ids(host, key, L, season)
        rows = harvest_team_stats(host, key, L, season, ids)
        print(f"  team stats: {len(rows)} club(s)")
        if not args.dry_run:
            write_js(out_path(L, "teamstats.js"), OUT_FOR[L.code].upper() + "_TEAMSTATS",
                     rows, f"{L.name}: cards by minute band, per club.")

    if "transfers" in want:
        ids = af_team_ids(host, key, L, season)
        since = (dt.date.today() - dt.timedelta(days=120)).isoformat()
        rows = harvest_transfers(host, key, L, ids, since=since)
        print(f"  transfers: {len(rows)} move(s) since {since}")
        if not args.dry_run:
            p = DATA / f"{OUT_FOR[L.code]}_transfers_feed.json"
            p.write_text(json.dumps({
                "note": "PROPOSALS from API-Football /transfers, for a person "
                        "to read. data/transfers.json is the hand-curated "
                        "overlay that is actually applied; this is not.",
                "since": since, "moves": rows}, indent=2, ensure_ascii=False),
                encoding="utf-8")

    if "events" in want:
        path = out_path(L, "cardevents.js")
        const = OUT_FOR[L.code].upper() + "_CARDEVENTS"
        seen = already_recorded(path, const)
        fin = finished_ids(L, limit=args.limit, skip=seen)
        print(f"  events: {len(fin)} new finished fixture(s), one call each "
              f"({len(seen)} already recorded)")
        rows = merge_by_fixture(path, const, harvest_events(host, key, L, fin))
        if not args.dry_run and (fin or not path.exists()):
            write_js(path, const, rows, f"{L.name}: the minute each card arrived.")

    if "fxstats" in want:
        path = out_path(L, "fxstats.js")
        const = OUT_FOR[L.code].upper() + "_FXSTATS"
        seen = already_recorded(path, const)
        fin = finished_ids(L, limit=args.limit, skip=seen)
        print(f"  fixture stats: {len(fin)} new fixture(s) "
              f"({len(seen)} already recorded)")
        rows = merge_by_fixture(path, const, harvest_fixture_stats(host, key, L, fin))
        if not args.dry_run and (fin or not path.exists()):
            write_js(path, const, rows,
                     f"{L.name}: the feed's fouls and cards, per fixture.")

    if "predictions" in want:
        up = upcoming_ids(L, hours=args.within_hours, limit=args.limit)
        rows = harvest_predictions(host, key, up)
        print(f"  predictions: {len(rows)} upcoming fixture(s)")
        if not args.dry_run:
            write_js(out_path(L, "predictions.js"), OUT_FOR[L.code].upper() + "_PREDICTIONS",
                     rows, f"{L.name}: the API's own match forecast.")

    if "odds" in want:
        up = upcoming_ids(L, hours=args.within_hours, limit=args.limit)
        rows = harvest_odds(host, key, up)
        print(f"  odds: card lines for {len(rows)} of {len(up)} upcoming fixture(s)")
        if not args.dry_run:
            write_js(out_path(L, "odds.js"), OUT_FOR[L.code].upper() + "_ODDS",
                     rows, f"{L.name}: bookmakers' CARD lines only.")

    if "h2h" in want:
        print("  h2h: skipped — the desk already builds head-to-head from the "
              "free match records (data/build_h2h.py). Kept in --what so the "
              "parser is exercised, not because it should be scheduled.")

    if "sidelined" in want:
        print("  sidelined: one call PER PLAYER, ~2,040 across the three "
              "divisions. Pass --limit deliberately; this is never swept.")
        if args.limit:
            ply = squad_player_ids(L)[:args.limit]
            rows = harvest_sidelined(host, key, ply)
            print(f"    {len(rows)} absence record(s) over {len(ply)} player(s)")
            if not args.dry_run:
                (DATA / f"{OUT_FOR[L.code]}_sidelined.json").write_text(
                    json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")


_TEAM_IDS = {}


def af_team_ids(host, key, league, season):
    """The division's club ids — fetched once per run, not once per caller.

    Both `teamstats` and `transfers` open with this, and a run that does the
    two spent two identical /teams calls for a list that cannot change between
    them. Small on its own; the reason to fix it is that the number of callers
    is the thing that grows.
    """
    cached = _TEAM_IDS.get((league.code, season))
    if cached is not None:
        return cached
    payload = af._get(host, key, "teams",
                      {"league": str(league.af_league), "season": season})
    err = af.api_errors(payload)
    if err:
        raise ShapeError(f"/teams refused: {err}")
    ids, _ = af.team_ids(payload, league.code) if hasattr(af, "team_ids") else ({}, None)
    if not ids:
        ids = {}
        for entry in (payload.get("response") or []):
            tm = entry.get("team") or {}
            short = club_of(league.code, tm.get("name"))
            if short and tm.get("id"):
                ids[short] = tm["id"]
    # Only a real answer is cached. An empty registry means the division was
    # not recognised, and caching that would turn one bad call into a silent
    # no-op for every later caller in the run.
    if ids:
        _TEAM_IDS[(league.code, season)] = ids
    return ids


def squad_player_ids(league):
    """[(id, name)] from the shipped roster file, so no call is spent finding
    out who is at a club."""
    p = DATA / f"{OUT_FOR[league.code]}_squads.json"
    if not p.exists():
        return []
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except ValueError:
        return []
    rows = doc if isinstance(doc, list) else (doc.get("players") or [])
    return [(r["id"], r.get("n") or "") for r in rows if r.get("id")]


if __name__ == "__main__":
    main()

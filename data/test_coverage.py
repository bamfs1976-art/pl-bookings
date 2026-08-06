#!/usr/bin/env python3
"""Tests for the promoted-club coverage guards.

Run: python3 data/test_coverage.py   (wired into CI)

These guard the one part of the pipeline with no Premier League fallback. The
promoted clubs' form comes from the Championship feed, and when that feed came
back thin nothing noticed: the shipped dataset carried six forwards and no
defender for the three clubs, for a year, while every count-based check
passed. So the tests below are mostly about the shapes that LOOK fine.
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data as B  # noqa: E402
import harvest as H  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print("  ok - " + name)


def row(club, pos, name):
    return {"c": club, "p": pos, "n": name}


def full_squad(club, n=None):
    """A squad that should pass: every position, over the floor."""
    n = n or B.MIN_SQUAD
    out = [row(club, "GK", club + "-gk"), row(club, "DF", club + "-df"),
           row(club, "MF", club + "-mf"), row(club, "FW", club + "-fw")]
    while len(out) < n:
        out.append(row(club, "DF", club + "-d" + str(len(out))))
    return out


print("coverage_problems (the build guard)")


def _clean():
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    assert B.coverage_problems(rows) == [], B.coverage_problems(rows)


t("a full squad for every promoted club is clean", _clean)


def _historical():
    """The hole that actually shipped, reproduced exactly: six forwards
    across the three clubs and nothing else. Every one of them must be
    reported, and by name — a single 'data is bad' line would not have told
    anyone which club to go and fetch."""
    rows = [row("HUL", "FW", "McBurnie"), row("HUL", "FW", "Gelhardt"),
            row("COV", "FW", "Wright"), row("COV", "FW", "Simms"),
            row("COV", "FW", "Thomas-Asante"),
            row("IPS", "FW", "Clarke")]
    probs = B.coverage_problems(rows)
    assert len(probs) == 6, probs          # three thin squads + three missing-position lines
    joined = " | ".join(probs)
    for club in ("HUL", "COV", "IPS"):
        assert club in joined, joined
    assert "GK, DF, MF" in joined, joined   # the missing positions are named
    assert "2 players" in joined and "3 players" in joined, joined
    assert "1 player," in joined, joined   # not "1 players"


t("the six-forwards hole that shipped is caught, club by club", _historical)


def _count_is_not_enough():
    """The load-bearing case. A club can clear the squad floor and still be
    useless: twenty forwards is not a squad, and a row count cannot tell."""
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    rows = [r for r in rows if r["c"] != "IPS"]
    rows += [row("IPS", "FW", "f" + str(i)) for i in range(B.MIN_SQUAD + 5)]
    probs = B.coverage_problems(rows)
    assert len(probs) == 1, probs
    assert probs[0] == "IPS: no GK, DF, MF in the squad", probs[0]


t("a big squad of only forwards is still a problem", _count_is_not_enough)


def _absent_club():
    rows = full_squad("COV") + full_squad("HUL")
    probs = B.coverage_problems(rows)
    assert any(p.startswith("IPS: no players at all") for p in probs), probs


t("a club missing entirely says so plainly", _absent_club)


def _ignores_others():
    """Premier League clubs are not this guard's business — they have their
    own feed and their own CI floor."""
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    rows.append(row("ARS", "FW", "lone-gunner"))
    assert B.coverage_problems(rows) == []


t("a thin PL club is not reported here", _ignores_others)


def _tolerates_junk():
    rows = []
    for c in sorted(B.PROMOTED):
        rows += full_squad(c)
    assert B.coverage_problems(rows + [None]) == []


t("a dropped row does not crash the guard", _tolerates_junk)


print("promoted_shortfall (the harvest guard)")


def raw(team, pos, name):
    return {"team": team, "pos": pos, "n": name}


def _harvest_agrees():
    """The two stages must agree about what covered means, or the harvest
    writes a file the build then refuses — the worst of both."""
    names = {"COV": "Coventry City", "IPS": "Ipswich Town", "HUL": "Hull City"}
    payload = []
    for short, full in names.items():
        payload += [raw(full, "Goalkeeper", short + "1"), raw(full, "Defender", short + "2"),
                    raw(full, "Midfielder", short + "3"), raw(full, "Attacker", short + "4")]
        while len([p for p in payload if p["team"] == full]) < B.MIN_SQUAD:
            payload.append(raw(full, "Defender", short + "x" + str(len(payload))))
    assert H.promoted_shortfall(payload) == [], H.promoted_shortfall(payload)
    assert H.promoted_shortfall({"players": payload}) == []


t("a covered payload passes in both wrapper shapes", _harvest_agrees)


def _harvest_catches_slice():
    """What league 9 actually returns: plenty of players, a handful of them
    from the clubs we keep."""
    payload = [raw("Coventry City", "Attacker", "Wright"),
               raw("Hull City", "Attacker", "McBurnie"),
               raw("Ipswich Town", "Attacker", "Clarke")]
    payload += [raw("Sheffield Wednesday", "Defender", "x" + str(i)) for i in range(200)]
    short = H.promoted_shortfall(payload)
    # Two complaints per club — thin, and missing three positions — because
    # the harvest guard delegates to the build's rule rather than carrying its
    # own. That delegation is the point: an earlier pair of copies disagreed
    # about whether a thin squad also reports its gaps.
    assert len(short) == 6, short
    assert sum("need at least" in s for s in short) == 3, short
    assert sum("no GK, DF, MF" in s for s in short) == 3, short


t("200 Championship players with 3 from the promoted clubs is a shortfall", _harvest_catches_slice)


def _harvest_unknown_club():
    """A renamed club in the feed reads as an absent one, which is the right
    answer — an unmapped name is not evidence of a squad."""
    payload = [raw("Coventry", "Defender", "x")] * 30   # note: not "Coventry City"
    short = H.promoted_shortfall(payload)
    assert any(s.startswith("COV: no players at all") for s in short), short


t("an unmapped club name counts as no cover, not as cover", _harvest_unknown_club)


def _shared_vocabulary():
    """If these ever drift, the harvest and the build start disagreeing."""
    # The strongest form of that: identical inputs, identical complaints, with
    # no second copy of the rule to fall out of step.
    rows = [row("HUL", "FW", "one")]
    api = [raw("Hull City", "Attacker", "one")]
    assert H.promoted_shortfall(api) == B.coverage_problems(rows), (
        H.promoted_shortfall(api), B.coverage_problems(rows))
    assert B.PROMOTED == {"COV", "IPS", "HUL"}
    assert B.REQUIRED_POS == {"GK", "DF", "MF", "FW"}
    assert B.MIN_SQUAD >= 15
    for short in B.PROMOTED:
        assert short in B.SHORT.values(), short


t("the club map, floor and positions are shared by both stages", _shared_vocabulary)


def _cookie_line_break():
    """The real failure: a cookie pasted with a line break in it.

    A cookie is an HTTP header value, so a break makes the header invalid and
    the edge answers 400 — which reads as a server fault, not a paste fault,
    and arrived as a bare urllib traceback. The secrets box shows nothing
    wrong either. So it is caught before a request is made."""
    c, p = H.clean_cookie("sessionid=abc;\n_cfuvid=xyz")
    assert c is None, c
    assert "line break" in p and "ONE line" in p, p
    # A break only at the ends is just paste whitespace — strip, don't refuse.
    c, p = H.clean_cookie("\n  sessionid=abc; _cfuvid=xyz  \n")
    assert p is None and c == "sessionid=abc; _cfuvid=xyz", (c, p)


t("a cookie with a line break in it is refused before the request", _cookie_line_break)


def _cookie_other_paste_mistakes():
    for raw in (None, "", "   "):
        c, p = H.clean_cookie(raw)
        assert c is None and "not set" in p, (raw, p)
    # The label copied along with the value: unambiguous, so fix it silently.
    c, p = H.clean_cookie("Cookie: sessionid=abc; x=1")
    assert p is None and c == "sessionid=abc; x=1", (c, p)
    # Something that is not a cookie at all.
    c, p = H.clean_cookie("https://scoutingstats.ai/dashboard")
    assert c is None and "name=value" in p, p
    # A real one survives untouched.
    good = "sessionid=abc123; _cfuvid=xyz789; ph_session=1"
    assert H.clean_cookie(good) == (good, None)


t("the other ways a pasted cookie arrives broken", _cookie_other_paste_mistakes)


def _fake_api(total, cap=10, report_pages=True):
    """A player-stats endpoint that CAPS per_page below what is asked for,
    which is what the real one does: it answers per_page 10 to a request
    for 20."""
    import urllib.parse as up

    def req(url, cookie):
        q = dict(up.parse_qsl(up.urlparse(url).query))
        page = int(q["page"])
        start = (page - 1) * cap
        # Feed-shaped rows: fetch_all normalises before returning, and a row
        # without a club or minutes is refused there — correctly.
        rows = [{"player_name": f"p{i}", "team_name": "Millwall",
                 "position": "Defender", "minutes_played": 900,
                 "yellow_cards": 3, "red_cards": 0,
                 "fouls_committed_p90": 1.5, "fouls_drawn_p90": 0.9}
                for i in range(start, min(start + cap, total))]
        out = {"players": rows, "page": page, "per_page": cap, "total_count": total}
        if report_pages:
            out["total_pages"] = (total + cap - 1) // cap
        return out
    return req


def _pagination_walks_every_page():
    """The bug that shipped six forwards as three squads, in its second form.

    The walk asks for 100 a page. The API answers 10. "A page shorter than
    asked for is the last page" is then true of EVERY page, so the walk stops
    at the first one — a truncated squad that looks like a complete small
    league. It has to judge against the size the API says it used."""
    real = H.request_json
    try:
        for total, pages in ((47, True), (47, False), (10, True), (1, False)):
            H.request_json = _fake_api(total, cap=10, report_pages=pages)
            rows, _ = H.fetch_all(9, "x", "c", "test")
            assert len(rows) == total, (total, pages, len(rows))
    finally:
        H.request_json = real


t("pagination walks every page when the API caps per_page", _pagination_walks_every_page)


def _empty_season_is_refused():
    """A wrong season_id does not error — it returns a real, recent, empty
    league. Written out, that is a dataset of nobody."""
    real = H.request_json
    try:
        H.request_json = _fake_api(0, cap=10)
        try:
            H.fetch_all(9, "27903", "c", "Championship")
        except SystemExit as e:
            assert "no players on page 1" in str(e), str(e)
            assert "season_id" in str(e), str(e)
        else:
            assert False, "an empty league should stop the harvest"
    finally:
        H.request_json = real


t("an empty season stops the harvest instead of writing nobody", _empty_season_is_refused)


# A real row, captured from league 9 season 25648. Kept verbatim so the field
# mapping is pinned to what the feed actually sends rather than to a guess.
REAL_ROW = {
    "team_name": "Swansea City", "team_short": "SWA", "team_id": 30,
    "team_image": "https://cdn.sportmonks.com/images/soccer/teams/30/30.png",
    "player_name": "Zan Vipotnik", "position": "Attacker",
    "detailed_position": "Centre Forward", "minutes_played": 2953,
    "appearances": 44, "yellow_cards": 2, "red_cards": 0,
    "fouls_committed": 21, "fouls_committed_p90": 0.64,
    "fouls_drawn": 25, "fouls_drawn_p90": 0.76,
}


def _field_mapping_end_to_end():
    """The feed calls nothing what the build reads. A wrong name here does not
    error — it yields a null, and a null foul rate is a player who never
    fouls. So the mapping is checked all the way through to the risk score."""
    import leagues as L
    row = B.mk(H.normalise(REAL_ROW), "EFLC", resolve=L.eflc_short)
    assert row["c"] == "SWA" and row["n"] == "Zan Vipotnik", row
    assert row["p"] == "FW", row                      # position -> POS
    assert row["min"] == 2953 and row["yc"] == 2, row
    assert row["f"] == 0.64 and row["fw"] == 0.76, row
    assert row["y"] == round(2 / 2953 * 90, 3), row
    assert row["r"] == round(row["y"] * 2 + 0.64, 3), row
    assert row["_tid"] == 30 and row["_img"].endswith("30.png"), row


t("the feed's field names map through to a risk score", _field_mapping_end_to_end)


def _p90_derived_only_to_fill_a_gap():
    """The feed's own per-90 wins. Derived from the total and the minutes only
    when it is absent — and the two agree on the real row, which is the check
    that the totals are totals and the rates are rates."""
    assert H.normalise(REAL_ROW)["fc90"] == 0.64
    without = {k: v for k, v in REAL_ROW.items() if k != "fouls_committed_p90"}
    assert H.normalise(without)["fc90"] == 0.64, "21 * 90 / 2953"


t("a per-90 is derived only when the feed omits it", _p90_derived_only_to_fill_a_gap)


def _renamed_feed_stops_the_harvest():
    """The silent failure this guards: every row maps, every value is None,
    and a whole league ships as players who never foul."""
    try:
        H.normalise_all([{"teamName": "X", "playerName": "Y"}], "test")
    except SystemExit as e:
        assert "empty on all" in str(e) and "FIELD_MAP" in str(e), str(e)
    else:
        assert False, "a renamed feed should stop the harvest"


t("a renamed feed stops the harvest rather than nulling it", _renamed_feed_stops_the_harvest)


def _unstable_api(total, cap=10, reject_player_id=False):
    """An endpoint that re-sorts tied rows between requests, which is what the
    real one does when asked to sort by a rate."""
    import urllib.parse as up

    def req(url, cookie, allow_400=False):
        q = dict(up.parse_qsl(up.urlparse(url).query))
        if q.get("sort_by") == "player_id" and reject_player_id:
            return None
        page = int(q["page"])
        ids = list(range(total))
        if reject_player_id and page > 1:      # the ties drift
            ids = ids[1:] + ids[:1]
        chunk = ids[(page - 1) * cap:(page - 1) * cap + cap]
        rows = [{"player_id": i, "player_name": f"p{i}", "team_name": "Millwall",
                 "position": "Defender", "minutes_played": 900,
                 "yellow_cards": 1, "red_cards": 0,
                 "fouls_committed_p90": 1.0, "fouls_drawn_p90": 0.5}
                for i in chunk]
        return {"players": rows, "page": page, "per_page": cap,
                "total_count": total, "total_pages": (total + cap - 1) // cap}
    return req


def _a_total_order_collects_everyone():
    """Sorting by player_id makes the pages disjoint, so the walk is complete."""
    real = H.request_json
    try:
        H.request_json = _unstable_api(47)
        rows, _ = H.fetch_all(9, "x", "c", "test")
        assert len(rows) == 47, len(rows)
        assert len({r["pid"] for r in rows}) == 47, "and every one distinct"
    finally:
        H.request_json = real


t("a unique sort key makes the pages disjoint", _a_total_order_collects_everyone)


def _a_short_walk_is_refused():
    """The bug as it actually arrived: 710 rows walked against 706 reported,
    the duplicates hiding an equal number of players who never came back. Every
    one of those was a defender or a keeper, because forwards hold their place
    in a goals-sorted list and everyone else was tied at zero."""
    real = H.request_json
    try:
        H.request_json = _unstable_api(47, reject_player_id=True)
        try:
            H.fetch_all(9, "x", "c", "test")
        except SystemExit as e:
            assert "are \nmissing" in str(e) or "missing" in str(e), str(e)
            assert "Refusing to write a partial league" in str(e), str(e)
        else:
            assert False, "a short walk should refuse to write"
    finally:
        H.request_json = real


t("a short walk refuses rather than shipping a partial league", _a_short_walk_is_refused)

print(f"\n{passed} tests passed")

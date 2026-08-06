#!/usr/bin/env python3
"""
Harvest the raw ScoutingStats JSON that build_pl_data.py consumes.

The ScoutingStats API requires a logged-in browser session, so this script
authenticates with a session cookie you copy from your browser:

  1. Log in at https://scoutingstats.ai in your browser.
  2. Open DevTools -> Network, click any request to scoutingstats.ai,
     and copy the full value of the `cookie` request header.
  3. Run:  SS_COOKIE='<pasted cookie>' python3 data/harvest.py

The endpoint is PAGINATED and takes season_id (not season). Both are
handled here; `--probe` reports what a season_id actually contains
without writing anything, which is the fastest way to find the right one.

Writes (both gitignored):
  data/pl_players.json       league 8 (Premier League) player stats
  data/champ_promoted.json   league 9 (Championship) player stats
                             (build_pl_data.py keeps only the promoted clubs;
                              build_eflc_data.py keeps the other 18)
  data/l1_players.json       league 12 (League One), only when SS_SEASON_L1
                             is set — the Championship desk's promoted three

If data/pl_refs.json is missing, build_refs.py is run to produce it from the
free football-data.co.uk mirror (no login needed for referees).

Optional env:
  SS_USER_AGENT  the User-Agent to send. Cloudflare binds cf_clearance to the
                 IP AND the User-Agent that solved its challenge, so this must
                 match the browser the cookie came from or the edge answers 400.
  SS_SEASON_PL / SS_SEASON_CH / SS_SEASON_L1  the season_id per league.
                 REQUIRED: the endpoint answers 400 without one.
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
# The club map, squad floor and position list live in build_pl_data so the
# harvest and the build cannot drift apart about what a covered squad is.
import build_pl_data  # noqa: E402
BASE = "https://scoutingstats.ai/api/league/{league}/player-stats"


# The cookie is only half of what the edge checks. Cloudflare binds
# cf_clearance to the IP AND THE USER-AGENT that solved the challenge, so a
# request carrying a browser's clearance token under a different User-Agent is
# rejected — with a 400, which reads like a malformed cookie and is not.
#
# This value was hardcoded to a Linux string, which was invisible for as long
# as the harvest only ever ran beside a Linux browser. Run it on Windows with a
# cookie from Chrome and it cannot work, however correct the cookie is. So it
# is settable, and the default is the common case for a desktop browser rather
# than for the machine this repo happens to be developed on.
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")


def user_agent():
    return (os.environ.get("SS_USER_AGENT") or "").strip() or DEFAULT_UA


PAGE_SIZE = 100      # asked for; the API may cap it, which the walk handles
MAX_PAGES = 300      # runaway guard, far above any real squad list


# Pagination over this endpoint is NOT stable, and no sort key fixes it.
#
# sort_by=goals_p90 ties every player without a goal, and the server re-sorts
# per request, so tied rows drift across page boundaries: some come back twice
# and an equal number never come back. Asking to sort by player_id — unique,
# so a total order — is worse, because the API does not reject an unknown sort
# field, it IGNORES it and falls back to no order at all. 549 rows collapsed to
# 400 distinct players that way. There is nothing to detect: a rejected sort
# and an honoured one both answer 200.
#
# So completeness cannot come from the ordering. It comes from collecting until
# the set of distinct players matches the total the API itself reports, over
# repeated passes if a pass is lossy. goals_p90 stays because it is a field the
# app's own pages use, so it is certainly valid, and it is empirically the
# least lossy of the ones tried.
SORT_FIELD = "goals_p90"
SORT_ORDER = "desc"
# Repeating the SAME request cannot help: the loss is deterministic. Four
# identical passes over the Premier League returned the same 535 of 549 every
# time, so 14 players sit permanently in the gap a page boundary leaves.
#
# What moves them is changing where the boundaries fall. per_page decides that
# directly, and reversing the order walks the same list from the other end, so
# a row lost at the seam of one variant is mid-page in the next. The union is
# what gets collected. sort_by varies too, harmlessly: an unknown field is
# ignored rather than rejected, so at worst a variant repeats another.
PASS_VARIANTS = [
    {"sort_by": "goals_p90", "sort_order": "desc", "per_page": 100},
    {"sort_by": "goals_p90", "sort_order": "asc", "per_page": 100},
    {"sort_by": "minutes_played", "sort_order": "desc", "per_page": 100},
    {"sort_by": "minutes_played", "sort_order": "asc", "per_page": 75},
    {"sort_by": "appearances", "sort_order": "desc", "per_page": 50},
    {"sort_by": "yellow_cards", "sort_order": "desc", "per_page": 40},
    {"sort_by": "rating", "sort_order": "desc", "per_page": 30},
    {"sort_by": "goals_p90", "sort_order": "desc", "per_page": 25},
]
# A gap this small is the API's own total counting something the pages do not
# — a mid-season transfer showing as two rows, most likely. Beyond it, the
# harvest is missing real players and must not write.
TOLERANCE = 0.05


def build_url(league, season_id, page, per_page=PAGE_SIZE, min_minutes=0,
              sort_by=None, sort_order=None):
    """The request the BROWSER makes, which is not the one this script used to.

    Three things were wrong and only the first announced itself:

      season_id   the parameter is season_id, not season. A required parameter
                  under the wrong name is absent, and an absent required
                  parameter is a 400 — which reads as a broken cookie.
      page        the endpoint is PAGINATED. One request is one page.
      min_minutes it filters by minutes, defaulting to a floor that hides
                  fringe players entirely.

    Together those explain the promoted clubs shipping as six forwards and no
    defenders for a year: the app's own call sorts by goals per 90 and takes
    twenty rows, and the top twenty of a goals-sorted list ARE forwards. It was
    never a thin feed, it was page one.
    """
    params = {
        "page": page,
        "per_page": per_page,
        "sort_by": sort_by or SORT_FIELD,
        "sort_order": sort_order or SORT_ORDER,
        "min_minutes": min_minutes,
    }
    if season_id:
        params["season_id"] = season_id
    return BASE.format(league=league) + "?" + urllib.parse.urlencode(params)


def players_of(payload):
    """The player rows out of a response, whatever it wraps them in."""
    if isinstance(payload, dict):
        for key in ("players", "data", "results", "items", "rows"):
            if isinstance(payload.get(key), list):
                return payload[key]
        return []
    return payload if isinstance(payload, list) else []


def meta_of(payload):
    """Anything pagination-shaped the response carries, for the log and the
    cross-check. Trusted to report, never as the walk itself."""
    if not isinstance(payload, dict):
        return {}
    out = {}
    for key in ("total", "total_pages", "page", "per_page", "count",
                "total_count", "pages", "season", "season_id", "season_name"):
        if key in payload and not isinstance(payload[key], (list, dict)):
            out[key] = payload[key]
    for key in ("meta", "pagination", "paging"):
        if isinstance(payload.get(key), dict):
            out.update({k: v for k, v in payload[key].items()
                        if not isinstance(v, (list, dict))})
    return out


def request_json(url, cookie, allow_400=False):
    req = urllib.request.Request(url, headers={
        "Cookie": cookie,
        "User-Agent": user_agent(),
        "Accept": "application/json",
        # Cloudflare scores requests that look nothing like the browser the
        # clearance was issued to. These cost nothing and remove a whole class
        # of "why is this a 400" from the picture.
        "Accept-Language": "en-GB,en;q=0.9",
        "Referer": "https://scoutingstats.ai/",
        "X-Requested-With": "XMLHttpRequest",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            sys.exit(f"ERROR: {url} answered {e.code} — the SS_COOKIE is "
                     "missing, expired or not logged in. Copy a fresh cookie "
                     "header from a logged-in browser session and retry.")
        if e.code == 400 and allow_400:
            return None
        if e.code == 400:
            # Not an auth failure — a malformed REQUEST. The cookie is a header
            # value, so anything the browser did not put there (a line break
            # from a wrapped copy, a "Cookie:" prefix copied along with the
            # value, smart quotes) makes the header invalid and the edge
            # rejects it before the API is reached. That looked like a bare
            # traceback until this existed.
            cf = "cf_clearance=" in (cookie or "")
            no_season = "season_id=" not in url
            sys.exit(
                f"ERROR: {url} answered 400 (bad request).\n\n"
                "That is the request being rejected as malformed, not the "
                "session being judged — the account is fine.\n\n"
                + ("MOST LIKELY HERE: there is no season_id on that URL, and "
                   "the endpoint requires one. Set the season id for this "
                   "league (SS_SEASON_PL / SS_SEASON_CH / SS_SEASON_L1) and "
                   "retry; --probe reports what an id contains.\n\n"
                   if no_season else "")
                + ("MOST LIKELY HERE: this cookie carries cf_clearance, "
                   "Cloudflare's challenge-clearance token. It is bound to "
                   "BOTH the IP address AND the User-Agent that solved the "
                   "challenge, and BOTH have to match or the edge rejects the "
                   "request before scoutingstats.ai is reached.\n\n"
                   f"  This request sent:\n    {user_agent()}\n\n"
                   "  If that is not the User-Agent of the browser you copied "
                   "the cookie from, that alone is enough to cause this. Read "
                   "the browser's own value from DevTools -> Network -> any "
                   "request -> Request Headers -> user-agent, and set it:\n\n"
                   "    $env:SS_USER_AGENT = '<the browser's user-agent>'\n\n"
                   "  And run the harvest on the SAME MACHINE AND NETWORK as "
                   "that browser session. Those two constraints together are "
                   "why this route cannot run unattended, and why "
                   "data/harvest_apifootball.py exists as the key-based "
                   "alternative.\n\n"
                   if cf else "")
                + "Otherwise check that SS_COOKIE:\n"
                  "  - is a single line with no breaks in it\n"
                  "  - has no leading 'cookie:' or 'Cookie:' prefix\n"
                  "  - is the raw header value, not the name/value table from\n"
                  "    the Application tab\n\n"
                  "In a GitHub Actions log a multi-line secret shows as\n"
                  "'SS_COOKIE:' with the value starting on the NEXT line.")
        raise
    return json.loads(body)


# What the feed calls the fields the build reads. Confirmed against a real row
# rather than guessed: a wrong name here does not error, it produces a null,
# and a null foul rate reads as a player who never fouls.
#
# The _p90 fields are genuine rates — fouls_committed 21 over minutes_played
# 2953 is 0.64, which is what fouls_committed_p90 says — so they are taken as
# given rather than recomputed.
FIELD_MAP = {
    "team": "team_name",
    "n": "player_name",
    "pos": "position",          # Goalkeeper/Defender/Midfielder/Attacker
    "min": "minutes_played",
    "yc": "yellow_cards",
    "rc": "red_cards",
    "fc90": "fouls_committed_p90",
    "fd90": "fouls_drawn_p90",
    "pid": "player_id",       # unique; what the walk de-duplicates on
    "tid": "team_id",
    "img": "team_image",        # the CLUB crest, which is what CLUBS carries
}
# Without these a row cannot be placed or rated, so their absence is fatal
# rather than a null.
ESSENTIAL = ("team", "n", "min")


def normalise(row):
    """One feed row in the shape build_pl_data.mk() reads.

    Canonical keys win where a row already has them, so a harvest file written
    by an older version of this script still loads.
    """
    out = {}
    for key, feed_key in FIELD_MAP.items():
        out[key] = row.get(key, row.get(feed_key))
    # A per-90 the feed did not supply can still be derived, because the total
    # and the minutes are both there. Only ever fills a gap.
    if out["fc90"] is None and row.get("fouls_committed") and out["min"]:
        out["fc90"] = round(row["fouls_committed"] * 90.0 / out["min"], 3)
    if out["fd90"] is None and row.get("fouls_drawn") and out["min"]:
        out["fd90"] = round(row["fouls_drawn"] * 90.0 / out["min"], 3)
    return out


def normalise_all(rows, label):
    """Every row mapped, with the mapping itself checked against the data.

    A feed that renames a field would otherwise pass silently: every row maps,
    every value is None, and the build ships a league of players who never
    foul. So the fill rate is measured and a field that is empty across the
    board stops the harvest naming itself."""
    out = [normalise(r) for r in rows]
    if not out:
        return out
    fill = {k: sum(1 for r in out if r.get(k) is not None) for k in FIELD_MAP}
    dead = [k for k in ESSENTIAL if fill[k] == 0]
    if dead:
        sys.exit(
            f"ERROR: {label}: the fields {', '.join(dead)} are empty on all "
            f"{len(out)} rows, so the feed is not calling them what this "
            "harvest expects.\n\n  expected: "
            + ", ".join(f"{k}<-{FIELD_MAP[k]}" for k in dead)
            + f"\n  a row actually has: {sorted(rows[0])[:20]}\n\n"
            "Run --probe to see the field names and update FIELD_MAP.")
    thin = [f"{k} on {100 * fill[k] // len(out)}%" for k in FIELD_MAP
            if 0 < fill[k] < len(out) * 0.5]
    if thin:
        print(f"    note: sparse fields — {', '.join(thin)}")
    return out


def club_coverage(rows):
    """club -> (squad size, positions present). What actually matters: the
    desk needs full squads, not a matching row count."""
    by = {}
    for r in rows:
        team = r.get("team") or "?"
        size, pos = by.get(team, (0, set()))
        by[team] = (size + 1, pos | {build_pl_data.POS.get(r.get("pos"), r.get("pos"))})
    return by


def one_pass(league, season_id, cookie, min_minutes, into, label, variant=None):
    """One walk of every page, adding distinct players to `into`.

    Returns (meta from page one, rows seen this pass). `into` is keyed by
    player id, so a repeat within or across passes is simply an assignment
    that changes nothing.
    """
    variant = variant or PASS_VARIANTS[0]
    page, seen, first_meta = 1, 0, {}
    effective, total_pages = variant.get("per_page", PAGE_SIZE), None
    while True:
        url = build_url(league, season_id, page, min_minutes=min_minutes,
                        per_page=variant.get("per_page", PAGE_SIZE),
                        sort_by=variant.get("sort_by"),
                        sort_order=variant.get("sort_order"))
        payload = request_json(url, cookie)
        got = players_of(payload)
        if page == 1:
            first_meta = meta_of(payload)
            reported = first_meta.get("per_page")
            if isinstance(reported, int) and reported > 0:
                effective = reported
            tp = first_meta.get("total_pages") or first_meta.get("pages")
            if isinstance(tp, int) and tp > 0:
                total_pages = tp
            if not got:
                sys.exit(
                    f"ERROR: {label} (league {league}, season_id "
                    f"{season_id or 'unset'}) returned no players on page 1.\n"
                    f"  {url}\n"
                    f"  response keys: {sorted(payload) if isinstance(payload, dict) else type(payload).__name__}\n"
                    f"  reported: {first_meta or 'nothing'}\n\n"
                    "An empty league is almost always the wrong season_id — a "
                    "season that has not kicked off yet has no players. Run "
                    "with --probe to see what a season_id actually contains.")
        seen += len(got)
        for r in normalise_all(got, label):
            key = r.get("pid") or (r.get("team"), r.get("n"))
            into.setdefault(key, r)
        if not got:
            break
        if total_pages is not None and page >= total_pages:
            break
        if total_pages is None and len(got) < effective:
            break
        page += 1
        if page > MAX_PAGES:
            sys.exit(f"ERROR: {label} still returning full pages after "
                     f"{MAX_PAGES} — refusing to loop further.")
    return first_meta, seen


def fetch_all(league, season_id, cookie, label, min_minutes=0):
    """Every player in one league-season, collected until provably complete.

    The endpoint's paging is lossy (see SORT_FIELD above), so one walk is not
    a league — it is a sample of one. This repeats the walk, accumulating
    distinct players, until the count matches the total the API reports or a
    pass adds nobody new. Anything short of the reported total refuses to
    write, because a partial league is the failure this route has now shipped
    three times and every version of it looked plausible.
    """
    into = {}
    first_meta, _ = one_pass(league, season_id, cookie, min_minutes, into, label,
                             PASS_VARIANTS[0])
    claimed = (first_meta.get("total") or first_meta.get("total_count")
               or first_meta.get("count"))

    used = 1
    for variant in PASS_VARIANTS[1:]:
        if not isinstance(claimed, int) or len(into) >= claimed:
            break
        before = len(into)
        one_pass(league, season_id, cookie, min_minutes, into, label, variant)
        used += 1
        print(f"    +{len(into) - before:<4} {len(into)}/{claimed} distinct"
              f"  (per_page {variant['per_page']}, {variant['sort_by']} "
              f"{variant['sort_order']})")

    rows = list(into.values())
    print(f"  {label}: {len(rows)} players"
          + (f" over {used} variant passes" if used > 1 else ""))

    if isinstance(claimed, int) and len(rows) < claimed:
        short = claimed - len(rows)
        cover = club_coverage(rows)
        thin = {c: v for c, v in cover.items()
                if v[0] < build_pl_data.MIN_SQUAD
                or not build_pl_data.REQUIRED_POS <= v[1]}
        if short > claimed * TOLERANCE or thin:
            detail = "".join(
                f"\n    {c}: {n} players, positions {sorted(p - {None})}"
                for c, (n, p) in sorted(thin.items())[:8])
            sys.exit(
                f"ERROR: {label}: the API reports {claimed} players and "
                f"{used} varied pass(es) reached {len(rows)}, "
                f"{short} short.\n\n"
                + (f"  Clubs that are not a usable squad:{detail}\n\n"
                   if thin else
                   "  Every club still has a full squad, but the gap is "
                   f"larger than the {TOLERANCE:.0%} tolerance.\n\n")
                + "  This endpoint pages without a stable order and the loss\n"
                  "  is deterministic, so identical requests cannot find the\n"
                  "  rest — only different page boundaries can, and every\n"
                  "  variant has been tried.\n\n"
                  "Refusing to write a partial league.")
        print(f"    note: {short} of {claimed} unreachable ({short / claimed:.1%}), "
              "but every club has a full squad — the API's total most likely "
              "counts a transferred player twice. Proceeding.")
    return rows, first_meta




def promoted_shortfall(payload):
    """Which promoted clubs this Championship payload fails to cover.

    Normalises into the shape build_pl_data.coverage_problems already judges
    and calls THAT, rather than re-implementing the rule. Two copies of a rule
    are two rules: an earlier pair differed on whether a thin squad also
    reports its missing positions, so the harvest and the build disagreed
    about the same data."""
    players = payload["players"] if isinstance(payload, dict) and "players" in payload else payload
    rows = []
    for p in players or []:
        short = build_pl_data.SHORT.get(p.get("team"))
        if short in build_pl_data.PROMOTED:
            rows.append({"c": short,
                         "p": build_pl_data.POS.get(p.get("pos"), p.get("pos") or "")})
    return build_pl_data.coverage_problems(rows)


def clean_cookie(raw):
    """(cookie, problem) for a raw SS_COOKIE value.

    Pure, so the rules are testable without a network or a real session.

    A cookie is an HTTP header value, and the ways it arrives broken are all
    silent: a line break survives a copy from a wrapped DevTools pane, the
    'cookie:' label gets selected with the value, or someone pastes the
    Application tab's name/value table instead of the header. None of those
    look wrong in a secrets box, and the API answers 400 to all of them —
    which reads as a server problem rather than a paste problem. Name it here
    instead, before a request is made.
    """
    raw = (raw or "").strip()
    if not raw:
        return None, ("SS_COOKIE is not set. Copy the `cookie` REQUEST header "
                      "from a logged-in scoutingstats.ai session (see the "
                      "docstring at the top of this file).")
    if "\n" in raw or "\r" in raw:
        n = len([ln for ln in raw.splitlines() if ln.strip()])
        return None, (
            f"SS_COOKIE contains a line break ({n} lines). A cookie header is "
            "ONE line — a break makes the header invalid and the API answers "
            "400.\n\nRe-copy it as a single line: DevTools -> Network -> tick "
            "'Disable cache' -> reload -> click a request -> Request Headers "
            "-> Raw, then copy the whole `cookie:` line's value.\n\nIn a "
            "GitHub Actions log this shows as 'SS_COOKIE:' with the value "
            "starting on the next line.")
    low = raw.lower()
    if low.startswith("cookie:"):
        # Recoverable and unambiguous, unlike a line break: strip the label
        # rather than making someone paste again for it.
        raw = raw.split(":", 1)[1].strip()
        print("note: stripped a leading 'cookie:' label from SS_COOKIE")
    if "=" not in raw:
        return None, ("SS_COOKIE has no `name=value` pair in it, so it is not "
                      "a cookie header. Copy the value of the `cookie` request "
                      "header, not the URL, the response, or a single cookie's "
                      "name.")
    return raw, None


# league id -> (env var for its season_id, output file, display name).
# 8, 9 and 12 are the app's own ids, read off the requests its pages make.
SOURCES = {
    "PL": (8, "SS_SEASON_PL", "pl_players.json", "Premier League"),
    "CH": (9, "SS_SEASON_CH", "champ_promoted.json", "Championship"),
    "L1": (12, "SS_SEASON_L1", "l1_players.json", "League One"),
}


def probe(cookie, only=None):
    """Report what a season_id actually contains, without writing anything.

    A season id is an opaque number, and the wrong one does not error — it
    returns a real, recent, nearly empty league, which is the most expensive
    kind of wrong. This names what is behind each id before anything is built
    on it."""
    for code, (league, env, _file, name) in SOURCES.items():
        if only and code != only:
            continue
        season = (os.environ.get(env) or "").strip()
        print(f"\n{name}  (league {league}, {env}={season or 'UNSET'})")
        if not season:
            print(f"  skipped — set {env} to a season_id to probe it")
            continue
        url = build_url(league, season, page=1, per_page=20, min_minutes=0)
        print(f"  {url}")
        payload = request_json(url, cookie)
        rows = players_of(payload)
        keys = sorted(payload) if isinstance(payload, dict) else type(payload).__name__
        print(f"  response keys : {keys}")
        print(f"  reported      : {meta_of(payload) or 'nothing'}")
        print(f"  players page 1: {len(rows)}")
        if rows:
            keys = sorted(rows[0])
            print(f"  fields ({len(keys)}):")
            for i in range(0, len(keys), 6):
                print("    " + ", ".join(keys[i:i + 6]))
            # The build wants club, name, position, minutes, cards and fouls.
            # It is the FEED that decides what those are called, and a mapping
            # written from a guess is how a rate silently becomes null. So the
            # fields that could plausibly carry them are printed with their
            # values, from a real row, and the mapping is written from that.
            want = ("team", "club", "name", "player", "pos", "min", "appear",
                    "yellow", "red", "card", "foul")
            hit = [k for k in keys if any(w in k.lower() for w in want)]
            print("  the fields the build needs, on a real row:")
            for k in hit:
                print(f"    {k:34} = {rows[0].get(k)!r}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true",
                    help="report what each season_id contains; write nothing")
    ap.add_argument("--league", choices=sorted(SOURCES),
                    help="probe only this one")
    args = ap.parse_args()

    cookie, problem = clean_cookie(os.environ.get("SS_COOKIE"))
    if problem:
        sys.exit("ERROR: " + problem)

    if args.probe:
        probe(cookie, args.league)
        print("\nprobe only — nothing written")
        return

    pl, _ = fetch_all(8, os.environ.get("SS_SEASON_PL"), cookie, "Premier League")
    (DATA / "pl_players.json").write_text(json.dumps(pl), encoding="utf-8")
    print(f"pl_players.json written ({len(pl)} players)")

    # League One, for the Championship desk's three promoted clubs. Optional:
    # the Premier League desk has never needed it, so an unset season id is a
    # skip rather than a failure.
    if (os.environ.get("SS_SEASON_L1") or "").strip():
        l1, _ = fetch_all(12, os.environ.get("SS_SEASON_L1"), cookie, "League One")
        (DATA / "l1_players.json").write_text(json.dumps(l1), encoding="utf-8")
        print(f"l1_players.json written ({len(l1)} players)")

    ch, _ = fetch_all(9, os.environ.get("SS_SEASON_CH"), cookie, "Championship")
    n_ch = len(ch)
    # The league-wide count is not the check that matters. league 9 has 24
    # clubs, so a payload of 100+ players clears any league-wide floor
    # comfortably while carrying only a handful for the three clubs we
    # actually keep — which is exactly what shipped: six forwards, no
    # defenders, for a year. Refuse to overwrite a good file with a thin one.
    #
    # The cause of that is no longer a mystery and is fixed above: the endpoint
    # is paginated, and the app's own call takes twenty rows sorted by goals
    # per 90. Page one of a goals-sorted list is forwards. The guard stays
    # because it is cheap and it is the last thing standing between a bad
    # harvest and the shipped file.
    thin = promoted_shortfall(ch)
    if thin:
        sys.exit(
            "ERROR: league 9 answered with "
            f"{n_ch} players, but the promoted clubs are not covered:\n  - "
            + "\n  - ".join(thin)
            + "\n\nchamp_promoted.json was NOT overwritten.\n\n"
              "FIRST THING TO CHECK IS THE SEASON. Coventry, Ipswich and Hull "
              "are in the Premier League from 2026-27, so a CURRENT-season "
              "Championship payload correctly does not contain them and this "
              "guard correctly refuses it. The desk is built on 2025-26 form, "
              "so SS_SEASON_CH wants the 2025-26 season_id.\n\n"
              "  python3 data/harvest.py --probe   names what a season_id holds"
        )
    (DATA / "champ_promoted.json").write_text(json.dumps(ch), encoding="utf-8")
    print(f"champ_promoted.json written ({n_ch} players)")

    if not (DATA / "pl_refs.json").exists():
        subprocess.run([sys.executable, str(DATA / "build_refs.py")], check=True)

    print("Harvest complete. Now run: python3 data/build_pl_data.py")


if __name__ == "__main__":
    main()

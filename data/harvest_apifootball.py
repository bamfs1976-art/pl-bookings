#!/usr/bin/env python3
"""
Harvest the promoted clubs' Championship form from API-Football.

The alternative to data/harvest.py, which needs a session cookie copied out of
a logged-in browser and therefore cannot run unattended. This route needs one
free API key, so it works as a repository secret and the data refresh can be
automated.

  API_FOOTBALL_KEY=<key> python3 data/harvest_apifootball.py

Writes data/champ_promoted.json in the shape build_pl_data.py already consumes,
so nothing downstream changes.

Optional env:
  API_FOOTBALL_HOST     default v3.football.api-sports.io (the direct API).
                        Set to api-football-v1.p.rapidapi.com for the RapidAPI
                        mirror; the auth header changes with it, handled below.
  API_FOOTBALL_SEASON   default 2025 (the 2025-26 season, API-Football names a
                        season by its starting year).
  API_FOOTBALL_LEAGUE   default 40 (England, Championship).

WHAT THIS ROUTE HAS TO GET RIGHT.

`/players` is PAGINATED, twenty players to a page. Reading page one and
stopping is a slice of a squad that looks exactly like a squad — which is
precisely how the ScoutingStats route shipped six forwards as three squads for
a year. So every page is walked, the walk is checked against the `paging.total`
the API itself reports, and a short read is an error rather than a quiet
truncation.

The season totals also need converting: API-Football gives fouls and cards as
counts, while build_pl_data.py expects per-90 rates. That conversion needs
minutes, so a player with no minutes gets a null rate rather than a division
that silently becomes zero and reads as "never fouls".

UNVERIFIED AGAINST A LIVE RESPONSE. This was written from the documented v3
contract and is exercised against recorded-shape fixtures in
data/test_apifootball.py, not against the real API. The shape guards below are
deliberately loud for that reason: on the first real run, a field that has
moved will stop the harvest and name itself rather than write a plausible file.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data  # noqa: E402
import leagues  # noqa: E402

DEFAULT_HOST = "v3.football.api-sports.io"
DEFAULT_SEASON = "2025"     # API-Football names a season by its starting year
DEFAULT_LEAGUE = "40"       # England, Championship


def env_or(name, default):
    """An environment variable, treating set-but-empty as absent."""
    return (os.environ.get(name) or "").strip() or default

RAPIDAPI_HOST = "api-football-v1.p.rapidapi.com"
PAGE_SIZE = 20          # API-Football's fixed page size for /players

# Which club names each league's builder keys on. The spelling differences are
# in leagues.AF_ALIASES; this only says whose vocabulary to check against.
def known_names(code):
    if code == "PL":
        return set(build_pl_data.SHORT)
    # The Championship desk's 24, plus the clubs the Premier League desk pulls
    # out of a Championship season (its promoted three). One harvest of a
    # division serves both desks, so it keeps every club either recognises.
    return set(leagues.EFLC_CLUBS) | set(build_pl_data.SHORT)


def resolve_teams(payload, code):
    """{canonical club name: team id} for a /teams response, plus the names
    nothing could be made of.

    Unmapped names are RETURNED, not skipped. A club whose squad silently does
    not arrive is indistinguishable from a club with no players, and this repo
    has already spent a year on that confusion.
    """
    known = known_names(code)
    found, unmapped = {}, []
    for row in (payload or {}).get("response", []) or []:
        team = row.get("team") or {}
        raw = (team.get("name") or "").strip()
        name = leagues.canonical_club(raw, known)
        if name and team.get("id") is not None:
            found[name] = team["id"]
        elif raw:
            unmapped.append(raw)
    return found, sorted(unmapped)


def per90(total, minutes):
    """A season count as a per-90 rate. None when there are no minutes: a
    rate off zero minutes is not zero, it is unknown, and zero would read as
    a player who never fouls."""
    if total is None or not minutes:
        return None
    try:
        return round(float(total) * 90.0 / float(minutes), 3)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def map_player(entry, club_name, team_id):
    """One /players row into the shape build_pl_data.mk() consumes. Returns
    None for a row with no usable identity rather than a half-built player."""
    player = (entry or {}).get("player") or {}
    stats = (entry or {}).get("statistics") or []
    if not player.get("name") or not stats:
        return None
    # A player can appear for more than one club in a season (a January move).
    # Keep the leg played for the club we asked about, not the aggregate.
    leg = None
    for s in stats:
        tid = (s.get("team") or {}).get("id")
        if tid is not None and tid == team_id:
            leg = s
            break
    if leg is None:
        return None
    games = leg.get("games") or {}
    cards = leg.get("cards") or {}
    fouls = leg.get("fouls") or {}
    minutes = games.get("minutes") or 0
    return {
        "team": club_name,
        "n": player.get("name"),
        "pos": games.get("position"),          # Goalkeeper/Defender/Midfielder/Attacker
        "min": minutes,
        "yc": cards.get("yellow"),
        "rc": cards.get("red"),
        "fc90": per90(fouls.get("committed"), minutes),
        "fd90": per90(fouls.get("drawn"), minutes),
        "tid": (leg.get("team") or {}).get("id"),
        "img": player.get("photo"),
    }


def api_errors(payload):
    """API-Football answers 200 with an `errors` object for a rejected
    request — a bad key, an exhausted quota, or a season the plan does not
    cover. An empty list means fine; a dict or a non-empty list is a refusal
    dressed as a success, and reading it as "no results" is how a plan limit
    turns into "those clubs do not exist".

    Returns a printable string, or None."""
    errs = (payload or {}).get("errors")
    if not errs:
        return None
    if isinstance(errs, dict):
        return "; ".join(f"{k}: {v}" for k, v in errs.items() if v)
    if isinstance(errs, list):
        return "; ".join(str(e) for e in errs) or None
    return str(errs)


def pages_needed(payload):
    """How many pages the API says this query has. Trusted only as a
    cross-check on our own walk, never as the walk itself."""
    paging = (payload or {}).get("paging") or {}
    try:
        return int(paging.get("total") or 1)
    except (TypeError, ValueError):
        return 1


def collect_players(fetch, team_id, club_name):
    """Walk every page for one club. `fetch(page)` returns a parsed response,
    which is what lets this be tested without a network."""
    rows, page, total_pages = [], 1, None
    seen_pages = 0
    while True:
        payload = fetch(page)
        if payload is None:
            raise RuntimeError(f"{club_name}: page {page} returned nothing")
        err = api_errors(payload)
        if err:
            raise RuntimeError(f"{club_name}: API returned errors: {err}")
        reported = pages_needed(payload)
        # Take the largest total any page has claimed. Trusting only page one
        # means a feed that revises its count upward mid-walk gets truncated —
        # and a truncated squad is the exact failure this route exists to
        # avoid, so the walk grows rather than stops.
        if total_pages is None or reported > total_pages:
            total_pages = reported
        for entry in payload.get("response") or []:
            row = map_player(entry, club_name, team_id)
            if row:
                rows.append(row)
        seen_pages += 1
        if page >= total_pages:
            break
        page += 1
        if page > 50:
            raise RuntimeError(f"{club_name}: refusing to page past 50")
    if seen_pages != total_pages:
        raise RuntimeError(
            f"{club_name}: read {seen_pages} pages, the API reported {total_pages}")
    return rows


def _headers(host, key):
    if host == RAPIDAPI_HOST:
        return {"x-rapidapi-key": key, "x-rapidapi-host": host}
    return {"x-apisports-key": key}


# API-Football caps requests per MINUTE as well as per day, and the per-minute
# ceiling is the one a squad walk meets: 21 clubs at three pages each is ~63
# calls, and issued back to back that is several hundred a minute. The first
# real run fetched seven squads in three seconds and was then refused.
#
# The daily quota is generous (7500 on Pro) and the whole job needs about 75
# calls, so pacing costs nothing that matters — twenty seconds of wall clock
# against a harvest that otherwise cannot finish.
REQUEST_DELAY = 0.25    # seconds between requests, ~240/min
RATE_RETRIES = 4        # a refusal is temporary; back off rather than fail
_last_request = [0.0]


def _rate_limited(payload):
    """Whether this 200 is actually a rate-limit refusal."""
    err = api_errors(payload) or ""
    return "ratelimit" in err.lower() or "too many requests" in err.lower()


def _get(host, key, path, params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"https://{host}/{path}?{q}"
    for attempt in range(RATE_RETRIES + 1):
        wait = REQUEST_DELAY - (time.monotonic() - _last_request[0])
        if wait > 0:
            time.sleep(wait)
        payload = _fetch_once(host, key, url)
        if not _rate_limited(payload) or attempt == RATE_RETRIES:
            return payload
        # Per-minute window, so waiting out the minute is the fix. Back off
        # rather than retrying immediately, which only deepens the refusal.
        backoff = 15 * (attempt + 1)
        print(f"    rate limited — waiting {backoff}s and retrying "
              f"({attempt + 1}/{RATE_RETRIES})")
        time.sleep(backoff)
    return payload


def _fetch_once(host, key, url):
    _last_request[0] = time.monotonic()
    req = urllib.request.Request(url, headers=_headers(host, key))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            sys.exit(f"ERROR: {url} answered {e.code} — API_FOOTBALL_KEY is "
                     "missing, wrong, or not entitled to this endpoint.")
        if e.code == 429:
            sys.exit("ERROR: API-Football answered 429. The per-DAY quota is "
                     "spent (the per-minute one is handled by backing off). "
                     "Check the day's usage with --check.")
        raise


# The clubs each harvest exists to guarantee. A division has more clubs than
# any one desk needs, but these are the ones whose absence makes a desk wrong
# rather than smaller — they have no higher-division feed behind them.
MUST_COVER = {
    "PL": set(),                       # build_pl_data guards its own 20
    "EFLC": build_pl_data.PROMOTED,    # COV/IPS/HUL, for the Premier League desk
    "L1": None,                        # set at runtime from the registry
}


def short_of(name):
    """A canonical club name as whichever desk's short code knows it."""
    return build_pl_data.SHORT.get(name) or leagues.EFLC_CLUBS.get(name)


def shortfall(rows, wanted):
    """Coverage judged by build_pl_data's own rule rather than a second copy."""
    if not wanted:
        return []
    mapped = []
    for r in rows:
        code = short_of(r["team"])
        if code in wanted:
            mapped.append({"c": code,
                           "p": build_pl_data.POS.get(r["pos"], r["pos"] or "")})
    return build_pl_data.coverage_problems(mapped, clubs=wanted)


def check_key(host, key):
    """Ask the API who this key is. /status is the one endpoint that answers
    that directly, and it costs nothing against the quota.

    Worth its own mode because "Missing application key" and "your plan does
    not cover this season" are completely different problems that both arrive
    as a refused /teams request, and telling them apart by re-reading the
    harvest's output is guesswork."""
    print(f"host: {host}")
    print(f"key : {len(key)} chars, starts {key[:4]!r}, ends {key[-4:]!r}")
    payload = _get(host, key, "status", {})
    err = api_errors(payload)
    if err:
        sys.exit(
            f"ERROR: /status refused this key: {err}\n\n"
            + ("'Missing application key' means the API does not recognise "
               "the key AT ALL — it is not a plan or a season problem.\n"
               "  - If you subscribed on RAPIDAPI, the key only works against "
               "their host. Set:\n"
               "      API_FOOTBALL_HOST=api-football-v1.p.rapidapi.com\n"
               "  - If you subscribed on dashboard.api-football.com, copy the "
               "key from\n    that dashboard again — the secret may still "
               "hold an older or partial value.\n"
               "  - Check for stray quotes or spaces: a secret pasted as "
               "\"abc\" sends the quotes.\n"
               if "application key" in err.lower() else ""))
    resp = (payload or {}).get("response") or {}
    acct = resp.get("account") or {}
    sub = resp.get("subscription") or {}
    req = resp.get("requests") or {}
    print("\nthe key works. API-Football says:")
    print(f"  account      : {acct.get('firstname','?')} {acct.get('lastname','')} "
          f"<{acct.get('email','?')}>")
    print(f"  plan         : {sub.get('plan','?')}  active={sub.get('active','?')}  "
          f"ends {sub.get('end','?')}")
    print(f"  requests     : {req.get('current','?')} of {req.get('limit_day','?')} today")
    if str(sub.get("plan", "")).lower() == "free":
        print("\n  NOTE: still on the Free plan, which covers seasons "
              "2022-2024 only.\n  2025-26 will be refused until this reads "
              "something else.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="ask /status what this key is and stop")
    ap.add_argument("--league", default="EFLC", choices=sorted(leagues.LEAGUES),
                    help="which division to harvest")
    ap.add_argument("--season", help="season START year, e.g. 2025 for 2025-26")
    args = ap.parse_args()

    key = os.environ.get("API_FOOTBALL_KEY", "").strip().strip('"').strip("'")
    if not key:
        sys.exit("ERROR: set API_FOOTBALL_KEY to an API-Football key. The free "
                 "tier covers seasons 2022-2024 only, so 2025-26 needs a paid "
                 "plan — see the docstring at the top.")
    host = env_or("API_FOOTBALL_HOST", DEFAULT_HOST)
    if args.check:
        check_key(host, key)
        return

    league = leagues.get(args.league)
    MUST_COVER["L1"] = leagues.EFLC_FROM_L1
    wanted = MUST_COVER.get(league.code) or set()
    season = (args.season or env_or("API_FOOTBALL_SEASON", DEFAULT_SEASON)).strip()
    if not season.isdigit() or len(season) != 4:
        sys.exit(f"ERROR: season is {season!r}. API-Football names a season by "
                 "its starting year, so 2025 means 2025-26. This is NOT a "
                 "ScoutingStats season id (a five-digit number like 25583).")
    af = str(league.af_league)

    print(f"{league.name}: API-Football league {af}, season {season}")
    teams_payload = _get(host, key, "teams", {"league": af, "season": season})
    err = api_errors(teams_payload)
    if err:
        hint = ("\n\n'Missing application key' means the key is not "
                "recognised AT ALL — not a plan or season problem.\n"
                "Run this to see what the API thinks the key is:\n"
                "    python3 data/harvest_apifootball.py --check"
                if "application key" in err.lower() else
                "\n\nA plan restriction or an exhausted quota both land here. "
                "The free plan covers\nseasons 2022-2024 only. "
                "`--check` prints the plan the API sees.")
        sys.exit(f"ERROR: API-Football refused the /teams request: {err}\n"
                 "That is the API's own message, not ours." + hint)

    ids, unmapped = resolve_teams(teams_payload, league.code)
    if not ids:
        sys.exit(f"ERROR: league {af} season {season} returned no clubs this "
                 "desk recognises.\n  API returned: "
                 + ", ".join(unmapped[:30])
                 + "\n\nEither the league id is wrong or every name needs an "
                   "entry in leagues.AF_ALIASES.")
    if unmapped:
        # Reported, never silent. For the Championship these will legitimately
        # be the clubs that went down — but a MISSPELLED club looks identical,
        # so it gets read rather than assumed.
        print(f"  not in this desk's club list ({len(unmapped)}): "
              + ", ".join(unmapped))
    print(f"  fetching {len(ids)} squads")

    rows = []
    for club_name, team_id in sorted(ids.items()):
        before = len(rows)
        rows += collect_players(
            lambda page, t=team_id: _get(host, key, "players", {
                "league": af, "season": season, "team": t, "page": page}),
            team_id, club_name)
        print(f"    {club_name:26} {len(rows) - before:>3} players")

    problems = shortfall(rows, wanted)
    if problems:
        sys.exit(f"ERROR: the clubs this harvest exists to cover are not "
                 f"covered, so {league.players_file} was NOT overwritten:\n  - "
                 + "\n  - ".join(problems))

    out = DATA / league.players_file
    out.write_text(json.dumps(rows), encoding="utf-8")
    print(f"\n{league.players_file} written ({len(rows)} players from "
          f"{len(ids)} clubs, API-Football)")


if __name__ == "__main__":
    main()

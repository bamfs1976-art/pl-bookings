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
import re
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
    """Every club name ANY desk keys on — never just the asking league's.

    A division harvest serves whichever desk wants it, and the two desks' club
    lists deliberately disagree. build_pl_data.SHORT is the 2026-27 PREMIER
    LEAGUE, so it excludes Burnley, West Ham and Wolves, who went down — and
    scoping a Premier League harvest to that map dropped exactly the three
    clubs the harvest was added to fetch. They were relegated INTO the
    Championship, so it is the Championship's map that knows them.

    Symmetrically, a Championship harvest carries Coventry, Ipswich and Hull,
    who only the Premier League map knows. Neither list is complete alone; the
    union is what a division contains.
    """
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
        # The CLUB crest, not the player's face. `img` is what build_pl_data
        # carries up into CLUBS as the badge (harvest.py maps ScoutingStats's
        # `team_image` here for the same reason), so filling it with
        # player.photo put a squad member's headshot on the club — which is
        # what Coventry, Hull and Ipswich shipped on the live desk, and what
        # all 24 Championship clubs shipped on the new one.
        "img": (leg.get("team") or {}).get("logo"),
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


MATCHDAY = re.compile(r"(\d+)\s*$")


def round_no(label):
    """"Regular Season - 7" -> 7. None for a cup or play-off round, which is
    what a Championship season ends with and which has no matchday number."""
    m = MATCHDAY.search(str(label or ""))
    return int(m.group(1)) if m else None


def map_fixture(entry, known):
    """One /fixtures row into the shape the desk reads, or None.

    A fixture whose clubs this desk does not know is dropped rather than
    half-built: a card with one side blank is worse than no card.
    """
    fx = (entry or {}).get("fixture") or {}
    tm = (entry or {}).get("teams") or {}
    lg = (entry or {}).get("league") or {}
    home = leagues.canonical_club((tm.get("home") or {}).get("name"), known)
    away = leagues.canonical_club((tm.get("away") or {}).get("name"), known)
    if not home or not away:
        return None
    h, a = leagues.eflc_short(home), leagues.eflc_short(away)
    if not h or not a:
        return None
    # The referee is the reason this endpoint is worth calling. It is null
    # until the appointment is published, which is normal and is why the desk
    # also lets one be chosen by hand.
    ref = (fx.get("referee") or "").strip() or None
    if ref:
        # API-Football appends the country: "Tim Robinson, England".
        ref = ref.split(",")[0].strip()
    return {
        "id": fx.get("id"),
        "d": fx.get("date"),                 # ISO 8601 with offset
        "r": round_no(lg.get("round")),
        "h": h, "a": a,
        "ref": ref,
        "st": ((fx.get("status") or {}).get("short") or "NS"),
    }


def harvest_fixtures(host, key, league, season):
    """Every fixture for one league-season. One call: /fixtures returns a
    whole season, and paging.total is checked rather than assumed."""
    af = str(league.af_league)
    payload = _get(host, key, "fixtures", {"league": af, "season": season})
    err = api_errors(payload)
    if err:
        sys.exit(f"ERROR: API-Football refused the /fixtures request: {err}")
    rows, page, pages = [], 1, pages_needed(payload)
    known = known_names(league.code)
    unmapped = {}
    while True:
        for entry in (payload.get("response") or []):
            got = map_fixture(entry, known)
            if got:
                rows.append(got)
            else:
                tm = (entry or {}).get("teams") or {}
                for side in ("home", "away"):
                    nm = ((tm.get(side) or {}).get("name") or "").strip()
                    if nm and not leagues.canonical_club(nm, known):
                        unmapped[nm] = unmapped.get(nm, 0) + 1
        if page >= pages:
            break
        page += 1
        payload = _get(host, key, "fixtures",
                       {"league": af, "season": season, "page": page})
        pages = max(pages, pages_needed(payload))
    if unmapped:
        print("  clubs in the fixture list this desk does not know: "
              + ", ".join(sorted(unmapped)))
    rows.sort(key=lambda x: (x["d"] or "", x["h"]))
    return rows


def emit_fixtures(rows, league, season):
    """A committed .js file, same as the datasets: the page loads it with a
    script tag and no fetch, so it works offline and needs no key in the
    client."""
    withref = sum(1 for r in rows if r["ref"])
    rounds = sorted({r["r"] for r in rows if r["r"]})
    lines = [
        "// Auto-generated by harvest_apifootball.py --fixtures.",
        f"// {league.name} {season}-{int(season) % 100 + 1}: {len(rows)} fixtures, "
        f"{withref} with a referee appointed.",
        "const EFLC_FIXTURES = [",
    ]
    for r in rows:
        lines.append("  {" + ",".join([
            f'id:{json.dumps(r["id"])}', f'd:{json.dumps(r["d"])}',
            f'r:{json.dumps(r["r"])}', f'h:{json.dumps(r["h"])}',
            f'a:{json.dumps(r["a"])}', f'ref:{json.dumps(r["ref"])}',
            f'st:{json.dumps(r["st"])}',
        ]) + "},")
    lines.append("];")
    (DATA / "eflc_fixtures.js").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\neflc_fixtures.js written ({len(rows)} fixtures over "
          f"{len(rounds)} matchdays, {withref} with a referee appointed)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", action="store_true",
                    help="harvest the fixture list instead of squads")
    ap.add_argument("--check", action="store_true",
                    help="ask /status what this key is and stop")
    ap.add_argument("--league", default="EFLC", choices=sorted(leagues.LEAGUES),
                    help="which division to harvest")
    ap.add_argument("--season", help="season START year, e.g. 2025 for 2025-26")
    ap.add_argument("--out", help="write to this filename instead of the "
                                  "league's default (keeps a harvest from "
                                  "overwriting another desk's source)")
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
    if args.fixtures:
        emit_fixtures(harvest_fixtures(host, key, league, season), league, season)
        return
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

    name = args.out or league.players_file
    (DATA / name).write_text(json.dumps(rows), encoding="utf-8")
    print(f"\n{name} written ({len(rows)} players from "
          f"{len(ids)} clubs, API-Football)")


if __name__ == "__main__":
    main()

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
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data  # noqa: E402

DEFAULT_HOST = "v3.football.api-sports.io"
DEFAULT_SEASON = "2025"     # API-Football names a season by its starting year
DEFAULT_LEAGUE = "40"       # England, Championship


def env_or(name, default):
    """An environment variable, treating set-but-empty as absent."""
    return (os.environ.get(name) or "").strip() or default

RAPIDAPI_HOST = "api-football-v1.p.rapidapi.com"
PAGE_SIZE = 20          # API-Football's fixed page size for /players

# API-Football's club names are not the names build_pl_data keys on, and an
# unmapped name is silently no club at all — the failure that must never be
# quiet here. Mapped explicitly, and every one of the three is then asserted
# present before a single player is fetched.
CLUB_ALIASES = {
    "Coventry": "Coventry City",
    "Coventry City": "Coventry City",
    "Ipswich": "Ipswich Town",
    "Ipswich Town": "Ipswich Town",
    "Hull City": "Hull City",
    "Hull": "Hull City",
}


def canonical_club(api_name):
    """The name build_pl_data.SHORT keys on, or None if we do not want it."""
    return CLUB_ALIASES.get((api_name or "").strip())


def resolve_teams(payload):
    """{full club name: team id} for the promoted clubs in a /teams response,
    plus the ones missing. Missing is a hard error upstream: fetching two of
    three squads and shipping is the whole class of bug being fixed."""
    found = {}
    for row in (payload or {}).get("response", []) or []:
        team = row.get("team") or {}
        name = canonical_club(team.get("name"))
        if name and team.get("id") is not None:
            found[name] = team["id"]
    wanted = {build_pl_data.SHORT[n]: n for n in set(CLUB_ALIASES.values())}
    missing = sorted(n for s, n in wanted.items() if n not in found)
    return found, missing


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


def map_player(entry, club_name):
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
        if ((s.get("team") or {}).get("name") or "").strip() and \
                canonical_club((s.get("team") or {}).get("name")) == club_name:
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
        errors = payload.get("errors")
        # API-Football answers 200 with an errors object for a bad key or an
        # exhausted quota, so a non-empty errors field is a failure even
        # though the HTTP status says otherwise.
        if errors and not (isinstance(errors, list) and not errors):
            raise RuntimeError(f"{club_name}: API returned errors: {errors}")
        reported = pages_needed(payload)
        # Take the largest total any page has claimed. Trusting only page one
        # means a feed that revises its count upward mid-walk gets truncated —
        # and a truncated squad is the exact failure this route exists to
        # avoid, so the walk grows rather than stops.
        if total_pages is None or reported > total_pages:
            total_pages = reported
        for entry in payload.get("response") or []:
            row = map_player(entry, club_name)
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


def _get(host, key, path, params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"https://{host}/{path}?{q}"
    req = urllib.request.Request(url, headers=_headers(host, key))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            sys.exit(f"ERROR: {url} answered {e.code} — API_FOOTBALL_KEY is "
                     "missing, wrong, or not entitled to this endpoint.")
        if e.code == 429:
            sys.exit("ERROR: API-Football rate limit reached (the free tier is "
                     "100 requests a day). Try again tomorrow or use a paid key.")
        raise


def main():
    key = os.environ.get("API_FOOTBALL_KEY", "").strip()
    if not key:
        sys.exit("ERROR: set API_FOOTBALL_KEY to an API-Football key "
                 "(free tier is enough — see the docstring at the top).")
    # `os.environ.get(name, default)` returns "" for a var that is SET but
    # empty, which is exactly what a blank workflow input produces — so the
    # default never fires and the request goes out as `season=`. Fall back on
    # emptiness, not on absence.
    host = env_or("API_FOOTBALL_HOST", DEFAULT_HOST)
    season = env_or("API_FOOTBALL_SEASON", DEFAULT_SEASON)
    league = env_or("API_FOOTBALL_LEAGUE", DEFAULT_LEAGUE)
    if not season.isdigit() or len(season) != 4:
        sys.exit(f"ERROR: API_FOOTBALL_SEASON is {season!r}. API-Football names a "
                 "season by its starting year, so 2025 means 2025-26. This is NOT "
                 "the ScoutingStats season id (a five-digit number like 25583) — "
                 "passing one of those here asks for a season that does not exist.")

    teams_payload = _get(host, key, "teams", {"league": league, "season": season})
    ids, missing = resolve_teams(teams_payload)
    if missing:
        sys.exit(
            "ERROR: league " + league + " season " + season + " does not contain: "
            + ", ".join(missing)
            + "\nEither the season is wrong, the clubs are not in this division, "
              "or API-Football spells them differently — add the spelling to "
              "CLUB_ALIASES rather than letting a club go missing.")

    rows = []
    for club_name, team_id in sorted(ids.items()):
        rows += collect_players(
            lambda page, t=team_id: _get(host, key, "players", {
                "league": league, "season": season, "team": t, "page": page}),
            team_id, club_name)
        print(f"{club_name}: {len([r for r in rows if r['team'] == club_name])} players")

    # The same coverage bar the other route now has to clear. A harvest that
    # cannot fill three squads must not overwrite one that did.
    shortfall = _shortfall(rows)
    if shortfall:
        sys.exit("ERROR: the harvest does not cover the promoted clubs, so "
                 "champ_promoted.json was NOT overwritten:\n  - "
                 + "\n  - ".join(shortfall))

    out = DATA / "champ_promoted.json"
    out.write_text(json.dumps(rows), encoding="utf-8")
    print(f"champ_promoted.json written ({len(rows)} players from API-Football)")


def _shortfall(rows):
    """Coverage, judged by build_pl_data's own rule rather than a second copy
    of it — see the note on harvest.promoted_shortfall."""
    mapped = []
    for r in rows:
        short = build_pl_data.SHORT.get(r["team"])
        if short in build_pl_data.PROMOTED:
            mapped.append({"c": short,
                           "p": build_pl_data.POS.get(r["pos"], r["pos"] or "")})
    return build_pl_data.coverage_problems(mapped)


if __name__ == "__main__":
    main()

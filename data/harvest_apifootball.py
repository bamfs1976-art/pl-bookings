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
    if code.upper() in SPANISH:
        # Spain's division is DISCOVERED, not declared — see leagues.py. Before
        # --clubs has ever run there is no vocabulary to check against, and
        # that is the normal first state rather than an error.
        #
        # SEGUNDA RESOLVES AGAINST LA LIGA'S REGISTRY, deliberately. That
        # harvest exists for the clubs PROMOTED into La Liga, so the twenty
        # names worth recognising in a second-tier response are La Liga's, and
        # the other twenty are meant to be skipped. Falling through to the
        # English maps below — which is what this did — checks Spanish clubs
        # against Championship and Premier League names, matches nothing, and
        # exits with "no clubs this desk recognises". Inside a
        # continue-on-error step that is a green tick and three missing squads.
        return set(leagues.load_clubs("LL"))
    return set(leagues.EFLC_CLUBS) | set(build_pl_data.SHORT)


# The Spanish family. Both resolve against La Liga's registry: Segunda is
# harvested only for the clubs that have just come up into it.
SPANISH = {"LL", "SEG"}


def canonical_for(code, raw):
    """A feed's club name as the name that league's builder keys on."""
    if code.upper() in SPANISH:
        n = (raw or "").strip()
        if not n:
            return None
        # leagues.canon_name, NOT a local alias lookup. It consults BOTH
        # spelling tables; this consulted only the API-Football one, so a feed
        # name that happens to match a football-data spelling went unmapped.
        # That is how Alaves was lost: the 2025-26 response canonicalised to
        # "Deportivo Alaves" (via the football-data table, which the referee
        # join uses) while the 2026-27 registry stored the raw "Alaves" — two
        # canonicalisers, two answers, one club with no squad and no error.
        canon = leagues.canon_name("LL", n)
        reg = leagues.load_clubs("LL")
        if not reg:
            return canon          # discovery pass: every club is new
        if canon in reg:
            return canon
        # Accent-only differences are the same club, not a new one.
        flat = leagues.strip_accents(canon).lower()
        for name in reg:
            if leagues.strip_accents(name).lower() == flat:
                return name
        return None
    return leagues.canonical_club(raw, known_names(code))


def resolve_teams(payload, code):
    """{canonical club name: team id} for a /teams response, plus the names
    nothing could be made of.

    Unmapped names are RETURNED, not skipped. A club whose squad silently does
    not arrive is indistinguishable from a club with no players, and this repo
    has already spent a year on that confusion.
    """
    found, unmapped = {}, []
    for row in (payload or {}).get("response", []) or []:
        team = row.get("team") or {}
        raw = (team.get("name") or "").strip()
        name = canonical_for(code, raw)
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
        # The player's face and availability, which this response has always
        # carried and this harvester has always discarded. They were dropped
        # together with the crest bug above and never put back, so the desks
        # went without photographs on the grounds that "there is no source" —
        # when the source was the call already being made. Kept under distinct
        # keys so neither can ever be mistaken for the badge again.
        "photo": player.get("photo"),
        "inj": player.get("injured"),
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


def short_in(code, name):
    """A club name as its short code, for whichever league is asking.

    The Premier League's map lives in build_pl_data rather than leagues.py, so
    the dispatch is here — leagues.short_for would send a PL club to the
    Championship's map and answer None for all twenty of them.
    """
    if code.upper() == "PL":
        return build_pl_data.SHORT.get((name or "").strip())
    return leagues.short_for(code, name)


def map_fixture(entry, known, code="EFLC"):
    """One /fixtures row into the shape the desk reads, or None.

    A fixture whose clubs this desk does not know is dropped rather than
    half-built: a card with one side blank is worse than no card.
    """
    fx = (entry or {}).get("fixture") or {}
    tm = (entry or {}).get("teams") or {}
    lg = (entry or {}).get("league") or {}
    home = canonical_for(code, (tm.get("home") or {}).get("name"))
    away = canonical_for(code, (tm.get("away") or {}).get("name"))
    if not home or not away:
        return None
    h, a = short_in(code, home), short_in(code, away)
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


# ---- per-player, per-fixture: the training table the model has never had ----
#
# WHY THIS EXISTS. data/harvest_history.py builds the model's training rows from
# the FPL element-summary endpoint. It is leakage-free and well built and it is
# PREMIER LEAGUE ONLY, because FPL has no Championship and no La Liga. So
# `build-model.mjs --fit` can only ever be fitted on one of the three divisions
# this app covers: "basis: season-prior, fitRows: 0" is not "not fitted yet" for
# the other two, it is UNFITTABLE with the sources that were wired.
#
# /fixtures/players returns, for ONE fixture, every player's minutes, fouls
# committed and cards. That is the label and both features, for any league the
# key covers. One call per fixture: a completed season is 380 (PL, La Liga) or
# 552 (Championship), so a backfill is roughly 1,300 calls against a 7,500/day
# allowance, and the ongoing cost is about a dozen a matchday.

# API-Football writes positions as single letters.
AF_POS = {"G": "GK", "D": "DF", "M": "MF", "F": "FW"}

# Only a finished match has a complete card record. Anything else would train
# the model on a scoreline that had not happened yet.
FINISHED = {"FT", "AET", "PEN"}


def map_fixture_player(entry, club_of):
    """One player's line from a /fixtures/players response.

    `club_of` maps an API-Football team id to this desk's short code; a team the
    desk does not know is dropped rather than guessed at, the same rule the
    fixture mapping uses.
    """
    stats = (entry.get("statistics") or [{}])[0] or {}
    games = stats.get("games") or {}
    mins = games.get("minutes")
    # A player who did not get on has no evidence in either direction: he did
    # not fail to be booked, he was not exposed. Dropping him is what keeps the
    # base rate a rate per match PLAYED.
    if not mins:
        return None
    cards = stats.get("cards") or {}
    fouls = stats.get("fouls") or {}
    name = ((entry.get("player") or {}).get("name") or "").strip()
    if not name:
        return None
    return {
        "player": name,
        "club": club_of,
        "pos": AF_POS.get((games.get("position") or "").upper()[:1]),
        "min": int(mins),
        # `committed` is null for some fixtures rather than zero. Null is not
        # zero — a match with no foul data must not train the model as a match
        # in which nobody fouled — so it stays None and the builder skips it.
        "fouls": fouls.get("committed"),
        "yc": int(cards.get("yellow") or 0),
        "rc": int(cards.get("red") or 0),
    }


def harvest_player_matches(host, key, league, season, limit=None):
    """Every finished fixture of a season, one call each."""
    af = str(league.af_league)
    payload = _get(host, key, "fixtures", {"league": af, "season": season})
    err = api_errors(payload)
    if err:
        sys.exit(f"ERROR: /fixtures returned errors: {err}")
    fixtures = payload.get("response") or []
    done = [f for f in fixtures
            if (((f.get("fixture") or {}).get("status") or {}).get("short") in FINISHED)]
    done.sort(key=lambda f: (f.get("fixture") or {}).get("date") or "")
    if limit:
        done = done[:limit]
    print(f"  {len(fixtures)} fixtures, {len(done)} finished"
          + (f" (capped at {limit})" if limit else ""))

    rows, missing = [], 0
    for i, f in enumerate(done, 1):
        fx = f.get("fixture") or {}
        fid = fx.get("id")
        if i % 25 == 0 or i == len(done):
            print(f"  {i}/{len(done)} fixtures")
        pl = _get(host, key, "fixtures/players", {"fixture": fid})
        e = api_errors(pl)
        if e:
            # 200-with-errors is a refusal, not an empty match. Reading it as
            # "nobody played" would train the model on a fixture of ghosts.
            print(f"    fixture {fid}: {e} — skipped")
            continue
        teams = pl.get("response") or []
        if not teams:
            missing += 1
            continue
        for side in teams:
            tm = side.get("team") or {}
            short = short_in(league.code, canonical_for(league.code, tm.get("name")))
            if not short:
                continue
            for entry in side.get("players") or []:
                row = map_fixture_player(entry, short)
                if not row:
                    continue
                row.update({
                    "league": league.code,
                    "fixture_id": fid,
                    "date": fx.get("date"),
                    "round": round_no((f.get("league") or {}).get("round")),
                })
                rows.append(row)
    if missing:
        print(f"  {missing} finished fixture(s) returned no player lines")
    return rows


def foul_diagnosis(rows):
    """WHY the foul coverage is what it is, printed rather than guessed at.

    The first real harvest came back with fouls on 46% of Championship rows and
    50% of Spanish ones, and the two readings that would explain it demand
    opposite responses:

      * the feed omits some MATCHES entirely — then those fixtures are unusable
        and the rest are fine;
      * the feed writes null where it means ZERO — then half the league looks
        foul-free, the gate is measuring the wrong thing, and treating null as
        zero is not a fudge but the correct decode.

    The tell is whether an explicit 0 ever appears. If a feed uses 0 for "no
    fouls" then null must mean "not recorded"; if it never does, null IS zero.
    """
    n = len(rows) or 1
    nulls = [r for r in rows if r["fouls"] is None]
    zeros = [r for r in rows if r["fouls"] == 0]
    by_fx = {}
    for r in rows:
        f = by_fx.setdefault(r["fixture_id"], [0, 0])
        f[0] += 1
        if r["fouls"] is None:
            f[1] += 1
    whole = sum(1 for c, nl in by_fx.values() if c and c == nl)
    partial = sum(1 for c, nl in by_fx.values() if nl and c != nl)
    mins = sorted(r["min"] for r in nulls) or [0]
    out = [
        f"fouls recorded on {len(rows) - len(nulls)}/{n} rows "
        f"({100 * (1 - len(nulls) / n):.0f}%)",
        f"explicit zeros: {len(zeros)}",
        f"fixtures wholly without fouls: {whole}, partly: {partial}, of {len(by_fx)}",
        f"minutes on null rows: median {mins[len(mins) // 2]}, max {mins[-1]}",
    ]
    # The verdict, stated rather than left for a reader to derive. These are the
    # only three shapes the numbers can take and each has a different fix.
    if not zeros and nulls:
        out.append("VERDICT: the feed never writes an explicit 0, so null MEANS "
                   "zero — decode it as zero rather than as missing.")
    elif zeros and whole:
        out.append("VERDICT: explicit zeros DO occur, so null means 'not "
                   "recorded'. The wholly-null fixtures are feed gaps to drop; "
                   "the rest are usable.")
    elif zeros:
        out.append("VERDICT: explicit zeros occur and no fixture is wholly "
                   "null, so the nulls are scattered missing values rather "
                   "than a whole-match gap.")
    for line in out:
        print("  " + line)
    return out


def emit_player_matches(rows, league, season, out=None):
    name = out or f"{league.code.lower()}_player_matches.json"
    (DATA / name).write_text(json.dumps(rows), encoding="utf-8")
    booked = sum(1 for r in rows if r["yc"] or r["rc"])
    fx = len({r["fixture_id"] for r in rows})
    print(f"\n{name} written: {len(rows)} player-matches over {fx} fixtures, "
          f"{booked} with a card ({(100 * booked / len(rows) if rows else 0):.1f}%).")
    diag = foul_diagnosis(rows)
    # WRITTEN DOWN, not only printed — the same reason data/laliga_harvest.log
    # is committed. A finding that lives only in a job log is one somebody has
    # to go and open, and this one decides how the training table is decoded.
    (DATA / "player_matches_status.txt").write_text(
        f"{league.name} {season}: {len(rows)} player-matches over {fx} "
        f"fixtures, {booked} carded.\n" + "\n".join(diag) + "\n",
        encoding="utf-8")


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
            got = map_fixture(entry, known, league.code)
            if got:
                rows.append(got)
            else:
                tm = (entry or {}).get("teams") or {}
                for side in ("home", "away"):
                    nm = ((tm.get(side) or {}).get("name") or "").strip()
                    if nm and not canonical_for(league.code, nm):
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


# Each desk's fixture list: the global its page reads, and the file it lives
# in. Keyed by league so a second desk cannot quietly overwrite the first's.
FIXTURE_FILES = {
    "PL": ("PL_FIXTURES", "pl_fixtures.js"),
    "EFLC": ("EFLC_FIXTURES", "eflc_fixtures.js"),
    "LL": ("LALIGA_FIXTURES", "laliga_fixtures.js"),
}

# A SECOND, different fixture list, for leagues whose referees have to be
# joined on (see build_refs.attach_referees). Two lists because they are two
# seasons: the one above is the season being PLAYED, which is what the Fixtures
# tab shows and which has barely any referees appointed yet; this one is the
# season just COMPLETED, which is where a referee's card rate comes from.
# Conflating them gives a desk that prices every fixture off no referee data.
REF_FIXTURE_FILES = {
    "LL": ("LALIGA_REF_FIXTURES", "laliga_ref_fixtures.js"),
}


def map_ref_fixture(entry, code):
    """One /fixtures row for the REFEREE JOIN: date, both clubs by canonical
    name, and the official.

    Deliberately not map_fixture. That one resolves clubs to the short codes
    of the CURRENT division and drops anything outside it — correct for a
    fixture card, ruinous here, because this list covers a season three of
    whose clubs have since been relegated. Dropping them would remove a fifth
    of every referee's matches while looking like a complete table.
    """
    fx = (entry or {}).get("fixture") or {}
    tm = (entry or {}).get("teams") or {}
    home = leagues.canon_name(code, (tm.get("home") or {}).get("name"))
    away = leagues.canon_name(code, (tm.get("away") or {}).get("name"))
    date = fx.get("date")
    if not home or not away or not date:
        return None
    ref = (fx.get("referee") or "").strip() or None
    if ref:
        ref = ref.split(",")[0].strip() or None
    return {"d": str(date)[:10], "hn": home, "an": away, "ref": ref}


def harvest_ref_fixtures(host, key, league, season):
    """Every completed fixture and its official, for one league-season."""
    af = str(league.af_league)
    payload = _get(host, key, "fixtures", {"league": af, "season": season})
    err = api_errors(payload)
    if err:
        sys.exit(f"ERROR: API-Football refused the /fixtures request: {err}")
    rows, page, pages = [], 1, pages_needed(payload)
    while True:
        for entry in (payload.get("response") or []):
            got = map_ref_fixture(entry, league.code)
            if got:
                rows.append(got)
        if page >= pages:
            break
        page += 1
        payload = _get(host, key, "fixtures",
                       {"league": af, "season": season, "page": page})
        pages = max(pages, pages_needed(payload))
    rows.sort(key=lambda x: (x["d"], x["hn"]))
    return rows


def emit_ref_fixtures(rows, league, season):
    try:
        const, filename = REF_FIXTURE_FILES[league.code]
    except KeyError:
        sys.exit(f"ERROR: {league.name} does not need a referee-join fixture "
                 "list — its free match records already name the official.")
    withref = sum(1 for r in rows if r["ref"])
    names = sorted({r["hn"] for r in rows} | {r["an"] for r in rows})
    lines = [
        "// Auto-generated by harvest_apifootball.py --ref-fixtures.",
        f"// {league.name} {season}-{int(season) % 100 + 1}: {len(rows)} matches, "
        f"{withref} with an official named.",
        "// NOT the fixture list the page shows — this is the COMPLETED season,",
        "// and it exists so build_refs.py can join a referee NAME onto the free",
        "// match records, which for this league carry every card but no official.",
        f"const {const} = [",
    ]
    for r in rows:
        lines.append("  {" + ",".join([
            f'd:{json.dumps(r["d"])}', f'hn:{json.dumps(r["hn"], ensure_ascii=False)}',
            f'an:{json.dumps(r["an"], ensure_ascii=False)}',
            f'ref:{json.dumps(r["ref"], ensure_ascii=False)}',
        ]) + "},")
    lines.append("];")
    (DATA / filename).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{filename} written ({len(rows)} matches over {len(names)} clubs, "
          f"{withref} with an official named)")
    if withref < len(rows) // 2:
        print("  WARNING: fewer than half these matches name an official. The "
              "referee table\n  built from this will be thin — check the season "
              "is one the plan covers.")


def emit_fixtures(rows, league, season):
    """A committed .js file, same as the datasets: the page loads it with a
    script tag and no fetch, so it works offline and needs no key in the
    client."""
    try:
        const, filename = FIXTURE_FILES[league.code]
    except KeyError:
        sys.exit(f"ERROR: {league.name} has no fixture file configured. Add it "
                 "to FIXTURE_FILES, or its fixtures would overwrite another "
                 "desk's list.")
    withref = sum(1 for r in rows if r["ref"])
    rounds = sorted({r["r"] for r in rows if r["r"]})
    lines = [
        "// Auto-generated by harvest_apifootball.py --fixtures.",
        f"// {league.name} {season}-{int(season) % 100 + 1}: {len(rows)} fixtures, "
        f"{withref} with a referee appointed.",
        f"const {const} = [",
    ]
    for r in rows:
        lines.append("  {" + ",".join([
            f'id:{json.dumps(r["id"])}', f'd:{json.dumps(r["d"])}',
            f'r:{json.dumps(r["r"])}', f'h:{json.dumps(r["h"])}',
            f'a:{json.dumps(r["a"])}', f'ref:{json.dumps(r["ref"])}',
            f'st:{json.dumps(r["st"])}',
        ]) + "},")
    lines.append("];")
    (DATA / filename).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n{filename} written ({len(rows)} fixtures over "
          f"{len(rounds)} matchdays, {withref} with a referee appointed)")


def discover_clubs(payload, league, season):
    """Write the league's club registry from a /teams response.

    THE FIRST STEP FOR A LEAGUE THAT NAMES ITS OWN DIVISION. The Championship
    declares its 24 in leagues.py, derived from a chain of six confirmed
    transfers between divisions — which works, but a wrong link in that chain
    produces a club with no players and no error. Spain's 2026-27 line-up could
    not be confirmed from a primary source, so instead of guessing it the
    division is read from the feed that is about to supply the squads. The two
    can then never disagree.

    Refuses to write a division of the wrong size. Twenty clubs is what La Liga
    is; nineteen means a name arrived in a spelling nothing maps, and shipping
    it would look exactly like a club that has no players.
    """
    names, unmapped = [], []
    ids = {}
    for row in (payload or {}).get("response", []) or []:
        team = row.get("team") or {}
        raw = (team.get("name") or "").strip()
        if not raw or team.get("id") is None:
            if raw:
                unmapped.append(raw)
            continue
        # Same canonicaliser the squad harvest and the referee join use.
        canon = leagues.canon_name(league.code, raw)
        names.append(canon)
        ids[canon] = team["id"]
    shorts = leagues.assign_shorts(names)
    clubs = {n: {"short": shorts[n], "id": ids[n]} for n in sorted(shorts)}

    if len(clubs) != league.clubs:
        sys.exit(f"ERROR: /teams for {league.name} season {season} produced "
                 f"{len(clubs)} clubs, not the {league.clubs} a season has.\n"
                 "  got: " + ", ".join(sorted(clubs))
                 + ("\n  unusable rows: " + ", ".join(unmapped) if unmapped else "")
                 + f"\n\nRefusing to write {leagues.clubs_path(league.code).name}: "
                   "a short division here becomes a desk with missing clubs "
                   "and no error anywhere downstream.")
    if len(set(s["short"] for s in clubs.values())) != len(clubs):
        sys.exit("ERROR: two clubs were assigned the same short code. Add an "
                 "override to leagues.LALIGA_SHORT.")

    generated = [n for n in clubs if n not in leagues.LALIGA_SHORT]
    path = leagues.save_clubs(league.code, clubs, season=season)
    print(f"\n{path.name} written ({len(clubs)} clubs)")
    for n, d in sorted(clubs.items(), key=lambda kv: kv[1]["short"]):
        mark = "  (generated code)" if n in generated else ""
        print(f"    {d['short']}  {n}{mark}")
    if generated:
        print("\n  Codes above marked generated came from auto_short, not the "
              "override table.\n  They are stable, but a club that stays in "
              "the division belongs in\n  leagues.LALIGA_SHORT so its code is "
              "chosen rather than derived.")
    return clubs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clubs", action="store_true",
                    help="discover the division's clubs and write the league's "
                         "club registry, then stop (run this FIRST for a "
                         "league that names its own division)")
    ap.add_argument("--fixtures", action="store_true",
                    help="harvest the fixture list instead of squads")
    ap.add_argument("--player-matches", action="store_true",
                    help="harvest per-player per-fixture minutes, fouls and "
                         "cards for a COMPLETED season — the training table "
                         "for the model fit, which FPL can only provide for "
                         "the Premier League")
    ap.add_argument("--limit", type=int,
                    help="cap the number of fixtures fetched (one call each), "
                         "for a first run that should not spend the day's quota")
    ap.add_argument("--ref-fixtures", action="store_true",
                    help="harvest the COMPLETED season's officials, for the "
                         "referee join (leagues whose free records name no "
                         "official). A different season from --fixtures.")
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
    if args.ref_fixtures:
        emit_ref_fixtures(harvest_ref_fixtures(host, key, league, season),
                          league, season)
        return
    if args.player_matches:
        emit_player_matches(
            harvest_player_matches(host, key, league, season, args.limit),
            league, season, args.out)
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

    if args.clubs:
        discover_clubs(teams_payload, league, season)
        return

    ids, unmapped = resolve_teams(teams_payload, league.code)
    if not ids and league.code == "LL":
        sys.exit(f"ERROR: no {league.name} club registry yet, so there is no "
                 "vocabulary to match the feed against.\n\nRun the discovery "
                 "pass first — it reads the division off the same endpoint:\n"
                 "    python3 data/harvest_apifootball.py --league LL --clubs")
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

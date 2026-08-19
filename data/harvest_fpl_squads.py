#!/usr/bin/env python3
"""
Fill the promoted clubs' squads from the free FPL feed.

Why this exists, and what it deliberately does NOT do.

The promoted three have carried six forwards and nothing else for a year. The
Championship form that would fix that is not obtainable: ScoutingStats needs a
cookie pasted from a browser, and API-Football's free plan refuses the season
outright — "Free plans do not have access to this season, try from 2022 to
2024". Both are dead ends for an automated refresh.

But the squads themselves are free and keyless. These clubs are in the Premier
League for 2026-27, so FPL's bootstrap lists every registered player with their
club and position. That is enough to stop a booking model silently omitting
every centre-back and holding midfielder at three clubs — which is the part
that actually misleads, because those are the players the promoted sides are
picked for.

WHAT THESE ROWS DO NOT HAVE IS FORM, AND THEY SAY SO. Basis is "NEW", not
"EFL": EFL means "rated on Championship form", and labelling a player that way
when no Championship number exists would be a worse lie than leaving him out.
Cards, fouls and risk are null, so the app shows a dash and the player sorts
below anyone with evidence. They fill in on their own as Premier League
minutes accumulate.

The six who DO have Championship form keep it. build_pl_data loads
champ_promoted.json first and de-duplicates on (club, name), so a player with a
real rate is never overwritten by a blank one.

  python3 data/harvest_fpl_squads.py

Writes data/promoted_squads.json. No key, no cookie — the same public endpoint
data/harvest_history.py already uses.
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import build_pl_data  # noqa: E402

BASE = "https://fantasy.premierleague.com/api"
# FPL's element_type, mapped to the vocabulary build_pl_data.POS already keys
# on, so these rows are indistinguishable downstream from any other source.
POS_BY_TYPE = {1: "Goalkeeper", 2: "Defender", 3: "Midfielder", 4: "Attacker"}

# FPL's own club names for the promoted three. Unmapped is not "no players", it
# is a rename we must notice — so every one is asserted present before writing.
CLUB_ALIASES = {
    "Coventry": "Coventry City", "Coventry City": "Coventry City",
    "Ipswich": "Ipswich Town", "Ipswich Town": "Ipswich Town",
    "Hull": "Hull City", "Hull City": "Hull City",
}


def canonical_club(name):
    return CLUB_ALIASES.get((name or "").strip())


def get(path):
    req = urllib.request.Request(BASE + path, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.exit(f"ERROR: {BASE}{path} answered {e.code}. The FPL API is public; "
                 "a non-200 here usually means it is down or rate-limiting.")


def photo_url(code):
    """FPL's player cutout. NOT the `img` field — see squads_from_bootstrap.

    Kept because it is the pattern index.html builds for a player's face; it
    just has no business being a club's badge."""
    return (f"https://resources.premierleague.com/premierleague/photos/players/"
            f"110x140/p{code}.png") if code else None


def squads_from_bootstrap(boot):
    """Rows for the promoted clubs, in the shape build_pl_data.mk consumes.

    Everything that would be a RATE is left null rather than zeroed. A player
    with no minutes has not committed zero fouls per 90 — the rate does not
    exist, and a zero would rank him the calmest defender in the division."""
    teams = {t.get("id"): t for t in (boot or {}).get("teams", []) or []}
    rows = []
    for el in (boot or {}).get("elements", []) or []:
        club = canonical_club((teams.get(el.get("team")) or {}).get("name"))
        if not club:
            continue
        name = (el.get("first_name", "") + " " + el.get("second_name", "")).strip() \
            or el.get("web_name")
        if not name:
            continue
        rows.append({
            "team": club,
            "n": name,
            "pos": POS_BY_TYPE.get(el.get("element_type")),
            "min": el.get("minutes") or 0,
            # Null, not zero. These become the app's dash.
            "yc": None,
            "rc": None,
            "fc90": None,
            "fd90": None,
            "tid": el.get("team"),
            # `img` is the CLUB crest in this row shape, not the player's
            # face — build_pl_data carries it up into CLUBS as the badge.
            # These rows are squad fill-ins for clubs that also have real
            # rows from a source that DOES supply a crest, and build_clubs
            # takes the first non-null, so leaving it null costs nothing.
            # Guessing a badge URL would risk shipping a 404 on every club;
            # a wrong badge is worse than no badge.
            "img": None,
        })
    return rows


def missing_clubs(rows):
    """Promoted clubs with no rows at all — a rename in the feed, not an empty
    squad, and the difference matters because one is fixable here."""
    have = {r["team"] for r in rows}
    return sorted(set(CLUB_ALIASES.values()) - have)


def every_club(boot):
    """Every Premier League squad, keyed by this dataset's club codes.

    The promoted-club fill above answers "who else is at these three clubs".
    This answers a different question — "who is at which club, in the whole
    division, today" — which is what a transfer window makes urgent and what
    the cookie-fed harvest cannot answer once the cookie dies.

    Carries the club CODE rather than a name, because the caller is matching
    against shipped rows that are already keyed on codes, and a second name
    map is a second thing to drift.
    """
    by_id, unmapped = build_pl_data.club_short_by_fpl_id(boot.get("teams", []))
    if unmapped:
        sys.exit("ERROR: FPL names clubs this dataset does not know: "
                 + ", ".join(unmapped)
                 + "\nThat is a rename, not an empty squad, and guessing past "
                   "it would silently retire everybody at that club.")
    rows = []
    for el in boot.get("elements", []) or []:
        short = by_id.get(el.get("team"))
        name = (el.get("first_name", "") + " " + el.get("second_name", "")).strip() \
            or el.get("web_name")
        if short and name:
            rows.append({"c": short, "n": name,
                         "pos": POS_BY_TYPE.get(el.get("element_type"))})
    return rows


def main():
    boot = get("/bootstrap-static/")
    rows = squads_from_bootstrap(boot)

    # The whole division, for build_pl_data.reconcile_squads. Written first so
    # that a failure here cannot leave a promoted-squad file implying a run
    # that also refreshed the transfers.
    full = every_club(boot)
    clubs = {r["c"] for r in full}
    if len(clubs) < 20 or len(full) < 400:
        sys.exit(f"ERROR: FPL returned {len(full)} players across {len(clubs)} "
                 "clubs, which is not a Premier League. Nothing written — a "
                 "short feed reconciled against would retire real players.")
    (DATA / "fpl_squads.json").write_text(json.dumps(full), encoding="utf-8")
    print(f"fpl_squads.json written: {len(full)} players across {len(clubs)} clubs")

    absent = missing_clubs(rows)
    if absent:
        names = sorted({(t.get("name") or "?") for t in boot.get("teams", []) or []})
        sys.exit(
            "ERROR: FPL's squad list does not name: " + ", ".join(absent)
            + "\nIt listed: " + ", ".join(names)
            + "\nIf one of ours is there under another spelling, add it to "
              "CLUB_ALIASES. If it is genuinely absent, these clubs are not in "
              "the Premier League this season and this script is the wrong tool.")

    problems = build_pl_data.coverage_problems(
        [{"c": build_pl_data.SHORT.get(r["team"]),
          "p": build_pl_data.POS.get(r["pos"], r["pos"] or "")} for r in rows])
    if problems:
        sys.exit("ERROR: the FPL squads are themselves incomplete, so nothing was "
                 "written:\n  - " + "\n  - ".join(problems))

    out = DATA / "promoted_squads.json"
    out.write_text(json.dumps(rows), encoding="utf-8")
    by_club = {}
    for r in rows:
        by_club[r["team"]] = by_club.get(r["team"], 0) + 1
    print("promoted_squads.json written: " +
          ", ".join(f"{c} {n}" for c, n in sorted(by_club.items())))
    print("Form is null on every row by design — basis NEW, not EFL. They fill "
          "in as Premier League minutes accumulate.")


if __name__ == "__main__":
    main()

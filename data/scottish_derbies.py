#!/usr/bin/env python3
"""Cards in Scottish Premiership derbies, from the free match archive.

    python3 data/scottish_derbies.py --seasons 2526,2425,2324,2223,2122
    python3 data/scottish_derbies.py --out docs/scottish-derbies.md

WHY THIS CAN EXIST AT ALL. data/probe_fd_division.py measured SC0 on
2026-09-03 and found the Referee column filled on 100% of rows and every card
and foul column with it, across three seasons — the same shape as E0. So a
Scottish card record costs nothing: no key, no quota, no API. It is the one
division outside the desks where that is true and nobody had checked.

WHAT THE NUMBER HAS TO BE COMPARED AGAINST. "The Old Firm averages 5.2 cards"
is not a finding on its own — a league that books more will produce a bigger
number for every fixture in it. So every derby is reported against TWO
baselines: the division as a whole over the same seasons, and the same two
clubs' OTHER matches. The second is the one that matters. If Celtic and
Rangers are simply card-heavy sides, their meetings will be card-heavy without
the fixture being the reason, and only the second baseline separates those.

A SMALL SAMPLE IS SAID OUT LOUD. A derby is two to four matches a season.
Five seasons of the Old Firm is about twenty matches, which is enough to see a
large effect and nowhere near enough to see a small one, so the count is
printed beside every mean and no significance is claimed for any of it.

CLUB NAMES ARE REFUSED, NOT GUESSED. football-data spells clubs its own way
and this project has no Scottish club map. A pair whose names do not both
appear in the data is REPORTED BY NAME and dropped — never quietly counted as
zero matches, which is indistinguishable from a rivalry that was not played.
That is the mistake the Championship derby list made once already, in the
other direction: it flagged Bristol City v Millwall, which is not a derby.
"""

import argparse
import csv
import io
import statistics
import sys
import urllib.error
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
sys.path.insert(0, str(DATA))
import leagues  # noqa: E402

DIV = "SC0"

# The rivalries, with every spelling football-data is known to use for each
# club. Alternates rather than a fuzzy match: a fuzzy match on Scottish club
# names puts Dundee and Dundee United in the same bucket, which would merge a
# derby with half the league.
DERBIES = [
    ("Old Firm", ("Celtic",), ("Rangers",)),
    ("Edinburgh", ("Hearts",), ("Hibernian", "Hibs")),
    ("Dundee", ("Dundee",), ("Dundee United", "Dundee Utd")),
    # Aberdeen v Dundee United — long-established, and the one on this list a
    # reasonable person might argue about, so it is marked rather than
    # presented alongside the other three as equally settled.
    ("New Firm (contested)", ("Aberdeen",), ("Dundee United", "Dundee Utd")),
]


def fetch(season, agent="pl-bookings"):
    url = leagues.ORIGIN.format(season=season, div=DIV)
    req = urllib.request.Request(url, headers={"User-Agent": agent})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace"), None
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        return None, f"{url} — {e}"


def num(v):
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return None


def load(seasons):
    """Every SC0 match over the seasons given, as dicts with card totals."""
    rows, missing = [], []
    for season in seasons:
        text, err = fetch(season)
        if text is None:
            missing.append(f"{season}: {err}")
            continue
        for r in csv.DictReader(io.StringIO(text)):
            h, a = (r.get("HomeTeam") or "").strip(), (r.get("AwayTeam") or "").strip()
            if not h or not a:
                continue
            hy, ay = num(r.get("HY")), num(r.get("AY"))
            hr, ar = num(r.get("HR")), num(r.get("AR"))
            hf, af = num(r.get("HF")), num(r.get("AF"))
            # A ROW WITHOUT CARDS IS NOT A ROW WITH NO CARDS. Postponed and
            # abandoned fixtures appear with the stat columns blank; counted as
            # zero they would drag every mean down and look like a quiet game.
            if hy is None or ay is None:
                continue
            rows.append({
                "season": season, "date": (r.get("Date") or "").strip(),
                "h": h, "a": a,
                "yellows": hy + ay,
                "reds": (hr or 0) + (ar or 0),
                "cards": hy + ay + (hr or 0) + (ar or 0),
                "fouls": (hf or 0) + (af or 0) if hf is not None else None,
                "ref": (r.get("Referee") or "").strip(),
            })
    return rows, missing


def pair_matches(rows, left, right):
    """Matches between two clubs, either way round."""
    L, R = set(left), set(right)
    return [r for r in rows
            if (r["h"] in L and r["a"] in R) or (r["h"] in R and r["a"] in L)]


def club_matches(rows, names):
    N = set(names)
    return [r for r in rows if r["h"] in N or r["a"] in N]


def mean(xs):
    xs = [x for x in xs if x is not None]
    return statistics.mean(xs) if xs else None


def fmt(x, dp=2):
    return "—" if x is None else f"{x:.{dp}f}"


def report(rows, seasons, out=None):
    clubs = sorted({r["h"] for r in rows} | {r["a"] for r in rows})
    lines = []
    def say(s=""):
        lines.append(s)
        print(s)

    say(f"# Cards in Scottish Premiership derbies")
    say()
    say(f"{len(rows)} matches over {len(seasons)} season(s): "
        + ", ".join(seasons) + ".")
    say(f"Source: football-data.co.uk {DIV}, free and keyless. Every figure "
        "below is counted from those rows.")
    say()
    say(f"League baseline over the same seasons: "
        f"**{fmt(mean([r['cards'] for r in rows]))} cards a match** "
        f"({fmt(mean([r['yellows'] for r in rows]))} yellows, "
        f"{fmt(mean([r['reds'] for r in rows]), 3)} reds), "
        f"{fmt(mean([r['fouls'] for r in rows]), 1)} fouls.")
    say()
    say(f"Clubs found ({len(clubs)}): " + ", ".join(clubs))
    say()

    league_cards = mean([r["cards"] for r in rows])

    say("## Each rivalry against two baselines")
    say()
    say("The second baseline is the one that matters: the same two clubs' "
        "OTHER matches. A pair of card-heavy sides will produce a card-heavy "
        "meeting whether or not the fixture is the reason.")
    say()
    say("| Rivalry | Matches | Cards/match | vs league | The two clubs elsewhere | vs that |")
    say("|---|--:|--:|--:|--:|--:|")

    unresolved = []
    detail = []
    for name, left, right in DERBIES:
        if not (set(left) & set(clubs)) or not (set(right) & set(clubs)):
            unresolved.append((name, left, right))
            continue
        ms = pair_matches(rows, left, right)
        if not ms:
            unresolved.append((name, left, right))
            continue
        # BY IDENTITY, NOT BY VALUE. `r not in ms` compares dicts field by
        # field, so two matches that happened to agree on every column would
        # both drop out of the baseline. Rare, silent, and free to avoid.
        in_derby = {id(r) for r in ms}
        others = [r for r in club_matches(rows, set(left) | set(right))
                  if id(r) not in in_derby]
        d, o = mean([r["cards"] for r in ms]), mean([r["cards"] for r in others])
        say(f"| {name} | {len(ms)} | **{fmt(d)}** | {fmt(d - league_cards, 2)} "
            f"| {fmt(o)} | {fmt(d - o, 2)} |")
        detail.append((name, ms, others))

    say()
    if unresolved:
        say("### Not counted")
        say()
        for name, left, right in unresolved:
            say(f"- **{name}** — no matches found between "
                f"{' / '.join(left)} and {' / '.join(right)} in these seasons. "
                "Either the clubs were not both in the division, or "
                "football-data spells one of them differently. NOT reported as "
                "zero, because that reads as a rivalry with no cards.")
        say()

    for name, ms, others in detail:
        say(f"### {name}")
        say()
        say(f"{len(ms)} matches. "
            f"Yellows {fmt(mean([r['yellows'] for r in ms]))} a game "
            f"(the clubs' other matches: {fmt(mean([r['yellows'] for r in others]))}), "
            f"reds {fmt(mean([r['reds'] for r in ms]), 3)} "
            f"(elsewhere {fmt(mean([r['reds'] for r in others]), 3)}), "
            f"fouls {fmt(mean([r['fouls'] for r in ms]), 1)} "
            f"(elsewhere {fmt(mean([r['fouls'] for r in others]), 1)}).")
        say()
        worst = max(ms, key=lambda r: r["cards"])
        say(f"Most cards in one meeting: {fmt(worst['cards'], 0)} — "
            f"{worst['h']} v {worst['a']}, {worst['date']}"
            + (f", referee {worst['ref']}" if worst["ref"] else "") + ".")
        say()
        say("| Season | Date | Fixture | Cards | Yellows | Reds | Referee |")
        say("|---|---|---|--:|--:|--:|---|")
        for r in sorted(ms, key=lambda r: (r["season"], r["date"])):
            say(f"| {r['season']} | {r['date']} | {r['h']} v {r['a']} "
                f"| {fmt(r['cards'], 0)} | {fmt(r['yellows'], 0)} "
                f"| {fmt(r['reds'], 0)} | {r['ref'] or '—'} |")
        say()

    say("---")
    say()
    say("A derby is two to four matches a season, so these counts are small. "
        "They are enough to see a large effect and nowhere near enough to see "
        "a small one, and no significance is claimed for any of it.")

    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"\n{out} written")
    return len(detail)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", default="2526,2425,2324,2223,2122,2021,1920",
                    help="comma-separated football-data season codes")
    ap.add_argument("--out", default="", help="also write a markdown report here")
    args = ap.parse_args()

    seasons = [s.strip() for s in args.seasons.split(",") if s.strip()]
    rows, missing = load(seasons)
    for m in missing:
        print(f"  season unreadable — {m}", file=sys.stderr)
    if not rows:
        sys.exit("ERROR: no Scottish match rows could be read. This is not a "
                 "finding about derbies; it is a failure to fetch. Run it "
                 "somewhere that reaches www.football-data.co.uk.")
    got = [s for s in seasons if any(r["season"] == s for r in rows)]
    n = report(rows, got, args.out or None)
    if not n:
        sys.exit("ERROR: not one rivalry resolved against the club names in "
                 "the data. The names above are what football-data actually "
                 "uses — fix DERBIES to match rather than shipping an empty "
                 "report.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

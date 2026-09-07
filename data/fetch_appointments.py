#!/usr/bin/env python3
"""Find this week's published referee appointments and print them as text.

  python3 data/fetch_appointments.py --league LL   --out sheet.txt
  python3 data/fetch_appointments.py --league EFLC --out article.txt
  python3 data/fetch_appointments.py --league LL   --list

Then, unchanged:

  python3 data/ingest_appointments.py --format rfef --source <url> --file sheet.txt

WHAT THIS IS FOR. data/ingest_appointments.py reads a published sheet into the
overlay and resolves every official to a card record. It has always been fed by
hand, and its docstring says why it does not fetch: "a scraper for one
publisher's prose that silently returns nothing when the markup moves is worse
than a paste: a week with no appointments looks identical to a week that was
not ingested."

That reasoning is right and this script is built around it rather than through
it. THREE RULES follow from it:

  IT ONLY PRODUCES TEXT. It never touches data/appointments.json and never
  writes a fixture file. Whatever it finds still has to get past the ingester,
  which resolves names against the card table and refuses to guess. A bad
  fetch can waste a run; it cannot put a wrong official on a fixture.

  IT EXITS NON-ZERO WHEN IT FINDS NOTHING. There is no "fetched, parsed zero,
  carried on" path. The workflow step reports the failure and the committed
  overlay is left exactly as it was, which is the state the desk was already
  in — so the automation can fail without costing anything except the run.

  IT ASKS FOR EXACTLY WHAT IS MISSING. Both leagues' pending rounds are read
  out of the committed fixture file: the dates in the next --days that have no
  referee. Nothing is fetched for a round already covered.

HOW EACH LEAGUE IS FOUND, and why the two are found differently.

  LA LIGA — by PROBING A FILENAME, not by scraping a page. The RFEF publishes
  each designation sheet at a URL of the form

    /sites/default/files/designaciones_1a_division_masculina_-_temp_2026-27_
      -_jornada_1_sabado15.pdf

  which is three facts this repository already has: the season, the jornada,
  and the weekday and day-of-month of the fixture. So the pending rounds give
  the candidates directly and each 200 is a confirmed sheet. Probing a pattern
  cannot be broken by a redesign of the page that links to it, which scraping
  an index can — and there is no version of this that quietly half-works: a
  URL either answers with a PDF or it does not.

  THE CHAMPIONSHIP — by scraping, because there is no pattern to probe. The
  EFL's slug carries a human-written date range ("referee-appointments--14-20-
  august") that cannot be derived from the fixture list. So the news index is
  fetched and searched for hrefs containing that stem. The search is a regex
  over hrefs rather than a walk of the DOM: it needs the site's URLs to keep
  the word "referee-appointments" in them and nothing else about the markup.

WHAT IT NEEDS INSTALLED. `pdftotext` (poppler-utils) for La Liga, and only for
La Liga. Layout matters: parse_rfef splits the two clubs on a run of spaces, so
the columns have to survive extraction — which is what `-layout` preserves and
what a naive text extractor throws away. Its absence is reported as a missing
dependency, not as an empty week.
"""

import argparse
import datetime as dt
import html
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ingest_appointments as I     # noqa: E402

DATA = Path(__file__).resolve().parent

# A real one. Both publishers serve a public page to a browser and neither is
# being asked for anything a reader could not open; a blank agent is the thing
# that gets refused.
UA = ("Mozilla/5.0 (compatible; BookingsDesk/1.0; "
      "+https://bookingsdesk.netlify.app) referee-appointments")
TIMEOUT = 45

FIXTURES = {"LL": "laliga_fixtures.js", "EFLC": "eflc_fixtures.js"}

# Spanish weekday names as the RFEF spells them in a filename: lowercase and
# unaccented (miercoles, sabado), Monday first to match date.weekday().
ES_WEEKDAYS = ["lunes", "martes", "miercoles", "jueves",
               "viernes", "sabado", "domingo"]

RFEF_BASE = "https://rfef.es/sites/default/files/"
RFEF_STEM = "designaciones_1a_division_masculina_-_temp_{season}_-_jornada_{r}_"

EFL_INDEX = [
    "https://www.efl.com/news/",
    "https://www.efl.com/news/?category=referee-appointments",
]
EFL_SLUG = re.compile(r'href="([^"]*referee-appointments[^"]*)"', re.I)


def fetch(url, binary=False):
    """One GET, or None. Every failure is printed and none is fatal here: a
    probe that 404s is the ordinary case, not an error."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
            return body if binary else body.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"    {url} -> HTTP {e.code}")
        return None
    except Exception as e:                                  # noqa: BLE001
        print(f"    {url} -> {type(e).__name__}: {e}")
        return None


def pending(code, days):
    """(date, round) for every fixture inside the window with no referee.

    Read from the COMMITTED fixture file rather than a schedule of our own, so
    this asks for a sheet exactly when the desk is missing one — and asks for
    nothing at all once the harvest has caught up on its own.
    """
    path = DATA / FIXTURES[code]
    if not path.exists():
        sys.exit(f"ERROR: {path.name} does not exist — nothing to fill.")
    rows, season, _ = I.read_fixture_file(path)
    today = dt.date.today()
    horizon = today + dt.timedelta(days=days)
    out = {}
    for row in rows:
        if row.get("ref"):
            continue
        raw = str(row.get("d") or "")[:10]
        try:
            d = dt.date.fromisoformat(raw)
        except ValueError:
            continue
        # Today included: a sheet for this evening's kick-off is the one most
        # worth having, and the last one a daily job would think to ask for.
        if today <= d <= horizon:
            out.setdefault((d, row.get("r")), 0)
            out[(d, row.get("r"))] += 1
    return sorted(out.items())


# ---------------------------------------------------------------------------
# La Liga — probe the RFEF filename
# ---------------------------------------------------------------------------

def rfef_candidates(rounds, season):
    """Every URL worth trying, most specific first, without repeats."""
    urls = []
    for (d, r), _ in rounds:
        if r is None:
            continue
        stem = RFEF_BASE + RFEF_STEM.format(season=season, r=r)
        day = ES_WEEKDAYS[d.weekday()]
        # The three shapes seen in the wild: "sabado15", "sabado_15", "sabado".
        # A sheet covering a whole jornada carries no day at all.
        for tail in (f"{day}{d.day}", f"{day}_{d.day}", day, f"{day}{d.day:02d}"):
            u = stem + tail + ".pdf"
            if u not in urls:
                urls.append(u)
    return urls


def pdf_text(blob):
    """PDF bytes as LAYOUT-PRESERVING text, or None with the reason printed."""
    if not shutil.which("pdftotext"):
        print("    pdftotext is not installed — install poppler-utils "
              "(apt-get install -y poppler-utils)")
        return None
    try:
        out = subprocess.run(["pdftotext", "-layout", "-", "-"],
                             input=blob, capture_output=True, timeout=60)
    except Exception as e:                                  # noqa: BLE001
        print(f"    pdftotext failed: {type(e).__name__}: {e}")
        return None
    if out.returncode != 0:
        print(f"    pdftotext exited {out.returncode}: "
              f"{out.stderr.decode('utf-8', 'replace')[:200]}")
        return None
    return out.stdout.decode("utf-8", "replace")


def find_laliga(rounds, season, verbose):
    found = []
    for url in rfef_candidates(rounds, season):
        if verbose:
            print(f"  probing {url}")
        blob = fetch(url, binary=True)
        if not blob:
            continue
        if not blob.startswith(b"%PDF"):
            print(f"    {url} answered but is not a PDF — skipped")
            continue
        text = pdf_text(blob)
        if text is None:
            continue
        # PARSED, not merely downloaded. A sheet that yields no rows is a
        # changed layout, and saying "found 1 sheet" for it would be the exact
        # quiet half-success this script exists to avoid.
        rows = I.parse_rfef(text)
        print(f"  {url}\n    {len(rows)} appointment(s) parsed")
        if rows:
            found.append((url, text))
    return found


# ---------------------------------------------------------------------------
# The Championship — scrape the EFL news index for the article
# ---------------------------------------------------------------------------

TAGS = re.compile(r"(?is)<(script|style)[^>]*>.*?</\1>")
BLOCK = re.compile(r"(?i)</(p|div|li|h\d|tr|br)\s*>|<br\s*/?>")
ANYTAG = re.compile(r"<[^>]+>")


def to_text(markup):
    """Markup as lines. Block ends become newlines because the parser reads a
    fixture and its referee as separate lines; collapse them and a whole
    article becomes one unparseable line."""
    s = TAGS.sub(" ", markup)
    s = BLOCK.sub("\n", s)
    s = ANYTAG.sub(" ", s)
    s = html.unescape(s)
    lines = [re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in s.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def find_eflc(verbose):
    seen, found = [], []
    for index in EFL_INDEX:
        if verbose:
            print(f"  index {index}")
        page = fetch(index)
        if not page:
            continue
        for href in EFL_SLUG.findall(page):
            url = urllib.parse.urljoin(index, html.unescape(href))
            if url not in seen:
                seen.append(url)
    if not seen:
        print("  the EFL news index listed no referee-appointments article — "
              "either none is published or the site no longer puts that stem "
              "in its URLs")
        return found
    # Newest first is what the index gives; two is enough to cover a week that
    # spans a publication, and stops a redesign turning this into a crawl.
    for url in seen[:3]:
        page = fetch(url)
        if not page:
            continue
        text = to_text(page)
        rows, _, _ = I.parse(text, default_year=dt.date.today().year)
        print(f"  {url}\n    {len(rows)} appointment(s) parsed")
        if rows:
            found.append((url, text))
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", required=True, choices=["LL", "EFLC"])
    ap.add_argument("--out", help="write the text here (default: stdout)")
    ap.add_argument("--source-out", help="write the URL it came from here, so "
                                         "the workflow can pass it to --source")
    ap.add_argument("--days", type=int, default=8,
                    help="how far ahead to look for uncovered fixtures (default 8)")
    ap.add_argument("--list", action="store_true",
                    help="report what is missing and what would be fetched, "
                         "and fetch nothing")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    rows, season, name = I.read_fixture_file(DATA / FIXTURES[args.league])
    rounds = pending(args.league, args.days)
    total = sum(n for _, n in rounds)
    print(f"{name or args.league}: {total} fixture(s) without a referee "
          f"in the next {args.days} days")
    for (d, r), n in rounds:
        print(f"  {d}  round {r}  {n} fixture(s)")
    if not rounds:
        # NOT AN ERROR, and the distinction matters: the desk is covered. A
        # non-zero exit here would make a fully-appointed week look like a
        # broken scraper every time it happened.
        print("nothing to fetch — every fixture in the window has an official")
        return

    if args.list:
        if args.league == "LL":
            season_label = f"{season}-{str(season + 1)[-2:]}" if season else "?"
            for u in rfef_candidates(rounds, season_label):
                print(f"  would probe {u}")
        else:
            for u in EFL_INDEX:
                print(f"  would search {u}")
        return

    if args.league == "LL":
        if not season:
            sys.exit("ERROR: laliga_fixtures.js carries no season heading — "
                     "the RFEF filename cannot be built without it.")
        found = find_laliga(rounds, f"{season}-{str(season + 1)[-2:]}", args.verbose)
    else:
        found = find_eflc(args.verbose)

    if not found:
        sys.exit(f"ERROR: no appointments found for {args.league}. "
                 f"{total} fixture(s) are still without an official — "
                 "the committed overlay is unchanged.")

    # One text, so one ingester call. Several sheets can cover one round (the
    # RFEF publishes a jornada a day at a time) and the parser is happy to read
    # them end to end; the sources are joined for the same reason.
    url = " + ".join(u for u, _ in found)
    text = "\n\n".join(t for _, t in found)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"\nwrote {args.out} ({len(text)} chars) from {len(found)} source(s)")
    else:
        sys.stdout.write(text)
    if args.source_out:
        Path(args.source_out).write_text(url, encoding="utf-8")
    print(f"source: {url}")


if __name__ == "__main__":
    main()

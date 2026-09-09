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

  SERIE A: by SEARCHING THE AIA's news index for the article whose slug
  names the pending giornata ("serie-a-enilive-designazioni-4a-giornata-
  27612"). The round number is in the URL, so the article for a round is
  chosen by its round rather than by being newest, and a previous season's
  article for the same round loses to the higher id. Officials are surname
  only and the dates carry no year; the season heading of the committed
  fixture file supplies it.

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

FIXTURES = {"LL": "laliga_fixtures.js", "EFLC": "eflc_fixtures.js",
            "SA": "seriea_fixtures.js"}

# Spanish weekday names as the RFEF spells them in a filename: lowercase and
# unaccented (miercoles, sabado), Monday first to match date.weekday().
ES_WEEKDAYS = ["lunes", "martes", "miercoles", "jueves",
               "viernes", "sabado", "domingo"]

RFEF_BASE = "https://rfef.es/sites/default/files/"
RFEF_STEM = "designaciones_1a_division_masculina_-_temp_{season}_-_jornada_{r}_"

# THE SITEMAP IS IN THE LIST ON PURPOSE, and first among equals. The news
# index came back on the first live run with no matching href at all, which
# most likely means it is rendered in the browser rather than served as
# markup — a listing built by JavaScript is an empty page to a fetch. A
# sitemap is XML by definition and cannot be, so it is the candidate least
# able to fail quietly.
EFL_INDEX = [
    "https://www.efl.com/sitemap.xml",
    "https://www.efl.com/news/",
    "https://www.efl.com/news/?category=referee-appointments",
]
# ANY URL CARRYING THE STEM, not only an href: a sitemap gives them in <loc>
# and a JSON island in a quoted string, and all three are the same fact. The
# expression is deliberately about the URL and nothing about the markup around
# it, which is what keeps a redesign from silently emptying this.
EFL_SLUG = re.compile(r'["\'>(]([^"\'<>()\s]*referee-appointments[^"\'<>()\s]*)', re.I)

# The date the EFL puts in its own article URLs: /news/2026/september/08/...
# A sitemap is not in publication order, so this is what puts the newest
# article first — see find_eflc, which sorts on it.
URL_DATE = re.compile(r"/news/(\d{4})/([a-z]+)/(\d{1,2})/", re.I)
MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}
# The EFL publishes cup sheets under the same stem and the ingester skips them
# by competition, so they sort behind the league article rather than ahead of
# it — see find_eflc.
CUP_SLUG = re.compile(r"carabao|vertu|papa|trophy|cup", re.I)


# SERIE A: the AIA publishes one article per matchday on its own news site,
# titled "SERIE A ENILIVE - DESIGNAZIONI 4a GIORNATA", and the slug carries
# the round number and a rising article id:
#
#   /news/serie-a-enilive-designazioni-4a-giornata-27612/
#   /news/serie-a-enilive-designazioni-32-giornata-27289/   (the ordinal's
#                                                            "a" is sometimes
#                                                            dropped)
#
# So the article for a pending round is FOUND BY ITS ROUND, not by reading
# the newest one and hoping: the index is searched for slugs naming that
# giornata, and where a previous season's article for the same round is still
# listed the highest id wins. The category page for designations is first;
# the plain news index is the fallback, and both are matched on the URL
# alone, for the same reason as the EFL's.
#
# NOT TESTED AGAINST THE SITE. aia-figc.it, and every mirror that reposts
# its text, was refused by the network this was written on, so the index
# shape and the article body are taken from published excerpts. The first
# live run on a runner is what confirms it, and this script cannot half
# succeed: an article that yields no blocks is reported as nothing found.
AIA_INDEX = [
    "https://www.aia-figc.it/news/?c=9",
    "https://www.aia-figc.it/news/",
]
AIA_SLUG = re.compile(
    r'["\'>(]([^"\'<>()\s]*serie-a-enilive-designazioni-(\d{1,2})a?-giornata-(\d+)'
    r'[^"\'<>()\s]*)', re.I)


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
    found, probed, answered = [], 0, 0
    for url in rfef_candidates(rounds, season):
        if verbose:
            print(f"  probing {url}")
        probed += 1
        blob = fetch(url, binary=True)
        if not blob:
            continue
        answered += 1
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
    # WHICH SILENCE IT WAS. Nothing answering and something answering that
    # would not parse are different problems — a sheet not published yet
    # against a pattern or a layout that has moved — and the first run of this
    # could not tell them apart from the log. The CTA publishes the day BEFORE
    # a match, so probing a round four days out and finding nothing is the
    # ordinary case and should read like one.
    print(f"  {probed} candidate URL(s) probed, {answered} answered")
    if probed and not answered:
        print("  nothing answered — the sheets for these rounds are most "
              "likely not published yet (the CTA publishes the day before a "
              "match); a run on the eve of a matchday is the one that tells "
              "you whether the filename is right")
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
        page = fetch(index)
        # SIZE AND HIT COUNT, every time. "The index listed no article" was
        # true of the first live run and did not say whether the page had not
        # arrived, had arrived empty, or had arrived full of markup with no
        # such link in it. Those are three different fixes.
        if page is None:
            print(f"  {index} -> no response")
            continue
        hits = EFL_SLUG.findall(page)
        print(f"  {index} -> {len(page)} bytes, {len(hits)} matching URL(s)")
        for href in hits:
            url = urllib.parse.urljoin(index, html.unescape(href))
            if url not in seen:
                seen.append(url)
    if not seen:
        print("  no source listed a referee-appointments URL. If the pages "
              "above returned plenty of bytes and no matches, the listing is "
              "rendered in the browser rather than served as markup, and the "
              "sitemap is the route that will work; if they returned nothing, "
              "the fetch itself is being refused.")
        return found

    # NEWEST FIRST, BY THE DATE IN THE URL. A news index gives its articles in
    # order and a SITEMAP DOES NOT: the first run off the sitemap found 172
    # articles and read the three at the top of the file, which were from the
    # previous January. The slug carries /news/YYYY/month/DD/, so the ordering
    # is in the URL and does not need the page.
    dated = []
    for url in seen:
        m = URL_DATE.search(url)
        if not m:
            continue
        month = MONTHS.get(m.group(2).lower())
        if not month:
            continue
        try:
            d = dt.date(int(m.group(1)), month, int(m.group(3)))
        except ValueError:
            continue
        # A CUP ROUND IS NOT THE LEAGUE. The EFL publishes separate sheets for
        # the Carabao Cup and the Vertu Trophy under the same stem, and the
        # ingester skips them by competition heading — correctly, but only
        # after they have used up a slot. Sorted behind the league article
        # rather than dropped, because a week where only the cup is published
        # is still a week worth reading.
        cup = bool(CUP_SLUG.search(url))
        dated.append((cup, -d.toordinal(), d, url))
    dated.sort()
    print(f"  {len(seen)} candidate article(s), {len(dated)} with a date in the URL")

    for cup, _, d, url in dated[:5]:
        page = fetch(url)
        if page is None:
            print(f"  {url} -> no response")
            continue
        text = to_text(page)
        rows, _, _ = I.parse(text, default_year=d.year)
        print(f"  {url}\n    published {d}, {len(page)} bytes, "
              f"{len(text)} chars of text, {len(rows)} appointment(s) parsed")
        if rows:
            found.append((url, text))
            # ONE ARTICLE IS A WEEK. Reading further back would re-ingest a
            # round already covered, and every entry it wrote would supersede
            # a newer one for the same fixture.
            break
    if not found and dated:
        print("  articles were found and none parsed. Compare the byte count "
              "with the text length above: a page that is large and yields "
              "little text is rendered in the browser, and the article body "
              "will have to come from the CMS rather than the HTML.")
    return found


# ---------------------------------------------------------------------------
# Serie A: find the AIA article for each pending round
# ---------------------------------------------------------------------------

def aia_candidates(pages, rounds):
    """{round: url} for the pending rounds, newest article id per round.

    `pages` is [(index_url, markup)]. Pure, so the choice can be tested
    without the site: the fetch is the only part of this that needs it.
    """
    wanted = {r for (_, r), _ in rounds if r is not None}
    best = {}
    for index, page in pages:
        for href, rnd, art in AIA_SLUG.findall(page or ""):
            rnd, art = int(rnd), int(art)
            if rnd not in wanted:
                continue
            url = urllib.parse.urljoin(index, html.unescape(href))
            if rnd not in best or art > best[rnd][0]:
                best[rnd] = (art, url)
    return {r: u for r, (_, u) in sorted(best.items())}


def find_seriea(rounds, season_year, verbose):
    pages = []
    for index in AIA_INDEX:
        page = fetch(index)
        if page is None:
            print(f"  {index} -> no response")
            continue
        hits = AIA_SLUG.findall(page)
        print(f"  {index} -> {len(page)} bytes, {len(hits)} designation URL(s)")
        pages.append((index, page))
    chosen = aia_candidates(pages, rounds)
    if not chosen:
        if pages:
            print("  no designation article for a pending round. If the pages "
                  "above returned plenty of bytes and no matching URL, the "
                  "listing is rendered in the browser or the slug has changed; "
                  "if they returned nothing, the fetch itself is being refused.")
        return []
    found = []
    for rnd, url in chosen.items():
        page = fetch(url)
        if page is None:
            print(f"  {url} -> no response")
            continue
        text = to_text(page)
        rows, problems = I.parse_aia(text, season_year)
        print(f"  round {rnd}: {url}\n    {len(page)} bytes, {len(text)} chars "
              f"of text, {len(rows)} appointment(s) parsed")
        for pr in problems:
            print(f"    {pr}")
        if rows:
            found.append((url, text))
    if not found and chosen:
        print("  articles were found and none parsed. Compare the byte count "
              "with the text length above: a large page yielding little text "
              "is rendered in the browser; plenty of text and no blocks means "
              "the layout has moved from the one parse_aia reads.")
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--league", required=True, choices=["LL", "EFLC", "SA"])
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
            for u in (AIA_INDEX if args.league == "SA" else EFL_INDEX):
                print(f"  would search {u}")
        return

    if args.league == "LL":
        if not season:
            sys.exit("ERROR: laliga_fixtures.js carries no season heading — "
                     "the RFEF filename cannot be built without it.")
        found = find_laliga(rounds, f"{season}-{str(season + 1)[-2:]}", args.verbose)
    elif args.league == "SA":
        if not season:
            sys.exit("ERROR: seriea_fixtures.js carries no season heading, and "
                     "the AIA's dates carry no year without it.")
        found = find_seriea(rounds, season, args.verbose)
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

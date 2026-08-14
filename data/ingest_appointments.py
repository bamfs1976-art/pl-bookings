#!/usr/bin/env python3
"""Read a published referee-appointments article into the desks' fixture list.

  python3 data/ingest_appointments.py --source <url> < article.txt
  python3 data/ingest_appointments.py --source <url> --file article.txt
  python3 data/ingest_appointments.py --dry-run --source <url> < article.txt

The EFL publishes appointments weekly, by division, as prose:

    Saturday, 15th August 2026
    Sky Bet Championship
    Norwich City v West Bromwich Albion (15:00)
    Referee: Tim Robinson
    Assistants: Hugh Gilroy and Ian Cooper
    Fourth Official: Aaron Farmer

That is a week of card pricing in a form no feed carries. API-Football, which
supplies data/eflc_fixtures.js three times a day, has none of it until much
closer to kickoff — the committed file reads "0 with a referee appointed" for
a round that starts in three days.

WHAT THIS DOES NOT DO. It does not fetch the article. efl.com is unreachable
from several of the environments this repository is worked in, and a scraper
for one publisher's prose that silently returns nothing when the markup moves
is worse than a paste: a week with no appointments looks identical to a week
that was not ingested. Give it the text; it tells you exactly what it found.

WHAT IT REFUSES TO GUESS. A club it cannot map, a fixture it cannot find and a
referee whose name it cannot resolve are each reported by name. Nothing is
half-matched. The one thing that must never happen here is an official quietly
resolved to a COLLEAGUE, because that prices a fixture off another man's card
rate and looks entirely correct on the page.

Divisions the app does not model (League One, League Two, the EFL Trophy) are
counted and skipped rather than stored — dead data goes stale silently. Add a
desk and its league code to DIVISIONS and they are picked up from the same
paste.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import appointments as A            # noqa: E402
import leagues                      # noqa: E402

DATA = Path(__file__).resolve().parent

# Competition heading in the article -> the league code this repo models.
# Only the Championship is modelled today; the parser reads the rest so that
# adding a desk is a one-line change here rather than a new parser.
DIVISIONS = {
    "sky bet championship": "EFLC",
    "primera división": "LL",
}

# ---------------------------------------------------------------------------
# The RFEF's designation sheets (--format rfef)
# ---------------------------------------------------------------------------
# Spain publishes a PDF per matchday from the Comité Técnico de Árbitros, laid
# out as a table rather than prose:
#
#   Competición: Campeonato Nacional de Liga de Primera División   Jornada - 1
#   15-08-2026        Deportivo Alavés        Getafe CF        19:30
#   Árbitro:Manuel Jesús Orellana        4º Árbitro:José Antonio Palomares
#   A. Asistente 1: Iván Ríos            VAR: Carlos Del Cerro
#
# THE ONE THING THIS MUST NOT DO is read the fourth official as the referee.
# "Árbitro:" and "4º Árbitro:" sit on the SAME extracted line and the second
# contains the first as a substring, so a naive search finds whichever comes
# first in the string and a naive capture swallows both names. Either way the
# match would be priced off a man who never refereed it, which is precisely
# the failure this whole file is built to refuse. The line is therefore cut at
# "4º Árbitro" before the referee is read, and the referee pattern is anchored
# to the start of what remains.
#
# Times are LOCAL (CEST in August). The overlay stores what was published and
# the fixture join keys on the date and the two clubs, not the clock, so no
# conversion happens here — inventing one would be a second place for a
# timezone to be wrong.
RFEF_DATE_RE = re.compile(r"(\d{2})-(\d{2})-(\d{4})")
RFEF_KO_RE = re.compile(r"(\d{1,2}:\d{2})\s*$")
RFEF_REF_RE = re.compile(r"^\s*[ÁA]rbitro\s*:\s*(.+?)\s*$", re.I)
RFEF_FOURTH = re.compile(r"4\s*[ºo°]?\s*[ÁA]rbitro", re.I)


def parse_rfef(text, competition="primera división"):
    """An RFEF designation sheet as the same rows parse() returns.

    Deliberately tolerant about columns and strict about the referee. A table
    extracted from a PDF puts an unknowable amount of whitespace between cells,
    so the two clubs are split on a run of spaces; but a mis-split club is
    reported by name downstream, whereas a mis-read official is not.
    """
    out = []
    pending = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue

        date_m = RFEF_DATE_RE.search(line)
        ko_m = RFEF_KO_RE.search(line)
        if date_m and ko_m:
            middle = line[date_m.end():ko_m.start()].strip(" |\t")
            clubs = [c.strip() for c in re.split(r"\s{2,}|\s*\|\s*", middle) if c.strip()]
            if len(clubs) == 2:
                pending = {
                    "competition": competition,
                    "date": f"{date_m.group(3)}-{date_m.group(2)}-{date_m.group(1)}",
                    "home": clubs[0], "away": clubs[1],
                    "ko": ko_m.group(1), "ref": None,
                }
            continue

        if pending is None:
            continue
        # Cut the fourth official off before looking for the referee.
        head = RFEF_FOURTH.split(line)[0]
        ref_m = RFEF_REF_RE.match(head)
        if ref_m and ref_m.group(1).strip():
            pending["ref"] = ref_m.group(1).strip()
            out.append(pending)
            pending = None
    return out
KNOWN_HEADINGS = {
    "sky bet championship", "sky bet league one", "sky bet league two",
    "efl trophy", "efl cup", "carabao cup", "papa johns trophy",
    "vertu trophy", "bristol street motors trophy",
}

MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}

DATE_RE = re.compile(
    r"^(?:mon|tues|wednes|thurs|fri|satur|sun)day,\s+(\d{1,2})(?:st|nd|rd|th)?\s+"
    r"([a-z]+)\s+(\d{4})\s*$", re.I)
FIXTURE_RE = re.compile(r"^(.+?)\s+v\s+(.+?)\s*\((\d{1,2}:\d{2})\)\s*$", re.I)
REFEREE_RE = re.compile(r"^referee:\s*(.+?)\s*$", re.I)


def parse(text):
    """The article as a list of {competition, date, home, away, ko, ref}.

    Deliberately line-oriented and stateful — date and competition headings
    each apply until the next one, and the EFL Trophy section carries its own
    dates under a competition heading, so both have to be tracked
    independently rather than assuming one nests inside the other.
    """
    out, unknown_headings = [], []
    date = comp = None
    pending = None

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        m = DATE_RE.match(line)
        if m:
            day, month, year = int(m.group(1)), MONTHS.get(m.group(2).lower()), int(m.group(3))
            if month:
                date = f"{year:04d}-{month:02d}-{day:02d}"
            pending = None
            continue

        low = line.lower()
        if low in KNOWN_HEADINGS:
            comp = low
            pending = None
            continue
        # A short unadorned line that is not a fixture and not a known heading
        # may be a division this parser has not seen. Reported, not assumed.
        if (len(line) < 60 and " v " not in low and ":" not in line
                and low.startswith(("sky bet", "efl ", "carabao", "vertu", "papa"))):
            unknown_headings.append(line)
            comp = low
            pending = None
            continue

        m = FIXTURE_RE.match(line)
        if m:
            pending = {"competition": comp, "date": date,
                       "home": m.group(1).strip(), "away": m.group(2).strip(),
                       "ko": m.group(3), "ref": None}
            continue

        m = REFEREE_RE.match(line)
        if m and pending is not None:
            pending["ref"] = m.group(1).strip()
            out.append(pending)
            pending = None
            continue
        # Assistants, fourth officials, bylines: not appointments this desk
        # prices with, so they are dropped without comment.

    return out, unknown_headings


def to_entries(parsed, source):
    """Parsed fixtures as overlay entries, plus everything that did not map."""
    entries, skipped, problems = [], {}, []
    for row in parsed:
        code = DIVISIONS.get(row["competition"] or "")
        if not code:
            label = row["competition"] or "no competition heading"
            skipped[label] = skipped.get(label, 0) + 1
            continue
        if not row["date"]:
            problems.append(f"no date for {row['home']} v {row['away']}")
            continue

        home = leagues.short_for(code, row["home"])
        away = leagues.short_for(code, row["away"])
        if not home or not away:
            missing = " and ".join(n for n, s in ((row["home"], home), (row["away"], away)) if not s)
            problems.append(f"club not recognised: {missing}")
            continue

        resolved, how = A.resolve_ref_name(row["ref"], A.ref_names(code))
        entries.append({
            "league": code, "date": row["date"], "h": home, "a": away,
            "ko": row["ko"],
            "ref": row["ref"],                 # exactly as published
            "refResolved": resolved,           # the card table's spelling
            "resolvedBy": how,
            "source": source,
        })
    return entries, skipped, problems


# ---------------------------------------------------------------------------
# The committed fixture file
# ---------------------------------------------------------------------------
ROW_RE = re.compile(r"\{(.*?)\},?\s*$")


def read_fixture_file(path):
    """The rows out of a generated `const X = [ {...}, ];` file.

    A small reader rather than a JS engine: the file is machine-written by
    emit_fixtures with one flat object per line and no nesting, so this is
    exact for the only shape it will ever see, and it fails loudly rather than
    half-reading anything else.
    """
    rows, season, name = [], None, None
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        head = re.match(r"^//\s*(.+?)\s+(\d{4})-\d{2}:", line.strip())
        if head:
            name, season = head.group(1), int(head.group(2))
            continue
        m = ROW_RE.match(line.strip())
        if not m:
            continue
        body = m.group(1)
        # Bare keys to JSON keys: id: -> "id":
        obj = re.sub(r'(^|,)\s*([a-zA-Z_]\w*)\s*:', r'\1"\2":', body)
        try:
            rows.append(json.loads("{" + obj + "}"))
        except ValueError:
            sys.exit(f"ERROR: {Path(path).name} line could not be read: {line.strip()[:80]}")
    return rows, season, name


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", help="article text (default: stdin)")
    ap.add_argument("--source", required=True, help="URL the appointments were published at")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change and write nothing")
    ap.add_argument("--format", choices=["efl", "rfef"], default="efl",
                    help="efl: the EFL's weekly prose (default). "
                         "rfef: a Comité Técnico de Árbitros designation sheet.")
    args = ap.parse_args()

    text = Path(args.file).read_text(encoding="utf-8") if args.file else sys.stdin.read()
    if not text.strip():
        sys.exit("ERROR: no article text on stdin (or --file was empty).")

    if args.format == "rfef":
        parsed, unknown = parse_rfef(text), []
        expected = ("a 'DD-MM-YYYY  Home  Away  HH:MM' row followed by "
                    "'Árbitro: Name'")
    else:
        parsed, unknown = parse(text)
        expected = "'Home v Away (15:00)' followed by 'Referee: Name'"
    if not parsed:
        sys.exit(f"ERROR: no appointments found. Expected {expected}.")
    print(f"read {len(parsed)} appointments from the article")
    for h in dict.fromkeys(unknown):
        print(f"  NOTE: unrecognised competition heading {h!r} — its fixtures were skipped")

    entries, skipped, problems = to_entries(parsed, args.source)
    for label, n in sorted(skipped.items()):
        print(f"  skipped {n:>2} — {label} (no desk models it)")
    for p in problems:
        print(f"  WARNING: {p}")

    if not entries:
        sys.exit("ERROR: nothing to ingest — no appointment mapped to a modelled division.")

    unresolved = [e for e in entries if not e["refResolved"]]
    print(f"\n{len(entries)} appointments for modelled divisions; "
          f"{len(entries) - len(unresolved)} referees resolved to a card record")
    for e in entries:
        how = e["resolvedBy"] or "NO CARD RECORD"
        shown = e["refResolved"] or e["ref"]
        print(f"  {e['date']}  {e['h']} v {e['a']:<4} {e['ref']:<20} -> {shown:<20} ({how})")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    # ---- merge into the overlay, replacing any earlier entry for the same
    # fixture so a re-published correction supersedes rather than duplicates.
    existing = {(e.get("league"), *A.key_of(e)): e for e in A.load()}
    for e in entries:
        existing[(e["league"], *A.key_of(e))] = e
    total = A.save(list(existing.values()), source=args.source)
    print(f"\ndata/appointments.json written ({total} appointments)")

    # ---- and apply it to the committed fixture list now, rather than waiting
    # up to eight hours for the next harvest. emit_fixtures applies the
    # overlay itself and owns the file format, so this hands it the rows and
    # stays out of both — one writer, one place the overlay is applied.
    import harvest_apifootball as H
    for code in sorted({e["league"] for e in entries}):
        _, filename = H.FIXTURE_FILES[code]
        path = DATA / filename
        if not path.exists():
            print(f"  {filename} does not exist yet — the overlay will be applied "
                  "by the next harvest")
            continue
        rows, season, _ = read_fixture_file(path)
        H.emit_fixtures(rows, leagues.get(code), str(season))


if __name__ == "__main__":
    main()

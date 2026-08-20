"""Published referee appointments, laid over the harvested fixture list.

WHY THIS EXISTS. data/eflc_fixtures.js is rewritten three times a day by
.github/workflows/fixtures.yml from API-Football, and API-Football does not
carry an EFL appointment until very late — the committed file reads "552
fixtures, 0 with a referee appointed" for a round kicking off in three days.
The EFL itself publishes them a week out, by division, as prose. So a hand
edit to the fixture file is not merely untidy, it is ERASED within eight
hours by the next harvest. This module is the overlay that survives it:
appointments live in their own committed file and are re-applied every time
the fixture list is written.

PRECEDENCE, AND WHY THIS WAY ROUND. The harvested value wins wherever it
exists; this file only fills nulls. The harvest runs three times a day and
therefore reflects a late change; this file is a snapshot of one publication
and cannot. Where the two disagree the difference is PRINTED rather than
resolved quietly, because that disagreement is usually a genuine change of
official — the thing a bookings desk most needs to notice.

THE NAME PROBLEM, WHICH IS THE REAL WORK. The desk resolves a referee by
exact string: `refByName[fx.ref]` in eflc.html. The card table is built from
match records and spells officials two ways — "Tim Robinson" but also
"A Herczeg" — while the EFL publishes full names throughout. Of the twelve
Championship officials appointed for 14-20 August 2026, five matched the
table and seven did not. A name that does not match is not an error anywhere:
refFor() returns {ref:null, appointed:true}, refFactor stays 1, and the
fixture prices as though no official had been named. A neutral referee looks
exactly like no referee on the page, which is precisely how the Premier
League desk lost its referee layer for a season (see scripts/check-referees.mjs).

So every name is RESOLVED to the card table's own spelling before it is
written, by rules that are each individually defensible, and anything the
rules cannot settle is reported and left as published rather than guessed.
"""

import json
import re
import unicodedata
from pathlib import Path

DATA = Path(__file__).resolve().parent
APPOINTMENTS = DATA / "appointments.json"

# The card table for each desk, so a published name can be resolved to the
# spelling that desk indexes on. A league absent from here keeps names exactly
# as published — today's behaviour, and better than a wrong match.
REF_TABLES = {
    "EFLC": "eflc_refs.json",
    "LL": "laliga_refs.json",
}

# ---------------------------------------------------------------------------
# Name resolution
# ---------------------------------------------------------------------------

# Short forms English football uses in print against the formal name a match
# record carries. Only entries where the pairing is unambiguous for OFFICIALS
# — this is not a general nickname table and must not become one.
DIMINUTIVES = {
    "matt": "matthew", "tom": "thomas", "tommy": "thomas", "ben": "benjamin",
    "josh": "joshua", "sam": "samuel", "ollie": "oliver", "alex": "alexander",
    "dan": "daniel", "danny": "daniel", "andy": "andrew", "drew": "andrew",
    "mike": "michael", "mick": "michael", "steve": "stephen", "steven": "stephen",
    "tony": "anthony", "jamie": "james", "jim": "james", "jimmy": "james",
    "will": "william", "billy": "william", "chris": "christopher",
    "nick": "nicholas", "ed": "edward", "eddie": "edward", "ted": "edward",
    "greg": "gregory", "rob": "robert", "robbie": "robert", "bobby": "robert",
    "rich": "richard", "richie": "richard", "dave": "david", "phil": "philip",
    "pete": "peter", "geoff": "geoffrey", "jon": "jonathan", "jonny": "jonathan",
    "harry": "henry", "charlie": "charles", "joe": "joseph", "frank": "francis",
}

# Officials whose published name cannot be derived from their recorded one by
# any rule above, kept explicit BY NAME so the exception is visible and can be
# argued with. Every entry is one person, written down once, deliberately.
#
#   Bobby Madley  — records carry "R Madley"; he is Robert, known as Bobby, so
#                   neither the initial rule nor the diminutive rule reaches it
#                   from "Bobby" without also licensing B → R generally.
ALIASES = {
    "bobby madley": "R Madley",
}


def _fold(text):
    """Lowercase, accent-stripped, punctuation-free — for comparison only."""
    s = unicodedata.normalize("NFD", str(text or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _parts(name):
    bits = _fold(name).split()
    return (bits[0], bits[-1]) if len(bits) >= 2 else ("", bits[0] if bits else "")


def resolve_ref_name(published, known):
    """A published referee name as the card table's own spelling.

    Returns (resolved_name, method). `resolved_name` is None when no rule
    settles it — the caller keeps the published name and reports it, because
    a fixture with a named official and no card record is a visible state on
    the desk, whereas a wrong match is not.

    The rules, in order, each requiring a UNIQUE hit:

      exact       the table already spells it this way
      alias       an explicit, written-down exception
      initial     "Adam Herczeg" -> "A Herczeg": first initial and surname
      forename    a diminutive expanded ("Matt" -> "Matthew") then re-matched

    Surname alone is never enough. The table holds both "Lewis Smith" and
    "Josh Smith", so a surname rule would map an official to a colleague — the
    single worst outcome available here, since it prices a fixture off another
    man's card rate while looking entirely correct.
    """
    known = list(known or [])
    if not published:
        return None, None

    by_fold = {}
    for k in known:
        by_fold.setdefault(_fold(k), []).append(k)

    hit = by_fold.get(_fold(published))
    if hit and len(hit) == 1:
        return hit[0], "exact"

    alias = ALIASES.get(_fold(published))
    if alias and alias in known:
        return alias, "alias"

    first, last = _parts(published)
    if not last:
        return None, None

    # "A Herczeg" — first initial plus surname.
    if first:
        got = _by_initial(first, last, by_fold)
        if got:
            return got, "initial"

    # "Matt Donohue" -> "Matthew Donohue", then exact or initial again.
    expanded = DIMINUTIVES.get(first)
    if expanded:
        full = by_fold.get(f"{expanded} {last}")
        if full and len(full) == 1:
            return full[0], "forename"
        got = _by_initial(expanded, last, by_fold)
        if got:
            return got, "forename"

    # SURNAMES AS A CONTIGUOUS RUN, which is the rule the rest of the
    # repository already uses — build_refs.canonical_referees to fold two
    # spellings of one official together, PLDCore.matchRefName for the desks'
    # own lookup. This is the third implementation of that question and it was
    # the odd one out, because every rule above reads a name POSITIONALLY:
    # _parts() takes the first token and the LAST one.
    #
    # That works for "Adam Herczeg" and breaks on Spain. The CTA publishes
    # "Ricardo De Burgos"; the card table holds "Ricardo De Burgos
    # Bengoetxea", whose last token is his materno surname. First-and-last
    # gives "ricardo burgos" against "ricardo bengoetxea" and finds nothing,
    # so a fixture with a perfectly good card record priced at the league rate
    # — and the desks, running the JS rule, disagreed with this file about the
    # same man.
    if first:
        got = _by_run(first, _fold(published).split()[1:], by_fold)
        if got:
            return got, "run"

    # A COMPOUND GIVEN NAME, on the published side only. The CTA prints
    # "Francisco José Hernández"; the card table holds "Francisco Hernandez
    # Maeso". Read positionally the published surnames are ["jose",
    # "hernandez"] and the table's are ["hernandez", "maeso"] — neither is a
    # contiguous run of the other, so every rule above finds nothing and a
    # fixture with a perfectly good card record prices at the league rate.
    #
    # "José" is not a surname. Compound given names are ordinary among these
    # officials — José Luis, José María, Miguel Ángel, Francisco José — and
    # NOTHING IN A NAME says whether its second token is a second given name or
    # a first surname. That is why this cannot be a general reading rule: apply
    # it eagerly and "Juan Martínez Munuera" loses a real surname.
    #
    # SO IT IS TRIED LAST AND ONLY WHEN EVERYTHING ELSE HAS FAILED, drops the
    # second token, and accepts a UNIQUE hit or nothing — the same bar as every
    # rule above. Reported as its own tier, so a name resolved this way is
    # visible as such in the ingest log rather than passing as a plain run.
    #
    # DELIBERATELY NOT PORTED TO PLDCore.matchRefName, and this is the note for
    # whoever next tries to align the two. The desks never see a published name:
    # the ingest writes the RESOLVED spelling into the fixture file, so what
    # reaches the JS is either the card table's own name (exact) or a harvested
    # abbreviation like "R. De Burgos" (the run rule). A tier the JS cannot
    # reach is dead code there, which is what this repository refuses
    # everywhere else — the two rules differ here because their inputs do.
    bits = _fold(published).split()
    if first and len(bits) >= 3:
        got = _by_run(first, bits[2:], by_fold)
        if got:
            return got, "given2"

    return None, None


def _run_in(a, b):
    """Is `a` a contiguous run of tokens anywhere within `b`? Ordered, because
    surname order is identity: "Busquets Ferrer" and "Ferrer Busquets" are two
    families, not one man written two ways."""
    if not a or len(a) > len(b):
        return False
    return any(b[i:i + len(a)] == a for i in range(len(b) - len(a) + 1))


def _by_run(first, surnames, by_fold):
    """The one table entry whose surnames run with these, or None.

    UNIQUE OR NOTHING, like every rule above it. Two officials sharing an
    initial and a surname is not a lookup — resolving one to the other prices
    a fixture off a colleague's card rate and looks entirely correct on the
    page, which is the single worst outcome this function can produce.
    """
    hits = []
    for folded, names in by_fold.items():
        bits = folded.split()
        if len(bits) < 2 or bits[0][0] != first[0]:
            continue
        theirs = bits[1:]
        if _run_in(surnames, theirs) or _run_in(theirs, surnames):
            hits.extend(names)
    return hits[0] if len(hits) == 1 else None


def _by_initial(first, last, by_fold):
    """A table entry recorded as initial-plus-surname, or None.

    Unique AS A STRING is not enough. A table holding "J Smith" alongside
    "James Smith" and "Josh Smith" has exactly one entry spelled "J Smith" —
    and no way to say which of the two men it is, so a published "Jordan
    Smith" must not take it. Whenever another entry shares the surname and
    could be the person behind the initial, this refuses and the appointment
    is left as published: a fixture priced at the league rate is a visible
    gap, one priced off a colleague's card rate is not.
    """
    entries = by_fold.get(f"{first[0]} {last}")
    if not entries or len(entries) != 1:
        return None
    for folded, names in by_fold.items():
        parts = folded.split()
        if len(parts) < 2 or parts[-1] != last or names == entries:
            continue
        rival = parts[0]
        if len(rival) > 1 and rival[0] == first[0] and rival != first:
            return None            # the initial could be theirs
    return entries[0]


def ref_names(code):
    """Every referee name the desk for `code` can price with."""
    filename = REF_TABLES.get(str(code or "").upper())
    if not filename:
        return []
    path = DATA / filename
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [r.get("name") for r in (payload.get("refs") or []) if r.get("name")]


# ---------------------------------------------------------------------------
# The overlay
# ---------------------------------------------------------------------------

def load(path=APPOINTMENTS):
    """The committed appointments, or an empty list when there are none."""
    p = Path(path)
    if not p.exists():
        return []
    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        # Loud, and empty: a corrupt overlay must not silently become "no
        # appointments", which reprices a whole division at a neutral referee.
        print(f"  WARNING: {p.name} could not be read ({exc}) — no overlay applied")
        return []
    return payload.get("appointments") or []


def save(entries, path=APPOINTMENTS, source=None):
    """Write the overlay, sorted, one entry per line-ish for a readable diff."""
    rows = sorted(entries, key=lambda e: (e.get("league", ""), e.get("date", ""),
                                          e.get("h", ""), e.get("a", "")))
    payload = {
        "note": ("Referee appointments as published by the competition, laid over "
                 "the harvested fixture list by data/appointments.py. The harvest "
                 "wins where it has a value; this fills the nulls."),
        "sources": sorted({e["source"] for e in rows if e.get("source")}
                          | ({source} if source else set())),
        "appointments": rows,
    }
    Path(path).write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n",
                          encoding="utf-8")
    return len(rows)


def key_of(entry):
    return (entry.get("date", ""), entry.get("h", ""), entry.get("a", ""))


def apply_to(rows, code, entries=None, verbose=True):
    """Fill `ref` on fixture rows from the overlay. Returns a report dict.

    Matching is on DATE PLUS BOTH CLUB CODES, never on a fixture id: the
    appointment is published as prose and has no id, and the club pair is the
    only thing both sides genuinely share. A kickoff can move, so a fixture
    found a day either side of the published date is accepted and reported
    rather than treated as a miss.
    """
    code = str(code or "").upper()
    entries = [e for e in (entries if entries is not None else load())
               if str(e.get("league", "")).upper() == code]
    report = {"applied": 0, "already": 0, "disagreed": [], "unmatched": [],
              "shifted": [], "no_record": [], "clarified": []}
    if not entries:
        return report

    known = set(ref_names(code))
    index = {}
    for row in rows:
        date = str(row.get("d") or "")[:10]
        index.setdefault((date, row.get("h"), row.get("a")), []).append(row)

    for entry in entries:
        date, home, away = key_of(entry)
        found = index.get((date, home, away)) or []
        if not found:
            # A kickoff moved, or the published date is the local one and the
            # fixture list's is UTC across midnight.
            for delta in ("-1", "+1"):
                near = _shift(date, delta)
                found = index.get((near, home, away)) or []
                if found:
                    report["shifted"].append(f"{home} v {away} {date} -> {near}")
                    break
        if not found:
            report["unmatched"].append(f"{home} v {away} {date}")
            continue

        name = entry.get("refResolved") or entry.get("ref")
        if name and name not in known:
            report["no_record"].append(f"{name} ({home} v {away})")

        for row in found:
            if row.get("ref"):
                if _fold(row["ref"]) == _fold(name or ""):
                    report["already"] += 1
                elif supersedes(row["ref"], name, known):
                    report["clarified"].append(
                        f"{home} v {away}: harvested {row['ref']!r} is the same "
                        f"official as {name!r}, which the card table carries")
                    row["ref"] = name
                else:
                    report["disagreed"].append(
                        f"{home} v {away}: harvested {row['ref']!r}, published {name!r}")
                continue
            row["ref"] = name
            report["applied"] += 1

    if verbose:
        describe(report, code)
    return report


def supersedes(harvested, published, known):
    """Is `published` the SAME official as `harvested`, spelled so the desk can
    price it, where `harvested` is not?

    THE ONE EXCEPTION to "the harvest wins", and it is narrow on purpose.

    The precedence rule exists because the harvest runs three times a day and
    this file is a snapshot of one publication, so a difference between them is
    usually a genuine change of official. That reasoning does not cover a
    difference of SPELLING. API-Football named Rayo v Alavés "J. Munuera"; the
    RFEF sheet named José Luis Munuera Montero. They are one man, and only one
    of those strings reaches a card record.

    Worse, "J. Munuera" is not resolvable in the abstract and must not be:
    La Liga has two Munueras, and PLDCore.matchRefName rightly refuses an
    abbreviation two officials could answer to. So the harvested value cannot
    be repaired downstream — the fixture prices at the league rate, which looks
    exactly like a fixture with no referee. What settles it is the sheet, which
    named the man; the abbreviation is merely consistent with what it says.

    THE THREE CONDITIONS, all required:

      1. the published name is in the card table, so replacing gains a rate;
      2. the harvested name is NOT, so nothing priceable is being thrown away —
         a harvest that already prices always wins, including when it disagrees;
      3. the harvested name resolves ONTO the published one, by the same rules
         used everywhere else, with the published name as the only candidate.

    A genuine change of official fails (3): a different man's name is not an
    abbreviation of this one. Two full names that both price fail (2). And a
    pair where neither prices — "C. Muniz" against "Carlos Muñiz" — fails (1)
    and stays reported, because swapping one unpriceable spelling for another
    would only hide that the card table has never heard of him.
    """
    if not harvested or not published:
        return False
    if published not in known or harvested in known:
        return False
    return resolve_ref_name(harvested, [published])[0] == published


def _shift(date, delta):
    from datetime import date as _d, timedelta
    try:
        y, m, d = (int(x) for x in date.split("-"))
        return (_d(y, m, d) + timedelta(days=1 if delta == "+1" else -1)).isoformat()
    except (ValueError, TypeError):
        return date


def describe(report, code):
    """Print what the overlay did. Every line here is something that changes
    what the desk prices with, so none of it is debug output."""
    if report["applied"] or report["already"]:
        print(f"  {code} appointments overlay: {report['applied']} applied, "
              f"{report['already']} already harvested")
    for line in report["shifted"]:
        print(f"  NOTE: kickoff date differs from the published one — {line}")
    for line in report["clarified"]:
        # A spelling replaced, not an official. Printed as loudly as a change,
        # because this is the one place the harvest is overruled.
        print(f"  CLARIFIED: {line} — the published spelling stands")
    for line in report["disagreed"]:
        # Not resolved here on purpose: the harvest is the fresher source, so
        # it stands, but a changed official is exactly what a desk must see.
        print(f"  CHANGED: {line} — the harvested name stands")
    for line in report["unmatched"]:
        print(f"  WARNING: appointment matches no fixture — {line}")
    for line in report["no_record"]:
        print(f"  NOTE: no card record for {line} — priced at the league rate")

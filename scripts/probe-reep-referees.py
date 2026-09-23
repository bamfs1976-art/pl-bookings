#!/usr/bin/env python3
"""Could the Reep register make the referee name join sturdier? A trial.

A DIAGNOSTIC, like probe-af-referees.py. It reads the committed referee
tables and appointments, compares them with the Reep register's referee
identities (reep.football, CC0) and prints a report. It writes nothing into
the repository and changes no price.

WHY: every referee join here is by NAME. data/appointments.py resolves a
published name onto the card table's spelling by rules that each demand a
unique hit, plus a hand-written alias list. Reep publishes, per referee, a
stable id, a label, alternate names and a country. If Reep knows our
officials and agrees with our joins, its alternate names could replace the
hand-written aliases. If it disagrees, one of us is wrong and the report
lists where.

THE SAME RULES, NOT LOOSER ONES. A Reep lookup runs the repository's own
resolve_ref_name (and resolve_surname_only for Serie A) with Reep's names as
the `known` list, then requires the winning name to belong to ONE Reep id.
Surname alone is still never enough.

WHAT REEP CANNOT DO: it carries no API-Football referee ids and no
appointments. football-data.co.uk carries no ids at all. So Reep can only
ever sit between two NAMES; this trial measures how well.

Usage:
  python3 scripts/probe-reep-referees.py              # download the latest release
  python3 scripts/probe-reep-referees.py --reep-dir D # use D/{referees,aliases,entities}.csv.gz
"""
import argparse
import collections
import csv
import gzip
import hashlib
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "data"))

import appointments as ap_mod  # noqa: E402
from appointments import _fold, resolve_ref_name, resolve_surname_only  # noqa: E402

LATEST = "https://data.reep.football/releases/latest.json"
FILES = ("referees", "aliases", "entities")
LEAGUES = ("PL", "EFLC", "LL", "SA")

csv.field_size_limit(10**8)


# ---------------------------------------------------------------- our side

def card_tables():
    """{league: [name as the card table spells it]}"""
    out = {}
    src = open(os.path.join(ROOT, "data", "pl_data.js"), encoding="utf-8").read()
    block = src.split("const REFS = [", 1)[1].split("];", 1)[0]
    out["PL"] = re.findall(r'\bn:"([^"]+)"', block)
    for league, stem in (("EFLC", "eflc"), ("LL", "laliga"), ("SA", "seriea")):
        with open(os.path.join(ROOT, "data", f"{stem}_refs.json"), encoding="utf-8") as f:
            out[league] = [r["name"] for r in json.load(f)["refs"]]
    return out


def appointments():
    with open(os.path.join(ROOT, "data", "appointments.json"), encoding="utf-8") as f:
        return json.load(f)["appointments"]


def referee_only(published):
    """The EFL text sometimes arrives with the whole team of officials glued
    on: "Steve Martin Assistants: ... Fourth Official: ...". The referee is
    the part before "Assistants:". Reported separately, never silently."""
    return re.split(r"\s+Assistants?:", published or "", maxsplit=1)[0].strip()


# ---------------------------------------------------------------- Reep side

def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bookings-desk-probe"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def download(dest):
    """Fetch the three files the trial needs, checking each sha256 against
    the release manifest. Returns the release stamp."""
    latest = json.loads(_get(LATEST))
    manifest = latest if "files" in latest else None
    if manifest is None:
        url = next((v for v in _walk(latest) if isinstance(v, str) and v.endswith("release.json")), None)
        if not url:
            sys.exit(f"latest.json has no release manifest I recognise; keys: {sorted(latest)}")
        manifest = json.loads(_get(url))
    stamp = next((v for v in _walk(manifest) if isinstance(v, str) and re.fullmatch(r"\d{8}T\d{6}Z", v)), None)
    if stamp is None:
        some = next(iter(manifest["files"].values()))["url"]
        stamp = (re.search(r"\d{8}T\d{6}Z", some) or [None])[0]
    os.makedirs(dest, exist_ok=True)
    for name in FILES:
        meta = manifest["files"][f"csv/{name}.csv.gz"]
        body = _get(meta["url"])
        got = hashlib.sha256(body).hexdigest()
        if got != meta["sha256"]:
            sys.exit(f"{name}: sha256 {got} does not match the manifest's {meta['sha256']}")
        with open(os.path.join(dest, f"{name}.csv.gz"), "wb") as f:
            f.write(body)
    return stamp


def _walk(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)
    else:
        yield o


def _rows(path):
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


def load_reep(d):
    """{reep_id: {"label", "status", "country", "names": set}}"""
    refs = {}
    for r in _rows(os.path.join(d, "referees.csv.gz")):
        refs[r["reep_id"]] = {"label": r["label"], "status": r.get("status", ""),
                              "country": "", "names": {r["label"]}}
    for r in _rows(os.path.join(d, "entities.csv.gz")):
        hit = refs.get(r["reep_id"])
        if hit is not None:
            hit["country"] = r.get("country") or ""
    for r in _rows(os.path.join(d, "aliases.csv.gz")):
        hit = refs.get(r["reep_id"])
        if hit is not None and r.get("alias"):
            hit["names"].add(r["alias"])
    return refs


# ---------------------------------------------------------------- the join

class Index:
    """Reep referees of one country, looked up by the repository's rules."""

    def __init__(self, refs, country):
        self.ids_by_name = collections.defaultdict(set)
        for rid, r in refs.items():
            if country is None or r["country"] == country:
                for n in r["names"]:
                    self.ids_by_name[n].add(rid)
        # resolve_ref_name demands a unique NAME; two spellings that fold
        # together are one name to it, so fold here and keep every id.
        self.known = list(self.ids_by_name)

    def lookup(self, name, league):
        """(reep_id, method) — or (None, why)."""
        got, method = resolve_ref_name(name, self.known)
        if got is None and league == "SA":
            got, method = resolve_surname_only(name, self.known)
        if got is None:
            return None, "none"
        ids = set()
        for n in self.known:
            if _fold(n) == _fold(got):
                ids |= self.ids_by_name[n]
        if len(ids) != 1:
            return None, f"ambiguous ({len(ids)} ids)"
        return next(iter(ids)), method


def pick_country(refs, names):
    """The country most of a league's card-table names land in exactly."""
    by_fold = collections.defaultdict(set)
    for rid, r in refs.items():
        for n in r["names"]:
            by_fold[_fold(n)].add(rid)
    votes = collections.Counter()
    for n in names:
        for rid in by_fold.get(_fold(n), ()):
            votes[refs[rid]["country"]] += 1
    votes.pop("", None)
    return (votes.most_common(1)[0][0] if votes else None), votes


# ---------------------------------------------------------------- report

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reep-dir", help="use already-downloaded csv.gz files")
    ap.add_argument("--work", default="/tmp/reep")
    args = ap.parse_args()

    stamp = "local files"
    d = args.reep_dir
    if not d:
        stamp = download(args.work)
        d = args.work
    refs = load_reep(d)

    tables = card_tables()
    appts = appointments()
    out = []
    say = out.append

    say(f"# Reep referee trial\n\nReep release: `{stamp}`. Reep referees: {len(refs)}. "
        f"With a country: {sum(1 for r in refs.values() if r['country'])}.\n")

    idx = {}
    say("## 1. Does Reep know our officials?\n")
    say("Each card-table name, looked up among Reep referees of the league's country "
        "with the repository's own resolver.\n")
    say("| League | Country chosen | Table names | One Reep id | Ambiguous | Not found |")
    say("|---|---|---|---|---|---|")
    table_ids = {}
    misses = collections.defaultdict(list)
    for lg in LEAGUES:
        country, votes = pick_country(refs, tables[lg])
        idx[lg] = Index(refs, country)
        found = amb = none = 0
        table_ids[lg] = {}
        for n in tables[lg]:
            rid, why = idx[lg].lookup(n, lg)
            if rid:
                found += 1
                table_ids[lg][n] = rid
            elif why.startswith("ambiguous"):
                amb += 1
                misses[lg].append(f"{n} — {why}")
            else:
                none += 1
                misses[lg].append(f"{n} — not found")
        top = ", ".join(f"{c or '?'} {k}" for c, k in votes.most_common(3))
        say(f"| {lg} | {country or 'none (unfiltered)'} ({top}) | {len(tables[lg])} | {found} | {amb} | {none} |")
    for lg in LEAGUES:
        if misses[lg]:
            say(f"\n{lg} misses: " + "; ".join(misses[lg]))

    say("\n## 2. Where we already resolved an appointment, does Reep agree?\n")
    say("Published name and our resolved table name, each mapped to Reep. "
        "Agree = same single id. Disagree = two different ids: one of us is wrong.\n")
    say("| League | Resolved | Agree | Disagree | Reep can't say |")
    say("|---|---|---|---|---|")
    disagreements = []
    for lg in LEAGUES:
        rows = [a for a in appts if a["league"] == lg and a.get("refResolved")]
        seen = {}
        for a in rows:
            seen[(a["ref"], a["refResolved"])] = a
        agree = dis = unk = 0
        for (pub, res), a in seen.items():
            p, _ = idx[lg].lookup(pub, lg)
            r = table_ids[lg].get(res) or idx[lg].lookup(res, lg)[0]
            if p and r and p == r:
                agree += 1
            elif p and r:
                dis += 1
                disagreements.append(f"{lg}: published \"{pub}\" is Reep {p} ({refs[p]['label']}); "
                                     f"we resolved \"{res}\" = Reep {r} ({refs[r]['label']}); our rule: {a.get('resolvedBy')}")
            else:
                unk += 1
        say(f"| {lg} | {len(seen)} distinct pairs | {agree} | {dis} | {unk} |")
    for line in disagreements:
        say(f"- {line}")

    say("\n## 3. Where we left an appointment unresolved, would Reep resolve it?\n")
    say("A proposal only counts when the published name maps to ONE Reep id AND that id "
        "is the id of exactly one card-table name. Every proposal needs a human check.\n")
    unresolved = {}
    for a in appts:
        if not a.get("refResolved"):
            unresolved.setdefault((a["league"], a["ref"]), 0)
            unresolved[(a["league"], a["ref"])] += 1
    say("| League | Published | Cleaned | Reep says | Table name it points at |")
    say("|---|---|---|---|---|")
    would = 0
    for (lg, pub), count in sorted(unresolved.items()):
        clean = referee_only(pub)
        rid, why = idx[lg].lookup(clean, lg)
        back = [n for n, i in table_ids[lg].items() if i == rid] if rid else []
        target = back[0] if len(back) == 1 else ("" if not back else f"{len(back)} names")
        if rid and len(back) == 1:
            would += 1
        # Our own resolver on the cleaned name, to separate "Reep helps" from
        # "the ingest glued the assistants on".
        ours, _ = resolve_ref_name(clean, tables[lg])
        if ours is None and lg == "SA":
            ours, _ = resolve_surname_only(clean, tables[lg])
        note = f" (our rules alone, cleaned: {ours})" if clean != pub else ""
        label = f"{refs[rid]['label']} ({why})" if rid else why
        shown = pub if len(pub) < 40 else pub[:37] + "..."
        say(f"| {lg} | {shown} ×{count} | {clean}{note} | {label} | {target} |")
    say(f"\nReep proposes a table match for {would} of {len(unresolved)} distinct unresolved names.")

    say("\n## 4. What a hand-written alias looks like in Reep\n")
    for pub, rec in ap_mod.ALIASES.items():
        for lg in LEAGUES:
            if rec in tables[lg]:
                p, _ = idx[lg].lookup(pub, lg)
                r = table_ids[lg].get(rec)
                verdict = "same id, Reep would cover this alias" if p and p == r else "Reep does not bridge these"
                say(f"- \"{pub}\" → \"{rec}\" ({lg}): {verdict}.")

    text = "\n".join(out) + "\n"
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    main()

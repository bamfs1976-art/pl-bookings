#!/usr/bin/env python3
"""Read art. 19 of the FIGC's Codice di Giustizia Sportiva, from a network that
can reach it.

  python3 scripts/probe-codice.py

THE ONE QUESTION docs/italy-suspensions.md is left open on. The Serie A desk
prices a suspension ladder at the 5th, 10th, 14th, 17th and 19th caution and
at every caution after that. That rests on three independent secondary
quotations of art. 19 which agree word for word, NOT on the article, because
figc.it and every legal database reprinting it are refused by the network the
desk is built on. A control fetch of Wikipedia is refused there too, so it is
the environment and not the publisher.

The commissioning brief for that desk stated a different progression: the 5th,
10th and 15th caution, then every second caution. No source found supports it.
Both readings are recorded in the Italy note and this probe exists to settle
which one the Codice actually says.

IT WRITES NOTHING AND COMMITS NOTHING. Every call is a GET of a public
document. It reuses no key and needs no secret.

IT ALWAYS EXITS 0. A document that cannot be fetched is a SUCCESSFUL probe:
the answer was obtained, and the answer is "still not reachable". Exiting
non-zero would mark the run red and email the repository owner about a
diagnostic that worked, which is the mistake scripts/probe-ucl.py documents.

WHAT IT PRINTS. For each source: the HTTP status, the bytes, and every
paragraph of the fetched text that mentions `ammonizion` within an article 19
context, verbatim and in Italian, so a reader can compare the progression
against the registry rather than trust this script's parsing. It states the
two candidate readings and marks which one the text supports, and it does not
edit anything: changing the rule is a person's decision on the evidence.
"""

import io
import re
import sys
import urllib.error
import urllib.request
import zlib

UA = ("Mozilla/5.0 (compatible; BookingsDesk/1.0; "
      "+https://bookingsdesk.netlify.app) suspension-rule-check")
TIMEOUT = 45

# The Codice itself first, then the legal databases that reprint it. Order is
# authority, not convenience: a secondary source agreeing with the primary one
# is corroboration, a secondary source alone is what we already have.
SOURCES = [
    ("FIGC, Codice di Giustizia Sportiva (PDF)",
     "https://www.figc.it/media/276306/codice-di-giustizia-sportiva-figc_modifica_-aggiornato_su_cu_18a_del_10-07-2025.pdf"),
    ("FIGC, the Codice's landing page",
     "https://www.figc.it/it/federazione/normativa/codice-di-giustizia-sportiva/"),
    ("Mondodiritto, art. 19",
     "https://www.mondodiritto.it/codici/codice-di-giustizia-sportiva/art-19-codice-di-giustizia-sportiva-esecuzione-delle-sanzioni.html"),
    ("Altalex, the Codice",
     "https://www.altalex.com/documents/codici-altalex/2019/06/13/codice-di-giustizia-sportiva"),
]

# What the two readings look like in the text. The Italian is what the article
# uses; the numbers are what each reading puts the bans on.
ITALY_LADDER = [5, 10, 14, 17, 19]      # what the desk ships
BRIEF_LADDER = [5, 10, 15]              # what the brief said


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA,
                                               "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
            return r.status, raw, None
    except urllib.error.HTTPError as e:
        return e.code, b"", f"HTTP {e.code}"
    except Exception as e:                                   # noqa: BLE001
        return None, b"", f"{type(e).__name__}: {e}"


def pdf_text(blob):
    """The PDF's text, if a text extractor is available.

    poppler's pdftotext is what the appointments fetcher already installs on
    the runner. Without it this says so rather than guessing at the bytes.
    """
    import shutil
    import subprocess
    if not shutil.which("pdftotext"):
        return None, "pdftotext is not installed (apt-get install -y poppler-utils)"
    try:
        out = subprocess.run(["pdftotext", "-layout", "-", "-"],
                             input=blob, capture_output=True, timeout=120)
    except Exception as e:                                   # noqa: BLE001
        return None, f"pdftotext failed: {type(e).__name__}: {e}"
    if out.returncode != 0:
        return None, f"pdftotext exited {out.returncode}"
    return out.stdout.decode("utf-8", "replace"), None


def to_text(markup):
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", markup)
    s = re.sub(r"(?i)</(p|div|li|h\d|tr|br)\s*>|<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    import html as _html
    s = _html.unescape(s)
    return "\n".join(re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in s.split("\n"))


def article_19(text):
    """Everything from the article 19 heading to the next article heading."""
    m = re.search(r"(?im)^\s*art(?:icolo)?\.?\s*19\b.*$", text)
    if not m:
        return None
    tail = text[m.start():]
    nxt = re.search(r"(?im)^\s*art(?:icolo)?\.?\s*20\b", tail)
    return tail[:nxt.start()] if nxt else tail[:6000]


def report(text, label):
    """Print what the text says about accumulated cautions, and judge it."""
    art = article_19(text)
    where = "art. 19" if art else "the whole document (no art. 19 heading found)"
    body = art or text
    lines = [ln for ln in body.splitlines() if "ammonizion" in ln.lower()]
    print(f"    {len(lines)} line(s) mentioning ammonizioni in {where}")
    for ln in lines[:25]:
        print(f"      | {ln.strip()[:200]}")
    low = " ".join(lines).lower()
    # The progression in words, which is how the article states it.
    ordinals = ["quinta", "quarta", "terza", "seconda"]
    seen = [o for o in ordinals if o in low]
    every = "ogni ulteriore ammonizione" in low or "ogni successiva ammonizione" in low
    print(f"    ordinals present: {seen or 'none'}; "
          f"'ogni ulteriore ammonizione': {every}")
    if seen == ordinals and every:
        print(f"    => matches the shipped ladder {ITALY_LADDER} then every caution")
    elif "quindicesima" in low or re.search(r"\b15\b", low):
        print(f"    => mentions a fifteenth; check against the brief's {BRIEF_LADDER}")
    else:
        print("    => inconclusive from this source; read the lines above by hand")


def main():
    print("Art. 19, Codice di Giustizia Sportiva (FIGC): what the primary text says")
    print(f"The desk ships bans at {ITALY_LADDER} then every caution.")
    print(f"The commissioning brief said {BRIEF_LADDER} then every second caution.\n")
    reached = 0
    for label, url in SOURCES:
        print(f"  {label}\n    {url}")
        status, blob, err = fetch(url)
        if err or not blob:
            print(f"    NOT READ: {err or 'empty response'}\n")
            continue
        reached += 1
        print(f"    HTTP {status}, {len(blob)} bytes")
        if blob[:4] == b"%PDF":
            text, why = pdf_text(blob)
            if text is None:
                print(f"    NOT READ: {why}\n")
                continue
            print(f"    {len(text)} chars of extracted text")
        else:
            text = to_text(blob.decode("utf-8", "replace"))
        report(text, label)
        print()
    if not reached:
        print("No source answered. The rule stands on the secondary quotations "
              "recorded in docs/italy-suspensions.md, and this run is evidence "
              "the primary text is unreachable from here as well.")
    else:
        print(f"{reached} of {len(SOURCES)} source(s) read. Nothing was changed: "
              "the registry is edited by a person on this evidence.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

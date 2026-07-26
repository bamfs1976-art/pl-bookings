#!/usr/bin/env python3
"""
Extend data/ref_history.js past the frozen epldata baseline (1992/93–2017/18)
using the football-data.co.uk Premier League match CSVs mirrored on GitHub —
the same public-domain source data/build_refs.py already uses. No login, no
API key, no new dependency.

The epldata package is frozen at May 2018, so the desk's "career record"
column stopped there. That mirror carries season-9394 … season-2526, so from
2018/19 onward every referee's matches and cautions can be recomputed from
match records and merged onto the baseline.

Idempotent by design. The epldata era is kept pristine in
data/ref_history_base.json (career TOTALS, not rates) and this script always
recomputes the football-data era from scratch, so running it repeatedly can
never double-count. Re-run it whenever a season finishes.

Referee names arrive as "A Taylor" here and "A.Taylor" in epldata; both key to
initial + surname, the same join the app's refHistKey() uses, so a referee who
worked either side of 2018 merges into one career record.

Usage:
    python3 data/extend_ref_history.py                    # 1819 → 2526
    python3 data/extend_ref_history.py --from 1819 --to 2425
    python3 data/extend_ref_history.py --csv-dir some/dir  # offline: season-*.csv
"""

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent
RAW = ("https://raw.githubusercontent.com/datasets/football-datasets/"
       "main/datasets/premier-league/season-{code}.csv")
MIN_MATCHES = 3          # same floor as build_refs.py


def season_label(code):
    """'1819' -> '2018/19'; '9394' -> '1993/94'."""
    code = str(code).zfill(4)
    yy = int(code[:2])
    start = 1900 + yy if yy >= 90 else 2000 + yy
    return f"{start}/{code[2:]}"


def season_codes(first, last):
    """Inclusive football-data season codes from `first` to `last`."""
    def order(c):                      # sortable: 9394 -> 1993, 1819 -> 2018
        yy = int(str(c).zfill(4)[:2])
        return 1900 + yy if yy >= 90 else 2000 + yy
    out, y = [], order(first)
    while y <= order(last):
        a, b = y % 100, (y + 1) % 100
        out.append(f"{a:02d}{b:02d}")
        y += 1
    return out


def load_season(code, csv_dir):
    if csv_dir:
        p = Path(csv_dir) / f"season-{code}.csv"
        if not p.exists():
            return None
        text = p.read_text(encoding="utf-8-sig")
    else:
        try:
            with urllib.request.urlopen(RAW.format(code=code), timeout=60) as r:
                text = r.read().decode("utf-8-sig")
        except Exception as e:                     # a season not yet mirrored
            print(f"  {season_label(code)}: unavailable ({e})")
            return None
    return list(csv.DictReader(io.StringIO(text)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="first", default="1819",
                    help="first football-data season code to add (default 1819)")
    ap.add_argument("--to", dest="last", default="2526",
                    help="last football-data season code to add (default 2526)")
    ap.add_argument("--csv-dir", help="read season-*.csv from here instead of fetching")
    args = ap.parse_args()

    base_path = DATA / "ref_history_base.json"
    if not base_path.exists():
        sys.exit("ERROR: data/ref_history_base.json is missing — it holds the "
                 "frozen epldata baseline this script merges onto.")
    base = json.loads(base_path.read_text(encoding="utf-8"))

    key = lambda n: (lambda p: "" if len(p) < 2 else (p[0][0] + " " + p[-1]).lower())(
        [x for x in re.split(r"[\s.]+", str(n or "").strip()) if x])

    # career totals from the baseline, keyed for merging
    careers = {}
    for r in base["refs"]:
        k = key(r["n"])
        if k:
            careers[k] = {"n": r["n"], "matches": r["matches"], "cautions": r["cautions"],
                          "first": r["first"], "last": r["last"]}
    seasons = list(base["seasons"])
    have = {s["s"] for s in seasons}

    added, added_seasons = 0, []
    for code in season_codes(args.first, args.last):
        label = season_label(code)
        rows = load_season(code, args.csv_dir)
        if not rows:
            continue
        games = yellows = 0
        per_ref = {}
        for r in rows:
            ref = (r.get("Referee") or "").strip()
            try:
                y = int(r["HY"]) + int(r["AY"])
            except (KeyError, TypeError, ValueError):
                continue                       # no card columns for this row/season
            games += 1
            yellows += y
            if not ref:
                continue
            d = per_ref.setdefault(ref, {"m": 0, "y": 0})
            d["m"] += 1
            d["y"] += y
        if not games:
            print(f"  {label}: no card data — skipped")
            continue
        if label in have:                      # replace, so re-runs stay idempotent
            seasons = [s for s in seasons if s["s"] != label]
        seasons.append({"s": label, "ypg": round(yellows / games, 2), "g": games})
        added_seasons.append(label)
        for name, d in per_ref.items():
            k = key(name)
            if not k:
                continue
            c = careers.setdefault(k, {"n": name, "matches": 0, "cautions": 0,
                                       "first": label, "last": label})
            c["matches"] += d["m"]
            c["cautions"] += d["y"]
            if label < c["first"]:
                c["first"] = label
            if label > c["last"]:
                c["last"] = label
        added += 1
        print(f"  {label}: {games} games, {yellows / games:.2f} y/g, {len(per_ref)} referees")

    if not added:
        sys.exit("ERROR: no seasons could be added — nothing written.")

    seasons.sort(key=lambda s: s["s"])
    refs = []
    for c in careers.values():
        if c["matches"] < MIN_MATCHES:
            continue
        refs.append({"n": c["n"], "matches": c["matches"],
                     "ypg": round(c["cautions"] / c["matches"], 2),
                     "first": c["first"], "last": c["last"]})
    refs.sort(key=lambda r: -r["ypg"])

    span = f"{seasons[0]['s']}–{seasons[-1]['s']}"
    out = [
        "// Auto-generated: data/extend_ref_history.py",
        "// Baseline 1992/93-2017/18 from the MIT-licensed epldata R package",
        "// (github.com/pssguy/epldata), snapshotted in data/ref_history_base.json.",
        "// 2018/19 onward recomputed from the public-domain football-data.co.uk",
        "// match records mirrored at github.com/datasets/football-datasets — the",
        "// same source data/build_refs.py uses. Cautions (yellows) only.",
        "const REF_HISTORY = {",
        f'  span: {json.dumps(span, ensure_ascii=False)},',
        "  seasons: " + json.dumps(seasons, ensure_ascii=False, separators=(",", ":")) + ",",
        "  refs: " + json.dumps(refs, ensure_ascii=False, separators=(",", ":")),
        "};",
        "",
    ]
    (DATA / "ref_history.js").write_text("\n".join(out), encoding="utf-8")
    print(f"ref_history.js written: span {span}, {len(seasons)} seasons, {len(refs)} referees "
          f"({added} season(s) merged: {', '.join(added_seasons)})")


if __name__ == "__main__":
    main()

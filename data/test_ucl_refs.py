#!/usr/bin/env python3
"""Tests for data/ucl_refs.py: the Champions League referee record."""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ucl_refs as U  # noqa: E402

passed = 0


def t(name, fn):
    global passed
    fn()
    passed += 1
    print(f"  ok - {name}")


def entry(fid, ref, rnd="League Stage - 2", st="FT", hy=2, ay=3, hr=0, ar=0,
          hf=11, af=14, stats=True, events=None, season=2025):
    e = {"fixture": {"id": fid, "referee": ref, "status": {"short": st}},
         "league": {"round": rnd, "season": season},
         "teams": {"home": {"id": 1}, "away": {"id": 2}}}
    if stats:
        e["statistics"] = [
            {"team": {"id": 1}, "statistics": [
                {"type": "Fouls", "value": hf}, {"type": "Yellow Cards", "value": hy},
                {"type": "Red Cards", "value": hr}]},
            {"team": {"id": 2}, "statistics": [
                {"type": "Fouls", "value": af}, {"type": "Yellow Cards", "value": ay},
                {"type": "Red Cards", "value": None}]},
        ]
    if events is not None:
        e["events"] = events
    return e


def _rounds():
    assert U.in_phase("League Stage - 3")
    assert U.in_phase("Group Stage - 1")
    assert U.in_phase("Group A - 1") and U.in_phase("Group H - 6")
    assert U.in_phase("Knockout Round Play-offs")
    assert U.in_phase("Round of 16") and U.in_phase("Final")
    assert U.in_phase("Quarter-finals") and U.in_phase("Semi-finals")
    assert not U.in_phase("Play-offs")
    assert not U.in_phase("3rd Qualifying Round")
    assert not U.in_phase("Preliminary Round")


def _record_from_statistics():
    r = U.record(entry(10, "Glenn Nyberg, Sweden"))
    assert r["ref"] == "Glenn Nyberg", r
    assert (r["HY"], r["AY"], r["HR"], r["AR"], r["HF"], r["AF"]) == (2, 3, 0, 0, 11, 14), r
    assert U.record(entry(11, "X Y", rnd="2nd Qualifying Round")) is None
    assert U.record(entry(12, "X Y", st="NS")) is None
    assert U.record(entry(13, "")) is None


def _record_from_events_counts_a_second_yellow_once():
    ev = [
        {"type": "Card", "detail": "Yellow Card", "team": {"id": 1}, "player": {"id": 7}},
        {"type": "Card", "detail": "Yellow Card", "team": {"id": 1}, "player": {"id": 7}},
        {"type": "Card", "detail": "Red Card", "team": {"id": 1}, "player": {"id": 7}},
        {"type": "Card", "detail": "Yellow Card", "team": {"id": 2}, "player": {"id": 9}},
        {"type": "Goal", "detail": "Normal Goal", "team": {"id": 2}, "player": {"id": 9}},
    ]
    r = U.record(entry(20, "Felix Zwayer", stats=False, events=ev))
    assert (r["HY"], r["HR"], r["AY"], r["AR"]) == (1, 1, 1, 0), r
    assert r["HF"] is None and r["AF"] is None
    # Neither block came back: no record, not a fabricated nil.
    assert U.record(entry(21, "Felix Zwayer", stats=False)) is None


def _wanted_skips_recorded_and_unfinished():
    es = [entry(1, "A B"), entry(2, "A B", st="NS"), entry(3, "A B", rnd="Play-offs"),
          entry(4, "A B"), entry(5, None)]
    assert U.wanted(es, {"4"}) == [1], U.wanted(es, {"4"})


def _build_matches_the_desks_arithmetic():
    recs = {}
    for i in range(4):        # Nyberg: 4 matches, 2+1 yellows each, 25 fouls
        recs[str(100 + i)] = U.record(entry(100 + i, "Glenn Nyberg", hy=2, ay=1, hf=12, af=13))
    for i in range(3):        # Zwayer: 3 matches, 3+3, 24 fouls
        recs[str(200 + i)] = U.record(entry(200 + i, "Felix Zwayer", hy=3, ay=3, hf=12, af=12))
    recs["300"] = U.record(entry(300, "Solo Ref", hy=9, ay=9))  # under the floor
    refs, base = U.build(recs)
    by = {r["n"]: r for r in refs}
    assert set(by) == {"Glenn Nyberg", "Felix Zwayer"}, by
    assert by["Glenn Nyberg"]["ypg"] == 3.0 and by["Glenn Nyberg"]["matches"] == 4
    assert by["Felix Zwayer"]["ypg"] == 6.0
    assert abs(by["Felix Zwayer"]["cpf"] - 0.25) < 1e-9, by["Felix Zwayer"]
    assert by["Glenn Nyberg"]["seasons"] == [2025]
    # The baseline counts every match, the under-floor referee included.
    assert base["matches"] == 8, base
    assert abs(base["avgYpg"] - (12 + 18 + 18) / 8) < 1e-3, base


def _abbreviations_fold_into_one_career():
    recs = {"1": U.record(entry(1, "G. Nyberg")),
            "2": U.record(entry(2, "Glenn Nyberg")),
            "3": U.record(entry(3, "Glenn Nyberg"))}
    refs, _ = U.build(recs)
    assert [r["n"] for r in refs] == ["Glenn Nyberg"] and refs[0]["matches"] == 3, refs


def _write_and_reload_round_trip():
    recs = {str(i): U.record(entry(i, "Glenn Nyberg")) for i in range(5)}
    refs, base = U.build(recs)
    with tempfile.TemporaryDirectory() as d:
        U.write(recs, refs, base, Path(d))
        back = U.load_records(Path(d) / U.FIXTURES_FILE)
        assert back == recs
        src = (Path(d) / U.REFS_FILE).read_text()
        assert "const UCL_REFS = [" in src and "const UCL_REF_BASE = " in src
        assert "excludes qualifying" in src
        bad = Path(d) / "bad.js"
        bad.write_text("const X = {not json};")
        try:
            U.load_records(bad)
        except SystemExit as e:
            assert "will not parse" in str(e)
        else:
            raise AssertionError("a corrupt record must stop the run")


def _a_knockout_round_does_not_complete_a_season():
    recs = {str(i): {"s": 2023, "r": "Round of 16"} for i in range(29)}
    recs.update({str(100 + i): {"s": 2024, "r": "League Stage - 1"} for i in range(150)})
    assert U.seasons_recorded(recs) == {2024}, U.seasons_recorded(recs)


def _skipped_rounds_are_reported():
    es = [entry(1, "A B", rnd="Play-offs"), entry(2, "A B", rnd="3rd Qualifying Round"),
          entry(3, "A B", rnd="3rd Qualifying Round"), entry(4, "A B"),
          entry(5, "A B", rnd="Play-offs", st="NS")]
    assert U.skipped_rounds(es) == {"Play-offs": 1, "3rd Qualifying Round": 2}, U.skipped_rounds(es)


print("ucl_refs")
t("a knockout round alone does not mark a past season done",
  _a_knockout_round_does_not_complete_a_season)
t("finished rounds the filter rejects are counted for the log", _skipped_rounds_are_reported)
t("the league phase and knockouts count, qualifying does not", _rounds)
t("a record reads cards and fouls from the statistics block", _record_from_statistics)
t("the events fallback counts a second yellow and its red once",
  _record_from_events_counts_a_second_yellow_once)
t("only finished, in-phase, refereed, unrecorded ties are fetched",
  _wanted_skips_recorded_and_unfinished)
t("rates use the desks' own arithmetic, and the baseline counts every match",
  _build_matches_the_desks_arithmetic)
t("an abbreviated spelling folds into the full name", _abbreviations_fold_into_one_career)
t("the record round-trips, and a corrupt one stops the run", _write_and_reload_round_trip)
print(f"\n{passed} tests passed")

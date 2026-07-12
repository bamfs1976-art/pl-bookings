"""End-to-end checks: build_dataset over the real sources, and the
forecast log/score cycle over synthetic data."""

import json
import subprocess
import sys
from pathlib import Path

PIPE = Path(__file__).resolve().parents[1]
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))

import build_dataset  # noqa: E402


def load_sources():
    prior = json.loads((PIPE / "sources/players_2526.json").read_text())
    current = json.loads((PIPE / "sources/players_current.json").read_text())
    return prior, current


def test_build_players_dedupes_broken_harvest_rows():
    prior = [{"c": "COV", "n": "Haji Wright", "p": "FW", "min": 2000, "yc": 4,
              "rc": 0, "y": 0.18, "f": 1.2, "r": 1.56, "ls": False, "b": "EFL"}] * 12
    players = build_dataset.build_players(prior, {"players": [], "as_of_matchday": 0})
    assert len(players) == 1


def test_build_players_preseason_uses_prior():
    prior, current = load_sources()
    players = build_dataset.build_players(prior, current)
    # unique (club, name) only — the raw file carries duplicated
    # promoted-club rows that the builder must drop
    assert len(players) == len({(p["c"], p["n"]) for p in prior})
    by_name = {(p["c"], p["n"]): p for p in players}
    # A nailed-on starter's shrunk rate stays close to his raw rate
    zubi = by_name[("ARS", "Martín Zubimendi")]
    assert abs(zubi["ys"] - zubi["y"]) < 0.06
    assert zubi["em"] > 80


def test_build_players_shrinks_cameo_artefacts():
    prior, current = load_sources()
    players = build_dataset.build_players(prior, current)
    by_name = {(p["c"], p["n"]): p for p in players}
    # Raw data: 1 minute, 90 fouls/90. Model rate must be sane.
    mph = by_name[("BRE", "Myles Peart-Harris")]
    assert mph["f"] == 90.0            # raw kept for transparency
    assert mph["fs"] < 2.0             # model rate shrunk to earth
    assert mph["rs"] < 3.0
    assert mph["em"] < 25


def test_build_players_in_season_blend():
    prior, _ = load_sources()
    current = {
        "as_of_matchday": 10,
        "players": [
            # Saliba carded 5 times in 900 minutes this season (hot streak)
            {"c": "ARS", "n": "William Saliba", "p": "DF", "min": 900,
             "yc": 5, "rc": 0, "y": 0.5, "f": 0.8, "r": 1.8, "ls": False, "b": "PL"},
            # A brand-new signing with no prior
            {"c": "ARS", "n": "New Signing", "p": "MF", "min": 450,
             "yc": 2, "rc": 0, "y": 0.4, "f": 1.5, "r": 2.3, "ls": False, "b": "PL"},
        ],
    }
    players = build_dataset.build_players(prior, current)
    assert len(players) == 2  # current squad defines the universe
    by_name = {p["n"]: p for p in players}
    sal = by_name["William Saliba"]
    # Blended: pulled up from last season's 0.069 but below the raw 0.5
    assert 0.1 < sal["ys"] < 0.45
    assert sal["syc"] == 5
    ns = by_name["New Signing"]
    assert 0.1 < ns["ys"] < 0.4  # shrinkage active, no prior available


def test_full_build_writes_valid_js(tmp_path, monkeypatch):
    out = tmp_path / "app-data.js"
    monkeypatch.setattr(build_dataset, "OUT", out)
    build_dataset.main()
    text = out.read_text()
    assert text.startswith("// Generated")
    payload = text.split("window.DATA = ", 1)[1].rstrip().rstrip(";")
    data = json.loads(payload)
    assert data["meta"]["players"] == 462  # 528 raw minus 66 duplicated rows
    assert len(data["fixtures"]) >= 20
    assert data["eval"]["n"] == 0
    assert all(f["mw"] in (1, 2) for f in data["fixtures"][:20])
    # every fixture club exists
    shorts = {c["short"] for c in data["clubs"]}
    for f in data["fixtures"]:
        assert f["home"] in shorts and f["away"] in shorts


def test_log_and_score_cycle(tmp_path, monkeypatch):
    """Freeze forecasts for MW1, feed synthetic results, check scoring."""
    import score_forecasts as sf

    monkeypatch.setattr(sf, "STORE", tmp_path)
    monkeypatch.setattr(sf, "LOG", tmp_path / "forecast_log.json")
    monkeypatch.setattr(sf, "SCORES", tmp_path / "forecast_scores.json")

    sf.cmd_log(1)
    log = json.loads((tmp_path / "forecast_log.json").read_text())["forecasts"]
    assert len(log) > 300  # both squads of 10 fixtures
    assert all(0.0 <= e["p"] <= 1.0 for e in log)
    assert all(e["mw"] == 1 for e in log)

    # Synthetic results: every ARS-COV player with p>=0.2 got carded.
    booked = [e["player"] for e in log
              if e["fixture_id"] == "2627-01-ARS-COV" and e["p"] >= 0.2]
    results = {"matches": [{
        "fixture_id": "2627-01-ARS-COV", "mw": 1,
        "kickoff": "2026-08-21T19:00:00Z", "home": "ARS", "away": "COV",
        "score": "2-1", "referee": None, "booked": booked,
    }]}
    monkeypatch.setattr(sf, "SRC", tmp_path)
    (tmp_path / "results.json").write_text(json.dumps(results))

    sf.cmd_score()
    scores = json.loads((tmp_path / "forecast_scores.json").read_text())
    n_players = len([e for e in log if e["fixture_id"] == "2627-01-ARS-COV"])
    assert scores["n"] == n_players
    assert 0.0 <= scores["brier"] <= 0.35
    assert scores["by_mw"][0]["mw"] == 1


def test_sim_predictions_flow_into_fixtures_and_forecasts(tmp_path, monkeypatch):
    """Win probabilities land as gs factors on fixtures and shift forecasts."""
    import score_forecasts as sf

    sim_file = PIPE / "sources/sim_predictions.json"
    original = sim_file.read_text()
    try:
        sim_file.write_text(json.dumps({"fixtures": {
            "2627-01-ARS-COV": {"home_win": 0.75, "draw": 0.15, "away_win": 0.10},
        }}))
        monkeypatch.setattr(sf, "STORE", tmp_path)
        monkeypatch.setattr(sf, "LOG", tmp_path / "forecast_log.json")
        monkeypatch.setattr(sf, "SCORES", tmp_path / "forecast_scores.json")
        sf.cmd_log(1)
        log = json.loads((tmp_path / "forecast_log.json").read_text())["forecasts"]
        by = {}
        for e in log:
            by.setdefault(e["fixture_id"], {}).setdefault(e["club"], []).append(e["p"])
        # COV are 10% underdogs → chase factor lifts their probabilities;
        # compare against a fixture with no sim data where COV don't appear,
        # so instead check ARS (favourites) got suppressed relative to their
        # own neutral-fixture pricing in MW2 (AVL v ARS, no sim entry).
        assert "2627-01-ARS-COV" in by
        sf.cmd_log(2)
        log2 = json.loads((tmp_path / "forecast_log.json").read_text())["forecasts"]
        ars_mw1 = {e["player"]: e["p"] for e in log2
                   if e["fixture_id"] == "2627-01-ARS-COV" and e["club"] == "ARS"}
        ars_mw2 = {e["player"]: e["p"] for e in log2
                   if e["fixture_id"] == "2627-02-AVL-ARS" and e["club"] == "ARS"}
        shared = set(ars_mw1) & set(ars_mw2)
        assert shared
        # MW1: home (×0.95) AND 75% favourites (×~0.925) → clearly below
        # MW2 away (×1.08, no sim). Every shared player should price lower.
        assert all(ars_mw1[n] < ars_mw2[n] for n in shared)
    finally:
        sim_file.write_text(original)


def test_cli_build_runs():
    r = subprocess.run([sys.executable, str(PIPE / "build_dataset.py")],
                       capture_output=True, text=True, cwd=str(PIPE))
    assert r.returncode == 0, r.stderr
    assert "app-data.js" in r.stdout
    assert (ROOT / "app-data.js").exists()

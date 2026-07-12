#!/usr/bin/env python3
"""
Walk-forward backtest of the desk's expected-cards building blocks.

The Gameweek tab estimates a match's total cards as
    (ca_home * heat_home + ca_away * heat_away) * ref_factor
where ca is a club's cards-received-per-game rate, heat is the match-heat
multiplier (closeness x chasing) and ref_factor is the referee's yellows
per game against the league norm. This script asks, honestly, whether each
ingredient earns its place, in the same walk-forward spirit as the PL
Simulator's backtest: every prediction uses only matches played earlier.

Input: one or more football-data.co.uk main CSVs (E0 = Premier League),
which carry HY/AY (yellow cards per side) and the referee name per match:

    python3 data/backtest_cards.py E0_2024-25.csv E0_2025-26.csv

Each file is treated as one season and walked forward independently; the
metrics aggregate across files. Variants, each adding one ingredient:

    league   league-average total yellows so far (the naive floor)
    teams    shrunk per-club cards-received rates
    +ref     ... times the referee's rate vs the league norm
    +heat    ... times per-side heat from a running Elo (closeness and
             chasing exactly as the app computes them; the late-season
             stakes term needs Monte Carlo context and is not tested here)

Scored on total match yellows with MAE and RMSE, lower is better. The
first BURN_IN matches of each season fit rates but are not scored.
"""

import csv
import math
import sys

BURN_IN = 50          # matches used for fitting only, per season
PRIOR_MATCHES = 6     # shrinkage: club/ref rates count this many league-mean games
ELO_START = 1500.0
ELO_K = 24.0          # same Elo constants as the PL Simulator
ELO_HOME = 60.0
# heat coefficients exactly as index.html applies them
HEAT_CLOSENESS = 0.20
HEAT_CHASING = 0.12


def read_season(path):
    """[(home, away, hy, ay, hg, ag, ref)] in file (= date) order."""
    rows = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            try:
                rows.append((
                    row["HomeTeam"].strip(), row["AwayTeam"].strip(),
                    int(row["HY"]), int(row["AY"]),
                    int(row["FTHG"]), int(row["FTAG"]),
                    (row.get("Referee") or "").strip(),
                ))
            except (KeyError, ValueError):
                continue  # blank trailing lines, abandoned fixtures
    return rows


class Running:
    """Walk-forward state: club card rates, referee rates, Elo."""

    def __init__(self):
        self.club_cards = {}    # club -> [cards, matches]
        self.ref_cards = {}     # ref -> [total match yellows, matches]
        self.elo = {}
        self.total_cards = 0
        self.matches = 0

    # -- predictions (before seeing the match) --------------------------

    def league_mean(self):
        return self.total_cards / self.matches if self.matches else 4.0

    def club_rate(self, club):
        """Cards received per match, shrunk toward half the league mean."""
        cards, n = self.club_cards.get(club, (0, 0))
        prior = self.league_mean() / 2.0
        return (cards + PRIOR_MATCHES * prior) / (n + PRIOR_MATCHES)

    def ref_factor(self, ref):
        if not ref:
            return 1.0
        cards, n = self.ref_cards.get(ref, (0, 0))
        rate = (cards + PRIOR_MATCHES * self.league_mean()) / (n + PRIOR_MATCHES)
        return rate / self.league_mean()

    def heats(self, home, away):
        """(heat_home, heat_away) from the running Elo, as the app computes
        them: closeness applies to both sides, chasing favours the side more
        likely to be trailing. Draws are folded into the Elo expectation."""
        eh = self.elo.get(home, ELO_START) + ELO_HOME
        ea = self.elo.get(away, ELO_START)
        e = 1.0 / (1.0 + 10.0 ** ((ea - eh) / 400.0))  # home expected score
        closeness = 1.0 - abs(2.0 * e - 1.0)
        fix = 1.0 + HEAT_CLOSENESS * (closeness - 0.5)
        chase_h = 1.0 + HEAT_CHASING * ((1.0 - e) - e)
        chase_a = 1.0 + HEAT_CHASING * (e - (1.0 - e))
        return fix * chase_h, fix * chase_a

    # -- update (after the match) ----------------------------------------

    def record(self, home, away, hy, ay, hg, ag, ref):
        self.total_cards += hy + ay
        self.matches += 1
        for club, cards in ((home, hy), (away, ay)):
            c, n = self.club_cards.get(club, (0, 0))
            self.club_cards[club] = (c + cards, n + 1)
        if ref:
            c, n = self.ref_cards.get(ref, (0, 0))
            self.ref_cards[ref] = (c + hy + ay, n + 1)
        eh = self.elo.get(home, ELO_START)
        ea = self.elo.get(away, ELO_START)
        e = 1.0 / (1.0 + 10.0 ** ((ea - (eh + ELO_HOME)) / 400.0))
        score = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        self.elo[home] = eh + ELO_K * (score - e)
        self.elo[away] = ea - ELO_K * (score - e)


VARIANTS = ["league", "teams", "+ref", "+heat"]


def predictions(state, home, away, ref):
    base_h, base_a = state.club_rate(home), state.club_rate(away)
    rf = state.ref_factor(ref)
    heat_h, heat_a = state.heats(home, away)
    return {
        "league": state.league_mean(),
        "teams": base_h + base_a,
        "+ref": (base_h + base_a) * rf,
        "+heat": (base_h * heat_h + base_a * heat_a) * rf,
    }


def main(paths):
    if not paths:
        print(__doc__)
        return 2
    err = {v: [] for v in VARIANTS}
    scored = 0
    for path in paths:
        rows = read_season(path)
        if len(rows) <= BURN_IN:
            print(f"{path}: only {len(rows)} usable matches, skipped")
            continue
        state = Running()
        for i, (home, away, hy, ay, hg, ag, ref) in enumerate(rows):
            if i >= BURN_IN:
                actual = hy + ay
                for v, pred in predictions(state, home, away, ref).items():
                    err[v].append(pred - actual)
                scored += 1
            state.record(home, away, hy, ay, hg, ag, ref)
        print(f"{path}: {len(rows)} matches, {len(rows) - BURN_IN} scored")
    if not scored:
        return 1
    print(f"\n{scored} predictions scored, walk-forward "
          f"(burn-in {BURN_IN} per season). Lower is better.")
    print(f"{'variant':<8} {'MAE':>7} {'RMSE':>7} {'bias':>7}")
    for v in VARIANTS:
        e = err[v]
        mae = sum(abs(x) for x in e) / len(e)
        rmse = math.sqrt(sum(x * x for x in e) / len(e))
        bias = sum(e) / len(e)
        print(f"{v:<8} {mae:>7.3f} {rmse:>7.3f} {bias:>+7.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

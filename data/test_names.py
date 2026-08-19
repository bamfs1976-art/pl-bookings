#!/usr/bin/env python3
"""
One player, written two ways — and two players who merely look alike.

WHY THIS IS ITS OWN TEST FILE. Every join in this pipeline that has ever gone
wrong went wrong on a name, and always silently: a join that finds nobody looks
exactly like a feed that carries nothing, and a join that finds the WRONG
person looks exactly like a correct one. The fouls-won fill found 19 of 456
players before anyone noticed; the squad report claimed 185 players had left
the league when the feed had most of them under a fuller spelling.

So both directions are pinned here, on real names taken from the shipped
dataset and the live FPL feed rather than invented ones. The negative cases
matter more than the positive ones: a missed match costs a rate, a false match
attaches one man's disciplinary record to another and nothing ever says so.

  python3 data/test_names.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pl_data as b  # noqa: E402

passed = 0


def ok(cond, msg):
    global passed
    assert cond, msg
    passed += 1


def same(a, c, why):
    ok(b.same_person(a, c), f"{a!r} and {c!r} are the same player — {why}")
    ok(b.same_person(c, a), f"{a!r}/{c!r} matched one way round only — {why}")


def different(a, c, why):
    ok(not b.same_person(a, c), f"{a!r} and {c!r} are NOT the same player — {why}")
    ok(not b.same_person(c, a), f"{a!r}/{c!r} matched one way round — {why}")


print("names: the same player, spelt differently")
# FPL prints the whole legal name; the desks print the football one. This is
# the single commonest shape in the feed and the two-stage key missed all of it,
# because an appended surname moves the last token.
same("David Raya", "David Raya Martín", "an appended second surname")
same("Gabriel Martinelli", "Gabriel Martinelli Silva", "an appended surname")
same("Bruno Guimarães", "Bruno Guimarães Rodriguez Moura", "two appended names")
same("Mikel Merino", "Mikel Merino Zazón", "an appended surname")
same("Ezri Konsa", "Ezri Konsa Ngoyo", "an appended surname")
# A name inserted in the MIDDLE, which prefix matching misses.
same("Levi Colwill", "Levi Samuels Colwill", "an inserted middle name")
same("Robert Sánchez", "Robert Lynch Sánchez", "an inserted middle name")
same("Pedro Neto", "Pedro Lomba Neto", "an inserted middle name")
# The forename as an initial — the shape the Championship feeds use.
same("M. van Ewijk", "Milan van Ewijk", "an abbreviated forename with a particle")
same("C. Nørgaard", "Christian Nørgaard", "an abbreviated forename")
same("L. Koumas", "Lewis Koumas", "an abbreviated forename")
# Family name first.
same("Kaoru Mitoma", "Mitoma Kaoru", "the family name written first")
# Letters that are not a letter-plus-a-mark, so NFKD leaves them whole.
same("Djordje Petrovic", "Đorđe Petrović", "đ is a distinct letter, not d with a mark")
same("Hakon Valdimarsson", "Hákon Rafn Valdimarsson", "accents and a middle name")

print("names: different players who look alike")
# THE EXPENSIVE DIRECTION. Each of these pairs really appears in the feed and
# the dataset at the same time.
different("Eli Kroupi", "Junior Kroupi", "a shared surname, different men")
different("Igor Jesus", "Igor Julio dos Santos de Paulo",
          "a shared forename and nothing else")
different("Lewis Hall", "Ben Hall", "a shared surname")
different("Gabriel Jesus", "Gabriel Martinelli", "a shared forename")
different("Joe Gomez", "Joe Willock", "a shared forename")
different("Ben White", "Ben Chilwell", "a shared forename")
different("Cole Palmer", "Kyle Walker", "nothing in common at all")

print("names: the keys the fouls-won join still uses")
ok(b.name_keys("Christian Nørgaard") == ("christian norgaard", "c norgaard"),
   "the full and initial keys are unchanged by the tokeniser refactor")
ok(b.name_keys("") == (None, None), "a nameless row yields no keys, not a blank one")
ok(b.name_keys("...") == (None, None), "punctuation alone is not a name")

print("names: what it refuses to guess")
# A single-token name covers into anything containing it, which is right for
# the Brazilians it exists for and wrong for a coincidence. The protection is
# that a caller must treat MORE THAN ONE hit as unknown — so this pins the
# ambiguity, not the match.
hits = [n for n in ("Gabriel dos Santos Magalhães", "Gabriel Martinelli Silva",
                    "Gabriel Fernando de Jesus") if b.same_person("Gabriel", n)]
ok(len(hits) > 1,
   "a one-token name matching several feed rows must stay AMBIGUOUS, so that a "
   f"caller drops it rather than picking one; matched {hits}")

ok(b.same_person("", "Anybody") is False, "an empty name matches nobody")
ok(b.same_person(None, None) is False, "two missing names are not a match")

print(f"\n{passed} checks passed")

# MUTATIONS these assertions were checked against, each failing on the named
# case rather than incidentally:
#   remove the token-coverage stage -> "David Raya"/"David Raya Martín"
#   accept any shared token         -> "Eli Kroupi"/"Junior Kroupi"
#   remove the initial+surname stage-> "Djordje Petrovic"/"Đorđe Petrović"
# One mutation is NOT caught and is recorded rather than tested around: letting
# a token of up to three letters stand for a longer one in _covers changes no
# outcome here, because the initial-plus-surname stage already matches every
# short-forename case ("Ben White" against "Benjamin White") on its own.

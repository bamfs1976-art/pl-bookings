# Design notes — adopting Gameweek Edge's tokens

*Written 2026-09-05, against `bamfs1976-art/gameweek-edge` at `b4468ad`
(`BRAND.md` §6–8, `DESIGN.md` "Themes", "Typography", "Geometry & motion").*

Bookings Desk and Gameweek Edge share an account, a Supabase project, an app
shell and a person maintaining them, and until this pass they did not share a
single colour name. Nothing was broken by that, which is why it lasted. The
cost was paid every time a component or a pair of eyes moved between the two
repositories and had to translate.

This file records what was adopted, and — the part worth writing down — what
**could not be**, so the next person does not spend an afternoon looking for a
token that was never there.

## What was adopted

| Gameweek Edge | Bookings Desk | How |
|---|---|---|
| `--bg`, `--surface`, `--surface-2`, `--surface-3` | same names | already agreed |
| `--text`, `--text-2`, `--text-3` | same names | already agreed |
| `--border`, `--border-2` | same names | already agreed |
| `--green` | `--good` | alias added |
| `--red` | `--danger` | alias added |
| `--amber` | `--warn` | alias added |
| `--blue` | `--info` | alias added — **but see below** |
| `--font-display`, `--font-body`, `--font-mono` | new | added by role |
| `--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--r-pill` | new | 6 / 8 / 12 / 16 / 999, Gameweek Edge's scale exactly |
| `--shadow`, `--shadow-lg` | `--shadow` existed | `--shadow-lg` added, both themes |
| `--t-state`, `--t-layout`, `--ease` | new | 150ms / 250ms / `cubic-bezier(.2,.8,.2,1)` |

The colour entries are **aliases, not copies**. Each resolves through the token
it points at, so a colour is still written down exactly once here, it follows
the theme automatically, and it cannot drift from the value it names.

## What did not map, and why

### `--positive` and `--negative` do not exist in Gameweek Edge

The brief for this pass named them. They are not tokens in that repository and
never have been. What it has is `--green` (`DESIGN.md`: "the single brand
accent") and `--red` ("genuine negatives only: injury out, price fall
confirmed, over budget"). Those two names were adopted instead.

This is not pedantry about a label. Gameweek Edge reserves green for *positive
data* and uses amber for *actions* — `--accent-cta` is an amber fill,
deliberately, so that "actions read as actions; green stays reserved for
positive data". A token called `--positive` invites exactly the merge of those
two ideas that its design system spent effort separating.

### The radii are not 4px

The brief said "4px radii". Gameweek Edge's scale is **6 / 8 / 12 / 16 / 999**
(`--r-sm` … `--r-pill`), and `BRAND.md` §8 asks for "generous radii (12–22px)"
with a soft geometry. 4px is a sharper corner than either document describes.
The five real values were taken.

Nothing on these desks has been re-cornered to use them yet. The tokens exist
and are the ones to reach for; the roughly one hundred hardcoded radii across
the four pages are a separate, mechanical job with a visual diff to review, and
folding it into a theme change would have made that diff unreadable.

### The body and mono faces stay as they are

| Role | Gameweek Edge | Bookings Desk |
|---|---|---|
| Display | Bricolage Grotesque | Bricolage Grotesque ✓ |
| Body | Public Sans | **Hanken Grotesk** |
| Mono | IBM Plex Mono | **a system stack** |

The names were adopted; the faces were not. Two reasons, in order of weight.

These are single-file static pages with no build step, and every webfont is a
render-blocking request on a phone before a kick-off. The desks currently pull
two families; matching Gameweek Edge exactly would make it three, one of them a
mono face used only for figures. The system mono stack costs nothing and is
already what every number on the desk is set in.

And swapping the body face across four pages is a visual change nobody asked
for in a pass about colour. `--font-body` now names the role, so the swap is a
one-line change on the day somebody decides it is worth the request.

### `--blue` is a different hue on each side

Gameweek Edge's `--blue` is `#2e6ac2`, measured at 4.68:1 on its `--surface-3`.
This desk's `--info` is `#4f46e5`, an indigo. The name is adopted; the value is
not.

The reason is that this desk's palette is not tuned against one brand green. It
carries four league accents — Premier League, Championship, La Liga and the
combined view — in two themes, and `scripts/check-contrast.mjs` re-measures
every token against every ground it can appear on. Swapping a hue in is a job
that ends in that guard, not in this table, and it buys nothing visible.

### `--text-4`, `--border-3` and the position/confidence scales

Gameweek Edge carries a fourth ink step (`--text-4`, a 3:1 UI bar for marking
*absence* — the "—" glyph, an empty fixture cell) and a third border step. This
desk has three inks and two borders and no rule that wants a fourth of either.
They were not added: an unused token is a token that goes stale.

`--pos-gk` … `--pos-fwd` and `--conf-high` … `--conf-low` are Fantasy Premier
League concepts — a squad position, a projection's confidence. This desk has no
pitch and no projection tiers. Its own confidence meter is a five-pip yellow
rate, which is a different quantity.

### Light is the default there; dark is the default here

`DESIGN.md` says: "Light is the default (it is the brand; the marketing site is
light)." This desk now opens dark, on instruction, and the divergence is
deliberate rather than an oversight.

It is also the honest fit. Gameweek Edge is read at a Friday deadline against a
white marketing site. This one is read in the evening, on a phone, in the hours
before a kick-off. The light toggle is unchanged and the choice persists.

## The theme mechanism, which was worth copying

Gameweek Edge applies the theme "before first paint by a head script, so
neither theme ever flashes", from one key. Both halves of that were missing
here and both are now in place:

- **One key, `bd_theme`.** Each desk had its own, so choosing light and then
  using the league switcher put you back into dark, and the choice had to be
  made four times to stick. An old per-desk key is read once and migrated.
- **Inline in `<head>`, before the stylesheet.** It was applied from the main
  script on all four pages, so every load flashed the default first — and for
  anyone who had chosen light, that was a white-to-dark blink on a page they
  had told to be dark.

`scripts/check-palette.mjs` pins the default, the shared key, the migration and
the boot's position ahead of `assets/tw.css`; `check-eflc` and `check-laliga`
pin that the theme is the *only* key those desks share, because everything else
they store is about players, and the same name in two divisions is two
different people.

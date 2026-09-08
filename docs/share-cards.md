# Share cards, and the combined view

> Moved unchanged from the old README.md on 8 September 2026 ("Share cards, and the combined view"). The README is now an orientation page; this file keeps the full prose.

### Share cards, and the combined view

All three desks now export the same two cards, from one implementation in
`assets/share.js`: **⬇ Share match** on every fixture and **⬇ Share matchday**
for the whole round, ranked by booking heat, each with an acca strip showing the
best double and treble and their fair odds. The desks differ only by a *theme*
(two gradient stops, a strap, a wordmark) and an *adapter* that turns whatever
the desk already priced into what a card draws — so nothing in the renderer
knows how a probability was arrived at, and three cards cannot drift apart the
first time a colour changes.

The Championship and La Liga cards additionally carry the **team card markets**
strip (home/away expected, over 3.5/4.5/5.5, both teams carded) that those desks
show on screen and the Premier League one does not.

**`/today` combines them.** One date, every league that plays on it, ranked by
heat, with a single share card across the lot — and because each leg is a
different match in a different competition, the acca legs there are far closer
to genuinely independent than a same-match combo. The heat numbers are computed
by the same `PLDCore` calls each desk makes, and are verified equal to the
desks' own: a fixture must never carry two prices.

**And the same consolidated list for every date, not one at a time.** The
segmented control at the top switches between a single date and a calendar of
the whole season: all 128 match dates in order, each one a section carrying its
combined cross-league fixture list ranked by heat, its league counts, its total
expected cards, and its own ⬇ share button producing exactly the card the
single-date view would. A dropdown answers *what is on that day*; only seeing
them together answers *which day is worth looking at* — 52 of the 128 dates
carry more than one league, and a checkbox narrows to just those.

It renders all 1,312 fixtures in one pass. They are priced at boot regardless,
so the calendar is a string build over data that already exists; virtualising
it would be machinery guarding a cost nobody pays. Past dates fold away by
default, because mid-season the useful half of the page is ahead of you — at a
January clock the view opens on 48 dates with *Show 80 earlier dates* beside
it. `#all` and `#d=YYYY-MM-DD` deep-link both views, and a date with no matches
falls through to the default rather than rendering an empty page.

**The calendar has its own card too**, alongside the per-date ones. It cannot
list the season — 1,312 fixtures against room for eight rows — so it states the
calendar's shape in a stat band (dates, fixtures, how many carry two leagues,
how many carry all three) and then ranks the hottest individual fixtures, each
stamped with its date and league. It always describes **what is on screen**:
filter to multi-league dates and the card follows, down to 52 dates and 797
matches.

Two things it deliberately does not do, both of them corrections to a first
version that looked fine and said nothing:

- **It does not rank dates.** "The biggest booking day" sounds like the natural
  summary and is really "the day with the most matches scheduled" — per-match
  expectation barely varies across a division, so the eleven 22-match Saturdays
  came out at 77.1, 76.9, 76.9, 76.9, 76.8, 76.8. A top six separated by less
  than half a card in seventy-seven is noise formatted as a ranking. Fixture
  heat has real spread, so fixtures are what get ranked.
- **It does not rank on heat alone.** Taken straight, the top eight were eight
  La Liga fixtures, six of them Sevilla's — which restates two things already
  known (Spain cards more than England, 4.41 a game against 3.71; a
  high-carding club plays 38 times) and tells a reader nothing. The ranking is
  capped at three a league and one a club, and the card says so on its face
  rather than presenting a diversified list as a raw one.

Both caps, and the coverage denominator that keeps eight-of-1,312 from reading
as the whole season, are pinned by `check-share`.

The two date views are two renderings of one set of priced rows, and
`check-share` pins the seams where they could silently diverge — one `rowHTML`, one
`rowsFor` ordering, one `S.roundCard` call site, and a `shareDay` that takes
the date as an **argument**. That last one is the reason the guard exists: a
`shareDay` reading the `#day` dropdown instead would leave all 128 calendar
buttons downloading successfully, each with the wrong day's fixtures on it.
Seven mutations of those assertions were confirmed to fail the guard.

Two implementation notes worth keeping:

- Every dataset declares `const CLUBS` and `const REFS` — right in a file read
  by one desk, fatal in a page that wants two, since a redeclaration is a
  `SyntaxError` and the second file never loads. `/today` loads each league in
  a hidden same-origin iframe (`data-frame.html`), which is a separate global
  scope, so no data file or desk had to change.
- A top-level `const` is a **lexical** binding and never becomes a property of
  the global object, so `frame.contentWindow.CLUBS` is permanently `undefined`.
  The frame publishes an explicit `window.__data` instead. The first attempt
  reported every frame ready and every dataset empty.

`scripts/check-share.mjs` runs the renderer against a stub canvas that records
every draw call and asserts the *text*: that both sides' candidates appear and
are sorted, that the markets match the desk's, that each league keeps a distinct
wordmark and filename slug, that the combined card labels each row's league, and
that **every card carries the 18+ / BeGambleAware line** — which the first
version silently truncated off the end of any card with a long note. Pixel
diffing would have failed on a font substitution and passed on a wrong number.

**All three leagues are on `/today`.** The Premier League needed two things
the others did not. Its fixtures now come from a committed `data/pl_fixtures.js`
(the same API-Football harvest the other two use) rather than only from the live
FPL feed, so a static page can read them. And its pricing — a fitted GLM plus
referee, derby, venue and game-state terms — moved into `assets/plmodel.js`,
which **both the desk and `/today` call**. Verified bit-identical across 40 club
pairings on expected cards, both-teams-carded and over 3.5. The derby list moved
with it: `index.html` now reads `PLModel.DERBIES` instead of keeping its own
copy, because two pages disagreeing about which fixtures are derbies would move
every player's number on those fixtures, on one page only.

What `/today` still cannot know for the Premier League is availability — who is
injured or suspended — which lives in the live feed. Before the season starts
that filter excludes nobody, which is the desk's own state too.

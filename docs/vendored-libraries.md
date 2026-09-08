# Vendored libraries

> Moved unchanged from the old README.md on 8 September 2026 ("Vendored libraries"). The README is now an orientation page; this file keeps the full prose.

## Vendored libraries

Four MIT libraries are inlined into `index.html` so the page fetches nothing third-party to render: **Tabulator 6.3.1** (the screener grid), **jStat 1.9.6** (the Poisson behind every card probability), **simple-statistics 7.8.8** (the backtest's statistics) and **PapaParse 5.4.1** (the CSV import). 574 KB in total, of which Tabulator is 432 KB; roughly 130 KB gzipped on the wire.

Half a megabyte of minified JavaScript pasted into an HTML file is unreviewable by eye — nobody can tell a genuine Tabulator from one with a line changed in the middle. So the embed is **generated and hash-pinned**: `node scripts/vendor-libs.mjs` fetches the pinned versions from npm, strips their source-map comments, wraps each in a licence header and records its SHA-256 in `scripts/vendor-libs.sha256.json`. `node scripts/vendor-libs.mjs --check` runs offline in CI and fails if a single byte of vendored code has moved. Attribution and licence text live in the **Sources & licences** view.

## Addendum, 8 September 2026: the Supabase client

The paragraph above was true of the four libraries and not of the page. One
third-party script remained: `@supabase/supabase-js`, loaded from jsDelivr at a
floating `@2`, for the optional sign-in. It is now the fifth vendored library,
pinned at 2.116.0 and hash-recorded like the others, and the Content-Security-
Policy no longer names a CDN in `script-src`.

It lives as a file, `assets/vendor/supabase.js`, rather than inline: it is
deferred and only needed once somebody signs in, so inlining it would have
added its weight to every render for nothing. `scripts/vendor-libs.mjs` learnt
a `target` for that (and `--only <id>` to re-vendor one library at a time), and
`--check` hashes a file the same way it hashes a block. The package publishes
only an unminified UMD build, 218 KB on disk and 55 KB gzipped, well inside the
150 KB budget the review set; it is vendored as published, because a file
minified here would no longer be bytes anyone can check against upstream. The
service worker precaches it with the other modules.

What still leaves the origin: the two Google Fonts stylesheets, which the CSP
allows for `style-src` and `font-src`. Nothing else.

## Addendum, 8 September 2026: Tabulator is loaded on demand

Tabulator was 432 KB of the 574 KB inlined into `index.html`, and one view of
one panel uses it. Its script block is now `assets/vendor/tabulator.js`, still
hash-pinned by `scripts/vendor-libs.mjs`, and `index.html` fetches it the first
time the Screener opens: a "Loading the grid" state while it arrives, a message
naming the Season risk table if the load fails, and one in-flight request
however many times the tab is tapped. The other views never wait on it. The
service worker precaches the file, so the installed app still opens the
Screener offline; `scripts/check-mobile.mjs` covers the shell. The stylesheet
block stays inline at 28 KB, because a grid that arrives before its stylesheet
paints unstyled for a frame.

Measured with `gzip -9`: `index.html` went from 289,828 bytes gzipped
(1,053,876 raw) to 190,645 bytes gzipped (613,314 raw) on the wire for every
visit, and the Screener pays its 100,078 gzipped bytes once, cached
separately across deploys.

# Vendored libraries

> Moved unchanged from the old README.md on 8 September 2026 ("Vendored libraries"). The README is now an orientation page; this file keeps the full prose.

## Vendored libraries

Four MIT libraries are inlined into `index.html` so the page fetches nothing third-party to render: **Tabulator 6.3.1** (the screener grid), **jStat 1.9.6** (the Poisson behind every card probability), **simple-statistics 7.8.8** (the backtest's statistics) and **PapaParse 5.4.1** (the CSV import). 574 KB in total, of which Tabulator is 432 KB; roughly 130 KB gzipped on the wire.

Half a megabyte of minified JavaScript pasted into an HTML file is unreviewable by eye — nobody can tell a genuine Tabulator from one with a line changed in the middle. So the embed is **generated and hash-pinned**: `node scripts/vendor-libs.mjs` fetches the pinned versions from npm, strips their source-map comments, wraps each in a licence header and records its SHA-256 in `scripts/vendor-libs.sha256.json`. `node scripts/vendor-libs.mjs --check` runs offline in CI and fails if a single byte of vendored code has moved. Attribution and licence text live in the **Sources & licences** view.

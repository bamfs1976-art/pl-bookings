#!/usr/bin/env bash
# Netlify "ignore" rule: decides whether a push gets a production deploy.
# Exit 0 = skip this deploy. Exit 1 (or any error) = build as normal.
#
# WHY: every successful production deploy costs 15 Netlify credits. The
# data workflows commit to main 12-15 times a day, so data refreshes alone
# were running past the Pro plan's 3,000 monthly credits and into $10
# auto top-ups.
#
# RULE: a push that changes only data files deploys if it is the first
# commit in the current time window (6 hours by default, set
# DATA_DEPLOY_WINDOW_HOURS in Netlify to change it). Later data-only pushes
# in the same window are skipped. Their changes go live with the next
# deploy, because each deploy publishes the whole tree.
#
# Always deploys straight away:
#   - any change outside data/ and backtest_report.md (code, pages, config)
#   - team sheets (data/lineups.js), which matter close to kick-off
#   - deploy previews and branch deploys (they cost no credits)
#   - anything this script cannot work out (fails safe to a build)

set -u

WINDOW_HOURS="${DATA_DEPLOY_WINDOW_HOURS:-6}"
DATA_RE='^(data/|backtest_report\.md$)'
ALWAYS_RE='^data/lineups\.js$'

build() { echo "netlify-ignore: BUILD, $1"; exit 1; }
skip()  { echo "netlify-ignore: SKIP, $1"; exit 0; }

[ "${CONTEXT:-}" = "production" ] || build "not a production deploy"

head="${COMMIT_REF:-}"
prev="${CACHED_COMMIT_REF:-}"
[ -n "$head" ] || build "no commit reference"
[ -n "$prev" ] && [ "$prev" != "$head" ] || build "nothing to compare against"
git cat-file -e "${prev}^{commit}" 2>/dev/null || build "previous build commit not in clone"

files="$(git diff --name-only "$prev" "$head" 2>/dev/null)" || build "could not list changed files"
[ -n "$files" ] || build "no file changes (manual redeploy)"

code="$(printf '%s\n' "$files" | grep -vE "$DATA_RE" || true)"
[ -z "$code" ] || build "non-data files changed"

if printf '%s\n' "$files" | grep -qE "$ALWAYS_RE"; then
  build "team sheets changed"
fi

case "$WINDOW_HOURS" in ''|*[!0-9]*|0) build "bad DATA_DEPLOY_WINDOW_HOURS" ;; esac
window=$(( WINDOW_HOURS * 3600 ))
now="$(git log -1 --format=%ct "$head" 2>/dev/null)" || build "could not read commit time"
start=$(( now - now % window ))

git cat-file -e "${head}^" 2>/dev/null || build "parent commit not in clone"
earlier="$(git log -n 200 --format=%ct "${head}^" 2>/dev/null | awk -v s="$start" '$1 >= s' | wc -l)"

[ "$earlier" -gt 0 ] || build "first data update in this ${WINDOW_HOURS}h window"
skip "data-only change, already deployed in this ${WINDOW_HOURS}h window"

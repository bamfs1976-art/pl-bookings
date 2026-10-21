/* RETIRED 21 October 2026. This script drew the old purple, fanned-cards
 * mark. Its source is in git history (before 21 October 2026). The Risk Card logo replaced it, and every icon now comes from the
 * logo kit: favicon.svg, favicon.ico, icons/*.png, icons/brand.svg, logo.svg
 * and og.png are committed artwork. See docs/decisions.md, "Logo (2026-10-21)".
 * Running it would quietly put the old brand back, so it refuses to.
 */
console.error('%s is retired: the Risk Card icons are committed artwork. See docs/decisions.md, "Logo (2026-10-21)".', process.argv[1]);
process.exit(1);

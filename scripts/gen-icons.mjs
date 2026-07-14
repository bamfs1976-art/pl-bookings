/* Bookings Desk — icon/logo artwork generator (pattern shared with
   Gameweek Edge's scripts/gen-art.mjs).

   The app icon and logo carry the fanned red + yellow cards above
   BOOKINGS DESK lettering. favicon.svg keeps the clean cards-only mark —
   at browser-tab size two words would just blur.

   Regenerate with:  node scripts/gen-icons.mjs
   (needs sharp: npm i sharp --no-save)                                */

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const lettered = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs><linearGradient id="bdbg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4a1e6b"/><stop offset="1" stop-color="#23103a"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#bdbg)"/>
  <g transform="translate(512,368) scale(13) translate(-33,-34) translate(33,34)">
    <rect x="-6" y="-17" width="21" height="32" rx="4.5" fill="#e11d48" transform="rotate(16)"/>
    <rect x="-15" y="-16" width="21" height="32" rx="4.5" fill="#f7c600" stroke="#23103a" stroke-width="1.4" transform="rotate(-10)"/>
  </g>
  <text x="512" y="742" text-anchor="middle"
        font-family="Liberation Sans, DejaVu Sans, sans-serif" font-weight="bold"
        font-size="148" letter-spacing="6" fill="#ffffff">BOOKINGS</text>
  <text x="512" y="898" text-anchor="middle"
        font-family="Liberation Sans, DejaVu Sans, sans-serif" font-weight="bold"
        font-size="148" letter-spacing="22" fill="#f7c600">DESK</text>
</svg>`;

/* The standalone logo.svg gets the same lettered composition, kept as a
   crisp vector rather than a raster. */
const logoSvg = `<svg width="256" height="256" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bookings Desk logo">
  <defs><linearGradient id="bdbg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4a1e6b"/><stop offset="1" stop-color="#23103a"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" rx="240" fill="url(#bdbg)"/>
  <g transform="translate(512,368) scale(13)">
    <rect x="-6" y="-17" width="21" height="32" rx="4.5" fill="#e11d48" transform="rotate(16)"/>
    <rect x="-15" y="-16" width="21" height="32" rx="4.5" fill="#f7c600" stroke="#23103a" stroke-width="1.4" transform="rotate(-10)"/>
  </g>
  <text x="512" y="742" text-anchor="middle" font-family="'Liberation Sans','Arial','Helvetica',sans-serif" font-weight="bold" font-size="148" letter-spacing="6" fill="#ffffff">BOOKINGS</text>
  <text x="512" y="898" text-anchor="middle" font-family="'Liberation Sans','Arial','Helvetica',sans-serif" font-weight="bold" font-size="148" letter-spacing="22" fill="#f7c600">DESK</text>
</svg>
`;

const src = Buffer.from(lettered(1024));
await sharp(src).resize(512, 512).png().toFile('icons/icon-512.png');
await sharp(src).resize(192, 192).png().toFile('icons/icon-192.png');
await sharp(src).resize(180, 180).png().toFile('icons/apple-touch-icon.png');
writeFileSync('logo.svg', logoSvg);
console.log('✓ icons + logo.svg regenerated (favicon.svg keeps the plain mark)');

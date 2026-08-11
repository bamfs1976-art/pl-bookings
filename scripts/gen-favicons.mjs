/* The 16 and 32 pixel icons, with no dependencies at all.
 *
 * WHY NOT scripts/gen-icons.mjs. That one renders the full lettered artwork
 * through sharp, which is an `npm i sharp --no-save` away and cannot run on a
 * machine without it — including, at the time of writing, this one. The tab
 * icon is sixteen pixels of flat colour; needing a native image library to
 * produce 256 pixels is absurd. Node ships zlib, a PNG is a header and a
 * deflated bitmap, and the whole encoder is forty lines below.
 *
 * WHY THE ARTWORK IS DIFFERENT AT THIS SIZE, and not simply the 512 scaled
 * down. The full mark is two overlapping cards at opposing angles above two
 * words. At 16px the words are illegible, the second card is three pixels of
 * dirty orange where red meets yellow, and the rounded corners eat the shape.
 * Scaling it produces a smudge that reads as "some app". So this draws the
 * SAME IDEA at a size that can hold it: one upright yellow card with a red
 * edge behind it, on the same purple ground, with the proportions opened out.
 * A 16px icon is a silhouette, and it should be designed as one.
 *
 * Run: node scripts/gen-favicons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- the palette, matching favicon.svg exactly ------------------------- */
const BG_FROM = [0x4a, 0x1e, 0x6b];      /* purple, top-left */
const BG_TO = [0x23, 0x10, 0x3a];        /* deeper, bottom-right */
const RED = [0xe1, 0x1d, 0x48];
const YELLOW = [0xf7, 0xc6, 0x00];

/* ---- a very small PNG encoder ------------------------------------------ */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        /* bit depth */
  ihdr[9] = 6;        /* colour type: RGBA */
  /* 10,11,12 = deflate, adaptive filtering, no interlace — all zero */
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                         /* filter: none */
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- geometry, in a 0..1 square, supersampled --------------------------- */
/* Distance test for a rounded rectangle centred at (cx,cy), rotated by `rot`
   radians. Returns true when the point is inside. */
function inRoundRect(x, y, cx, cy, w, h, r, rot) {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const dx = x - cx, dy = y - cy;
  const px = Math.abs(dx * c - dy * s), py = Math.abs(dx * s + dy * c);
  const hw = w / 2 - r, hh = h / 2 - r;
  if (px <= hw || py <= hh) return px <= w / 2 && py <= h / 2;
  const qx = px - hw, qy = py - hh;
  return qx * qx + qy * qy <= r * r;
}

/* The mark, evaluated at a point. Returns [r,g,b] or null for "outside". */
function markAt(x, y, small) {
  /* Outside the rounded app square: transparent, so the icon is not a hard
     rectangle on a dark tab strip. */
  if (!inRoundRect(x, y, 0.5, 0.5, 1, 1, small ? 0.16 : 0.23, 0)) return null;

  /* The ground: a diagonal gradient, same two stops as favicon.svg. */
  const t = Math.max(0, Math.min(1, (x + y) / 2));
  const bg = [0, 1, 2].map((i) => Math.round(BG_FROM[i] + (BG_TO[i] - BG_FROM[i]) * t));

  if (small) {
    /* SIXTEEN PIXELS. One card, upright, with a red edge showing behind it —
       the idea of the mark rather than a shrunk copy of it. Deliberately
       large in frame: a card that respects the 512's margins would be six
       pixels tall and read as a dot. */
    /* FRONT-MOST FIRST. This returns on the first shape it is inside, so the
       test order IS the z-order — and in the mark the yellow card is in
       front. Testing red first painted it over the yellow and left a
       three-pixel yellow sliver: the wrong card reading as the subject. */
    if (inRoundRect(x, y, 0.42, 0.50, 0.34, 0.58, 0.07, -0.06)) return YELLOW;
    if (inRoundRect(x, y, 0.62, 0.50, 0.26, 0.50, 0.06, 0.16)) return RED;
    return bg;
  }
  /* THIRTY-TWO holds the fan, at a wider angle than the full artwork so the
     two cards still separate. */
  /* Front-most first, exactly as above — the test order is the z-order. */
  if (inRoundRect(x, y, 0.42, 0.50, 0.32, 0.56, 0.06, -0.20)) return YELLOW;
  if (inRoundRect(x, y, 0.62, 0.50, 0.28, 0.54, 0.06, 0.30)) return RED;
  return bg;
}

function render(size) {
  const SS = 4;                                   /* 4×4 supersampling */
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const c = markAt(x, y, size <= 20);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS, i = (py * size + px) * 4;
      /* Premultiplied average over COVERED samples only, so an edge pixel
         takes the colour of the shape rather than being darkened towards
         transparent black. */
      const cov = a / 255;
      buf[i] = cov ? Math.round(r / cov) : 0;
      buf[i + 1] = cov ? Math.round(g / cov) : 0;
      buf[i + 2] = cov ? Math.round(b / cov) : 0;
      buf[i + 3] = Math.round(a / n);
    }
  }
  return png(size, size, buf);
}

for (const size of [16, 32]) {
  const out = join(root, 'icons', `icon-${size}.png`);
  writeFileSync(out, render(size));
  console.log(`✓ icons/icon-${size}.png`);
}
console.log('The 180 / 192 / 512 artwork is the lettered mark and still comes '
  + 'from scripts/gen-icons.mjs (needs sharp).');

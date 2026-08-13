// Generates the VAPID key pair the push alerts need.
//
// Run once, then set the three values as Netlify environment variables:
//
//   node scripts/gen-vapid.mjs
//
//   VAPID_PUBLIC_KEY   → also served to the browser by /api/push-key
//   VAPID_PRIVATE_KEY  → server only. Anyone holding it can send
//                        notifications to every subscriber of this site.
//   VAPID_SUBJECT      → a mailto: or https: URL the push services can use
//                        to contact you about abuse. Required by RFC 8292.
//
// The pair identifies THIS SITE to the push services. Changing it later
// invalidates every existing subscription — browsers will keep the old key
// and their endpoints stop accepting your requests — so generate it once and
// keep it. There is no rotation story short of asking everyone to re-subscribe.
//
// Uses node:crypto only, like netlify/lib/webpush.js. No dependency, no
// package.json, nothing to install.

import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });

const b64u = (b) => Buffer.from(b).toString('base64url');
/* The public key travels as a raw uncompressed point: 0x04 || X || Y. */
const pub = b64u(Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
]));

console.log('VAPID_PUBLIC_KEY=' + pub);
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
console.log('VAPID_SUBJECT=mailto:you@example.com   # change this');
console.log('');
console.log('Set all three in Netlify (Site configuration → Environment variables),');
console.log('then run supabase/plb_push.sql once in the Supabase SQL editor.');
console.log('Until both are done /api/push-key returns 503 and the desk simply');
console.log('does not offer alerts — no broken button, no half-working feature.');

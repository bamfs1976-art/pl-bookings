/* Web Push — VAPID and aes128gcm, on node:crypto alone.
 *
 * WHY NOT THE `web-push` PACKAGE. This repo has no package.json. Every
 * Netlify function here reaches Supabase over its REST API with plain fetch
 * rather than the SDK, and the site deploys with no build step and no
 * install. Adding one dependency would mean adding a lockfile, an install
 * step to the deploy, and a dependency tree to a repo whose whole shape is
 * that it does not have one. Gameweek Edge uses `web-push` because Gameweek
 * Edge already has a package.json for Capacitor; this desk does not.
 *
 * So the two specs are implemented here directly:
 *   RFC 8291  Message Encryption for Web Push   (the payload)
 *   RFC 8188  Encrypted-Content-Encoding        (the aes128gcm framing)
 *   RFC 8292  VAPID                             (the Authorization header)
 *
 * VERIFIED AGAINST THE SPEC'S OWN TEST VECTOR. Hand-rolled crypto is exactly
 * the thing that should not be trusted because it looks right, and an
 * encryption bug here does not throw — it produces a body the push service
 * accepts and the browser silently fails to decrypt, so the symptom is
 * "notifications just don't arrive" with a 201 in the logs. RFC 8291 section
 * 5 publishes a complete worked example: keys, salt, plaintext and the exact
 * expected ciphertext. tests/test-webpush.mjs reproduces it byte for byte.
 * If that test passes, this file is correct; if it fails, nothing else here
 * matters.
 */
'use strict';

const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

/* ── key helpers ───────────────────────────────────────────────────────
   Web Push keys travel as raw uncompressed P-256 points (0x04 || X || Y) and
   raw 32-byte scalars. Node wants KeyObjects, and JWK is the only import
   format that takes the raw values without hand-rolling DER. */
function pubToJwk(raw) {
  const b = unb64u(raw);
  if (b.length !== 65 || b[0] !== 4) throw new Error('public key must be a 65-byte uncompressed P-256 point');
  return { kty: 'EC', crv: 'P-256', x: b64u(b.subarray(1, 33)), y: b64u(b.subarray(33, 65)) };
}
function privToJwk(rawPriv, rawPub) {
  const j = pubToJwk(rawPub);
  const d = unb64u(rawPriv);
  if (d.length !== 32) throw new Error('private key must be 32 bytes');
  return { ...j, d: b64u(d) };
}
function importPub(raw) {
  return crypto.createPublicKey({ key: pubToJwk(raw), format: 'jwk' });
}
function importPriv(rawPriv, rawPub) {
  return crypto.createPrivateKey({ key: privToJwk(rawPriv, rawPub), format: 'jwk' });
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/* HKDF as the push specs use it: one 32-byte-or-less output block, so the
   expand step is a single HMAC with the 0x01 counter appended. */
function hkdf(salt, ikm, info, len) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
}

/* ── RFC 8291 §3.4 / RFC 8188 ──────────────────────────────────────────
   `opts` exists so the test vector can pin the salt and the ephemeral key
   pair. In production both are random per message and MUST be — reusing a
   salt with the same key material leaks plaintext. */
function encrypt(payload, uaPublic, authSecret, opts) {
  const o = opts || {};
  const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const salt = o.salt ? unb64u(o.salt) : crypto.randomBytes(16);

  let asPrivKey, asPubRaw;
  if (o.asPrivate && o.asPublic) {
    asPrivKey = importPriv(o.asPrivate, o.asPublic);
    asPubRaw = unb64u(o.asPublic);
  } else {
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    asPrivKey = kp.privateKey;
    asPubRaw = Buffer.from(kp.publicKey.export({ type: 'spki', format: 'der' }).subarray(-65));
  }

  const uaPubRaw = unb64u(uaPublic);
  const shared = crypto.diffieHellman({ privateKey: asPrivKey, publicKey: importPub(uaPublic) });

  /* The two-stage derivation is the part everyone gets wrong: the auth secret
     is the SALT of the first HKDF and the ECDH output is its IKM, then the
     result becomes the IKM of the second, whose salt is the message salt. */
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'), uaPubRaw, asPubRaw,
  ]);
  const ikm = hkdf(unb64u(authSecret), shared, keyInfo, 32);

  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  /* One record, so the delimiter is 0x02 ("last"). A 0x01 here produces a
     body that decrypts and is then rejected for a missing final record. */
  const padded = Buffer.concat([plaintext, Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = o.recordSize || 4096;
  const header = Buffer.concat([
    salt,
    Buffer.from([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]),
    Buffer.from([asPubRaw.length]),
    asPubRaw,
  ]);
  return Buffer.concat([header, body]);
}

/* ── RFC 8292: the Authorization header ────────────────────────────────
   ES256 over a JWT whose audience is the push service's ORIGIN — not the
   endpoint path. An endpoint in `aud` is the other classic silent failure:
   some services accept it and some reject it, so it works in testing and
   not in production. */
function vapidHeader(endpoint, publicKey, privateKey, subject, nowSec) {
  const aud = new URL(endpoint).origin;
  const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({
    aud,
    exp: now + 12 * 60 * 60,          /* 12h; the spec caps it at 24 */
    sub: subject,
  })));
  const signingInput = Buffer.from(header + '.' + claims, 'utf8');
  const key = importPriv(privateKey, publicKey);
  /* ieee-p1363 gives the raw r||s the JWS spec wants. Node's default is DER,
     which every push service rejects. */
  const sig = crypto.sign('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' });
  return {
    Authorization: 'vapid t=' + header + '.' + claims + '.' + b64u(sig) + ', k=' + publicKey,
  };
}

/* ── one notification ──────────────────────────────────────────────────
   Returns {ok, status}. A 404 or 410 means the subscription is dead and the
   caller should delete it — that is not an error, it is the only way a
   subscription list ever shrinks. */
async function send(sub, payload, vapid, opts) {
  const body = encrypt(payload, sub.keys.p256dh, sub.keys.auth, opts);
  const headers = {
    ...vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String((opts && opts.ttl) || 3600),
    Urgency: (opts && opts.urgency) || 'normal',
  };
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

module.exports = { encrypt, vapidHeader, send, b64u, unb64u };

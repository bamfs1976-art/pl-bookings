/* Web Push crypto, pinned to the specification's own worked example.
 *
 * WHY THIS TEST IS THE WHOLE FEATURE. An encryption bug in netlify/lib/
 * webpush.js does not throw. It produces a body the push service happily
 * accepts with a 201, and the browser then fails to decrypt it and drops the
 * message on the floor without telling anyone. The symptom is "notifications
 * just don't arrive" and the server logs say everything worked. There is no
 * way to notice that in production and no way to debug it from the logs.
 *
 * RFC 8291 section 5 publishes a complete example — both key pairs, the auth
 * secret, the salt, the plaintext and the exact expected ciphertext. Fixing
 * the salt and the ephemeral key makes the whole encryption deterministic, so
 * this reproduces the published body byte for byte. If it passes, the
 * implementation is right. If it fails, nothing built on top of it works.
 *
 * Run: node tests/test-webpush.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wp = require(join(root, 'netlify', 'lib', 'webpush.js'));

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ok - ' + name); }

/* ── RFC 8291 §5, verbatim ─────────────────────────────────────────── */
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6Tlz'
    + 'AC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

console.log('webpush: RFC 8291 §5 test vector');
t('reproduces the published ciphertext byte for byte', () => {
  const out = wp.encrypt(V.plaintext, V.uaPublic, V.authSecret, {
    salt: V.salt, asPrivate: V.asPrivate, asPublic: V.asPublic, recordSize: 4096,
  });
  assert.equal(wp.b64u(out), V.expected);
});
t('the header carries salt, record size and the sender key in that order', () => {
  const out = wp.encrypt(V.plaintext, V.uaPublic, V.authSecret, {
    salt: V.salt, asPrivate: V.asPrivate, asPublic: V.asPublic,
  });
  assert.equal(wp.b64u(out.subarray(0, 16)), V.salt);
  assert.equal(out.readUInt32BE(16), 4096);
  assert.equal(out[20], 65);
  assert.equal(wp.b64u(out.subarray(21, 86)), V.asPublic);
});
t('a real send generates a fresh salt and key every time', () => {
  // Reusing either with the same recipient leaks plaintext, so two calls with
  // no pinned options must not produce the same bytes.
  const a = wp.encrypt('x', V.uaPublic, V.authSecret);
  const b = wp.encrypt('x', V.uaPublic, V.authSecret);
  assert.notEqual(a.toString('hex'), b.toString('hex'));
  assert.notEqual(a.subarray(0, 16).toString('hex'), b.subarray(0, 16).toString('hex'));
});
t('refuses a key that is not a P-256 point rather than encrypting to nothing', () => {
  assert.throws(() => wp.encrypt('x', wp.b64u(Buffer.alloc(65)), V.authSecret), /uncompressed P-256/);
  assert.throws(() => wp.encrypt('x', wp.b64u(Buffer.alloc(10)), V.authSecret), /65-byte/);
});

/* ── RFC 8292 ──────────────────────────────────────────────────────── */
console.log('webpush: VAPID');
const KP = (() => {
  const { generateKeyPairSync } = require('node:crypto');
  const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = kp.privateKey.export({ format: 'jwk' });
  return {
    pub: wp.b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])),
    priv: jwk.d,
  };
})();

/* The advertised key, as a verifier: the 65-byte uncompressed point the header
   publishes in k=, turned back into something node can check a signature with.
   Two tests need it — one to say what encoding the signature is in, one to say
   it is the right signature at all. */
function pubKeyOf(b64uPoint) {
  const { createPublicKey } = require('node:crypto');
  const raw = Buffer.from(b64uPoint, 'base64url');
  return createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
    x: wp.b64u(raw.subarray(1, 33)), y: wp.b64u(raw.subarray(33)) } });
}

t('audience is the push service ORIGIN, never the endpoint', () => {
  // The classic silent failure: some services accept a full endpoint in `aud`
  // and some reject it, so it works in testing and not in production.
  const h = wp.vapidHeader('https://fcm.googleapis.com/fcm/send/abc123', KP.pub, KP.priv, 'mailto:a@b.c');
  const jwt = h.Authorization.match(/t=([^,]+)/)[1];
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:a@b.c');
});
t('the signature is raw r||s, not DER — every push service rejects DER', () => {
  const { verify } = require('node:crypto');
  const h = wp.vapidHeader('https://updates.push.services.mozilla.com/wpush/v2/x', KP.pub, KP.priv, 'mailto:a@b.c');
  const [hdr, claims, s64] = h.Authorization.match(/t=([^,]+)/)[1].split('.');
  const sig = Buffer.from(s64, 'base64url');
  const signed = Buffer.from(hdr + '.' + claims);

  /* Raw r||s is two 32-byte integers and nothing else. DER is a TLV and comes
     out at 70 bytes for P-256. */
  assert.equal(sig.length, 64);

  /* AND IT IS THE ENCODING, not a byte that looks like one. This assertion
     used to read `assert.notEqual(sig[0], 0x30)` — 0x30 being the DER SEQUENCE
     tag. But the first byte of a raw signature is the top byte of r, which is
     uniform over 0..255, so a CORRECT implementation failed that assertion one
     run in 256. It duly did, on main, on 19 August, and the same commit passed
     twice either side of it. A test that fails at random teaches people to
     re-run CI rather than read it.
     So ask node's own parser what these bytes are: they verify as ieee-p1363
     and they do not parse as DER. That is the actual claim, and it does not
     depend on the value of any single byte. */
  const key = pubKeyOf(KP.pub);
  assert.ok(verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, sig),
    'the signature does not verify as raw r||s, so it is not raw r||s');
  assert.equal(verify('sha256', signed, { key, dsaEncoding: 'der' }, sig), false,
    'the signature parses as DER, which every push service rejects');
});
t('the signature verifies against the public key it advertises', () => {
  const { verify } = require('node:crypto');
  const h = wp.vapidHeader('https://example.com/push/1', KP.pub, KP.priv, 'mailto:a@b.c');
  const [hdr, claims, sig] = h.Authorization.match(/t=([^,]+)/)[1].split('.');
  const advertised = h.Authorization.match(/k=(.+)$/)[1];
  assert.equal(advertised, KP.pub);
  const key = pubKeyOf(advertised);
  assert.ok(verify('sha256', Buffer.from(hdr + '.' + claims), { key, dsaEncoding: 'ieee-p1363' },
    Buffer.from(sig, 'base64url')));
});
t('expiry is inside the 24 hours the spec allows', () => {
  const now = 1_700_000_000;
  const h = wp.vapidHeader('https://example.com/p', KP.pub, KP.priv, 'mailto:a@b.c', now);
  const claims = JSON.parse(Buffer.from(h.Authorization.match(/t=([^,]+)/)[1].split('.')[1], 'base64url'));
  assert.ok(claims.exp > now, 'expiry must be in the future');
  assert.ok(claims.exp - now <= 24 * 3600, 'expiry must be within 24h');
});


/* ── the alert logic ───────────────────────────────────────────────────
   Pure functions out of netlify/functions/push-cron.js. Everything here
   guards against one of two opposite failures: never telling anyone, or
   telling everyone about everything every hour. */
const cron = require(join(root, 'netlify', 'functions', 'push-cron.js'));
const FUT = '2099-01-01T15:00:00+00:00';

console.log('appointments: what counts as news');
t('an official appearing where there was none is news', () => {
  const out = cron.appointmentNews({}, [{ id: 1, h: 'CHE', a: 'TOT', ref: 'C Kavanagh', d: FUT, st: 'NS' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].changed, false);
});
t('an official REPLACING another is news, and says so', () => {
  // The case a naive "is ref set?" check misses entirely — and the more
  // urgent of the two, because the reader may already have acted on the old
  // number.
  const out = cron.appointmentNews({ 1: 'A Taylor' }, [{ id: 1, h: 'CHE', a: 'TOT', ref: 'C Kavanagh', d: FUT, st: 'NS' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].changed, true);
  assert.equal(out[0].was, 'A Taylor');
});
t('the same official twice is not news — this is the whole point of the state', () => {
  // Getting this wrong does not fail quietly: it notifies every subscriber
  // about every appointed fixture, every hour, forever.
  assert.deepEqual(cron.appointmentNews({ 1: 'C Kavanagh' },
    [{ id: 1, h: 'CHE', a: 'TOT', ref: 'C Kavanagh', d: FUT, st: 'NS' }]), []);
});
t('an unappointed fixture is not news', () => {
  assert.deepEqual(cron.appointmentNews({}, [{ id: 1, h: 'CHE', a: 'TOT', ref: null, d: FUT, st: 'NS' }]), []);
});
t('a match already under way or finished is a record correction, not an alert', () => {
  const rows = [
    { id: 1, h: 'CHE', a: 'TOT', ref: 'C Kavanagh', d: FUT, st: '1H' },
    { id: 2, h: 'ARS', a: 'COV', ref: 'M Oliver', d: FUT, st: 'FT' },
    { id: 3, h: 'EVE', a: 'CRY', ref: 'P Bankes', d: '2020-01-01T15:00:00+00:00', st: 'NS' },
  ];
  assert.deepEqual(cron.appointmentNews({}, rows), []);
});

console.log('appointments: who hears about it');
const WATCH = ['ARS|Gabriel', 'CHE|Cucurella', 'TOT|Sarr', 'LIV|Gravenberch'];
t('only subscribers with a player in that fixture', () => {
  assert.deepEqual(cron.watchedIn(WATCH, { h: 'CHE', a: 'TOT' }), ['Cucurella', 'Sarr']);
  assert.deepEqual(cron.watchedIn(WATCH, { h: 'EVE', a: 'BOU' }), []);
});
t('an empty or malformed watchlist targets nobody rather than everybody', () => {
  assert.deepEqual(cron.watchedIn([], { h: 'CHE', a: 'TOT' }), []);
  assert.deepEqual(cron.watchedIn(null, { h: 'CHE', a: 'TOT' }), []);
  assert.deepEqual(cron.watchedIn(['CHE', '|x', 42, null], { h: 'CHE', a: 'TOT' }), []);
});
t('a club code is matched whole — CHE must not match a club ending in CHE', () => {
  assert.deepEqual(cron.watchedIn(['MCHE|Someone'], { h: 'CHE', a: 'TOT' }), []);
});

console.log('appointments: the words');
t('names the players, and the rate carries its own comparison', () => {
  const m = cron.alertText({ h: 'CHE', a: 'TOT', ref: 'C Kavanagh', changed: false }, ['Cucurella'], 3.9, 3.7);
  assert.equal(m.title, 'Referee appointed: CHE v TOT');
  assert.match(m.body, /C Kavanagh/);
  assert.match(m.body, /3\.90 cards a game \(strict\)/);
  assert.match(m.body, /affects Cucurella/);
});
t('a lenient official is described as lenient', () => {
  const m = cron.alertText({ h: 'CHE', a: 'TOT', ref: 'X', changed: false }, ['A'], 3.1, 3.7);
  assert.match(m.body, /\(lenient\)/);
});
t('a change says what it replaced', () => {
  const m = cron.alertText({ h: 'CHE', a: 'TOT', ref: 'C Kavanagh', changed: true, was: 'A Taylor' }, ['A'], null, null);
  assert.equal(m.title, 'Referee changed: CHE v TOT');
  assert.match(m.body, /C Kavanagh replaces A Taylor/);
});
t('an unrated official still produces a sentence rather than "undefined"', () => {
  const m = cron.alertText({ h: 'CHE', a: 'TOT', ref: 'New Official', changed: false }, ['A', 'B', 'C'], null, 3.7);
  assert.ok(!/undefined|NaN|null/.test(m.body), m.body);
  assert.match(m.body, /A and 2 others/);
});

/* ── one caution from a ban ────────────────────────────────────────────
   The rule is PLDCore.nextSuspension, not a reimplementation, because the
   part that is easy to get wrong is not the arithmetic — it is that an
   English rung EXPIRES. These pin the behaviour the alert depends on. */
const SCHEME = { kind: 'ladder', cumulative: true, review: 20,
  rungs: [{ at: 5, ban: 1, by: 19 }, { at: 10, ban: 2, by: 32 }, { at: 15, ban: 3, by: null }] };
const TEAMS = { 1: 'ARS', 2: 'CHE' };
const el = (id, yc, team, extra) => Object.assign({ id, yellow_cards: yc, team: team || 1, web_name: 'P' + id, status: 'a' }, extra || {});

console.log('ban watch: who is actually one away');
t('four cautions before the gate is one from a one-match ban', () => {
  const out = cron.banWatch([el(1, 4)], TEAMS, { ARS: 10 }, SCHEME);
  assert.equal(out.length, 1);
  assert.equal(out[0].at, 5);
  assert.equal(out[0].ban, 1);
  assert.equal(out[0].left, 9);          // 19 - 10 matches to avoid it
});
t('THE CASE A `cards === 4` CHECK GETS WRONG: past the gate he is not close', () => {
  // The 5-rung dies at the club's 19th match. After it, four cautions is six
  // away from the 10-rung, not one away from anything — and a naive check
  // would notify about a ban that cannot happen.
  assert.deepEqual(cron.banWatch([el(1, 4)], TEAMS, { ARS: 19 }, SCHEME), []);
  assert.deepEqual(cron.banWatch([el(1, 4)], TEAMS, { ARS: 30 }, SCHEME), []);
});
t('nine before the second gate is one from a TWO-match ban', () => {
  const out = cron.banWatch([el(1, 9)], TEAMS, { ARS: 25 }, SCHEME);
  assert.equal(out[0].at, 10);
  assert.equal(out[0].ban, 2);
  assert.equal(out[0].left, 7);
});
t('fourteen is one from three matches, and that rung has no cut-off', () => {
  const out = cron.banWatch([el(1, 14)], TEAMS, { ARS: 35 }, SCHEME);
  assert.equal(out[0].ban, 3);
  assert.equal(out[0].left, null);
});
t('a player who can no longer be banned by accumulation is off the watch', () => {
  assert.deepEqual(cron.banWatch([el(1, 15)], TEAMS, { ARS: 35 }, SCHEME), []);
});
t('two or more away is not an alert', () => {
  assert.deepEqual(cron.banWatch([el(1, 3), el(2, 0), el(3, 8)], TEAMS, { ARS: 10 }, SCHEME), []);
});
t('a player who has left the club is skipped', () => {
  assert.deepEqual(cron.banWatch([el(1, 4, 1, { status: 'u' })], TEAMS, { ARS: 10 }, SCHEME), []);
});
t('an unknown club is skipped rather than counted against match zero', () => {
  assert.deepEqual(cron.banWatch([el(1, 4, 99)], TEAMS, { ARS: 10 }, SCHEME), []);
});
t('no minutes floor — a fringe player somebody starred still counts', () => {
  // Unlike the on-page strip, which must keep a whole-league ranking readable.
  // Here the subscriber has already made that judgement by starring him.
  const out = cron.banWatch([el(1, 4, 1, { minutes: 12 })], TEAMS, { ARS: 10 }, SCHEME);
  assert.equal(out.length, 1);
});

console.log('ban watch: what counts as news');
t('the same rung twice is not news', () => {
  const now = cron.banWatch([el(1, 4)], TEAMS, { ARS: 10 }, SCHEME);
  assert.deepEqual(cron.banNews({ 1: 5 }, now), []);
});
t('a NEW rung is news again — the state is keyed on the rung, not a flag', () => {
  // He was one from 5, got booked, served the ban, and is now one from 10.
  // A boolean "already told them" would fire once a season and never again.
  const now = cron.banWatch([el(1, 9)], TEAMS, { ARS: 25 }, SCHEME);
  assert.equal(cron.banNews({ 1: 5 }, now).length, 1);
  assert.equal(cron.banNews({ 1: 5 }, now)[0].at, 10);
});
t('nobody seen before is all news', () => {
  const now = cron.banWatch([el(1, 4)], TEAMS, { ARS: 10 }, SCHEME);
  assert.equal(cron.banNews({}, now).length, 1);
});

console.log('ban watch: club match counts');
t('counts finished league matches per club, not gameweeks', () => {
  // They diverge the moment a match is postponed, which is exactly when a
  // gate is about to matter.
  const fx = [
    { finished: true, team_h: 1, team_a: 2 },
    { finished: true, team_h: 2, team_a: 1 },
    { finished: false, team_h: 1, team_a: 2 },
  ];
  assert.deepEqual(cron.playedByClub(fx, TEAMS), { ARS: 2, CHE: 2 });
});
t('an empty or unplayed season is zeros, not undefined', () => {
  assert.deepEqual(cron.playedByClub([], TEAMS), {});
  assert.deepEqual(cron.playedByClub(null, TEAMS), {});
});

console.log('ban watch: the words');
t('says the count, the rung, the cost and how long he has to avoid it', () => {
  const w = cron.banWatch([el(1, 4)], TEAMS, { ARS: 10 }, SCHEME)[0];
  const m = cron.banText(w);
  assert.match(m.title, /is one booking from a ban/);
  assert.match(m.body, /4 of 5 \(ARS\)/);
  assert.match(m.body, /costs 1 match\./);
  assert.match(m.body, /9 matches left before the cut-off/);
});
t('a two-match ban is plural, and the last match before a gate is singular', () => {
  const two = cron.banText(cron.banWatch([el(1, 9)], TEAMS, { ARS: 31 }, SCHEME)[0]);
  assert.match(two.body, /costs 2 matches\./);
  assert.match(two.body, /last match before the cut-off/);
});
t('an uncapped rung says so rather than printing null', () => {
  const m = cron.banText(cron.banWatch([el(1, 14)], TEAMS, { ARS: 35 }, SCHEME)[0]);
  assert.ok(!/null|undefined|NaN/.test(m.body), m.body);
  assert.match(m.body, /no cut-off on this one/);
});


console.log(`\n${passed} tests passed`);

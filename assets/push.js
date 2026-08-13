/* Watchlist alerts — the client half.
 *
 * TWO THINGS THE DESK KNEW AND COULD NOT TELL YOU. Both were already on the
 * page and both are only useful on the day they change:
 *
 *   1. A referee has been appointed. PGMOL name officials about a week out,
 *      and the moment they do, every booking probability in that fixture
 *      moves through the referee factor — the largest multiplier the desk
 *      applies.
 *   2. A player you follow is ONE CAUTION from a ban. The suspension strip
 *      has always shown this; it could only show it to someone looking.
 *
 * WHY THE WATCHLIST TRAVELS WITH THE SUBSCRIPTION. The desk's watchlist is
 * local-first: localStorage, works signed out, deliberately. That leaves the
 * server no way to know who follows whom, so a copy of the keys rides along
 * with the subscription and is re-sent whenever the list changes. It is a
 * list of footballers, not a profile.
 *
 * THE ORDER OF THE PROMPTS IS THE WHOLE DESIGN. A permission prompt that
 * appears unbidden on page load is the single most-blocked dialog on the web,
 * and a browser only gives you one — deny it and the site cannot ask again,
 * ever, from any code. So nothing here runs until a button is pressed, the
 * button explains what the alert is before it asks, and an empty watchlist is
 * refused up front rather than producing a subscription that can never fire.
 */
(function (root) {
  'use strict';

  function b64ToU8(base64) {
    var pad = '='.repeat((4 - (base64.length % 4)) % 4);
    var s = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = root.atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function create(opts) {
    var o = opts || {};
    var watchKeys = o.watchKeys || function () { return []; };
    var watchEls = o.watchEls || function () { return []; };
    var onChange = o.onChange || function () {};
    var api = o.api || '/api';
    var vapid = null, ready = null, syncTimer = null;

    var supported = !!(root.navigator && 'serviceWorker' in root.navigator
      && 'PushManager' in root && root.Notification);

    /* "Can this browser do it" and "is the server set up for it" are different
       questions with the same answer on screen — no button — and both must be
       settled before one is drawn. */
    function configured() {
      if (ready) return ready;
      ready = (!supported ? Promise.resolve(false)
        : fetch(api + '/push-key').then(function (r) {
          if (!r.ok) return false;
          return r.json().then(function (d) { vapid = d && d.key; return !!vapid; });
        }).catch(function () { return false; }));
      return ready;
    }

    function reg() { return root.navigator.serviceWorker.ready; }

    function current() {
      if (!supported) return Promise.resolve(null);
      return reg().then(function (r) { return r.pushManager.getSubscription(); }).catch(function () { return null; });
    }

    function post(path, body) {
      return fetch(api + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    function payload(sub) {
      return {
        subscription: sub.toJSON ? sub.toJSON() : sub,
        watch: watchKeys(),
        els: watchEls(),
        userId: o.userId ? o.userId() : null,
      };
    }

    /* Called on every watchlist change through saveState, so it is debounced:
       starring five players in ten seconds is one update, not five. */
    function sync() {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(function () {
        syncTimer = null;
        current().then(function (sub) { if (sub) post('/push-subscribe', payload(sub)).catch(function () {}); });
      }, 1200);
    }

    function enable() {
      if (!supported) return Promise.resolve({ ok: false, why: 'unsupported' });
      if (!watchKeys().length) return Promise.resolve({ ok: false, why: 'empty' });
      return configured().then(function (okCfg) {
        if (!okCfg) return { ok: false, why: 'unconfigured' };
        /* Ask the browser only now — after the reader has pressed a button
           whose label says what will happen. */
        return root.Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') return { ok: false, why: perm === 'denied' ? 'denied' : 'dismissed' };
          return reg().then(function (r) {
            return r.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: b64ToU8(vapid),
            });
          }).then(function (sub) {
            return post('/push-subscribe', payload(sub)).then(function (res) {
              if (!res.ok) throw new Error('save failed');
              return { ok: true };
            });
          }).catch(function () { return { ok: false, why: 'failed' }; });
        });
      }).then(function (r) { onChange(); return r; });
    }

    function disable() {
      return current().then(function (sub) {
        if (!sub) return { ok: true };
        var endpoint = sub.endpoint;
        /* Unsubscribe locally FIRST. If the row delete fails the browser is
           already detached, so the worst case is an orphan row the sender
           prunes on its next 410 — the reverse order can leave a browser
           still receiving notifications it has been told it is not. */
        return sub.unsubscribe().then(function () {
          return post('/push-unsubscribe', { endpoint: endpoint }).catch(function () {});
        }).then(function () { return { ok: true }; });
      }).then(function (r) { onChange(); return r; });
    }

    return {
      supported: function () { return supported; },
      configured: configured,
      current: current,
      enable: enable,
      disable: disable,
      sync: sync,
      /* Permission is browser state, not ours — 'denied' cannot be undone
         from a page and the UI has to say so rather than offering a button
         that silently does nothing. */
      permission: function () { return supported ? root.Notification.permission : 'unsupported'; },
    };
  }

  var api = { create: create, b64ToU8: b64ToU8 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PLDPush = api;
})(typeof window !== 'undefined' ? window : globalThis);

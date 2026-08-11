/* Lineup confirmation — the standing rule, made visible.
 *
 * THE RULE THIS EXISTS FOR: no pick before confirmed lineups. Every desk
 * priced a fixture identically on a Tuesday and an hour before kick-off, and
 * nothing on screen said which of the two you were looking at. A player who
 * turns out to be rested prices exactly like one who is starting, because the
 * model has no way to know and the page never asked.
 *
 * So this is not a prediction and it is not fetched from anywhere. It is the
 * reader's own mark: "I have seen the team sheet for this fixture." Default
 * UNCONFIRMED, because the honest default for a thing nobody has checked is
 * that nobody has checked it.
 *
 * WHY IT TRAVELS ON THE SHARE CARD. A card that leaves the site is read by
 * people who cannot see this page, and a probability posted without the
 * caveat it was computed under is a stronger claim than the desk can support.
 * An unconfirmed card says so on its face.
 *
 * STORAGE. Wrapped, with an in-memory fallback — a Safari private window
 * throws on localStorage.setItem, and the desks' existing `try {} catch {}`
 * blocks swallow that and silently forget every mark the moment it is made.
 * Here a failed write still works for the session and says so once.
 */
(function (root) {
  'use strict';

  /* Confirmations are per fixture and fixtures do not recur, so entries only
     ever accumulate. Each is stamped and anything older than this is dropped
     on load — a season of dead ids is not worth carrying, and a stale mark on
     a re-used id would be worse than no mark. */
  var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function create(opts) {
    var o = opts || {};
    var key = o.key || 'pld_lineups_v1';
    var mem = {};                 /* the fallback, and the working copy */
    var persists = true;
    var warned = false;

    function load() {
      var raw = null;
      try { raw = root.localStorage.getItem(key); }
      catch (e) { persists = false; return; }
      if (!raw) return;
      var parsed;
      try { parsed = JSON.parse(raw); } catch (e) { return; }   /* corrupt → start clean */
      if (!parsed || typeof parsed !== 'object') return;
      var now = Date.now(), kept = {};
      for (var k in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue;
        var at = Number(parsed[k]);
        if (isFinite(at) && now - at < MAX_AGE_MS) kept[k] = at;
      }
      mem = kept;
    }

    function save() {
      if (!persists) return false;
      try {
        root.localStorage.setItem(key, JSON.stringify(mem));
        return true;
      } catch (e) {
        /* Quota, private mode, storage disabled. The mark still holds for this
           session; it simply will not survive a reload, and saying so once is
           better than a control that quietly forgets. */
        persists = false;
        if (!warned && root.console && root.console.warn) {
          warned = true;
          root.console.warn('Lineup marks cannot be saved in this browser — they will last for this visit only.');
        }
        return false;
      }
    }

    load();

    var api = {
      /* True only if this fixture has been explicitly marked. */
      isConfirmed: function (id) {
        return Object.prototype.hasOwnProperty.call(mem, String(id));
      },
      set: function (id, on) {
        var k = String(id);
        if (on) mem[k] = Date.now(); else delete mem[k];
        save();
        return api.isConfirmed(k);
      },
      toggle: function (id) { return api.set(id, !api.isConfirmed(id)); },
      /* Whether marks survive a reload. Surfaced so a desk can say so rather
         than let the reader assume. */
      persists: function () { return persists; },
      count: function () { return Object.keys(mem).length; },
      clear: function () { mem = {}; save(); },

      /* The control. A button, not a checkbox: it is an action with a state,
         and aria-pressed carries that state to a screen reader — which a
         coloured pill on its own does not. */
      control: function (id) {
        var on = api.isConfirmed(id);
        return '<button type="button" class="lineup-btn' + (on ? ' on' : '') + '"'
          + ' data-lineup="' + esc(id) + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
          + ' title="' + (on
            ? 'Lineups confirmed for this fixture. Click to unset.'
            : 'Lineups NOT confirmed. Prices assume expected minutes. Click when you have seen the team sheet.')
          + '">' + (on ? '✓ Lineups confirmed' : 'Lineups unconfirmed') + '</button>';
      },

      /* The same fact in one word, for a share card or a dense row. */
      tag: function (id) {
        return api.isConfirmed(id) ? '' :
          '<span class="pill lineup-pill" title="No team sheet seen — prices assume expected minutes">unconfirmed</span>';
      },

      /* Delegated on the host, because both fixture grids are redrawn by
         innerHTML on every change and per-button listeners would not survive
         it. The same lesson the share buttons taught. */
      wire: function (host, onChange) {
        if (!host || host._lineupWired) return;
        host._lineupWired = true;
        host.addEventListener('click', function (e) {
          var b = e.target.closest && e.target.closest('[data-lineup]');
          if (!b) return;
          api.toggle(b.getAttribute('data-lineup'));
          if (typeof onChange === 'function') onChange();
        });
      }
    };
    return api;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  root.PLDLineup = { create: create, MAX_AGE_MS: MAX_AGE_MS };
}(typeof window !== 'undefined' ? window : globalThis));

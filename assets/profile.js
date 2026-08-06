/* Club crests that degrade, and a player record you can open by tapping.
 *
 * SHARED, not copied. The Championship and La Liga desks are structurally
 * identical, and every previous "port it across" in this repo has ended with
 * two copies drifting — the head-to-head builder, the club-name tables, and
 * most recently the Matchday styles, which reached one desk's stylesheet and
 * neither of the others'. So the presentation lives here once and each desk
 * passes in a plain record. League logic stays on the desk; nothing in this
 * file knows what a Championship is.
 *
 * WHY THE CREST HELPER IS HERE TOO. Both desks emitted a bare <img> with no
 * error handling, so when the crest host does not answer you get the browser's
 * broken-image glyph next to every club — reported from an iPad, and visible
 * in this repo's own sandbox, where the image hosts are blocked outright. The
 * Premier League desk has handled this since it was written: official badge,
 * fall back to the baked URL, then a solid club-coloured chip. These desks
 * have one URL each, so this is the last step of that ladder — a monogram
 * chip, which is a deliberate design, not a failure state.
 */
(function (root) {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* A stable colour per club, derived from the short code so it never moves
     between renders or releases. Hue only: fixed saturation and lightness keep
     every chip legible against white text in both themes, which picking from a
     palette by index would not. */
  function clubHue(short) {
    var s = String(short || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function monogram(short) {
    return String(short || '?').slice(0, 3).toUpperCase();
  }

  /* The crest, with the fallback baked in. No inline onerror handler: these
     desks run their code inside a closure, so an inline attribute could not
     see the function anyway, and a delegated listener needs no CSP allowance
     for inline script. `error` does not bubble, hence capture. */
  function crest(club, cls) {
    var short = (club && club.short) || '';
    var name = (club && club.name) || short;
    var style = 'background:hsl(' + clubHue(short) + ' 55% 42%)';
    var mono = monogram(short);
    if (!club || !club.img) {
      return '<span class="crest crest-chip ' + (cls || '') + '" style="' + style + '" '
        + 'title="' + esc(name) + '" aria-hidden="true">' + esc(mono) + '</span>';
    }
    return '<span class="crest crest-wrap ' + (cls || '') + '" style="' + style + '" '
      + 'data-mono="' + esc(mono) + '" title="' + esc(name) + '">'
      + '<img class="crest-img" src="' + esc(club.img) + '" alt="" loading="lazy" decoding="async">'
      + '</span>';
  }

  var wired = false;
  function wireCrests() {
    if (wired) return;
    wired = true;
    document.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || img.tagName !== 'IMG' || img.className.indexOf('crest-img') < 0) return;
      var wrap = img.parentNode;
      /* The chip is the wrapper itself: drop the broken <img> and let the
         monogram in ::after show through. Removing the node rather than hiding
         it also stops Safari re-firing error on a retry. */
      if (wrap && wrap.classList) wrap.classList.add('crest-failed');
      if (img.remove) img.remove();
    }, true);
  }

  /* ---- the player record ------------------------------------------------ */

  var dlg = null;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'pp-dlg';
    dlg.setAttribute('aria-labelledby', 'pp-title');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      /* Click outside the panel closes. The dialog element fills the viewport,
         so a click landing on the backdrop has the dialog itself as target. */
      if (e.target === dlg) dlg.close();
    });
    return dlg;
  }

  function cell(label, value, note, colour) {
    return '<div class="pp-cell">'
      + '<div class="pp-lab">' + esc(label) + '</div>'
      + '<div class="pp-val"' + (colour ? ' style="color:' + colour + '"' : '') + '>'
      + esc(value) + '</div>'
      + (note ? '<div class="pp-note">' + esc(note) + '</div>' : '')
      + '</div>';
  }

  var n2 = function (v) { return v == null ? '—' : Number(v).toFixed(2); };

  /* rec is a plain object the desk assembles. Every field is optional except
     name — a record that cannot be built is better shown thin than not at all,
     because "why is this player rated 34%?" is the question it exists for. */
  function open(rec) {
    if (!rec || !rec.name) return;
    var d = ensureDialog();
    var club = rec.club || {};
    var b = rec.band || {};

    var head = '<div class="pp-head">'
      + crest(club, 'pp-crest')
      + '<div class="pp-id">'
      + '<h2 id="pp-title">' + esc(rec.name) + '</h2>'
      + '<p>' + esc(club.name || club.short || '') + (rec.pos ? ' · ' + esc(rec.pos) : '')
      + (rec.lowSample ? ' · <span class="pp-warn">low sample</span>' : '') + '</p>'
      + '</div>'
      + '<button class="pp-star" type="button" data-pp-watch aria-pressed="'
      + (rec.watched ? 'true' : 'false') + '" title="'
      + (rec.watched ? 'Remove from watchlist' : 'Add to watchlist') + '">'
      + (rec.watched ? '★' : '☆') + '</button>'
      + '<button class="pp-close" type="button" data-pp-close aria-label="Close">×</button>'
      + '</div>';

    var grid = '<div class="pp-grid">'
      + cell('Chance of a card', rec.prob == null ? '—' : Math.round(rec.prob * 100) + '%',
          b.label || (rec.ref ? 'with ' + rec.ref : 'season-long'), b.colour)
      + cell('Fair odds', rec.odds == null ? '—' : n2(rec.odds), 'no margin')
      + cell('Risk', n2(rec.risk), 'yc/90 ×2 + fouls/90')
      + cell('Minutes', rec.minutes == null ? '—' : rec.minutes,
          rec.lowSample ? 'below 450' : 'league season')
      + cell('Yellows', rec.yellows == null ? '—' : rec.yellows,
          rec.reds ? rec.reds + ' red' + (rec.reds === 1 ? '' : 's') : 'no reds')
      + cell('Yellows / 90', n2(rec.yc90), 'per full match')
      + cell('Fouls / 90', n2(rec.fouls90), 'conceded')
      + cell('Recent fouls / 90', n2(rec.foulsForm),
          rec.foulsForm == null ? 'awaiting refresh'
            : rec.fouls90 == null ? ''
            : rec.foulsForm > rec.fouls90 ? 'trending up' : 'trending down')
      + '</div>';

    var extra = '';
    if (rec.susp) {
      extra += '<p class="pp-line' + (rec.susp.urgent ? ' pp-urgent' : '') + '">'
        + esc(rec.susp.text) + '</p>';
    }
    if (rec.fixture) {
      var f = rec.fixture;
      extra += '<div class="pp-fx">'
        + '<div class="pp-lab">Next fixture</div>'
        + '<div class="pp-fxline">'
        + crest(f.home, 'pp-crest-sm') + ' ' + esc((f.home && f.home.short) || '')
        + ' <span class="faint">v</span> '
        + crest(f.away, 'pp-crest-sm') + ' ' + esc((f.away && f.away.short) || '')
        + (f.heat == null ? '' : ' <span class="pp-heat">' + esc(Number(f.heat).toFixed(1)) + '</span>')
        + (f.derby ? ' <span class="pp-derby">DERBY</span>' : '')
        + '</div>'
        + '<div class="pp-note">' + esc(f.when || 'Kick-off TBC')
        + (f.ref ? ' · ' + esc(f.ref) : ' · referee not appointed') + '</div>'
        + '</div>';
    }
    if (rec.note) extra += '<p class="pp-foot">' + esc(rec.note) + '</p>';

    d.innerHTML = '<div class="pp-panel">' + head + grid + extra + '</div>';

    var star = d.querySelector('[data-pp-watch]');
    if (star && rec.onWatch) {
      star.addEventListener('click', function () {
        var now = rec.onWatch();
        star.setAttribute('aria-pressed', now ? 'true' : 'false');
        star.textContent = now ? '★' : '☆';
      });
    }
    var x = d.querySelector('[data-pp-close]');
    if (x) x.addEventListener('click', function () { d.close(); });

    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    /* Focus the close button, not the star: the star MUTATES on activation, and
       a screen reader landing on it reads a control that changes what it says
       the moment it is used. */
    if (x) x.focus();
  }

  root.PLDProfile = { crest: crest, wire: wireCrests, open: open, clubHue: clubHue };
})(typeof window !== 'undefined' ? window : this);

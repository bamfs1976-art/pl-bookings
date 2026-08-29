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


  /* ---- calendar export ---------------------------------------------------
   * The Premier League desk has offered "Add to calendar" on a fixture since
   * it was written. Built here rather than on each desk so the two cannot
   * disagree about what a reminder says — and CRLF line endings, because
   * RFC 5545 requires them and Outlook is the one that actually enforces it.
   */
  function icsEscape(v) {
    return String(v == null ? '' : v).replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
  }
  function icsStamp(d) {
    return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function fixtureIcs(rec) {
    var f = rec && rec.fixture;
    if (!f || !f.iso) return null;
    var start = new Date(f.iso);
    if (isNaN(start)) return null;
    /* 115 minutes: 90 plus half time plus stoppage. A 90-minute event ends
       before the cards that matter most tend to arrive. */
    var end = new Date(start.getTime() + 115 * 60000);
    var home = (f.home && f.home.name) || (f.home && f.home.short) || '';
    var away = (f.away && f.away.name) || (f.away && f.away.short) || '';
    var bits = [];
    if (f.heat != null) bits.push('Booking heat ' + Number(f.heat).toFixed(1));
    bits.push(rec.name + (rec.prob != null ? ' \u2014 ' + Math.round(rec.prob * 100) + '% for a card' : ''));
    if (f.ref) bits.push('Referee ' + f.ref);
    if (f.derby) bits.push('Derby');
    bits.push('Via Bookings Desk \u2014 18+, research not betting advice.');
    var uid = 'pld-' + String(f.iso).replace(/\W/g, '') + '-'
      + String(rec.name).replace(/\W/g, '').slice(0, 12) + '@bookings-desk';
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bookings Desk//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:' + uid,
      'DTSTAMP:' + icsStamp(Date.now()), 'DTSTART:' + icsStamp(start), 'DTEND:' + icsStamp(end),
      'SUMMARY:' + icsEscape(home + ' v ' + away),
      'DESCRIPTION:' + icsEscape(bits.join(' \u00b7 ')),
      'BEGIN:VALARM', 'TRIGGER:-PT60M', 'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(home + ' v ' + away + ' kicks off in an hour'),
      'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
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

  /* The player's face, on exactly the crest's fallback machinery — same
     wrapper, same class, same capture listener, same data-mono ::after. A
     photograph fails the same way a badge does (host down, CSP, 404), and a
     second mechanism for the same failure is a second thing to get wrong.
     Initials rather than a club short here: it is a person, not a club. */
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /* `cls` for the same reason crest() takes one: the dialog head wants a 34px
     portrait and the most-booked tables want a 22px one, and the alternative
     was a second face builder — which is how the leaderboards would come to
     draw a monogram in a case the player card draws a photograph. */
  function avatar(rec, cls) {
    var mono = initials(rec.name);
    var style = 'background:hsl(' + clubHue((rec.club && rec.club.short) || rec.name) + ' 45% 38%)';
    if (!rec.photo) {
      return '<span class="crest crest-chip pp-avatar ' + (cls || '') + '" style="' + style
        + '" title="' + esc(rec.name || '') + '" aria-hidden="true">' + esc(mono) + '</span>';
    }
    return '<span class="crest crest-wrap pp-avatar ' + (cls || '') + '" style="' + style
      + '" data-mono="' + esc(mono) + '" title="' + esc(rec.name || '') + '">'
      + '<img class="crest-img" src="' + esc(rec.photo) + '" alt="" '
      + 'loading="lazy" decoding="async">'
      + '</span>';
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

    /* Availability is shown ONLY when the feed said something. An absent flag
       is "not known", and rendering that as "fit" would be inventing news
       about a player's body from a missing field. */
    var avail = rec.injured === true
      ? ' · <span class="pp-out">doubt</span>'
      : '';

    var head = '<div class="pp-head">'
      + avatar(rec)
      + '<div class="pp-id">'
      + '<h2 id="pp-title">' + esc(rec.name) + '</h2>'
      + '<p>' + crest(club, 'pp-crest-sm') + ' '
      + esc(club.name || club.short || '') + (rec.pos ? ' · ' + esc(rec.pos) : '')
      + (rec.lowSample ? ' · <span class="pp-warn">low sample</span>' : '') + avail + '</p>'
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
      /* FOULS WON, under its own name.
       *
       * This cell said "Recent fouls / 90" and captioned it "trending up" or
       * "trending down" against fouls conceded — and both sibling desks were
       * passing p.fw, which is fouls DRAWN. So a Championship midfielder who
       * wins 2.0 fouls a game and commits 1.0 read as a player whose fouling
       * was trending up. Wrong metric, wrong label, and a comparison between
       * two quantities that have no trend relationship at all.
       *
       * Renamed on the record too: `foulsForm` is the name that invited it. */
      + cell('Fouls won / 90', n2(rec.foulsWon90),
          rec.foulsWon90 == null ? 'awaiting refresh'
            : rec.fouls90 == null || !(rec.fouls90 > 0) ? 'drawn'
            /* Sinned against, or sinning. The ratio is the reason to carry
               both numbers: a player who wins more than he gives away is a
               different proposition to a referee than one who does not. */
            : (rec.foulsWon90 / rec.fouls90).toFixed(2) + '× fouls conceded')
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
        + (f.iso ? '<button class="btn pp-ics" type="button" data-pp-ics>'
            + '\ud83d\udcc5 Add to calendar</button>' : '')
        + '</div>';
    }
    /* THE MATCH FORECAST — expected fouls and the over-lines.
     *
     * The Premier League desk has carried this on its own profile since the
     * Negative-Binomial foul model went in; the Championship and La Liga had
     * the same shared maths available in PLDCore and rendered none of it, so
     * two desks showed a foul RATE and the third showed what the rate implies
     * for a match. Rendered here rather than three times, and only when the
     * desk hands over a forecast — a page with no model shows nothing rather
     * than a row of dashes.
     *
     * The two-stage card figure is a CROSS-CHECK, not a second price: it comes
     * from fouls x the league hazard, where the headline probability comes
     * from the player's own card rate. Two routes to one number, and their
     * disagreement is the point — a big gap means the player's cards and his
     * fouls tell different stories. */
    if (rec.forecast) {
      var fc = rec.forecast;
      extra += '<div class="pp-fc">'
        + '<div class="pp-lab">Match forecast · full 90</div>'
        + '<div class="pp-fcline">Expected fouls <b class="num">'
        + (fc.expFouls == null ? '—' : Number(fc.expFouls).toFixed(1)) + '</b>'
        + (fc.over1 == null ? '' : ' · over 1.5 <b class="num">'
            + Math.round(fc.over1 * 100) + '%</b>')
        + (fc.over2 == null ? '' : ' · over 2.5 <b class="num">'
            + Math.round(fc.over2 * 100) + '%</b>')
        + '</div>'
        + (fc.wonExp == null ? '' : '<div class="pp-fcline">Expected fouls won <b class="num">'
            + Number(fc.wonExp).toFixed(1) + '</b>'
            + (fc.wonOver1 == null ? '' : ' · over 1.5 <b class="num">'
                + Math.round(fc.wonOver1 * 100) + '%</b>')
            + (fc.wonOver2 == null ? '' : ' · over 2.5 <b class="num">'
                + Math.round(fc.wonOver2 * 100) + '%</b>')
            + '</div>')
        + (fc.twoStage == null ? '' : '<div class="pp-note">Two-stage card check '
            + '(fouls → card): <b class="num">' + Math.round(fc.twoStage * 100)
            + '%</b>' + (rec.prob == null ? '' : ' vs model <b class="num">'
            + Math.round(rec.prob * 100) + '%</b>') + '. Referee scaling is '
            + 'applied per fixture.</div>')
        + '</div>';
    }
    /* A note you write about a player, kept in this browser beside the
       watchlist. Shown only when the desk supplies a handler, so a page with
       nowhere to store one does not offer a box that forgets. */
    if (rec.onNote) {
      extra += '<div class="pp-notes">'
        + '<label class="pp-lab" for="pp-note">Your note</label>'
        + '<textarea id="pp-note" class="note-input" rows="2" '
        + 'placeholder="Why you are watching him\u2026">' + esc(rec.noteText || '') + '</textarea>'
        + '<div class="pp-note" id="pp-note-said" aria-live="polite"></div>'
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

    var ta = d.querySelector('#pp-note');
    if (ta && rec.onNote) {
      var said = d.querySelector('#pp-note-said'), timer = null;
      ta.addEventListener('input', function () {
        /* Debounced, not per keystroke: localStorage writes are synchronous
           and this runs on the main thread. */
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          rec.onNote(ta.value);
          if (said) {
            said.textContent = ta.value.trim() ? 'Saved' : 'Cleared';
            setTimeout(function () { if (said) said.textContent = ''; }, 1600);
          }
        }, 400);
      });
    }

    var ics = d.querySelector('[data-pp-ics]');
    if (ics) {
      ics.addEventListener('click', function () {
        var text = fixtureIcs(rec);
        if (!text) { ics.textContent = 'No kick-off time yet'; return; }
        var blob = new Blob([text], { type: 'text/calendar' });
        var file = (rec.name + '-' + ((rec.fixture.home || {}).short || '') + '-'
          + ((rec.fixture.away || {}).short || '')).replace(/[^a-z0-9]+/gi, '-')
          .toLowerCase().replace(/^-|-$/g, '') + '.ics';
        /* Through PLDSave where the page has it: iOS Safari ignores `download`
           on a blob URL, so a plain anchor silently does nothing there — the
           bug that made every share button on this site dead on a phone. */
        if (root.PLDSave && root.PLDSave.file) {
          root.PLDSave.file(blob, file, 'text/calendar').then(function (r) {
            ics.textContent = r === 'cancelled'
              ? '\ud83d\udcc5 Add to calendar' : '\u2713 Calendar file ready';
          });
        } else {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = file; a.click();
        }
      });
    }

    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    /* Focus the close button, not the star: the star MUTATES on activation, and
       a screen reader landing on it reads a control that changes what it says
       the moment it is used. */
    if (x) x.focus();
  }

  root.PLDProfile = { crest: crest, face: avatar, wire: wireCrests, open: open,
                      clubHue: clubHue };
})(typeof window !== 'undefined' ? window : this);

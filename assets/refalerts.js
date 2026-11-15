/* Referee alerts for a desk's starred players: the sign-up card.
 *
 * The Premier League desk has had appointment alerts since push went in. The
 * other three desks let you star players and could not tell you anything
 * about them. This is that half, shared by the three so it is written once.
 *
 * HOW IT FITS THE EXISTING ALERTS. One browser has one push subscription and
 * the server keeps one starred list for it. Each desk's stars travel with a
 * league prefix ("EFLC:BUR|J. Laurent"), and the server replaces only that
 * league's keys (PLDCore.mergeWatch), so turning alerts on here never touches
 * the stars another desk sent.
 *
 * THE PROMPT WAITS FOR A BUTTON, as on the Premier League desk: a permission
 * prompt on page load is the most-blocked dialog on the web, and a browser
 * gives a site one chance to ask.
 */
(function (root) {
  'use strict';

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function mount(opts) {
    var o = opts || {};
    var host = o.el;
    if (!host || !root.PLDPush || !root.PLDCore) return { sync: function () {}, render: function () {} };
    var keys = function () {
      return (o.keys ? o.keys() : []).map(function (k) { return root.PLDCore.watchKeyFor(o.league, k); });
    };
    var push = root.PLDPush.create({ league: o.league, watchKeys: keys, onChange: function () { render(); } });

    function card(title, text, button) {
      host.innerHTML = '';
      var box = el('div', { class: 'pushcard' });
      var body = el('div', { style: 'flex:1;min-width:0' });
      body.appendChild(el('b', null, title));
      text.forEach(function (t) {
        body.appendChild(el('p', { class: 'faint', style: 'margin:.25rem 0 0;font-size:12.5px;line-height:1.45' }, t));
      });
      box.appendChild(body);
      if (button) box.appendChild(button);
      host.appendChild(box);
      host.hidden = false;
    }

    function render() {
      var n = keys().length;
      if (!push.supported() || !n) { host.hidden = true; host.innerHTML = ''; return; }
      push.configured().then(function (ok) {
        if (!ok) { host.hidden = true; host.innerHTML = ''; return; }
        if (push.permission() === 'denied') {
          card('Referee alerts are blocked', ['This browser has notifications turned off for the desk. '
            + 'Only the browser’s own site settings can change that; a page is not allowed to ask again.']);
          return;
        }
        push.current().then(function (sub) {
          var on = !!sub;
          var who = n + ' starred player' + (n === 1 ? '' : 's');
          var text = [on
            ? 'On for your ' + who + ' on this desk. When a referee is named for one of their fixtures, '
              + 'you get the official’s yellow cards a game beside the league figure. The list follows your stars.'
            : 'Get a notification when a referee is named for a fixture involving your ' + who
              + ', with the official’s yellow cards a game beside the league figure. Nothing else.'];
          text.push('Stored with this browser only. No account. On an iPhone, add the site to your Home Screen first.');
          if (o.caveat) text.push(o.caveat);
          text.push('18+ research, not advice.');
          var btn = el('button', { class: 'btn' + (on ? '' : ' btn-primary'), type: 'button', style: 'flex:none' },
            on ? 'Turn off' : 'Turn on');
          btn.addEventListener('click', function () {
            btn.disabled = true; btn.textContent = on ? 'Turning off…' : 'Asking…';
            (on ? push.disable() : push.enable()).then(function (r) {
              if (!r.ok && r.why && r.why !== 'dismissed' && o.toast) {
                o.toast(r.why === 'denied' ? 'Notifications were blocked for this site.'
                  : r.why === 'empty' ? 'Star a player first. Alerts follow your stars.'
                    : r.why === 'unconfigured' ? 'Alerts are not switched on for this site yet.'
                      : 'Could not set that up just now. Try again in a moment.');
              } else if (r.ok && !on && o.toast) {
                o.toast('Referee alerts on for your starred players.');
              }
              render();
            });
          });
          card(on ? 'Referee alerts are on' : 'Referee alerts for your starred players', text, btn);
        });
      });
    }

    render();
    /* Called after every star or unstar: re-sends this league's list to an
       existing subscription (debounced inside PLDPush) and redraws the card. */
    function sync() { push.sync(); render(); }
    return { sync: sync, render: render };
  }

  root.PLDRefAlerts = { mount: mount };
})(typeof window !== 'undefined' ? window : this);

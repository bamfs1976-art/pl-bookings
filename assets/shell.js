/* The app shell, for the desks that did not have one.
 *
 * The Premier League desk navigates with a sidebar of AREAS, a breadcrumb in
 * the topbar, and — on a phone — a fixed bottom tab bar. The Championship and
 * La Liga desks navigated with a single underlined strip of five tabs. Same
 * data, same model, same numbers, and they felt like different products,
 * because the navigation differs before you read anything.
 *
 * This builds the missing chrome at RUNTIME and reparents the page into it,
 * rather than asking each desk to carry another 150 lines of markup. The two
 * pages stay readable and cannot drift apart, which is the same reason the
 * league switcher's styles live in tw.css rather than in three copies.
 *
 * AREAS vs PANELS. An area is a place in the app; a panel is a view inside it.
 * "Desk" is one area holding Players, Clubs and Referees, and those three stay
 * on the existing tab strip — which is exactly what the Premier League desk
 * does, and why its sidebar stopped expanding Desk into a sub-list. The strip
 * shows only the panels belonging to the current area, and hides itself
 * entirely for areas that hold a single panel.
 */
(function (root) {
  'use strict';

  var ICONS = {
    matchday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    desk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>',
    fixtures: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2.4"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    guide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15"/></svg>'
  };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /*
   * cfg = {
   *   code, name, tag, accent   identity for the sidebar brand
   *   areas: [{id, label, icon, panels:[{id, label}]}]
   *   onArea(areaId)            optional, fired after a switch
   * }
   */
  function build(cfg) {
    var areas = cfg.areas || [];
    var header = document.querySelector('header.topbar');
    var bar = document.querySelector('nav.leaguebar');
    var main = document.querySelector('main.wrap');
    if (!header || !main) return null;

    /* ---- chrome -------------------------------------------------------- */
    var shell = el('div', 'as-shell');
    var side = el('aside', 'as-sidebar');
    side.id = 'asSidebar';
    side.setAttribute('aria-label', 'App areas');
    side.appendChild(el('div', 'as-brand',
      '<span class="as-brand-dot" style="background:' + (cfg.accent || '#0e7490') + '">'
      + (cfg.code || '') + '</span><div><div class="as-brand-name">Bookings Desk</div>'
      + '<div class="as-brand-tag">' + (cfg.name || '') + '</div></div>'));
    var nav = el('nav', 'as-nav');
    side.appendChild(nav);
    side.appendChild(el('div', 'as-foot', cfg.tag || ''));

    var overlay = el('button', 'as-overlay');
    overlay.setAttribute('aria-label', 'Close navigation');
    overlay.tabIndex = -1;

    var wrapMain = el('div', 'as-main');
    var bottom = el('nav', 'as-bottom');
    bottom.setAttribute('aria-label', 'Quick navigation');

    /* Reparent: the header, the league switcher and the page body move inside
       .as-main so the sidebar sits beside the whole thing rather than beside
       the content only. */
    document.body.insertBefore(shell, header);
    shell.appendChild(side);
    shell.appendChild(wrapMain);
    wrapMain.appendChild(header);
    if (bar) wrapMain.appendChild(bar);
    wrapMain.appendChild(main);
    document.body.appendChild(overlay);
    document.body.appendChild(bottom);

    /* ---- hamburger + breadcrumb into the existing topbar ---------------- */
    var burger = el('button', 'as-burger',
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>');
    burger.type = 'button';
    burger.setAttribute('aria-label', 'Open navigation');
    burger.setAttribute('aria-expanded', 'false');
    var hwrap = header.querySelector('.wrap') || header;
    hwrap.insertBefore(burger, hwrap.firstChild);
    var crumb = el('span', 'as-crumb', '');
    var spacer = hwrap.querySelector('.spacer');
    if (spacer) hwrap.insertBefore(crumb, spacer); else hwrap.appendChild(crumb);

    function setOpen(on) {
      side.classList.toggle('open', on);
      overlay.classList.toggle('show', on);
      burger.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    burger.addEventListener('click', function () { setOpen(!side.classList.contains('open')); });
    overlay.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });

    /* ---- the existing tab strip becomes the area's panel strip ---------- */
    var strip = document.querySelector('nav.tabs');
    var tabs = strip ? [].slice.call(strip.querySelectorAll('.tab')) : [];
    function panelOf(t) { return t.getAttribute('aria-controls'); }

    function showPanel(pid) {
      tabs.forEach(function (t) {
        var on = panelOf(t) === pid;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        var p = document.getElementById(panelOf(t));
        if (p) p.hidden = !on;
      });
    }

    var current = null;
    function setArea(id, panelId) {
      var area = areas.filter(function (a) { return a.id === id; })[0];
      if (!area) return;
      current = id;
      var pid = panelId || area.panels[0].id;
      /* Only this area's panels appear on the strip, and a single-panel area
         gets no strip at all — a row of one tab is furniture, not navigation. */
      var mine = area.panels.map(function (p) { return p.id; });
      tabs.forEach(function (t) { t.hidden = mine.indexOf(panelOf(t)) < 0; });
      if (strip) strip.hidden = area.panels.length < 2;
      showPanel(pid);

      [].slice.call(nav.querySelectorAll('.as-area-btn')).forEach(function (b) {
        b.classList.toggle('active', b.dataset.area === id);
        b.setAttribute('aria-current', b.dataset.area === id ? 'page' : 'false');
      });
      [].slice.call(bottom.querySelectorAll('.as-bn')).forEach(function (b) {
        b.classList.toggle('active', b.dataset.area === id);
      });
      var panel = area.panels.filter(function (p) { return p.id === pid; })[0] || area.panels[0];
      crumb.innerHTML = area.label + ' <span aria-hidden="true">›</span> <b>' + panel.label + '</b>';
      setOpen(false);
      try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// */ }
      if (cfg.onArea) cfg.onArea(id, pid);
    }

    areas.forEach(function (a) {
      var wrap = el('div', 'as-area');
      var btn = el('button', 'as-area-btn',
        '<span class="as-area-ic">' + (ICONS[a.icon] || '') + '</span><span>' + a.label + '</span>');
      btn.type = 'button'; btn.dataset.area = a.id;
      /* The panels stay in the accessible name even though only the area is
         shown — panel names are how people look for things. */
      btn.setAttribute('aria-label', a.label + ' — '
        + a.panels.map(function (p) { return p.label; }).join(', '));
      btn.addEventListener('click', function () { setArea(a.id); });
      wrap.appendChild(btn); nav.appendChild(wrap);

      var bn = el('button', 'as-bn',
        '<span class="as-area-ic">' + (ICONS[a.icon] || '') + '</span><span>' + a.label + '</span>');
      bn.type = 'button'; bn.dataset.area = a.id;
      bn.addEventListener('click', function () { setArea(a.id); });
      bottom.appendChild(bn);
    });

    /* Clicking a panel tab keeps the area but moves the breadcrumb. */
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var pid = panelOf(t);
        var area = areas.filter(function (a) {
          return a.panels.some(function (p) { return p.id === pid; });
        })[0];
        if (area) setArea(area.id, pid);
      });
    });

    /* Deep link: #desk, #fixtures, … falls back to the first area. */
    var want = String(location.hash || '').replace(/^#/, '');
    var found = areas.filter(function (a) { return a.id === want; })[0];
    setArea(found ? found.id : areas[0].id);

    return { setArea: setArea, areas: areas, current: function () { return current; } };
  }

  root.PLDShell = { build: build, ICONS: ICONS };
})(typeof globalThis !== 'undefined' ? globalThis : this);

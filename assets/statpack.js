/* PLDStatPack — the weekly stat pack panel, shared by all four desks.
 *
 * The desk builds the pack (PLDCore.statPack, from its own priced rows) and
 * hands it here. This file only shows it: the image cards, a Reddit block and
 * a Discord block, each with a copy button, and the text itself in a
 * read-only box so a phone that blocks the clipboard can still long-press it.
 * It formats no numbers of its own — every string comes from PLDCore.
 *
 * Previews are data: URLs, not blob: URLs, because the site's CSP allows
 * img-src 'self' data: and nothing else local.
 */
(function (root) {
  'use strict';

  var CSS = ''
    + '.spk{border:0;border-radius:14px;padding:0;width:min(720px,100vw - 24px);max-height:92vh;'
    + 'color:#0c1322;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.35)}'
    + '.spk::backdrop{background:rgba(12,19,34,.55)}'
    + '.spk-in{padding:18px 16px 16px;max-height:92vh;overflow:auto;box-sizing:border-box}'
    + '.spk h2{font-size:19px;margin:0 0 6px}'
    + '.spk-note{font-size:13px;color:#586275;margin:0 0 12px;line-height:1.45}'
    + '.spk-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px}'
    + '.spk-card img{width:100%;height:auto;border-radius:8px;border:1px solid #e2e6ee;display:block}'
    + '.spk-card button,.spk-row button{margin-top:6px;width:100%}'
    + '.spk-tabs{display:flex;gap:8px;margin:4px 0 8px}'
    + '.spk-tabs button[aria-pressed="true"]{outline:2px solid currentColor}'
    + '.spk-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}'
    + '.spk-row button{width:auto;flex:1 1 140px}'
    + '.spk textarea{width:100%;box-sizing:border-box;min-height:180px;font:12.5px/1.45 ui-monospace,Menlo,monospace;'
    + 'border:1px solid #cfd5df;border-radius:8px;padding:8px;color:#0c1322;background:#f8fafc}'
    + '.spk-status{font-size:12.5px;color:#15803d;min-height:1.2em;margin:4px 0}'
    + '.spk-close{float:right}'
    + '@media (prefers-color-scheme:dark){.spk{background:#111827;color:#e5e7eb}'
    + '.spk textarea{background:#0b1220;color:#e5e7eb;border-color:#374151}.spk-note{color:#9ca3af}}';

  function injectCss(doc) {
    if (doc.getElementById('spk-css')) return;
    var st = doc.createElement('style');
    st.id = 'spk-css'; st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function el(doc, tag, attrs, text) {
    var e = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function toDataUrl(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  /* The clipboard API where the browser allows it; otherwise select the text
     in the box and use the old command; otherwise leave it selected and say
     so, which is what a long-press on a phone needs anyway. */
  function copyText(text, box, say) {
    function fallback() {
      box.value = text; box.focus(); box.select();
      var ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); } catch (e) { ok = false; }
      say(ok ? 'Copied.' : 'Selected: press and hold to copy.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { box.value = text; say('Copied.'); }, fallback);
    } else fallback();
  }

  /* opts = { pack, C (PLDCore), S (PLDShare), palette } */
  function open(opts) {
    var doc = document, C = opts.C, S = opts.S, pack = opts.pack;
    injectCss(doc);
    var old = doc.getElementById('spkDialog');
    if (old) old.remove();

    var reddit = C.statPackMarkdown(pack);
    var discord = C.statPackDiscord(pack);
    var specs = S.statPackSpecs(pack, C, { palette: opts.palette });

    var dlg = el(doc, 'dialog', { id: 'spkDialog', class: 'spk', 'aria-labelledby': 'spkTitle' });
    var box = el(doc, 'div', { class: 'spk-in' });
    var close = el(doc, 'button', { type: 'button', class: 'btn spk-close' }, 'Close');
    close.addEventListener('click', function () { dlg.close(); });
    box.appendChild(close);
    box.appendChild(el(doc, 'h2', { id: 'spkTitle' },
      (pack.roundWord || 'Matchday') + ' ' + pack.round + ' · Stats pack'));
    box.appendChild(el(doc, 'p', { class: 'spk-note' },
      '18+ research, not advice. Every price is this desk’s own; the averages are per game, '
      + 'for and against, over this season’s finished matches'
      + (pack.dataTo ? ' to ' + pack.dataTo : '') + '. A dash means no data, not zero.'));

    var cards = el(doc, 'div', { class: 'spk-cards', 'aria-live': 'polite' });
    box.appendChild(cards);

    var tabs = el(doc, 'div', { class: 'spk-tabs', role: 'group', 'aria-label': 'Text format' });
    var tR = el(doc, 'button', { type: 'button', class: 'btn', 'aria-pressed': 'true' }, 'Reddit');
    var tD = el(doc, 'button', { type: 'button', class: 'btn', 'aria-pressed': 'false' }, 'Discord');
    tabs.appendChild(tR); tabs.appendChild(tD);
    box.appendChild(tabs);
    var row = el(doc, 'div', { class: 'spk-row' });
    box.appendChild(row);
    var status = el(doc, 'p', { class: 'spk-status', role: 'status' });
    box.appendChild(status);
    var ta = el(doc, 'textarea', { readonly: '', 'aria-label': 'Stats pack text' });
    box.appendChild(ta);
    function say(t) { status.textContent = t; }

    function showReddit() {
      tR.setAttribute('aria-pressed', 'true'); tD.setAttribute('aria-pressed', 'false');
      row.innerHTML = ''; say('');
      var b = el(doc, 'button', { type: 'button', class: 'btn primary' }, 'Copy for Reddit');
      b.addEventListener('click', function () { copyText(reddit, ta, say); });
      row.appendChild(b);
      ta.value = reddit;
    }
    function showDiscord() {
      tD.setAttribute('aria-pressed', 'true'); tR.setAttribute('aria-pressed', 'false');
      row.innerHTML = ''; say('');
      discord.forEach(function (part, i) {
        var label = discord.length > 1 ? 'Copy part ' + (i + 1) + ' of ' + discord.length : 'Copy for Discord';
        var b = el(doc, 'button', { type: 'button', class: 'btn primary' }, label);
        b.addEventListener('click', function () { copyText(part, ta, say); });
        row.appendChild(b);
      });
      ta.value = discord.join('\n\n────────\n\n');
    }
    tR.addEventListener('click', showReddit);
    tD.addEventListener('click', showDiscord);
    showReddit();

    dlg.appendChild(box);
    doc.body.appendChild(dlg);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');

    /* Cards draw after the dialog is up, one at a time, so a slow phone shows
       the text straight away rather than a blank panel. */
    specs.reduce(function (p, spec) {
      return p.then(function () {
        return S.statPackCard(spec).then(function (blob) {
          return toDataUrl(blob).then(function (url) {
            var c = el(doc, 'div', { class: 'spk-card' });
            c.appendChild(el(doc, 'img', { src: url,
              alt: 'Stats pack card ' + spec.page + ' of ' + spec.pages }));
            var b = el(doc, 'button', { type: 'button', class: 'btn' },
              specs.length > 1 ? 'Save card ' + spec.page : 'Save card');
            b.addEventListener('click', function () { S.download(blob, spec.filename); });
            c.appendChild(b);
            cards.appendChild(c);
          });
        });
      });
    }, Promise.resolve()).catch(function (e) {
      console.error(e); say('The image could not be drawn; the text above is complete.');
    });
    return dlg;
  }

  root.PLDStatPack = { open: open };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* Saving a file, on a phone as well as a desktop.
 *
 * THE PROBLEM THIS EXISTS FOR: iOS Safari ignores the `download` attribute on
 * a blob: URL. The desktop idiom —
 *
 *     a.href = URL.createObjectURL(blob); a.download = name; a.click();
 *
 * — does nothing useful on an iPhone. The tap either navigates to a blob URL
 * the user cannot save, or silently does nothing at all. There is no error and
 * no console warning: the button simply does not work, which is the worst
 * possible failure for the one feature people came to use. Every share card on
 * every desk went out through that path.
 *
 * The iOS-correct route is the Web Share API with a File, which opens the
 * native share sheet — Save Image, Messages, WhatsApp, Instagram. For a card
 * meant to be posted, that is not a workaround for the download, it is better
 * than the download.
 *
 * So: share sheet where it is genuinely available, anchor everywhere else, and
 * the anchor is kept because Web Share with files is still absent on most
 * desktop browsers.
 */
(function (root) {
  'use strict';

  function anchor(blob, name) {
    var u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name;
    /* Appended before clicking: a detached anchor is a no-op in some engines,
       and this path is now the FALLBACK, so it has to be the reliable one. */
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(u);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
    return 'download';
  }

  function shareable(file) {
    try {
      return !!(typeof navigator !== 'undefined' && navigator.share &&
                navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) {
      /* canShare throws rather than returning false in some builds. */
      return false;
    }
  }

  /* Resolves with 'share' | 'download' | 'cancelled' so a caller can word its
     toast honestly — "Saved" is wrong when the user dismissed the sheet. */
  function file(blob, name, mime) {
    var f = null;
    try {
      if (typeof File === 'function') {
        f = new File([blob], name, { type: mime || blob.type || 'application/octet-stream' });
      }
    } catch (e) { /* no File constructor: anchor it */ }

    if (!f || !shareable(f)) return Promise.resolve(anchor(blob, name));

    return navigator.share({ files: [f] })
      .then(function () { return 'share'; })
      .catch(function (err) {
        /* AbortError is the user closing the sheet. That is a decision, not a
           failure — falling back to a download here would hand them the file
           they just declined. */
        if (err && (err.name === 'AbortError' || err.name === 'CanceledError')) {
          return 'cancelled';
        }
        /* Anything else — including Safari refusing because the user gesture
           expired while the canvas rendered — falls back to the anchor. */
        return anchor(blob, name);
      });
  }

  /* True when the share sheet is the likely route, so a page can label its
     button "Share" rather than "Download" before anything is built. */
  function prefersShare() {
    try {
      if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
      return navigator.canShare({
        files: [new File([new Blob([''], { type: 'image/png' })], 'x.png', { type: 'image/png' })]
      });
    } catch (e) { return false; }
  }

  root.PLDSave = { file: file, anchor: anchor, prefersShare: prefersShare };
})(typeof globalThis !== 'undefined' ? globalThis : this);

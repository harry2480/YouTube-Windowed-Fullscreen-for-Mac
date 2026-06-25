/**
 * Generic fullscreen interceptor — runs in the page's MAIN world.
 *
 * The reason native fullscreen creates a new macOS Space is that the page calls
 * `element.requestFullscreen()`. Detecting it after the fact (fullscreenchange)
 * is too late — the Space is already created on enter. So we replace the
 * Fullscreen API itself with a CSS "pseudo-fullscreen": the target element is
 * stretched to fill the viewport via position:fixed, and no native fullscreen
 * is ever requested, so macOS never spawns a Space.
 *
 * This must run in the MAIN world: a content script's isolated world has its own
 * copy of the DOM prototypes, so overriding Element.prototype there would not
 * affect the page's own requestFullscreen() calls. It is registered dynamically
 * (chrome.scripting, world:'MAIN') for every origin the user has opted in to.
 *
 * Plain ES (no TypeScript / no bundling): it lives in public/ and is copied to
 * the extension root verbatim, giving a stable path to register against. It uses
 * no extension APIs (none are available in the MAIN world) — pure DOM only.
 */
(() => {
  'use strict';

  // Guard against double injection (all_frames + SPA re-registration, etc.).
  if (window.__ywfsFullscreenInterceptor) return;
  window.__ywfsFullscreenInterceptor = true;

  const STYLE_ID = 'ywfs-pseudo-fullscreen-style';
  const TARGET_CLASS = 'ywfs-pseudo-fullscreen';
  const ACTIVE_CLASS = 'ywfs-pseudo-fullscreen-active';

  // The element currently shown pseudo-fullscreen, or null.
  let activeElement = null;

  const nativeRequest = Element.prototype.requestFullscreen;
  const nativeWebkitRequest = Element.prototype.webkitRequestFullscreen;

  /** Inject the pseudo-fullscreen stylesheet once. */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${TARGET_CLASS} {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        z-index: 2147483647 !important;
        background: #000 !important;
      }
      html.${ACTIVE_CLASS}, html.${ACTIVE_CLASS} body {
        overflow: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Make the page believe it is in fullscreen so player UIs (button icons,
   * layout) react correctly. Defined as an own property while active and
   * removed on exit, which unshadows the native getter again.
   */
  function setFullscreenElement(element) {
    try {
      if (element) {
        const descriptor = { configurable: true, get: () => element };
        Object.defineProperty(document, 'fullscreenElement', descriptor);
        Object.defineProperty(document, 'webkitFullscreenElement', descriptor);
      } else {
        delete document.fullscreenElement;
        delete document.webkitFullscreenElement;
      }
    } catch (_) {
      // Some environments make these non-configurable; best-effort only.
    }
  }

  /** Notify the page that the (pseudo) fullscreen state changed. */
  function emitChange() {
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('fullscreenchange'));
    document.dispatchEvent(new Event('webkitfullscreenchange'));
  }

  /** Stretch an element to fill the viewport instead of going native fullscreen. */
  function applyPseudoFullscreen(element) {
    const target = element instanceof Element ? element : document.documentElement;
    if (activeElement === target) return;
    if (activeElement) removePseudoFullscreen();

    ensureStyle();
    activeElement = target;
    document.documentElement.classList.add(ACTIVE_CLASS);
    target.classList.add(TARGET_CLASS);
    setFullscreenElement(target);
    emitChange();
  }

  /** Restore the page from pseudo-fullscreen. */
  function removePseudoFullscreen() {
    if (!activeElement) return;
    const target = activeElement;
    activeElement = null;
    target.classList.remove(TARGET_CLASS);
    document.documentElement.classList.remove(ACTIVE_CLASS);
    setFullscreenElement(null);
    emitChange();
  }

  // --- Override the Fullscreen API -------------------------------------------

  Element.prototype.requestFullscreen = function () {
    applyPseudoFullscreen(this);
    return Promise.resolve();
  };

  if (typeof nativeWebkitRequest === 'function') {
    // webkit-prefixed variant returns void, not a promise.
    Element.prototype.webkitRequestFullscreen = function () {
      applyPseudoFullscreen(this);
    };
  }

  Document.prototype.exitFullscreen = function () {
    removePseudoFullscreen();
    return Promise.resolve();
  };

  if (typeof Document.prototype.webkitExitFullscreen === 'function') {
    Document.prototype.webkitExitFullscreen = function () {
      removePseudoFullscreen();
    };
  }

  // Escape exits pseudo-fullscreen, mirroring native behaviour. Capture phase so
  // we see it first; when we actually own an active pseudo-fullscreen we consume
  // the key (as the browser swallows Escape when leaving real fullscreen) so the
  // page doesn't also act on it.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && activeElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        removePseudoFullscreen();
      }
    },
    true,
  );

  // Expose the native request in case advanced callers need a real fullscreen
  // escape hatch (unused by default; kept for debuggability).
  window.__ywfsNativeRequestFullscreen = nativeRequest;
})();

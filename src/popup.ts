/**
 * Popup script for controlling the extension.
 *
 * Besides the YouTube pseudo-fullscreen toggle, the popup lets the user manage
 * which origins may use the chromeless-maximized-window feature: adding the
 * current site requests the matching host permission and stores the origin in
 * the shared allow-list (see sites.ts).
 */

import {
  addUserOrigin,
  getAllowedOrigins,
  hasHostPermission,
  isDefaultOrigin,
  originFromUrl,
  patternForOrigin,
  removeUserOrigin,
} from './sites';

/** An allowed origin together with whether its host permission is held here. */
interface SiteEntry {
  origin: string;
  granted: boolean;
}

try {
  // Get the manifest version
  const manifest = chrome.runtime.getManifest();
  const version = manifest.version || '1.0.0';

  // Set the version in the popup
  const versionElement = document.getElementById('version');
  if (versionElement) {
    versionElement.textContent = `v${version}`;
  }

  // Get the toggle switch
  const toggleSwitch = document.getElementById('toggle-switch') as HTMLInputElement;

  // Load the current state
  chrome.storage.sync.get(['isEnabled'], (result) => {
    const isEnabled = result.isEnabled !== false; // Default to true
    toggleSwitch.checked = isEnabled;
  });

  // Listen for toggle changes
  toggleSwitch.addEventListener('change', () => {
    const isEnabled = toggleSwitch.checked;
    chrome.storage.sync.set({ isEnabled }, () => {
      console.log('[YouTube WFS] Extension state updated:', isEnabled);
    });
  });

  // Open the active tab in a chromeless, maximized window
  const chromelessButton = document.getElementById('chromeless-button');
  chromelessButton?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'toggleChromeless' }, () => {
      // Reading lastError suppresses the unchecked-error warning that fires
      // while the service worker is spinning up.
      void chrome.runtime.lastError;
      // The window changes; close the popup so focus follows the new window.
      window.close();
    });
  });

  // --- Allowed-sites management ----------------------------------------------

  const currentSiteEl = document.getElementById('current-site');
  const sitesListEl = document.getElementById('sites-list');

  /** Origin of the tab the popup was opened from (null for chrome:// etc.). */
  async function getCurrentOrigin(): Promise<string | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return originFromUrl(tab?.url);
  }

  /** Re-render the current-site row and the allowed-sites list. */
  async function render(): Promise<void> {
    const [currentOrigin, allowed] = await Promise.all([
      getCurrentOrigin(),
      getAllowedOrigins(),
    ]);

    // Resolve actual permission state per origin — the allow-list may name an
    // origin (synced from another device) whose permission isn't held here.
    const [currentGranted, entries] = await Promise.all([
      currentOrigin ? hasHostPermission(currentOrigin) : Promise.resolve(false),
      Promise.all(
        allowed.map(async (origin): Promise<SiteEntry> => ({
          origin,
          granted: await hasHostPermission(origin),
        })),
      ),
    ]);

    renderCurrentSite(currentOrigin, currentGranted);
    renderSitesList(entries);
  }

  function renderCurrentSite(origin: string | null, alreadyAllowed: boolean): void {
    if (!currentSiteEl) return;
    currentSiteEl.replaceChildren();

    if (!origin) {
      const note = document.createElement('p');
      note.className = 'current-site-note';
      note.textContent = 'このページではクロムレスを利用できません。';
      currentSiteEl.appendChild(note);
      return;
    }

    const label = document.createElement('span');
    label.className = 'current-site-origin';
    label.textContent = prettyOrigin(origin);
    currentSiteEl.appendChild(label);

    if (alreadyAllowed) {
      const badge = document.createElement('span');
      badge.className = 'current-site-badge';
      badge.textContent = '許可済み';
      currentSiteEl.appendChild(badge);
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'allow-button';
    button.textContent = 'このサイトを許可';
    button.addEventListener('click', () => void allowOrigin(origin));
    currentSiteEl.appendChild(button);
  }

  function renderSitesList(entries: SiteEntry[]): void {
    if (!sitesListEl) return;
    sitesListEl.replaceChildren();

    for (const { origin, granted } of entries) {
      const item = document.createElement('li');
      item.className = 'site-item';

      const name = document.createElement('span');
      name.className = 'site-origin';
      name.textContent = prettyOrigin(origin);
      item.appendChild(name);

      if (isDefaultOrigin(origin)) {
        const tag = document.createElement('span');
        tag.className = 'site-default-tag';
        tag.textContent = '標準';
        item.appendChild(tag);
        continue;
      }

      // Synced from another device but not granted here: offer to re-grant.
      if (!granted) {
        const regrant = document.createElement('button');
        regrant.type = 'button';
        regrant.className = 'allow-button';
        regrant.textContent = 'この端末で許可';
        regrant.addEventListener('click', () => void allowOrigin(origin));
        item.appendChild(regrant);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'site-remove';
      remove.title = '許可を解除';
      remove.setAttribute('aria-label', `${prettyOrigin(origin)} の許可を解除`);
      remove.textContent = '×';
      remove.addEventListener('click', () => void disallowOrigin(origin));
      item.appendChild(remove);
    }
  }

  /** Request the host permission and persist the origin to the allow-list. */
  async function allowOrigin(origin: string): Promise<void> {
    // chrome.permissions.request MUST run synchronously within the click's
    // user-gesture token, which is consumed by the first await. So request
    // FIRST — before touching storage — then persist only on success. The call
    // is idempotent (re-granting an already-held origin just returns true), so
    // there is no need to read the allow-list beforehand: on a fresh add a
    // decline persists nothing, and on a re-grant the synced entry is untouched.
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins: [patternForOrigin(origin)] });
    } catch (error) {
      console.warn('[YouTube WFS] Permission request failed', error);
    }

    if (granted) {
      await addUserOrigin(origin);
    }
    await render();
  }

  /** Remove the origin from the allow-list and drop its host permission. */
  async function disallowOrigin(origin: string): Promise<void> {
    await removeUserOrigin(origin);
    try {
      await chrome.permissions.remove({ origins: [patternForOrigin(origin)] });
    } catch (error) {
      // Removing the permission is best-effort; the allow-list is what gates
      // the feature, and it has already been updated.
      console.warn('[YouTube WFS] Permission removal failed', error);
    }
    await render();
  }

  /** Strip the scheme for a compact display ("https://x.com" -> "x.com"). */
  function prettyOrigin(origin: string): string {
    return origin.replace(/^https?:\/\//, '');
  }

  void render();

  console.log('[YouTube WFS] Popup script initialized');
} catch (error) {
  console.error('[YouTube WFS] Popup initialization error:', error);
}

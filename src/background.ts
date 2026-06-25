/**
 * Background service worker for YouTube Windowed Fullscreen for Mac.
 *
 * Implements the "chromeless maximized window" feature: the active YouTube tab
 * is moved into a borderless popup window and maximized. Because we use the
 * "maximized" window state (not "fullscreen"), macOS does NOT create a new
 * Space/desktop — which is the whole point of this extension. The tab itself is
 * moved (not reloaded), so playback position, login and player state are kept.
 *
 * The feature is not YouTube-specific — moving a tab into a popup window needs
 * no page knowledge — so it runs on any origin the user has opted in to via the
 * popup. The allow-list lives in chrome.storage.sync (see sites.ts).
 */

import { ALLOWED_SITES_KEY, isOriginActionable, reconcileInterceptors } from './sites';

// MV3 service workers are evicted when idle, so in-memory state would be lost
// mid-session (e.g. the user watches for a minute, then can't exit). We persist
// the "tab → window it came from" mapping in chrome.storage.session, which
// survives worker restarts for the lifetime of the browser session.
const STORAGE_KEY = 'chromelessOrigin';

type OriginMap = Record<string, number>;

async function readOrigins(): Promise<OriginMap> {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as OriginMap | undefined) ?? {};
}

async function rememberOrigin(tabId: number, windowId: number): Promise<void> {
  const origins = await readOrigins();
  origins[tabId] = windowId;
  await chrome.storage.session.set({ [STORAGE_KEY]: origins });
}

/** Remove and return the stored origin window for a tab. */
async function takeOrigin(tabId: number): Promise<number | undefined> {
  const origins = await readOrigins();
  const windowId = origins[tabId];
  if (tabId in origins) {
    delete origins[tabId];
    await chrome.storage.session.set({ [STORAGE_KEY]: origins });
  }
  return windowId;
}

async function hasOrigin(tabId: number): Promise<boolean> {
  const origins = await readOrigins();
  return tabId in origins;
}

/**
 * Move the given tab into a borderless, maximized popup window and tell its
 * content script to fill the window with the video.
 */
async function enterChromeless(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.windowId === undefined) return;
  // Only act on origins the user has opted in to AND granted host permission
  // for on this device. This is what keeps us from trapping an arbitrary page
  // in a chromeless window it can't escape from — the user has explicitly
  // approved every site that reaches this point.
  if (!(await isOriginActionable(tab.url))) return;

  const originWindowId = tab.windowId;

  let createdWindow: chrome.windows.Window | undefined;
  try {
    // type: 'popup' drops the tab strip / address bar / bookmarks bar,
    // state: 'maximized' fills the screen without taking a separate Space.
    createdWindow = await chrome.windows.create({
      tabId: tab.id,
      type: 'popup',
      state: 'maximized',
    });
  } catch (error) {
    console.warn('[YouTube WFS] Failed to open chromeless window', error);
    return;
  }

  // Some platforms ignore `state` on creation of a popup — enforce it.
  if (createdWindow?.id !== undefined && createdWindow.state !== 'maximized') {
    try {
      await chrome.windows.update(createdWindow.id, { state: 'maximized' });
    } catch {
      // Best effort — the window still opened.
    }
  }

  await rememberOrigin(tab.id, originWindowId);
  await sendToTab(tab.id, { action: 'applyChromeless' });
}

/**
 * Restore the tab from the chromeless popup back to a normal window.
 */
async function exitChromeless(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;

  await sendToTab(tab.id, { action: 'removeChromeless' });

  const originWindowId = await takeOrigin(tab.id);

  // Prefer moving the tab back into the window it came from.
  if (originWindowId !== undefined) {
    try {
      await chrome.windows.get(originWindowId);
      await chrome.tabs.move(tab.id, { windowId: originWindowId, index: -1 });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(originWindowId, { focused: true });
      return;
    } catch {
      // Original window is gone — fall through to a fresh normal window.
    }
  }

  await chrome.windows.create({ tabId: tab.id, type: 'normal' });
}

/**
 * Toggle chromeless mode for a tab based on its persisted state.
 *
 * chrome.storage.session survives service-worker eviction for the whole browser
 * session, so the stored mapping is an authoritative source of truth — we do
 * NOT guess from window.type (which would misfire on popup windows the user
 * opened themselves and wrongly tear them apart).
 */
async function toggleChromeless(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab || tab.id === undefined) return;

  if (await hasOrigin(tab.id)) {
    await exitChromeless(tab);
  } else {
    await enterChromeless(tab);
  }
}

// Serialize all toggles. chrome.storage.session get→set is not atomic, so
// concurrent toggles (shortcut spam, multiple windows) could clobber each
// other's origin entries; running them one at a time also prevents a double
// "enter" from opening two popup windows for the same tab.
let operationChain: Promise<void> = Promise.resolve();

function enqueue(operation: () => Promise<unknown>): void {
  operationChain = operationChain
    .then(operation)
    .then(() => undefined)
    .catch((error) => {
      console.warn('[YouTube WFS] Chromeless operation failed', error);
    });
}

function enqueueToggle(resolveTab: () => Promise<chrome.tabs.Tab | undefined>): void {
  enqueue(async () => {
    const tab = await resolveTab();
    await toggleChromeless(tab);
  });
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

/**
 * Send a message to a tab, swallowing the "no receiver" error that happens when
 * the content script is not (yet) present.
 */
async function sendToTab(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // No content script listening (e.g. non-YouTube page) — ignore.
  }
}

// Keyboard shortcut (works even inside the chromeless popup, where there is no
// toolbar icon, so this is the primary way to exit).
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-chromeless') return;
  enqueueToggle(getActiveTab);
});

// Messages from the popup UI (sender.tab is undefined) or the content script
// (sender.tab is the tab itself, e.g. an Escape-key exit request).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === 'toggleChromeless') {
    const senderTab = sender.tab;
    enqueueToggle(senderTab ? async () => senderTab : getActiveTab);
    sendResponse({ ok: true });
    return true;
  }
});

// Forget tabs that get closed while in chromeless mode. Routed through the same
// queue so cleanup runs after any in-flight enter (which writes the origin),
// preventing a dead entry from lingering in storage.
chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => takeOrigin(tabId));
});

// Keep the dynamically-registered fullscreen interceptors in sync with the
// allow-list and the granted host permissions. Both the permission grant and
// the allow-list write happen when the user adds a site (from the popup); we
// reconcile on either signal so the final state is correct regardless of order,
// and on install/startup so updates re-establish the registrations. All runs go
// through the same queue as the chromeless toggles to serialise storage access.
function scheduleReconcile(): void {
  enqueue(reconcileInterceptors);
}

chrome.runtime.onInstalled.addListener(scheduleReconcile);
chrome.runtime.onStartup.addListener(scheduleReconcile);
chrome.permissions.onAdded.addListener(scheduleReconcile);
chrome.permissions.onRemoved.addListener(scheduleReconcile);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && ALLOWED_SITES_KEY in changes) scheduleReconcile();
});

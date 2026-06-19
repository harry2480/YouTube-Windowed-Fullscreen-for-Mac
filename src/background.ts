/**
 * Background service worker for YouTube Windowed Fullscreen for Mac.
 *
 * Implements the "chromeless maximized window" feature: the active YouTube tab
 * is moved into a borderless popup window and maximized. Because we use the
 * "maximized" window state (not "fullscreen"), macOS does NOT create a new
 * Space/desktop — which is the whole point of this extension. The tab itself is
 * moved (not reloaded), so playback position, login and player state are kept.
 */

// Tabs currently shown in a chromeless popup → the window they came from, so we
// can move them back on exit.
const chromelessOrigin = new Map<number, number>();

/**
 * Move the given tab into a borderless, maximized popup window and tell its
 * content script to fill the window with the video.
 */
async function enterChromeless(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || tab.windowId === undefined) return;

  chromelessOrigin.set(tab.id, tab.windowId);

  // type: 'popup' drops the tab strip / address bar / bookmarks bar,
  // state: 'maximized' fills the screen without taking a separate Space.
  await chrome.windows.create({
    tabId: tab.id,
    type: 'popup',
    state: 'maximized',
  });

  await sendToTab(tab.id, { action: 'applyChromeless' });
}

/**
 * Restore the tab from the chromeless popup back to a normal window.
 */
async function exitChromeless(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;

  await sendToTab(tab.id, { action: 'removeChromeless' });

  const originWindowId = chromelessOrigin.get(tab.id);
  chromelessOrigin.delete(tab.id);

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
 * Toggle chromeless mode for a tab based on its current state.
 */
async function toggleChromeless(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab || tab.id === undefined) return;

  if (chromelessOrigin.has(tab.id)) {
    await exitChromeless(tab);
  } else {
    await enterChromeless(tab);
  }
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

/**
 * Resolve the active tab of the current window.
 */
function withActiveTab(callback: (tab: chrome.tabs.Tab | undefined) => void): void {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    callback(tabs[0]);
  });
}

// Keyboard shortcut (works even inside the chromeless popup, where there is no
// toolbar icon, so this is the primary way to exit).
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-chromeless') return;
  withActiveTab((tab) => {
    void toggleChromeless(tab);
  });
});

// Messages from the popup UI (sender.tab is undefined) or the content script
// (sender.tab is the tab itself, e.g. an Escape-key exit request).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === 'toggleChromeless') {
    if (sender.tab) {
      void toggleChromeless(sender.tab);
      sendResponse({ ok: true });
    } else {
      withActiveTab((tab) => {
        void toggleChromeless(tab);
      });
      sendResponse({ ok: true });
    }
    return true;
  }
});

// Forget tabs that get closed while in chromeless mode.
chrome.tabs.onRemoved.addListener((tabId) => {
  chromelessOrigin.delete(tabId);
});

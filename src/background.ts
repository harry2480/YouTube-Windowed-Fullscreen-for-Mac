chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'maximizeWindow' && sender.tab?.windowId) {
    chrome.windows.update(sender.tab.windowId, { state: 'maximized' });
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'restoreWindow' && sender.tab?.windowId) {
    chrome.windows.update(sender.tab.windowId, { state: 'normal' });
    sendResponse({ success: true });
    return true;
  }
});
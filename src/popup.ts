/**
 * Popup script for controlling the extension
 */

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

  console.log('[YouTube WFS] Popup script initialized');
} catch (error) {
  console.error('[YouTube WFS] Popup initialization error:', error);
}

/**
 * Content script for YouTube Windowed Fullscreen for Mac
 * Intercepts fullscreen attempts and applies pseudo-fullscreen styling instead
 */

// Constants
const MOVIE_PLAYER_SELECTOR = '#movie_player';

// State
let isFullscreenEnabled = true;
let isPseudoFullscreenActive = false;
// The player we entered pseudo-fullscreen with. getMoviePlayer() may resolve
// to a different element later (SPA navigation, miniplayer), so we keep the
// original reference to guarantee a clean, symmetric exit.
let activePlayer: HTMLElement | null = null;
// Whether this tab is currently displayed inside a chromeless popup window
// (driven by the background service worker).
let isChromelessActive = false;

/**
 * Check if the focused element is an input field
 */
function isFocusedOnInputField(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  const tagName = activeElement.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    (activeElement as HTMLElement).contentEditable === 'true'
  );
}

/**
 * Get the movie player element
 */
function getMoviePlayer(): HTMLElement | null {
  return document.querySelector(MOVIE_PLAYER_SELECTOR);
}

/**
 * Whether the player is the active, on-screen video player.
 *
 * YouTube keeps an idle #movie_player in the DOM even on non-watch pages
 * (home feed, search results, ...) — left over from SPA navigation or the
 * miniplayer — but it lives inside a hidden container so it has no layout box.
 * Checking only for existence would let 'f' toggle pseudo-fullscreen on those
 * pages, hiding the masthead/guide for nothing. Require a real layout box.
 */
function isPlayerActive(player: HTMLElement): boolean {
  // Must have a real layout box (excludes the idle off-screen player).
  if (player.offsetWidth === 0 || player.offsetHeight === 0) return false;
  // Must not be the small corner miniplayer — it is visible but going
  // "fullscreen" from it would hide the masthead/guide of whatever page
  // the user is actually browsing.
  if (player.closest('ytd-miniplayer')) return false;
  return true;
}

/**
 * Apply pseudo-fullscreen styling
 */
function applyPseudoFullscreen(player: HTMLElement): void {
  // Use our custom pure CSS class on body
  document.body.classList.add('yw-fullscreen-active');
  
  // Add YouTube's native fullscreen class so the internal UI knows to resize properly
  player.classList.add('ytp-fullscreen');
  
  // Dispatch resize event to prompt YouTube's video player to update its canvas/video dimension
  window.dispatchEvent(new Event('resize'));

  console.log('[YouTube WFS] Pseudo-fullscreen applied via CSS class');
  isPseudoFullscreenActive = true;
  activePlayer = player;
}

/**
 * Remove pseudo-fullscreen styling
 */
function removePseudoFullscreen(player: HTMLElement): void {
  document.body.classList.remove('yw-fullscreen-active');
  player.classList.remove('ytp-fullscreen');
  
  // Trigger UI resize update
  window.dispatchEvent(new Event('resize'));

  console.log('[YouTube WFS] Pseudo-fullscreen removed via CSS class');
  isPseudoFullscreenActive = false;
  activePlayer = null;
}

/**
 * Toggle pseudo-fullscreen
 */
function togglePseudoFullscreen(): void {
  if (isPseudoFullscreenActive) {
    exitPseudoFullscreen();
    return;
  }

  // Never enter pseudo-fullscreen for a missing, idle/off-screen, or miniplayer player
  const player = getMoviePlayer();
  if (!player || !isPlayerActive(player)) return;
  applyPseudoFullscreen(player);
}

/**
 * Exit pseudo-fullscreen using the player we entered with (falling back to the
 * current one), guarding against the element having disappeared from the DOM.
 */
function exitPseudoFullscreen(): void {
  const player = activePlayer ?? getMoviePlayer();
  if (player) {
    removePseudoFullscreen(player);
  } else {
    // Element is gone but state lingers — at least restore the page chrome.
    document.body.classList.remove('yw-fullscreen-active');
    isPseudoFullscreenActive = false;
    activePlayer = null;
  }
}

/**
 * Ask the background worker to toggle the chromeless popup window for this tab.
 */
function requestToggleChromeless(): void {
  try {
    chrome.runtime.sendMessage({ action: 'toggleChromeless' });
  } catch (error) {
    console.warn('[YouTube WFS] Failed to request chromeless toggle', error);
  }
}

/**
 * React to chromeless window changes driven by the background worker: fill the
 * popup with the video on enter, restore the page on exit.
 */
function handleRuntimeMessage(message: { action?: string }): void {
  if (message?.action === 'applyChromeless') {
    isChromelessActive = true;
    const player = getMoviePlayer();
    if (player) applyPseudoFullscreen(player);
  } else if (message?.action === 'removeChromeless') {
    isChromelessActive = false;
    exitPseudoFullscreen();
  }
}

/**
 * Handle keyboard events
 */
function handleKeyDown(event: KeyboardEvent): void {
  if (!isFullscreenEnabled) return;

  // Handle 'f' key for fullscreen toggle
  if (event.key === 'f' || event.key === 'F') {
    // Don't interfere with browser/OS shortcuts such as Cmd+F / Ctrl+F (find in page)
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    // Allow normal text input if focused on input field
    if (isFocusedOnInputField()) {
      return;
    }

    // Only intercept when an actually-visible video player exists.
    // (avoids hijacking 'f' on the home page, search results, etc., where
    // an idle off-screen #movie_player may still linger in the DOM)
    const player = getMoviePlayer();
    if (!player || !isPlayerActive(player)) {
      return;
    }

    // Prevent default fullscreen behavior
    event.preventDefault();
    event.stopImmediatePropagation();

    // Apply pseudo-fullscreen
    togglePseudoFullscreen();
  }

  // Handle 'Escape' key to exit fullscreen
  if (event.key === 'Escape' && isPseudoFullscreenActive) {
    event.preventDefault();
    event.stopImmediatePropagation();
    // In a chromeless popup there is no toolbar icon to exit from, so Escape
    // asks the background worker to move the tab back to a normal window. The
    // CSS is removed when the resulting 'removeChromeless' message arrives.
    if (isChromelessActive) {
      requestToggleChromeless();
    } else {
      exitPseudoFullscreen();
    }
  }
}

/**
 * Handle mouse clicks to intercept native fullscreen button and double clicks
 */
function handleGlobalClick(event: MouseEvent): void {
  if (!isFullscreenEnabled) return;

  const target = event.target as HTMLElement;
  
  // 1. Intercept UI Fullscreen Button clicks
  const fullscreenBtn = target.closest('.ytp-fullscreen-button');
  if (fullscreenBtn) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    togglePseudoFullscreen();
    return;
  }
}

/**
 * Handle double clicks on the video to intercept native fullscreen
 */
function handleDoubleClick(event: MouseEvent): void {
  if (!isFullscreenEnabled) return;

  const target = event.target as HTMLElement;
  
  // Intercept double click on the video area
  if (target.closest('.html5-video-container') || target.tagName.toLowerCase() === 'video') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    togglePseudoFullscreen();
    return;
  }
}

/**
 * Initialize the extension
 */
function init(): void {
  // Wrap initialization in try-catch for context invalidation handling
  try {
    // Load extension state from storage
    chrome.storage.sync.get(['isEnabled'], (result) => {
      try {
        isFullscreenEnabled = result.isEnabled !== false; // Default to true
      } catch (error) {
        console.warn('[YouTube WFS] Context invalidated while fetching storage', error);
      }
    });

    // Add event listener with capture phase
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleGlobalClick, true);
    document.addEventListener('dblclick', handleDoubleClick, true);

    // React to chromeless-window changes from the background worker
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    // Listen for storage changes (when user toggles in popup)
    chrome.storage.onChanged.addListener((changes) => {
      try {
        if ('isEnabled' in changes) {
          isFullscreenEnabled = changes.isEnabled.newValue !== false;
        }
      } catch (error) {
        console.warn('[YouTube WFS] Context invalidated in storage change listener', error);
      }
    });

    console.log('[YouTube WFS] Content script initialized');
  } catch (error) {
    console.error('[YouTube WFS] Initialization error:', error);
  }
}

/**
 * Cleanup function for context invalidation
 */
function cleanup(): void {
  try {
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('click', handleGlobalClick, true);
    document.removeEventListener('dblclick', handleDoubleClick, true);
    
    // Exit fullscreen if active
    if (isPseudoFullscreenActive) {
      exitPseudoFullscreen();
    }
    
    console.log('[YouTube WFS] Content script cleaned up');
  } catch (error) {
    console.warn('[YouTube WFS] Cleanup error:', error);
  }
}

// Listen for extension context invalidation
window.addEventListener('beforeunload', cleanup);

// Initialize when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

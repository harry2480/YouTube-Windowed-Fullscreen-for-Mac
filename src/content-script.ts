/**
 * Content script for YouTube Windowed Fullscreen for Mac
 * Intercepts fullscreen attempts and applies pseudo-fullscreen styling instead
 */

// Constants
const MOVIE_PLAYER_SELECTOR = '#movie_player';

// State
let isFullscreenEnabled = true;
let isPseudoFullscreenActive = false;

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
}

/**
 * Toggle pseudo-fullscreen
 */
function togglePseudoFullscreen(): void {
  const player = getMoviePlayer();
  if (!player) return;

  if (isPseudoFullscreenActive) {
    removePseudoFullscreen(player);
  } else {
    applyPseudoFullscreen(player);
  }
}

/**
 * Handle keyboard events
 */
function handleKeyDown(event: KeyboardEvent): void {
  if (!isFullscreenEnabled) return;

  // Handle 'f' key for fullscreen toggle
  if (event.key === 'f' || event.key === 'F') {
    // Allow normal text input if focused on input field
    if (isFocusedOnInputField()) {
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
    removePseudoFullscreen(getMoviePlayer()!);
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
      const player = getMoviePlayer();
      if (player) {
        removePseudoFullscreen(player);
      }
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

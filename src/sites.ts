/**
 * Shared allow-list logic for the chromeless-maximized-window feature.
 *
 * The chromeless feature only moves a tab into a borderless, maximized popup
 * window — it needs no site-specific selectors — so it can run on any site the
 * user explicitly opts in to. This module is the single source of truth for
 * which origins are allowed, used by both the background worker and the popup.
 */

/** Key in chrome.storage.sync holding the user-added origins (array of strings). */
export const ALLOWED_SITES_KEY = 'allowedSites';

/**
 * Origins that ship always-on. YouTube is covered by the static
 * host_permissions / content_scripts in the manifest, so it is allowed without
 * the user having to grant anything, and it cannot be removed from the UI.
 */
export const DEFAULT_ORIGINS: readonly string[] = ['https://www.youtube.com'];

/** Read the user-added origins (excludes the always-on defaults). */
export async function getUserOrigins(): Promise<string[]> {
  const data = await chrome.storage.sync.get(ALLOWED_SITES_KEY);
  const stored = data[ALLOWED_SITES_KEY] as unknown;
  return Array.isArray(stored) ? stored.filter((o): o is string => typeof o === 'string') : [];
}

/** Read every allowed origin: the defaults plus the user-added ones, deduped. */
export async function getAllowedOrigins(): Promise<string[]> {
  const user = await getUserOrigins();
  return Array.from(new Set([...DEFAULT_ORIGINS, ...user]));
}

/**
 * Normalise a tab URL to a bare origin ("https://drive.google.com"), or null
 * for URLs we can never act on (chrome://, extension pages, file://, ...).
 */
export function originFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    // Chrome host-permission match patterns don't support port numbers, but
    // URL.origin keeps a non-default port ("https://x.com:8080"). Feeding that
    // to permissions.request/contains throws "Invalid match pattern", so reject
    // non-default-port origins rather than generate a broken pattern. (Default
    // ports are normalised away, leaving parsed.port empty.)
    if (parsed.port !== '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** The host-permission match pattern for an origin ("https://example.com/*"). */
export function patternForOrigin(origin: string): string {
  return `${origin}/*`;
}

/** Whether a tab URL belongs to an opted-in origin (allow-list only). */
export async function isOriginAllowed(url: string | undefined): Promise<boolean> {
  const origin = originFromUrl(url);
  if (!origin) return false;
  const allowed = await getAllowedOrigins();
  return allowed.includes(origin);
}

/** Whether the extension currently holds the host permission for an origin. */
export async function hasHostPermission(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [patternForOrigin(origin)] });
  } catch {
    return false;
  }
}

/**
 * Whether the chromeless feature may act on a URL. The origin must be opted in
 * AND the host permission must actually be held on THIS device.
 *
 * The allow-list lives in chrome.storage.sync and so propagates across devices,
 * but host permissions are granted per device and do NOT sync. The list alone
 * is therefore not authoritative: on a second device it could name an origin
 * that was never granted here. Requiring the permission too prevents moving a
 * tab into a chromeless window on a device the user never approved it on.
 * Defaults (YouTube) hold a static host permission, so contains() is true for
 * them as well.
 */
export async function isOriginActionable(url: string | undefined): Promise<boolean> {
  const origin = originFromUrl(url);
  if (!origin) return false;
  const allowed = await getAllowedOrigins();
  if (!allowed.includes(origin)) return false;
  return hasHostPermission(origin);
}

/** Whether an origin is one of the always-on defaults (cannot be removed). */
export function isDefaultOrigin(origin: string): boolean {
  return DEFAULT_ORIGINS.includes(origin);
}

/** Add a user origin to the allow-list (no-op for defaults or duplicates). */
export async function addUserOrigin(origin: string): Promise<void> {
  if (isDefaultOrigin(origin)) return;
  const user = await getUserOrigins();
  if (user.includes(origin)) return;
  user.push(origin);
  await chrome.storage.sync.set({ [ALLOWED_SITES_KEY]: user });
}

/** Remove a user origin from the allow-list (defaults are never stored). */
export async function removeUserOrigin(origin: string): Promise<void> {
  const user = await getUserOrigins();
  const next = user.filter((o) => o !== origin);
  if (next.length === user.length) return;
  await chrome.storage.sync.set({ [ALLOWED_SITES_KEY]: next });
}

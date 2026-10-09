// `@panomc/sdk/svelte` outside a theme (doc 06 section 3.2).
import { readable } from 'svelte/store';
import { getConfig, onConfigure, resolveUrl } from './config.js';
import { activeWidgets, eventTarget, emit, WidgetError } from './runtime.js';

export const browser = true;

/** The site URL; a live binding, updated by `configure`. */
export let base = getConfig().siteUrl;
onConfigure((config) => {
  base = config.siteUrl;
});

/** `{ url, params: {} }` of the page the widget sits on. */
export const page = readable({ url: currentUrl(), params: {} }, (set) => {
  const update = () => set({ url: currentUrl(), params: {} });
  update();
  if (typeof window === 'undefined') return undefined;
  window.addEventListener('popstate', update);
  return () => window.removeEventListener('popstate', update);
});

export const navigating = readable(null);

function currentUrl() {
  try {
    return new URL(globalThis.location.href);
  } catch {
    return new URL('about:blank');
  }
}

/**
 * Raises a cancelable `pano:navigate` { url }; when nobody cancels it, the configured `navigate` hook or `location.assign` runs.
 * @param {string | URL} url a site path, an absolute URL or a key of the URL map
 * @param {{ replaceState?: boolean }} [options]
 */
export async function goto(url, options) {
  const target = resolveUrl(String(url));
  const proceed = emit(eventTarget(), 'pano:navigate', { url: target }, true);
  if (!proceed) return;

  const navigate = getConfig().navigate;
  if (typeof navigate === 'function') {
    navigate(target, { replace: !!options?.replaceState });
    return;
  }
  if (typeof location === 'undefined') return;
  if (options?.replaceState) location.replace(target);
  else location.assign(target);
}

/** SvelteKit's `redirect(status, location)` throws; here it navigates. */
export function redirect(status, location) {
  return goto(String(location));
}

/** Throws a `WidgetError`; the wrapper shows its error state and raises `pano:error`. */
export function error(status, message) {
  throw new WidgetError(Number(status) || 500, typeof message === 'string' ? message : message?.message);
}

/** Re-runs the load of every mounted widget (a widget cannot tell which resource its view depends on). */
export async function invalidateAll() {
  const { clearLoadMemo } = await import('./controllers.js');
  clearLoadMemo();
  await Promise.all(activeWidgets().map((el) => el.reload?.()));
}

export function invalidate(_resource) {
  return invalidateAll();
}

// Page-wide configuration of the widget host (doc 06 section 3.4 / 3.5). `window.PanoWidgets.configure(...)` of the loader
// ends up here. Every other module reads it lazily, so a `configure` call after import still takes effect.
import { createClient } from '@panomc/client';

/**
 * @typedef {Object} WidgetConfig
 * @property {string} apiBase      what precedes `/api/v1`: Pano's origin, a proxy prefix such as `/pano`, or '' (same origin)
 * @property {string} [locale]
 * @property {Record<string,string>} urls   doc 05 URL map: `{ 'market.store': '/shop', 'market.order': '/shop/o/{id}' }`
 * @property {string} siteUrl      the site URL the widgets belong to (index.json `site.url`)
 * @property {typeof fetch} [fetch]
 * @property {(url:string, o?:{replace?:boolean}) => (boolean|void)} [navigate]  called after `pano:navigate` was not cancelled
 * @property {'auto'|'off'} [csrf]
 */

/** @type {WidgetConfig} */
const state = { apiBase: '', locale: undefined, urls: {}, siteUrl: '', fetch: undefined, navigate: undefined, csrf: undefined };

/** @type {any} */
let client = null;
/** @type {Set<(config: WidgetConfig) => void>} */
const listeners = new Set();

/** A prefix such as `/pano` is relative; '' (same origin) and absolute URLs are not. */
export function isRelativeBase(apiBase) {
  if (!apiBase) return false;
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(apiBase);
}

/** @param {Partial<WidgetConfig>} [partial] */
export function configure(partial = {}) {
  if (partial.apiBase !== undefined) state.apiBase = String(partial.apiBase || '').replace(/\/+$/, '');
  if (partial.locale !== undefined) state.locale = partial.locale || undefined;
  if (partial.urls !== undefined) state.urls = { ...partial.urls };
  if (partial.siteUrl !== undefined) state.siteUrl = String(partial.siteUrl || '').replace(/\/+$/, '');
  if (partial.fetch !== undefined) state.fetch = partial.fetch;
  if (partial.navigate !== undefined) state.navigate = partial.navigate;
  if (partial.csrf !== undefined) state.csrf = partial.csrf;

  client = null;
  for (const fn of [...listeners]) fn(state);
  return getConfig();
}

/** @returns {Readonly<WidgetConfig & { csrf: 'auto'|'off' }>} */
export function getConfig() {
  return { ...state, csrf: state.csrf ?? (isRelativeBase(state.apiBase) ? 'off' : 'auto') };
}

/** Back to the defaults (tests). */
export function resetConfig() {
  Object.assign(state, { apiBase: '', locale: undefined, urls: {}, siteUrl: '', fetch: undefined, navigate: undefined, csrf: undefined });
  client = null;
  for (const fn of [...listeners]) fn(state);
}

/** @param {(config: WidgetConfig) => void} fn @returns {() => void} */
export function onConfigure(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The page's `fetch`: the configured one, else the global one at call time. */
export function pageFetch(...args) {
  const impl = state.fetch ?? globalThis.fetch;
  return impl(...args);
}

/** The page's single `@panomc/client`. */
export function getClient() {
  if (!client) {
    const config = getConfig();
    client = createClient({
      baseUrl: config.apiBase,
      fetch: (...args) => pageFetch(...args),
      locale: config.locale,
      credentials: 'include',
      csrf: config.csrf,
    });
  }
  return client;
}

/**
 * Resolves a key of the URL map (`market.order` + `{ id: 7 }`) or a site path (`/shop`) against the site URL.
 * Absolute URLs and unknown keys come back unchanged.
 * @param {string} keyOrPath
 * @param {Record<string, any>} [params]
 */
export function resolveUrl(keyOrPath, params) {
  let target = state.urls[keyOrPath] ?? keyOrPath;
  if (params) {
    target = target.replace(/\{([^}]+)\}/g, (whole, name) =>
      params[name] === undefined || params[name] === null ? whole : encodeURIComponent(String(params[name])),
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return target;
  if (target.startsWith('/') && state.siteUrl) return `${state.siteUrl}${target}`;
  return target;
}

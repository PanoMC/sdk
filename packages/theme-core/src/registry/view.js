/**
 * Small, framework-light helpers on top of the view registry (doc 01 §5).
 *
 *   blockKey(id, props)  the key under which `loadView` returns the data of one
 *                        <PluginBlock> placement and under which PluginBlock
 *                        reads it back from `$page.data`
 *   pluginView(id)       a component that renders the registered view `id`
 *                        (the theme's override, else the plugin's default)
 *
 * registry/index.js imports blockKey from here and this file imports the sync
 * getters from there; every export below is a function declaration, and nothing
 * runs at module-evaluation time, so the cycle is harmless.
 */

import { getDefault, getOverride } from "./index.js";

/**
 * Only string, number and boolean props take part in a block's identity (the
 * theme-meta scan only sees literal attributes, doc 01 §4 "Theme meta").
 * @param {unknown} value
 */
function isPrimitiveProp(value) {
  const t = typeof value;
  return t === "string" || t === "boolean" || (t === "number" && Number.isFinite(value));
}

/**
 * Stable JSON of the primitive props, keys sorted. Non-primitive and undefined
 * props are left out, so `{ a: 1, onclick: fn }` and `{ a: 1 }` are one block.
 * @param {Record<string, unknown> | null | undefined} props
 * @returns {string}
 */
export function stableJson(props) {
  /** @type {Record<string, string | number | boolean>} */
  const sorted = {};
  for (const key of Object.keys(props ?? {}).sort()) {
    const value = /** @type {any} */ (props)[key];
    if (isPrimitiveProp(value)) sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

/**
 * `"block:" + id + "#" + stableJson(primitive props, sorted)`.
 * @param {string} id  view id exactly as written at the placement
 * @param {Record<string, unknown> | null | undefined} [props]
 * @returns {string}
 */
export function blockKey(id, props) {
  return "block:" + id + "#" + stableJson(props);
}

/** Renders nothing: a Svelte 5 component with an empty body. */
function Empty() {}

/**
 * A component that renders the registered view `id` at render time:
 * override first, then the plugin's default, nothing when the view is unknown.
 * Both are read synchronously, so the view (and its closure) must have been
 * preloaded by `loadView` / `preloadViews`.
 * @param {string} id  `<ns>:<Name>`, `<pluginId>:<Name>` or an engine name
 * @returns {(anchorOrPayload: any, props?: any) => any}
 */
export function pluginView(id) {
  return function PluginView(anchorOrPayload, props) {
    const Component = getOverride(id) ?? getDefault(id) ?? Empty;
    return Component(anchorOrPayload, props);
  };
}

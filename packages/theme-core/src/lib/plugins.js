// "Is plugin X installed?" for theme code (`$pano/lib/plugins.js`).
//
// The answer is `siteInfo.plugins` (GET /api/v1/site-info): one entry per installed AND running plugin, keyed by the
// full plugin id, `{ version: string | null, uiHash: string, dependencies: string[] }`. It is the same object the layout
// already carries in `session.siteInfo`, so these helpers take it as an argument and keep no state of their own: that
// is what makes them safe during SSR (nothing is shared between requests) and reactive in a component (pass the store
// value, `$session.siteInfo`, and the markup follows the store). The plugin list is read once per page load and changes
// only when the site info is reloaded (a plugin is installed or switched on by restarting Pano).
import { pluginIdOf } from "@panomc/sdk/core/js/ControllerRegistry.js";

/** @typedef {{ version: string | null, uiHash: string, dependencies: string[] }} PluginEntry */

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * The key of `idOrNamespace` in the plugins map, or null. The full plugin id (`pano-plugin-market`) is canonical;
 * the short namespace (`market`) is accepted too, resolved like `plugin('market')` does: the namespace the plugin
 * registered its controllers under, else `pano-plugin-<namespace>`.
 * @param {Record<string, PluginEntry> | null | undefined} plugins
 * @param {unknown} idOrNamespace
 * @returns {string | null}
 */
function keyOf(plugins, idOrNamespace) {
  if (!plugins || typeof plugins !== "object" || typeof idOrNamespace !== "string" || !idOrNamespace) return null;

  if (has(plugins, idOrNamespace)) return idOrNamespace;

  const registered = pluginIdOf(idOrNamespace);
  if (registered && has(plugins, registered)) return registered;

  const conventional = `pano-plugin-${idOrNamespace}`;
  return has(plugins, conventional) ? conventional : null;
}

/**
 * The site info entry of an installed, running plugin (`{ version, uiHash, dependencies }`), or null.
 * @param {{ plugins?: Record<string, PluginEntry> } | null | undefined} siteInfo  `session.siteInfo`
 * @param {string} idOrNamespace  `"pano-plugin-market"` (canonical) or `"market"`
 * @returns {PluginEntry | null}
 */
export function pluginInfo(siteInfo, idOrNamespace) {
  const plugins = siteInfo?.plugins;
  const key = keyOf(plugins, idOrNamespace);
  return key === null ? null : plugins[key];
}

/**
 * True when the plugin is installed and running. False for an unknown plugin and while there is no site info yet.
 * @example
 * // in a +page.js / load()
 * const { session } = await parent();
 * const shop = hasPlugin(session.siteInfo, "market");
 * // in a component
 * {#if hasPlugin($session.siteInfo, "pano-plugin-market")} ... {/if}
 * @param {{ plugins?: Record<string, PluginEntry> } | null | undefined} siteInfo  `session.siteInfo`
 * @param {string} idOrNamespace  `"pano-plugin-market"` (canonical) or `"market"`
 * @returns {boolean}
 */
export function hasPlugin(siteInfo, idOrNamespace) {
  return keyOf(siteInfo?.plugins, idOrNamespace) !== null;
}

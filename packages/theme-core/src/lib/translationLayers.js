// Pure merge of the four text layers (doc 03 section 5.3). No framework imports.
//
// Order, later wins:
//   1. plugin defaults      api.plugins[id][key]            for keys NOT in pluginAdminKeys[id]
//   2. theme file           theme                           (core + theme-own keys)
//   3. theme plugin files   themePlugins[folder][key]       folder = plugin namespace or full id
//   4. admin edits          every non-`plugins` key of api, plus api.plugins[id][key] for keys in
//                           pluginAdminKeys[id]
//
// The result is a FLAT dictionary: plugin keys are `plugins.<id>.<key>`. A plugin id may contain
// dots, so nothing here splits a key on "." after the id is attached.

/**
 * @typedef {object} TranslationLayers
 * @property {Record<string, any>} [theme]         `lang/<locale>.json`: core + theme-own keys, nested
 * @property {Record<string, any>} [themePlugins]  `lang/<locale>.plugins.json`: `{ <folder>: { ...nested } }`
 * @property {Record<string, any>} [api]           translations API `data`: nested, `plugins.<id>` holds plugin keys
 * @property {Record<string, string[]>} [pluginAdminKeys]  translations API `meta.pluginAdminKeys`
 * @property {{ id: string, namespace: string }[]} [plugins]  installed plugins
 */

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** @param {unknown} value */
function isTree(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Flatten a nested tree into `out`, joining keys with ".". Arrays and scalars are leaves.
 * @param {unknown} tree
 * @param {string} prefix
 * @param {Record<string, any>} out
 * @param {(flatKey: string) => boolean} [skip]  keys (relative to the tree) that are left out
 * @param {string} [relative]
 */
function flatten(tree, prefix, out, skip, relative = "") {
  if (!isTree(tree)) {
    return out;
  }

  for (const key of Object.keys(tree)) {
    if (UNSAFE_KEYS.has(key)) {
      continue;
    }

    const value = /** @type {Record<string, any>} */ (tree)[key];
    const rel = relative ? `${relative}.${key}` : key;

    if (isTree(value)) {
      flatten(value, prefix, out, skip, rel);
    } else if (!skip || !skip(rel)) {
      out[prefix ? `${prefix}.${rel}` : rel] = value;
    }
  }

  return out;
}

/**
 * Resolve each `themePlugins` folder to an installed plugin id. A folder is the plugin's
 * namespace or its full id; the full id wins when both could apply. Folders that match no
 * installed plugin are ignored (the dev server warns about them).
 * @param {Record<string, any>} themePlugins
 * @param {{ id: string, namespace: string }[]} plugins
 * @returns {{ id: string, tree: any }[]}  namespace folders first, id folders after
 */
function resolveFolders(themePlugins, plugins) {
  const byNamespace = [];
  const byId = [];

  for (const folder of Object.keys(themePlugins)) {
    const plugin = plugins.find((p) => p.id === folder);

    if (plugin) {
      byId.push({ id: plugin.id, tree: themePlugins[folder] });
      continue;
    }

    const owner = plugins.find((p) => p.namespace === folder);

    if (owner) {
      byNamespace.push({ id: owner.id, tree: themePlugins[folder] });
    }
  }

  return [...byNamespace, ...byId];
}

/**
 * @param {TranslationLayers} layers  nested trees as fetched
 * @returns {Record<string, string>}  flat dictionary, plugin keys as `plugins.<id>.<key>`
 */
export function mergeTranslationLayers(layers) {
  const { theme, themePlugins, api, pluginAdminKeys, plugins } = layers ?? {};
  const adminKeys = isTree(pluginAdminKeys) ? pluginAdminKeys : {};
  const installed = Array.isArray(plugins) ? plugins : [];

  /** @type {Record<string, any>} */
  const result = {};

  const apiPlugins = isTree(api?.plugins) ? api.plugins : {};
  const adminSets = new Map();

  for (const id of Object.keys(apiPlugins)) {
    const list = adminKeys[id];

    adminSets.set(id, new Set(Array.isArray(list) ? list : []));
  }

  // 1. plugin defaults (everything the admin did not edit)
  for (const id of Object.keys(apiPlugins)) {
    const admin = adminSets.get(id);

    flatten(apiPlugins[id], `plugins.${id}`, result, (key) => admin.has(key));
  }

  // 2. theme file
  flatten(theme, "", result);

  // 3. theme's plugin overrides
  if (isTree(themePlugins)) {
    for (const { id, tree } of resolveFolders(themePlugins, installed)) {
      flatten(tree, `plugins.${id}`, result);
    }
  }

  // 4. admin edits: every non-plugins key of the API, then the edited plugin keys
  if (isTree(api)) {
    const { plugins: _plugins, ...rest } = /** @type {Record<string, any>} */ (api);

    flatten(rest, "", result);
  }

  for (const id of Object.keys(apiPlugins)) {
    const admin = adminSets.get(id);

    if (admin.size > 0) {
      flatten(apiPlugins[id], `plugins.${id}`, result, (key) => !admin.has(key));
    }
  }

  return result;
}

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Plugin-level configuration of the kit (doc 01 section 1, doc 02 section 4).
 *
 * The plugin id comes from `gradle.properties`; everything else is optional and
 * lives in `pano.plugin.js` beside it:
 *
 *   export default { namespace: "market", viewDirs: ["src/theme/pages"], styles: {} };
 */

/** Prefix stripped from a plugin id to get its default namespace (and nothing else is stripped). */
export const PLUGIN_ID_PREFIX = "pano-plugin-";

/** Namespaces no plugin may take: they are tokens of the view and route model. */
export const RESERVED_NAMESPACES = Object.freeze([
  "theme",
  "page",
  "pano",
  "core",
  "route",
  "home",
  "block",
]);

/** Default view folders when `pano.plugin.js` does not set `viewDirs`. */
export const DEFAULT_VIEW_DIRS = Object.freeze(["src/theme/views"]);

const NAMESPACE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @typedef {object} PluginConfigFile
 * @property {string} [namespace] overrides the namespace derived from the plugin id
 * @property {string[]} [viewDirs] folders (relative to the plugin root) holding view files
 * @property {Record<string, any>} [styles] doc 03 options (`safelist`, `styleAttrAllow`, ...)
 */

/**
 * @typedef {object} KitConfig
 * @property {string} pluginId full plugin id, e.g. `pano-plugin-market`
 * @property {string} namespace short namespace, e.g. `market`
 * @property {string[]} viewDirs view folders relative to the plugin root
 * @property {Record<string, any>} styles `styles` of `pano.plugin.js` (`{}` when absent)
 * @property {string | null} sdkDir absolute `PANO_SDK_DIR` (local delivery), else `null`
 */

/**
 * The namespace of a plugin: `config.namespace` when set, else the plugin id minus a
 * leading `pano-plugin-` (nothing else is stripped). Throws on a malformed or
 * reserved namespace. The backend reads the value this function produced from
 * `views.json` / `pano-plugin.json`, falling back to the same rule.
 *
 * @param {string} pluginId
 * @param {PluginConfigFile | null | undefined} [config]
 * @returns {string}
 */
export function namespaceOf(pluginId, config) {
  if (typeof pluginId !== "string" || pluginId.length === 0) {
    throw new Error("[pano-plugin] pluginId is required to derive the namespace");
  }

  const explicit = config?.namespace;
  const namespace =
    explicit !== undefined && explicit !== null
      ? explicit
      : pluginId.startsWith(PLUGIN_ID_PREFIX) &&
          pluginId.length > PLUGIN_ID_PREFIX.length
        ? pluginId.slice(PLUGIN_ID_PREFIX.length)
        : pluginId;

  if (typeof namespace !== "string" || !NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      `[pano-plugin] namespace "${namespace}" of ${pluginId} is invalid: use lowercase letters, digits and "-" (set namespace in pano.plugin.js)`,
    );
  }

  if (RESERVED_NAMESPACES.includes(namespace)) {
    throw new Error(
      `[pano-plugin] namespace "${namespace}" of ${pluginId} is reserved (${RESERVED_NAMESPACES.join(", ")}): set another one with namespace in pano.plugin.js`,
    );
  }

  return namespace;
}

/**
 * Reads `key=value` from a `.properties` file (first match, `#` comments skipped).
 *
 * @param {string} file
 * @param {string} key
 * @returns {string | null}
 */
export function readProperty(file, key) {
  let text;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#") || line.startsWith("!")) continue;

    const separator = line.search(/[=:]/);

    if (separator < 0) continue;

    if (line.slice(0, separator).trim() === key) {
      return line.slice(separator + 1).trim();
    }
  }

  return null;
}

/**
 * @param {string} root
 * @returns {Promise<PluginConfigFile>}
 */
async function readPluginConfigFile(root) {
  const file = path.join(root, "pano.plugin.js");

  if (!fs.existsSync(file)) return {};

  const module = await import(pathToFileURL(file).href);
  const config = module.default ?? {};

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error(
      "[pano-plugin] pano.plugin.js must export default an object: { namespace?, viewDirs?, styles? }",
    );
  }

  return config;
}

/**
 * Loads the kit configuration of the plugin in `root`.
 *
 * @param {string} [root] plugin root, default the current directory
 * @returns {Promise<KitConfig>}
 */
export async function loadConfig(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const pluginId = readProperty(
    path.join(absoluteRoot, "gradle.properties"),
    "pluginId",
  );

  if (!pluginId) {
    throw new Error(
      `[pano-plugin] no pluginId in ${path.join(absoluteRoot, "gradle.properties")}: add a line "pluginId=pano-plugin-<name>"`,
    );
  }

  const file = await readPluginConfigFile(absoluteRoot);

  let viewDirs = [...DEFAULT_VIEW_DIRS];

  if (file.viewDirs !== undefined) {
    if (
      !Array.isArray(file.viewDirs) ||
      file.viewDirs.length === 0 ||
      file.viewDirs.some((dir) => typeof dir !== "string" || dir.length === 0)
    ) {
      throw new Error(
        '[pano-plugin] viewDirs in pano.plugin.js must be a non-empty array of folder paths, e.g. ["src/theme/views"]',
      );
    }

    viewDirs = file.viewDirs.map((dir) => dir.replace(/\\/g, "/").replace(/\/+$/, ""));
  }

  const sdkEnv = process.env.PANO_SDK_DIR;

  return {
    pluginId,
    namespace: namespaceOf(pluginId, file),
    viewDirs,
    styles:
      file.styles && typeof file.styles === "object" && !Array.isArray(file.styles)
        ? file.styles
        : {},
    sdkDir: sdkEnv ? path.resolve(absoluteRoot, sdkEnv) : null,
  };
}

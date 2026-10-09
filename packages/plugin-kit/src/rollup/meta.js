import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { nullHost } from "../controller/index.js";
import { readLock, writeLockSection, diffSection } from "./lock.js";
import { loadConfig } from "../config.js";
import {
  ensureControllersBuilt,
  resetControllersBuild,
  resolvePaths,
  writeIfChanged,
} from "./controllers.js";

/**
 * Key enumeration of the built controllers and the package index (doc 02 section 5.2).
 *
 * Nothing here is typed by the author: the build imports the fresh `controllers.mjs`, calls
 * `create(name, nullHost, {})` and reads the keys of the state and of the actions. It writes
 *
 *   contract/controllers.json   { "<ns>/<name>": { version, scope, state, actions, types } }
 *   pano-plugin.json            the package index (format, pluginId, namespace, version, sdk, views, styles, badges)
 *
 * and keeps the `controllers` section of `pano-plugin.lock.json`: a key removed without a raised
 * `version` fails `build` and is one warning line in watch.
 *
 * THE SHARED BUILD CONTEXT. The other kit plugins (views, helpers, samples, styles, widgets) tell the
 * package index what they found by writing to the context of the plugin root:
 *
 *   import { getBuildContext } from "./meta.js";
 *   const ctx = getBuildContext(root);
 *   ctx.views.ProductCard = { samples: ["filled"], controllers: { "market/cart": 1 }, helpers: ["lib/sale.js"],
 *                             roots: ["div"], classes: ["market-product-card"] };   // merged, extra keys (attrs) are kept
 *   ctx.styles = { fallback: "client/fallback.css", own: "client/plugin.css", hash: "9f2c1a7e", icons: true };
 *   ctx.badges.semanticClasses = true;                                              // controllers is computed here
 *   ctx.viewImports = "warn";                                                       // migration mode
 *
 * The context lives on `globalThis` under `Symbol.for("pano.plugin-kit.build-context")` (a Map keyed
 * by the absolute plugin root), so two copies of the kit still share it. View names that are only in
 * `contract/views.json` (written by panoViews) are listed with empty entries.
 */

const CONTEXT_KEY = Symbol.for("pano.plugin-kit.build-context");

/**
 * @typedef {object} ViewInfo
 * @property {string[]} [samples] state names of the view's samples file
 * @property {Record<string, number>} [controllers] literal controller names used by the view, with their versions
 * @property {string[]} [helpers] helper closure, paths under `src/theme`
 * @property {string[]} [roots] root element tags
 * @property {string[]} [classes] semantic classes of the view
 */

/**
 * @typedef {object} BuildContext
 * @property {Record<string, ViewInfo & Record<string, any>>} views by view name (`ProductCard`, not `market:ProductCard`)
 * @property {{ fallback?: string, own?: string, hash?: string, icons?: boolean } | null} styles
 * @property {{ samples?: boolean, semanticClasses?: boolean, widgets?: boolean, openapi?: boolean }} badges
 * @property {'warn' | undefined} viewImports
 */

/**
 * The shared build context of one plugin root (created on first use).
 *
 * @param {string} [root] plugin root, default the current directory
 * @returns {BuildContext}
 */
export function getBuildContext(root = process.cwd()) {
  const store = (globalThis[CONTEXT_KEY] ??= new Map());
  const key = path.resolve(root);

  if (!store.has(key)) {
    store.set(key, { views: {}, styles: null, badges: {}, viewImports: undefined });
  }

  return store.get(key);
}

/**
 * `cart` -> `Cart`, `cartItems` -> `CartItems`.
 *
 * @param {string} name
 * @returns {string}
 */
export function pascal(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Names of the typedefs of a controller in `controllers.types.js` (declared by the author, else generated).
 *
 * @param {string} name controller name without namespace
 * @returns {{ state: string, actions: string }}
 */
export function typeNames(name) {
  return { state: `${pascal(name)}State`, actions: `${pascal(name)}Actions` };
}

/**
 * @typedef {object} EnumeratedController
 * @property {number} version
 * @property {'app' | 'instance'} scope
 * @property {string[]} state keys of the initial state
 * @property {string[]} actions names of the actions
 */

/**
 * @typedef {object} Enumeration
 * @property {string} namespace
 * @property {string} pluginId
 * @property {Record<string, EnumeratedController>} controllers by short name, sorted
 */

/**
 * @typedef {object} MetaOptions
 * @property {string} [pluginId] default: `pluginId` of gradle.properties
 * @property {string} [namespace] default: derived like the rest of the kit
 * @property {string} [outDir] package folder, default `src/main/resources/plugin-ui`
 * @property {string} [root] plugin root, default the current directory
 * @property {string} [dir] controllers folder, default `src/theme/controllers`
 * @property {string} [version] plugin version for pano-plugin.json, default: package.json, else 0.0.0
 * @property {number} [sdk] panoSdk level the package was built for, default 2
 * @property {boolean} [watch] treat the build as a watch build (default: rollup's `watchMode`)
 */

/** @type {Map<string, Promise<Enumeration>>} */
const enumerations = new Map();

/**
 * @param {MetaOptions} options
 * @returns {string}
 */
function enumerationKey(options) {
  const { root, dir, outDir } = resolvePaths(options);

  return [root, dir, outDir].join("\0");
}

/**
 * Imports the fresh controllers.mjs and reads the keys of every controller. Shared by the plugins of
 * one build cycle.
 *
 * @param {MetaOptions} options
 * @returns {Promise<Enumeration>}
 */
export function enumerateControllers(options) {
  const key = enumerationKey(options);
  let promise = enumerations.get(key);

  if (!promise) {
    promise = doEnumerate(options);
    promise.catch(() => {});
    enumerations.set(key, promise);
  }

  return promise;
}

/**
 * Starts a new build cycle for the enumeration (the controllers build is reset by panoControllers).
 *
 * @param {MetaOptions} options
 */
export function resetEnumeration(options) {
  enumerations.delete(enumerationKey(options));
}

/**
 * Imports a copy of the file under a name never used before: some runtimes (Bun) ignore a query string
 * in their module cache, and the file is self-contained, so it runs anywhere.
 *
 * @param {string} file
 * @returns {Promise<any>}
 */
async function importFresh(file) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pano-kit-controllers-"));
  const copy = path.join(folder, "controllers.mjs");

  try {
    fs.copyFileSync(file, copy);

    return await import(pathToFileURL(copy).href);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * @param {MetaOptions} options
 * @returns {Promise<Enumeration>}
 */
async function doEnumerate(options) {
  const built = await ensureControllersBuilt(options);
  let { pluginId, namespace } = options;

  if (!pluginId || !namespace) {
    const config = await loadConfig(resolvePaths(options).root);

    pluginId = pluginId || config.pluginId;
    namespace = namespace || config.namespace;
  }

  /** @type {Enumeration} */
  const result = { namespace, pluginId, controllers: {} };

  if (!built.file) return result;

  const mod = await importFresh(built.file);

  for (const name of Object.keys(mod.controllers).sort()) {
    const definition = mod.controllers[name];
    let controller;

    try {
      controller = mod.create(name, nullHost, {});

      result.controllers[name] = {
        version: definition.version,
        scope: definition.scope,
        state: Object.keys(controller.get() ?? {}),
        actions: Object.keys(controller.actions ?? {}),
      };
    } catch (error) {
      throw new Error(
        `[pano-plugin] ${namespace}/${name}: cannot read its keys on the null host (${error?.message ?? error}) — state() and actions() must run without the network or the browser; do that work in start() or inside an action`,
      );
    } finally {
      try {
        controller?.destroy();
      } catch {
        // enumeration only
      }
    }
  }

  return result;
}

/**
 * The `controllers` section of the lock file: `{ "<ns>/<name>": { version, state, actions } }`.
 *
 * @param {Enumeration} enumeration
 * @returns {Record<string, { version: number, state: string[], actions: string[] }>}
 */
export function lockSectionOf(enumeration) {
  /** @type {Record<string, any>} */
  const section = {};

  for (const [name, info] of Object.entries(enumeration.controllers)) {
    section[`${enumeration.namespace}/${name}`] = {
      version: info.version,
      state: info.state,
      actions: info.actions,
    };
  }

  return section;
}

/**
 * `contract/controllers.json` content.
 *
 * @param {Enumeration} enumeration
 * @returns {Record<string, any>}
 */
export function controllersContract(enumeration) {
  /** @type {Record<string, any>} */
  const contract = {};

  for (const [name, info] of Object.entries(enumeration.controllers)) {
    contract[`${enumeration.namespace}/${name}`] = {
      version: info.version,
      scope: info.scope,
      state: info.state,
      actions: info.actions,
      types: typeNames(name),
    };
  }

  return contract;
}

/**
 * Compares with the committed lock and updates it.
 *
 * @param {Enumeration} enumeration
 * @param {{ root: string, watch: boolean, warn: (message: string) => void }} context
 * @returns {{ written: boolean, breaking: string[] }}
 * @throws {Error} outside watch mode when a key was removed without a raised version
 */
export function checkControllerLock(enumeration, { root, watch, warn }) {
  const next = lockSectionOf(enumeration);
  const previous = readLock(root).controllers;
  const { breaking } = diffSection("controllers", previous, next);

  if (breaking.length > 0) {
    if (!watch) {
      throw new Error(
        `[pano-plugin] ${breaking.join("\n[pano-plugin] ")}\n[pano-plugin] (never published? delete pano-plugin.lock.json)`,
      );
    }

    for (const message of breaking) warn(`[pano-plugin] ${message}`);

    return { written: false, breaking };
  }

  if (watch) return { written: false, breaking };

  return { written: writeLockSection(root, "controllers", next), breaking };
}

/**
 * @param {Record<string, any>} value
 * @returns {Record<string, any>}
 */
function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * @param {string} root
 * @param {string | undefined} given
 * @returns {string}
 */
function versionOf(root, given) {
  if (given) return given;

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

    if (typeof pkg.version === "string" && pkg.version) return pkg.version;
  } catch {
    // no package.json
  }

  return "0.0.0";
}

/**
 * View names written by panoViews to `contract/views.json` (keys are `<ns>:<Name>`).
 *
 * @param {string} outDir
 * @returns {string[] | null} null when the file does not exist
 */
function viewNamesOnDisk(outDir) {
  const file = path.join(outDir, "contract", "views.json");

  if (!fs.existsSync(file)) return null;

  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));

    return Object.keys(json.views ?? {}).map((id) => id.slice(id.indexOf(":") + 1));
  } catch {
    return [];
  }
}

/**
 * Builds the content of `pano-plugin.json`.
 *
 * @param {MetaOptions} options
 * @param {Enumeration} enumeration
 * @param {BuildContext} context
 * @returns {Record<string, any>}
 */
export function packageIndex(options, enumeration, context) {
  const { root, outDir } = resolvePaths(options);
  const names = new Set(Object.keys(context.views));
  const onDisk = viewNamesOnDisk(outDir);

  for (const name of onDisk ?? []) names.add(name);

  /** @type {Record<string, any>} */
  const views = {};

  for (const name of [...names].sort()) {
    const entry = { samples: [], controllers: {}, helpers: [], roots: [], classes: [] };

    Object.assign(entry, context.views[name] ?? {});
    entry.controllers = sortedObject(entry.controllers ?? {});
    views[name] = entry;
  }

  const hasControllers = Object.keys(enumeration.controllers).length > 0;
  /** @type {Record<string, any>} */
  const index = {
    format: 1,
    pluginId: enumeration.pluginId,
    namespace: enumeration.namespace,
    version: versionOf(root, options.version),
    sdk: options.sdk ?? 2,
  };

  if (context.viewImports === "warn" || process.env.PANO_VIEW_IMPORTS === "warn") {
    index.viewImports = "warn";
  }

  if (onDisk || Object.keys(context.views).length > 0) index.contract = "contract/views.json";
  if (hasControllers) index.controllers = "contract/controllers.json";

  index.views = views;

  if (context.styles) index.styles = context.styles;

  index.badges = {
    controllers: hasControllers,
    samples: context.badges.samples === true,
    semanticClasses: context.badges.semanticClasses === true,
    widgets: context.badges.widgets === true,
    openapi: context.badges.openapi === true,
  };

  return index;
}

/**
 * Writes `pano-plugin.json` from the context as it is right now. Exported so a command can
 * refresh the index without a rollup run.
 *
 * @param {MetaOptions} options
 * @returns {Promise<boolean>} true when the file changed
 */
export async function writePackageIndex(options) {
  const { root, outDir } = resolvePaths(options);
  const enumeration = await enumerateControllers(options);
  const index = packageIndex(options, enumeration, getBuildContext(root));

  return writeIfChanged(path.join(outDir, "pano-plugin.json"), JSON.stringify(index, null, 2) + "\n");
}

/**
 * Key enumeration of the built controllers, `contract/controllers.json`, the controllers lock
 * section and `pano-plugin.json` (doc 02 section 5.2). List it in the same configuration as
 * `panoControllers` (the preset does): `controllers.json` and the lock are handled in `writeBundle`,
 * `pano-plugin.json` in `closeBundle`, after the other plugins of the configuration had their say.
 *
 * @param {MetaOptions} options
 * @returns {import('rollup').Plugin}
 */
export function panoMeta(options) {
  const { root, outDir } = resolvePaths(options);

  return {
    name: "pano-meta",
    buildStart() {
      resetControllersBuild(options);
      resetEnumeration(options);
    },
    async writeBundle() {
      const enumeration = await enumerateControllers(options);
      const watch = options.watch ?? Boolean(this.meta?.watchMode);

      checkControllerLock(enumeration, {
        root,
        watch,
        warn: (message) => this.warn(message),
      });

      const file = path.join(outDir, "contract", "controllers.json");

      if (Object.keys(enumeration.controllers).length > 0) {
        writeIfChanged(file, JSON.stringify(controllersContract(enumeration), null, 2) + "\n");
      } else {
        fs.rmSync(file, { force: true });
      }
    },
    async closeBundle() {
      try {
        await enumerateControllers(options);
      } catch {
        return; // writeBundle reported it
      }

      await writePackageIndex(options);
    },
  };
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rollup } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import { loadConfig } from "../config.js";

/**
 * Standalone controllers (doc 02 section 2 and 5.1): the second build of a plugin.
 *
 * Every default export directly under `src/theme/controllers` (not `_*.js`, not `types.js`, no
 * sub-folders) is bundled, together with the controller core of this kit and every npm package
 * the controllers import, into ONE minified ES module with no import statement:
 *
 *   <outDir>/controllers/controllers.mjs
 *     export const controllers   name -> definition   ({ cart: ControllerDefinition, ... })
 *     export const createHost    = createFetchHost
 *     export function create(name, host, params?, initial?)   -> Controller
 *     export const meta          { format, pluginId, namespace, controllers: { name: { version, scope } } }
 *
 * `create` behaves like the registry of the theme: an `app` controller is one per host (the second
 * call returns the first one, whatever `params` it gets), an `instance` controller is new on every
 * call, `ctx.use(name)` reaches a sibling made on the same host.
 */

const CORE_FILE = fileURLToPath(new URL("../controller/index.js", import.meta.url));
const ENTRY_ID = "pano:controllers-standalone";
const RESOLVED_ENTRY_ID = "\0" + ENTRY_ID;

export const DEFAULT_CONTROLLERS_DIR = "src/theme/controllers";
export const DEFAULT_OUT_DIR = "src/main/resources/plugin-ui";

/** Specifiers a controller must never reach (rule V2, doc 02 section 5.4). */
const FORBIDDEN = /^(svelte(\/.*)?|svelte-i18n|@panomc\/sdk(\/.*)?|\$app\/.*|.*\.svelte)$/;

/**
 * @typedef {object} ControllersOptions
 * @property {string} [root] plugin root, default the current directory
 * @property {string} [dir] controllers folder, default `src/theme/controllers`
 * @property {string} [outDir] package folder, default `src/main/resources/plugin-ui`
 * @property {string} [pluginId] default: `pluginId` of gradle.properties
 * @property {string} [namespace] default: derived like the rest of the kit
 * @property {import('rollup').Plugin[]} [plugins] extra plugins for the standalone build (the preset passes its rules here)
 */

/**
 * @param {ControllersOptions} options
 * @returns {{ root: string, dir: string, outDir: string }}
 */
export function resolvePaths(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());

  return {
    root,
    dir: path.resolve(root, options.dir ?? DEFAULT_CONTROLLERS_DIR),
    outDir: path.resolve(root, options.outDir ?? DEFAULT_OUT_DIR),
  };
}

/**
 * The public controller files, sorted: `*.js` directly in the folder, without `_*.js` and `types.js`.
 *
 * @param {string} dir absolute controllers folder
 * @returns {string[]} absolute paths
 */
export function listControllerFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".js") &&
        !entry.name.startsWith("_") &&
        entry.name !== "types.js",
    )
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

/**
 * Every `.js` file under the folder that holds the controllers and the view helpers (`src/theme`),
 * so watch mode sees helper edits too.
 *
 * @param {string} dir absolute controllers folder
 * @returns {string[]}
 */
export function themeSourceFiles(dir) {
  const base = path.dirname(dir);
  /** @type {string[]} */
  const out = [];

  const walk = (folder) => {
    let entries;

    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules") continue;

      const full = path.join(folder, entry.name);

      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) out.push(full);
    }
  };

  if (fs.existsSync(base)) walk(base);

  return out.sort();
}

/**
 * Writes a file through a temporary name and a rename, and not at all when the content is the same.
 *
 * @param {string} file
 * @param {string} text
 * @returns {boolean} true when the file was written
 */
export function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const temporary = `${file}.${process.pid}.tmp`;

  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);

  return true;
}

/**
 * @param {string} root
 * @param {string} file
 * @returns {string}
 */
function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * Source of the virtual entry module of the standalone build.
 *
 * @param {{ files: string[], pluginId: string, namespace: string, root: string, dir: string }} input
 * @returns {string}
 */
function entrySource({ files, pluginId, namespace, root, dir }) {
  const imports = files
    .map((file, index) => `import d${index} from ${JSON.stringify(file)};`)
    .join("\n");
  const list = files
    .map((file, index) => `[${JSON.stringify(path.basename(file))}, d${index}]`)
    .join(", ");
  const header = JSON.stringify({ format: 1, pluginId, namespace });

  return `import { createFetchHost, nullHost } from ${JSON.stringify(CORE_FILE)};
${imports}

const list = [${list}];
export const controllers = {};
for (const [file, definition] of list) {
  if (!definition || typeof definition.create !== "function" || typeof definition.name !== "string") {
    throw new Error("controllers/" + file + ": the default export must be defineController({ ... })");
  }
  if (controllers[definition.name]) {
    throw new Error("controllers/" + file + ": the controller name '" + definition.name + "' is already used by another file");
  }
  controllers[definition.name] = definition;
}

export const createHost = createFetchHost;

export const meta = Object.freeze({
  ...${header},
  controllers: Object.fromEntries(
    Object.entries(controllers).map(([name, definition]) => [name, { version: definition.version, scope: definition.scope }]),
  ),
});

const perHost = new WeakMap();

export function create(name, host, params, initial) {
  const definition = Object.prototype.hasOwnProperty.call(controllers, name) ? controllers[name] : undefined;
  if (!definition) {
    throw new Error("controller '" + meta.namespace + "/" + name + "' is not in this package (available: " + (Object.keys(controllers).join(", ") || "none") + ")");
  }
  const theHost = host || nullHost;
  const shared = definition.scope === "app";
  let cache = null;
  if (shared) {
    cache = perHost.get(theHost);
    if (!cache) perHost.set(theHost, (cache = new Map()));
    const hit = cache.get(name);
    if (hit) return hit;
  }
  const controller = definition.create(theHost, params, initial, {
    namespace: meta.namespace,
    use: (other) => create(other, theHost, {}),
  });
  if (shared) {
    cache.set(name, controller);
    const destroy = controller.destroy;
    controller.destroy = () => {
      if (cache.get(name) === controller) cache.delete(name);
      destroy();
    };
  }
  return controller;
}
`;
}

/**
 * @param {Map<string, string>} parents resolved module id -> the module that first imported it
 * @param {string} importer
 * @param {string} themeRoot
 * @returns {string} "controllers/cart.js -> stores/session.js"
 */
function importChain(parents, importer, themeRoot) {
  /** @type {string[]} */
  const ids = [];
  const seen = new Set();
  /** @type {string | undefined} */
  let current = importer;

  while (current && !seen.has(current) && !current.startsWith("\0")) {
    seen.add(current);
    ids.unshift(current);
    current = parents.get(current);
  }

  return ids.map((id) => relative(themeRoot, id)).join(" -> ");
}

/**
 * The plugin that keeps the standalone build closed: it provides the entry and the controller core,
 * refuses framework imports (rule V2) and remembers who imported what for the error chain.
 *
 * @param {{ files: string[], pluginId: string, namespace: string, root: string, dir: string }} input
 * @returns {import('rollup').Plugin}
 */
function standalonePlugin(input) {
  const themeRoot = path.dirname(input.dir);
  /** @type {Map<string, string>} */
  const parents = new Map();

  return {
    name: "pano-controllers-standalone",
    async resolveId(source, importer, options) {
      if (source === ENTRY_ID) return RESOLVED_ENTRY_ID;
      if (source === "@panomc/plugin-kit/controller") return CORE_FILE;
      if (!importer) return null;

      if (FORBIDDEN.test(source)) {
        this.error(
          `${importChain(parents, importer, themeRoot)} imports ${source} — controllers are framework-free; use host.session() for the session, host.t() for text, host.request() for the API and host.navigate() for navigation.`,
        );
      }

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });

      if (resolved && !resolved.external && !parents.has(resolved.id)) parents.set(resolved.id, importer);

      return resolved;
    },
    load(id) {
      return id === RESOLVED_ENTRY_ID ? entrySource(input) : null;
    },
  };
}

/**
 * @typedef {object} ControllersBuild
 * @property {string | null} file absolute path of controllers.mjs, `null` when the plugin has no public controller
 * @property {string[]} sources absolute paths of the controller files
 * @property {number} stamp changes with every build (used to import a fresh copy)
 */

let stampCounter = 0;

/**
 * Runs the standalone build and writes `<outDir>/controllers/controllers.mjs` (and removes a stale one
 * when the plugin has no public controller left).
 *
 * @param {ControllersOptions} [options]
 * @returns {Promise<ControllersBuild>}
 */
export async function buildControllers(options = {}) {
  const { root, dir, outDir } = resolvePaths(options);
  const target = path.join(outDir, "controllers", "controllers.mjs");
  const files = listControllerFiles(dir);

  stampCounter += 1;

  if (files.length === 0) {
    fs.rmSync(target, { force: true });

    return { file: null, sources: [], stamp: stampCounter };
  }

  let { pluginId, namespace } = options;

  if (!pluginId || !namespace) {
    const config = await loadConfig(root);

    pluginId = pluginId || config.pluginId;
    namespace = namespace || config.namespace;
  }

  const input = { files, pluginId, namespace, root, dir };

  const bundle = await rollup({
    input: ENTRY_ID,
    external: [],
    treeshake: true,
    onwarn(warning) {
      if (warning.code === "UNRESOLVED_IMPORT") {
        const importer = warning.ids?.[0] ?? warning.id;
        const source = warning.exporter;

        throw new Error(
          `[pano-plugin] ${importer ? relative(path.dirname(input.dir), importer) : "a controller"} imports '${source}', which cannot be resolved — packages are bundled into controllers.mjs, so install it (bun add ${source}) or import a relative file.`,
        );
      }

      if (warning.code === "CIRCULAR_DEPENDENCY" || warning.code === "EMPTY_BUNDLE") return;

      console.warn(`[pano-plugin] controllers: ${warning.message}`);
    },
    plugins: [
      standalonePlugin(input),
      ...(options.plugins ?? []),
      nodeResolve({ browser: true, preferBuiltins: false }),
    ],
  });

  try {
    const { output } = await bundle.generate({
      format: "es",
      inlineDynamicImports: true,
      plugins: [terser()],
    });
    const chunk = output.find((item) => item.type === "chunk");

    if (!chunk || chunk.type !== "chunk") {
      throw new Error("[pano-plugin] controllers: the standalone build produced no module");
    }

    if (chunk.imports.length > 0 || chunk.dynamicImports.length > 0) {
      throw new Error(
        `[pano-plugin] controllers.mjs must not import anything, found ${[...chunk.imports, ...chunk.dynamicImports].join(", ")}`,
      );
    }

    writeIfChanged(target, chunk.code.endsWith("\n") ? chunk.code : chunk.code + "\n");
  } finally {
    await bundle.close();
  }

  return { file: target, sources: files, stamp: stampCounter };
}

/** @type {Map<string, Promise<ControllersBuild>>} */
const builds = new Map();

/**
 * @param {ControllersOptions} options
 * @returns {string}
 */
function buildKey(options) {
  const { root, dir, outDir } = resolvePaths(options);

  return [root, dir, outDir].join("\0");
}

/**
 * The standalone build of the current build cycle, started once and shared by the plugins of the
 * same configuration (controllers, types and meta all need the fresh file).
 *
 * @param {ControllersOptions} [options]
 * @returns {Promise<ControllersBuild>}
 */
export function ensureControllersBuilt(options = {}) {
  const key = buildKey(options);
  let promise = builds.get(key);

  if (!promise) {
    promise = buildControllers(options);
    promise.catch(() => {});
    builds.set(key, promise);
  }

  return promise;
}

/**
 * Starts a new build cycle: the next `ensureControllersBuilt` builds again.
 *
 * @param {ControllersOptions} [options]
 */
export function resetControllersBuild(options = {}) {
  builds.delete(buildKey(options));
}

/**
 * Second build: controllers/controllers.mjs, one self-contained ES module exporting controllers,
 * createHost, create, meta (doc 02 section 5.1). Runs in `writeBundle` of the configuration it is
 * listed in (after plugins that clean the output folder), and watches `src/theme`.
 *
 * @param {ControllersOptions} [options]
 * @returns {import('rollup').Plugin}
 */
export function panoControllers(options = {}) {
  const { dir } = resolvePaths(options);

  return {
    name: "pano-controllers",
    buildStart() {
      resetControllersBuild(options);

      for (const file of themeSourceFiles(dir)) this.addWatchFile(file);
    },
    async writeBundle() {
      await ensureControllersBuilt(options);
    },
  };
}

import fs from "node:fs";
import path from "node:path";
import {
  analyzeProject,
  collectImports,
  displayPath,
  listFiles,
  parsePrograms,
  resolveProject,
  resolveRelative,
  toPosix,
} from "./rules.js";

/**
 * View helpers (doc 02 section 5.4): the relative `.js` files a view imports (and the ones
 * those import) ship readable next to the views. The helper closure of each view is copied
 * to `contract/src/_lib/` (path as under `src/theme/`), and the specifiers that point at a
 * helper in the readable `contract/src` copies of the views are rewritten to the copy, so an
 * ejected view finds its helpers.
 *
 * The plugin exposes `api` (rollup's plugin-to-plugin channel) for `pano-plugin.json`:
 * `api.helpers` is a Map of view name -> helper paths relative to `src/theme/`
 * (`['lib/sale.js']`, sorted), `api.allHelpers` the sorted union.
 */

/** Folder of the readable helpers inside `contract/src`. */
export const LIB_DIR = "_lib";

/** Default package folder, relative to the plugin root (the build writes here in one pass). */
export const DEFAULT_OUT_DIR = "src/main/resources/plugin-ui";

/**
 * @typedef {object} HelpersOptions
 * @property {string} [root] plugin root, default the current directory
 * @property {string[]} [viewDirs] view folders relative to `root`
 * @property {string} [themeDir] default `src/theme`
 * @property {string} [controllersDir] default `<themeDir>/controllers`
 * @property {string} [namespace]
 * @property {string} [outDir] package folder that holds `contract/`, default `src/main/resources/plugin-ui`
 * @property {Record<string, any>} [context] shared build context: gets `helpers` and `allHelpers`
 */

/**
 * @param {string} file
 * @param {string} content
 * @returns {boolean} whether the file was written
 */
function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, "utf8") === content) return false;
  } catch {
    // not there yet
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listSvelteCopies(dir) {
  return listFiles([dir], (file) => file.endsWith(".svelte")).filter(
    (file) => !toPosix(path.relative(dir, file)).startsWith(`${LIB_DIR}/`),
  );
}

/**
 * Copies the helpers of every view to `<outDir>/contract/src/_lib/` and rewrites the helper
 * specifiers in the view copies already present under `<outDir>/contract/src/`.
 *
 * A view copy is found by its file name (view names are unique). The specifiers are matched
 * against the original view's folder, so only imports that resolved to a helper change.
 *
 * @param {import('./rules.js').KitProject} project
 * @param {import('./rules.js').Analysis} analysis
 * @param {string} outDir absolute package folder
 * @returns {Promise<{ copied: string[], rewritten: string[] }>} copied helper paths (relative to src/theme) and rewritten view copies
 */
export async function writeViewHelpers(project, analysis, outDir) {
  const contractSrc = path.join(outDir, "contract", "src");
  const libDir = path.join(contractSrc, LIB_DIR);
  const all = new Set(/** @type {string[]} */ ([]).concat(...analysis.helpers.values()));
  const copied = [];

  for (const helper of [...all].sort()) {
    const relative = toPosix(path.relative(project.themeDir, helper));
    writeIfChanged(path.join(libDir, relative), fs.readFileSync(helper, "utf8"));
    copied.push(relative);
  }

  const rewritten = [];

  if (all.size === 0 || !fs.existsSync(contractSrc)) return { copied, rewritten };

  for (const copy of listSvelteCopies(contractSrc)) {
    const name = path.basename(copy, ".svelte");
    const original = analysis.views.get(name);
    const closure = new Set(analysis.helpers.get(name) ?? []);

    if (!original || closure.size === 0) continue;

    const source = fs.readFileSync(copy, "utf8");
    const imports = collectImports(await parsePrograms(copy, source), source);
    let next = source;

    for (const imp of [...imports].reverse()) {
      if (!imp.spec.startsWith(".")) continue;

      const target = resolveRelative(original, imp.spec);

      if (!target || !closure.has(target)) continue;

      let replacement = toPosix(
        path.relative(
          path.dirname(copy),
          path.join(libDir, path.relative(project.themeDir, target)),
        ),
      );

      if (!replacement.startsWith(".")) replacement = `./${replacement}`;

      next = next.slice(0, imp.start + 1) + replacement + next.slice(imp.end - 1);
    }

    if (next !== source) {
      writeIfChanged(copy, next);
      rewritten.push(toPosix(path.relative(contractSrc, copy)));
    }
  }

  return { copied, rewritten };
}

/**
 * Helper closure of each view, copied readable to contract/src/_lib (doc 02 section 5.4).
 *
 * @param {HelpersOptions} [options]
 * @returns {import('rollup').Plugin & { api: { readonly helpers: Map<string, string[]>, readonly allHelpers: string[] } }}
 */
export function panoHelpers(options = {}) {
  /** @type {Map<string, string[]>} */
  let helpers = new Map();
  /** @type {string[]} */
  let allHelpers = [];
  /** @type {{ project: import('./rules.js').KitProject, analysis: import('./rules.js').Analysis } | null} */
  let last = null;

  const api = {
    get helpers() {
      return helpers;
    },
    get allHelpers() {
      return allHelpers;
    },
  };

  return {
    name: "pano-helpers",
    api,

    async buildStart() {
      const project = await resolveProject(options);
      const analysis = await analyzeProject(project);

      last = { project, analysis };
      helpers = new Map(
        [...analysis.helpers]
          .map(([name, files]) => [name, files.map((file) => displayPath(project, file))])
          .map(([name, files]) => [name, /** @type {string[]} */ (files).sort()]),
      );
      allHelpers = [...new Set(/** @type {string[]} */ ([]).concat(...helpers.values()))].sort();

      if (options.context) {
        options.context.helpers = helpers;
        options.context.allHelpers = allHelpers;
      }
    },

    writeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        if (!last) return;

        const outDir = path.resolve(last.project.root, options.outDir ?? DEFAULT_OUT_DIR);
        await writeViewHelpers(last.project, last.analysis, outDir);
      },
    },
  };
}

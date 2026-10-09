import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rollup } from "rollup";
import { loadConfig } from "../config.js";
import { listFiles } from "./rules.js";
import { scanViews } from "./views.js";
import { getBuildContext } from "./meta.js";
import { writeIfChanged } from "./controllers.js";

/**
 * Sample data of the views (doc 02 section 7).
 *
 * `<Name>.samples.js` sits next to `<Name>.svelte` (or anywhere in the view folders) and is pure data
 * (build rule V3: it imports only view helpers and other relative `.js` fixtures):
 *
 *   export const notApplicable = ['loading', 'error'];       // optional: standard states this view has not
 *   export default { filled: { props: { ... }, controllers: { 'market/cart': { count: 2 } } }, empty: { ... } };
 *
 * `panoSamples()` compiles every samples file into ONE self-contained module,
 * `<outDir>/samples/samples.mjs`:
 *
 *   export default { ProductCard: { filled: {...}, empty: {...} }, ... }     view name -> samples
 *   export const notApplicable = { ProductCard: ['loading', 'error'], ... }  view name -> standard states left out
 *
 * It is a separate rollup build with its own entry, so nothing of it can reach the `client` or `server`
 * bundles; only the view catalogue loads it. The build records the state names in `pano-plugin.json`
 * (`views.<Name>.samples`) and sets `badges.samples` when every page and block view has `filled`.
 *
 * The command line side lives here as well: `samplesStub` / `runSamples` (`pano-plugin samples <View>`) and
 * `runCheckWithSamples` (`pano-plugin check [--strict]`, the samples part of the check).
 */

/** The four state names the catalogue knows; other keys are allowed and listed. */
export const STANDARD_STATES = Object.freeze(["empty", "filled", "error", "loading"]);

/** Suffix of a samples file. */
export const SAMPLES_SUFFIX = ".samples.js";

/** Where the compiled module is written, relative to the package folder. */
export const SAMPLES_OUTPUT = "samples/samples.mjs";

/** Default package folder, relative to the plugin root. */
const DEFAULT_OUT_DIR = "src/main/resources/plugin-ui";

const ENTRY_ID = "\0pano-samples-entry";

/**
 * @typedef {object} SampleState
 * @property {Record<string, any>} [props] props handed to the view
 * @property {Record<string, Record<string, any>>} [controllers] controller name -> patch merged over its initial state
 * @property {'guest' | 'user'} [session] session the stage simulates
 * @property {string} [label] title in the catalogue
 */

/**
 * A state is an object or a function returning one.
 *
 * @typedef {SampleState | (() => SampleState)} SampleEntry
 */

/**
 * The default export of a `*.samples.js`: state name -> state. Standard names: `empty`, `filled`, `error`,
 * `loading`.
 *
 * @typedef {{ [state: string]: SampleEntry | undefined, empty?: SampleEntry, filled?: SampleEntry, error?: SampleEntry, loading?: SampleEntry }} Samples
 */

/**
 * @typedef {object} SamplesOptions
 * @property {string} [root] plugin root, default the current directory
 * @property {string[]} [viewDirs] view folders (relative to `root`, or absolute), default from `pano.plugin.js`
 * @property {string} [outDir] package folder, default `src/main/resources/plugin-ui`
 * @property {string} [pluginId] default: `pluginId` of gradle.properties
 * @property {string} [namespace] default: derived like the rest of the kit
 * @property {'server' | 'client' | 'controllers' | 'widgets'} [side] the preset passes it; the package is written by `client` only
 */

/** @param {string} value */
const slash = (value) => value.split(path.sep).join("/");

/**
 * Every `*.samples.js` under the view folders, sorted, as `{ name, file }` (the name is the view name).
 *
 * @param {string[]} viewDirs absolute folders
 * @returns {{ name: string, file: string }[]}
 */
export function findSampleFiles(viewDirs) {
  return listFiles(viewDirs, (file) => file.endsWith(SAMPLES_SUFFIX))
    .map((file) => ({ name: path.basename(file, SAMPLES_SUFFIX), file }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.file < b.file ? -1 : 1));
}

/**
 * Compiles the samples files into one self-contained ES module (not written anywhere).
 *
 * @param {{ name: string, file: string }[]} files
 * @param {string} [root] for the file names in messages
 * @returns {Promise<{ code: string, warnings: string[] }>}
 * @throws {Error} a file imports a package, or has no default export
 */
export async function compileSamples(files, root = process.cwd()) {
  /** @param {string} file */
  const display = (file) => slash(path.relative(root, file));
  const lines = files.map(({ file }, index) => `import * as s${index} from ${JSON.stringify(file)};`);

  lines.push("export default {");
  files.forEach(({ name }, index) => lines.push(`  ${JSON.stringify(name)}: s${index}.default,`));
  lines.push("};", "export const notApplicable = {");
  files.forEach(({ name }, index) => lines.push(`  ${JSON.stringify(name)}: s${index}.notApplicable ?? [],`));
  lines.push("};", "");

  const entry = lines.join("\n");
  /** @type {string[]} */
  const warnings = [];
  const bundle = await rollup({
    input: ENTRY_ID,
    external: [],
    onwarn(warning) {
      if (warning.code === "UNRESOLVED_IMPORT") {
        const importer = warning.ids?.[0] ?? warning.id;

        throw new Error(
          `[pano-plugin] ${importer ? display(importer) : "a samples file"} imports '${warning.exporter}' — sample files are pure data: import only view helpers and other relative .js fixtures (no packages, no Svelte, no @panomc/sdk)`,
        );
      }

      if (warning.code === "MISSING_EXPORT") {
        if (warning.binding === "notApplicable") return; // optional

        if (warning.binding === "default") {
          throw new Error(
            `[pano-plugin] ${display(warning.exporter ?? "")} has no default export — add: export default { filled: { props: { ... } } }`,
          );
        }
      }

      if (warning.code === "CIRCULAR_DEPENDENCY" || warning.code === "EMPTY_BUNDLE") return;

      warnings.push(warning.message);
    },
    plugins: [
      {
        name: "pano-samples-entry",
        resolveId: (source) => (source === ENTRY_ID ? ENTRY_ID : null),
        load: (id) => (id === ENTRY_ID ? entry : null),
      },
    ],
  });

  try {
    const { output } = await bundle.generate({ format: "es", inlineDynamicImports: true });
    const chunk = output.find((item) => item.type === "chunk");

    if (!chunk || chunk.type !== "chunk") {
      throw new Error("[pano-plugin] samples: the build produced no module");
    }

    return { code: chunk.code.endsWith("\n") ? chunk.code : chunk.code + "\n", warnings };
  } finally {
    await bundle.close();
  }
}

/**
 * Imports a copy of the module under a name never used before (some runtimes ignore a query string in their
 * module cache); the module is self-contained, so it runs from the temporary folder.
 *
 * @param {string} code
 * @returns {Promise<any>}
 */
export async function importSamples(code) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pano-kit-samples-"));
  const file = path.join(folder, "samples.mjs");

  try {
    fs.writeFileSync(file, code);

    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * @typedef {object} SamplesInfo
 * @property {Record<string, string[]>} states view name -> state names, in source order
 * @property {Record<string, string[]>} notApplicable view name -> standard states the view leaves out
 * @property {string[]} problems what is wrong with the content of the files
 */

/**
 * Reads the compiled module: state names and the shape check (`default` is an object of objects or functions,
 * `notApplicable` an array of strings).
 *
 * @param {any} mod
 * @param {{ name: string, file: string }[]} files
 * @param {string} [root]
 * @returns {SamplesInfo}
 */
export function describeSamples(mod, files, root = process.cwd()) {
  /** @type {SamplesInfo} */
  const info = { states: {}, notApplicable: {}, problems: [] };

  for (const { name, file } of files) {
    const where = slash(path.relative(root, file));
    const samples = mod.default?.[name];
    const skipped = mod.notApplicable?.[name];

    if (!samples || typeof samples !== "object" || Array.isArray(samples)) {
      info.problems.push(
        `${where}: the default export must be an object of states — export default { filled: { props: { ... } } }`,
      );
      info.states[name] = [];
    } else {
      info.states[name] = Object.keys(samples);

      for (const [state, value] of Object.entries(samples)) {
        if (value === null || (typeof value !== "object" && typeof value !== "function") || Array.isArray(value)) {
          info.problems.push(
            `${where}: state '${state}' must be an object { props?, controllers?, session?, label? } or a function returning one`,
          );
        }
      }
    }

    if (!Array.isArray(skipped) || skipped.some((state) => typeof state !== "string")) {
      info.problems.push(`${where}: notApplicable must be an array of state names, for example ['loading', 'error']`);
      info.notApplicable[name] = [];
    } else {
      info.notApplicable[name] = skipped;
    }
  }

  return info;
}

/**
 * Finds, compiles and reads the samples of a plugin.
 *
 * @param {{ root: string, viewDirs: string[] }} options viewDirs absolute
 * @returns {Promise<{ files: { name: string, file: string }[], code: string | null, info: SamplesInfo, warnings: string[], duplicates: string[] }>}
 */
export async function buildSamples({ root, viewDirs }) {
  const all = findSampleFiles(viewDirs);
  /** @type {string[]} */
  const duplicates = [];
  /** @type {Map<string, { name: string, file: string }>} */
  const byName = new Map();

  for (const entry of all) {
    const earlier = byName.get(entry.name);

    if (earlier) {
      duplicates.push(
        `${slash(path.relative(root, entry.file))} and ${slash(path.relative(root, earlier.file))} both hold the samples of ${entry.name} — keep one`,
      );
    } else {
      byName.set(entry.name, entry);
    }
  }

  const files = [...byName.values()];

  if (files.length === 0) {
    return { files, code: null, info: { states: {}, notApplicable: {}, problems: [] }, warnings: [], duplicates };
  }

  const { code, warnings } = await compileSamples(files, root);
  const info = describeSamples(await importSamples(code), files, root);

  return { files, code, info, warnings, duplicates };
}

/**
 * Which views must have a `filled` sample for the badge: pages and blocks.
 *
 * @param {Awaited<ReturnType<typeof scanViews>>} scan
 * @returns {string[]} view names
 */
function badgeViews(scan) {
  return [...scan.views.values()]
    .filter((view) => view.record.kind === "page" || view.record.block === true)
    .map((view) => view.name);
}

/**
 * Compiles `*.samples.js` into `samples/samples.mjs` (doc 02 section 7). List it in the client build only (the
 * preset does); a `server` side does nothing. The folder is removed when the plugin has no samples left.
 *
 * `api.states` is the last result (view name -> state names).
 *
 * @param {SamplesOptions} [options]
 * @returns {import('rollup').Plugin & { api: { readonly states: Record<string, string[]> } }}
 */
export function panoSamples(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = path.resolve(root, options.outDir ?? DEFAULT_OUT_DIR);
  const target = path.join(outDir, SAMPLES_OUTPUT);
  /** @type {Record<string, string[]>} */
  let states = {};

  /** @returns {Promise<string[]>} absolute view folders */
  async function viewDirsOf() {
    const given = options.viewDirs ?? (await loadConfig(root)).viewDirs;

    return given.map((dir) => path.resolve(root, dir));
  }

  return {
    name: "pano-samples",

    api: {
      get states() {
        return states;
      },
    },

    async buildStart() {
      if (options.side && options.side !== "client") return;

      for (const { file } of findSampleFiles(await viewDirsOf())) this.addWatchFile(file);
    },

    async writeBundle() {
      if (options.side && options.side !== "client") return;

      const viewDirs = await viewDirsOf();
      const built = await buildSamples({ root, viewDirs }).catch((error) => this.error(error.message));

      for (const message of built.duplicates) this.error(`[pano-plugin] ${message}`);
      for (const message of built.info.problems) this.error(`[pano-plugin] ${message}`);
      for (const message of built.warnings) this.warn(`[pano-plugin] samples: ${message}`);

      // the views of the plugin (page/block kind for the badge)
      /** @type {Awaited<ReturnType<typeof scanViews>> | null} */
      let scan = null;

      try {
        const config = options.pluginId && options.namespace ? options : await loadConfig(root);

        scan = await scanViews({
          dirs: viewDirs,
          namespace: options.namespace ?? config.namespace,
          pluginId: options.pluginId ?? /** @type {any} */ (config).pluginId,
          root,
        });
      } catch (error) {
        this.warn(`[pano-plugin] samples: the views could not be read for the badge (${/** @type {Error} */ (error).message})`);
      }

      const names = scan ? [...scan.views.keys()] : [];

      for (const entry of built.files) {
        if (scan && !scan.views.has(entry.name)) {
          this.warn(
            `[pano-plugin] ${slash(path.relative(root, entry.file))} belongs to no view — there is no ${entry.name}.svelte; rename the file or remove it`,
          );
        }
      }

      if (built.code) writeIfChanged(target, built.code);
      else if (fs.existsSync(target)) {
        fs.rmSync(path.dirname(target), { recursive: true, force: true });
      }

      states = built.info.states;

      // hand the state names over to pano-plugin.json
      const shared = getBuildContext(root);

      for (const name of new Set([...names, ...Object.keys(shared.views)])) {
        shared.views[name] = { ...(shared.views[name] ?? {}), samples: built.info.states[name] ?? [] };
      }

      for (const name of Object.keys(built.info.states)) {
        shared.views[name] = { ...(shared.views[name] ?? {}), samples: built.info.states[name] };
      }

      if (scan) {
        const required = badgeViews(scan);

        shared.badges.samples =
          required.length > 0
            ? required.every((name) => built.info.states[name]?.includes("filled"))
            : Object.keys(built.info.states).length > 0;
      } else {
        shared.badges.samples = false;
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// pano-plugin samples <View>
// ---------------------------------------------------------------------------------------------

/**
 * A placeholder value for a prop of this JSDoc type.
 *
 * @param {string | undefined} type
 * @returns {string} JavaScript source
 */
function placeholder(type) {
  const text = type ?? "any";

  if (/\[\]|\bArray\b/i.test(text)) return "[]";
  if (/\bstring\b/i.test(text)) return "''";
  if (/\bnumber\b|\bint(eger)?\b/i.test(text)) return "0";
  if (/\bboolean\b/i.test(text)) return "false";
  if (/\bobject\b|^\s*\{/i.test(text)) return "{}";

  return "null";
}

/**
 * The text of a new samples file: the four standard states and one line per required prop in each.
 *
 * @param {string} name view name
 * @param {Record<string, { type?: string, required: boolean }>} props the props contract of the view
 * @returns {string}
 */
export function samplesStub(name, props) {
  const required = Object.entries(props).filter(([, prop]) => prop.required);
  const propLines = required.length
    ? required.map(([prop, { type }]) => `      ${prop}: ${placeholder(type)}, // ${type ?? "any"}, required`)
    : [];
  const state = (/** @type {string} */ key) => {
    const body = propLines.length ? `{\n${propLines.join("\n")}\n    }` : "{}";

    return `  ${key}: {\n    props: ${body},\n  },`;
  };

  return [
    `// Sample data of ${name} for the view catalogue (doc 02 section 7). Pure data: import only view helpers and`,
    `// relative .js fixtures. Fill in the props; a state the view cannot show is left out and listed in notApplicable.`,
    `/** @type {string[]} */`,
    `export const notApplicable = [];`,
    ``,
    `/** @type {import('@panomc/plugin-kit').Samples} */`,
    `export default {`,
    ...["filled", "empty", "error", "loading"].map(state),
    `};`,
    ``,
  ].join("\n");
}

/**
 * @typedef {object} SamplesCommandOptions
 * @property {string} [root] plugin root, default the current directory
 * @property {string} [view] view name (`ProductCard` or `market:ProductCard`); none lists every view
 * @property {(line: string) => void} [out]
 * @property {(line: string) => void} [err]
 */

/**
 * `pano-plugin samples [<View>]`: writes `<View>.samples.js` next to the view; without a name lists the views
 * and their samples.
 *
 * @param {SamplesCommandOptions} [options]
 * @returns {Promise<number>} the exit code
 */
export async function runSamples(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line) => process.stderr.write(`${line}\n`));

  try {
    const config = await loadConfig(root);
    const dirs = config.viewDirs.map((dir) => path.resolve(root, dir));
    const scan = await scanViews({ dirs, namespace: config.namespace, pluginId: config.pluginId, root });
    const existing = new Map(findSampleFiles(dirs).map((entry) => [entry.name, entry.file]));

    if (!options.view) {
      for (const view of [...scan.views.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const file = existing.get(view.name);

        out(file ? `${view.name}  ${slash(path.relative(root, file))}` : `${view.name}  no samples — pano-plugin samples ${view.name}`);
      }

      return 0;
    }

    const name = options.view.includes(":") ? options.view.slice(options.view.indexOf(":") + 1) : options.view;
    const info = scan.views.get(name);

    if (!info) {
      const known = [...scan.views.keys()].sort();

      err(`error: no view named ${name} — ${known.length ? `the views are ${known.join(", ")}` : "this plugin has no views yet"}`);

      return 1;
    }

    const found = existing.get(name);

    if (found) {
      err(`error: ${slash(path.relative(root, found))} exists already — edit it, or delete it first to start over`);

      return 1;
    }

    const file = path.join(path.dirname(info.file), `${name}${SAMPLES_SUFFIX}`);

    fs.writeFileSync(file, samplesStub(name, info.record.props), { flag: "wx" });
    out(`wrote ${slash(path.relative(root, file))}`);

    return 0;
  } catch (error) {
    err(`error: ${String(/** @type {Error} */ (error).message).replace(/^\[pano-plugin\] /, "")}`);

    return 1;
  }
}

// ---------------------------------------------------------------------------------------------
// pano-plugin check [--strict]: the samples part
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {object} SamplesCheck
 * @property {string[]} errors always failing: a file that does not compile, a malformed file
 * @property {string[]} problems failing under `--strict` only: a missing file, a missing state
 * @property {string[]} notes views without samples, with the command that writes them
 */

/**
 * The samples rules of `check`: a view without samples is a note; under `strict` every view needs a samples file
 * with `filled` and each standard state that its `notApplicable` does not name.
 *
 * @param {{ root?: string }} [options]
 * @returns {Promise<SamplesCheck>}
 */
export async function checkSamples(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  /** @type {SamplesCheck} */
  const result = { errors: [], problems: [], notes: [] };
  const config = await loadConfig(root);
  const dirs = config.viewDirs.map((dir) => path.resolve(root, dir));
  const scan = await scanViews({ dirs, namespace: config.namespace, pluginId: config.pluginId, root });
  /** @type {Awaited<ReturnType<typeof buildSamples>>} */
  let built;

  try {
    built = await buildSamples({ root, viewDirs: dirs });
  } catch (error) {
    result.errors.push(String(/** @type {Error} */ (error).message).replace(/^\[pano-plugin\] /, ""));

    return result;
  }

  result.errors.push(...built.duplicates, ...built.info.problems);

  for (const view of [...scan.views.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const states = built.info.states[view.name];

    if (!states) {
      const hint = `pano-plugin samples ${view.name}`;

      result.notes.push(`${view.name} has no samples — ${hint}`);
      result.problems.push(`${view.rel}: ${view.name} has no samples file — run: ${hint}`);
      continue;
    }

    const file = built.files.find((entry) => entry.name === view.name)?.file ?? "";
    const where = slash(path.relative(root, file));
    const skipped = built.info.notApplicable[view.name] ?? [];

    for (const state of skipped) {
      if (!STANDARD_STATES.includes(state)) {
        result.problems.push(`${where}: notApplicable names '${state}', which is not a standard state (${STANDARD_STATES.join(", ")})`);
      } else if (state === "filled") {
        result.problems.push(`${where}: 'filled' cannot be listed in notApplicable — every view needs a filled sample`);
      } else if (states.includes(state)) {
        result.problems.push(`${where}: '${state}' is both a sample and in notApplicable — keep one`);
      }
    }

    for (const state of STANDARD_STATES) {
      if (!states.includes(state) && !skipped.includes(state)) {
        result.problems.push(
          state === "filled"
            ? `${where}: ${view.name} has no 'filled' sample — add filled: { props: { ... } }`
            : `${where}: ${view.name} has no '${state}' sample — add it, or list '${state}' in notApplicable`,
        );
      }
    }
  }

  for (const entry of built.files) {
    if (!scan.views.has(entry.name)) {
      result.problems.push(
        `${slash(path.relative(root, entry.file))} belongs to no view — there is no ${entry.name}.svelte; rename the file or remove it`,
      );
    }
  }

  return result;
}

/**
 * `pano-plugin check [--strict] [--styles badge]`: the check of `cli-check.js` plus the samples rules above.
 * The lines of the base check are replayed; the verdict line is recomputed with the samples problems in it.
 *
 * @param {{ root?: string, strict?: boolean, styles?: 'core' | 'badge', out?: (line: string) => void, err?: (line: string) => void }} [options]
 * @returns {Promise<number>} the exit code
 */
export async function runCheckWithSamples(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
  const strict = options.strict === true;
  const { runCheck } = await import("./cli-check.js");
  /** @type {string[]} */
  const outLines = [];
  /** @type {string[]} */
  const errLines = [];
  const code = await runCheck({
    root,
    strict,
    styles: options.styles,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  });

  /** @type {SamplesCheck} */
  let samples = { errors: [], problems: [], notes: [] };
  /** @type {string | null} */
  let failure = null;

  try {
    samples = await checkSamples({ root });
  } catch (error) {
    // the base check reports a broken plugin folder (no pluginId, unreadable views) on its own
    failure = code === 0 ? String(/** @type {Error} */ (error).message).replace(/^\[pano-plugin\] /, "") : null;
  }

  const failing = [...samples.errors, ...(strict ? samples.problems : [])];

  if (failure) failing.push(failure);

  for (const line of errLines) err(line);
  for (const message of failing) err(strict && !samples.errors.includes(message) ? `error (--strict): ${message}` : `error: ${message}`);

  if (!strict) for (const note of samples.notes) out(`note: ${note}`);

  for (const line of outLines) {
    const passed = /^check passed \((\d+) warnings?\)$/.exec(line);
    const failed = /^check failed: (\d+) problems?$/.exec(line);

    if (passed || failed) {
      const before = failed ? Number(failed[1]) : 0;
      const total = before + failing.length;

      out(
        total === 0
          ? line
          : `check failed: ${total} problem${total === 1 ? "" : "s"}`,
      );
    } else {
      out(line);
    }
  }

  return code !== 0 || failing.length > 0 ? 1 : 0;
}

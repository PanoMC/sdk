import fs from "node:fs";
import path from "node:path";
import { DEFAULT_VIEW_DIRS, loadConfig } from "../config.js";

/**
 * Build rules V1-V3 and V5 (doc 02 section 5.4, doc 01 section 2), plus the source
 * analysis that the helper copy (`helpers.js`) and the version stamp (`stamp.js`) share.
 *
 * - V1 view imports: a view imports `svelte`, `svelte/*`, `svelte-i18n`, `@panomc/sdk`,
 *   `@panomc/sdk/*`, other view files and view helpers (relative `.js` under `src/theme/`,
 *   outside `src/theme/controllers/`, whose own imports are only other view helpers).
 * - V2 controller purity: nothing reachable from a controller imports Svelte, the SDK,
 *   `$app/*` or a `.svelte` file. The error shows the import chain.
 * - V3 sample purity: `*.samples.js` import only relative `.js` files, and so do those.
 * - V5 no `setContext` / `getContext` / `hasContext` from `svelte` in a view.
 *
 * `PANO_VIEW_IMPORTS=warn` (or the `viewImports: 'warn'` option) turns V1 and V5 into
 * warnings for plugins that are not migrated yet (doc 02 section 3); V2 and V3 always fail.
 * The rule plugin exposes `api` (rollup's plugin-to-plugin channel):
 * `api.viewImports` is `'warn'` or `'error'`, `api.manifestFlags()` is `{ viewImports: 'warn' }`
 * in migration mode and `{}` otherwise (spread it into `pano-plugin.json`), `api.violations`
 * is the list found by the last build start.
 */

/** Packages a view may import (V1). */
const VIEW_PACKAGES = ["svelte", "svelte-i18n", "@panomc/sdk"];

/** Names whose use between views is refused (V5). */
const CONTEXT_FUNCTIONS = new Set(["setContext", "getContext", "hasContext"]);

/** Default folder of the view helpers and controllers, relative to the plugin root. */
export const DEFAULT_THEME_DIR = "src/theme";

const SKIPPED_DIRS = new Set(["node_modules", "__tests__"]);

/**
 * @typedef {object} RulesOptions
 * @property {string} [root] plugin root, default the current directory
 * @property {string[]} [viewDirs] view folders relative to `root`; default from `pano.plugin.js`
 * @property {string} [controllersDir] controllers folder (absolute or relative to `root`), default `<themeDir>/controllers`
 * @property {string} [themeDir] folder that holds helpers and controllers, default `src/theme`
 * @property {string} [namespace] plugin namespace, used in the messages; default from the plugin config
 * @property {'warn' | 'error'} [viewImports] overrides `PANO_VIEW_IMPORTS`
 * @property {Record<string, any>} [context] shared build context: gets `viewImports`, `violations`
 */

/**
 * @typedef {object} KitProject
 * @property {string} root absolute plugin root
 * @property {string} themeDir absolute
 * @property {string} controllersDir absolute
 * @property {string[]} viewDirs absolute
 * @property {string} namespace
 */

/**
 * @typedef {object} Violation
 * @property {'V1' | 'V2' | 'V3' | 'V5'} rule
 * @property {string} file absolute path of the file the message is about
 * @property {number} line 1-based
 * @property {string} message full error text, file and line included
 */

/**
 * @typedef {object} Analysis
 * @property {Map<string, string>} views view name (file name without `.svelte`) -> absolute file
 * @property {Map<string, string[]>} helpers view name -> absolute helper files (transitive closure)
 * @property {Violation[]} violations
 */

/** @param {string} file */
export function toPosix(file) {
  return file.split(path.sep).join("/");
}

/**
 * @param {string} dir
 * @param {string} file
 */
function isInside(dir, file) {
  const relative = path.relative(dir, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Resolves the project folders of the rules, stamp and helper plugins.
 *
 * @param {RulesOptions} [options]
 * @returns {Promise<KitProject>}
 */
export async function resolveProject(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  let viewDirs = options.viewDirs;
  let namespace = options.namespace;

  if (!viewDirs || !namespace) {
    let config = null;

    try {
      config = await loadConfig(root);
    } catch {
      config = null;
    }

    viewDirs ??= config?.viewDirs ?? [...DEFAULT_VIEW_DIRS];
    namespace ??= config?.namespace ?? "<namespace>";
  }

  const themeDir = path.resolve(root, options.themeDir ?? DEFAULT_THEME_DIR);

  return {
    root,
    themeDir,
    controllersDir: path.resolve(root, options.controllersDir ?? path.join(themeDir, "controllers")),
    viewDirs: viewDirs.map((dir) => path.resolve(root, dir)),
    namespace,
  };
}

/**
 * Display name of a file in a message: relative to the theme folder when inside it
 * (`lib/sale.js`), else relative to the plugin root.
 *
 * @param {KitProject} project
 * @param {string} file
 */
export function displayPath(project, file) {
  return toPosix(
    isInside(project.themeDir, file)
      ? path.relative(project.themeDir, file)
      : path.relative(project.root, file),
  );
}

/**
 * Walks every node of an ESTree-like tree.
 *
 * @param {any} root
 * @param {(node: any, parent: any) => void} visit
 */
export function walk(root, visit) {
  const seen = new Set();

  /** @param {any} node @param {any} parent */
  function step(node, parent) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) step(child, parent);
      return;
    }

    if (typeof node.type === "string") visit(node, parent);

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "parent" || key === "metadata" || key === "range") continue;
      const child = node[key];
      if (child && typeof child === "object") step(child, typeof node.type === "string" ? node : parent);
    }
  }

  step(root, null);
}

/**
 * 1-based line of an offset.
 *
 * @param {string} source
 * @param {number} offset
 */
export function lineOf(source, offset) {
  let line = 1;
  const end = Math.min(offset, source.length);

  for (let index = 0; index < end; index++) {
    if (source.charCodeAt(index) === 10) line++;
  }

  return line;
}

/**
 * Parses a `.svelte` file into its script programs (module first, then instance) or a
 * `.js` file into one program. Offsets are absolute in `source`.
 *
 * @param {string} file
 * @param {string} source
 * @returns {Promise<any[]>}
 */
export async function parsePrograms(file, source) {
  try {
    if (file.endsWith(".svelte")) {
      const { parse } = await import("svelte/compiler");
      const ast = parse(source, { modern: true, filename: file });
      return [ast.module?.content, ast.instance?.content].filter(Boolean);
    }

    const { parseAst } = await import("rollup/parseAst");
    return [parseAst(source)];
  } catch (error) {
    throw new Error(
      `[pano-plugin] cannot parse ${file}: ${/** @type {Error} */ (error).message}`,
      { cause: error },
    );
  }
}

/**
 * @typedef {object} ImportRef
 * @property {string} spec the specifier as written
 * @property {number} line
 * @property {number} start offset of the opening quote of the specifier
 * @property {number} end offset after the closing quote
 */

/**
 * Every static import, `export ... from` and literal `import()` of the programs.
 *
 * @param {any[]} programs
 * @param {string} source
 * @returns {ImportRef[]}
 */
export function collectImports(programs, source) {
  /** @type {ImportRef[]} */
  const imports = [];

  for (const program of programs) {
    walk(program, (node) => {
      const isStatic =
        node.type === "ImportDeclaration" ||
        ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) ||
        node.type === "ImportExpression";

      if (!isStatic) return;

      const literal = node.source;

      if (!literal || literal.type !== "Literal" || typeof literal.value !== "string") return;

      imports.push({
        spec: literal.value,
        line: lineOf(source, literal.start),
        start: literal.start,
        end: literal.end,
      });
    });
  }

  imports.sort((a, b) => a.start - b.start);
  return imports;
}

/**
 * Resolves a relative specifier the way a bundler would for plain source files.
 *
 * @param {string} fromFile
 * @param {string} spec
 * @returns {string | null} absolute file or null when nothing matches
 */
export function resolveRelative(fromFile, spec) {
  const clean = spec.replace(/[?#].*$/, "");
  const base = path.resolve(path.dirname(fromFile), clean);
  const candidates = [base, `${base}.js`, `${base}.svelte`, path.join(base, "index.js")];

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }

  return null;
}

/** @param {string} spec */
function isRelative(spec) {
  return spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..";
}

/**
 * @param {string} spec
 * @param {string[]} packages
 */
function isPackageOrSubpath(spec, packages) {
  return packages.some((name) => spec === name || spec.startsWith(`${name}/`));
}

/**
 * Files below `dirs` (recursively) accepted by `accept`, sorted.
 *
 * @param {string[]} dirs
 * @param {(file: string) => boolean} accept
 * @returns {string[]}
 */
export function listFiles(dirs, accept) {
  /** @type {string[]} */
  const found = [];

  /** @param {string} dir */
  function visit(dir) {
    let entries;

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && accept(full)) found.push(full);
    }
  }

  for (const dir of dirs) visit(dir);

  return [...new Set(found)].sort();
}

/**
 * The public controller files: `.js` files directly under the controllers folder, without
 * `_*.js` (private code) and `types.js` (typedefs).
 *
 * @param {KitProject} project
 * @returns {string[]}
 */
export function controllerFiles(project) {
  let entries;

  try {
    entries = fs.readdirSync(project.controllersDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".js") &&
        !entry.name.startsWith("_") &&
        entry.name !== "types.js",
    )
    .map((entry) => path.join(project.controllersDir, entry.name))
    .sort();
}

/**
 * Per-analysis cache of file contents, parsed programs and imports.
 *
 * @param {KitProject} _project
 */
function createSourceCache(_project) {
  /** @type {Map<string, Promise<{ source: string, programs: any[], imports: ImportRef[] }>>} */
  const cache = new Map();

  return {
    /** @param {string} file */
    load(file) {
      let entry = cache.get(file);

      if (!entry) {
        entry = (async () => {
          const source = fs.readFileSync(file, "utf8");
          const programs = await parsePrograms(file, source);
          return { source, programs, imports: collectImports(programs, source) };
        })();
        cache.set(file, entry);
      }

      return entry;
    },
  };
}

/**
 * Finds `setContext` / `getContext` / `hasContext` imported from `svelte` and used in a view.
 *
 * @param {any[]} programs
 * @param {string} source
 * @returns {{ line: number, text: string }[]}
 */
function findContextUses(programs, source) {
  /** @type {Map<string, string>} local name -> imported name */
  const locals = new Map();
  /** @type {Map<string, { line: number, imported: string }>} */
  const importedAt = new Map();
  /** @type {Set<string>} */
  const namespaces = new Set();
  /** @type {{ line: number, text: string }[]} */
  const uses = [];
  const calledLocals = new Set();

  for (const program of programs) {
    walk(program, (node) => {
      if (node.type !== "ImportDeclaration" || node.source?.value !== "svelte") return;

      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier") {
          const imported = specifier.imported.name ?? specifier.imported.value;

          if (CONTEXT_FUNCTIONS.has(imported)) {
            locals.set(specifier.local.name, imported);
            importedAt.set(specifier.local.name, {
              line: lineOf(source, specifier.start),
              imported,
            });
          }
        } else {
          namespaces.add(specifier.local.name);
        }
      }
    });
  }

  if (locals.size === 0 && namespaces.size === 0) return uses;

  for (const program of programs) {
    walk(program, (node) => {
      if (node.type !== "CallExpression") return;

      let name = null;
      const callee = node.callee;

      if (callee.type === "Identifier" && locals.has(callee.name)) {
        name = /** @type {string} */ (locals.get(callee.name));
        calledLocals.add(callee.name);
      } else if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.object.type === "Identifier" &&
        namespaces.has(callee.object.name) &&
        CONTEXT_FUNCTIONS.has(callee.property.name)
      ) {
        name = callee.property.name;
      }

      if (!name) return;

      const first = node.arguments[0];
      const argument = first ? source.slice(first.start, first.end) : "";
      uses.push({ line: lineOf(source, node.start), text: `${name}(${argument})` });
    });
  }

  for (const [local, info] of importedAt) {
    if (!calledLocals.has(local)) {
      uses.push({ line: info.line, text: `${info.imported} (imported from "svelte")` });
    }
  }

  return uses.sort((a, b) => a.line - b.line);
}

/**
 * Runs the checks of V1, V2, V3 and V5 and collects the view-to-helper closures.
 *
 * @param {KitProject} project
 * @returns {Promise<Analysis>}
 */
export async function analyzeProject(project) {
  const { root, themeDir, controllersDir, viewDirs, namespace } = project;
  const files = createSourceCache(project);
  /** @type {Violation[]} */
  const violations = [];
  const reported = new Set();

  /**
   * @param {Violation} violation
   * @param {string} spec
   */
  function report(violation, spec) {
    const key = `${violation.rule}|${violation.file}|${violation.line}|${spec}|${violation.message}`;

    if (reported.has(key)) return;

    reported.add(key);
    violations.push(violation);
  }

  const controllersRel = `${toPosix(path.relative(root, controllersDir))}/`;

  /** @param {string} target */
  function controllerNameOf(target) {
    return toPosix(path.relative(controllersDir, target)).replace(/\.js$/, "");
  }

  /** @type {Map<string, string>} */
  const views = new Map();
  const viewFiles = listFiles(viewDirs, (file) => file.endsWith(".svelte"));

  for (const file of viewFiles) views.set(path.basename(file, ".svelte"), file);

  /** @type {Map<string, Set<string>>} helper file -> helpers it imports */
  const helperDeps = new Map();
  /** @type {Map<string, string>} helper file -> name of the first view that uses it */
  const firstUser = new Map();

  /**
   * Checks the imports of a helper file once and records its dependencies.
   *
   * @param {string} helper
   * @param {string} usedBy view file name
   */
  async function checkHelper(helper, usedBy) {
    if (helperDeps.has(helper)) return;

    const deps = new Set();
    helperDeps.set(helper, deps);
    firstUser.set(helper, usedBy);

    const { imports } = await files.load(helper);
    const where = (/** @type {number} */ line) =>
      `${displayPath(project, helper)}:${line} (used by ${usedBy})`;

    for (const imp of imports) {
      if (!isRelative(imp.spec)) {
        report(
          {
            rule: "V1",
            file: helper,
            line: imp.line,
            message: `${where(imp.line)} imports ${imp.spec} — view helpers ship as readable source and cannot import packages; move that code to ${controllersRel} (packages are bundled there)`,
          },
          imp.spec,
        );
        continue;
      }

      const target = resolveRelative(helper, imp.spec);

      if (!target) continue;

      if (target === controllersDir || isInside(controllersDir, target)) {
        report(
          {
            rule: "V1",
            file: helper,
            line: imp.line,
            message: `${where(imp.line)} imports ${imp.spec} — controllers are compiled and closed; read it from the view with plugin('${namespace}').require('${controllerNameOf(target)}')`,
          },
          imp.spec,
        );
        continue;
      }

      if (target.endsWith(".svelte")) {
        report(
          {
            rule: "V1",
            file: helper,
            line: imp.line,
            message: `${where(imp.line)} imports ${imp.spec} — view helpers are plain .js and cannot import views`,
          },
          imp.spec,
        );
        continue;
      }

      if (!target.endsWith(".js")) {
        report(
          {
            rule: "V1",
            file: helper,
            line: imp.line,
            message: `${where(imp.line)} imports ${imp.spec} — view helpers import only other relative .js view helpers`,
          },
          imp.spec,
        );
        continue;
      }

      if (!isInside(themeDir, target)) {
        report(
          {
            rule: "V1",
            file: helper,
            line: imp.line,
            message: `${where(imp.line)} imports ${imp.spec} — view helpers must live under ${toPosix(path.relative(root, themeDir))}/ so they ship with the views`,
          },
          imp.spec,
        );
        continue;
      }

      deps.add(target);
      await checkHelper(target, usedBy);
    }
  }

  /** @type {Map<string, Set<string>>} */
  const closures = new Map();

  for (const [name, viewFile] of views) {
    const { source, programs, imports } = await files.load(viewFile);
    const base = path.basename(viewFile);
    const direct = new Set();

    for (const imp of imports) {
      const at = `${base}:${imp.line}`;

      if (!isRelative(imp.spec)) {
        if (isPackageOrSubpath(imp.spec, VIEW_PACKAGES)) continue;

        report(
          {
            rule: "V1",
            file: viewFile,
            line: imp.line,
            message: `${at} imports ${imp.spec} — view helpers ship as readable source and cannot import packages; move that code to ${controllersRel} (packages are bundled there)`,
          },
          imp.spec,
        );
        continue;
      }

      const target = resolveRelative(viewFile, imp.spec);

      if (!target) continue;

      if (target === controllersDir || isInside(controllersDir, target)) {
        report(
          {
            rule: "V1",
            file: viewFile,
            line: imp.line,
            message: `${at} imports ${imp.spec} — controllers are compiled and closed; read it with plugin('${namespace}').require('${controllerNameOf(target)}')`,
          },
          imp.spec,
        );
        continue;
      }

      if (target.endsWith(".svelte")) {
        if (!viewDirs.some((dir) => isInside(dir, target))) {
          report(
            {
              rule: "V1",
              file: viewFile,
              line: imp.line,
              message: `${at} imports ${imp.spec} — ${path.basename(target)} is not under a view folder (${viewDirs.map((dir) => toPosix(path.relative(root, dir))).join(", ")}); move it there so it ships as a view`,
            },
            imp.spec,
          );
        }
        continue;
      }

      if (!target.endsWith(".js")) {
        report(
          {
            rule: "V1",
            file: viewFile,
            line: imp.line,
            message: `${at} imports ${imp.spec} — views import only .svelte files and relative .js view helpers`,
          },
          imp.spec,
        );
        continue;
      }

      if (!isInside(themeDir, target)) {
        report(
          {
            rule: "V1",
            file: viewFile,
            line: imp.line,
            message: `${at} imports ${imp.spec} — view helpers must live under ${toPosix(path.relative(root, themeDir))}/ so they ship with the views`,
          },
          imp.spec,
        );
        continue;
      }

      direct.add(target);
      await checkHelper(target, base);
    }

    const closure = new Set();
    const pending = [...direct];

    while (pending.length > 0) {
      const next = /** @type {string} */ (pending.pop());

      if (closure.has(next)) continue;

      closure.add(next);
      for (const dep of helperDeps.get(next) ?? []) pending.push(dep);
    }

    closures.set(name, closure);

    for (const use of findContextUses(programs, source)) {
      report(
        {
          rule: "V5",
          file: viewFile,
          line: use.line,
          message: `${base}:${use.line} ${use.text}: views run in two Svelte copies on the server; take it as a prop or read host data through @panomc/sdk`,
        },
        use.text,
      );
    }
  }

  await checkControllers(project, files, report);
  await checkSamples(project, files, report);

  violations.sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line,
  );

  return {
    views,
    helpers: new Map([...closures].map(([name, set]) => [name, [...set].sort()])),
    violations,
  };
}

/** Packages and prefixes a controller (and everything it imports) may not touch (V2). */
function isFrameworkSpecifier(spec) {
  return (
    isPackageOrSubpath(spec, ["svelte", "svelte-i18n", "@panomc/sdk"]) ||
    spec === "$app" ||
    spec.startsWith("$app/")
  );
}

/**
 * V2: walks the relative imports from every public controller.
 *
 * @param {KitProject} project
 * @param {ReturnType<typeof createSourceCache>} files
 * @param {(violation: Violation, spec: string) => void} report
 */
async function checkControllers(project, files, report) {
  /** @type {Map<string, string | null>} module -> module that first reached it */
  const parents = new Map();
  /** @type {string[]} */
  const queue = [];

  for (const entry of controllerFiles(project)) {
    parents.set(entry, null);
    queue.push(entry);
  }

  /** @param {string} file */
  function chainTo(file) {
    const chain = [];
    /** @type {string | null | undefined} */
    let current = file;

    while (current) {
      chain.unshift(current);
      current = parents.get(current);
    }

    return chain;
  }

  for (let index = 0; index < queue.length; index++) {
    const file = queue[index];
    const { imports } = await files.load(file);

    for (const imp of imports) {
      let offender = null;

      if (!isRelative(imp.spec)) {
        if (isFrameworkSpecifier(imp.spec)) offender = imp.spec;
      } else {
        const target = resolveRelative(file, imp.spec);

        if (!target) continue;

        if (target.endsWith(".svelte")) offender = imp.spec;
        else if (target.endsWith(".js") && !parents.has(target)) {
          parents.set(target, file);
          queue.push(target);
        }
      }

      if (offender === null) continue;

      const chain = chainTo(file).map((module) => displayPath(project, module));
      chain[chain.length - 1] += `:${imp.line}`;

      report(
        {
          rule: "V2",
          file,
          line: imp.line,
          message: `${chain.join(" -> ")} imports ${offender} — controllers are framework-free; use host.session().`,
        },
        imp.spec,
      );
    }
  }
}

/**
 * V3: walks the relative imports from every `*.samples.js`.
 *
 * @param {KitProject} project
 * @param {ReturnType<typeof createSourceCache>} files
 * @param {(violation: Violation, spec: string) => void} report
 */
async function checkSamples(project, files, report) {
  const samples = listFiles(project.viewDirs, (file) => file.endsWith(".samples.js"));

  for (const entry of samples) {
    /** @type {Map<string, string | null>} */
    const parents = new Map([[entry, null]]);
    const queue = [entry];

    /** @param {string} file */
    const chainTo = (file) => {
      const chain = [];
      /** @type {string | null | undefined} */
      let current = file;

      while (current) {
        chain.unshift(current);
        current = parents.get(current);
      }

      return chain;
    };

    for (let index = 0; index < queue.length; index++) {
      const file = queue[index];
      const { imports } = await files.load(file);

      for (const imp of imports) {
        let offender = false;

        if (!isRelative(imp.spec)) {
          offender = true;
        } else {
          const target = resolveRelative(file, imp.spec);

          if (!target) continue;

          if (!target.endsWith(".js")) offender = true;
          else if (!parents.has(target)) {
            parents.set(target, file);
            queue.push(target);
          }
        }

        if (!offender) continue;

        const chain = chainTo(file).map((module) => displayPath(project, module));
        chain[chain.length - 1] += `:${imp.line}`;

        report(
          {
            rule: "V3",
            file,
            line: imp.line,
            message: `${chain.join(" -> ")} imports ${imp.spec} — sample files are pure data: import only view helpers and other relative .js fixtures (no packages, no Svelte, no @panomc/sdk)`,
          },
          imp.spec,
        );
      }
    }
  }
}

/**
 * Whether the rules run in migration mode.
 *
 * @param {RulesOptions} options
 * @returns {'warn' | 'error'}
 */
export function viewImportsMode(options = {}) {
  if (options.viewImports) return options.viewImports;
  return process.env.PANO_VIEW_IMPORTS === "warn" ? "warn" : "error";
}

/**
 * Build rules V1-V3 and V5 (doc 02 section 5.4, doc 01 section 2).
 *
 * @param {RulesOptions} [options]
 * @returns {import('rollup').Plugin & { api: { readonly viewImports: 'warn' | 'error', manifestFlags(): { viewImports?: 'warn' }, violations: Violation[] } }}
 */
export function panoRules(options = {}) {
  /** @type {Violation[]} */
  let violations = [];

  const api = {
    get viewImports() {
      return viewImportsMode(options);
    },
    manifestFlags() {
      return viewImportsMode(options) === "warn" ? { viewImports: /** @type {'warn'} */ ("warn") } : {};
    },
    get violations() {
      return violations;
    },
  };

  return {
    name: "pano-rules",
    api,

    async buildStart() {
      const project = await resolveProject(options);
      const analysis = await analyzeProject(project);
      const mode = viewImportsMode(options);

      violations = analysis.violations;

      if (options.context) {
        options.context.viewImports = mode;
        options.context.violations = violations;
      }

      for (const file of listFiles(project.viewDirs, (name) => name.endsWith(".samples.js"))) {
        this.addWatchFile(file);
      }

      for (const file of controllerFiles(project)) this.addWatchFile(file);

      /** @type {Violation[]} */
      const failing = [];

      for (const violation of violations) {
        if (mode === "warn" && (violation.rule === "V1" || violation.rule === "V5")) {
          this.warn(`${violation.message} (PANO_VIEW_IMPORTS=warn: migration mode, this will be an error)`);
        } else {
          failing.push(violation);
        }
      }

      if (failing.length === 1) {
        this.error(failing[0].message);
      } else if (failing.length > 1) {
        this.error(
          `${failing.length} build rule violations:\n${failing.map((violation) => `  ${violation.rule} ${violation.message}`).join("\n")}`,
        );
      }
    },
  };
}

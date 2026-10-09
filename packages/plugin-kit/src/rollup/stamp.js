import fs from "node:fs";
import path from "node:path";
import MagicString from "magic-string";
import {
  controllerFiles,
  lineOf,
  parsePrograms,
  resolveProject,
  walk,
} from "./rules.js";

/**
 * Version stamping (doc 02 section 2): a plugin's own default views always match the
 * controllers they ship with, so the build adds the current version to every literal
 * controller call of a compiled view:
 *
 *   plugin('market').require('cart')   ->   plugin('market').require('cart', { version: 1 })
 *
 * Only the compiled output is stamped; the readable copy in `contract/src` is the author's
 * source and stays as written. Recognised calls: `.require(name)`, `.use(name)` and
 * `.load(name)` on `plugin(...)` or on a variable (or destructured name) bound to it, and
 * `useController('<ns>/<name>')`. A controller name that is not a string literal is a build
 * error because the version cannot be known. Calls on another namespace are left alone.
 *
 * The plugin exposes `api.usage` for `pano-plugin.json`: a Map of view name -> object of
 * `'<ns>/<name>': version` for the controllers that view uses.
 */

const METHODS = new Set(["require", "use", "load"]);
const CONTROLLERS_MODULE = "@panomc/sdk/controllers";

/**
 * @typedef {object} StampOptions
 * @property {Record<string, number>} [controllers] controller name (`cart` or `market/cart`) -> version; default: read from the controller files
 * @property {string} [root] plugin root, default the current directory
 * @property {string[]} [viewDirs] view folders relative to `root`
 * @property {string} [themeDir] default `src/theme`
 * @property {string} [controllersDir] default `<themeDir>/controllers`
 * @property {string} [namespace] own namespace
 * @property {Record<string, any>} [context] shared build context: gets `controllerUsage`
 */

/**
 * Reads `{ name: version }` from the `defineController({ name, version })` call of every
 * public controller file. A controller without a literal version is left out.
 *
 * @param {import('./rules.js').KitProject} project
 * @returns {Promise<Record<string, number>>}
 */
export async function readControllerVersions(project) {
  /** @type {Record<string, number>} */
  const versions = {};

  for (const file of controllerFiles(project)) {
    const source = fs.readFileSync(file, "utf8");
    const programs = await parsePrograms(file, source);

    walk(programs, (node) => {
      if (
        node.type !== "CallExpression" ||
        node.callee.type !== "Identifier" ||
        node.callee.name !== "defineController" ||
        node.arguments[0]?.type !== "ObjectExpression"
      ) {
        return;
      }

      /** @type {Record<string, any>} */
      const literals = {};

      for (const property of node.arguments[0].properties) {
        if (property.type !== "Property" || property.computed) continue;

        const key = property.key.name ?? property.key.value;

        if (property.value.type === "Literal") literals[key] = property.value.value;
      }

      if (Number.isInteger(literals.version)) {
        const name =
          typeof literals.name === "string" ? literals.name : path.basename(file, ".js");

        versions[name] = literals.version;
      }
    });
  }

  return versions;
}

/**
 * The string a call argument names, or null when it is not a literal.
 *
 * @param {any} node
 * @returns {string | null}
 */
function literalString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? null;
  }
  return null;
}

/**
 * Line (1-based) of a controller call in the author's `.svelte` source. Compiled output has
 * other line numbers, so the call is searched by text: the first `label(<needle>` for a
 * literal name, else the first `label(` whose argument is not a string.
 *
 * @param {string} original
 * @param {string} label
 * @param {string} needle
 * @param {boolean} literal
 * @returns {number | null}
 */
export function locateCall(original, label, needle, literal) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = literal
    ? new RegExp(`\\b${label}\\(\\s*['"\`]${escaped}['"\`]`)
    : new RegExp(`\\b${label}\\(\\s*${escaped}`);
  let match = exact.exec(original);

  if (!match && !literal) {
    const loose = new RegExp(`\\b${label}\\((?!\\s*['"\`])`);
    match = loose.exec(original);
  }

  return match ? lineOf(original, match.index) : null;
}

/**
 * Stamps `{ version }` into the controller calls of one compiled view module.
 *
 * @param {object} input
 * @param {string} input.code compiled JavaScript of the view
 * @param {any} input.ast its ESTree program
 * @param {string} input.viewFile display name of the view file, e.g. `ProductCard.svelte`
 * @param {string} input.source text the AST offsets refer to (the same as `code`)
 * @param {string} input.namespace own namespace
 * @param {Map<string, number>} input.versions short controller name -> version
 * @param {(label: string, needle: string, literal: boolean) => number | null} [input.locate] line of a call in the author's source (compiled lines mean nothing to the author); default: the line in `code`
 * @returns {{ code: string, map: any, used: Record<string, number>, errors: string[], warnings: string[] } | null} null when the view has no controller calls
 */
export function stampController({ code, ast, viewFile, source, namespace, versions, locate }) {
  /** @type {Set<string>} */
  const pluginLocals = new Set();
  /** @type {Set<string>} */
  const useControllerLocals = new Set();

  walk(ast, (node) => {
    if (node.type !== "ImportDeclaration" || node.source?.value !== CONTROLLERS_MODULE) return;

    for (const specifier of node.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;

      const imported = specifier.imported.name ?? specifier.imported.value;

      if (imported === "plugin") pluginLocals.add(specifier.local.name);
      else if (imported === "useController") useControllerLocals.add(specifier.local.name);
    }
  });

  if (pluginLocals.size === 0 && useControllerLocals.size === 0) return null;

  /** @param {any} node */
  const isPluginCall = (node) =>
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    pluginLocals.has(node.callee.name);

  /** @type {Map<string, string | null>} variable -> namespace literal of the plugin(...) it holds */
  const pluginVars = new Map();
  /** @type {Map<string, string | null>} destructured method local -> namespace literal */
  const methodLocals = new Map();

  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || !isPluginCall(node.init)) return;

    const ns = literalString(node.init.arguments[0]);

    if (node.id.type === "Identifier") {
      pluginVars.set(node.id.name, ns);
    } else if (node.id.type === "ObjectPattern") {
      for (const property of node.id.properties) {
        if (
          property.type === "Property" &&
          !property.computed &&
          METHODS.has(property.key.name ?? property.key.value) &&
          property.value.type === "Identifier"
        ) {
          methodLocals.set(property.value.name, ns);
        }
      }
    }
  });

  const s = new MagicString(code);
  /** @type {Record<string, number>} */
  const used = {};
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  let sawCall = false;

  /**
   * @param {any} node
   * @param {string} label
   * @param {string} needle
   * @param {boolean} literal
   */
  const at = (node, label, needle, literal) => {
    const line = locate ? locate(label, needle, literal) : lineOf(source, node.start);
    return line === null ? viewFile : `${viewFile}:${line}`;
  };

  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;

    const callee = node.callee;
    /** @type {{ label: string, ns: string | null | undefined } | null} */
    let hit = null;
    let fullName = false;

    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier" &&
      METHODS.has(callee.property.name)
    ) {
      if (isPluginCall(callee.object)) {
        hit = { label: callee.property.name, ns: literalString(callee.object.arguments[0]) };
      } else if (callee.object.type === "Identifier" && pluginVars.has(callee.object.name)) {
        hit = { label: callee.property.name, ns: pluginVars.get(callee.object.name) };
      }
    } else if (callee.type === "Identifier" && methodLocals.has(callee.name)) {
      hit = { label: callee.name, ns: methodLocals.get(callee.name) };
    } else if (callee.type === "Identifier" && useControllerLocals.has(callee.name)) {
      hit = { label: callee.name, ns: undefined };
      fullName = true;
    }

    if (!hit) return;

    sawCall = true;

    const [nameArg, optionsArg] = node.arguments;
    const name = literalString(nameArg);

    if (name === null) {
      const written = nameArg ? source.slice(nameArg.start, nameArg.end) : "";
      errors.push(
        `${at(node, hit.label, written, false)} ${hit.label}(${written}) — controller names must be string literals so the build can stamp their version`,
      );
      return;
    }

    let own = name;

    if (fullName) {
      const slash = name.indexOf("/");

      if (slash < 0) return;
      if (name.slice(0, slash) !== namespace) return;

      own = name.slice(slash + 1);
    } else if (hit.ns === null || (hit.ns !== undefined && hit.ns !== namespace)) {
      // another plugin's controller, or a namespace the build cannot read: not ours to stamp
      return;
    }

    const version = versions.get(own);

    if (version === undefined) {
      warnings.push(
        `${at(node, hit.label, name, true)} ${hit.label}('${name}') — no controller named ${own} in the controllers folder, so no version is stamped`,
      );
      return;
    }

    used[`${namespace}/${own}`] = version;

    if (!optionsArg) {
      s.appendLeft(nameArg.end, `, { version: ${version} }`);
    } else if (optionsArg.type === "ObjectExpression") {
      const hasVersion = optionsArg.properties.some(
        (property) =>
          property.type === "Property" &&
          !property.computed &&
          (property.key.name ?? property.key.value) === "version",
      );

      if (hasVersion) return;

      const last = optionsArg.properties[optionsArg.properties.length - 1];

      if (last) s.appendLeft(last.end, `, version: ${version}`);
      else s.appendLeft(optionsArg.start + 1, ` version: ${version} `);
    } else {
      s.appendLeft(optionsArg.start, "{ ...(");
      s.appendRight(optionsArg.end, `), version: ${version} }`);
    }
  });

  if (!sawCall) return null;

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true }),
    used,
    errors,
    warnings,
  };
}

/**
 * Stamps { version: N } into literal controller calls of compiled views (doc 02 section 2).
 *
 * @param {StampOptions} [options]
 * @returns {import('rollup').Plugin & { api: { readonly usage: Map<string, Record<string, number>>, readonly versions: Map<string, number> } }}
 */
export function panoStamp(options = {}) {
  /** @type {import('./rules.js').KitProject | null} */
  let project = null;
  /** @type {Map<string, number>} */
  let versions = new Map();
  /** @type {Map<string, Record<string, number>>} */
  const usage = new Map();

  const api = {
    get usage() {
      return usage;
    },
    get versions() {
      return versions;
    },
  };

  /** @param {string} name */
  const shortName = (name) => (name.includes("/") ? name.slice(name.indexOf("/") + 1) : name);

  return {
    name: "pano-stamp",
    api,

    async buildStart() {
      project = await resolveProject(options);

      const source = options.controllers ?? (await readControllerVersions(project));

      versions = new Map(Object.entries(source).map(([name, version]) => [shortName(name), version]));

      if (options.context) options.context.controllerUsage = usage;
    },

    transform: {
      order: "post",
      handler(code, id) {
        if (!project || !id.endsWith(".svelte")) return null;

        const file = path.resolve(id);

        if (!project.viewDirs.some((dir) => file.startsWith(dir + path.sep))) return null;

        const viewFile = path.basename(file);
        let ast;

        try {
          ast = this.parse(code);
        } catch (error) {
          this.error(
            `${viewFile}: pano-stamp needs compiled JavaScript but found something else (${/** @type {Error} */ (error).message}); the Svelte compiler must run before it`,
          );
        }

        let original = "";

        try {
          original = fs.readFileSync(file, "utf8");
        } catch {
          // virtual or generated view: lines fall back to the compiled output
        }

        const result = stampController({
          code,
          ast,
          viewFile,
          source: code,
          namespace: project.namespace,
          versions,
          locate: original ? (label, needle, literal) => locateCall(original, label, needle, literal) : undefined,
        });

        usage.set(path.basename(file, ".svelte"), result?.used ?? {});

        if (!result) return null;

        for (const warning of result.warnings) this.warn(warning);

        if (result.errors.length === 1) this.error(result.errors[0]);
        if (result.errors.length > 1) {
          this.error(`${result.errors.length} controller calls cannot be stamped:\n  ${result.errors.join("\n  ")}`);
        }

        return { code: result.code, map: result.map };
      },
    },
  };
}

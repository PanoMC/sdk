import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { namespaceOf, readProperty } from "../config.js";
import { diffSection, readLock, writeLockSection } from "./lock.js";

/**
 * panoViews (doc 01 section 2, doc 02 section 4): the view half of the plugin build.
 *
 *  - scans every `.svelte` file under `dirs`; name = basename, id = `<ns>:<Name>`;
 *  - reads the literal `export const view = {...}` and the props (`$props()` /
 *    `export let`, type from the preceding JSDoc) without running anything;
 *  - generates the virtual module `pano:views` (`ViewDef[]`, every def carries `pluginId`);
 *  - rewrites every import of a view file to a proxy module
 *    `export * from "<file>"; export default createViewProxy("<ns>:<Name>", Default)`;
 *  - writes `contract/views.json` (the record shape of doc 01 section 1) and a readable
 *    copy of every view to `contract/src/<path under src/theme>` (after the optional
 *    `transformSource` step, which is where the root-class step of doc 03 plugs in);
 *  - keeps section `views` of `pano-plugin.lock.json`: a watch build warns, a build fails.
 *
 * Errors name the file, the line and the fix.
 */

export const VIRTUAL_VIEWS_ID = "\0pano:views";
export const PROXY_PREFIX = "\0pano-view:";

const VIEW_NAME = /^[A-Z][A-Za-z0-9]*$/;
const SLOT_ID = /^[a-z0-9][a-z0-9:-]*$/;
const SDK_VIEWS_SPECIFIER = "@panomc/sdk/views";
const DEFAULT_INJECT_PRIORITY = 10;

/** Keys of `export const view` (doc 01 section 2). */
const VIEW_KEYS = new Set([
  "contract",
  "path",
  "systemLayout",
  "layout",
  "permission",
  "loginRequired",
  "resetLayout",
  "controller",
  "slot",
  "hook",
  "sidebar",
  "id",
  "priority",
  "skipLoad",
  "block",
  "home",
  "widget",
]);

const PAGE_KEYS = ["systemLayout", "layout", "permission", "loginRequired", "resetLayout"];

/**
 * @typedef {object} PanoViewsOptions
 * @property {string[]} dirs view folders, relative to `root` (or absolute)
 * @property {string} namespace plugin namespace (checked against the reserved list)
 * @property {string} pluginId full plugin id, carried by every view def
 * @property {string} [root] plugin root, default the current directory
 * @property {string} [outDir] folder that receives `contract/`, default `<root>/src/main/resources/plugin-ui`
 * @property {(source: string, ctx: { ns: string, view: string, file: string }) => string | Promise<string>} [transformSource]
 *   runs on the source written to `contract/src` (never on the compiled code)
 * @property {boolean} [watch] treat the build as a watch build (default: rollup's `meta.watchMode`)
 * @property {'server' | 'client' | 'controllers' | 'widgets'} [side] the build this plugin runs in; the server build writes no readable copies and does not prune
 * @property {boolean} [lock] keep `pano-plugin.lock.json` (default true)
 * @property {string} [version] plugin version for `views.json` (default: `version` of gradle.properties)
 * @property {string} [viewsSpecifier] where `createViewProxy` comes from (default `@panomc/sdk/views`)
 * @property {(info: ViewInfo) => string[] | undefined} [classes]
 *   the classes the lock keeps for a view (doc 03 section 1.3: root class always, parts with the badge);
 *   without it the lock carries the stored `classes` over untouched
 */

/**
 * @typedef {object} ViewInfo
 * @property {string} name basename without `.svelte`
 * @property {string} id `<ns>:<Name>`
 * @property {string} file absolute path
 * @property {string} rel path relative to the plugin root
 * @property {string} source file content
 * @property {string} contractPath path of the readable copy relative to `contract/`
 * @property {Record<string, any>} record the entry of `contract/views.json`
 * @property {Record<string, any>} def the `ViewDef` fields except `component`
 */

/** A build error with a location; turned into `this.error` by the plugin. */
export class ViewsError extends Error {
  /**
   * @param {string} message
   * @param {{ file?: string, line?: number }} [where]
   */
  constructor(message, where = {}) {
    super(message);
    this.name = "ViewsError";
    this.file = where.file;
    this.line = where.line;
  }
}

/**
 * @param {string} p
 * @returns {string}
 */
const slash = (p) => p.replace(/\\/g, "/");

/**
 * @param {string} source
 * @param {number} offset
 * @returns {number} 1-based line
 */
function lineOf(source, offset) {
  let line = 1;

  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }

  return line;
}

/**
 * Loads `svelte/compiler`: the plugin's own copy first (the kit lists svelte as a peer),
 * then the one next to the kit.
 *
 * @param {string} root
 * @returns {Promise<{ parse: Function }>}
 */
async function loadCompiler(root) {
  // Under Node `require.resolve("svelte/compiler")` answers the CommonJS build, whose `import()` has only
  // `{ default }`: import the compiler's ES build from the plugin's own svelte instead. Bun's import of the
  // resolved file has the named exports, so it keeps today's path.
  if (!process.versions.bun) {
    try {
      const dir = path.dirname(createRequire(path.join(root, "noop.js")).resolve("svelte/package.json"));
      const module = await import(pathToFileURL(path.join(dir, "src/compiler/index.js")).href);

      if (typeof module.parse === "function") return module;
    } catch {
      // fall through to the path below
    }
  }

  try {
    const resolved = createRequire(path.join(root, "noop.js")).resolve("svelte/compiler");

    return await import(pathToFileURL(resolved).href);
  } catch {
    return await import("svelte/compiler");
  }
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".svelte")) out.push(full);
  }
}

/** Thrown by `literal` with the dotted key path of the first non-literal value. */
class NotLiteral extends Error {
  /**
   * @param {string} where
   * @param {number} start
   */
  constructor(where, start) {
    super(where);
    this.where = where;
    this.start = start;
  }
}

/**
 * Evaluates a JSON-like AST node (strings, numbers, booleans, null, arrays, objects, plain
 * template literals, signed numbers) without running code.
 *
 * @param {any} node
 * @param {string} where dotted key path, for the error
 * @returns {any}
 */
function literal(node, where) {
  switch (node?.type) {
    case "Literal":
      if (node.regex || typeof node.value === "bigint") break;
      return node.value;

    case "TemplateLiteral":
      if (node.expressions.length === 0) return node.quasis[0].value.cooked;
      break;

    case "UnaryExpression":
      if (
        (node.operator === "-" || node.operator === "+") &&
        node.argument?.type === "Literal" &&
        typeof node.argument.value === "number"
      ) {
        return node.operator === "-" ? -node.argument.value : node.argument.value;
      }
      break;

    case "ArrayExpression":
      return node.elements.map((element, index) => {
        if (!element || element.type === "SpreadElement") {
          throw new NotLiteral(`${where}[${index}]`, node.start);
        }

        return literal(element, `${where}[${index}]`);
      });

    case "ObjectExpression": {
      /** @type {Record<string, any>} */
      const out = {};

      for (const property of node.properties) {
        if (
          property.type !== "Property" ||
          property.computed ||
          property.kind !== "init" ||
          property.method ||
          property.shorthand
        ) {
          throw new NotLiteral(where, property.start ?? node.start);
        }

        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.type === "Literal"
              ? String(property.key.value)
              : null;

        if (key === null) throw new NotLiteral(where, property.start);

        out[key] = literal(property.value, where ? `${where}.${key}` : key);
      }

      return out;
    }

    default:
      break;
  }

  throw new NotLiteral(where, node?.start ?? 0);
}

/**
 * The JSDoc block that ends right before `offset` (only whitespace between), or "".
 *
 * @param {string} source
 * @param {number} offset
 * @returns {string}
 */
function jsdocBefore(source, offset) {
  const before = source.slice(0, offset).trimEnd();

  if (!before.endsWith("*/")) return "";

  const start = before.lastIndexOf("/*");

  if (start < 0 || !before.startsWith("/**", start)) return "";

  return before.slice(start, before.length);
}

/**
 * The text inside the braces of the first `@type {...}` of a JSDoc block.
 *
 * @param {string} doc
 * @returns {string | null}
 */
function typeTag(doc) {
  const at = doc.search(/@type\s*\{/);

  if (at < 0) return null;

  let depth = 0;
  const open = doc.indexOf("{", at);

  for (let i = open; i < doc.length; i += 1) {
    if (doc[i] === "{") depth += 1;
    else if (doc[i] === "}") {
      depth -= 1;

      if (depth === 0) {
        return doc
          .slice(open + 1, i)
          .replace(/^\s*\*\s?/gm, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }

  return null;
}

/**
 * Splits `{ a: string, b?: Product[] }` into its members; null when `type` is not an
 * object type literal.
 *
 * @param {string} type
 * @returns {Record<string, { type: string, optional: boolean }> | null}
 */
function objectTypeMembers(type) {
  const text = type.trim();

  if (!text.startsWith("{") || !text.endsWith("}")) return null;

  const inner = text.slice(1, -1);
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";

  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];

    if (quote) {
      current += char;
      if (char === quote && inner[i - 1] !== "\\") quote = "";
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if ("{[(<".includes(char)) depth += 1;
    else if ("}])".includes(char)) depth -= 1;
    else if (char === ">" && inner[i - 1] !== "=") depth -= 1;

    if (depth === 0 && (char === "," || char === ";")) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  parts.push(current);

  /** @type {Record<string, { type: string, optional: boolean }>} */
  const members = {};

  for (const part of parts) {
    const match = /^\s*(?:readonly\s+)?(["']?)([A-Za-z_$][\w$-]*)\1\s*(\?)?\s*:\s*([\s\S]+?)\s*$/.exec(part);

    if (match) members[match[2]] = { type: match[4].replace(/\s+/g, " "), optional: Boolean(match[3]) };
  }

  return members;
}

/**
 * Props of a view: `let { a, b = 1, ...rest } = $props()` or `export let a`.
 * `required` = no default value and not marked `?` in the JSDoc type.
 *
 * @param {any[]} body statements of the instance script
 * @param {string} source
 * @returns {Record<string, { type: string, required: boolean }>}
 */
function readProps(body, source) {
  /** @type {Record<string, { type: string, required: boolean }>} */
  const props = {};

  for (const statement of body) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations) {
        const init = declarator.init;

        if (
          init?.type !== "CallExpression" ||
          init.callee?.type !== "Identifier" ||
          init.callee.name !== "$props"
        ) {
          continue;
        }

        const tag = typeTag(jsdocBefore(source, statement.start));
        const members = (tag && objectTypeMembers(tag)) || {};

        if (declarator.id.type === "ObjectPattern") {
          for (const property of declarator.id.properties) {
            if (property.type !== "Property" || property.computed) continue;

            const name = property.key.type === "Identifier" ? property.key.name : String(property.key.value);
            const hasDefault = property.value.type === "AssignmentPattern";
            const member = members[name];

            props[name] = {
              type: member?.type ?? "any",
              required: !hasDefault && !member?.optional,
            };
          }
        } else {
          for (const [name, member] of Object.entries(members)) {
            props[name] = { type: member.type, required: !member.optional };
          }
        }
      }
    } else if (
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration?.type === "VariableDeclaration" &&
      statement.declaration.kind !== "const"
    ) {
      const tag = typeTag(jsdocBefore(source, statement.start));

      for (const declarator of statement.declaration.declarations) {
        if (declarator.id.type !== "Identifier") continue;

        props[declarator.id.name] = { type: tag ?? "any", required: declarator.init === null };
      }
    }
  }

  return props;
}

/**
 * Literal value of an attribute node of a component, or `undefined` when it is not literal.
 *
 * @param {any} attribute
 * @returns {string | undefined}
 */
function literalAttribute(attribute) {
  const value = attribute.value;

  if (value === true) return undefined;

  if (Array.isArray(value)) {
    if (value.length === 1 && value[0].type === "Text") return value[0].data;
    if (value.length === 1 && value[0].type === "ExpressionTag") return literalExpression(value[0].expression);

    return undefined;
  }

  if (value?.type === "ExpressionTag") return literalExpression(value.expression);

  return undefined;
}

/**
 * @param {any} expression
 * @returns {string | undefined}
 */
function literalExpression(expression) {
  if (expression?.type === "Literal" && typeof expression.value === "string") return expression.value;

  if (expression?.type === "TemplateLiteral" && expression.expressions.length === 0) {
    return expression.quasis[0].value.cooked;
  }

  return undefined;
}

/**
 * Visits every template node.
 *
 * @param {any} node
 * @param {(node: any) => void} visit
 */
function walkTemplate(node, visit) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) walkTemplate(child, visit);

    return;
  }

  if (typeof node.type === "string") visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === "metadata" || key === "loc" || key === "parent") continue;
    if (value && typeof value === "object") walkTemplate(value, visit);
  }
}

/**
 * @param {string} message
 * @param {string} file
 * @param {number} line
 */
const fail = (message, file, line) => {
  throw new ViewsError(`${file}:${line} ${message}`, { file, line });
};

/**
 * Parses one view file into its record, its def and the facts the cross checks need.
 *
 * @param {{ parse: Function }} compiler
 * @param {string} file absolute path
 * @param {string} rel path relative to the root, for messages
 * @param {string} source
 * @param {{ ns: string, name: string }} names
 * @param {string[]} warnings
 */
function parseView(compiler, file, rel, source, names, warnings) {
  /** @type {any} */
  let ast;

  try {
    ast = compiler.parse(source, { modern: true });
  } catch (error) {
    const line = error?.start?.line ?? error?.position?.[0] ?? 1;

    fail(
      `${error?.message ?? error} — fix the syntax error; this file is read by the plugin build`,
      rel,
      typeof line === "number" ? line : 1,
    );
  }

  // export const view
  /** @type {Record<string, any>} */
  let view = {};
  let viewLine = 1;

  for (const statement of ast.module?.content?.body ?? []) {
    if (statement.type !== "ExportNamedDeclaration") continue;

    const declaration = statement.declaration;
    const declaresView =
      declaration?.type === "VariableDeclaration" &&
      declaration.declarations.some((d) => d.id?.name === "view");
    const specifiesView = statement.specifiers?.some((s) => s.exported?.name === "view");

    if (specifiesView) {
      fail(
        "export { view } cannot be read — declare it in place as: export const view = { ... } with literal values",
        rel,
        lineOf(source, statement.start),
      );
    }

    if (!declaresView) continue;

    viewLine = lineOf(source, statement.start);

    const declarator = declaration.declarations.find((d) => d.id?.name === "view");

    if (declaration.kind !== "const" || declarator.init?.type !== "ObjectExpression") {
      fail(
        "export const view must be an object literal — write: export const view = { path: \"/x\" }",
        rel,
        viewLine,
      );
    }

    try {
      view = literal(declarator.init, "view");
    } catch (error) {
      if (!(error instanceof NotLiteral)) throw error;

      fail(
        `export const view is not a literal (${error.where}) — the build reads it without running it; use only strings, numbers, booleans, arrays and objects, and move computed values elsewhere`,
        rel,
        lineOf(source, error.start),
      );
    }
  }

  for (const key of Object.keys(view)) {
    if (!VIEW_KEYS.has(key)) {
      warnings.push(
        `${rel}:${viewLine} unknown key "${key}" in export const view — it is ignored (known: ${[...VIEW_KEYS].join(", ")})`,
      );
    }
  }

  if (view.contract !== undefined && (!Number.isInteger(view.contract) || view.contract < 1)) {
    fail("view.contract must be a whole number of 1 or more — write: contract: 2", rel, viewLine);
  }

  if (view.path !== undefined && (typeof view.path !== "string" || !view.path.startsWith("/"))) {
    fail('view.path must be a string that starts with "/" — write: path: "/hello"', rel, viewLine);
  }

  for (const key of ["slot", "hook", "sidebar"]) {
    const value = view[key];

    if (
      value !== undefined &&
      !(typeof value === "string" || (Array.isArray(value) && value.every((v) => typeof v === "string")))
    ) {
      fail(`view.${key} must be a string or an array of strings`, rel, viewLine);
    }
  }

  // props
  const props = readProps(ast.instance?.content?.body ?? [], source);

  // slots, hooks, child views
  const slots = new Set();
  const hooks = new Set();

  walkTemplate(ast.fragment, (node) => {
    if (node.type !== "Component") return;

    if (node.name === "PluginSlot") {
      const line = lineOf(source, node.start);
      const attribute = node.attributes.find((a) => a.type === "Attribute" && a.name === "id");
      const id = attribute ? literalAttribute(attribute) : undefined;

      if (id === undefined) {
        fail(
          `<PluginSlot> needs a literal id — write id="${names.ns}:<slot>" (the build lists slot ids in the view contract; a computed id cannot be listed)`,
          rel,
          line,
        );
      }

      if (!id.startsWith(`${names.ns}:`) || !SLOT_ID.test(id) || id.length === names.ns.length + 1) {
        fail(
          `<PluginSlot id="${id}"> is outside this plugin's namespace — slot ids of ${names.ns} look like "${names.ns}:<slot>" (lowercase letters, digits, ":" and "-"); rename it to "${names.ns}:${id.split(":").pop() || "slot"}"`,
          rel,
          line,
        );
      }

      slots.add(id);
    } else if (node.name === "Hook") {
      const attribute = node.attributes.find((a) => a.type === "Attribute" && a.name === "name");
      const name = attribute ? literalAttribute(attribute) : undefined;

      if (name !== undefined) hooks.add(name);
    }
  });

  const imports = [];

  for (const script of [ast.module, ast.instance]) {
    for (const statement of script?.content?.body ?? []) {
      if (statement.type === "ImportDeclaration" && typeof statement.source.value === "string") {
        imports.push(statement.source.value);
      }
    }
  }

  return { view, viewLine, props, slots: [...slots].sort(), hooks: [...hooks].sort(), imports };
}

/**
 * The `ViewDef` fields (`inject`, `page`, `home`) of one view from its `export const view`.
 *
 * @param {Record<string, any>} view
 * @param {string} id
 * @param {string} rel
 * @param {number} line
 * @param {string[]} warnings
 */
function describeView(view, id, rel, line, warnings) {
  /** @type {Record<string, any> | null} */
  let page = null;

  if (view.path !== undefined) {
    page = { path: view.path };

    for (const key of PAGE_KEYS) if (view[key] !== undefined) page[key] = view[key];

    if (view.controller !== undefined) page.controller = view.controller;
  } else if (view.controller !== undefined) {
    warnings.push(`${rel}:${line} view.controller is ignored without view.path (controllers load page data)`);
  }

  /** @type {Record<string, any>[]} */
  const inject = [];
  const priority = typeof view.priority === "number" ? view.priority : DEFAULT_INJECT_PRIORITY;

  for (const kind of ["slot", "hook", "sidebar"]) {
    if (view[kind] === undefined) continue;

    const targets = Array.isArray(view[kind]) ? view[kind] : [view[kind]];

    for (const target of targets) {
      const item = { [kind]: target, id: typeof view.id === "string" ? view.id : id, priority };

      if (view.skipLoad !== undefined) item.skipLoad = view.skipLoad;

      inject.push(item);
    }
  }

  let home = null;

  if (view.home !== undefined) {
    if (typeof view.home !== "object" || view.home === null || typeof view.home.label !== "string") {
      fail('view.home must be { label: "..." } — the label is what the admin sees in the home page list', rel, line);
    }

    home = { label: view.home.label };

    if (!page) warnings.push(`${rel}:${line} view.home is offered but this view has no path; add path: "/..."`);
  }

  return {
    page,
    inject: inject.length > 0 ? inject : null,
    home,
    block: view.block === true || (view.widget !== undefined && view.widget !== null && view.widget !== false),
    widget: view.widget !== undefined ? view.widget : null,
    contract: view.contract ?? 1,
  };
}

/**
 * Where the readable copy of a view lives, relative to `contract/`: the path under
 * `src/theme/` (so relative imports between views keep working), else under `src/`.
 *
 * @param {string} root
 * @param {string} file
 * @returns {string}
 */
function contractPathOf(root, file) {
  const rel = slash(path.relative(root, file));

  for (const prefix of ["src/theme/", "src/"]) {
    if (rel.startsWith(prefix)) return `src/${rel.slice(prefix.length)}`;
  }

  return `src/${path.basename(file)}`;
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walkJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
}

/**
 * Rule of doc 01 section 2: `view: "<own ns>:X"` in `src/**\/*.js` must name a view of this plugin.
 *
 * @param {string} root
 * @param {string[]} prefixes `<ns>:` and `<pluginId>:`
 * @param {Set<string>} names view names of this plugin
 */
function checkViewLiterals(root, prefixes, names) {
  const src = path.join(root, "src");

  if (!fs.existsSync(src)) return;

  const files = [];

  walkJs(src, files);

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");

    for (const match of text.matchAll(/\bview\s*:\s*(["'`])([^"'`\n]+)\1/g)) {
      const value = match[2];
      const prefix = prefixes.find((p) => value.startsWith(p));

      if (!prefix) continue;

      const name = value.slice(prefix.length);

      if (!names.has(name)) {
        fail(
          `view: "${value}" names no view of this plugin — create ${name}.svelte in a view folder, or fix the name`,
          slash(path.relative(root, file)),
          lineOf(text, match.index),
        );
      }
    }
  }
}

/**
 * Scans the view folders of a plugin. Pure: reads files, writes nothing.
 *
 * @param {Pick<PanoViewsOptions, "dirs" | "namespace" | "pluginId" | "root" | "version">} options
 * @returns {Promise<{ namespace: string, pluginId: string, version: string, views: Map<string, ViewInfo>, byFile: Map<string, ViewInfo>, warnings: string[], missingDirs: string[] }>}
 */
export async function scanViews(options) {
  const root = path.resolve(options.root ?? process.cwd());
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const missingDirs = [];

  let namespace;

  try {
    namespace = namespaceOf(options.pluginId, { namespace: options.namespace });
  } catch (error) {
    throw new ViewsError(String(error.message).replace(/^\[pano-plugin\] /, ""), { file: "pano.plugin.js", line: 1 });
  }

  const compiler = await loadCompiler(root);
  const files = [];

  for (const dir of options.dirs) {
    const absolute = path.resolve(root, dir);

    if (!fs.existsSync(absolute)) {
      missingDirs.push(dir);
      continue;
    }

    walk(absolute, files);
  }

  /** @type {Map<string, ViewInfo>} */
  const views = new Map();
  /** @type {Map<string, ViewInfo>} */
  const byFile = new Map();
  /** @type {Map<string, string[]>} */
  const importsOf = new Map();

  for (const file of files) {
    const rel = slash(path.relative(root, file));
    const name = path.basename(file, ".svelte");

    if (!VIEW_NAME.test(name)) {
      fail(
        `view file names must start with an uppercase letter and use letters and digits only (the file name is the view name) — rename it, for example to ${name.replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, __, c) => c.toUpperCase()) || "View"}.svelte`,
        rel,
        1,
      );
    }

    const existing = views.get(name);

    if (existing) {
      fail(
        `view name "${name}" is already used by ${existing.rel} — the file name is the view name, so rename one of the two files`,
        rel,
        1,
      );
    }

    const source = fs.readFileSync(file, "utf8");
    const id = `${namespace}:${name}`;
    const parsed = parseView(compiler, file, rel, source, { ns: namespace, name }, warnings);
    const described = describeView(parsed.view, id, rel, parsed.viewLine, warnings);
    const contractPath = contractPathOf(root, file);

    /** @type {ViewInfo} */
    const info = {
      name,
      id,
      file,
      rel,
      source,
      contractPath,
      record: {
        kind: described.page ? "page" : "component",
        contract: described.contract,
        source: contractPath,
        props: Object.fromEntries(Object.entries(parsed.props).map(([k, v]) => [k, { type: v.type, required: v.required }])),
        uses: [],
        slots: parsed.slots,
        hooks: parsed.hooks,
        block: described.block,
        inject: described.inject,
        page: described.page,
        home: described.home,
        widget: described.widget,
      },
      def: {},
    };

    views.set(name, info);
    byFile.set(file, info);
    importsOf.set(file, parsed.imports);
  }

  // child views (`uses`) and the defs
  for (const info of views.values()) {
    const uses = new Set();

    for (const specifier of importsOf.get(info.file) ?? []) {
      if (!specifier.startsWith(".") || !specifier.endsWith(".svelte")) continue;

      const target = byFile.get(path.resolve(path.dirname(info.file), specifier));

      if (target && target !== info) uses.add(target.id);
    }

    info.record.uses = [...uses].sort();
    info.def = {
      name: info.id,
      pluginId: options.pluginId,
      contract: info.record.contract,
      kind: info.record.kind,
      uses: info.record.uses,
      slots: info.record.slots,
      hooks: info.record.hooks,
      block: info.record.block,
      inject: info.record.inject,
      page: info.record.page,
      home: info.record.home,
      ...(info.record.widget !== null ? { widget: info.record.widget } : {}),
    };
  }

  checkViewLiterals(root, [`${namespace}:`, `${options.pluginId}:`], new Set(views.keys()));

  return {
    namespace,
    pluginId: options.pluginId,
    version: options.version ?? readProperty(path.join(root, "gradle.properties"), "version") ?? "0.0.0",
    views,
    byFile,
    warnings,
    missingDirs,
  };
}

/**
 * The `contract/views.json` document.
 *
 * @param {Awaited<ReturnType<typeof scanViews>>} scan
 * @returns {Record<string, any>}
 */
export function buildViewsJson(scan) {
  const ids = [...scan.views.values()].map((v) => v.id).sort();
  const byId = new Map([...scan.views.values()].map((v) => [v.id, v]));

  return {
    namespace: scan.namespace,
    pluginId: scan.pluginId,
    version: scan.version,
    sdk: 2,
    views: Object.fromEntries(ids.map((id) => [id, byId.get(id)?.record])),
  };
}

/**
 * Section `views` of `pano-plugin.lock.json`. `classes` (written by the semantic-class
 * step, doc 03) is carried over from the previous section untouched.
 *
 * @param {Awaited<ReturnType<typeof scanViews>>} scan
 * @param {Record<string, any> | null | undefined} previous
 * @param {(info: ViewInfo) => string[] | undefined} [classesOf] classes to lock for a view (see `PanoViewsOptions.classes`)
 * @returns {Record<string, any>}
 */
export function buildLockSection(scan, previous, classesOf) {
  /** @type {Record<string, any>} */
  const section = {};

  for (const info of scan.views.values()) {
    const { record } = info;
    const entry = {
      contract: record.contract,
      props: Object.fromEntries(Object.entries(record.props).map(([k, v]) => [k, { required: v.required }])),
      slots: record.slots,
      hooks: record.hooks,
    };
    const classes = classesOf?.(info) ?? previous?.[info.id]?.classes;

    if (Array.isArray(classes)) entry.classes = classes;

    section[info.id] = entry;
  }

  return section;
}

/**
 * The `pano:views` module source.
 *
 * @param {Awaited<ReturnType<typeof scanViews>>} scan
 * @returns {string}
 */
export function generateViewsModule(scan) {
  const defs = [...scan.views.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((info) => {
      const body = Object.entries(info.def)
        .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
        .join(",\n");

      return `{\n${body},\n  "component": () => import(${JSON.stringify(info.file)})\n}`;
    });

  return `export default [\n${defs.join(",\n")}\n];\n`;
}

/**
 * @param {string} file
 * @param {string} content
 */
function writeIfChanged(file, content) {
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch {
    // not there yet
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const temp = `${file}.${process.pid}.tmp`;

  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

/**
 * Removes `.svelte` files under `dir` that are not in `keep`, then empty folders.
 *
 * @param {string} dir
 * @param {Set<string>} keep
 * @returns {boolean} true when `dir` is empty afterwards
 */
function prune(dir, keep) {
  if (!fs.existsSync(dir)) return true;

  let empty = true;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "_lib") empty = false;
      else if (!prune(full, keep)) empty = false;
      else fs.rmdirSync(full);
    } else if (entry.name.endsWith(".svelte") && !keep.has(full)) {
      fs.rmSync(full);
    } else {
      empty = false;
    }
  }

  return empty;
}

/**
 * @param {PanoViewsOptions} options
 * @returns {import('rollup').Plugin & { api: { scan: () => Awaited<ReturnType<typeof scanViews>> | null, options: PanoViewsOptions } }}
 */
export function panoViews(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = path.resolve(root, options.outDir ?? "src/main/resources/plugin-ui");
  const sdkViews = options.viewsSpecifier ?? SDK_VIEWS_SPECIFIER;

  /** @type {Awaited<ReturnType<typeof scanViews>> | null} */
  let scan = null;
  let watching = false;

  /**
   * @param {any} context
   * @param {any} error
   */
  const raise = (context, error) => {
    if (error instanceof ViewsError) {
      // the message already starts with file:line; rollup would repeat it from loc / id
      context.error({ message: error.message, pluginCode: "PANO_VIEWS" });
    }

    throw error;
  };

  return {
    name: "pano-views",

    api: {
      scan: () => scan,
      options,
    },

    async buildStart() {
      watching = options.watch ?? Boolean(this.meta?.watchMode);

      try {
        scan = await scanViews({ ...options, root });
      } catch (error) {
        scan = null;
        raise(this, error);
      }

      for (const dir of scan.missingDirs) {
        this.warn(`view folder ${dir} does not exist — no views are registered from it (check viewDirs in pano.plugin.js)`);
      }

      for (const warning of scan.warnings) this.warn(warning);

      for (const dir of options.dirs) {
        const absolute = path.resolve(root, dir);

        if (fs.existsSync(absolute)) this.addWatchFile(absolute);
      }

      for (const info of scan.views.values()) this.addWatchFile(info.file);

      if (options.lock !== false) {
        let previous;

        try {
          previous = readLock(root).views;
        } catch (error) {
          this.error(error.message);
        }

        const { breaking } = diffSection("views", previous, buildLockSection(scan, previous, options.classes));

        if (breaking.length > 0) {
          if (watching) {
            for (const message of breaking) this.warn(message);
          } else {
            this.error(breaking.join("\n"));
          }
        }
      }
    },

    async resolveId(source, importer, resolveOptions) {
      if (source === "pano:views") return VIRTUAL_VIEWS_ID;

      if (!scan || !importer || importer === VIRTUAL_VIEWS_ID || importer.startsWith(PROXY_PREFIX)) return null;
      if (!source.endsWith(".svelte")) return null;

      const resolved = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });

      if (!resolved || resolved.external) return null;

      const file = resolved.id.split("?")[0];

      return scan.byFile.has(file) ? PROXY_PREFIX + file : null;
    },

    load(id) {
      if (id === VIRTUAL_VIEWS_ID) return scan ? generateViewsModule(scan) : "export default [];\n";

      if (id.startsWith(PROXY_PREFIX) && scan) {
        const file = id.slice(PROXY_PREFIX.length);
        const info = scan.byFile.get(file);

        if (!info) return null;

        const target = JSON.stringify(file);

        return [
          `import { createViewProxy } from ${JSON.stringify(sdkViews)};`,
          `import Default from ${target};`,
          `export * from ${target};`,
          `export default createViewProxy(${JSON.stringify(info.id)}, Default);`,
          "",
        ].join("\n");
      }

      return null;
    },

    async writeBundle() {
      if (!scan) return;

      const contract = path.join(outDir, "contract");

      writeIfChanged(path.join(contract, "views.json"), JSON.stringify(buildViewsJson(scan), null, 2) + "\n");

      // The client build runs first and rewrites the readable copies (helper imports); the server build must
      // not write them again from the original source (FX-08).
      if (options.side !== "server") {
      const keep = new Set();

      for (const info of scan.views.values()) {
        const target = path.join(contract, info.contractPath);
        let content = info.source;

        if (options.transformSource) {
          const result = await options.transformSource(info.source, { ns: scan.namespace, view: info.name, file: info.file });

          if (typeof result !== "string") {
            throw new Error(`transformSource returned ${typeof result} for ${info.rel} — it must return the new source as a string`);
          }

          content = result;
        }

        keep.add(target);
        writeIfChanged(target, content);
      }

      prune(path.join(contract, "src"), keep);
      }

      if (options.lock !== false && !watching) {
        writeLockSection(root, "views", buildLockSection(scan, readLock(root).views, options.classes));
      }
    },
  };
}

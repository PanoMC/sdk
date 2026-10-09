import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import MagicString from "magic-string";
import { parse } from "svelte/compiler";
import { RUNTIME_FILES, widgetImportPath } from "@panomc/sdk/runtime-specifiers";
import { loadConfig } from "../config.js";
import { addRootClass, kebab, SemanticClassCollisionError } from "../styles/semantic-classes.js";
import { scanViews } from "./views.js";
import { controllerFiles, resolveProject } from "./rules.js";
import { getBuildContext } from "./meta.js";
import { writeIfChanged } from "./controllers.js";

/**
 * panoWidgets (doc 06 section 3.1-3.3): the third rollup target of `panoPlugin()`, web-component widgets.
 *
 * A view whose `export const view` carries `widget` is compiled once more, with the same Svelte options as
 * the client build, for a page that is not a Pano theme:
 *
 *  - one entry per widget view: `<View>-<hash>.js` exporting `{ component, load, attrs, session }` (the loader
 *    defines the element, so the tag is not baked in), shared code in `chunk-<hash>.js`;
 *  - every host specifier (`svelte`, `svelte/*`, `svelte-i18n`, `@panomc/sdk`, `@panomc/sdk/*`) stays external and is
 *    rewritten by `output.paths` to the relative runtime URL of `@panomc/widget-host` (`widgetImportPath`), so the
 *    page needs no import map; a specifier the widget runtime has no implementation for fails the build;
 *  - the `part` step (widget target only): every semantic class `<ns>-...` of an element is copied to its `part`
 *    attribute, so a page can style it with `pano-market-goal::part(market-goal__bar)`;
 *  - `widgets.json` (`format: 1`, the svelte version the widgets were built for) and `badges.widgets` of
 *    `pano-plugin.json`;
 *  - `session` is `none`, unless the view says otherwise or a controller of the view calls `host.session`.
 *
 * The target exists only when a view has `widget`: without one the build writes nothing (and removes a stale
 * `widgets/` folder), and the client and server bundles are never touched by this plugin.
 *
 * Put the plugin in the widgets build of `panoPlugin()`; it sets that build's `input` and `output` itself.
 * `hasWidgetViews()` tells `panoPlugin()` whether the build is needed.
 */

export const DEFAULT_OUT_DIR = "src/main/resources/plugin-ui";
export const WIDGET_ENTRY_PREFIX = "\0pano-widget:";
export const WIDGETS_JSON_FORMAT = 1;

const SESSIONS = ["none", "optional", "required"];
const PRIMITIVES = new Set(["string", "number", "boolean"]);
const TAG_SHAPE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SUFFIX = /(Widget|Block)$/;

/**
 * @typedef {object} PanoWidgetsOptions
 * @property {string} pluginId full plugin id
 * @property {string} namespace plugin namespace
 * @property {string} [root] plugin root, default the current directory
 * @property {string} [outDir] package folder, default `src/main/resources/plugin-ui`
 * @property {string[]} [viewDirs] view folders, default `viewDirs` of the plugin configuration
 * @property {string} [side] set by `panoPlugin()`
 */

/**
 * @typedef {object} WidgetAttr
 * @property {string} name the prop as written in the view
 * @property {string} attribute kebab-case attribute of the element
 * @property {'string' | 'number' | 'boolean'} type
 */

/**
 * @typedef {object} WidgetDef
 * @property {string} view view name (`GoalWidget`)
 * @property {string} id view id (`market:GoalWidget`)
 * @property {string} file absolute path
 * @property {string} rel path relative to the plugin root
 * @property {string} tag short tag (`goal`); the element is `pano-<ns>-<tag>`
 * @property {string} element the full element name
 * @property {WidgetAttr[]} attrs
 * @property {'none' | 'optional' | 'required' | null} session what the author wrote, null = inferred
 * @property {boolean} hasLoad the view has a module-level `load`
 */

/**
 * `GoalWidget` -> `goal`, `RecentBuyersWidget` -> `recent-buyers`, `TopBlock` -> `top`.
 * A name that is only the suffix keeps it.
 *
 * @param {string} view
 * @returns {string}
 */
export function defaultTagOf(view) {
  const stripped = view.replace(SUFFIX, "");

  return kebab(stripped || view);
}

/**
 * @param {string} message
 * @param {string} rel
 * @param {number} line
 * @returns {never}
 */
function fail(message, rel, line) {
  throw new Error(`${rel}:${line} ${message}`);
}

/**
 * @param {string} source
 * @param {RegExp} pattern
 * @returns {number} 1-based line of the first match, 1 when there is none
 */
function lineMatching(source, pattern) {
  const match = pattern.exec(source);

  return match ? source.slice(0, match.index).split("\n").length : 1;
}

// ---- reading the widget views ---------------------------------------------------------------

/**
 * Whether the type is one an HTML attribute can carry, ignoring `| undefined` and `| null`.
 *
 * @param {string} type
 * @returns {'string' | 'number' | 'boolean' | null}
 */
function primitiveOf(type) {
  const parts = String(type)
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "undefined" && part !== "null");

  return parts.length === 1 && PRIMITIVES.has(parts[0]) ? /** @type {any} */ (parts[0]) : null;
}

/**
 * Names a `return` / expression can hand back, when the build can tell. `open` = it cannot tell (a spread, a
 * call, a variable): then no prop is reported missing.
 *
 * @typedef {{ keys: Set<string>, open: boolean }} Shape
 */

/** @param {any} node @param {(node: any) => void} visit  statements of one function body, not entering nested functions */
function eachReturn(node, visit) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) eachReturn(child, visit);

    return;
  }

  if (node.type === "ReturnStatement") {
    visit(node);

    return;
  }

  if (/Function/.test(node.type) || node.type === "ClassDeclaration" || node.type === "ClassExpression") return;

  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (value && typeof value === "object") eachReturn(value, visit);
  }
}

/**
 * @param {any} node
 * @param {Map<string, any>} locals top-level functions / variables of the module script
 * @param {Shape} out
 */
function shapeOfExpression(node, locals, out) {
  if (!node) {
    out.open = true;

    return;
  }

  switch (node.type) {
    case "ObjectExpression":
      for (const property of node.properties) {
        if (property.type !== "Property" || property.computed) {
          out.open = true;
          continue;
        }

        out.keys.add(property.key.type === "Identifier" ? property.key.name : String(property.key.value));
      }

      return;

    case "AwaitExpression":
      shapeOfExpression(node.argument, locals, out);

      return;

    case "ConditionalExpression":
      shapeOfExpression(node.consequent, locals, out);
      shapeOfExpression(node.alternate, locals, out);

      return;

    case "Identifier": {
      const target = locals.get(node.name);

      // a local object literal: `const data = { a }; return data;`
      if (target?.type === "ObjectExpression") shapeOfExpression(target, locals, out);
      else out.open = true;

      return;
    }

    case "CallExpression": {
      const callee = node.callee;

      // `promise.then((data) => ({ data }))`: the shape is what the callback returns
      if (
        callee?.type === "MemberExpression" &&
        !callee.computed &&
        callee.property?.name === "then" &&
        node.arguments[0] &&
        /Function/.test(node.arguments[0].type)
      ) {
        shapeOfFunction(node.arguments[0], locals, out);

        return;
      }

      out.open = true;

      return;
    }

    default:
      out.open = true;
  }
}

/**
 * @param {any} fn
 * @param {Map<string, any>} locals
 * @param {Shape} out
 */
function shapeOfFunction(fn, locals, out) {
  if (fn.body?.type !== "BlockStatement") {
    shapeOfExpression(fn.body, locals, out);

    return;
  }

  let returns = 0;

  eachReturn(fn.body.body, (statement) => {
    returns += 1;
    shapeOfExpression(statement.argument, locals, out);
  });

  // a function that falls off its end returns undefined: nothing to learn, nothing to report
  if (returns === 0) out.open = true;
}

/**
 * Reads the module script of a view: is there a module-level `load`, and which keys does it return?
 *
 * @param {string} source
 * @returns {{ hasLoad: boolean, shape: Shape }}
 */
export function readLoad(source) {
  /** @type {Shape} */
  const shape = { keys: new Set(), open: false };
  let ast;

  try {
    ast = parse(source, { modern: true });
  } catch {
    return { hasLoad: false, shape: { keys: shape.keys, open: true } };
  }

  const body = ast.module?.content?.body ?? [];
  /** @type {Map<string, any>} */
  const locals = new Map();
  /** @type {any} */
  let loadNode = null;

  for (const statement of body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;

    if (declaration?.type === "FunctionDeclaration" && declaration.id) {
      locals.set(declaration.id.name, declaration);
      if (statement.type === "ExportNamedDeclaration" && declaration.id.name === "load") loadNode = declaration;
    } else if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id?.type !== "Identifier" || !declarator.init) continue;

        locals.set(declarator.id.name, declarator.init);
        if (statement.type === "ExportNamedDeclaration" && declarator.id.name === "load") loadNode = declarator.init;
      }
    }
  }

  // `export { load }` / `export { fetchGoal as load }`
  if (!loadNode) {
    for (const statement of body) {
      if (statement.type !== "ExportNamedDeclaration" || statement.source) continue;

      for (const specifier of statement.specifiers ?? []) {
        const exported = specifier.exported?.name ?? specifier.exported?.value;

        if (exported === "load") loadNode = locals.get(specifier.local.name) ?? { type: "Opaque" };
      }
    }
  }

  if (!loadNode) return { hasLoad: false, shape };

  if (/Function/.test(loadNode.type)) shapeOfFunction(loadNode, locals, shape);
  else shape.open = true;

  return { hasLoad: true, shape };
}

/**
 * The widget views of the plugin with everything the checks and `widgets.json` need.
 * Throws the build errors of doc 06 section 3.1 (invalid metadata, missing prop, tag collision).
 *
 * @param {{ scan: Awaited<ReturnType<typeof scanViews>>, namespace: string }} input
 * @returns {WidgetDef[]}
 */
export function collectWidgets({ scan, namespace }) {
  /** @type {WidgetDef[]} */
  const widgets = [];
  /** @type {Map<string, WidgetDef>} */
  const byElement = new Map();

  for (const info of [...scan.views.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const declared = info.record.widget;

    if (declared === null || declared === undefined || declared === false) continue;

    const line = lineMatching(info.source, /\bwidget\s*:/);
    const options = declared === true ? {} : declared;

    if (
      typeof options !== "object" ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== "tag" && key !== "session")
    ) {
      fail('view.widget must be true or { tag: "goal", session: "optional" } — nothing else is read', info.rel, line);
    }

    if (options.tag !== undefined && (typeof options.tag !== "string" || !TAG_SHAPE.test(options.tag))) {
      fail(
        `view.widget.tag must be lowercase words joined by "-", like "goal" — the element becomes <pano-${namespace}-goal>`,
        info.rel,
        line,
      );
    }

    if (options.session !== undefined && !SESSIONS.includes(options.session)) {
      fail(`view.widget.session must be one of ${SESSIONS.join(", ")}`, info.rel, line);
    }

    const tag = options.tag ?? defaultTagOf(info.name);
    const element = `pano-${namespace}-${tag}`;
    const existing = byElement.get(element);

    if (existing) {
      fail(
        `${existing.view} and ${info.name} both make the tag <${element}> — set view.widget to { tag: "..." } in one of them`,
        info.rel,
        line,
      );
    }

    const { hasLoad, shape } = readLoad(info.source);

    /** @type {WidgetAttr[]} */
    const attrs = [];

    for (const [name, prop] of Object.entries(info.record.props)) {
      const type = primitiveOf(prop.type);

      if (type) {
        attrs.push({ name, attribute: kebab(name), type });
        continue;
      }

      if (!prop.required || name === "children" || /Snippet/.test(String(prop.type))) continue;

      if (!hasLoad || (!shape.open && !shape.keys.has(name))) {
        fail(
          `${info.name} needs prop "${name}": return it from load() or remove widget from its view metadata`,
          info.rel,
          line,
        );
      }
    }

    /** @type {WidgetDef} */
    const def = {
      view: info.name,
      id: info.id,
      file: info.file,
      rel: info.rel,
      tag,
      element,
      attrs,
      session: options.session ?? null,
      hasLoad,
    };

    byElement.set(element, def);
    widgets.push(def);
  }

  return widgets;
}

/**
 * Whether the plugin has a view with `widget`: `panoPlugin()` builds the widgets target only then.
 *
 * @param {{ pluginId: string, namespace?: string, root?: string, viewDirs?: string[] }} options
 * @returns {Promise<boolean>}
 */
export async function hasWidgetViews(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const viewDirs = options.viewDirs ?? (await loadConfig(root)).viewDirs;
  const scan = await scanViews({ dirs: viewDirs, namespace: options.namespace, pluginId: options.pluginId, root });

  return [...scan.views.values()].some((info) => info.record.widget !== null && info.record.widget !== false);
}

// ---- the part step ---------------------------------------------------------------------------

/**
 * Class tokens an expression names literally.
 *
 * @param {any} node
 * @param {string[]} out
 */
function literalTokens(node, out) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) literalTokens(child, out);

    return;
  }

  if (node.type === "Literal" && typeof node.value === "string") {
    out.push(...node.value.split(/\s+/).filter(Boolean));

    return;
  }

  if (node.type === "TemplateElement") {
    out.push(...String(node.value?.cooked ?? node.value?.raw ?? "").split(/\s+/).filter(Boolean));

    return;
  }

  if (node.type === "Property" && !node.computed) {
    if (node.key?.type === "Identifier") out.push(node.key.name);
    else literalTokens(node.key, out);

    literalTokens(node.value, out);

    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "type") continue;
    literalTokens(value, out);
  }
}

/**
 * @param {any} root
 * @returns {any[]} every RegularElement of the template, in source order
 */
function allElements(root) {
  /** @type {any[]} */
  const found = [];
  const seen = new WeakSet();

  /** @param {any} node */
  const visit = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;

    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) visit(child);

      return;
    }

    if (node.type === "RegularElement") found.push(node);

    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "name_loc" || key === "metadata") continue;
      visit(value);
    }
  };

  visit(root.fragment);

  return found.sort((a, b) => a.start - b.start);
}

/**
 * Copies the semantic classes of every element to its `part` attribute (doc 06 section 3.4):
 * `class="market-goal__bar"` becomes `class="market-goal__bar" part="market-goal__bar"`. The root class
 * of the view is added first (the build does it anyway, a step later), so the root element is a part too.
 * An element that has a `part` attribute is left alone. Idempotent.
 *
 * @param {string} source view source
 * @param {{ ns: string, view: string }} ctx
 * @returns {{ code: string, parts: number }} `parts` = elements that got an attribute
 */
export function addPartAttributes(source, ctx) {
  let code = source;

  try {
    code = addRootClass(source, ctx).code;
  } catch (error) {
    if (error instanceof SemanticClassCollisionError) throw error;

    return { code: source, parts: 0 };
  }

  let ast;

  try {
    ast = parse(code, { modern: true });
  } catch {
    return { code: source, parts: 0 }; // the compiler reports the syntax error with better positions
  }

  const ms = new MagicString(code);
  let parts = 0;

  for (const element of allElements(ast)) {
    const attributes = element.attributes ?? [];

    if (attributes.some((attribute) => attribute.type === "Attribute" && attribute.name === "part")) continue;

    /** @type {string[]} */
    const tokens = [];

    for (const attribute of attributes) {
      if (attribute.type === "ClassDirective") tokens.push(attribute.name);

      if (attribute.type !== "Attribute" || attribute.name !== "class" || attribute.value === true) continue;

      for (const piece of Array.isArray(attribute.value) ? attribute.value : [attribute.value]) {
        if (piece.type === "Text") tokens.push(...piece.data.split(/\s+/).filter(Boolean));
        else if (piece.type === "ExpressionTag") literalTokens(piece.expression, tokens);
      }
    }

    const names = [...new Set(tokens.filter((token) => token.startsWith(`${ctx.ns}-`)))];

    if (names.length === 0) continue;

    ms.appendLeft(element.start + 1 + element.name.length, ` part="${names.join(" ")}"`);
    parts += 1;
  }

  return { code: parts > 0 ? ms.toString() : code, parts };
}

// ---- session inference -----------------------------------------------------------------------

/** @param {string} text */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * Controllers (short names) that call `host.session` / `host.onSession`, directly or through a sibling
 * they `use('...')`.
 *
 * @param {import('./rules.js').KitProject} project
 * @returns {Set<string>}
 */
export function sessionControllers(project) {
  /** @type {Map<string, { session: boolean, uses: string[] }>} */
  const found = new Map();

  for (const file of controllerFiles(project)) {
    const source = withoutComments(fs.readFileSync(file, "utf8"));
    const name = /defineController\s*\(\s*\{[\s\S]*?\bname\s*:\s*(["'`])([A-Za-z0-9]+)\1/.exec(source)?.[2] ?? path.basename(file, ".js");
    const session =
      /\bhost\s*\??\.\s*(?:session|onSession)\b/.test(source) ||
      /\{[^{}]*\b(?:session|onSession)\b[^{}]*\}\s*=\s*(?:[\w$]+\.)?host\b/.test(source) ||
      /\bhost\s*:\s*\{[^{}]*\b(?:session|onSession)\b[^{}]*\}/.test(source);
    const uses = [...source.matchAll(/\buse\s*\(\s*(["'`])([A-Za-z0-9]+)\1/g)].map((match) => match[2]);

    found.set(name, { session, uses });
  }

  const result = new Set([...found].filter(([, value]) => value.session).map(([name]) => name));

  for (let changed = true; changed; ) {
    changed = false;

    for (const [name, value] of found) {
      if (!result.has(name) && value.uses.some((use) => result.has(use))) {
        result.add(name);
        changed = true;
      }
    }
  }

  return result;
}

// ---- svelte pin -------------------------------------------------------------------------------

/**
 * @param {string} from
 * @param {string} name
 * @returns {string | null}
 */
function packageDir(from, name) {
  let dir = path.resolve(from);

  for (;;) {
    const candidate = path.join(dir, "node_modules", name);

    if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);

    const parent = path.dirname(dir);

    if (parent === dir) return null;

    dir = parent;
  }
}

/** @param {string} file */
function versionIn(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The svelte the widgets are compiled for (the installed one, as `checkSvelteVersion` reads it) and the
 * version the sdk pins.
 *
 * @param {string} root
 * @param {string | null} sdkDir
 * @returns {{ built: string | null, pinned: string | null }}
 */
export function svelteVersions(root, sdkDir) {
  const own = packageDir(root, "svelte");
  const fromSdk = sdkDir ? path.join(sdkDir, "node_modules/svelte") : null;
  let built = null;

  for (const dir of [own, fromSdk]) {
    if (dir && !built) built = versionIn(path.join(dir, "package.json"))?.version ?? null;
  }

  if (!built) {
    try {
      built = versionIn(createRequire(import.meta.url).resolve("svelte/package.json"))?.version ?? null;
    } catch {
      built = null;
    }
  }

  const sdk = sdkDir ?? packageDir(root, "@panomc/sdk");
  const pin = sdk ? versionIn(path.join(sdk, "package.json"))?.dependencies?.svelte : null;

  return { built, pinned: typeof pin === "string" ? pin : null };
}

// ---- controllers a widget uses ------------------------------------------------------------------

const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(["'])(\.{1,2}\/[^"'\n]+)\1/gm;
const RESOLVE_SUFFIXES = ["", ".js", ".mjs", ".svelte", "/index.js"];

/**
 * Own controllers (short names) a view names with a string literal: `.use('cart')`, `.require('cart')`,
 * `.load('cart')`, `useController('<ns>/cart')`, in the view and in the files it imports by relative path.
 * A source scan, not a parse: it only decides `session`, so a false hit costs `optional` instead of `none`.
 *
 * @param {string} file absolute path of the view
 * @param {string} namespace
 * @param {string} root plugin root; files outside it are not followed
 * @returns {Set<string>}
 */
export function controllersUsedBy(file, namespace, root) {
  /** @type {Set<string>} */
  const names = new Set();
  const seen = new Set();
  const queue = [file];

  while (queue.length) {
    const current = /** @type {string} */ (queue.pop());

    if (seen.has(current)) continue;

    seen.add(current);

    let source;

    try {
      source = withoutComments(fs.readFileSync(current, "utf8"));
    } catch {
      continue;
    }

    for (const match of source.matchAll(/\.\s*(?:use|require|load)\s*\(\s*(["'`])([A-Za-z0-9]+)\1/g)) names.add(match[2]);

    for (const match of source.matchAll(/\buseController\s*\(\s*(["'`])([A-Za-z0-9_-]+)\/([A-Za-z0-9]+)\1/g)) {
      if (match[2] === namespace) names.add(match[3]);
    }

    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const base = path.resolve(path.dirname(current), match[2]);

      for (const suffix of RESOLVE_SUFFIXES) {
        const candidate = base + suffix;

        if (candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          queue.push(candidate);
          break;
        }
      }
    }
  }

  return names;
}

// ---- the rollup plugin ------------------------------------------------------------------------

/**
 * @param {string} specifier
 * @returns {boolean}
 */
function isHostSpecifier(specifier) {
  return (
    specifier === "svelte" ||
    specifier.startsWith("svelte/") ||
    specifier === "svelte-i18n" ||
    specifier === "@panomc/sdk" ||
    specifier.startsWith("@panomc/sdk/")
  );
}

/**
 * Sets `badges.widgets` in the package index on disk and in the shared build context (the index is written
 * by the client build, which may run before or after this one).
 *
 * @param {string} root
 * @param {string} outDir
 * @param {boolean} value
 */
function setBadge(root, outDir, value) {
  getBuildContext(root).badges.widgets = value;

  const file = path.join(outDir, "pano-plugin.json");

  if (!fs.existsSync(file)) return;

  try {
    const index = JSON.parse(fs.readFileSync(file, "utf8"));

    if (!index.badges || index.badges.widgets === value) return;

    index.badges.widgets = value;
    writeIfChanged(file, JSON.stringify(index, null, 2) + "\n");
  } catch {
    // an unreadable index is the meta plugin's to report
  }
}

/**
 * The widgets target of `panoPlugin()`.
 *
 * @param {PanoWidgetsOptions} options
 * @returns {import('rollup').Plugin}
 */
export function panoWidgets(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const outDir = path.resolve(root, options.outDir ?? DEFAULT_OUT_DIR);
  const widgetsDir = path.join(outDir, "widgets");

  /** @type {(WidgetDef & { resolvedSession: 'none' | 'optional' | 'required' })[]} */
  let widgets = [];
  /** @type {string[]} */
  let viewDirs = [];
  let namespace = options.namespace;
  /** @type {string | null} */
  let sdkDir = null;
  let scanned = false;
  /** @type {{ source: string, importer: string | undefined }[]} */
  let unsupported = [];

  /** @param {string} id */
  const isViewFile = (id) => {
    if (!id.endsWith(".svelte")) return false;

    const file = path.resolve(id.replace(/\?.*$/, ""));

    return viewDirs.some((dir) => file.startsWith(dir + path.sep));
  };

  /**
   * Widget views whose graph contains `importer`, the module that holds the import being resolved.
   *
   * @param {import('rollup').PluginContext} context
   * @param {string | undefined} importer
   * @returns {string[]}
   */
  const widgetsReaching = (context, importer) => {
    const reached = new Set();
    const seen = new Set();
    const queue = importer ? [importer] : [];

    while (queue.length) {
      const id = /** @type {string} */ (queue.pop());

      if (seen.has(id)) continue;

      seen.add(id);

      if (id.startsWith(WIDGET_ENTRY_PREFIX)) {
        reached.add(id.slice(WIDGET_ENTRY_PREFIX.length));
        continue;
      }

      queue.push(...(context.getModuleInfo(id)?.importers ?? []));
    }

    return [...(reached.size ? reached : widgets.map((widget) => widget.view))].sort();
  };

  return {
    name: "pano-widgets",

    async options(inputOptions) {
      const config = await loadConfig(root);

      namespace = options.namespace ?? config.namespace;
      sdkDir = config.sdkDir ?? packageDir(root, "@panomc/sdk");
      viewDirs = (options.viewDirs ?? config.viewDirs).map((dir) => path.resolve(root, dir));

      const scan = await scanViews({
        dirs: viewDirs,
        namespace,
        pluginId: options.pluginId ?? config.pluginId,
        root,
      });
      const found = collectWidgets({ scan, namespace });

      scanned = true;

      if (found.length === 0) {
        widgets = [];

        return null; // nothing to build: the empty input of the config stays and nothing is written
      }

      const project = await resolveProject({ root, viewDirs: options.viewDirs ?? config.viewDirs, namespace });
      const withSession = sessionControllers(project);

      widgets = found.map((widget) => ({
        ...widget,
        resolvedSession:
          widget.session ??
          ([...controllersUsedBy(widget.file, namespace, root)].some((name) => withSession.has(name)) ? "optional" : "none"),
      }));

      return {
        ...inputOptions,
        input: Object.fromEntries(widgets.map((widget) => [widget.view, WIDGET_ENTRY_PREFIX + widget.view])),
        preserveEntrySignatures: "strict",
      };
    },

    buildStart() {
      unsupported = [];

      if (widgets.length === 0) {
        fs.rmSync(widgetsDir, { recursive: true, force: true });

        return;
      }

      const { built, pinned } = svelteVersions(root, sdkDir);

      if (built && pinned && /^\d/.test(pinned) && built !== pinned) {
        this.warn(`widgets built for svelte ${built}, this SDK pins ${pinned}`);
      }
    },

    outputOptions(output) {
      if (widgets.length === 0) return null;

      return {
        ...output,
        format: "es",
        dir: widgetsDir,
        entryFileNames: "[name]-[hash].js",
        chunkFileNames: "chunk-[hash].js",
        // doc 06 section 3.3: relative runtime URLs, so a proxy prefix does not matter
        paths: (/** @type {string} */ id) => (RUNTIME_FILES[id] ? widgetImportPath(id) : id),
      };
    },

    resolveId(source, importer) {
      if (source.startsWith(WIDGET_ENTRY_PREFIX)) {
        return widgets.some((widget) => WIDGET_ENTRY_PREFIX + widget.view === source) ? source : null;
      }

      if (widgets.length === 0 || !isHostSpecifier(source)) return null;

      // every host specifier is the runtime's module: external here, a relative URL in the output (outputOptions)
      if (RUNTIME_FILES[source]) return { id: source, external: true };

      // The module graph is not linked yet, so the widget views that reach this file are named in buildEnd.
      unsupported.push({ source, importer });

      return { id: source, external: true };
    },

    buildEnd(error) {
      if (error || unsupported.length === 0) return;

      const messages = unsupported.map(({ source, importer }) => {
        const file = importer ? path.relative(root, importer.replace(/\?.*$/, "")).replace(/\\/g, "/") : "(entry)";

        return `${file} imports ${source}, which has no widget implementation. Remove ${widgetsReaching(this, importer).join(", ")} from widgets or avoid the import.`;
      });

      this.error(messages.length === 1 ? messages[0] : `${messages.length} imports have no widget implementation:\n  ${messages.join("\n  ")}`);
    },

    load(id) {
      if (!id.startsWith(WIDGET_ENTRY_PREFIX)) return null;

      const widget = widgets.find((candidate) => WIDGET_ENTRY_PREFIX + candidate.view === id);

      if (!widget) return null;

      const file = JSON.stringify(widget.file);

      return [
        `import Component from ${file};`,
        "export { Component as component };",
        widget.hasLoad ? `export { load } from ${file};` : "export const load = undefined;",
        `export const attrs = ${JSON.stringify(widget.attrs.map(({ name, type }) => ({ name, type })))};`,
        `export const session = ${JSON.stringify(widget.resolvedSession)};`,
        "",
      ].join("\n");
    },

    // the `part` step, before the svelte plugin compiles the file
    transform(code, id) {
      if (widgets.length === 0 || !isViewFile(id)) return null;

      const result = addPartAttributes(code, {
        ns: /** @type {string} */ (namespace),
        view: path.basename(id.replace(/\?.*$/, ""), ".svelte"),
      });

      return result.code === code ? null : { code: result.code, map: null };
    },

    generateBundle(_output, bundle) {
      if (widgets.length === 0) {
        for (const key of Object.keys(bundle)) delete bundle[key];

        return;
      }

      const modules = new Map(
        Object.values(bundle)
          .filter((chunk) => chunk.type === "chunk" && chunk.isEntry && chunk.facadeModuleId)
          .map((chunk) => [/** @type {string} */ (/** @type {any} */ (chunk).facadeModuleId), /** @type {any} */ (chunk).fileName]),
      );
      const { built } = svelteVersions(root, sdkDir);

      const index = {
        format: WIDGETS_JSON_FORMAT,
        svelte: built,
        widgets: widgets.map((widget) => ({
          view: widget.view,
          tag: widget.tag,
          module: modules.get(WIDGET_ENTRY_PREFIX + widget.view),
          attrs: widget.attrs,
          session: widget.resolvedSession,
        })),
      };

      this.emitFile({ type: "asset", fileName: "widgets.json", source: JSON.stringify(index, null, 2) + "\n" });
    },

    closeBundle() {
      if (scanned) setBadge(root, outDir, widgets.length > 0);
    },
  };
}

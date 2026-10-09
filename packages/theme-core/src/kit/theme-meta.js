// Theme meta scan (doc 01 sections 4 and 5). Pure: node:fs and node:path only, no vite, no svelte
// compiler. It reads the theme's overrides (`theme.config.js` `views`), its added route pages
// (`routes.add`) and its home pages (`home.options.*.page`), plus every theme-local file they import
// (relative paths and `$lib`, recursively), and looks for the three ways a theme places a plugin view:
//
//   <PluginBlock id="market:ProductGrid" limit={8} />      a block placement (props = literal attributes)
//   pluginView("market:PriceTag")                          a proxy to a registered view
//   <PluginSlot id="market:checkout:payment" ... />        a slot opened by the theme itself
//
// The result is what `virtual:pano-theme-meta` serves:
//
//   { refs: { [overrideName | "route:<path>" | "home:<id>"]: [{ id, props }] },
//     claims: string[],            // found ids that are not the override's own name, merged with config.claims
//     homePages: { [id]: path },   // theme.config.js `home.options.<id>.page`, as written
//     files: string[] }            // every file that was read (absolute), for watchers
//
// A placement whose `id` is not a literal (`id={name}`) is skipped: the block loads in the browser
// after mount (doc 01 section 5). Props that are not literal (`{...rest}`, `onclick={fn}`, `a={b}`)
// are left out, the same rule `blockKey` applies at run time.

import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {{ id: string, props: Record<string, string | number | boolean> }} Ref
 * @typedef {{
 *   refs: Record<string, Ref[]>,
 *   claims: string[],
 *   homePages: Record<string, string>,
 *   files: string[],
 * }} ThemeMeta
 */

const SOURCE_EXTENSIONS = [".svelte", ".js", ".mjs", ".ts"];

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

/** Keeps the length-insensitive text only: HTML comments are removed. */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

/** Removes JS comments from script text (a `//` after `:` is a URL and stays). */
function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\w\\])\/\/.*$/gm, "$1");
}

/**
 * @param {string} text
 * @returns {{ markup: string, script: string }}  `script` = the content of every <script>; `markup` = the rest
 */
function splitSvelte(text) {
  const withoutComments = stripHtmlComments(text);
  const scripts = [];
  const markup = withoutComments.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, body) => {
    scripts.push(body);
    return "";
  });
  return { markup, script: stripJsComments(scripts.join("\n")) };
}

/**
 * Index of the `}` that closes the `{` at `start`, skipping strings and template literals.
 * @param {string} text
 * @param {number} start  index of the opening "{"
 * @returns {number} -1 when unbalanced
 */
function closingBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The value of a `{expr}` attribute when it is a literal, else `undefined`.
 * @param {string} expr
 * @returns {string | number | boolean | undefined}
 */
function literalOfExpression(expr) {
  const value = expr.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  const quoted = /^(["'`])([\s\S]*)\1$/.exec(value);
  if (quoted && !quoted[2].includes("\\") && !quoted[2].includes(quoted[1])) {
    if (quoted[1] === "`" && quoted[2].includes("${")) return undefined;
    return quoted[2];
  }
  return undefined;
}

/**
 * Attributes of the tag whose name ends at `from`.
 * @param {string} text
 * @param {number} from
 * @returns {Map<string, string | number | boolean | undefined>}  name -> literal value (undefined = not literal)
 */
function parseAttributes(text, from) {
  /** @type {Map<string, string | number | boolean | undefined>} */
  const attrs = new Map();
  let i = from;

  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    const c = text[i];
    if (c === undefined || c === ">") break;
    if (c === "/") {
      i++;
      continue;
    }

    if (c === "{") {
      // `{...spread}` or `{shorthand}`: the value is not a literal
      const end = closingBrace(text, i);
      if (end < 0) break;
      const inner = text.slice(i + 1, end).trim();
      if (!inner.startsWith("...") && /^[A-Za-z_$][\w$]*$/.test(inner)) attrs.set(inner, undefined);
      i = end + 1;
      continue;
    }

    let j = i;
    while (j < text.length && !/[\s=/>]/.test(text[j])) j++;
    const name = text.slice(i, j);
    i = j;
    if (!name) {
      i++;
      continue;
    }

    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "=") {
      attrs.set(name, true); // bare attribute
      continue;
    }
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;

    const q = text[i];
    if (q === '"' || q === "'") {
      const end = text.indexOf(q, i + 1);
      if (end < 0) break;
      const body = text.slice(i + 1, end);
      attrs.set(name, body.includes("{") ? undefined : body);
      i = end + 1;
    } else if (q === "{") {
      const end = closingBrace(text, i);
      if (end < 0) break;
      attrs.set(name, literalOfExpression(text.slice(i + 1, end)));
      i = end + 1;
    } else {
      let k = i;
      while (k < text.length && !/[\s>]/.test(text[k])) k++;
      const raw = text.slice(i, k).replace(/\/$/, "");
      attrs.set(name, raw);
      i = k;
    }
  }

  return attrs;
}

/**
 * @param {string} markup
 * @param {"PluginBlock" | "PluginSlot"} tag
 * @returns {Map<string, string | number | boolean | undefined>[]}
 */
function findTags(markup, tag) {
  const out = [];
  const open = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  let match;
  while ((match = open.exec(markup))) out.push(parseAttributes(markup, match.index + match[0].length));
  return out;
}

/**
 * Refs found in one file's text.
 * @param {string} source
 * @param {boolean} isSvelte
 * @returns {{ refs: Ref[], imports: string[] }}
 */
export function scanSource(source, isSvelte) {
  const { markup, script } = isSvelte ? splitSvelte(source) : { markup: "", script: stripJsComments(source) };
  /** @type {Ref[]} */
  const refs = [];

  for (const [tag, withProps] of /** @type {const} */ ([["PluginBlock", true], ["PluginSlot", false]])) {
    for (const attrs of findTags(markup, tag)) {
      const id = attrs.get("id");
      if (typeof id !== "string" || !id) continue;
      /** @type {Record<string, string | number | boolean>} */
      const props = {};
      if (withProps) {
        for (const [name, value] of attrs) if (name !== "id" && value !== undefined) props[name] = value;
      }
      refs.push({ id, props });
    }
  }

  // pluginView("x") is JS: in <script> blocks and in {expressions} of the markup
  const jsText = isSvelte ? `${script}\n${markup}` : script;
  for (const m of jsText.matchAll(/\bpluginView\(\s*(["'`])([^"'`$\\\n]+)\1\s*[,)]/g)) {
    refs.push({ id: m[2], props: {} });
  }

  const imports = [];
  for (const m of script.matchAll(/\b(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?(["'])([^"'\n]+)\1/g)) imports.push(m[2]);
  for (const m of script.matchAll(/\bimport\(\s*(["'])([^"'\n]+)\1\s*\)/g)) imports.push(m[2]);

  return { refs, imports };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Theme-local file for an import specifier, or null (package, outside the theme, missing).
 * @param {string} themeDir
 * @param {string} fromFile
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveImport(themeDir, fromFile, specifier) {
  const spec = specifier.split(/[?#]/)[0];
  let base;
  if (spec.startsWith("./") || spec.startsWith("../")) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec === "$lib" || spec.startsWith("$lib/")) base = path.join(themeDir, "src", "lib", spec.slice(5));
  else return null;

  const candidates = SOURCE_EXTENSIONS.includes(path.extname(base))
    ? [base]
    : [...SOURCE_EXTENSIONS.map((ext) => base + ext), ...SOURCE_EXTENSIONS.map((ext) => path.join(base, "index" + ext))];

  for (const file of candidates) {
    if (!SOURCE_EXTENSIONS.includes(path.extname(file)) || !isFile(file)) continue;
    const rel = path.relative(themeDir, file);
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep).includes("node_modules")) return null;
    return file;
  }
  return null;
}

const refKey = (ref) =>
  ref.id + "#" + JSON.stringify(Object.fromEntries(Object.entries(ref.props ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))));

/**
 * Refs of a root file and of the theme-local files it imports (recursively).
 * @param {string} themeDir
 * @param {string} rootFile  absolute
 * @param {Set<string>} seenFiles  every file read, accumulated
 * @returns {Ref[]}
 */
function scanClosure(themeDir, rootFile, seenFiles) {
  /** @type {Ref[]} */
  const refs = [];
  const keys = new Set();
  const visited = new Set();
  const queue = [rootFile];

  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    if (visited.has(file)) continue;
    visited.add(file);

    let text;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue; // a missing file is `theme-core check`'s business
    }
    seenFiles.add(file);

    const found = scanSource(text, file.endsWith(".svelte"));
    for (const ref of found.refs) {
      const key = refKey(ref);
      if (keys.has(key)) continue;
      keys.add(key);
      refs.push(ref);
    }
    for (const spec of found.imports) {
      const next = resolveImport(themeDir, file, spec);
      if (next && !visited.has(next)) queue.push(next);
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// theme.config.js
// ---------------------------------------------------------------------------

/**
 * The file a view entry points at: `() => import("./x.svelte")`, `{ component: () => import(...) }`
 * or a plain path string. A function is read through its source text, so it is never called (a
 * `.svelte` import cannot run in plain node).
 * @param {any} entry
 * @returns {string | null}  as written (theme-relative)
 */
export function entryFile(entry) {
  if (typeof entry === "string") return entry;
  if (typeof entry === "function") {
    const source = Function.prototype.toString.call(entry);
    const m = /(["'`])([^"'`\n$]+\.svelte)\1/.exec(source) ?? /\bimport\(\s*(["'`])([^"'`\n$]+)\1\s*\)/.exec(source);
    return m ? m[2] : null;
  }
  if (entry && typeof entry === "object") return entryFile(entry.component ?? entry.page);
  return null;
}

/** @param {string} themeDir @param {string} file */
function absolute(themeDir, file) {
  return path.resolve(themeDir, file.replace(/^\//, ""));
}

/**
 * Scans a theme.
 * @param {{ themeDir: string, config?: any }} options
 *   `config` = the default export of theme.config.js (the caller imports it)
 * @returns {ThemeMeta}
 */
export function scanThemeMeta({ themeDir, config }) {
  const cfg = config ?? {};
  /** @type {Record<string, Ref[]>} */
  const refs = {};
  /** @type {Record<string, string>} */
  const homePages = {};
  const seenFiles = new Set();
  const claims = new Set();

  /** @param {string} key @param {any} entry */
  const scanEntry = (key, entry) => {
    const file = entryFile(entry);
    if (!file) return;
    const found = scanClosure(themeDir, absolute(themeDir, file), seenFiles);
    refs[key] = found;
    for (const ref of found) if (ref.id !== key) claims.add(ref.id);
  };

  for (const [name, entry] of Object.entries(cfg.views ?? {})) scanEntry(name, entry);

  for (const [routePath, page] of Object.entries(cfg.routes?.add ?? {})) scanEntry(`route:${routePath}`, page);

  for (const [id, option] of Object.entries(cfg.home?.options ?? {})) {
    const page = /** @type {any} */ (option)?.page;
    if (!page) continue;
    const file = entryFile(page);
    if (!file) continue;
    homePages[id] = file;
    scanEntry(`home:${id}`, file);
  }

  // an explicit entry in theme.config.js `claims` wins over the scan
  for (const [id, value] of Object.entries(cfg.claims ?? {})) {
    if (value === false) claims.delete(id);
    else if (value) claims.add(id);
  }

  return { refs, claims: [...claims].sort(), homePages, files: [...seenFiles].sort() };
}

// ---------------------------------------------------------------------------
// The virtual module
// ---------------------------------------------------------------------------

/**
 * Source of `virtual:pano-theme-meta`: `refs` and `claims` as data, `homePages` as dynamic imports.
 * @param {ThemeMeta} meta
 * @param {string} themeDir
 * @returns {string}
 */
export function renderThemeMetaModule(meta, themeDir) {
  const pages = Object.entries(meta.homePages ?? {})
    .map(([id, file]) => `  ${JSON.stringify(id)}: () => import(${JSON.stringify(absolute(themeDir, file))})`)
    .join(",\n");

  return [
    `export const refs = ${JSON.stringify(meta.refs ?? {})};`,
    `export const claims = ${JSON.stringify(meta.claims ?? [])};`,
    `export const homePages = {${pages ? "\n" + pages + "\n" : ""}};`,
    `export default { refs, claims, homePages };`,
    "",
  ].join("\n");
}

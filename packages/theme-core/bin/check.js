#!/usr/bin/env bun
/**
 * theme-core check — the machine-enforced theme contract (doc 01 section 10).
 *
 *   bun check.js [--strict] [--fix]
 *
 *   --strict   warnings count as errors (`theme-core package` always runs strict, so every
 *              published theme, official or not, passes the same check)
 *   --fix      writes what can be written for you: missing or outdated controller pins in
 *              theme.config.js (C12)
 *
 * Rules that existed before the open front-end:
 *   svelte pin            svelte is pinned to EXACTLY core's version
 *   settings              settingsSchema is shape-valid, appends only, defaultTab exists
 *   manifest              manifest.json carries the required keys
 *   lang                  lang-overrides/*.json are valid JSON
 *   MainLayoutView        an overridden MainLayoutView must not emit <meta name="description">
 *   i18n keys             keys used by overridden views exist in the merged lang tree (warning)
 *
 * Rules C1-C16 (the table of doc 01 section 10):
 *   C1  override file exists                                    error
 *   C2  override name is known (engine contract / snapshot)     error; no snapshot: warning
 *   C3  `contract` equals the snapshot / engine contract        warning
 *   C4  override keeps hooks, slots and slotProps of the default error
 *   C5  hook mounted in more than one effective view            error
 *   C6  props read by the override are in the contract          warning
 *   C7  <PluginBlock> / pluginView ids exist; literal props     error; warning
 *   C8  claims                                                  info
 *   C9  routes                                                  error
 *   C10 home                                                    error
 *   C11 override exports load / uses context towards a plugin   warning
 *   C12 controller pins (--fix writes them)                     warning
 *   C13 styles <-> provides.bootstrap, pano-tokens              error; warning
 *   C14 override lacks the view's root class                    warning
 *   C15 lang-overrides/plugins/<ns>/*.json                      error
 *   C16 API path literals are Pano routes (pano-api check-paths) error
 *
 * Exit code 1 on any error. `runChecks()` is exported for tests and for `theme-core package`.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pc } from "./ui.js";

/** theme.config.js files this process has imported already. */
const importedConfigs = new Set();

const defaultPkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {"error" | "warning" | "info"} Level
 * @typedef {{ level: Level, rule: string | null, message: string }} Finding
 * @typedef {{
 *   findings: Finding[],
 *   problems: Finding[],
 *   warnings: Finding[],
 *   infos: Finding[],
 *   fixed: string[],
 *   overrides: number,
 *   strict: boolean,
 * }} Report
 */

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

/** Blanks JS comments with spaces (same length, so indexes still point into the raw source). */
function blankJsComments(text) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'`\w\\])(\/\/.*)$/gm, (m, a, b) => a + blank(b));
}

const stripHtmlComments = (text) => text.replace(/<!--[\s\S]*?-->/g, "");

/**
 * Index of the closing bracket for the opener at `start`, skipping strings and template literals.
 * @returns {number} -1 when unbalanced
 */
function closing(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : ")";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `ProductCard` -> `product-card` (the same rule as plugin-kit's root class). */
function kebab(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {string} dir @param {(name: string) => boolean} keep @param {string[]} [skipDirs] */
function walkFiles(dir, keep, skipDirs = ["node_modules", ".git", ".svelte-kit", "build"]) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) out.push(...walkFiles(p, keep, skipDirs));
    } else if (keep(entry.name)) {
      out.push(p);
    }
  }
  return out.sort();
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// ---------------------------------------------------------------------------
// theme.config.js: overrides (one regex for both forms), pins
// ---------------------------------------------------------------------------

/**
 * One regex over the `views: { … }` block of theme.config.js: both entry forms, bare or quoted key
 * (`Navbar`, `"market:ProductCard"`, `'pano-plugin-market:ProductCard'`).
 *   Navbar: () => import("./src/views/Navbar.svelte")
 *   "market:ProductCard": { contract: 2, controllers: ["market/cart"], component: () => import("./x.svelte") }
 */
const VIEW_ENTRY =
  /(?:(["'])([A-Za-z0-9_$:.-]+)\1|([A-Za-z_$][\w$]*))\s*:\s*(?:\(\s*\)\s*=>\s*import\(\s*(["'`])([^"'`\n]+)\4\s*\)|\{([^{}]*)\})/g;

/**
 * @typedef {{
 *   key: string, path: string | null, contract: number, controllers: string[], objectForm: boolean,
 * }} Override
 */

/** @param {string} source  raw theme.config.js @returns {Override[]} */
export function readOverrides(source) {
  const blank = blankJsComments(source);
  const start = /(?<![\w$.])views\s*:\s*\{/.exec(blank);
  if (!start) return [];
  const open = start.index + start[0].length - 1;
  const end = closing(blank, open);
  const block = blank.slice(open + 1, end < 0 ? undefined : end);

  /** @type {Override[]} */
  const out = [];
  for (const m of block.matchAll(VIEW_ENTRY)) {
    const key = m[2] ?? m[3];
    if (m[5] !== undefined) {
      out.push({ key, path: m[5], contract: 1, controllers: [], objectForm: false });
      continue;
    }
    const body = m[6];
    const file = /\bimport\(\s*(["'`])([^"'`\n]+)\1\s*\)/.exec(body) ?? /\bcomponent\s*:\s*(["'`])([^"'`\n]+)\1/.exec(body);
    if (!file) continue; // an object without a component (a `label` object, …) is not a view entry
    const contract = /\bcontract\s*:\s*(\d+)/.exec(body);
    const controllers = /\bcontrollers\s*:\s*\[([^\]]*)\]/.exec(body);
    out.push({
      key,
      path: file[2],
      contract: contract ? Number(contract[1]) : 1,
      controllers: controllers ? [...controllers[1].matchAll(/(["'])([^"'\n]+)\1/g)].map((c) => c[2]) : [],
      objectForm: true,
    });
  }
  return out;
}

/**
 * Writes `controllers: { "ns/name": version }` pins into theme.config.js source.
 * @param {string} source
 * @param {Map<string, number>} pins
 * @returns {string | null}  null when the object could not be located
 */
export function writePins(source, pins) {
  const blank = blankJsComments(source);
  const block = /(?<![\w$.])controllers\s*:\s*\{/.exec(blank);

  if (block) {
    const open = block.index + block[0].length - 1;
    const end = closing(blank, open);
    if (end < 0) return null;
    let inner = source.slice(open + 1, end);
    const lineStart = source.lastIndexOf("\n", block.index) + 1;
    const indent = /^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? "";
    const added = [];
    for (const [name, version] of pins) {
      const existing = new RegExp(`(["']?)${escapeRe(name)}\\1(\\s*:\\s*)\\d+`);
      if (existing.test(inner)) inner = inner.replace(existing, (_, q, colon) => `${q}${name}${q}${colon}${version}`);
      else added.push(`${indent}  ${JSON.stringify(name)}: ${version},`);
    }
    if (added.length) {
      const trimmed = inner.replace(/\s+$/, "");
      const needsComma = trimmed.trim() !== "" && !trimmed.endsWith(",");
      inner = `${trimmed}${needsComma ? "," : ""}\n${added.join("\n")}\n${indent}`;
    }
    return source.slice(0, open + 1) + inner + source.slice(end);
  }

  const head = /export\s+default\s+(?:[A-Za-z_$][\w$.]*\s*\(\s*)?\{/.exec(blank);
  if (!head) return null;
  const at = head.index + head[0].length;
  const lines = [...pins].map(([name, version]) => `    ${JSON.stringify(name)}: ${version},`);
  return `${source.slice(0, at)}\n  controllers: {\n${lines.join("\n")}\n  },${source.slice(at)}`;
}

// ---------------------------------------------------------------------------
// Svelte source readers
// ---------------------------------------------------------------------------

/** Names destructured from `$props()` plus legacy `export let`. */
export function readProps(source) {
  const text = stripHtmlComments(blankJsComments(source));
  const names = new Set();
  for (const m of text.matchAll(/(?:let|const)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const end = closing(text, open);
    if (end < 0) continue;
    if (!/^\s*(?::[^=]*)?=\s*\$props\(\s*\)/.test(text.slice(end + 1, end + 200))) continue;
    const inner = text.slice(open + 1, end);
    // split on top-level commas
    let depth = 0;
    let part = "";
    const parts = [];
    for (const c of inner) {
      if ("{[(".includes(c)) depth++;
      else if ("}])".includes(c)) depth--;
      if (c === "," && depth === 0) {
        parts.push(part);
        part = "";
      } else part += c;
    }
    parts.push(part);
    for (const p of parts) {
      const name = /^\s*([A-Za-z_$][\w$]*)/.exec(p.trim().startsWith("...") ? "" : p)?.[1];
      if (name) names.add(name);
    }
  }
  for (const m of text.matchAll(/\bexport\s+let\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return [...names];
}

/** Hook names, slot ids (and `<ViewComponent id>`) mounted by a view's markup. */
export function readMounts(source) {
  const text = stripHtmlComments(source);
  const hooks = new Set();
  const slots = new Set();
  for (const m of text.matchAll(/<Hook\b[^>]*?\bname\s*=\s*(?:\{\s*)?(["'])([^"']+)\1/g)) hooks.add(m[2]);
  for (const m of text.matchAll(/<(?:ViewComponent|PluginSlot)\b[^>]*?\bid\s*=\s*(?:\{\s*)?(["'])([^"']+)\1/g)) slots.add(m[2]);
  return { hooks, slots };
}

/** @param {string} expr @returns {boolean} true when a `{expression}` attribute is a literal (blockKey rule) */
function isLiteralExpression(expr) {
  const v = expr.trim();
  if (v === "true" || v === "false") return true;
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(v)) return true;
  const q = /^(["'`])([\s\S]*)\1$/.exec(v);
  return !!q && !q[2].includes("\\") && !q[2].includes(q[1]) && !(q[1] === "`" && q[2].includes("${"));
}

/**
 * Every <PluginBlock> and pluginView() placement in a file.
 * @param {string} source @param {boolean} isSvelte
 * @returns {{ id: string | null, line: number, nonLiteralProps: string[], kind: "block" | "proxy" }[]}
 */
export function readPlacements(source, isSvelte) {
  const raw = isSvelte ? stripHtmlComments(source) : source;
  const out = [];
  for (const m of raw.matchAll(/<PluginBlock(?=[\s/>])/g)) {
    let i = m.index + m[0].length;
    let id = null;
    let idLiteral = false;
    const bad = [];
    while (i < raw.length) {
      while (i < raw.length && /\s/.test(raw[i])) i++;
      const c = raw[i];
      if (c === undefined || c === ">") break;
      if (c === "/") {
        i++;
        continue;
      }
      if (c === "{") {
        const end = closing(raw, i);
        if (end < 0) break;
        const inner = raw.slice(i + 1, end).trim();
        bad.push(inner.startsWith("...") ? "{...spread}" : inner);
        i = end + 1;
        continue;
      }
      let j = i;
      while (j < raw.length && !/[\s=/>]/.test(raw[j])) j++;
      const name = raw.slice(i, j);
      i = j;
      while (i < raw.length && /\s/.test(raw[i])) i++;
      if (raw[i] !== "=") continue; // bare attribute: literal true
      i++;
      while (i < raw.length && /\s/.test(raw[i])) i++;
      let literal = true;
      let value = "";
      if (raw[i] === '"' || raw[i] === "'") {
        const end = raw.indexOf(raw[i], i + 1);
        if (end < 0) break;
        value = raw.slice(i + 1, end);
        literal = !value.includes("{");
        i = end + 1;
      } else if (raw[i] === "{") {
        const end = closing(raw, i);
        if (end < 0) break;
        const expr = raw.slice(i + 1, end);
        literal = isLiteralExpression(expr);
        value = literal ? expr.trim().replace(/^(["'`])([\s\S]*)\1$/, "$2") : "";
        i = end + 1;
      } else {
        let k = i;
        while (k < raw.length && !/[\s>]/.test(raw[k])) k++;
        value = raw.slice(i, k);
        i = k;
      }
      if (name === "id") {
        idLiteral = literal && value !== "";
        id = idLiteral ? value : null;
      } else if (!literal) bad.push(name);
    }
    out.push({ id, line: lineOf(raw, m.index), nonLiteralProps: bad, kind: /** @type {const} */ ("block") });
  }
  const js = isSvelte ? raw.replace(/<!--[\s\S]*?-->/g, "") : raw;
  for (const m of js.matchAll(/\bpluginView\(\s*(["'`])?([^"'`),]*)/g)) {
    const literal = m[1] && !(m[1] === "`" && m[2].includes("${"));
    out.push({ id: literal ? m[2] : null, line: lineOf(js, m.index), nonLiteralProps: [], kind: /** @type {const} */ ("proxy") });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const ENGINE_CONTEXT_KEYS = new Set(["session", "themeSettings", "pageTitle", "sidebarProps", "sidebar", "breadcrumbs", "pano", "panoApi"]);

/** Canonical paths the engine serves, used when the theme has not been synced yet. */
const CORE_PAGE_PATHS = [
  "/",
  "/login",
  "/register",
  "/profile",
  "/profile/settings",
  "/activate",
  "/activate-new-email",
  "/notifications",
  "/player/[player]",
  "/post/[url]",
  "/preview/post/[id]",
  "/renew-password",
  "/reset-password",
  "/rules",
  "/support",
  "/tickets",
  "/ticket/[id]",
  "/ticket/create",
  "/theme-settings",
];

/** Two paths with the same shape are the same route (`/p/[a]` and `/p/[b]`). */
const shapeOf = (path) =>
  path
    .split("/")
    .filter(Boolean)
    .map((part) => (part.startsWith("[...") ? "**" : part.startsWith("[") ? "*" : part))
    .join("/");

/**
 * Runs every rule against one theme.
 * @param {{ themeDir?: string, pkgDir?: string, strict?: boolean, fix?: boolean, env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<Report>}
 */
export async function runChecks(options = {}) {
  const themeDir = resolve(options.themeDir ?? process.cwd());
  const pkgDir = options.pkgDir ?? defaultPkgDir;
  const strict = !!options.strict;
  const fix = !!options.fix;
  const env = options.env ?? process.env;

  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const fixed = [];
  /** @param {Level} level @param {string | null} rule @param {string} message */
  const add = (level, rule, message) => findings.push({ level, rule, message });
  const error = (rule, message) => add("error", rule, message);
  const warn = (rule, message) => add("warning", rule, message);
  const info = (rule, message) => add("info", rule, message);
  const rel = (p) => relative(themeDir, p).split(sep).join("/");
  const read = (p) => readFileSync(p, "utf-8");

  const contract = JSON.parse(read(join(pkgDir, "skin-contract.json")));
  const corePkg = JSON.parse(read(join(pkgDir, "package.json")));

  // --- svelte pin ------------------------------------------------------------------------
  let themePkg = {};
  const themePkgPath = join(themeDir, "package.json");
  if (existsSync(themePkgPath)) {
    themePkg = JSON.parse(read(themePkgPath));
  } else {
    error(null, "package.json missing — a theme is a package; run: theme-core new");
  }
  const themeSvelte = themePkg.dependencies?.svelte ?? themePkg.devDependencies?.svelte;
  const coreSvelte = corePkg.dependencies.svelte;
  if (themeSvelte !== coreSvelte) {
    error(
      null,
      `svelte must be pinned to exactly "${coreSvelte}" (core's pin); found "${themeSvelte}" — version skew silently drops plugins at runtime; set it in package.json`,
    );
  }

  // --- theme.config.js -------------------------------------------------------------------
  const themeConfigPath = join(themeDir, "theme.config.js");
  const hasConfig = existsSync(themeConfigPath);
  const configSource = hasConfig ? read(themeConfigPath) : "";
  /** @type {any} */
  let cfg = null;
  /** @type {Override[]} */
  let overrides = [];

  const importConfig = async () => {
    // The module registry is keyed by path, so a config this process already imported (tests run
    // many checks in one process) is imported from a throw-away sibling copy to see fresh text.
    let copy = null;
    try {
      let target = themeConfigPath;
      if (importedConfigs.has(themeConfigPath)) {
        copy = join(themeDir, `.theme.config.check-${process.pid}-${importedConfigs.size}-${Date.now()}.mjs`);
        writeFileSync(copy, configSource);
        target = copy;
      }
      importedConfigs.add(themeConfigPath);
      const mod = await import(pathToFileURL(target).href);
      return mod.default ?? mod;
    } catch (e) {
      error(
        null,
        `theme.config.js could not be imported (${e.message}) — routes, home, claims, pins and settingsSchema were not checked; fix the syntax error`,
      );
      return null;
    } finally {
      if (copy) rmSync(copy, { force: true });
    }
  };

  if (hasConfig) {
    overrides = readOverrides(configSource);
    cfg = await importConfig();
  } else {
    warn(null, "no theme.config.js — theme runs with all default views; create one with: theme-core new");
  }

  // --- snapshots (plugin-contracts/<ns>/views.json, controllers.json) ----------------------
  const snapshotsDir = join(themeDir, "plugin-contracts");
  /** @type {Map<string, { views: any, controllers: any, pluginId: string | null } | null>} */
  const snapshotCache = new Map();
  /** pluginId -> ns, from every snapshot on disk */
  const aliases = new Map();
  /** @type {string[]} */
  const snapshotNamespaces = [];
  if (existsSync(snapshotsDir)) {
    for (const entry of readdirSync(snapshotsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      snapshotNamespaces.push(entry.name);
      try {
        const views = JSON.parse(read(join(snapshotsDir, entry.name, "views.json")));
        if (views.pluginId) aliases.set(views.pluginId, views.namespace ?? entry.name);
      } catch {
        /* a broken snapshot is reported when it is used */
      }
    }
  }

  const readJson = (file) => {
    try {
      return JSON.parse(read(file));
    } catch {
      return null;
    }
  };

  /** @param {string} ns */
  const snapshot = (ns) => {
    if (snapshotCache.has(ns)) return snapshotCache.get(ns);
    const dir = join(snapshotsDir, ns);
    const entry = existsSync(dir)
      ? { views: readJson(join(dir, "views.json")), controllers: readJson(join(dir, "controllers.json")), pluginId: null }
      : null;
    if (entry) entry.pluginId = entry.views?.pluginId ?? null;
    snapshotCache.set(ns, entry);
    return entry;
  };

  /**
   * @param {string} id  `Navbar`, `market:ProductCard`, `pano-plugin-market:ProductCard`
   * @returns {{ plugin: false, name: string, id: string } | { plugin: true, ns: string, name: string, id: string }}
   */
  const parseViewId = (id) => {
    const at = id.lastIndexOf(":");
    if (at < 0) return { plugin: false, name: id, id };
    const prefix = id.slice(0, at);
    const name = id.slice(at + 1);
    let ns = prefix;
    if (!existsSync(join(snapshotsDir, prefix))) {
      if (aliases.has(prefix)) ns = aliases.get(prefix);
      else if (prefix.startsWith("pano-plugin-")) ns = prefix.slice("pano-plugin-".length);
    }
    return { plugin: true, ns, name, id: `${ns}:${name}` };
  };

  /** Record of a view in the engine contract or in a plugin snapshot. */
  const recordOf = (parsed) => {
    if (!parsed.plugin) return contract.views[parsed.name] ?? null;
    return snapshot(parsed.ns)?.views?.views?.[parsed.id] ?? null;
  };

  // --- C1 / C2 / C3: overrides -------------------------------------------------------------
  /** @type {{ ov: Override, parsed: any, record: any, file: string | null, text: string | null }[]} */
  const views = [];
  const noSnapshotWarned = new Set();

  for (const ov of overrides) {
    const parsed = parseViewId(ov.key);
    const file = ov.path ? resolve(themeDir, ov.path.replace(/^\//, "")) : null;
    const exists = !!file && existsSync(file);
    if (!exists) {
      error("C1", `theme.config.js: view '${ov.key}' points at a missing override file: ${ov.path}`);
    }

    let record = null;
    if (!parsed.plugin) {
      record = contract.views[parsed.name] ?? null;
      if (!record && !contract.registry_components.includes(parsed.name)) {
        error(
          "C2",
          `theme.config.js registers unknown view '${parsed.name}' — not part of the core contract (typo? removed in this core version?); run: theme-core list-views`,
        );
      }
    } else {
      const snap = snapshot(parsed.ns);
      if (!snap?.views) {
        if (!noSnapshotWarned.has(parsed.ns)) {
          noSnapshotWarned.add(parsed.ns);
          warn("C2", `view '${ov.key}' cannot be checked: no contract snapshot for plugin '${parsed.ns}'; run: theme-core contracts pull`);
        }
      } else {
        record = snap.views.views?.[parsed.id] ?? null;
        if (!record) {
          error("C2", `view '${ov.key}' is not in the '${parsed.ns}' snapshot (typo, or removed by the plugin); run: theme-core contracts pull`);
        }
      }
    }

    if (record && typeof record.contract === "number" && record.contract !== ov.contract) {
      warn(
        "C3",
        `view '${ov.key}' override is at contract ${ov.contract}, the ${parsed.plugin ? "plugin" : "engine"} is at ${record.contract}: ` +
          `shows the default view until updated; run: theme-core eject-view ${parsed.id}, merge <file>.new, then: theme-core accept ${parsed.id}`,
      );
    }

    views.push({ ov, parsed, record, file: exists ? file : null, text: exists ? read(file) : null });
  }

  // --- C4: hooks, slots and slotProps of the default are kept ---------------------------------
  const defaultViewsDir = join(pkgDir, "src", "lib", "views");
  /** @param {{ parsed: any, record: any }} v */
  const defaultMounts = (v) => {
    const hooks = new Set(v.record?.hooks ?? []);
    const slots = new Set(v.record?.slots ?? []);
    if (!v.parsed.plugin) {
      const src = join(defaultViewsDir, `${v.parsed.name}.svelte`);
      if (existsSync(src)) {
        const m = readMounts(read(src));
        for (const h of m.hooks) hooks.add(h);
        for (const s of m.slots) slots.add(s);
      }
    }
    return { hooks, slots };
  };

  for (const v of views) {
    if (v.text === null) continue;
    const { hooks, slots } = defaultMounts(v);
    const mine = readMounts(v.text);
    const lost = [];
    for (const h of hooks) if (!mine.hooks.has(h)) lost.push(`hook '${h}'`);
    for (const s of slots) if (!mine.slots.has(s)) lost.push(`slot '${s}'`);
    const body = stripHtmlComments(v.text);
    for (const key of Object.keys(v.record?.slotProps ?? {})) {
      if (key === "default") continue;
      if (!new RegExp(`(?<![\\w$])${escapeRe(key)}(?![\\w$])`).test(body)) lost.push(`slot prop '${key}'`);
    }
    for (const item of lost) {
      error("C4", `view '${v.ov.key}' override lost plugin ${item} — plugins mounting there will disappear`);
    }
  }

  // MainLayoutView must not emit the description meta tag itself: <PageHead> (engine, AppLayout)
  // emits exactly one per page, so a fork that kept the old line would serve two.
  for (const v of views) {
    if (v.parsed.plugin || v.parsed.name !== "MainLayoutView" || v.text === null) continue;
    const ov = stripHtmlComments(v.text);
    if (/\bname\s*=\s*(?:["']description["']|\{\s*["']description["']\s*\})/.test(ov)) {
      error(
        null,
        `view 'MainLayoutView' override still emits <meta name="description"> — delete that line: the engine <PageHead> emits the description (and og / canonical tags) once per page, so the override would duplicate it`,
      );
    }
  }

  // --- C5: no hook mounted in more than one effective view -------------------------------------
  {
    const overrideByEngineName = new Map(views.filter((v) => !v.parsed.plugin && v.text !== null).map((v) => [v.parsed.name, v]));
    const overrideByPluginId = new Map(views.filter((v) => v.parsed.plugin && v.text !== null).map((v) => [v.parsed.id, v]));
    /** @type {Record<string, string[]>} */
    const owners = {};
    const own = (hook, label) => (owners[hook] ??= []).push(label);

    if (existsSync(defaultViewsDir)) {
      for (const file of readdirSync(defaultViewsDir)) {
        if (!file.endsWith(".svelte")) continue;
        const name = file.slice(0, -7);
        const ov = overrideByEngineName.get(name);
        const src = ov ? ov.text : read(join(defaultViewsDir, file));
        const label = ov ? rel(ov.file) : `${file} (default)`;
        for (const h of readMounts(src).hooks) own(h, label);
      }
    }
    for (const ns of snapshotNamespaces) {
      for (const [id, rec] of Object.entries(snapshot(ns)?.views?.views ?? {})) {
        const ov = overrideByPluginId.get(id);
        const hooks = ov ? readMounts(ov.text).hooks : new Set(rec.hooks ?? []);
        for (const h of hooks) own(h, ov ? rel(ov.file) : `${id} (default)`);
      }
    }
    // overrides of plugin views whose snapshot is missing still count
    for (const v of views) {
      if (!v.parsed.plugin || v.text === null || v.record) continue;
      for (const h of readMounts(v.text).hooks) own(h, rel(v.file));
    }
    for (const [hook, list] of Object.entries(owners)) {
      const unique = [...new Set(list)];
      if (unique.length > 1) {
        error("C5", `hook '${hook}' is mounted in multiple views (${unique.join(", ")}) — plugins there render twice on the same page; keep it in one of them`);
      }
    }
  }

  // --- C6 / C11: what the override reads and exports ----------------------------------------
  for (const v of views) {
    if (v.text === null) continue;
    if (v.record?.props && typeof v.record.props === "object") {
      const known = new Set(Object.keys(v.record.props));
      const unknown = readProps(v.text).filter((p) => !known.has(p) && p !== "children");
      if (unknown.length) {
        warn("C6", `view '${v.ov.key}' override reads props that are not in its contract (always undefined; see: theme-core list-views): ${unknown.join(", ")}`);
      }
    }
    const code = stripHtmlComments(blankJsComments(v.text));
    if (/\bexport\s+(?:async\s+)?(?:function|const|let)\s+load\b/.test(code) || /\bexport\s*\{[^}]*\bload\b[^}]*\}/.test(code)) {
      warn("C11", `view '${v.ov.key}' override exports load — ignored: data comes from the plugin; remove the export`);
    }
    if (v.parsed.plugin) {
      for (const m of code.matchAll(/\b(set|get)Context\s*\(\s*(["'`])([^"'`]+)\2/g)) {
        if (m[1] === "get" && ENGINE_CONTEXT_KEYS.has(m[3])) continue;
        warn("C11", `view '${v.ov.key}' override calls ${m[1]}Context('${m[3]}') towards a plugin view — ignored: data comes from the plugin; pass props or use a controller`);
      }
    }
  }

  // --- C14: the root class of a plugin view stays on its override -----------------------------
  for (const v of views) {
    if (!v.parsed.plugin || v.text === null || !v.record) continue;
    const root = `${v.parsed.ns}-${kebab(v.parsed.name)}`;
    if (!new RegExp(`(?<![\\w-])${escapeRe(root)}(?![\\w-])`).test(v.text)) {
      warn("C14", `view '${v.ov.key}' override lacks the view's root class; add class "${root}" to its root element: ${root}`);
    }
  }

  // --- theme meta scan (claims, files) ---------------------------------------------------------
  /** @type {{ claims: string[], files: string[] }} */
  let meta = { claims: [], files: [] };
  if (hasConfig && cfg) {
    try {
      const { scanThemeMeta } = await import(pathToFileURL(join(pkgDir, "src", "kit", "theme-meta.js")).href);
      meta = scanThemeMeta({ themeDir, config: cfg });
    } catch (e) {
      warn(null, `theme meta scan failed (${e.message}) — claims and block placements were not checked`);
    }
  }

  // --- C7: block / pluginView placements ---------------------------------------------------------
  {
    const seen = new Set();
    for (const file of meta.files) {
      const isSvelte = file.endsWith(".svelte");
      let text;
      try {
        text = read(file);
      } catch {
        continue;
      }
      for (const place of readPlacements(text, isSvelte)) {
        const at = `${rel(file)}:${place.line}`;
        const what = place.kind === "block" ? "<PluginBlock>" : "pluginView()";
        if (place.id === null) {
          warn("C7", `${at} ${what} has an id that is not a literal: its data loads in the browser, not on the server`);
          continue;
        }
        if (place.nonLiteralProps.length) {
          warn("C7", `${at} <PluginBlock id="${place.id}"> has non-literal props (${place.nonLiteralProps.join(", ")}): its data loads in the browser, not on the server`);
        }
        const dedupe = `${at}|${place.id}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const parsed = parseViewId(place.id);
        if (!parsed.plugin) {
          if (!(parsed.name in contract.views) && !contract.registry_components.includes(parsed.name)) {
            error("C7", `${at} ${what} references unknown view '${parsed.name}'; run: theme-core list-views`);
          }
          continue;
        }
        const snap = snapshot(parsed.ns);
        if (!snap?.views) {
          if (!noSnapshotWarned.has(parsed.ns)) {
            noSnapshotWarned.add(parsed.ns);
            warn("C7", `${at} ${what} references '${place.id}' but there is no contract snapshot for plugin '${parsed.ns}'; run: theme-core contracts pull`);
          }
        } else if (!snap.views.views?.[parsed.id]) {
          error("C7", `${at} ${what} references '${place.id}', which is not in the '${parsed.ns}' snapshot (typo, or removed by the plugin); run: theme-core contracts pull`);
        }
      }
    }
  }

  // --- C8: claims ------------------------------------------------------------------------------------
  for (const id of meta.claims) {
    const parsed = parseViewId(id);
    const rec = recordOf(parsed);
    for (const inj of rec?.inject ?? []) {
      const target = inj.slot ?? inj.hook ?? inj.sidebar;
      if (target) info("C8", `theme claims '${id}': its automatic copy in '${target}' is suppressed`);
    }
  }

  // --- C9: routes ----------------------------------------------------------------------------------------
  if (cfg) {
    const routes = cfg.routes ?? {};
    const { createRouteMap } = await import(pathToFileURL(join(pkgDir, "src", "kit", "route-map.js")).href);
    try {
      createRouteMap({ rename: routes.rename, disable: routes.disable });
    } catch (e) {
      error("C9", `theme.config.js routes: ${e.message}`);
    }
    for (const [from, to] of Object.entries(routes.rename ?? {})) {
      const shape = shapeOf(String(to));
      if (shape === "posts" || shape.startsWith("posts/")) {
        error("C9", `routes.rename "${from}" -> "${to}": /posts is reserved for the posts feed; pick another public path`);
      } else if (shape.startsWith("__pano")) {
        error("C9", `routes.rename "${from}" -> "${to}": /__pano* is reserved; pick another public path`);
      }
    }

    const added = Object.entries(routes.add ?? {});
    if (added.length) {
      const live = new Set(CORE_PAGE_PATHS.map(shapeOf));
      // the pages of a synced theme, except the shims `sync` generated for routes.add itself
      const addedShapes = new Set(added.map(([p]) => shapeOf(p)));
      for (const file of walkFiles(join(themeDir, "src", "routes"), (n) => n === "+page.svelte")) {
        if (file.includes("[...path]")) continue;
        const parts = relative(join(themeDir, "src", "routes"), dirname(file)).split(sep).filter((p) => p && !/^\(.*\)$/.test(p));
        const shape = shapeOf("/" + parts.join("/"));
        if (!addedShapes.has(shape)) live.add(shape);
      }
      for (const ns of snapshotNamespaces) {
        for (const rec of Object.values(snapshot(ns)?.views?.views ?? {})) {
          if (rec?.page?.path) live.add(shapeOf(rec.page.path));
        }
      }
      for (const [from] of Object.entries(routes.rename ?? {})) live.delete(shapeOf(from));

      const publics = new Set(Object.values(routes.rename ?? {}).map((p) => shapeOf(String(p))));
      const seenAdds = new Set();
      for (const [p, file] of added) {
        try {
          createRouteMap({ disable: [p] });
        } catch (e) {
          error("C9", `routes.add "${p}": ${e.message}`);
          continue;
        }
        const shape = shapeOf(p);
        if (shape === "posts" || shape.startsWith("posts/")) error("C9", `routes.add "${p}": /posts is reserved for the posts feed; pick another path`);
        else if (shape.startsWith("__pano")) error("C9", `routes.add "${p}": /__pano* is reserved; pick another path`);
        else if (live.has(shape)) error("C9", `routes.add "${p}": the engine or a plugin already serves this path; use views to redraw it, or rename it`);
        else if (publics.has(shape)) error("C9", `routes.add "${p}": a renamed route is already published at this path`);
        else if (seenAdds.has(shape)) error("C9", `routes.add "${p}": two entries add the same route`);
        seenAdds.add(shape);
        if (typeof file !== "string" || !existsSync(resolve(themeDir, file.replace(/^\//, "")))) {
          error("C9", `routes.add "${p}": page file ${JSON.stringify(file)} does not exist`);
        }
      }
    }
  }

  // --- C10: home ----------------------------------------------------------------------------------------------
  if (cfg?.home) {
    const home = cfg.home;
    const options = home.options ?? {};
    for (const [id, opt] of Object.entries(options)) {
      if (!/^[a-z0-9-]+$/.test(id)) error("C10", `home.options "${id}": ids are [a-z0-9-]+; rename the option`);
      const o = /** @type {any} */ (opt) ?? {};
      if (o.page !== undefined) {
        const file = typeof o.page === "string" ? o.page : null;
        let target = file;
        if (!target) {
          const probe = readOverridesFromEntry(o.page);
          target = probe;
        }
        if (!target || !existsSync(resolve(themeDir, target.replace(/^\//, "")))) {
          error("C10", `home.options "${id}": page file ${JSON.stringify(target ?? String(o.page))} does not exist`);
        }
      }
      if (o.path !== undefined && !(typeof o.path === "string" && (o.path === "*" || o.path.startsWith("/")))) {
        error("C10", `home.options "${id}": path must start with "/" or be "*"; found ${JSON.stringify(o.path)}`);
      }
    }
    if (home.default !== undefined && home.default !== "posts" && !(home.default in options)) {
      error("C10", `home.default "${home.default}" is not one of home.options (${Object.keys(options).join(", ") || "none"}); add the option or pick another default`);
    }
  }

  // --- C12: controller pins ---------------------------------------------------------------------------------------
  {
    /** @type {Map<string, string[]>} name -> where it is used */
    const used = new Map();
    const useAt = (name, where) => used.set(name, [...(used.get(name) ?? []), where]);
    for (const v of views) for (const c of v.ov.controllers) useAt(c, `view '${v.ov.key}'`);
    const sources = walkFiles(join(themeDir, "src"), (n) => /\.(svelte|js|mjs)$/.test(n), [
      "node_modules",
      ".git",
      ".svelte-kit",
      "build",
      "routes",
      "lib",
    ]);
    for (const file of sources) {
      const text = stripHtmlComments(blankJsComments(read(file)));
      for (const m of text.matchAll(/\bplugin\(\s*(["'])([\w-]+)\1\s*\)\s*\.\s*(?:use|require|load)\(\s*(["'])([\w-]+)\3/g)) {
        const parsed = parseViewId(`${m[2]}:x`);
        useAt(`${parsed.ns}/${m[4]}`, `${rel(file)}:${lineOf(text, m.index)}`);
      }
    }

    const pins = cfg?.controllers && typeof cfg.controllers === "object" ? cfg.controllers : {};
    /** @type {Map<string, number>} */
    const toWrite = new Map();
    /** @type {Map<string, string>} */
    const messages = new Map();
    const ctrlNoSnapshot = new Set();
    for (const [name, where] of used) {
      const ns = name.split("/")[0];
      const snap = snapshot(ns);
      if (!snap?.controllers) {
        if (!ctrlNoSnapshot.has(ns) && !noSnapshotWarned.has(ns)) {
          ctrlNoSnapshot.add(ns);
          warn("C12", `controller pins for plugin '${ns}' cannot be checked (${where[0]}): no controllers snapshot; run: theme-core contracts pull`);
        }
        continue;
      }
      const rec = snap.controllers[name];
      if (!rec) {
        warn("C12", `controller '${name}' (${where[0]}) is not in the '${ns}' snapshot (typo, or removed by the plugin); run: theme-core contracts pull`);
        continue;
      }
      const current = pins[name];
      if (current === rec.version) continue;
      toWrite.set(name, rec.version);
      messages.set(
        name,
        current === undefined
          ? `controller '${name}' (${where[0]}) has no pin in theme.config.js controllers; the plugin is at version ${rec.version}: run: theme-core check --fix`
          : `controller '${name}' is pinned to ${current}, the plugin is at version ${rec.version}; after merging the plugin's change: run: theme-core check --fix`,
      );
    }

    if (toWrite.size) {
      let written = false;
      if (fix && hasConfig) {
        const next = writePins(configSource, toWrite);
        if (next !== null) {
          writeFileSync(themeConfigPath, next);
          written = true;
          for (const [name, version] of toWrite) fixed.push(`pinned controller '${name}' to version ${version} in theme.config.js`);
        } else {
          warn("C12", `theme.config.js could not be edited automatically; add to the default export: controllers: { ${[...toWrite].map(([n, v]) => `${JSON.stringify(n)}: ${v}`).join(", ")} }`);
        }
      }
      if (!written && !(fix && hasConfig)) for (const m of messages.values()) warn("C12", m);
    }
  }

  // --- C13: styles <-> provides.bootstrap ---------------------------------------------------------------------------------
  {
    const stylesDir = join(themeDir, "src", "styles");
    const scss = walkFiles(stylesDir, (n) => n.endsWith(".scss"));
    const provides = cfg?.provides?.bootstrap;
    let bootstrapLine = null;
    let sdkMain = false;
    let tokens = false;
    for (const file of scss) {
      const lines = blankJsComments(read(file)).split("\n");
      lines.forEach((line, i) => {
        if (!/@(?:import|use|forward)\b/.test(line)) return;
        if (/bootstrap\/scss/.test(line)) bootstrapLine ??= { at: `${rel(file)}:${i + 1}`, text: line.trim() };
        if (/@panomc\/sdk\/core\/scss\/main/.test(line)) {
          sdkMain = true;
          bootstrapLine ??= { at: `${rel(file)}:${i + 1}`, text: line.trim() };
        }
        if (/pano-tokens/.test(line)) tokens = true;
      });
    }
    if (provides === false) {
      if (bootstrapLine) {
        error("C13", `provides.bootstrap is false but ${bootstrapLine.at} imports Bootstrap; remove this import line: ${bootstrapLine.text}`);
      }
      info("C13", "provides.bootstrap is false: plugin fallback styles need @scope, color-mix() and @layer (Chrome 118, Safari 17.4, Firefox 146)");
    } else if (scss.length) {
      if (!bootstrapLine) {
        warn("C13", `no Bootstrap import in src/styles/**/*.scss while provides.bootstrap is not false; add the line: @import "node_modules/@panomc/sdk/core/scss/main"; (or set provides: { bootstrap: false })`);
      } else if (!sdkMain && !tokens) {
        error("C13", `${bootstrapLine.at} imports Bootstrap directly but nothing imports pano-tokens, so the --pano-* variables are missing; add the line: @import "node_modules/@panomc/sdk/core/scss/pano-tokens";`);
      }
    }
  }

  // --- lang-overrides ------------------------------------------------------------------------------------------------------------
  const langOverrides = join(themeDir, "lang-overrides");
  if (existsSync(langOverrides)) {
    for (const entry of readdirSync(langOverrides, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          JSON.parse(read(join(langOverrides, entry.name)));
        } catch (e) {
          error(null, `lang-overrides/${entry.name} is not valid JSON: ${e.message}; fix the syntax`);
        }
      }
    }
    // C15: lang-overrides/plugins/<ns>/<locale>.json
    const pluginLang = join(langOverrides, "plugins");
    if (existsSync(pluginLang)) {
      for (const entry of readdirSync(pluginLang, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          error("C15", `lang-overrides/plugins/${entry.name}: expected a folder named after the plugin namespace (lang-overrides/plugins/<ns>/<locale>.json)`);
          continue;
        }
        if (!/^[a-z0-9-]+$/.test(entry.name)) {
          error("C15", `lang-overrides/plugins/${entry.name}: the folder must match ^[a-z0-9-]+$; rename it to the plugin namespace`);
        }
        for (const file of walkFiles(join(pluginLang, entry.name), (n) => n.endsWith(".json"))) {
          let data;
          try {
            data = JSON.parse(read(file));
          } catch (e) {
            error("C15", `${rel(file)} is not valid JSON: ${e.message}; fix the syntax`);
            continue;
          }
          if (data === null || typeof data !== "object" || Array.isArray(data)) {
            error("C15", `${rel(file)} must hold a JSON object at the top: { "theme": { … } }`);
          }
        }
      }
    }
  }

  // --- manifest ----------------------------------------------------------------------------------------------------------------------
  const manifestPath = join(themeDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(read(manifestPath));
    for (const key of ["id", "title", "version", "author", "panoVersion", "screenshots"]) {
      if (!(key in manifest)) error(null, `manifest.json missing required key '${key}' (install is refused without it); add it`);
    }
    if (manifest.id === "vanilla-theme" && themePkg.name !== "pano-vanilla-theme") {
      error(null, `manifest id 'vanilla-theme' is reserved for the SYSTEM theme — installs would be refused; pick another id`);
    }
  } else {
    error(null, "manifest.json missing; create it (see: theme-core new)");
  }

  // --- settingsSchema ------------------------------------------------------------------------------------------------------------------
  // The config is imported (not regex-scanned): the schema is a nested object literal, and the view
  // thunks stay lazy, so importing it runs no Svelte code.
  if (cfg && contract.settings_tabs) {
    const settingsSchema = cfg.settingsSchema ?? null;
    if (settingsSchema != null) {
      if (typeof settingsSchema !== "object" || Array.isArray(settingsSchema)) {
        error(null, "theme.config.js: settingsSchema must be an object ({ tabs?, defaultTab? })");
      } else {
        // base tab -> keys, dropping the "_note" doc string (non-array values)
        const baseTabs = {};
        for (const tab in contract.settings_tabs) {
          if (Array.isArray(contract.settings_tabs[tab])) baseTabs[tab] = contract.settings_tabs[tab];
        }
        // key -> the single tab it may live in; base first, extension appends. A key mapped to two
        // different tabs is a save conflict (save/reset are per-tab); same-tab duplicates dedupe.
        const keyToTab = {};
        for (const tab in baseTabs) for (const key of baseTabs[tab]) keyToTab[key] = tab;
        const tabSet = new Set(Object.keys(baseTabs));

        const extTabs = settingsSchema.tabs;
        if (extTabs != null) {
          if (typeof extTabs !== "object" || Array.isArray(extTabs)) {
            error(null, "theme.config.js: settingsSchema.tabs must be an object mapping tabId -> string[]");
          } else {
            for (const tab in extTabs) {
              tabSet.add(tab);
              const keys = extTabs[tab];
              if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
                error(null, `theme.config.js: settingsSchema.tabs['${tab}'] must be an array of setting-key strings`);
                continue;
              }
              for (const key of keys) {
                const owner = keyToTab[key];
                if (owner === undefined) keyToTab[key] = tab;
                else if (owner !== tab)
                  error(null, `settingsSchema key '${key}' is declared in tab '${tab}' but already belongs to tab '${owner}' — the same key in two tabs makes save/reset ambiguous; keep it in one tab`);
              }
            }
          }
        }

        if (settingsSchema.defaultTab != null) {
          if (typeof settingsSchema.defaultTab !== "string") {
            error(null, "theme.config.js: settingsSchema.defaultTab must be a string");
          } else if (!tabSet.has(settingsSchema.defaultTab)) {
            error(null, `settingsSchema.defaultTab '${settingsSchema.defaultTab}' is not a known tab (base tabs + your settingsSchema.tabs) — the settings page would open on an empty tab; pick an existing tab`);
          }
        }
      }
    }
  }

  // --- i18n keys used by overridden views must exist in the MERGED lang tree -------------------------------------------------------------
  // (lang/ is generated: core base + lang-overrides). A missing key renders raw on screen. WARNING, not
  // error: some keys may be served by the backend's dynamic THEME translations at runtime.
  const viewsDir = join(themeDir, "src", "views");
  const mergedLangPath = join(themeDir, "lang", "en-US.json");
  if (existsSync(viewsDir) && existsSync(mergedLangPath)) {
    const lang = JSON.parse(read(mergedLangPath));
    const hasKey = (dotted) => {
      let node = lang;
      for (const part of dotted.split(".")) {
        if (node == null || typeof node !== "object" || !(part in node)) return false;
        node = node[part];
      }
      return true;
    };
    for (const file of walkFiles(viewsDir, (n) => n.endsWith(".svelte"))) {
      // static literals only: the closing quote must be followed by ')' or ',' so concatenated
      // dynamic keys like $_("errors." + code) are skipped
      for (const m of read(file).matchAll(/\$_\(\s*["']([\w.-]+)["']\s*[),]/g)) {
        if (!hasKey(m[1])) {
          warn(null, `src/views/${file.slice(viewsDir.length + 1)} uses i18n key '${m[1]}' missing from the merged lang tree — it will render raw; add it to lang-overrides/`);
        }
      }
    }
  }

  // --- C16: API path literals are Pano routes -----------------------------------------------------------------------------------------------------
  {
    const panoApi = findPanoApi(themeDir, pkgDir);
    if (!panoApi) {
      warn("C16", "API paths were not checked: @panomc/sdk (pano-api) is not installed; run: bun install");
    } else {
      const args = [panoApi, "check-paths"];
      if (env.PANO_CHECK_ROUTES) args.push("--routes", env.PANO_CHECK_ROUTES);
      args.push(themeDir);
      const r = spawnSync(process.execPath, args, { encoding: "utf-8", cwd: themeDir });
      const lines = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter(Boolean);
      if (r.status === 1) {
        for (const line of lines) {
          if (line.startsWith("check-paths:")) continue;
          error("C16", line);
        }
      } else if (r.status !== 0) {
        const why = lines.find((l) => !l.startsWith("check-paths:")) ?? `exit ${r.status}`;
        warn("C16", `API paths were not checked (${why.replace(/^error:\s*/, "")}); run: bun install`);
      }
    }
  }

  const levelOf = (f) => (strict && f.level === "warning" ? "error" : f.level);
  const settled = findings.map((f) => ({ ...f, level: levelOf(f) }));
  return {
    findings: settled,
    problems: settled.filter((f) => f.level === "error"),
    warnings: settled.filter((f) => f.level === "warning"),
    infos: settled.filter((f) => f.level === "info"),
    fixed,
    overrides: overrides.length,
    strict,
  };
}

/** A home page option given as a thunk: the path inside its source text. */
function readOverridesFromEntry(entry) {
  if (typeof entry === "function") {
    const source = Function.prototype.toString.call(entry);
    return /\bimport\(\s*(["'`])([^"'`\n$]+)\1\s*\)/.exec(source)?.[2] ?? null;
  }
  if (entry && typeof entry === "object") return readOverridesFromEntry(entry.component ?? entry.page);
  return null;
}

/** pano-api.js of the theme's installed @panomc/sdk, else the sibling package of this monorepo. */
function findPanoApi(themeDir, pkgDir) {
  const candidates = [];
  try {
    const req = createRequire(join(themeDir, "package.json"));
    candidates.push(join(dirname(req.resolve("@panomc/sdk/package.json")), "bin", "pano-api.js"));
  } catch {
    /* not installed in the theme */
  }
  candidates.push(join(themeDir, "node_modules", "@panomc", "sdk", "bin", "pano-api.js"));
  candidates.push(join(pkgDir, "..", "sdk", "bin", "pano-api.js"));
  try {
    const req = createRequire(join(pkgDir, "package.json"));
    candidates.push(join(dirname(req.resolve("@panomc/sdk/package.json")), "bin", "pano-api.js"));
  } catch {
    /* not resolvable from the engine either */
  }
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** @param {string[]} argv */
export function parseArgs(argv) {
  const flags = { strict: false, fix: false, help: false };
  const unknown = [];
  for (const a of argv) {
    if (a === "--strict") flags.strict = true;
    else if (a === "--fix") flags.fix = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else unknown.push(a);
  }
  return { ...flags, unknown };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("theme-core check [--strict] [--fix]\n  --strict  warnings count as errors (theme-core package always runs strict)\n  --fix     write controller pins into theme.config.js (C12)");
    return;
  }
  if (args.unknown.length) {
    console.error(`theme-core check: unknown argument ${args.unknown.map((a) => `'${a}'`).join(", ")}; use: theme-core check [--strict] [--fix]`);
    process.exit(2);
  }

  const corePkg = JSON.parse(readFileSync(join(defaultPkgDir, "package.json"), "utf-8"));
  const report = await runChecks({ strict: args.strict, fix: args.fix });
  const tag = (f) => (f.rule ? `[${f.rule}] ` : "");

  console.log(pc.dim(`theme-core check${args.strict ? " --strict" : ""} — validating against core ${corePkg.version}`));
  for (const f of report.infos) console.log(`  ${pc.dim("i")} ${pc.dim(tag(f) + f.message)}`);
  for (const f of report.warnings) console.log(`  ${pc.yellow("▲")} ${tag(f)}${f.message}`);
  for (const line of report.fixed) console.log(`  ${pc.green("✓")} fixed: ${line}`);

  if (report.problems.length) {
    for (const f of report.problems) console.error(`  ${pc.red("✗")} ${tag(f)}${f.message}`);
    const n = report.problems.length;
    console.error(pc.red(`\n${n} problem${n === 1 ? "" : "s"} must be fixed before this theme ships${args.strict ? " (strict: warnings count)" : ""}.`));
    process.exit(1);
  }
  console.log(
    `  ${pc.green("✓")} ${pc.bold("OK")} — ${report.overrides} view override${report.overrides === 1 ? "" : "s"} validated against core ${corePkg.version}`,
  );
}

if (import.meta.main) await main();

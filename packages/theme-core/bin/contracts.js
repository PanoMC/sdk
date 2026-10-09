#!/usr/bin/env bun
/**
 * theme-core contracts — plugin view snapshots, overrides and the generated theme metadata
 * (doc 01 sections 5 and 7, doc 02 sections 2 and 5.3, doc 04 section 7).
 *
 *   contracts.js pull [--from <dir|zip>]       copy plugins/<pluginId>/contract/ (without src/) to plugin-contracts/<ns>/
 *   contracts.js eject-view <id | ns:* [--pages]> [--from <dir|zip>]
 *   contracts.js accept <id>
 *   contracts.js list-views [--json]
 *
 * `bin/theme-core.js` forwards its commands here. The library half (everything exported) is plain Node,
 * with no output of its own except through the `log` callbacks, because `sync.js` and the vite config use it too.
 *
 * Run from the THEME's root.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const corePackageDir = path.join(here, "..");

const SNAPSHOT_DIR = "plugin-contracts";

/** Keys of core-meta.json that are generated from theme.config.js; every other key is the author's and is kept. */
export const GENERATED_META_KEYS = [
  "overrides",
  "engine",
  "supports",
  "home",
  "routes",
  "controllers",
  "overrideControllers",
  "urls",
  "settingsSchema",
];

/** An error whose message is meant for the person at the terminal (no stack). */
export class CliError extends Error {}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isDir(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function sameBytes(file, buffer) {
  try {
    return fs.readFileSync(file).equals(buffer);
  } catch {
    return false;
  }
}

/** Posix path relative to a root, for messages and stored paths. */
const posix = (p) => p.split(path.sep).join("/");

/** `pano-plugin-market` -> `market` (doc 01 section 1: only a leading `pano-plugin-` is stripped). */
export function defaultNamespace(pluginId) {
  return String(pluginId).replace(/^pano-plugin-/, "");
}

const sortedObject = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Packages: a built plugin-ui folder (installed under plugins/<pluginId>/, or given with --from)
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   dir: string, pluginId: string, namespace: string,
 *   viewsJson: any, controllersJson: any | null, index: any | null,
 * }} PluginPackage
 */

/** @param {string} dir  @returns {PluginPackage | null} */
export function readPackage(dir) {
  const viewsJson = readJson(path.join(dir, "contract", "views.json"));
  if (!viewsJson || typeof viewsJson !== "object") return null;
  const index = readJson(path.join(dir, "pano-plugin.json"));
  const pluginId = viewsJson.pluginId ?? index?.pluginId ?? path.basename(dir);

  return {
    dir,
    pluginId,
    namespace: viewsJson.namespace ?? index?.namespace ?? defaultNamespace(pluginId),
    viewsJson,
    controllersJson: readJson(path.join(dir, "contract", "controllers.json")),
    index,
  };
}

/** Packages under `plugins/<pluginId>/` of the theme. @returns {PluginPackage[]} */
export function installedPackages(themeDir) {
  const pluginsDir = path.join(themeDir, "plugins");
  if (!isDir(pluginsDir)) return [];

  return fs
    .readdirSync(pluginsDir)
    .sort()
    .map((entry) => (isDir(path.join(pluginsDir, entry)) ? readPackage(path.join(pluginsDir, entry)) : null))
    .filter((pkg) => pkg !== null);
}

const PACKAGE_SUBDIRS = ["", "plugin-ui", path.join("src", "main", "resources", "plugin-ui")];

/** The package at `root`, or in one of the places a plugin repo keeps it. */
function packageAround(root) {
  for (const sub of PACKAGE_SUBDIRS) {
    const pkg = readPackage(path.join(root, sub));
    if (pkg) return pkg;
  }
  return null;
}

/**
 * Packages found at `from`: a package folder, a plugin repo, a folder of packages (a `plugins/` folder), or a zip.
 * @param {string} from
 * @returns {{ packages: PluginPackage[], cleanup: () => void }}
 */
export function locatePackages(from) {
  const target = path.resolve(from);
  let temp = null;
  let root = target;

  if (isFile(target)) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "theme-core-from-"));
    try {
      execFileSync("unzip", ["-q", "-o", target, "-d", temp], { stdio: "pipe" });
    } catch (error) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw new CliError(`cannot unzip ${from}: ${error.code === "ENOENT" ? "the unzip command is not installed" : error.message}`);
    }
    root = temp;
  } else if (!isDir(target)) {
    throw new CliError(`--from ${from} does not exist`);
  }

  const cleanup = () => {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  };

  const own = packageAround(root);
  if (own) return { packages: [own], cleanup };

  const packages = [];
  for (const entry of fs.readdirSync(root).sort()) {
    if (entry === "node_modules" || entry.startsWith(".") || !isDir(path.join(root, entry))) continue;
    const pkg = packageAround(path.join(root, entry));
    if (pkg) packages.push(pkg);
  }

  return { packages, cleanup };
}

// ---------------------------------------------------------------------------
// Snapshots: plugin-contracts/<ns>/
// ---------------------------------------------------------------------------

/**
 * @typedef {{ namespace: string, pluginId: string, dir: string, viewsJson: any, controllersJson: any | null }} Snapshot
 */

/** Snapshots committed in the theme. @returns {Snapshot[]} */
export function readSnapshots(themeDir) {
  const root = path.join(themeDir, SNAPSHOT_DIR);
  if (!isDir(root)) return [];

  const snapshots = [];
  for (const entry of fs.readdirSync(root).sort()) {
    const dir = path.join(root, entry);
    const viewsJson = readJson(path.join(dir, "views.json"));
    if (!viewsJson) continue;
    snapshots.push({
      namespace: viewsJson.namespace ?? entry,
      pluginId: viewsJson.pluginId ?? `pano-plugin-${entry}`,
      dir,
      viewsJson,
      controllersJson: readJson(path.join(dir, "controllers.json")),
    });
  }

  return snapshots;
}

/** Files of `contract/` that go into a snapshot: everything except `src/`. */
function snapshotFiles(contractDir) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (!rel && entry.name === "src") continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
      else if (entry.isFile()) out.push(next);
    }
  };
  if (isDir(contractDir)) walk(contractDir, "");
  return out;
}

/**
 * What changed between two views.json files.
 * @returns {{ added: string[], removed: string[], changed: { id: string, what: string }[] }}
 */
export function diffViews(before, after) {
  const was = before?.views ?? {};
  const now = after?.views ?? {};
  const added = Object.keys(now).filter((id) => !(id in was)).sort();
  const removed = Object.keys(was).filter((id) => !(id in now)).sort();
  const changed = [];

  for (const id of Object.keys(now).sort()) {
    if (!(id in was)) continue;
    if (deepEqual(was[id], now[id])) continue;
    if (was[id].contract !== now[id].contract) {
      changed.push({ id, what: `contract ${was[id].contract ?? 1} -> ${now[id].contract ?? 1}` });
    } else if (!deepEqual(was[id].props, now[id].props)) {
      changed.push({ id, what: "props changed" });
    } else {
      changed.push({ id, what: "metadata changed" });
    }
  }

  return { added, removed, changed };
}

/**
 * Mirrors one package's `contract/` (without `src/`) into `plugin-contracts/<ns>/`.
 * @param {string} themeDir
 * @param {PluginPackage} pkg
 * @returns {{ namespace: string, pluginId: string, first: boolean, written: string[], removed: string[], viewsChanged: boolean, diff: ReturnType<typeof diffViews> }}
 */
export function writeSnapshot(themeDir, pkg) {
  const target = path.join(themeDir, SNAPSHOT_DIR, pkg.namespace);
  const first = !isFile(path.join(target, "views.json"));
  const before = first ? null : readJson(path.join(target, "views.json"));
  const contractDir = path.join(pkg.dir, "contract");
  const files = snapshotFiles(contractDir);
  const written = [];
  const removed = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(contractDir, file));
    const dest = path.join(target, file);
    if (sameBytes(dest, content)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    written.push(file);
  }

  if (isDir(target)) {
    const keep = new Set(files);
    const walk = (dir, rel) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const next = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), next);
          if (fs.readdirSync(path.join(dir, entry.name)).length === 0) fs.rmdirSync(path.join(dir, entry.name));
        } else if (!keep.has(next)) {
          fs.rmSync(path.join(dir, entry.name));
          removed.push(next);
        }
      }
    };
    walk(target, "");
  }

  const after = readJson(path.join(target, "views.json"));
  const viewsChanged = first || !deepEqual(before, after);

  return {
    namespace: pkg.namespace,
    pluginId: pkg.pluginId,
    first,
    written,
    removed,
    viewsChanged,
    diff: diffViews(first ? { views: {} } : before, after),
  };
}

/** The lines `pullContracts` prints for one plugin. */
export function describeSnapshotChange(change) {
  const lines = [];
  const { diff } = change;

  if (change.first) {
    lines.push(`plugin-contracts/${change.namespace}: new snapshot of ${change.pluginId} (${Object.keys(change.views ?? {}).length || diff.added.length} views)`);
  } else {
    lines.push(`plugin-contracts/${change.namespace}: ${change.pluginId} changed`);
    for (const id of diff.added) lines.push(`  + ${id} (new view)`);
    for (const id of diff.removed) lines.push(`  - ${id} (removed)`);
    for (const { id, what } of diff.changed) lines.push(`  ~ ${id} (${what})`);
  }

  return lines;
}

/**
 * Refreshes the snapshots of the installed plugins (or of the packages at `from`) whose contract differs.
 * @param {{ themeDir: string, from?: string, only?: string, log?: (line: string) => void }} options
 *   `only` limits the pull to one namespace or plugin id.
 */
export function pullContracts({ themeDir, from, only, log = () => {} }) {
  let packages;
  let cleanup = () => {};

  if (from) {
    const located = locatePackages(from);
    packages = located.packages;
    cleanup = located.cleanup;
    if (!packages.length) {
      cleanup();
      throw new CliError(`no plugin package with contract/views.json found at ${from}`);
    }
  } else {
    packages = installedPackages(themeDir);
  }

  try {
    if (only) packages = packages.filter((pkg) => pkg.namespace === only || pkg.pluginId === only);

    const changes = [];
    let unchanged = 0;

    for (const pkg of packages) {
      const change = writeSnapshot(themeDir, pkg);
      change.views = pkg.viewsJson.views;
      if (!change.written.length && !change.removed.length && !change.first) {
        unchanged++;
        continue;
      }
      changes.push(change);
      if (change.viewsChanged) for (const line of describeSnapshotChange(change)) log(line);
      else log(`plugin-contracts/${change.namespace}: ${change.pluginId} controller contract updated`);
    }

    return { changes, unchanged, scanned: packages.length };
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// theme.config.js: reading, and text-level edits that keep the author's formatting
// ---------------------------------------------------------------------------

/** Imports theme.config.js (a fresh copy every time). Returns `{}` when it is missing or broken. */
export async function loadThemeConfig(themeDir, onError = () => {}) {
  const file = path.join(themeDir, "theme.config.js");
  if (!isFile(file)) return {};

  try {
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    return mod.default ?? {};
  } catch (error) {
    onError(error);
    return {};
  }
}

/** Index of the character closing the string that opens at `i`. */
function skipString(text, i) {
  const quote = text[i];
  for (i++; i < text.length && text[i] !== quote; i++) if (text[i] === "\\") i++;
  return i;
}

/** The same text with comments blanked (same length, newlines kept), so indices carry over. */
function maskComments(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(text, i);
      out += text.slice(i, end + 1);
      i = end;
    } else if (c === "/" && text[i + 1] === "/") {
      let end = text.indexOf("\n", i);
      if (end < 0) end = text.length;
      out += " ".repeat(end - i);
      i = end - 1;
    } else if (c === "/" && text[i + 1] === "*") {
      let end = text.indexOf("*/", i + 2);
      end = end < 0 ? text.length : end + 2;
      out += text.slice(i, end).replace(/[^\n]/g, " ");
      i = end - 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** Index of the bracket closing the one at `open` (comment-masked text), or -1. */
function matchClose(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '"' || c === "'" || c === "`") i = skipString(masked, i);
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const skipSpace = (masked, i) => {
  while (i < masked.length && /\s/.test(masked[i])) i++;
  return i;
};

/**
 * Top-level properties of the object literal opening at `open`.
 * @returns {{ open: number, close: number, props: { key: string, start: number, valueStart: number, valueEnd: number }[] }}
 */
function scanObject(masked, open) {
  const props = [];
  let depth = 0;
  let expectKey = false;
  let current = null;
  let close = -1;

  const finish = (end) => {
    if (!current) return;
    if (current.valueStart >= 0) {
      let e = end;
      while (e > current.valueStart && /\s/.test(masked[e - 1])) e--;
      current.valueEnd = e;
    } else {
      current.valueEnd = -1;
    }
    props.push(current);
    current = null;
  };

  for (let i = open; i < masked.length; i++) {
    const c = masked[i];

    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      i = skipString(masked, i);
      if (depth === 1 && expectKey) {
        const key = masked.slice(start + 1, i);
        const next = skipSpace(masked, i + 1);
        expectKey = false;
        if (masked[next] === ":") {
          const valueStart = skipSpace(masked, next + 1);
          current = { key, start, valueStart, valueEnd: -1 };
          i = valueStart - 1;
        } else {
          current = { key, start, valueStart: -1, valueEnd: -1 };
        }
      }
      continue;
    }

    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(c)) {
      const start = i;
      let end = i;
      while (end < masked.length && /[\w$]/.test(masked[end])) end++;
      const key = masked.slice(start, end);
      const next = skipSpace(masked, end);
      expectKey = false;
      if (masked[next] === ":") {
        const valueStart = skipSpace(masked, next + 1);
        current = { key, start, valueStart, valueEnd: -1 };
        i = valueStart - 1;
      } else {
        current = { key, start, valueStart: -1, valueEnd: -1 };
        i = end - 1;
      }
      continue;
    }

    if (depth === 1 && expectKey && c === ".") {
      expectKey = false; // spread
      continue;
    }

    if (c === "{" || c === "[" || c === "(") {
      depth++;
      if (depth === 1) expectKey = true;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) {
        finish(i);
        close = i;
        break;
      }
    } else if (c === "," && depth === 1) {
      finish(i);
      expectKey = true;
    }
  }

  return { open, close, props };
}

/** The `{` that opens the object theme.config.js exports, or -1. */
function findDefaultObject(masked) {
  const direct = /export\s+default\s*\{/.exec(masked);
  if (direct) return direct.index + direct[0].length - 1;

  const named = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(masked);
  if (named) {
    const declaration = new RegExp(`(?:const|let|var)\\s+${named[1]}\\s*=\\s*\\{`).exec(masked);
    if (declaration) return declaration.index + declaration[0].length - 1;
  }

  return -1;
}

const lineIndent = (text, index) => {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
};

/** Appends `build(indent)` (one or more lines that end with a comma) to the object opening at `open`. */
function insertProp(text, open, build) {
  const masked = maskComments(text);
  const object = scanObject(masked, open);
  if (object.close < 0) return null;

  const baseIndent = lineIndent(text, open);
  const propIndent = object.props.length ? lineIndent(text, object.props[0].start) : baseIndent + "  ";

  let last = object.close - 1;
  while (last > open && /\s/.test(masked[last])) last--;

  const insertAt = last + 1;
  const prefix = last > open && masked[last] !== "," ? "," : "";
  // a comment at the end of the last property's line stays on that line
  const comment = /^[ \t]*\/\/[^\n]*/.exec(text.slice(insertAt))?.[0] ?? "";
  const head = text.slice(0, insertAt) + prefix + comment;
  const restStart = insertAt + comment.length;
  const inserted = `\n${propIndent}${build(propIndent)}`;

  if (!text.slice(restStart, object.close).includes("\n")) {
    return head + inserted + "\n" + baseIndent + text.slice(object.close);
  }

  return head + inserted + text.slice(restStart);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const keyText = (key) => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

/** @returns {{ masked: string, root: ReturnType<typeof scanObject> | null }} */
function configRoot(text) {
  const masked = maskComments(text);
  const open = findDefaultObject(masked);
  return { masked, root: open < 0 ? null : scanObject(masked, open) };
}

/**
 * Makes sure the default export has a `{ ... }` valued property `key`.
 * @returns {{ text: string, open: number } | null}
 */
function ensureObjectProp(text, key) {
  let { masked, root } = configRoot(text);
  if (!root || root.close < 0) return null;

  let prop = root.props.find((p) => p.key === key);
  if (!prop) {
    const next = insertProp(text, root.open, () => `${key}: {},`);
    if (next === null) return null;
    text = next;
    ({ masked, root } = configRoot(text));
    prop = root?.props.find((p) => p.key === key);
  }

  if (!prop || prop.valueStart < 0 || masked[prop.valueStart] !== "{") return null;
  return { text, open: prop.valueStart };
}

/** Entry of `views` as the object-form config text. */
function viewEntryText(id, { contract, controllers, file }) {
  return (indent) =>
    [
      `${keyText(id)}: {`,
      `${indent}  contract: ${contract},`,
      ...(controllers.length ? [`${indent}  controllers: [${controllers.map((c) => JSON.stringify(c)).join(", ")}],`] : []),
      `${indent}  component: () => import(${JSON.stringify(file)}),`,
      `${indent}},`,
    ].join("\n");
}

/**
 * Adds the object-form entry for `id` to `views`. An existing entry is left alone.
 * @returns {{ text: string, status: "added" | "exists" } | null}  null: the config cannot be edited by text
 */
export function addViewEntry(text, id, entry) {
  const views = ensureObjectProp(text, "views");
  if (!views) return null;

  const object = scanObject(maskComments(views.text), views.open);
  if (object.props.some((p) => p.key === id)) return { text: views.text, status: "exists" };

  const next = insertProp(views.text, views.open, viewEntryText(id, entry));
  return next === null ? null : { text: next, status: "added" };
}

/**
 * Adds `pins` (name -> version) to the top-level `controllers` map; an existing pin is kept
 * unless `overwrite` is set.
 * @returns {{ text: string, added: string[], changed: string[] } | null}
 */
export function addControllerPins(text, pins, { overwrite = false } = {}) {
  const names = Object.keys(pins);
  if (!names.length) return { text, added: [], changed: [] };

  const map = ensureObjectProp(text, "controllers");
  if (!map) return null;

  let current = map.text;
  const added = [];
  const changed = [];

  for (const name of names) {
    const masked = maskComments(current);
    const object = scanObject(masked, map.open);
    const existing = object.props.find((p) => p.key === name);

    if (!existing) {
      const next = insertProp(current, map.open, () => `${JSON.stringify(name)}: ${JSON.stringify(pins[name])},`);
      if (next === null) return null;
      current = next;
      added.push(name);
    } else if (overwrite && existing.valueStart >= 0 && current.slice(existing.valueStart, existing.valueEnd) !== String(pins[name])) {
      current = current.slice(0, existing.valueStart) + JSON.stringify(pins[name]) + current.slice(existing.valueEnd);
      changed.push(name);
    }
  }

  return { text: current, added, changed };
}

/**
 * Sets `contract` of the override `id` (a bare thunk becomes the object form).
 * @returns {{ text: string, controllers: string[], file: string | null } | null}  null: no such entry
 */
export function setViewContract(text, id, contract) {
  const { masked, root } = configRoot(text);
  if (!root || root.close < 0) return null;

  const views = root.props.find((p) => p.key === "views");
  if (!views || views.valueStart < 0 || masked[views.valueStart] !== "{") return null;

  const object = scanObject(masked, views.valueStart);
  const entry = object.props.find((p) => p.key === id);
  if (!entry || entry.valueStart < 0) return null;

  const value = text.slice(entry.valueStart, entry.valueEnd);
  const file = /import\(\s*(["'])([^"']+)\1\s*\)/.exec(value)?.[2] ?? null;

  if (masked[entry.valueStart] !== "{") {
    const indent = lineIndent(text, entry.start);
    const wrapped = `{\n${indent}  contract: ${contract},\n${indent}  component: ${value},\n${indent}}`;
    return { text: text.slice(0, entry.valueStart) + wrapped + text.slice(entry.valueEnd), controllers: [], file };
  }

  const inner = scanObject(masked, entry.valueStart);
  const contractProp = inner.props.find((p) => p.key === "contract");
  const controllersProp = inner.props.find((p) => p.key === "controllers");
  const controllers = controllersProp
    ? [...text.slice(controllersProp.valueStart, controllersProp.valueEnd).matchAll(/(["'])([^"']+)\1/g)].map((m) => m[2])
    : [];

  if (contractProp && contractProp.valueStart >= 0) {
    return {
      text: text.slice(0, contractProp.valueStart) + contract + text.slice(contractProp.valueEnd),
      controllers,
      file,
    };
  }

  const next = insertProp(text, entry.valueStart, () => `contract: ${contract},`);
  return next === null ? null : { text: next, controllers, file };
}

/** Keys of `views` read from the config text (a fallback when the config cannot be imported). */
function viewKeysFromText(text) {
  const { masked, root } = configRoot(text);
  const views = root?.props.find((p) => p.key === "views");
  if (!views || views.valueStart < 0 || masked[views.valueStart] !== "{") return [];
  return scanObject(masked, views.valueStart).props.map((p) => p.key);
}

// ---------------------------------------------------------------------------
// Overrides, engine contracts
// ---------------------------------------------------------------------------

/** @returns {any} */
function readSkinContract() {
  return readJson(path.join(corePackageDir, "skin-contract.json")) ?? { views: {} };
}

/**
 * The override entries of a config's `views`: a function is `{ contract: 1 }`, an object is as written.
 * Ids written as `<pluginId>:<Name>` are returned as `<ns>:<Name>` when a snapshot knows the plugin.
 * @param {any} config
 * @param {Snapshot[]} snapshots
 * @returns {Map<string, { contract: number, controllers: string[] }>}
 */
export function normalizeOverrides(config, snapshots = []) {
  const aliases = new Map(snapshots.map((s) => [s.pluginId, s.namespace]));
  const out = new Map();

  for (const [rawId, raw] of Object.entries(config?.views ?? {})) {
    const at = rawId.indexOf(":");
    const id = at > 0 && aliases.has(rawId.slice(0, at)) ? aliases.get(rawId.slice(0, at)) + rawId.slice(at) : rawId;

    if (typeof raw === "function") out.set(id, { contract: 1, controllers: [] });
    else if (raw && typeof raw === "object") {
      out.set(id, {
        contract: Number.isFinite(raw.contract) ? raw.contract : 1,
        controllers: Array.isArray(raw.controllers) ? raw.controllers.filter((c) => typeof c === "string") : [],
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// core-meta.json (doc 01 section 7)
// ---------------------------------------------------------------------------

const homeKind = (option) => {
  if (option?.path === "*") return "custom";
  if (typeof option?.path === "string") return "path";
  if (option?.page) return "page";
  return "posts";
};

/**
 * Everything the backend reads from a theme, generated from theme.config.js.
 * Keys the author wrote into core-meta.json stay; the generated keys are replaced.
 * @param {{ config: any, existing?: Record<string, any>, snapshots?: Snapshot[], skinContract?: any }} input
 */
export function buildCoreMeta({ config, existing = {}, snapshots = [], skinContract = readSkinContract() }) {
  const overridesMap = normalizeOverrides(config, snapshots);
  const pluginIds = new Map(snapshots.map((s) => [s.namespace, s.pluginId]));

  /** @type {Record<string, number>} */
  const overrides = {};
  /** @type {Record<string, number>} */
  const engine = {};
  /** @type {Record<string, { views: number }>} */
  const supports = {};
  /** @type {Record<string, string[]>} */
  const overrideControllers = {};

  for (const [id, entry] of overridesMap) {
    overrides[id] = entry.contract;

    const at = id.indexOf(":");
    if (at > 0) {
      const ns = id.slice(0, at);
      const pluginId = pluginIds.get(ns) ?? `pano-plugin-${ns}`;
      supports[pluginId] = { views: (supports[pluginId]?.views ?? 0) + 1 };
    } else if (skinContract.views?.[id]) {
      engine[id] = skinContract.views[id].contract ?? 1;
    }

    if (entry.controllers.length) overrideControllers[id] = [...entry.controllers];
  }

  const generated = {
    overrides: sortedObject(overrides),
    engine: sortedObject(engine),
    supports: sortedObject(supports),
  };

  if (config?.home && typeof config.home === "object") {
    const options = {};
    for (const [id, option] of Object.entries(config.home.options ?? {})) {
      options[id] = {
        label: option?.label ?? id,
        kind: homeKind(option),
        ...(typeof option?.path === "string" ? { path: option.path } : {}),
      };
    }
    generated.home = { default: config.home.default ?? "posts", options };
  }

  if (config?.routes && typeof config.routes === "object") {
    generated.routes = {
      rename: config.routes.rename ?? {},
      disable: config.routes.disable ?? [],
      add: Object.keys(config.routes.add ?? {}),
    };
  }

  generated.controllers = sortedObject(config?.controllers ?? {});
  generated.overrideControllers = sortedObject(overrideControllers);

  if (config?.urls && typeof config.urls === "object") generated.urls = config.urls;
  if (config?.settingsSchema && typeof config.settingsSchema === "object") generated.settingsSchema = config.settingsSchema;

  const authored = Object.fromEntries(Object.entries(existing).filter(([key]) => !GENERATED_META_KEYS.includes(key)));
  const ordered = {};
  for (const key of GENERATED_META_KEYS) if (key in generated) ordered[key] = generated[key];

  return JSON.parse(JSON.stringify({ ...authored, ...ordered }));
}

/**
 * Writes `core-meta.json` in `themeDir` (sync) or at `outFile` (the build). Returns whether the file changed.
 * @param {{ themeDir: string, config: any, outFile?: string, extra?: Record<string, any> }} input
 */
export function writeCoreMeta({ themeDir, config, outFile, extra = {} }) {
  const source = path.join(themeDir, "core-meta.json");
  const existing = readJson(source) ?? {};
  const meta = { ...buildCoreMeta({ config, existing, snapshots: readSnapshots(themeDir) }), ...extra };
  const content = JSON.stringify(meta, null, 2) + "\n";
  const target = outFile ?? source;

  if (isFile(target) && fs.readFileSync(target, "utf8") === content) return { changed: false, file: target, meta };

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return { changed: true, file: target, meta };
}

// ---------------------------------------------------------------------------
// eject-view
// ---------------------------------------------------------------------------

/** Removes `export const|let|var <name> = ...;` and `export function <name>(...) {...}` from module-script code. */
export function removeModuleExport(code, name) {
  let text = code;

  for (let guard = 0; guard < 4; guard++) {
    const masked = maskComments(text);
    const variable = new RegExp(`export\\s+(?:const|let|var)\\s+${name}\\b[^=\\n]*=`).exec(masked);
    const fn = new RegExp(`export\\s+(?:async\\s+)?function\\s*\\*?\\s*${name}\\b\\s*\\(`).exec(masked);
    const found = variable ?? fn;
    if (!found) return text;

    let start = found.index;
    let end;

    if (fn && !variable) {
      const open = found.index + found[0].length - 1;
      const closeParen = matchClose(masked, open);
      const brace = closeParen < 0 ? -1 : masked.indexOf("{", closeParen);
      const closeBrace = brace < 0 ? -1 : matchClose(masked, brace);
      if (closeBrace < 0) return text;
      end = closeBrace + 1;
    } else {
      end = endOfStatement(masked, found.index + found[0].length);
    }

    // the line's own indentation, a following newline, and the JSDoc comment right above
    while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
    if (text[end] === "\n") end++;
    else if (text[end] === "\r" && text[end + 1] === "\n") end += 2;

    const before = text.slice(0, start);
    const doc = /\/\*\*[\s\S]*?\*\/[ \t]*\r?\n?[ \t]*$/.exec(before);
    if (doc) start = doc.index;

    text = text.slice(0, start) + text.slice(end);
  }

  return text;
}

/** End (exclusive) of the expression statement whose value starts at `from`. */
function endOfStatement(masked, from) {
  let i = from;
  let seen = false;
  let last = "";

  for (; i < masked.length; i++) {
    const c = masked[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(masked, i);
      seen = true;
      last = c;
    } else if (c === "{" || c === "[" || c === "(") {
      const close = matchClose(masked, i);
      if (close < 0) return masked.length;
      i = close;
      seen = true;
      last = masked[close];
    } else if (c === ";") {
      return i + 1;
    } else if (c === "\n" && seen && !/[=>,+\-*/&|?:(]/.test(last)) {
      const next = skipSpace(masked, i);
      if (!/[.?:+\-*/&|(\[]/.test(masked[next] ?? "") || masked.startsWith("//", next)) return i;
    } else if (!/\s/.test(c)) {
      seen = true;
      last = c;
    }
  }

  return i;
}

/** `<script>` blocks of a Svelte file: `{ start, end, attrs, content, module }`. */
function scriptBlocks(source) {
  const blocks = [];
  for (const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    blocks.push({
      start: m.index,
      end: m.index + m[0].length,
      attrs: m[1],
      content: m[2],
      contentStart: m.index + m[0].indexOf(">") + 1,
      module: /\bmodule\b|context\s*=\s*["']module["']/.test(m[1]),
    });
  }
  return blocks;
}

/** Collapses runs of blank lines and trims the blank lines at both ends of a script body. */
function tidyScript(content) {
  const lines = content.split("\n").map((line) => (line.trim() === "" ? "" : line));
  const out = [];
  for (const line of lines) {
    if (line === "" && (out.length === 0 || out.at(-1) === "")) continue;
    out.push(line);
  }
  while (out.at(-1) === "") out.pop();
  return out.length ? `\n${out.join("\n")}\n` : "";
}

/** Applies `edit(content, block)` to each script block, last to first so the offsets stay valid. */
function mapScripts(source, edit) {
  let out = source;
  for (const block of scriptBlocks(source).reverse()) {
    const next = edit(block.content, block);
    if (next === null) {
      // drop the whole block and the line break after it
      let end = block.end;
      if (out[end] === "\n") end++;
      if (out[end] === "\n") end++;
      out = out.slice(0, block.start) + out.slice(end);
    } else if (next !== block.content) {
      out = out.slice(0, block.contentStart) + next + out.slice(block.contentStart + block.content.length);
    }
  }
  return out;
}

const RELATIVE_SPECIFIER = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["']))(\.{1,2}\/[^"'\n]+)\2/g;
const IMPORT_STATEMENT = /^[ \t]*import\s+(?:[\w$*{}\s,]*?\s+from\s+)?(["'])[^"'\n]+\1[ \t]*;?/gm;
const DEFAULT_SVELTE_IMPORT = /^([ \t]*)import\s+([A-Za-z_$][\w$]*)\s+from\s+(["'])([^"'\n]+\.svelte)\3[ \t]*;?[ \t]*(?:\r?\n|$)/gm;

/** Posix path of `spec` seen from the file at `fromFile` (both relative to contract/). */
const resolveFrom = (fromFile, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));

/**
 * Turns the readable source of a plugin view into an override file:
 * `load` and `view` removed, imports of other views become `pluginView()` proxies,
 * imports of view helpers point at the copy in `_lib/`.
 * @returns {{ code: string, viewImports: { local: string, id: string }[], helperImports: string[], warnings: string[] }}
 */
export function transformViewSource(source, { sourcePath, viewsBySource }) {
  const viewImports = [];
  const helperImports = [];
  const warnings = [];

  let code = mapScripts(source, (content, block) => {
    let next = content;

    if (block.module) {
      const stripped = removeModuleExport(removeModuleExport(next, "view"), "load");
      if (stripped !== next) next = tidyScript(stripped);
      if (!next.trim()) return null;
    }

    const consts = [];
    next = next.replace(DEFAULT_SVELTE_IMPORT, (whole, indent, local, _quote, spec) => {
      if (!spec.startsWith(".")) return whole;
      const id = viewsBySource.get(resolveFrom(sourcePath, spec));
      if (!id) {
        warnings.push(`${spec} is a .svelte file but not a view of the plugin; the import was left as it is`);
        return whole;
      }
      viewImports.push({ local, id });
      consts.push(`${indent}const ${local} = pluginView(${JSON.stringify(id)});`);
      return "";
    });

    next = next.replace(RELATIVE_SPECIFIER, (whole, head, quote, spec) => {
      if (spec.endsWith(".svelte")) return whole;
      const resolved = resolveFrom(sourcePath, spec);
      if (!resolved.startsWith("src/_lib/")) return whole;
      helperImports.push(resolved.slice("src/".length));
      return `${head}./${resolved.slice("src/".length)}${quote}`;
    });

    if (consts.length) {
      const indent = /^[ \t]*/.exec(consts[0])[0];
      const importLine = `${indent}import { pluginView } from "$pano/registry/view.js";`;
      const statements = [...next.matchAll(IMPORT_STATEMENT)];

      if (statements.length) {
        const end = statements.at(-1).index + statements.at(-1)[0].length;
        next = next.slice(0, end) + "\n" + consts.join("\n") + next.slice(end);
        next = next.slice(0, statements[0].index) + importLine + "\n" + next.slice(statements[0].index);
      } else {
        next = `\n${importLine}\n${consts.join("\n")}` + next;
      }
    }

    return next;
  });

  code = code.replace(/\n{3,}/g, "\n\n");
  return { code, viewImports, helperImports, warnings };
}

/** Controllers named in a readable view: `plugin('ns').use|require|load('name')`. */
function controllersInSource(source) {
  const names = new Set();
  for (const m of source.matchAll(/\bplugin\(\s*(["'])([\w-]+)\1\s*\)\s*\.\s*(?:use|require|load)\(\s*(["'])([\w-]+)\3/g)) {
    names.add(`${m[2]}/${m[4]}`);
  }
  return names;
}

/** The helper files (relative to contract/src/) a source needs, followed through their own imports. */
function helperClosure(contractSrcDir, sourcePath, direct) {
  const seen = new Set();
  const queue = [...direct];
  const limit = 500;

  while (queue.length && seen.size < limit) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    const file = path.join(contractSrcDir, rel);
    if (!isFile(file)) continue;
    seen.add(rel);

    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(RELATIVE_SPECIFIER)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname("src/" + rel), m[3]));
      if (resolved.startsWith("src/_lib/")) queue.push(resolved.slice("src/".length));
    }
  }

  return [...seen].sort();
}

/**
 * @typedef {{ file: string, status: "created" | "new" | "unchanged" }} FileResult
 */

/** Writes `content` to `file`; a different existing file gets `<file>.new` instead. @returns {FileResult} */
function writeOwned(file, content, themeDir) {
  const rel = posix(path.relative(themeDir, file));
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  if (!isFile(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return { file: rel, status: "created" };
  }

  if (sameBytes(file, buffer)) return { file: rel, status: "unchanged" };

  fs.writeFileSync(file + ".new", buffer);
  return { file: rel + ".new", status: "new" };
}

/** Parses `[ns:]Name` and `ns:*`. */
export function parseViewId(id) {
  const at = id.indexOf(":");
  if (at < 0) return { ns: null, name: id };
  return { ns: id.slice(0, at), name: id.slice(at + 1) };
}

/**
 * Ejects views into the theme and registers them in theme.config.js.
 * @param {{
 *   themeDir: string, id: string, pages?: boolean, from?: string,
 *   log?: (line: string) => void,
 * }} options
 */
export function ejectViews({ themeDir, id, pages = false, from, log = () => {} }) {
  const { ns, name } = parseViewId(id);

  if (!ns) return ejectEngineView({ themeDir, name, log });
  if (!name) throw new CliError(`usage: eject-view <ns>:<ViewName> | <ns>:*  (got ${id})`);

  let located = null;
  try {
    let pkg;
    if (from) {
      located = locatePackages(from);
      pkg = located.packages.find((p) => p.namespace === ns || p.pluginId === ns);
      if (!pkg) throw new CliError(`no plugin with namespace '${ns}' at ${from}`);
    } else {
      pkg = installedPackages(themeDir).find((p) => p.namespace === ns || p.pluginId === ns);
      if (!pkg) {
        throw new CliError(
          `plugin '${ns}' is not installed under plugins/ (no contract/views.json found); install it, or pass --from <dir|zip> of its built plugin-ui`,
        );
      }
    }

    return ejectFromPackage({ themeDir, pkg, name, pages, log });
  } finally {
    located?.cleanup();
  }
}

function ejectFromPackage({ themeDir, pkg, name, pages, log }) {
  const ns = pkg.namespace;
  const allViews = pkg.viewsJson.views ?? {};

  /** @type {string[]} */
  let ids;
  if (name === "*") {
    ids = Object.keys(allViews).filter((viewId) => !pages || allViews[viewId].kind === "page");
    if (!ids.length) throw new CliError(`${ns}:* matches no view${pages ? " that is a page" : ""}`);
  } else {
    const viewId = allViews[`${ns}:${name}`] ? `${ns}:${name}` : null;
    if (!viewId) {
      const known = Object.keys(allViews).slice(0, 8).join(", ");
      throw new CliError(`${pkg.pluginId} has no view '${ns}:${name}'${known ? ` (it has: ${known})` : ""}`);
    }
    ids = [viewId];
  }

  if (pkg.index?.viewImports === "warn") {
    throw new CliError(
      `${ids[0]} comes from a plugin built with PANO_VIEW_IMPORTS=warn — this plugin version cannot be ejected; update the plugin`,
    );
  }

  // the snapshot is what the registry will compare `contract` with
  if (!isFile(path.join(themeDir, SNAPSHOT_DIR, ns, "views.json"))) {
    const change = writeSnapshot(themeDir, pkg);
    log(`plugin-contracts/${ns}: snapshot written (${change.written.length} files)`);
  }

  const snapshot = readJson(path.join(themeDir, SNAPSHOT_DIR, ns, "views.json")) ?? pkg.viewsJson;
  const snapshotControllers = readJson(path.join(themeDir, SNAPSHOT_DIR, ns, "controllers.json")) ?? pkg.controllersJson ?? {};

  const contractDir = path.join(pkg.dir, "contract");
  const contractSrc = path.join(contractDir, "src");
  const viewsBySource = new Map(Object.entries(allViews).map(([viewId, view]) => [view.source, viewId]));

  const configPath = path.join(themeDir, "theme.config.js");
  const hasConfig = isFile(configPath);
  let configText = hasConfig ? fs.readFileSync(configPath, "utf8") : "";
  let configEditable = hasConfig;
  const manual = [];

  /** @type {any[]} */
  const results = [];
  const pinsToAdd = {};

  for (const viewId of ids) {
    const view = allViews[viewId];
    const viewName = viewId.slice(ns.length + 1);
    const sourceFile = path.join(contractDir, view.source);
    if (!isFile(sourceFile)) {
      throw new CliError(`${viewId}: readable source ${posix(path.join("contract", view.source))} is missing in the package (rebuild the plugin)`);
    }

    const source = fs.readFileSync(sourceFile, "utf8");
    const transformed = transformViewSource(source, { sourcePath: view.source, viewsBySource });

    const helperDirect = new Set(transformed.helperImports);
    for (const helper of pkg.index?.views?.[viewName]?.helpers ?? []) helperDirect.add(`_lib/${helper}`);
    const helpers = helperClosure(contractSrc, view.source, helperDirect);

    const target = path.join(themeDir, "src", "views", ns, `${viewName}.svelte`);
    const viewResult = writeOwned(target, transformed.code, themeDir);

    const helperResults = helpers.map((helper) =>
      writeOwned(path.join(themeDir, "src", "views", ns, helper), fs.readFileSync(path.join(contractSrc, helper)), themeDir),
    );

    // controllers: those the package index lists for the view, plus the literal calls in its source
    const listed = pkg.index?.views?.[viewName]?.controllers;
    const controllers = new Set(Array.isArray(listed) ? listed : Object.keys(listed ?? {}));
    for (const controller of controllersInSource(source)) controllers.add(controller);
    const controllerNames = [...controllers].sort();

    for (const controller of controllerNames) {
      const version = snapshotControllers[controller]?.version ?? listed?.[controller] ?? pkg.controllersJson?.[controller]?.version ?? 1;
      pinsToAdd[controller] = version;
    }

    let entry = "manual";
    if (configEditable) {
      const added = addViewEntry(configText, viewId, {
        contract: snapshot.views?.[viewId]?.contract ?? view.contract ?? 1,
        controllers: controllerNames,
        file: `./src/views/${ns}/${viewName}.svelte`,
      });
      if (added) {
        configText = added.text;
        entry = added.status;
      } else {
        configEditable = false;
      }
    }

    results.push({
      id: viewId,
      contract: snapshot.views?.[viewId]?.contract ?? view.contract ?? 1,
      view: viewResult,
      helpers: helperResults,
      controllers: controllerNames,
      entry,
      warnings: transformed.warnings,
    });
  }

  let pinsAdded = [];
  if (configEditable) {
    const pinned = addControllerPins(configText, pinsToAdd);
    if (pinned) {
      configText = pinned.text;
      pinsAdded = pinned.added;
    } else {
      configEditable = false;
    }
  }

  if (configEditable) {
    if (configText !== fs.readFileSync(configPath, "utf8")) fs.writeFileSync(configPath, configText);
  } else {
    for (const result of results) {
      result.entry = "manual";
      manual.push(result.id);
    }
  }

  return { kind: "plugin", ns, pluginId: pkg.pluginId, results, pinsAdded, pins: pinsToAdd, configEdited: configEditable, hasConfig, manual };
}

function ejectEngineView({ themeDir, name, log }) {
  const contract = readSkinContract();
  const def = contract.views?.[name];
  if (!def) {
    throw new CliError(`no engine view named ${name} in this core version (run: theme-core list-views)`);
  }

  const sourceFile = path.join(corePackageDir, def.source ?? `src/lib/views/${name}.svelte`);
  if (!isFile(sourceFile)) throw new CliError(`the source of ${name} (${def.source}) is missing in this core version`);

  const target = path.join(themeDir, "src", "views", `${name}.svelte`);
  const viewResult = writeOwned(target, fs.readFileSync(sourceFile), themeDir);

  const configPath = path.join(themeDir, "theme.config.js");
  const hasConfig = isFile(configPath);
  let entry = "manual";
  let configEdited = false;

  if (hasConfig) {
    const text = fs.readFileSync(configPath, "utf8");
    const added = addViewEntry(text, name, { contract: def.contract ?? 1, controllers: [], file: `./src/views/${name}.svelte` });
    if (added) {
      entry = added.status;
      configEdited = true;
      if (added.text !== text) fs.writeFileSync(configPath, added.text);
    }
  }

  log?.(`ejected ${name}`);
  return {
    kind: "engine",
    ns: null,
    results: [{ id: name, view: viewResult, helpers: [], controllers: [], entry, warnings: [] }],
    pinsAdded: [],
    pins: {},
    configEdited,
    hasConfig,
    manual: configEdited ? [] : [name],
  };
}

// ---------------------------------------------------------------------------
// accept
// ---------------------------------------------------------------------------

/**
 * Sets `contract` of the override `id` to the snapshot's (or the engine's), re-pins its controllers
 * and deletes the `.new` file beside the override.
 */
export function acceptView({ themeDir, id }) {
  const { ns, name } = parseViewId(id);
  const configPath = path.join(themeDir, "theme.config.js");
  if (!isFile(configPath)) throw new CliError("no theme.config.js in this folder");

  let contract;
  /** @type {Record<string, number>} */
  const versions = {};

  if (ns) {
    let snapshot = readSnapshots(themeDir).find((s) => s.namespace === ns || s.pluginId === ns);
    if (!snapshot) {
      const pkg = installedPackages(themeDir).find((p) => p.namespace === ns || p.pluginId === ns);
      if (pkg) {
        writeSnapshot(themeDir, pkg);
        snapshot = readSnapshots(themeDir).find((s) => s.namespace === pkg.namespace);
      }
    }
    if (!snapshot) throw new CliError(`no snapshot for '${ns}' in plugin-contracts/: run theme-core contracts pull`);

    const canonicalId = `${snapshot.namespace}:${name}`;
    const view = snapshot.viewsJson.views?.[canonicalId];
    if (!view) throw new CliError(`${canonicalId} is not in the snapshot of ${snapshot.pluginId} (the plugin removed it?)`);
    contract = view.contract ?? 1;
    for (const [controller, def] of Object.entries(snapshot.controllersJson ?? {})) versions[controller] = def.version ?? 1;
    id = canonicalId;
  } else {
    const def = readSkinContract().views?.[name];
    if (!def) throw new CliError(`no engine view named ${name} in this core version`);
    contract = def.contract ?? 1;
  }

  const original = fs.readFileSync(configPath, "utf8");
  const updated = setViewContract(original, id, contract);
  if (!updated) throw new CliError(`${id} is not overridden in theme.config.js (nothing to accept)`);

  let text = updated.text;
  const pins = {};
  for (const controller of updated.controllers) if (controller in versions) pins[controller] = versions[controller];
  const pinned = addControllerPins(text, pins, { overwrite: true });
  if (pinned) text = pinned.text;

  if (text !== original) fs.writeFileSync(configPath, text);

  const fallbackFile = ns ? `./src/views/${ns}/${name}.svelte` : `./src/views/${name}.svelte`;
  const overrideFile = path.resolve(themeDir, updated.file ?? fallbackFile);
  const stale = overrideFile + ".new";
  const removedNew = isFile(stale);
  if (removedNew) fs.rmSync(stale);

  return {
    id,
    contract,
    controllersRepinned: pinned ? [...pinned.added, ...pinned.changed] : [],
    removedNew: removedNew ? posix(path.relative(themeDir, stale)) : null,
  };
}

// ---------------------------------------------------------------------------
// list-views
// ---------------------------------------------------------------------------

/**
 * Engine and plugin views with their contract and whether the theme overrides them.
 * @param {{ themeDir: string, config?: any, log?: (line: string) => void }} input
 */
export async function listViews({ themeDir, config, log = () => {} }) {
  let snapshots = readSnapshots(themeDir);

  // a snapshot is pulled when it is missing and the plugin is installed
  const missing = installedPackages(themeDir).filter((pkg) => !snapshots.some((s) => s.namespace === pkg.namespace));
  if (missing.length) {
    for (const pkg of missing) writeSnapshot(themeDir, pkg);
    log(`plugin-contracts: pulled ${missing.map((pkg) => pkg.namespace).join(", ")}`);
    snapshots = readSnapshots(themeDir);
  }

  const resolved = config ?? (await loadThemeConfig(themeDir));
  let overrides = normalizeOverrides(resolved, snapshots);
  if (!overrides.size && isFile(path.join(themeDir, "theme.config.js"))) {
    // the config could not be imported: read the keys from its text
    for (const key of viewKeysFromText(fs.readFileSync(path.join(themeDir, "theme.config.js"), "utf8"))) {
      overrides.set(key, { contract: 1, controllers: [] });
    }
  }

  const skin = readSkinContract();

  const engine = Object.entries(skin.views ?? {}).map(([viewName, def]) => ({
    id: viewName,
    contract: def.contract ?? 1,
    kind: def.kind ?? "view",
    props: Object.keys(def.props ?? {}),
    overridden: overrides.has(viewName),
    overrideContract: overrides.get(viewName)?.contract ?? null,
    outdated: overrides.has(viewName) && overrides.get(viewName).contract !== (def.contract ?? 1),
  }));

  const plugins = [];
  for (const snapshot of snapshots) {
    for (const [viewId, def] of Object.entries(snapshot.viewsJson.views ?? {})) {
      const override = overrides.get(viewId);
      plugins.push({
        id: viewId,
        pluginId: snapshot.pluginId,
        contract: def.contract ?? 1,
        kind: def.kind ?? "component",
        page: def.page?.path ?? null,
        overridden: Boolean(override),
        overrideContract: override?.contract ?? null,
        outdated: Boolean(override) && override.contract !== (def.contract ?? 1),
      });
    }
  }

  const known = new Set([...engine.map((v) => v.id), ...plugins.map((v) => v.id)]);
  const unknown = [...overrides.keys()].filter((key) => !known.has(key));

  return { engine, plugins, unknown };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from") {
      flags.from = argv[++i];
      if (!flags.from) throw new CliError("--from needs a folder or a zip");
    } else if (arg.startsWith("--from=")) {
      flags.from = arg.slice("--from=".length);
    } else if (arg === "--pages") {
      flags.pages = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg.startsWith("--")) {
      throw new CliError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

async function main(argv) {
  const { pc } = await import("./ui.js");
  const themeDir = process.cwd();
  const [command, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  const ok = pc.green("✓");

  switch (command) {
    case "pull": {
      const result = pullContracts({ themeDir, from: flags.from, log: (line) => console.log(line) });
      if (!result.scanned) {
        console.log(`${pc.dim("no plugin package with a contract found under plugins/")}${flags.from ? "" : pc.dim(" (use --from <dir|zip>)")}`);
      } else if (!result.changes.length) {
        console.log(`${ok} plugin-contracts are up to date (${result.scanned} plugin${result.scanned === 1 ? "" : "s"})`);
      } else {
        console.log(`${ok} ${result.changes.length} snapshot${result.changes.length === 1 ? "" : "s"} updated in ${SNAPSHOT_DIR}/`);
      }
      return;
    }

    case "eject-view": {
      const id = positional[0];
      if (!id) {
        throw new CliError(
          "usage: theme-core eject-view <ViewName | ns:Name | ns:*> [--pages] [--from <dir|zip>]   (e.g. LoginView, market:ProductCard)",
        );
      }

      const result = ejectViews({ themeDir, id, pages: flags.pages, from: flags.from, log: (line) => console.log(pc.dim(line)) });
      printEject(pc, result);
      return;
    }

    case "accept": {
      const id = positional[0];
      if (!id) throw new CliError("usage: theme-core accept <id>   (e.g. market:ProductCard)");
      const result = acceptView({ themeDir, id });
      console.log(`${ok} ${pc.bold(result.id)} now targets contract ${result.contract} in theme.config.js`);
      if (result.controllersRepinned.length) console.log(`  re-pinned controllers: ${result.controllersRepinned.join(", ")}`);
      if (result.removedNew) console.log(`  deleted ${result.removedNew}`);
      return;
    }

    case "list-views": {
      const result = await listViews({ themeDir, log: (line) => (flags.json ? null : console.log(pc.dim(line))) });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printList(pc, result);
      return;
    }

    default:
      throw new CliError(`usage: contracts.js pull | eject-view | accept | list-views (got ${command ?? "nothing"})`);
  }
}

function printEject(pc, result) {
  const created = result.results.filter((r) => r.view.status === "created").length;
  const newFiles = [];

  for (const r of result.results) {
    const mark = r.view.status === "created" ? pc.green("✓") : r.view.status === "new" ? pc.yellow("▲") : pc.dim("=");
    const note =
      r.view.status === "new"
        ? ` — ${r.view.file.replace(/\.new$/, "")} already exists: merge ${r.view.file}, then run: theme-core accept ${r.id}`
        : r.view.status === "unchanged"
          ? " — unchanged"
          : "";
    console.log(`${mark} ${pc.cyan(r.id)} -> ${r.view.file}${note}`);
    if (r.view.status === "new") newFiles.push(r.view.file);

    for (const h of r.helpers) {
      if (h.status === "new") {
        console.log(`  ${pc.yellow("▲")} helper ${h.file.replace(/\.new$/, "")} differs: your file was kept, the plugin's version is in ${h.file}`);
        newFiles.push(h.file);
      } else if (h.status === "created") {
        console.log(`  ${pc.dim("+")} helper ${h.file}`);
      }
    }

    for (const w of r.warnings) console.log(`  ${pc.yellow("▲")} ${w}`);
  }

  if (result.results.length > 1) console.log(`${pc.dim(`${result.results.length} views, ${created} new files`)}`);

  if (result.pinsAdded.length) console.log(`${pc.green("✓")} controller pins added: ${result.pinsAdded.map((n) => `${n}@${result.pins[n]}`).join(", ")}`);

  if (!result.hasConfig) {
    console.log(`${pc.yellow("▲")} no theme.config.js found — register the view${result.results.length > 1 ? "s" : ""} manually`);
  } else if (!result.configEdited) {
    console.log(
      `${pc.yellow("▲")} theme.config.js could not be edited automatically (is its default export an object literal with a "views" object?) — add these entries to \`views\` yourself:`,
    );
    for (const r of result.results) {
      const file = result.ns ? `./src/views/${result.ns}/${r.id.split(":")[1]}.svelte` : `./src/views/${r.id}.svelte`;
      console.log(`  ${JSON.stringify(r.id)}: { contract: ${r.contract ?? 1}, component: () => import(${JSON.stringify(file)}) },`);
    }
  } else {
    const added = result.results.filter((r) => r.entry === "added").length;
    if (added) console.log(`${pc.green("✓")} registered ${added} view${added === 1 ? "" : "s"} in ${pc.cyan("theme.config.js")}`);
  }

  console.log(pc.dim(`next: edit the file${result.results.length === 1 ? "" : "s"} under src/views/, then run: bun run check`));
}

function printList(pc, result) {
  const mark = (v) => {
    if (!v.overridden) return "";
    return v.outdated
      ? pc.yellow(` overridden (contract ${v.overrideContract}, outdated)`)
      : pc.green(" overridden");
  };

  // the (sometimes long) props list wraps under an indented tree
  const width = Math.min(process.stdout.columns || 80, 100);
  const indent = "     ";
  const wrap = (items) => {
    const lines = [];
    let line = "";
    for (const item of items) {
      const chunk = line ? `${line}, ${item}` : item;
      if (indent.length + chunk.length > width && line) {
        lines.push(indent + line + ",");
        line = item;
      } else {
        line = chunk;
      }
    }
    if (line) lines.push(indent + line);
    return lines;
  };

  console.log(pc.bold("\n  Engine views ") + pc.dim("(theme.config.js → views)\n"));
  for (const v of result.engine) {
    console.log(`  ${pc.cyan("●")} ${pc.bold(v.id)} ${pc.dim(`contract ${v.contract}`)}${mark(v)}`);
    if (v.props.length) for (const line of wrap(v.props)) console.log(pc.dim(line));
  }

  console.log(pc.bold("\n  Plugin views ") + pc.dim(`(${SNAPSHOT_DIR}/)\n`));
  if (!result.plugins.length) {
    console.log(pc.dim("  none — install a plugin under plugins/ or run: theme-core contracts pull --from <dir|zip>"));
  }
  for (const v of result.plugins) {
    const where = v.page ? pc.dim(` page ${v.page}`) : pc.dim(` ${v.kind}`);
    console.log(`  ${pc.cyan("●")} ${pc.bold(v.id)} ${pc.dim(`contract ${v.contract}`)}${where}${mark(v)}`);
  }

  for (const key of result.unknown) console.log(`  ${pc.yellow("▲")} ${key} is overridden in theme.config.js but unknown here`);

  console.log(`\n  Eject one with ${pc.cyan("bunx @panomc/theme-core eject-view <id>")}\n`);
}

const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof CliError) {
      console.error(`✗ ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}

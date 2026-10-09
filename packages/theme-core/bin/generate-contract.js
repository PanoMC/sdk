#!/usr/bin/env node
/**
 * Generates the machine-readable parts of skin-contract.json and the engine's view table
 * (doc 01 §8, slice 7).
 *
 * For every entry of `views` it reads the DEFAULT source (a part under `src/lib/views/parts`, a
 * page view under `src/lib/views`, or a component under `src/lib/components`) and fills
 *
 *   source     path of the default markup, relative to the package
 *   uses       engine views the default (and its controller) imports - the registry preloads them
 *   hooks      `<Hook name="...">` names
 *   slotProps  `<slot>` name -> prop names, for the slots a theme must keep filling
 *
 * It also writes `src/lib/views/parts/engine-views.generated.js`, the table that is passed to
 * `registerEngineViews()` (`{ [name]: { contract, component: thunk, uses, hooks } }`).
 *
 * The prop set is the one thing a human writes (`props`: name -> description). The generator
 * compares it with the source and keeps a lock per entry: the prop set recorded when the
 * `contract` number was last raised. Changing the set without raising `contract` is refused.
 *
 *   node bin/generate-contract.js           fill the generated fields, the lock and the table
 *   node bin/generate-contract.js --check   change nothing; exit 1 listing every problem
 *
 * JavaScript only; no dependencies.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONTRACT_FILE = "skin-contract.json";
const TABLE_FILE = "src/lib/views/parts/engine-views.generated.js";

/** Directories of default sources, in lookup order, relative to the package. */
const SOURCE_DIRS = ["src/lib/views/parts", "src/lib/views", "src/lib/components"];
/** Directories where a controller (the component a theme imports today) may live. */
const CONTROLLER_DIRS = ["src/lib/components", "src/lib/components/modals"];

const read = (dir, rel) => readFileSync(join(dir, rel), "utf-8");

/** Strips HTML comments and string-free noise that would confuse the scans below. */
const stripComments = (source) => source.replace(/<!--[\s\S]*?-->/g, "");

/** @returns {{ script: string, markup: string }} instance script text and the rest of the file */
function splitSource(source) {
  const clean = stripComments(source);
  let script = "";
  const markup = clean.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g, (_all, attrs, body) => {
    if (!/context\s*=\s*["']module["']/.test(attrs)) script += `${body}\n`;
    return "";
  });
  return { script, markup };
}

/** Names bound by a destructuring pattern `{ a, b = 1, c: d, ...rest }` (the prop names, i.e. the keys). */
function destructuredNames(pattern) {
  const names = [];
  let depth = 0;
  let current = "";
  const parts = [];
  for (const ch of pattern) {
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    if (ch === "}" || ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  for (const part of parts) {
    const text = part.trim();
    if (!text || text.startsWith("...")) continue;
    const m = /^([A-Za-z_$][\w$]*)/.exec(text);
    if (m) names.push(m[1]);
  }
  return names;
}

/** Prop names of a component: `export let a`, or `let { a, b } = $props()`. */
export function propNamesOf(source) {
  const { script } = splitSource(source);
  const names = new Set();
  for (const m of script.matchAll(/export\s+let\s+/g)) {
    // the declaration runs to the first `;` or line end outside brackets
    let depth = 0;
    let end = m.index + m[0].length;
    for (; end < script.length; end++) {
      const ch = script[end];
      if ("{[(".includes(ch)) depth++;
      else if ("}])".includes(ch)) depth--;
      else if (depth <= 0 && (ch === ";" || ch === "\n")) break;
    }
    for (const decl of splitTopLevel(script.slice(m.index + m[0].length, end))) {
      const id = /^\s*([A-Za-z_$][\w$]*)/.exec(decl);
      if (id) names.add(id[1]);
    }
  }
  for (const m of script.matchAll(/let\s*\{([\s\S]*?)\}\s*=\s*\$props\(\)/g)) {
    for (const name of destructuredNames(m[1])) names.add(name);
  }
  return [...names].sort();
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if ("{[(".includes(ch)) depth++;
    if ("}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

/** `<Hook name="x" />` names, in order of first appearance. */
export function hooksOf(source) {
  const { markup } = splitSource(source);
  const names = [];
  for (const m of markup.matchAll(/<Hook\b[^>]*?\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|\{\s*["']([^"']+)["']\s*\})/g)) {
    const name = m[1] ?? m[2] ?? m[3];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** `<slot name="x" a={b} {c}>` -> { x: ["a", "c"] }; the unnamed slot is "default". */
export function slotPropsOf(source) {
  const { markup } = splitSource(source);
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const m of markup.matchAll(/<slot\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const named = /\bname\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(attrs);
    const slot = named ? (named[1] ?? named[2]) : "default";
    const props = new Set(out[slot] ?? []);
    for (const a of attrs.matchAll(/(?:^|\s)(?:([A-Za-z_][\w-]*)\s*=|\{\s*([A-Za-z_$][\w$]*)\s*\})/g)) {
      const name = a[1] ?? a[2];
      if (name && name !== "name") props.add(name);
    }
    out[slot] = [...props].sort();
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The engine views a source renders: a component imported from `<Name>.svelte` that is placed as a
 * tag (`<Name ...>`, `<svelte:component this={Name}>`), or imported in the module script (a default
 * the file hands out, like the toast container's `DefaultToast`). An import that only reads a
 * constant from a controller (`TicketStatuses`) is not a use.
 * @returns {Set<string>} basenames
 */
export function renderedComponents(source) {
  const clean = stripComments(source);
  const used = new Set();
  const scripts = [...clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({
    module: /context\s*=\s*["']module["']/.test(m[1]),
    body: m[2],
  }));
  const markup = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
  for (const { module, body } of scripts) {
    for (const m of body.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+\.svelte)["']/g)) {
      const [, local, path] = m;
      const name = path.slice(path.lastIndexOf("/") + 1, -".svelte".length);
      const placed = new RegExp(`<${local}[\\s/>]|this=\\{${local}\\}`).test(markup);
      if (module || placed) used.add(name);
    }
  }
  return used;
}

/** The default source of a view, relative to the package, or null. */
export function defaultSourceOf(name, dir = pkgDir) {
  for (const base of SOURCE_DIRS) {
    const rel = `${base}/${name}.svelte`;
    if (existsSync(join(dir, rel))) return rel;
  }
  return null;
}

/** The controller file of a view when it differs from the default source (the thing themes import). */
function controllerOf(name, source, dir) {
  for (const base of CONTROLLER_DIRS) {
    const rel = `${base}/${name}.svelte`;
    if (rel !== source && existsSync(join(dir, rel))) return rel;
  }
  return null;
}

/**
 * What the sources say about every view of the contract.
 * @param {{ views: Record<string, any> }} contract
 * @param {string} [dir]
 */
export function deriveAll(contract, dir = pkgDir) {
  const names = Object.keys(contract.views);
  /** @type {Record<string, { source: string|null, props: string[], hooks: string[], slotProps: Record<string,string[]>, uses: string[] }>} */
  const out = {};
  for (const name of names) {
    const source = defaultSourceOf(name, dir);
    if (!source) {
      out[name] = { source: null, props: [], hooks: [], slotProps: {}, uses: [] };
      continue;
    }
    const text = read(dir, source);
    const controller = controllerOf(name, source, dir);
    const imported = new Set(renderedComponents(text));
    if (controller) for (const n of renderedComponents(read(dir, controller))) imported.add(n);
    imported.delete(name);
    out[name] = {
      source,
      props: propNamesOf(text),
      hooks: hooksOf(text),
      slotProps: slotPropsOf(text),
      uses: names.filter((n) => imported.has(n)).sort(),
    };
  }
  return out;
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * Applies the derived data to a contract object and checks the rules.
 * @param {any} contract  parsed skin-contract.json (not modified)
 * @param {ReturnType<typeof deriveAll>} derived
 * @returns {{ contract: any, problems: string[] }}
 */
export function applyDerived(contract, derived) {
  const problems = [];
  const next = structuredClone(contract);
  const views = {};

  for (const [name, entry] of Object.entries(next.views)) {
    const d = derived[name];
    if (!d.source) {
      problems.push(`${name}: no default source found (looked for ${name}.svelte in ${SOURCE_DIRS.join(", ")})`);
      views[name] = entry;
      continue;
    }

    const recorded = Object.keys(entry.props ?? {}).sort();
    // Page views take their data through `$$props` in a few places; their listed props are the
    // contract, so the source comparison applies to entries that declare their props.
    if (!sameSet(recorded, d.props)) {
      const missing = d.props.filter((p) => !recorded.includes(p));
      const extra = recorded.filter((p) => !d.props.includes(p));
      problems.push(
        `${name}: the props of ${d.source} differ from skin-contract.json` +
          (missing.length ? ` - not described: ${missing.join(", ")}` : "") +
          (extra.length ? ` - not in the source: ${extra.join(", ")}` : "") +
          `; edit "props" and raise "contract" (now ${entry.contract ?? 1})`,
      );
    }

    const contractNumber = entry.contract ?? 1;
    const lock = entry.locked;
    let nextLock = lock;
    if (!lock) {
      nextLock = { contract: contractNumber, props: recorded };
    } else if (!sameSet(lock.props, recorded)) {
      if (contractNumber > lock.contract) nextLock = { contract: contractNumber, props: recorded };
      else
        problems.push(
          `${name}: the prop set changed (${lock.props.join(", ")} -> ${recorded.join(", ")}) but "contract" is still ${contractNumber}; raise it to ${lock.contract + 1} (themes that override ${name} keep the default view until they accept the new contract)`,
        );
    } else if (contractNumber > lock.contract) {
      nextLock = { contract: contractNumber, props: recorded };
    } else if (contractNumber < lock.contract) {
      problems.push(`${name}: "contract" went down (${lock.contract} -> ${contractNumber})`);
    }

    const { kind, contract: _c, source: _s, uses: _u, hooks: _h, slotProps: _sp, props, locked: _l, ...other } = entry;
    views[name] = {
      ...(kind ? { kind } : {}),
      contract: contractNumber,
      source: d.source,
      uses: d.uses,
      hooks: d.hooks,
      slotProps: d.slotProps,
      ...other,
      props,
      locked: nextLock,
    };
  }

  next.views = views;
  // Kept for `theme-core check` / `list-views`, which still read it: the component-kind views.
  next.registry_components = Object.entries(views)
    .filter(([, v]) => v.kind === "component")
    .map(([name]) => name);
  return { contract: next, problems };
}

/** The text of the generated engine table. */
export function engineTableSource(contract) {
  const lines = [
    "// Generated by bin/generate-contract.js from skin-contract.json - do not edit.",
    "// The engine's own views for registerEngineViews() (doc 01 section 4): the default of a view",
    "// is its markup file (a part when the view was split into controller + part).",
    "",
    "export const engineViews = {",
  ];
  for (const [name, entry] of Object.entries(contract.views)) {
    const rel = entry.source.replace(/^src\/lib\//, "../../");
    const path = rel.startsWith("../../views/parts/") ? `./${rel.slice("../../views/parts/".length)}` : rel.replace("../../views/", "../");
    const fields = [`contract: ${entry.contract ?? 1}`, `component: () => import(${JSON.stringify(path)})`];
    if (entry.uses?.length) fields.push(`uses: ${JSON.stringify(entry.uses)}`);
    if (entry.hooks?.length) fields.push(`hooks: ${JSON.stringify(entry.hooks)}`);
    lines.push(`  ${JSON.stringify(name)}: { ${fields.join(", ")} },`);
  }
  lines.push("};", "");
  return lines.join("\n");
}

/**
 * JSON with a one-space indent (the file's existing style); arrays of plain values under
 * `settings_tabs` and inside a view entry (`uses`, `hooks`, `slotProps`, `locked`) stay on one line.
 */
export function stringify(contract) {
  const flat = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");
  const emit = (value, depth, compact) => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    const pad = " ".repeat(depth + 1);
    const end = " ".repeat(depth);
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]";
      if (compact && flat(value)) return `[${value.map((x) => JSON.stringify(x)).join(", ")}]`;
      return `[\n${value.map((x) => pad + emit(x, depth + 1, compact)).join(",\n")}\n${end}]`;
    }
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    return `{\n${keys.map((k) => `${pad}${JSON.stringify(k)}: ${emit(value[k], depth + 1, compact || k === "settings_tabs" || (depth === 2 && k !== "props"))}`).join(",\n")}\n${end}}`;
  };
  return `${emit(contract, 0, false)}\n`;
}

/**
 * Runs the generator.
 * @param {{ dir?: string, check?: boolean }} [options]
 * @returns {{ problems: string[], changed: string[] }}
 */
export function generate({ dir = pkgDir, check = false } = {}) {
  const current = JSON.parse(read(dir, CONTRACT_FILE));
  const derived = deriveAll(current, dir);
  const { contract, problems } = applyDerived(current, derived);

  /** @type {string[]} */
  const changed = [];
  const files = [
    [CONTRACT_FILE, stringify(contract)],
    [TABLE_FILE, engineTableSource(contract)],
  ];
  for (const [rel, text] of files) {
    const existing = existsSync(join(dir, rel)) ? read(dir, rel) : null;
    if (existing === text) continue;
    changed.push(rel);
    // Never write a contract that breaks a rule: the human edit comes first.
    if (!check && problems.length === 0) writeFileSync(join(dir, rel), text);
  }
  return { problems, changed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const { problems, changed } = generate({ check });
  for (const p of problems) console.error(`contract: ${p}`);
  if (check && changed.length) {
    for (const rel of changed) console.error(`contract: ${rel} is out of date; run: node bin/generate-contract.js`);
  }
  if (problems.length || (check && changed.length)) process.exit(1);
  if (!check) console.log(changed.length ? `updated ${changed.join(", ")}` : "skin-contract.json is up to date");
}

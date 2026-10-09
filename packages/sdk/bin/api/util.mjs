// Shared helpers of the pano-api CLI: file walking, argument parsing, line lookup, small string tools.
import fs from 'node:fs';
import path from 'node:path';

/** Directory names that are never scanned. */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'build', 'dist', 'out', 'target', '.gradle', '.idea', '.svelte-kit', '.output', '.turbo',
]);

/**
 * Lists files below `root` whose extension is in `exts`. Nested repositories (a directory holding its own `.git`,
 * such as a submodule), `__tests__` and fixture folders below `root` are skipped; paths are absolute and sorted.
 * @param {string} root
 * @param {{ exts: string[], kotlinMain?: boolean }} opts `kotlinMain` drops `src/test` style folders.
 * @returns {string[]}
 */
export function walk(root, opts) {
  const out = [];
  const rootAbs = path.resolve(root);
  /** @param {string} dir */
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(rootAbs, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name === '__fixtures__' || e.name === '__tests__') continue;
        if (fs.existsSync(path.join(full, '.git'))) continue;
        if (opts.kotlinMain && /(^|\/)src\/(test|androidTest|testFixtures|integrationTest)$/.test(rel)) continue;
        visit(full);
      } else if (e.isFile() && opts.exts.some((x) => e.name.endsWith(x)) && !e.name.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  };
  visit(rootAbs);
  return out.sort();
}

/** @param {string} p */
export const readText = (p) => fs.readFileSync(p, 'utf8');

/**
 * Writes `content` unless the file already holds it.
 * @param {string} p
 * @param {string} content
 * @returns {boolean} true when the file changed
 */
export function writeIfChanged(p, content) {
  if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return true;
}

/** @param {string} root @param {string} file */
export const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

/**
 * Builds a function mapping a string offset to a 1-based line number.
 * @param {string} text
 * @returns {(idx: number) => number}
 */
export function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** @param {string} s */
export const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Applies non-overlapping edits to `text`.
 * @param {string} text
 * @param {{ start: number, end: number, text: string }[]} edits
 */
export function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * Minimal argument parser: `--flag`, `--key value`, `--key=value`, positionals.
 * @param {string[]} argv
 * @param {{ bool?: string[], value?: string[] }} spec
 * @returns {{ flags: Record<string, any>, positional: string[] }}
 */
export function parseArgs(argv, spec) {
  const flags = {};
  const positional = [];
  const bool = new Set(spec.bool || []);
  const value = new Set(spec.value || []);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = a.slice(2, eq === -1 ? undefined : eq);
    if (bool.has(key)) flags[key] = true;
    else if (value.has(key)) {
      const v = eq === -1 ? argv[++i] : a.slice(eq + 1);
      if (v === undefined) throw new Error(`--${key} needs a value`);
      if (flags[key] === undefined) flags[key] = v;
      else flags[key] = [].concat(flags[key], v);
    } else throw new Error(`unknown option --${key}`);
  }
  return { flags, positional };
}

/**
 * Reads `pluginId=` of the nearest `gradle.properties` at or above `dir`, never leaving `stopAt`.
 * @param {string} dir
 * @param {string} stopAt
 * @param {Map<string, string|null>} [cache]
 * @returns {string|null}
 */
export function pluginIdFor(dir, stopAt, cache = new Map()) {
  const stop = path.resolve(stopAt);
  let cur = path.resolve(dir);
  const visited = [];
  let found = null;
  for (;;) {
    if (cache.has(cur)) {
      found = cache.get(cur) ?? null;
      break;
    }
    visited.push(cur);
    const gp = path.join(cur, 'gradle.properties');
    if (fs.existsSync(gp)) {
      const m = /^\s*pluginId\s*=\s*(\S+)\s*$/m.exec(fs.readFileSync(gp, 'utf8'));
      if (m) {
        found = m[1];
        break;
      }
    }
    if (cur === stop || path.dirname(cur) === cur) break;
    cur = path.dirname(cur);
  }
  for (const v of visited) cache.set(v, found);
  return found;
}

/** Stable JSON: sorted object keys, 2 spaces, trailing newline. */
export function stableJson(value) {
  /** @param {any} v */
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = sort(v[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}

/** Plain JSON with 2 spaces and a trailing newline, key order kept. */
export const prettyJson = (v) => JSON.stringify(v, null, 2) + '\n';

/** Levenshtein distance. @param {string} a @param {string} b */
export function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

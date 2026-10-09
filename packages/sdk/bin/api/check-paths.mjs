// check-paths: every path passed to ApiUtil / api must be a Pano route (doc 04 section 9).
import fs from 'node:fs';
import path from 'node:path';
import { CORE_ROUTES_FILE, extractRoutes, API_ROOT, PLUGINS_ROOT } from './extract-routes.mjs';
import { findApiCalls, splitTail } from './js-scan.mjs';
import { segments, segMatch } from './rename-table.mjs';
import { walk, readText, rel, lineIndex, distance, pluginIdFor } from './util.mjs';

/**
 * Pattern form of a route path relative to /api/v1 (`/posts/:id`).
 * @param {string} full
 */
const relative = (full) =>
  full.startsWith(API_ROOT) ? full.slice(API_ROOT.length) || '/' : full.startsWith(PLUGINS_ROOT + '/') ? full.slice('/api'.length) : full;

/**
 * Does a literal (template holes allowed) fit one of the route patterns?
 * @param {string} lit @param {string} pattern
 */
export function fits(lit, pattern) {
  const a = segments(lit);
  const b = segments(pattern);
  if (a.length !== b.length) return false;
  return a.every((s, i) => segMatch(s, b[i]));
}

/** @param {string} lit */
const normalise = (lit) => lit.replace(/\$\{[^}]*\}/g, ':_').replace(/:[A-Za-z_]\w*/g, ':_');

/**
 * @param {string} lit @param {string[]} patterns
 * @returns {string | null}
 */
export function suggest(lit, patterns) {
  const n = normalise(lit);
  let best = null;
  let bestD = Infinity;
  for (const p of patterns) {
    const d = distance(n, normalise(p));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best !== null && bestD <= Math.max(3, Math.floor(n.length * 0.25)) ? best : null;
}

/**
 * Collects the literal path arguments of API client calls in a source.
 * @param {string} src
 */
export function collectCalls(src) {
  const lineOf = lineIndex(src);
  const out = [];
  for (const call of findApiCalls(src)) {
    const args = src.slice(call.open + 1, call.close);
    const m = /\bpath\s*:\s*(['"`])/.exec(args);
    if (!m) continue;
    const q = call.open + 1 + m.index + m[0].length - 1;
    const quote = src[q];
    let e = q + 1;
    while (e < src.length && src[e] !== quote && !(quote !== '`' && src[e] === '\n')) e += src[e] === '\\' ? 2 : 1;
    if (src[e] !== quote) continue;
    out.push({ ...call, line: lineOf(q), literal: src.slice(q + 1, e) });
  }
  return out;
}

/**
 * @param {{ root: string, routes?: string, pluginId?: string | null }} o
 * @returns {{ problems: string[], checked: number, errors: string[] }}
 */
export function checkPaths(o) {
  const rootAbs = path.resolve(o.root);
  const errors = [];
  const routesFile = o.routes ? path.resolve(o.routes) : CORE_ROUTES_FILE;
  /** @type {string[]} */
  let corePatterns = [];
  if (fs.existsSync(routesFile)) {
    corePatterns = JSON.parse(readText(routesFile)).map((r) => relative(r.path));
  } else {
    errors.push(`routes file ${routesFile} not found; generate it with "pano-api extract-routes --core <pano-web-platform>"`);
  }
  // the repository's own routes (a plugin repo has Kotlin endpoints; a UI repo has none)
  const own = extractRoutes(rootAbs, { pluginId: o.pluginId ?? undefined }).routes;
  const ownId = o.pluginId ?? pluginIdFor(rootAbs, rootAbs);
  const ownMounted = own.map((r) => relative(r.path));
  const ownSite = own.filter((r) => r.namespace === 'SITE').map((r) => r.declared);
  const ownPanel = own.filter((r) => r.namespace === 'PANEL').map((r) => r.declared);

  const problems = [];
  let checked = 0;
  for (const p of walk(rootAbs, { exts: ['.js', '.mjs', '.cjs', '.svelte', '.ts'] })) {
    if (path.basename(p) === 'pano-api.js') continue;
    const src = readText(p);
    for (const c of collectCalls(src)) {
      const at = `${rel(rootAbs, p)}:${c.line}`;
      const [lit] = splitTail(c.literal);
      if (/^\/api(\/|$)/.test(lit)) {
        problems.push(`${at} '${lit}' must not start with /api: write '${lit.replace(/^\/api/, '') || '/'}'`);
        checked++;
        continue;
      }
      if (!lit.startsWith('/')) continue; // a variable or a computed prefix: nothing to compare
      checked++;
      let patterns;
      if (c.kind === 'core') {
        if (c.panel) continue;
        patterns = [...corePatterns, ...ownMounted];
      } else {
        if (c.pluginId && ownId && c.pluginId !== ownId) continue; // another plugin's API: not ours to verify
        if (!own.length) continue;
        patterns = c.panel ? ownPanel : ownSite;
      }
      if (!patterns.length) continue;
      if (patterns.some((pat) => fits(lit, pat))) continue;
      const hint = suggest(lit, patterns);
      problems.push(`${at} '${lit}' is not a Pano route${hint ? ` (did you mean '${hint}'?)` : ''}`);
    }
  }
  return { problems, checked, errors };
}

/**
 * @param {{ root: string, routes?: string, pluginId?: string | null }} o
 * @returns {number}
 */
export function runCheckPaths(o) {
  const r = checkPaths(o);
  for (const e of r.errors) console.error(`error: ${e}`);
  for (const p of r.problems) console.error(p);
  console.error(`check-paths: ${r.checked} path(s) checked, ${r.problems.length} problem(s)`);
  if (r.errors.length) return 2;
  return r.problems.length ? 1 : 0;
}

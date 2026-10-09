// extract-routes: static scan of @Endpoint Kotlin classes -> route list (doc 04 section 9).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKotlinProject, layoutOf } from './project.mjs';
import { prettyJson } from './util.mjs';

export const API_ROOT = '/api/v1';
/** Plugin endpoints are unversioned (decision 81): `/api/plugins/<id>/...`, panel ones `/api/plugins/<id>/panel/...`. */
export const PLUGINS_ROOT = '/api/plugins';
/** Where `--core` writes: `packages/sdk/api/routes.core.json`, shipped in the sdk package. */
export const CORE_ROUTES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'api', 'routes.core.json');

/** Mirror of ApiPaths.resolve (doc 04 section 2). */
export function resolvePath(declared, mount, namespace, pluginId) {
  if (mount === 'ROOT') return declared;
  if (namespace === 'PANEL') return pluginId ? `${PLUGINS_ROOT}/${pluginId}/panel${declared}` : `${API_ROOT}/panel${declared}`;
  return pluginId ? `${PLUGINS_ROOT}/${pluginId}${declared}` : `${API_ROOT}${declared}`;
}

/** Declared path as seen by the router before the cutover (it still carries `/api`). */
export const isLegacy = (declared) => declared === '/api' || declared.startsWith('/api/');

/**
 * @typedef {{
 *   method: string, path: string, declared: string, pluginId: string | null, namespace: 'SITE' | 'PANEL',
 *   mount: 'API' | 'ROOT', class: string, file: string, line: number, legacy: boolean
 * }} Route
 */

/**
 * Scans `root` (a plugin repo, a Kotlin source folder or a pano-web-platform checkout) and returns the routes.
 * @param {string} root
 * @param {{ pluginId?: string | null }} [opts]
 * @returns {{ routes: Route[], errors: { file: string, line: number, message: string }[] }}
 */
export function extractRoutes(root, opts = {}) {
  const { kotlinRoot } = layoutOf(root);
  const project = loadKotlinProject(kotlinRoot, { ...opts, labelRoot: path.resolve(root) });
  /** @type {Route[]} */
  const routes = [];
  for (const ep of project.endpoints) {
    for (const call of ep.calls) {
      routes.push({
        method: call.method,
        path: isLegacy(call.value) ? call.value : resolvePath(call.value, ep.mount, ep.namespace, ep.pluginId),
        declared: call.value,
        pluginId: ep.pluginId,
        namespace: ep.namespace,
        mount: ep.mount,
        class: ep.cls.name,
        file: ep.file.rel,
        line: call.line,
        legacy: ep.mount === 'API' && isLegacy(call.value),
      });
    }
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.class.localeCompare(b.class));
  return { routes, errors: project.errors };
}

/**
 * The refusal table of doc 04 section 2 applied to extracted routes, plus duplicate detection.
 * @param {Route[]} routes
 * @returns {string[]} one message per problem, `file:line Class: ... ; fix`
 */
export function checkRoutes(routes) {
  const problems = [];
  const seen = new Map();
  const ordered = [...routes].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (const r of ordered) {
    const at = `${r.file}:${r.line} ${r.class}`;
    const d = r.declared;
    if (r.mount === 'API') {
      if (!d || !d.startsWith('/')) problems.push(`${at}: path "${d}" must start with "/"; declare "/hello"`);
      else if (r.legacy || d === '/api' || d.startsWith('/api/'))
        problems.push(`${at}: path "${d}" starts with /api; declare "${d.replace(/^\/api/, '') || '/posts'}", not "${d}"; Pano adds /api/v1 itself`);
      else if (d === '/panel' || d.startsWith('/panel/'))
        problems.push(`${at}: path "${d}" starts with /panel; extend PanelApi and declare "${d.replace(/^\/panel/, '') || '/settings'}"; Pano adds /panel itself`);
      else if (r.pluginId) {
        const first = d.split('/')[1] ?? '';
        if (first === '_' || first.startsWith(':'))
          problems.push(`${at}: plugin path "${d}" starts with "${first}"; put a resource name first: "/items/:id"`);
      } else if (d.startsWith('/plugins/') && !/(^|\/)route\/api\/plugins\//.test(r.file))
        problems.push(`${at}: core path "${d}" starts with /plugins/; reserved for plugins`);
    }
    const key = `${r.method} ${r.path.replace(/:[A-Za-z_]\w*/g, ':_')}`;
    if (seen.has(key)) problems.push(`${at}: duplicate of ${seen.get(key)} for ${r.method} ${r.path}`);
    else seen.set(key, `${r.file}:${r.line} ${r.class}`);
  }
  return problems;
}

/** Output form: stable, without line numbers. */
export const toJson = (routes) =>
  prettyJson(routes.map(({ method, path: p, pluginId, namespace, class: cls, file, declared, mount }) => ({ method, path: p, pluginId, namespace, mount, class: cls, file, declared })));

/**
 * CLI entry.
 * @param {{ root: string, core: boolean, check: boolean, out?: string, pluginId?: string }} o
 * @returns {number} exit code
 */
export function runExtractRoutes(o) {
  const { routes, errors } = extractRoutes(o.root, { pluginId: o.pluginId });
  if (errors.length) {
    for (const e of errors) console.error(`${e.file}:${e.line} ${e.message}`);
    console.error(`extract-routes: ${errors.length} endpoint class(es) could not be read`);
    return 2;
  }
  const problems = checkRoutes(routes);
  const json = toJson(routes);
  const target = o.out ? path.resolve(o.out) : o.core ? CORE_ROUTES_FILE : null;
  if (o.check) {
    for (const p of problems) console.error(p);
    let stale = false;
    if (target && fs.existsSync(target) && fs.readFileSync(target, 'utf8') !== json) stale = true;
    if (target && !fs.existsSync(target)) stale = true;
    if (stale) console.error(`extract-routes: ${path.relative(process.cwd(), target)} is out of date; run "pano-api extract-routes ${o.core ? '--core ' : ''}${o.root}"`);
    console.error(`extract-routes: ${routes.length} routes, ${problems.length} problem(s)${stale ? ', snapshot stale' : ''}`);
    return problems.length || stale ? 1 : 0;
  }
  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
    console.error(`extract-routes: wrote ${routes.length} routes to ${target}`);
  } else process.stdout.write(json);
  if (problems.length) console.error(`extract-routes: ${problems.length} path(s) do not fit the /api/v1 scheme yet; run with --check to list them`);
  return 0;
}

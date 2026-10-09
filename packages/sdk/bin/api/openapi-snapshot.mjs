// openapi-snapshot: fetch the OpenAPI documents of a booted Pano and write / check the committed snapshots.
//   core      GET /api/v1/openapi.json                       -> <core-dir>/openapi-core.json      (default Pano/api)
//   internal  GET /api/v1/panel/openapi.json                 -> <core-dir>/openapi-internal.json
//   plugin    GET /api/v1/plugins/<id>/_/openapi.json        -> <plugins-dir>/<id>/api/openapi.json
// --check exits 1 when a snapshot differs; breaking differences are listed through api-compat.
import fs from 'node:fs';
import path from 'node:path';
import { breaks } from './api-compat.mjs';
import { stableJson, pluginIdFor } from './util.mjs';

/**
 * @param {string} base
 * @param {string} p
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<any | null>} null on 404
 */
async function getJson(base, p, fetchImpl) {
  const res = await fetchImpl(base.replace(/\/+$/, '') + p, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${p} answered ${res.status}`);
  return res.json();
}

/**
 * Plugin repositories below a directory: folders with a gradle.properties holding a pluginId.
 * @param {string} dir
 * @returns {{ id: string, dir: string }[]}
 */
export function findPluginRepos(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const d = path.join(dir, e.name);
    if (!fs.existsSync(path.join(d, 'gradle.properties'))) continue;
    const id = pluginIdFor(d, d);
    if (id) out.push({ id, dir: d });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @typedef {{
 *   url: string, write?: boolean, check?: boolean, coreDir: string, pluginsDir?: string, plugins?: string[],
 *   today?: string, allowBreaks?: boolean, fetch?: typeof fetch, repo?: string
 * }} SnapshotOptions
 */

/**
 * @param {SnapshotOptions} o
 * @returns {Promise<number>} exit code
 */
export async function runOpenapiSnapshot(o) {
  const f = o.fetch || fetch;
  const today = o.today || new Date().toISOString().slice(0, 10);
  /** @type {{ label: string, file: string, spec: any | null, optional?: boolean }[]} */
  const targets = [];
  try {
    targets.push({ label: 'core', file: path.join(o.coreDir, 'openapi-core.json'), spec: await getJson(o.url, '/api/v1/openapi.json', f) });
    targets.push({ label: 'internal', file: path.join(o.coreDir, 'openapi-internal.json'), spec: await getJson(o.url, '/api/v1/panel/openapi.json', f) });
    /** @type {{ id: string, dir: string }[]} */
    let repos = [];
    if (o.pluginsDir) repos = findPluginRepos(o.pluginsDir);
    if (o.repo) {
      const id = pluginIdFor(o.repo, o.repo);
      if (id) repos.push({ id, dir: path.resolve(o.repo) });
    }
    if (o.plugins && o.plugins.length) repos = repos.filter((r) => o.plugins.includes(r.id));
    for (const r of repos) {
      const spec = await getJson(o.url, `/api/v1/plugins/${r.id}/_/openapi.json`, f);
      targets.push({ label: `plugin ${r.id}`, file: path.join(r.dir, 'api', 'openapi.json'), spec, optional: true });
    }
  } catch (e) {
    console.error(`openapi-snapshot: ${e.message}`);
    return 2;
  }

  let code = 0;
  for (const t of targets) {
    if (!t.spec) {
      if (t.optional) console.error(`skipped: ${t.label} (the instance serves no OpenAPI document for it; plugin stopped or without endpoints)`);
      else {
        console.error(`error: ${t.label} document not served`);
        code = 2;
      }
      continue;
    }
    const next = stableJson(t.spec);
    const exists = fs.existsSync(t.file);
    const current = exists ? fs.readFileSync(t.file, 'utf8') : null;
    const list = exists ? breaks(JSON.parse(current), t.spec, today) : [];
    for (const b of list) console.error(`break: ${t.label}: ${b}`);
    if (current === next) {
      console.error(`unchanged: ${t.label}`);
      continue;
    }
    if (o.check) {
      console.error(`${exists ? 'differs' : 'missing'}: ${t.label} snapshot ${t.file}`);
      code = Math.max(code, 1);
    } else if (o.write) {
      if (list.length && !o.allowBreaks) {
        console.error(`refused: ${t.label} has ${list.length} break(s); deprecate first or pass --allow-breaks`);
        code = Math.max(code, 1);
        continue;
      }
      fs.mkdirSync(path.dirname(t.file), { recursive: true });
      fs.writeFileSync(t.file, next);
      console.error(`wrote: ${t.label} -> ${t.file}`);
    }
  }
  return code;
}

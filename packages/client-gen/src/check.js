// check: compare a pulled directory with a running Pano (doc 06 §2.4). Exit 1 on removed / changed operations.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { shortHash } from './canonical.js'
import { ClientGenError } from './errors.js'
import { collectOperations, fingerprint } from './operations.js'
import { getText, isSafeName, parseJson, trimBase, unreachableMessage } from './http.js'

/**
 * @typedef {Object} CheckOptions
 * @property {string} url
 * @property {string} [dir]       default src/lib/pano
 * @property {string} [cwd]
 * @property {typeof fetch} [fetch]
 * @property {string | null} [installedCore]
 */

/**
 * @typedef {Object} CheckReport
 * @property {boolean} ok
 * @property {string[]} problems   removed / changed operations, removed plugins, changed controllers
 * @property {string[]} notes      additions and skipped parts (never fail the check)
 */

/** @param {any} doc @param {string} label @param {any} oldDoc @param {string[]} problems @param {string[]} notes */
function diffDocs(label, oldDoc, doc, problems, notes) {
  const before = new Map(collectOperations(oldDoc).map((o) => [o.name, o]))
  const after = new Map(collectOperations(doc).map((o) => [o.name, o]))
  for (const [name, op] of before) {
    const now = after.get(name)
    if (!now) problems.push(`${label}: removed ${name} (${op.method} ${op.path})`)
    else if (fingerprint(oldDoc, op) !== fingerprint(doc, now)) {
      const moved = now.method !== op.method || now.path !== op.path
      problems.push(`${label}: changed ${name} (${op.method} ${op.path}${moved ? ` -> ${now.method} ${now.path}` : ''})`)
    }
  }
  for (const [name, op] of after) if (!before.has(name)) notes.push(`${label}: new ${name} (${op.method} ${op.path})`)
}

/** @param {string} p */
function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

/**
 * @param {CheckOptions} options
 * @returns {Promise<CheckReport>}
 */
export async function check(options) {
  if (!options.url) throw new ClientGenError('check needs --url <pano>, e.g. --url http://localhost:8088')
  const base = trimBase(options.url)
  const cwd = resolve(options.cwd ?? process.cwd())
  const dir = resolve(cwd, options.dir ?? 'src/lib/pano')
  const fetchOpts = { fetch: options.fetch, onUnreachable: () => unreachableMessage(base) }
  /** @type {string[]} */
  const problems = []
  /** @type {string[]} */
  const notes = []

  if (!existsSync(join(dir, 'plugins', 'index.json')) && !existsSync(join(dir, 'core', 'openapi.json'))) {
    throw new ClientGenError(`Nothing to check in ${dir}. Run pano-client pull --url ${base} first.`)
  }

  // ---- core: the pulled snapshot, else the installed @panomc/client one
  const coreRes = await getText(`${base}/api/v1/openapi.json`, fetchOpts)
  if (!coreRes.ok) {
    throw new ClientGenError(`Pano answered ${coreRes.status} at ${base}/api/v1/openapi.json. Is this a Pano with the /api/v1 API?`)
  }
  const coreDoc = parseJson(coreRes.text, `${base}/api/v1/openapi.json`)
  let coreSnapshot = join(dir, 'core', 'openapi.json')
  if (!existsSync(coreSnapshot)) {
    let installed = options.installedCore
    if (installed === undefined) {
      try {
        installed = createRequire(join(cwd, 'package.json')).resolve('@panomc/client/core/openapi.json')
      } catch {
        installed = null
      }
    }
    coreSnapshot = installed ?? ''
  }
  if (coreSnapshot && existsSync(coreSnapshot)) diffDocs('core', readJson(coreSnapshot), coreDoc, problems, notes)
  else notes.push('core: no snapshot to compare with, skipped')

  // ---- plugins
  /** @type {Record<string, any>} */
  const index = existsSync(join(dir, 'plugins', 'index.json')) ? readJson(join(dir, 'plugins', 'index.json')) : {}
  /** @type {Map<string, any>} */
  const packages = new Map()
  const listRes = await getText(`${base}/api/v1/plugin-packages`, fetchOpts)
  if (listRes.ok) {
    const plugins = parseJson(listRes.text, `${base}/api/v1/plugin-packages`)?.plugins ?? {}
    for (const id of Object.keys(plugins)) packages.set(id, plugins[id] ?? {})
  } else {
    notes.push(`plugins: ${base}/api/v1/plugin-packages answered ${listRes.status}, plugins without a UI package are checked by their OpenAPI only`)
  }

  for (const ns of Object.keys(index).sort()) {
    const entry = index[ns]
    const pluginId = entry?.pluginId
    if (!isSafeName(ns) || !isSafeName(pluginId)) continue
    const id = encodeURIComponent(pluginId)
    const pkg = packages.get(pluginId)

    // OpenAPI
    const snapshot = join(dir, 'plugins', ns, 'openapi.json')
    const docRes = await getText(`${base}/api/v1/plugins/${id}/_/openapi.json`, fetchOpts)
    if (docRes.ok) {
      if (existsSync(snapshot)) diffDocs(ns, readJson(snapshot), parseJson(docRes.text, `${pluginId} openapi.json`), problems, notes)
      else problems.push(`${ns}: now ships an OpenAPI document (run pano-client pull)`)
    } else if (existsSync(snapshot)) {
      if (listRes.ok && !pkg) problems.push(`${ns}: plugin ${pluginId} is no longer active on this Pano (run pano-client pull)`)
      else problems.push(`${ns}: plugin ${pluginId} no longer ships an OpenAPI document (answered ${docRes.status}, run pano-client pull)`)
      continue
    } else if (listRes.ok && !pkg) {
      problems.push(`${ns}: plugin ${pluginId} is no longer active on this Pano (run pano-client pull)`)
      continue
    }

    // controllers
    if (entry.controllersHash || (pkg && pkg.controllers)) {
      let current = null
      if (pkg && pkg.controllers) {
        const mjs = await getText(`${base}/api/v1/plugins/${id}/_/ui/controllers/controllers.mjs`, fetchOpts)
        const types = await getText(`${base}/api/v1/plugins/${id}/_/ui/contract/controllers.types.js`, fetchOpts)
        if (mjs.ok) current = shortHash(mjs.text + '\0' + (types.ok ? types.text : ''))
      }
      if (current !== (entry.controllersHash ?? null)) {
        problems.push(`${ns}: controllers changed (run pano-client pull)`)
      }
    }
  }

  // plugins that appeared since the pull
  for (const [pluginId, pkg] of packages) {
    const ns = pkg && typeof pkg.namespace === 'string' && pkg.namespace ? pkg.namespace : pluginId.replace(/^pano-plugin-/, '')
    if (!index[ns]) notes.push(`${ns}: plugin ${pluginId} is active but was not pulled`)
  }

  return { ok: problems.length === 0, problems, notes }
}


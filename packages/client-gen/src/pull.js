// pull: core document + every active plugin's OpenAPI and controllers from a running Pano (doc 06 §2.4).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson, shortHash } from './canonical.js'
import { ClientGenError } from './errors.js'
import { generateClient } from './generate.js'
import { getText, isSafeName, namespaceOf, parseJson, trimBase, unreachableMessage } from './http.js'

/**
 * @typedef {Object} PullOptions
 * @property {string} url
 * @property {string} [out]            default src/lib/pano
 * @property {string[]} [plugins]      extra plugin ids that have no UI package
 * @property {string} [cwd]
 * @property {typeof fetch} [fetch]
 * @property {string | null} [installedCore]  path of the installed @panomc/client core/openapi.json; default: resolved from cwd
 * @property {(line: string) => void} [log]
 */

/**
 * @typedef {Object} PullReport
 * @property {'written'|'skipped'} core
 * @property {{ pluginId: string, ns: string, openapi: boolean, controllers: boolean }[]} plugins
 * @property {string[]} warnings
 */

/** @param {string} cwd */
function findInstalledCore(cwd) {
  try {
    return createRequire(join(cwd, 'package.json')).resolve('@panomc/client/core/openapi.json')
  } catch {
    return null
  }
}

/** @param {string} dir @param {Record<string, string>} files */
export function writeFiles(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

/**
 * @param {PullOptions} options
 * @returns {Promise<PullReport>}
 */
export async function pull(options) {
  if (!options.url) throw new ClientGenError('pull needs --url <pano>, e.g. --url http://localhost:8088')
  const base = trimBase(options.url)
  const cwd = resolve(options.cwd ?? process.cwd())
  const out = resolve(cwd, options.out ?? 'src/lib/pano')
  const log = options.log ?? (() => {})
  const fetchOpts = { fetch: options.fetch, onUnreachable: () => unreachableMessage(base) }
  /** @type {string[]} */
  const warnings = []
  const warn = (/** @type {string} */ m) => {
    warnings.push(m)
    log(`warning: ${m}`)
  }

  // ---- core
  const coreRes = await getText(`${base}/api/v1/openapi.json`, fetchOpts)
  if (!coreRes.ok) {
    throw new ClientGenError(`Pano answered ${coreRes.status} at ${base}/api/v1/openapi.json. Is this a Pano with the /api/v1 API?`)
  }
  const coreDoc = parseJson(coreRes.text, `${base}/api/v1/openapi.json`)
  const coreCanonical = canonicalJson(coreDoc)
  const installedPath = options.installedCore === undefined ? findInstalledCore(cwd) : options.installedCore
  let coreState = /** @type {'written'|'skipped'} */ ('written')
  if (installedPath && existsSync(installedPath) && readFileSync(installedPath, 'utf8') === coreCanonical) {
    coreState = 'skipped'
    log('core: matches the installed @panomc/client, import from @panomc/client/core')
  } else {
    const gen = generateClient(coreDoc)
    gen.warnings.forEach((w) => warn(`core: ${w}`))
    writeFiles(join(out, 'core'), gen.files)
    log(`core: ${gen.operations.length} operations written to ${join(out, 'core')}`)
  }

  // ---- plugin package list
  /** @type {Map<string, any>} */
  const packages = new Map()
  const listRes = await getText(`${base}/api/v1/plugin-packages`, fetchOpts)
  if (listRes.ok) {
    const list = parseJson(listRes.text, `${base}/api/v1/plugin-packages`)
    const plugins = list && typeof list.plugins === 'object' && list.plugins ? list.plugins : {}
    for (const id of Object.keys(plugins).sort()) packages.set(id, plugins[id] ?? {})
  } else {
    warn(`${base}/api/v1/plugin-packages answered ${listRes.status}; only plugins named with --plugin are pulled`)
  }
  for (const id of options.plugins ?? []) if (!packages.has(id)) packages.set(id, null)

  // ---- per plugin
  /** @type {Record<string, { pluginId: string, version: string | null, operationsHash: string | null, controllersHash: string | null }>} */
  const index = {}
  /** @type {PullReport['plugins']} */
  const reported = []
  const indexPath = join(out, 'plugins', 'index.json')
  /** @type {Record<string, any>} */
  let previous = {}
  try {
    previous = JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch {}

  for (const [pluginId, pkg] of packages) {
    if (!isSafeName(pluginId)) {
      warn(`plugin id "${pluginId}" is not a valid id, skipped`)
      continue
    }
    const ns = pkg && typeof pkg.namespace === 'string' && pkg.namespace ? pkg.namespace : namespaceOf(pluginId)
    if (!isSafeName(ns) || index[ns]) {
      warn(`plugin ${pluginId}: namespace "${ns}" is invalid or already taken, skipped`)
      continue
    }
    const id = encodeURIComponent(pluginId)
    const pluginDir = join(out, 'plugins', ns)

    // OpenAPI
    let operationsHash = null
    let openapi = false
    const docRes = await getText(`${base}/api/v1/plugins/${id}/_/openapi.json`, fetchOpts)
    if (docRes.ok) {
      const doc = parseJson(docRes.text, `${base}/api/v1/plugins/${pluginId}/_/openapi.json`)
      const gen = generateClient(doc)
      gen.warnings.forEach((w) => warn(`${ns}: ${w}`))
      writeFiles(pluginDir, gen.files)
      operationsHash = shortHash(gen.files['openapi.json'])
      openapi = true
      log(`${ns}: ${gen.operations.length} operations written to ${pluginDir}`)
    } else if (docRes.status === 404) {
      warn(`plugin ${pluginId} ships no OpenAPI (no client generated)`)
    } else {
      warn(`plugin ${pluginId}: ${base}/api/v1/plugins/${pluginId}/_/openapi.json answered ${docRes.status}, no client generated`)
    }

    // controllers
    let controllersHash = null
    let controllers = false
    if (pkg && pkg.controllers) {
      const mjs = await getText(`${base}/api/v1/plugins/${id}/_/ui/controllers/controllers.mjs`, fetchOpts)
      const types = await getText(`${base}/api/v1/plugins/${id}/_/ui/contract/controllers.types.js`, fetchOpts)
      if (mjs.ok) {
        /** @type {Record<string, string>} */
        const files = { 'controllers.mjs': mjs.text }
        if (types.ok) files['controllers.types.js'] = types.text
        else warn(`plugin ${pluginId}: controllers.types.js answered ${types.status}, controllers are copied without types`)
        writeFiles(join(pluginDir, 'controllers'), files)
        controllersHash = shortHash(mjs.text + '\0' + (types.ok ? types.text : ''))
        controllers = true
        log(`${ns}: controllers copied`)
      } else {
        warn(`plugin ${pluginId}: controllers.mjs answered ${mjs.status}, no controllers copied`)
      }
    }

    index[ns] = {
      pluginId,
      version: pkg && typeof pkg.version === 'string' ? pkg.version : null,
      operationsHash,
      controllersHash
    }
    reported.push({ pluginId, ns, openapi, controllers })
  }

  // generated folders of plugins that are gone (only those a previous pull recorded)
  for (const ns of Object.keys(previous)) {
    if (!index[ns] && isSafeName(ns)) rmSync(join(out, 'plugins', ns), { recursive: true, force: true })
  }

  const sorted = Object.fromEntries(Object.keys(index).sort().map((k) => [k, index[k]]))
  writeFiles(join(out, 'plugins'), { 'index.json': JSON.stringify(sorted, null, 2) + '\n' })
  log(`plugins: ${Object.keys(sorted).length} recorded in ${indexPath}`)

  return { core: coreState, plugins: reported, warnings }
}

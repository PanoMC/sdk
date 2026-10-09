// new: copy the starter template, write .env, bun install (doc 06 §2.4, §5.1).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { ClientGenError } from './errors.js'
import { trimBase } from './http.js'

/** Where the starter comes from when --from is not given. */
export const STARTER_TARBALL = 'https://codeload.github.com/PanoMC/pano-starter-sveltekit/tar.gz/refs/heads/main'

const SKIP = new Set(['node_modules', '.git', 'build', '.svelte-kit', '.DS_Store'])

/**
 * @typedef {Object} NewOptions
 * @property {string} dir
 * @property {string} [url]        Pano address; written to .env as API_URL=<url>/api
 * @property {string} [from]       local template directory (default: download the starter)
 * @property {boolean} [install]   run `bun install` (default true)
 * @property {string} [cwd]
 * @property {typeof fetch} [fetch]
 * @property {(dir: string) => { ok: boolean, message?: string }} [installer]  replaces the `bun install` call (tests)
 * @property {(line: string) => void} [log]
 */

/** @param {string} dir */
function isEmptyDir(dir) {
  return !existsSync(dir) || (statSync(dir).isDirectory() && readdirSync(dir).length === 0)
}

/** @param {string} url @param {typeof fetch | undefined} doFetch @returns {Promise<string>} directory with the extracted template */
async function downloadStarter(url, doFetch) {
  const tmp = mkdtempSync(join(tmpdir(), 'pano-starter-'))
  let res
  try {
    res = await (doFetch ?? globalThis.fetch)(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new ClientGenError(`Could not download the starter from ${url}. Check your connection or pass --from <dir>.`)
  }
  if (!res.ok) throw new ClientGenError(`Could not download the starter from ${url} (HTTP ${res.status}). Pass --from <dir> instead.`)
  const archive = join(tmp, 'starter.tar.gz')
  writeFileSync(archive, new Uint8Array(await res.arrayBuffer()))
  const extracted = join(tmp, 'tree')
  mkdirSync(extracted)
  const r = spawnSync('tar', ['-xzf', archive, '-C', extracted, '--strip-components=1'], { encoding: 'utf8' })
  if (r.status !== 0) throw new ClientGenError(`Could not unpack the starter archive: ${(r.stderr || r.error?.message || '').trim()}`)
  return extracted
}

/** @param {string} dir */
function defaultInstaller(dir) {
  const r = spawnSync('bun', ['install'], { cwd: dir, stdio: 'inherit' })
  if (r.error) return { ok: false, message: r.error.message }
  return { ok: r.status === 0, message: `exit code ${r.status}` }
}

/**
 * @param {NewOptions} options
 * @returns {Promise<{ dir: string, installed: boolean }>}
 */
export async function scaffold(options) {
  if (!options.dir) throw new ClientGenError('new needs a directory, e.g. pano-client new my-site')
  const cwd = resolve(options.cwd ?? process.cwd())
  const target = resolve(cwd, options.dir)
  const log = options.log ?? (() => {})
  if (!isEmptyDir(target)) throw new ClientGenError(`${target} already exists and is not empty.`)

  let source
  let cleanup = null
  if (options.from) {
    source = resolve(cwd, options.from)
    if (!existsSync(source) || !statSync(source).isDirectory()) throw new ClientGenError(`--from ${source} is not a directory.`)
  } else {
    source = await downloadStarter(process.env.PANO_STARTER_URL || STARTER_TARBALL, options.fetch)
    cleanup = join(source, '..')
  }

  try {
    mkdirSync(target, { recursive: true })
    cpSync(source, target, { recursive: true, filter: (src) => !SKIP.has(basename(src)) })
  } finally {
    if (cleanup) rmSync(cleanup, { recursive: true, force: true })
  }

  // package name from the folder
  const pkgPath = join(target, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+/, '')
      if (name) {
        pkg.name = name
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      }
    } catch {}
  }

  // .env from .env.example, API_URL from --url
  const examplePath = join(target, '.env.example')
  let env = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : 'API_URL=http://localhost:8088/api\n'
  if (options.url) {
    const apiUrl = `${trimBase(options.url).replace(/\/api$/, '')}/api`
    env = /^API_URL=.*$/m.test(env) ? env.replace(/^API_URL=.*$/m, `API_URL=${apiUrl}`) : `API_URL=${apiUrl}\n${env}`
  }
  if (!existsSync(join(target, '.env'))) writeFileSync(join(target, '.env'), env)
  log(`created ${target}`)

  let installed = false
  if (options.install !== false) {
    const r = (options.installer ?? defaultInstaller)(target)
    if (!r.ok) throw new ClientGenError(`bun install failed in ${target} (${r.message ?? 'unknown error'}). The project is created; run bun install there yourself.`)
    installed = true
  }
  return { dir: target, installed }
}

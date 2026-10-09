import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from './canonical.js'
import { generateClient } from './generate.js'
import { run } from './cli.js'
import { CLIENT_PKG, FIXTURE, TSC, tmp } from './test-helpers.js'

const GOLDEN = new URL('./golden/mini/', import.meta.url).pathname
const fixtureText = readFileSync(FIXTURE, 'utf8')
const fixture = JSON.parse(fixtureText)

/** @param {any} v @returns {any} same data, object keys in reverse order */
function reverseKeys(v) {
  if (Array.isArray(v)) return v.map(reverseKeys)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reverseKeys(v[k])]))
  return v
}

describe('generate: golden files for the fixture', () => {
  const gen = generateClient(fixtureText)

  test('the four files match src/golden/mini (UPDATE_GOLDEN=1 rewrites them)', () => {
    if (process.env.UPDATE_GOLDEN) {
      mkdirSync(GOLDEN, { recursive: true })
      for (const [name, content] of Object.entries(gen.files)) writeFileSync(join(GOLDEN, name), content)
    }
    expect(Object.keys(gen.files).sort()).toEqual(['index.js', 'openapi.json', 'operations.js', 'types.js'])
    expect(readdirSync(GOLDEN).sort()).toEqual(['index.js', 'openapi.json', 'operations.js', 'types.js'])
    for (const [name, content] of Object.entries(gen.files)) expect(content).toBe(readFileSync(join(GOLDEN, name), 'utf8'))
  })

  test('deterministic: a second run and a reordered document give the same bytes', () => {
    expect(generateClient(fixtureText).files).toEqual(gen.files)
    expect(generateClient(reverseKeys(fixture)).files).toEqual(gen.files)
    expect(gen.files['openapi.json']).toBe(canonicalJson(fixture))
    expect(Object.values(gen.files).join('')).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  test('mapping of doc 06 2.3', () => {
    const { 'index.js': index, 'types.js': types, 'operations.js': ops } = gen.files
    // function name = operationId with a lower-cased first letter, one function per operation
    expect(index).toContain('export const getPosts = (client, params) => client.request(operations.getPosts, params);')
    expect(ops).toContain("getPosts: { method: 'GET', path: '/api/v1/posts', auth: 'none', mutation: false }")
    expect(ops).toContain("createPost: { method: 'POST', path: '/api/v1/posts', auth: 'user', mutation: true }")
    // optional query -> optional params; sorted query keys
    expect(index).toContain('{ query?: { category?: string, page?: number, pageSize?: number }, signal?: AbortSignal }} [params]')
    // required body -> required params
    expect(index).toContain('{ body: import(\'./types.js\').CreatePostRequest, signal?: AbortSignal }} params')
    // deprecated
    expect(index).toMatch(/@deprecated\n \* @param \{import\('@panomc\/client'\)\.PanoClient\} client\n \* @param \{\{ body: import/)
    // multipart -> FormData, binary -> Blob, no content -> void
    expect(index).toContain('body?: FormData')
    expect(types).toContain('/** @typedef {Blob} GetApiV1ExportByKindResponse */')
    expect(types).toContain('/** @typedef {void} DeletePostResponse */')
    // object -> @typedef {Object} + @property, optional = [name]
    expect(types).toContain(' * @typedef {Object} Author')
    expect(types).toContain(' * @property {string | null} [avatar] Head image url.')
    expect(types).toContain(' * @property {number} id')
    // enum -> literal union, nullable -> |null, oneOf -> union, $ref -> name, arrays, additionalProperties
    expect(types).toContain("status: 'DRAFT' | 'PUBLISHED'")
    expect(types).toContain('image?: string | null')
    expect(types).toContain('body?: string | Author')
    expect(types).toContain('author: Author')
    expect(types).toContain('tags?: string[]')
    expect(types).toContain('meta?: Record<string, string>')
    expect(types).toContain("'x-extra'?: boolean")
    expect(types).toContain('/** @typedef {Author & { extra?: number }} Combined */')
    expect(types).toContain("/** @typedef {'UP' | 'DOWN'} Status */")
    expect(types.trimEnd().endsWith('export {};')).toBe(true)
    // x-pano-undocumented -> any
    expect(types).toContain('/** @typedef {any} GetLegacyThingResponse */')
    expect(index).toContain('{ query?: Record<string, any>, signal?: AbortSignal }} [params]')
  })

  test('operation without operationId: <method><PascalPath> and a warning', () => {
    expect(gen.warnings).toEqual(['GET /api/v1/export/{kind} has no operationId, using "getApiV1ExportByKind"'])
    expect(gen.files['operations.js']).toContain('getApiV1ExportByKind:')
  })

  test('a path parameter makes params required and typed', () => {
    expect(gen.files['index.js']).toContain('{ path: { url: string }, signal?: AbortSignal }} params')
  })
})

describe('generate: input errors', () => {
  test('not JSON / not OpenAPI', () => {
    expect(() => generateClient('{nope')).toThrow('The OpenAPI document is not valid JSON')
    expect(() => generateClient({ openapi: '3.1.0' })).toThrow('no "paths" object')
  })

  test('colliding names get a suffix and a warning, unknown refs become any', () => {
    const gen = generateClient({
      openapi: '3.1.0',
      paths: {
        '/a': { get: { operationId: 'Dup', responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Nope' } } } } } } },
        '/b': { get: { operationId: 'Dup', responses: { 200: { description: 'x' } } } },
        '/c': { get: { operationId: 'delete', responses: {} } }
      }
    })
    expect(gen.files['operations.js']).toContain('dup:')
    expect(gen.files['operations.js']).toContain('dup2:')
    expect(gen.files['operations.js']).toContain('deleteOperation:')
    expect(gen.warnings.some((w) => w.includes('unknown schema "Nope"'))).toBe(true)
  })
})

describe('generate: the output type checks', () => {
  /** @param {string[]} args @param {string} cwd */
  function tsc(args, cwd) {
    const r = Bun.spawnSync(['bun', TSC, ...args], { cwd })
    return (r.stdout.toString() + r.stderr.toString()).trim()
  }

  /** @param {string} dir */
  function layout(dir) {
    mkdirSync(join(dir, 'node_modules', '@panomc'), { recursive: true })
    symlinkSync(CLIENT_PKG, join(dir, 'node_modules', '@panomc', 'client'))
    const gen = generateClient(fixtureText)
    mkdirSync(join(dir, 'src', 'lib', 'pano', 'core'), { recursive: true })
    for (const [name, content] of Object.entries(gen.files)) writeFileSync(join(dir, 'src', 'lib', 'pano', 'core', name), content)
  }

  const flags = ['--noEmit', '--allowJs', '--checkJs', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', '--lib', 'es2022,dom', '--skipLibCheck']

  test('tsc --checkJs over the generated files', () => {
    const dir = tmp('tsc-out')
    try {
      layout(dir)
      const out = tsc([...flags, ...['index.js', 'types.js', 'operations.js'].map((f) => `src/lib/pano/core/${f}`)], dir)
      // errors inside @panomc/client itself are not the generator's; only the generated folder counts
      const mine = out.split('\n').filter((l) => l.startsWith('src/'))
      expect(mine).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a consumer with a plain jsconfig.json type checks, and a wrong call is rejected', () => {
    const dir = tmp('tsc-consumer')
    try {
      layout(dir)
      writeFileSync(
        join(dir, 'jsconfig.json'),
        JSON.stringify({
          compilerOptions: { checkJs: true, allowJs: true, noEmit: true, strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', lib: ['es2022', 'dom'], skipLibCheck: true },
          include: ['src']
        })
      )
      mkdirSync(join(dir, 'src', 'routes'), { recursive: true })
      writeFileSync(
        join(dir, 'src', 'routes', 'ok.js'),
        `import { createClient } from '@panomc/client'
import { getPosts, getPost, createPost, uploadAvatar, deletePost } from '../lib/pano/core/index.js'
import { operations } from '../lib/pano/core/operations.js'

/** @typedef {import('../lib/pano/core/types.js').Post} Post */

const client = createClient({ baseUrl: 'http://localhost:8088', csrf: 'off' })

export async function load() {
  const res = await getPosts(client, { query: { page: 1, category: 'news' } })
  if (!res.ok) return { code: res.error.code }
  /** @type {Post} */
  const first = res.data.items[0]
  const title = first.title.toUpperCase()
  const one = await getPost(client, { path: { url: 'hello' } })
  const created = await createPost(client, { body: { title: 'x' } })
  await uploadAvatar(client, { body: new FormData() })
  await deletePost(client, { path: { url: 'a' } })
  return { title, one, created, method: operations.getPosts.method }
}
`
      )
      expect(tsc(['-p', 'jsconfig.json'], dir).split('\n').filter((l) => l.startsWith('src/'))).toEqual([])

      writeFileSync(
        join(dir, 'src', 'routes', 'bad.js'),
        `import { createClient } from '@panomc/client'
import { getPost } from '../lib/pano/core/index.js'
const client = createClient({ baseUrl: 'http://localhost:8088' })
export const r = getPost(client, {})
export const q = getPost(client, { path: { url: 5 } })
`
      )
      const bad = tsc(['-p', 'jsconfig.json'], dir)
      expect(bad).toContain('src/routes/bad.js')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate command', () => {
  test('writes the four files and reports the warning on stderr', async () => {
    const dir = tmp('cmd')
    try {
      const errs = []
      const outs = []
      const code = await run(['generate', '--input', FIXTURE, '--out', join(dir, 'o')], { stdout: (s) => outs.push(s), stderr: (s) => errs.push(s) })
      expect(code).toBe(0)
      expect(readdirSync(join(dir, 'o')).sort()).toEqual(['index.js', 'openapi.json', 'operations.js', 'types.js'])
      expect(errs[0]).toContain('warning: GET /api/v1/export/{kind} has no operationId')
      expect(outs[0]).toContain('generated 7 operations')
      expect(await run(['generate'], { stderr: (s) => errs.push(s) })).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

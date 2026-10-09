import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson, shortHash } from './canonical.js'
import { check } from './check.js'
import { run } from './cli.js'
import { ClientGenError } from './errors.js'
import { pull } from './pull.js'
import { FIXTURE, tmp } from './test-helpers.js'

const core = JSON.parse(readFileSync(FIXTURE, 'utf8'))

const marketDoc = {
  openapi: '3.1.0',
  info: { title: 'market', version: '1' },
  servers: [{ url: '/api/plugins/pano-plugin-market' }],
  paths: {
    '/store/products': {
      get: { operationId: 'ListProducts', responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } } } } } } }
    },
    '/store/products/{id}': {
      get: { operationId: 'GetProduct', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } } } } } }
    }
  },
  components: { schemas: { Product: { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, name: { type: 'string' } } } } }
}

const extraDoc = {
  openapi: '3.1.0',
  servers: [{ url: '/api/plugins/pano-plugin-extra' }],
  paths: { '/ping': { get: { operationId: 'Ping', responses: { 200: { description: 'pong' } } } } }
}

/** the stub's world; tests mutate it */
function freshWorld() {
  return {
    core: structuredClone(core),
    packages: /** @type {Record<string, any>} */ ({
      'pano-plugin-market': { format: 1, pluginId: 'pano-plugin-market', namespace: 'market', version: '1.2.0', controllers: 'contract/controllers.json' },
      'pano-plugin-faq': { format: 1, pluginId: 'pano-plugin-faq', namespace: 'faq', version: '0.3.1' }
    }),
    docs: /** @type {Record<string, any>} */ ({ 'pano-plugin-market': structuredClone(marketDoc), 'pano-plugin-extra': extraDoc }),
    controllers: 'export const controllers = { cart: {} }\n',
    types: '/** @typedef {{ count: number }} CartState */\nexport {};\n',
    requests: /** @type {string[]} */ ([]),
    listBroken: false
  }
}

/** @type {ReturnType<typeof freshWorld>} */
let world
/** @type {any} */
let server
let base = ''
const dirs = []

beforeAll(() => {
  world = freshWorld()
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const path = new URL(req.url).pathname
      world.requests.push(path)
      const json = (/** @type {any} */ v) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })
      if (path === '/api/v1/openapi.json') return json(world.core)
      if (path === '/api/v1/plugin-packages') return world.listBroken ? new Response('nope', { status: 404 }) : json({ plugins: world.packages })
      const m = /^\/api\/v1\/plugins\/([^/]+)\/_\/(.+)$/.exec(path)
      if (m) {
        const [, id, rest] = m
        if (rest === 'openapi.json') return world.docs[id] ? json(world.docs[id]) : new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 })
        if (id === 'pano-plugin-market' && rest === 'ui/controllers/controllers.mjs') return new Response(world.controllers, { headers: { 'content-type': 'text/javascript' } })
        if (id === 'pano-plugin-market' && rest === 'ui/contract/controllers.types.js') return new Response(world.types)
      }
      return new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 })
    }
  })
  base = `http://127.0.0.1:${server.port}`
})
afterAll(() => {
  server.stop(true)
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const newDir = (/** @type {string} */ n) => {
  const d = tmp(n)
  dirs.push(d)
  return d
}

describe('pull', () => {
  test('core, both plugins, controllers and the index', async () => {
    world = Object.assign(world, freshWorld(), { requests: [] })
    const cwd = newDir('pull')
    const logs = []
    const report = await pull({ url: base + '/', cwd, installedCore: null, log: (l) => logs.push(l) })
    const out = join(cwd, 'src/lib/pano')

    expect(report.core).toBe('written')
    for (const f of ['index.js', 'types.js', 'operations.js', 'openapi.json']) {
      expect(existsSync(join(out, 'core', f))).toBe(true)
      expect(existsSync(join(out, 'plugins/market', f))).toBe(true)
    }
    expect(readFileSync(join(out, 'core/openapi.json'), 'utf8')).toBe(canonicalJson(core))
    expect(readFileSync(join(out, 'plugins/market/index.js'), 'utf8')).toContain('export const listProducts')
    expect(readFileSync(join(out, 'plugins/market/controllers/controllers.mjs'), 'utf8')).toBe(world.controllers)
    expect(readFileSync(join(out, 'plugins/market/controllers/controllers.types.js'), 'utf8')).toBe(world.types)

    // faq ships no OpenAPI: no folder, a warning, but it is recorded
    expect(existsSync(join(out, 'plugins/faq'))).toBe(false)
    expect(report.warnings).toContain('plugin pano-plugin-faq ships no OpenAPI (no client generated)')
    expect(logs).toContain('warning: plugin pano-plugin-faq ships no OpenAPI (no client generated)')

    const index = JSON.parse(readFileSync(join(out, 'plugins/index.json'), 'utf8'))
    expect(Object.keys(index)).toEqual(['faq', 'market'])
    expect(index.faq).toEqual({ pluginId: 'pano-plugin-faq', version: '0.3.1', operationsHash: null, controllersHash: null })
    expect(index.market).toEqual({
      pluginId: 'pano-plugin-market',
      version: '1.2.0',
      operationsHash: shortHash(canonicalJson(marketDoc)),
      controllersHash: shortHash(world.controllers + '\0' + world.types)
    })
    // the plugin documents were read from the plugin paths, the controllers from _/ui
    expect(world.requests).toContain('/api/v1/plugins/pano-plugin-market/_/openapi.json')
    expect(world.requests).toContain('/api/v1/plugins/pano-plugin-market/_/ui/controllers/controllers.mjs')
    expect(world.requests).toContain('/api/v1/plugins/pano-plugin-market/_/ui/contract/controllers.types.js')
  })

  test('a second pull writes identical bytes', async () => {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('pull2')
    await pull({ url: base, cwd, installedCore: null })
    const read = () => ['core/index.js', 'plugins/market/types.js', 'plugins/index.json'].map((f) => readFileSync(join(cwd, 'src/lib/pano', f), 'utf8'))
    const first = read()
    await pull({ url: base, cwd, installedCore: null })
    expect(read()).toEqual(first)
  })

  test('core/ is skipped when the installed @panomc/client snapshot is byte-equal', async () => {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('pull-skip')
    const installed = join(cwd, 'installed-openapi.json')
    writeFileSync(installed, canonicalJson(core))
    const report = await pull({ url: base, cwd, installedCore: installed })
    expect(report.core).toBe('skipped')
    expect(existsSync(join(cwd, 'src/lib/pano/core'))).toBe(false)
    expect(existsSync(join(cwd, 'src/lib/pano/plugins/market/index.js'))).toBe(true)

    writeFileSync(installed, canonicalJson({ ...core, info: { title: 'older', version: '0' } }))
    expect((await pull({ url: base, cwd, installedCore: installed })).core).toBe('written')
    expect(existsSync(join(cwd, 'src/lib/pano/core/index.js'))).toBe(true)
  })

  test('--plugin adds a plugin that is not in the package list; --out is honoured', async () => {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('pull-plugin')
    const report = await pull({ url: base, cwd, out: 'gen', plugins: ['pano-plugin-extra', 'pano-plugin-market'], installedCore: null })
    expect(report.plugins.map((p) => p.ns).sort()).toEqual(['extra', 'faq', 'market'])
    expect(readFileSync(join(cwd, 'gen/plugins/extra/index.js'), 'utf8')).toContain('export const ping')
    const index = JSON.parse(readFileSync(join(cwd, 'gen/plugins/index.json'), 'utf8'))
    expect(index.extra).toEqual({ pluginId: 'pano-plugin-extra', version: null, operationsHash: shortHash(canonicalJson(extraDoc)), controllersHash: null })
  })

  test('an extra plugin without OpenAPI warns and a plugin that left is removed on the next pull', async () => {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('pull-gone')
    await pull({ url: base, cwd, installedCore: null })
    expect(existsSync(join(cwd, 'src/lib/pano/plugins/market'))).toBe(true)
    delete world.packages['pano-plugin-market']
    const report = await pull({ url: base, cwd, installedCore: null, plugins: ['pano-plugin-ghost'] })
    expect(report.warnings).toContain('plugin pano-plugin-ghost ships no OpenAPI (no client generated)')
    expect(existsSync(join(cwd, 'src/lib/pano/plugins/market'))).toBe(false)
  })

  test('unsafe plugin ids are skipped', async () => {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('pull-unsafe')
    const report = await pull({ url: base, cwd, installedCore: null, plugins: ['../evil'] })
    expect(report.warnings.some((w) => w.includes('"../evil" is not a valid id'))).toBe(true)
    expect(existsSync(join(cwd, 'src/lib/evil'))).toBe(false)
  })

  test('a Pano without the package list still pulls core and named plugins', async () => {
    world = Object.assign(world, freshWorld(), { listBroken: true })
    const cwd = newDir('pull-nolist')
    const report = await pull({ url: base, cwd, installedCore: null, plugins: ['pano-plugin-extra'] })
    world.listBroken = false
    expect(report.warnings.some((w) => w.includes('/api/v1/plugin-packages answered 404'))).toBe(true)
    expect(report.plugins.map((p) => p.ns)).toEqual(['extra'])
  })

  test('unreachable Pano: the exact message', async () => {
    const dead = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('x') })
    const url = `http://127.0.0.1:${dead.port}`
    dead.stop(true)
    const cwd = newDir('pull-dead')
    await expect(pull({ url, cwd, installedCore: null })).rejects.toThrow(
      `Pano did not answer at ${url}/api/v1/openapi.json. Is it running? Try --url http://localhost:8088`
    )
    const errs = []
    const code = await run(['pull', '--url', url], { cwd, stderr: (s) => errs.push(s) })
    expect(code).toBe(1)
    expect(errs).toEqual([`Pano did not answer at ${url}/api/v1/openapi.json. Is it running? Try --url http://localhost:8088`])
    expect(existsSync(join(cwd, 'src'))).toBe(false)
  })

  test('missing --url', async () => {
    await expect(pull({ url: '' })).rejects.toBeInstanceOf(ClientGenError)
  })

  test('cli: pull with --plugin twice', async () => {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('pull-cli')
    const outs = []
    const code = await run(['pull', '--url', base, '--out', 'o', '--plugin', 'pano-plugin-extra', '--plugin', 'pano-plugin-ghost'], { cwd, stdout: (s) => outs.push(s), stderr: () => {} })
    expect(code).toBe(0)
    expect(existsSync(join(cwd, 'o/plugins/extra/index.js'))).toBe(true)
    expect(outs.some((l) => l.includes('plugin pano-plugin-ghost ships no OpenAPI (no client generated)'))).toBe(true)
  })
})

describe('check', () => {
  /** pulls the fresh world into a new dir and returns { cwd } */
  async function pulled() {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('check')
    await pull({ url: base, cwd, installedCore: null })
    return cwd
  }

  test('unchanged Pano: ok, exit 0', async () => {
    const cwd = await pulled()
    const report = await check({ url: base, cwd, installedCore: null })
    expect(report).toEqual({ ok: true, problems: [], notes: [] })
    const outs = []
    expect(await run(['check', '--url', base, '--dir', 'src/lib/pano'], { cwd, stdout: (s) => outs.push(s), stderr: () => {} })).toBe(0)
  })

  test('removed and changed operations, a new one is only a note', async () => {
    const cwd = await pulled()
    delete world.core.paths['/api/v1/posts/{url}'].delete
    world.core.paths['/api/v1/posts'].get.parameters.push({ name: 'q', in: 'query', schema: { type: 'string' } })
    world.core.components.schemas.Author.properties.nick = { type: 'string' } // changes GetPost / GetPosts / CreatePost responses
    world.core.paths['/api/v1/hello'] = { get: { operationId: 'Hello', responses: { 200: { description: 'hi' } } } }
    const report = await check({ url: base, cwd, installedCore: null })
    expect(report.ok).toBe(false)
    expect(report.problems).toEqual([
      'core: changed createPost (POST /api/v1/posts)',
      'core: removed deletePost (DELETE /api/v1/posts/{url})',
      'core: changed getPost (GET /api/v1/posts/{url})',
      'core: changed getPosts (GET /api/v1/posts)'
    ])
    expect(report.notes).toContain('core: new hello (GET /api/v1/hello)')

    const errs = []
    expect(await run(['check', '--url', base], { cwd, stdout: () => {}, stderr: (s) => errs.push(s) })).toBe(1)
    expect(errs).toContain('core: removed deletePost (DELETE /api/v1/posts/{url})')
    expect(errs.at(-1)).toBe('The generated client is out of date. Run pano-client pull.')
  })

  test('controllersHash differs -> run pano-client pull', async () => {
    const cwd = await pulled()
    world.controllers += '// new action\n'
    const report = await check({ url: base, cwd, installedCore: null })
    expect(report.ok).toBe(false)
    expect(report.problems).toEqual(['market: controllers changed (run pano-client pull)'])
  })

  test('plugin operation removed, and a plugin that is gone', async () => {
    const cwd = await pulled()
    delete world.docs['pano-plugin-market'].paths['/store/products']
    let report = await check({ url: base, cwd, installedCore: null })
    expect(report.problems).toEqual(['market: removed listProducts (GET /api/plugins/pano-plugin-market/store/products)'])

    delete world.packages['pano-plugin-market']
    delete world.docs['pano-plugin-market']
    report = await check({ url: base, cwd, installedCore: null })
    expect(report.problems).toEqual(['market: plugin pano-plugin-market is no longer active on this Pano (run pano-client pull)'])
  })

  test('core snapshot comes from the installed package when core/ was skipped', async () => {
    world = Object.assign(world, freshWorld())
    const cwd = newDir('check-installed')
    const installed = join(cwd, 'installed.json')
    writeFileSync(installed, canonicalJson(core))
    await pull({ url: base, cwd, installedCore: installed })
    expect((await check({ url: base, cwd, installedCore: installed })).ok).toBe(true)
    delete world.core.paths['/api/v1/posts/{url}'].delete
    expect((await check({ url: base, cwd, installedCore: installed })).problems).toEqual(['core: removed deletePost (DELETE /api/v1/posts/{url})'])
  })

  test('nothing pulled yet, and an unreachable Pano', async () => {
    const empty = newDir('check-empty')
    await expect(check({ url: base, cwd: empty })).rejects.toThrow(`Nothing to check in ${join(empty, 'src/lib/pano')}. Run pano-client pull --url ${base} first.`)
    const cwd = await pulled()
    const dead = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('x') })
    const url = `http://127.0.0.1:${dead.port}`
    dead.stop(true)
    await expect(check({ url, cwd, installedCore: null })).rejects.toThrow(`Pano did not answer at ${url}/api/v1/openapi.json. Is it running? Try --url http://localhost:8088`)
  })
})

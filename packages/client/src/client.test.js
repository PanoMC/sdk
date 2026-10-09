import { describe, expect, test } from 'bun:test'
import { createClient, unwrap, PanoApiError } from './index.js'

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })

/** fake fetch: handlers queue per "METHOD path", falls back to 200 {} ; records every call */
function fakeFetch(routes = {}) {
  const calls = []
  const fn = async (url, init = {}) => {
    const u = new URL(url, 'http://pano.test')
    const key = `${init.method || 'GET'} ${u.pathname}`
    calls.push({ key, url: String(url), method: init.method || 'GET', headers: { ...init.headers }, body: init.body, init })
    const handler = routes[key]
    const next = Array.isArray(handler) ? handler.shift() : handler
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(init)
    return next ?? json(200, {})
  }
  fn.calls = calls
  fn.count = (key) => calls.filter((c) => c.key === key).length
  return fn
}

const base = 'http://pano.test'
const POST = { method: 'POST', path: '/api/v1/things' }

describe('request building', () => {
  test('url, query, path params, accept and locale', async () => {
    const f = fakeFetch({ 'GET /api/v1/posts/a%20b': json(200, { items: [] }) })
    const c = createClient({ baseUrl: base + '/', fetch: f, locale: 'tr', csrf: 'off' })
    const r = await c.request(
      { method: 'GET', path: '/api/v1/posts/{slug}' },
      { path: { slug: 'a b' }, query: { page: 2, tag: ['x', 'y'], skip: undefined, none: null } }
    )
    expect(r).toEqual({ ok: true, status: 200, data: { items: [] } })
    expect(f.calls[0].url).toBe(`${base}/api/v1/posts/a%20b?page=2&tag=x&tag=y`)
    expect(f.calls[0].headers.Accept).toBe('application/json')
    expect(f.calls[0].headers['Accept-Language']).toBe('tr')
  })

  test('proxy prefix as baseUrl', async () => {
    const f = fakeFetch()
    await createClient({ baseUrl: '/pano', fetch: f, csrf: 'off' }).request({ method: 'GET', path: '/api/v1/posts' })
    expect(f.calls[0].url).toBe('/pano/api/v1/posts')
  })

  test('json body gets content-type, FormData passes through', async () => {
    const f = fakeFetch()
    const c = createClient({ baseUrl: base, fetch: f, csrf: 'off' })
    await c.request(POST, { body: { a: 1 } })
    expect(f.calls[0].body).toBe('{"a":1}')
    expect(f.calls[0].headers['Content-Type']).toBe('application/json')

    const form = new FormData()
    form.append('f', 'v')
    await c.request(POST, { body: form })
    expect(f.calls[1].body).toBe(form)
    expect(f.calls[1].headers['Content-Type']).toBeUndefined()
  })

  test('credentials default omit outside a browser, option wins, signal and headers pass', async () => {
    const f = fakeFetch()
    const ctl = new AbortController()
    await createClient({ baseUrl: base, fetch: f }).request(
      { method: 'GET', path: '/api/v1/x' },
      { signal: ctl.signal, headers: { 'X-Extra': '1' } }
    )
    expect(f.calls[0].init.credentials).toBe('omit')
    expect(f.calls[0].init.signal).toBe(ctl.signal)
    expect(f.calls[0].headers['X-Extra']).toBe('1')
    await createClient({ baseUrl: base, fetch: f, credentials: 'include', csrf: 'off' }).request({ method: 'GET', path: '/api/v1/x' })
    expect(f.calls[1].init.credentials).toBe('include')
  })

  test('204 and empty bodies give undefined data', async () => {
    const f = fakeFetch({ 'DELETE /api/v1/things': new Response(null, { status: 204 }) })
    const r = await createClient({ baseUrl: base, fetch: f, csrf: 'off' }).request({ method: 'DELETE', path: '/api/v1/things' })
    expect(r).toEqual({ ok: true, status: 204, data: undefined })
  })

  test('baseUrl is required', () => {
    expect(() => createClient({})).toThrow(TypeError)
  })
})

describe('front-end key, client IP, session token', () => {
  test('key and ip are sent together', async () => {
    const f = fakeFetch()
    await createClient({ baseUrl: base, fetch: f, frontendKey: 'pfk_1', clientIp: '203.0.113.9' }).request({ method: 'GET', path: '/api/v1/x' })
    expect(f.calls[0].headers['X-Pano-Frontend-Key']).toBe('pfk_1')
    expect(f.calls[0].headers['X-Pano-Client-Ip']).toBe('203.0.113.9')
  })

  test('ip without key is never sent, also not through per-request headers', async () => {
    const f = fakeFetch()
    const c = createClient({ baseUrl: base, fetch: f, clientIp: '203.0.113.9' })
    await c.request({ method: 'GET', path: '/api/v1/x' }, { headers: { 'x-pano-client-ip': '1.2.3.4', 'X-Pano-Frontend-Key': 'pfk_forged' } })
    const names = Object.keys(f.calls[0].headers).map((n) => n.toLowerCase())
    expect(names).not.toContain('x-pano-client-ip')
    expect(names).not.toContain('x-pano-frontend-key')
  })

  test('key without ip sends the key only', async () => {
    const f = fakeFetch()
    await createClient({ baseUrl: base, fetch: f, frontendKey: 'pfk_1' }).request({ method: 'GET', path: '/api/v1/x' })
    expect(f.calls[0].headers['X-Pano-Frontend-Key']).toBe('pfk_1')
    expect(f.calls[0].headers['X-Pano-Client-Ip']).toBeUndefined()
  })

  test('sessionToken string and (async) function become Bearer; null sends none', async () => {
    const f = fakeFetch()
    await createClient({ baseUrl: base, fetch: f, sessionToken: 'tok' }).request({ method: 'GET', path: '/api/v1/x' })
    expect(f.calls[0].headers.Authorization).toBe('Bearer tok')
    let n = 0
    const c = createClient({ baseUrl: base, fetch: f, sessionToken: async () => (n++ === 0 ? 'a' : null) })
    await c.request({ method: 'GET', path: '/api/v1/x' })
    await c.request({ method: 'GET', path: '/api/v1/x' })
    expect(f.calls[1].headers.Authorization).toBe('Bearer a')
    expect(f.calls[2].headers.Authorization).toBeUndefined()
  })

  test('a sessionToken turns csrf off by default', async () => {
    const f = fakeFetch()
    await createClient({ baseUrl: base, fetch: f, sessionToken: 'tok', credentials: 'include' }).request(POST, { body: {} })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(0)
  })
})

describe('errors', () => {
  test('envelope is parsed with message, details and fields', async () => {
    const f = fakeFetch({
      'POST /api/v1/things': json(400, { error: { code: 'INVALID_INPUT', message: 'bad', fields: { name: 'REQUIRED' }, details: { a: 1 } } })
    })
    const r = await createClient({ baseUrl: base, fetch: f, csrf: 'off' }).request(POST, { body: {} })
    expect(r).toEqual({ ok: false, status: 400, error: { code: 'INVALID_INPUT', message: 'bad', fields: { name: 'REQUIRED' }, details: { a: 1 } } })
  })

  test('a body that is not the envelope becomes HTTP_<status>', async () => {
    const f = fakeFetch({ 'GET /api/v1/x': new Response('<html>bad gateway</html>', { status: 502 }) })
    const r = await createClient({ baseUrl: base, fetch: f }).request({ method: 'GET', path: '/api/v1/x' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(502)
    expect(r.error.code).toBe('HTTP_502')
  })

  test('network failure does not throw', async () => {
    const f = fakeFetch({ 'GET /api/v1/x': new TypeError('fetch failed') })
    const r = await createClient({ baseUrl: base, fetch: f }).request({ method: 'GET', path: '/api/v1/x' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(0)
    expect(r.error.code).toBe('NETWORK_ERROR')
  })

  test('abort is a NETWORK_ERROR marked aborted', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const f = fakeFetch({ 'GET /api/v1/x': abort })
    const r = await createClient({ baseUrl: base, fetch: f }).request({ method: 'GET', path: '/api/v1/x' })
    expect(r.error.code).toBe('NETWORK_ERROR')
    expect(r.error.details).toEqual({ aborted: true })
  })

  test('missing fetch gives NETWORK_ERROR', async () => {
    const original = globalThis.fetch
    globalThis.fetch = undefined
    try {
      const r = await createClient({ baseUrl: base }).request({ method: 'GET', path: '/api/v1/x' })
      expect(r.error.code).toBe('NETWORK_ERROR')
    } finally {
      globalThis.fetch = original
    }
  })

  test('onUnauthorized fires on 401, its throw is swallowed', async () => {
    const f = fakeFetch({ 'GET /api/v1/me': json(401, { error: { code: 'NOT_LOGGED_IN' } }) })
    const seen = []
    const c = createClient({ baseUrl: base, fetch: f, onUnauthorized: (r) => { seen.push(r); throw new Error('boom') } })
    const r = await c.request({ method: 'GET', path: '/api/v1/me' })
    expect(r.status).toBe(401)
    expect(seen).toHaveLength(1)
    expect(seen[0].error.code).toBe('NOT_LOGGED_IN')
  })

  test('unwrap returns data or throws PanoApiError', async () => {
    expect(unwrap({ ok: true, status: 200, data: 5 })).toBe(5)
    try {
      unwrap({ ok: false, status: 422, error: { code: 'INVALID_INPUT', message: 'bad', fields: { a: 'X' } } })
      throw new Error('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(PanoApiError)
      expect(e.code).toBe('INVALID_INPUT')
      expect(e.status).toBe(422)
      expect(e.fields).toEqual({ a: 'X' })
      expect(e.message).toBe('bad')
    }
  })
})

describe('csrf auto', () => {
  const auto = (routes) => {
    const f = fakeFetch(routes)
    return { f, c: createClient({ baseUrl: base, fetch: f, credentials: 'include' }) }
  }

  test('probes before the first mutation, caches, sends X-CSRF-Token', async () => {
    const { f, c } = auto({ 'GET /api/v1/auth/csrf': json(200, { csrfToken: 'T1' }) })
    await c.request({ method: 'GET', path: '/api/v1/x' })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(0)
    await c.request(POST, { body: {} })
    await c.request({ method: 'PUT', path: '/api/v1/things/1' }, { body: {} })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(1)
    expect(f.calls[1].key).toBe('GET /api/v1/auth/csrf')
    expect(f.calls[2].headers['X-CSRF-Token']).toBe('T1')
    expect(f.calls[3].headers['X-CSRF-Token']).toBe('T1')
  })

  test('concurrent first mutations share one probe', async () => {
    const { f, c } = auto({ 'GET /api/v1/auth/csrf': json(200, { csrfToken: 'T1' }) })
    await Promise.all([c.request(POST, { body: {} }), c.request(POST, { body: {} })])
    expect(f.count('GET /api/v1/auth/csrf')).toBe(1)
  })

  test('401 on the probe: no header, no onUnauthorized, cached as none', async () => {
    const f = fakeFetch({ 'GET /api/v1/auth/csrf': json(401, { error: { code: 'NOT_LOGGED_IN' } }) })
    let unauthorized = 0
    const c = createClient({ baseUrl: base, fetch: f, credentials: 'include', onUnauthorized: () => unauthorized++ })
    const r = await c.request(POST, { body: {} })
    expect(r.ok).toBe(true)
    await c.request(POST, { body: {} })
    expect(unauthorized).toBe(0)
    expect(f.count('GET /api/v1/auth/csrf')).toBe(1)
    expect(f.calls[1].headers['X-CSRF-Token']).toBeUndefined()
    expect(f.calls[2].headers['X-CSRF-Token']).toBeUndefined()
  })

  test('null token (Bearer) means no header', async () => {
    const { f, c } = auto({ 'GET /api/v1/auth/csrf': json(200, { csrfToken: null }) })
    await c.request(POST, { body: {} })
    expect(f.calls[1].headers['X-CSRF-Token']).toBeUndefined()
  })

  test('a failed probe is not cached; the next mutation probes again', async () => {
    const { f, c } = auto({ 'GET /api/v1/auth/csrf': [new TypeError('down'), json(200, { csrfToken: 'T2' })] })
    await c.request(POST, { body: {} })
    await c.request(POST, { body: {} })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(2)
    expect(f.calls[3].headers['X-CSRF-Token']).toBe('T2')
  })

  test('a csrfToken in any response body replaces the cache', async () => {
    const { f, c } = auto({
      'GET /api/v1/auth/csrf': json(200, { csrfToken: 'T1' }),
      'GET /api/v1/me': json(200, { csrfToken: 'T9' })
    })
    await c.request(POST, { body: {} })
    await c.request({ method: 'GET', path: '/api/v1/me' })
    await c.request(POST, { body: {} })
    expect(f.calls.at(-1).headers['X-CSRF-Token']).toBe('T9')
    expect(f.count('GET /api/v1/auth/csrf')).toBe(1)
  })

  test('cleared after a successful /api/v1/auth/ mutation, then probed again', async () => {
    const { f, c } = auto({
      'GET /api/v1/auth/csrf': [json(200, { csrfToken: 'T1' }), json(401, { error: { code: 'NOT_LOGGED_IN' } })],
      'POST /api/v1/auth/logout': json(200, {})
    })
    await c.request({ method: 'POST', path: '/api/v1/auth/logout' }, { body: {} })
    expect(f.calls[1].headers['X-CSRF-Token']).toBe('T1')
    await c.request(POST, { body: {} })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(2)
    expect(f.calls.at(-1).headers['X-CSRF-Token']).toBeUndefined()
  })

  test('a login body token is kept after the clear', async () => {
    const { f, c } = auto({
      'GET /api/v1/auth/csrf': json(401, { error: { code: 'NOT_LOGGED_IN' } }),
      'POST /api/v1/auth/login': json(200, { csrfToken: 'L1' })
    })
    await c.request({ method: 'POST', path: '/api/v1/auth/login' }, { body: {} })
    await c.request(POST, { body: {} })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(1)
    expect(f.calls.at(-1).headers['X-CSRF-Token']).toBe('L1')
  })

  test('a failed /auth/ mutation does not clear', async () => {
    const { f, c } = auto({
      'GET /api/v1/auth/csrf': json(200, { csrfToken: 'T1' }),
      'POST /api/v1/auth/login': json(400, { error: { code: 'WRONG_PASSWORD' } })
    })
    await c.request({ method: 'POST', path: '/api/v1/auth/login' }, { body: {} })
    await c.request(POST, { body: {} })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(1)
  })

  test('INVALID_CSRF_TOKEN: clear, refetch, retry exactly once', async () => {
    const invalid = () => json(403, { error: { code: 'INVALID_CSRF_TOKEN' } })
    const { f, c } = auto({
      'GET /api/v1/auth/csrf': [json(200, { csrfToken: 'OLD' }), json(200, { csrfToken: 'NEW' })],
      'POST /api/v1/things': [invalid(), json(200, { done: true })]
    })
    const r = await c.request(POST, { body: { a: 1 } })
    expect(r).toEqual({ ok: true, status: 200, data: { done: true } })
    const posts = f.calls.filter((x) => x.key === 'POST /api/v1/things')
    expect(posts.map((p) => p.headers['X-CSRF-Token'])).toEqual(['OLD', 'NEW'])
    expect(posts[1].body).toBe('{"a":1}')
  })

  test('a second INVALID_CSRF_TOKEN is returned, no third attempt', async () => {
    const invalid = () => json(403, { error: { code: 'INVALID_CSRF_TOKEN' } })
    const { f, c } = auto({
      'GET /api/v1/auth/csrf': () => json(200, { csrfToken: 'T' }),
      'POST /api/v1/things': [invalid(), invalid(), invalid()]
    })
    const r = await c.request(POST, { body: {} })
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('INVALID_CSRF_TOKEN')
    expect(f.count('POST /api/v1/things')).toBe(2)
  })

  test('GET never probes and never sends the header', async () => {
    const { f, c } = auto({})
    await c.request({ method: 'GET', path: '/api/v1/x' })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].headers['X-CSRF-Token']).toBeUndefined()
  })
})

describe('csrf off', () => {
  test('never calls the endpoint, even on INVALID_CSRF_TOKEN', async () => {
    const f = fakeFetch({ 'POST /api/v1/things': json(403, { error: { code: 'INVALID_CSRF_TOKEN' } }) })
    const c = createClient({ baseUrl: base, fetch: f, credentials: 'include', csrf: 'off' })
    const r = await c.request(POST, { body: {} })
    expect(r.error.code).toBe('INVALID_CSRF_TOKEN')
    expect(f.calls).toHaveLength(1)
    expect(f.count('GET /api/v1/auth/csrf')).toBe(0)
    expect(f.calls[0].headers['X-CSRF-Token']).toBeUndefined()
  })

  test('omit credentials defaults to off', async () => {
    const f = fakeFetch()
    await createClient({ baseUrl: base, fetch: f, credentials: 'omit' }).request(POST, { body: {} })
    expect(f.count('GET /api/v1/auth/csrf')).toBe(0)
  })
})

import { PanoApiError, failure, failureFromBody } from './errors.js'

/** @typedef {import('./types.js').PanoClientOptions} PanoClientOptions */
/** @typedef {import('./types.js').PanoClient} PanoClient */
/** @typedef {import('./types.js').PanoOperation} PanoOperation */
/** @typedef {import('./types.js').RequestParams} RequestParams */
/** @typedef {import('./types.js').ApiFailure} ApiFailure */
/** @template T @typedef {import('./types.js').ApiResult<T>} ApiResult */

const CSRF_PATH = '/api/v1/auth/csrf'
const AUTH_PREFIX = '/api/v1/auth/'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** @param {any} body */
function isRawBody(body) {
  return (
    typeof body === 'string' ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  )
}

/** @param {string} path @param {Record<string, any>|undefined} values */
function fillPath(path, values) {
  return path.replace(/\{([^}]+)\}/g, (whole, name) => {
    const value = values?.[name]
    return value === undefined || value === null ? whole : encodeURIComponent(String(value))
  })
}

/** @param {Record<string, any>|undefined} query */
function queryString(query) {
  if (!query) return ''
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue
      search.append(key, item instanceof Date ? item.toISOString() : String(item))
    }
  }

  const text = search.toString()
  return text ? `?${text}` : ''
}

/** @param {Response} response */
async function readBody(response) {
  if (response.status === 204 || response.status === 205) return undefined

  const text = await response.text()
  if (!text) return undefined

  const type = response.headers.get('content-type') || ''
  if (type.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

/**
 * @param {PanoClientOptions} options
 * @returns {PanoClient}
 */
export function createClient(options) {
  if (!options || typeof options.baseUrl !== 'string') {
    throw new TypeError('createClient: options.baseUrl is required (Pano origin or proxy prefix, e.g. "/pano")')
  }

  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'
  const credentials = options.credentials ?? (inBrowser ? 'include' : 'omit')
  const csrfMode = options.csrf ?? (credentials === 'include' && !options.sessionToken ? 'auto' : 'off')

  /**
   * CSRF cache. `undefined` = unknown, `null` = probed and there is none (anonymous or Bearer), string = token.
   * @type {string|null|undefined}
   */
  let csrfToken
  /** @type {Promise<void>|null} */
  let probing = null

  /** @param {Record<string, string>|undefined} extra */
  async function buildHeaders(extra) {
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json' }

    if (options.locale) headers['Accept-Language'] = options.locale

    if (options.frontendKey) {
      headers['X-Pano-Frontend-Key'] = options.frontendKey
      if (options.clientIp) headers['X-Pano-Client-Ip'] = options.clientIp
    }

    const token = typeof options.sessionToken === 'function' ? await options.sessionToken() : options.sessionToken
    if (token) headers.Authorization = `Bearer ${token}`

    if (extra) {
      for (const [name, value] of Object.entries(extra)) {
        if (value === undefined || value === null) continue
        const lower = name.toLowerCase()
        // The key and the visitor IP travel together or not at all: a per-request header cannot add one without the other.
        if (lower === 'x-pano-frontend-key' || lower === 'x-pano-client-ip') continue
        headers[name] = value
      }
    }

    return headers
  }

  /**
   * One fetch with the shared error handling. Never throws.
   * @param {string} method
   * @param {string} path resolved path, starting with "/api/v1/"
   * @param {string} search
   * @param {Record<string, string>} headers
   * @param {any} body
   * @param {AbortSignal|undefined} signal
   * @returns {Promise<{ result: ApiResult<any> }>}
   */
  async function send(method, path, search, headers, body, signal) {
    const fetchImpl = options.fetch ?? globalThis.fetch

    if (typeof fetchImpl !== 'function') {
      return { result: failure(0, 'NETWORK_ERROR', { message: 'No fetch implementation available' }) }
    }

    /** @type {RequestInit} */
    const init = { method, headers, credentials }
    if (body !== undefined) init.body = body
    if (signal) init.signal = signal

    try {
      const response = await fetchImpl(`${baseUrl}${path}${search}`, init)
      const parsed = await readBody(response)

      if (response.ok) {
        return { result: { ok: true, status: response.status, data: parsed } }
      }

      return { result: failureFromBody(response.status, parsed) }
    } catch (error) {
      const aborted = /** @type {any} */ (error)?.name === 'AbortError'
      return {
        result: failure(0, 'NETWORK_ERROR', {
          message: error instanceof Error ? error.message : 'Network request failed',
          ...(aborted ? { details: { aborted: true } } : {})
        })
      }
    }
  }

  /** @param {any} data */
  function adoptToken(data) {
    if (data && typeof data === 'object' && typeof data.csrfToken === 'string') csrfToken = data.csrfToken
  }

  /** GET /auth/csrf once at a time. Never reports to onUnauthorized. */
  function probe() {
    if (!probing) {
      probing = (async () => {
        try {
          const headers = await buildHeaders(undefined)
          const { result } = await send('GET', CSRF_PATH, '', headers, undefined, undefined)

          if (result.ok) {
            const token = result.data?.csrfToken
            csrfToken = typeof token === 'string' ? token : null
          } else if (result.status === 401) {
            csrfToken = null
          }
          // any other failure (network, 5xx): stay unknown, the next mutation probes again
        } finally {
          probing = null
        }
      })()
    }

    return probing
  }

  /**
   * @param {PanoOperation} operation
   * @param {RequestParams} [params]
   * @returns {Promise<ApiResult<any>>}
   */
  async function request(operation, params = {}) {
    try {
      const method = String(operation.method).toUpperCase()
      const path = fillPath(operation.path, params.path)
      const search = queryString(params.query)
      const mutation = !SAFE_METHODS.has(method)
      const useCsrf = csrfMode === 'auto' && mutation && path !== CSRF_PATH

      let body = params.body
      let jsonBody = false
      if (body !== undefined && body !== null && !isRawBody(body)) {
        body = JSON.stringify(body)
        jsonBody = true
      } else if (body === null) {
        body = undefined
      }

      /** @param {string|null|undefined} token */
      const attempt = async (token) => {
        const headers = await buildHeaders(params.headers)
        if (jsonBody && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json'
        }
        if (token) headers['X-CSRF-Token'] = token
        return send(method, path, search, headers, body, params.signal)
      }

      if (useCsrf && csrfToken === undefined) await probe()

      let { result } = await attempt(useCsrf ? csrfToken : undefined)

      if (useCsrf && !result.ok && result.error.code === 'INVALID_CSRF_TOKEN') {
        csrfToken = undefined
        await probe()

        if (csrfToken) {
          ;({ result } = await attempt(csrfToken))
        }
      }

      if (result.ok) {
        if (mutation && path.startsWith(AUTH_PREFIX)) csrfToken = undefined
        adoptToken(result.data)
      } else if (result.status === 401 && options.onUnauthorized) {
        try {
          options.onUnauthorized(result)
        } catch {
          // a throwing callback must not turn a failed request into a rejected promise
        }
      }

      return result
    } catch (error) {
      return failure(0, 'NETWORK_ERROR', {
        message: error instanceof Error ? error.message : 'Request failed before it was sent'
      })
    }
  }

  return { request, options: Object.freeze({ ...options }) }
}

/**
 * The data of a successful result, or a thrown PanoApiError.
 * @template T
 * @param {ApiResult<T>} result
 * @returns {T}
 */
export function unwrap(result) {
  if (result.ok) return result.data
  throw new PanoApiError(result)
}

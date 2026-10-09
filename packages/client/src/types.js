// Shared JSDoc typedefs for @panomc/client. No runtime code.

/**
 * @typedef {Object} ApiErrorBody
 * @property {string} code               machine readable, e.g. NETWORK_ERROR, INVALID_CSRF_TOKEN, NOT_LOGGED_IN
 * @property {string} [message]
 * @property {Record<string, any>} [details]
 * @property {Record<string, string>} [fields]   field name -> error code (validation errors)
 */

/**
 * @typedef {Object} ApiFailure
 * @property {false} ok
 * @property {number} status             HTTP status, 0 when no response arrived
 * @property {ApiErrorBody} error
 */

/**
 * @template T
 * @typedef {{ ok: true, status: number, data: T } | ApiFailure} ApiResult
 */

/**
 * @typedef {Object} PanoClientOptions
 * @property {string} baseUrl            what precedes "/api/v1": Pano's origin, or a proxy prefix such as "/pano"
 * @property {typeof fetch} [fetch]      default globalThis.fetch
 * @property {string} [frontendKey]      server only; X-Pano-Frontend-Key
 * @property {string|(() => string|null|Promise<string|null>)} [sessionToken]  Authorization: Bearer
 * @property {string} [clientIp]         X-Pano-Client-Ip; sent only with frontendKey
 * @property {string} [locale]           Accept-Language
 * @property {'include'|'omit'} [credentials]  default 'include' in a browser, 'omit' elsewhere
 * @property {'auto'|'off'} [csrf]       default 'auto' with credentials 'include' and no sessionToken, else 'off'
 * @property {(result: ApiFailure) => void} [onUnauthorized]
 */

/**
 * An operation as found in a generated operations.js, or the escape hatch `{ method, path }`.
 * `path` may hold `{name}` placeholders filled from `params.path`.
 * @typedef {Object} PanoOperation
 * @property {string} method
 * @property {string} path
 * @property {'none'|'user'} [auth]
 * @property {boolean} [mutation]
 */

/**
 * @typedef {Object} RequestParams
 * @property {Record<string, string|number|boolean>} [path]   values for {placeholders}
 * @property {Record<string, any>} [query]                    undefined / null are skipped, arrays repeat the key
 * @property {any} [body]                                     FormData and other raw bodies pass through, the rest is JSON
 * @property {Record<string, string>} [headers]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} PanoClient
 * @property {<T = any>(operation: PanoOperation, params?: RequestParams) => Promise<ApiResult<T>>} request
 * @property {Readonly<PanoClientOptions>} options
 */

export {};

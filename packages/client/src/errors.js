/** Thrown only by `unwrap`; the client itself never throws for an HTTP or network failure. */
export class PanoApiError extends Error {
  /**
   * @param {import('./types.js').ApiFailure} failure
   */
  constructor(failure) {
    const error = failure?.error ?? { code: 'UNKNOWN' }
    super(error.message || error.code)
    this.name = 'PanoApiError'
    /** @type {string} */
    this.code = error.code
    /** @type {number} */
    this.status = failure?.status ?? 0
    /** @type {Record<string, string>} */
    this.fields = error.fields ?? {}
    /** @type {Record<string, any>|undefined} */
    this.details = error.details
    /** @type {import('./types.js').ApiFailure} */
    this.result = failure
  }
}

/**
 * @param {number} status
 * @param {string} code
 * @param {Partial<import('./types.js').ApiErrorBody>} [rest]
 * @returns {import('./types.js').ApiFailure}
 */
export function failure(status, code, rest = {}) {
  return { ok: false, status, error: { ...rest, code } }
}

/**
 * Builds an ApiFailure from a non-2xx response body: the `{ error: { code, message?, details?, fields? } }` envelope,
 * or a fallback `HTTP_<status>` when the body is not that.
 * @param {number} status
 * @param {any} body parsed body (object, string or undefined)
 * @returns {import('./types.js').ApiFailure}
 */
export function failureFromBody(status, body) {
  const e = body && typeof body === 'object' ? body.error : undefined

  if (e && typeof e === 'object' && typeof e.code === 'string') {
    /** @type {import('./types.js').ApiErrorBody} */
    const error = { code: e.code }
    if (typeof e.message === 'string') error.message = e.message
    if (e.details && typeof e.details === 'object') error.details = e.details
    if (e.fields && typeof e.fields === 'object') error.fields = e.fields
    return { ok: false, status, error }
  }

  const failed = failure(status, `HTTP_${status}`)
  if (typeof body === 'string' && body) failed.error.message = body.slice(0, 500)
  return failed
}

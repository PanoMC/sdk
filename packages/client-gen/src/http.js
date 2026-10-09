import { ClientGenError } from './errors.js'

/**
 * @typedef {Object} Fetched
 * @property {number} status
 * @property {boolean} ok
 * @property {string} text
 */

/** @param {string} url */
export function trimBase(url) {
  return String(url).trim().replace(/\/+$/, '')
}

/**
 * GET a URL as text. A network failure throws `onUnreachable()`'s message; any HTTP status is returned.
 * @param {string} url
 * @param {{ fetch?: typeof fetch, onUnreachable: () => string }} opts
 * @returns {Promise<Fetched>}
 */
export async function getText(url, opts) {
  const doFetch = opts.fetch ?? globalThis.fetch
  let res
  try {
    res = await doFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000), redirect: 'follow' })
  } catch {
    throw new ClientGenError(opts.onUnreachable())
  }
  let text = ''
  try {
    text = await res.text()
  } catch {
    throw new ClientGenError(opts.onUnreachable())
  }
  return { status: res.status, ok: res.ok, text }
}

/** @param {string} base */
export const unreachableMessage = (base) =>
  `Pano did not answer at ${base}/api/v1/openapi.json. Is it running? Try --url http://localhost:8088`

/**
 * @param {string} text
 * @param {string} what
 */
export function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new ClientGenError(`${what} is not valid JSON.`)
  }
}

/** Plugin ids and namespaces end up in URLs and file names. @param {string} s */
export const isSafeName = (s) => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && !s.includes('..')

/** Namespace rule of doc 01: the id minus a leading `pano-plugin-`. @param {string} pluginId */
export const namespaceOf = (pluginId) => (pluginId.startsWith('pano-plugin-') ? pluginId.slice('pano-plugin-'.length) : pluginId)

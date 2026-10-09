import { createHash } from 'node:crypto'

/**
 * Deep copy with every object's keys sorted. Arrays keep their order.
 * @param {any} value
 * @returns {any}
 */
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key])
    return out
  }
  return value
}

/**
 * The one text form of an OpenAPI document: sorted keys, two spaces, trailing newline.
 * Generated `openapi.json` files and the byte comparison of `pull` / `check` use it.
 * @param {any} doc
 */
export function canonicalJson(doc) {
  return JSON.stringify(sortKeys(doc), null, 2) + '\n'
}

/** @param {string|Uint8Array} data */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** Short stable fingerprint used in `plugins/index.json`. @param {string|Uint8Array} data */
export function shortHash(data) {
  return sha256(data).slice(0, 16)
}

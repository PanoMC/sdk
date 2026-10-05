const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes the five HTML special characters.
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Shallow copy of `values` with string values HTML-escaped; other values are untouched.
 * A non-object yields `{}`.
 * @param {unknown} values
 * @returns {Record<string, unknown>}
 */
export function escapeValues(values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) return {};

  const out = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = typeof v === 'string' ? escapeHtml(v) : v;
  }
  return out;
}

// Reads the operations of an OpenAPI document: names, parameters, bodies, responses, fingerprints.
import { canonicalJson } from './canonical.js'

export const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch']

const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static',
  'implements', 'interface', 'package', 'private', 'protected', 'public', 'arguments', 'eval', 'operations'
])

/** @param {string} s */
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
/** @param {string} s */
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/** `get-posts`, `get_posts`, `GetPosts` -> `GetPosts` / `GetPosts` @param {string} s */
export function pascal(s) {
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean)
  return parts.map(upperFirst).join('')
}

/** Name for an operation without operationId: `<method><PascalPath>`. @param {string} method @param {string} path */
export function fallbackId(method, path) {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      const m = /^\{(.+)\}$/.exec(seg)
      return m ? 'By' + pascal(m[1]) : pascal(seg)
    })
  return method.toLowerCase() + segments.join('')
}

/**
 * @param {any} doc
 * @param {string} ref
 */
function resolveRef(doc, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined
  let node = doc
  for (const part of ref.slice(2).split('/')) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return node
}

/** Follows a single level of `$ref` for parameters, request bodies and responses. @param {any} doc @param {any} node */
function deref(doc, node) {
  let n = node
  for (let i = 0; i < 8 && n && typeof n === 'object' && typeof n.$ref === 'string'; i++) n = resolveRef(doc, n.$ref)
  return n
}

/**
 * @typedef {Object} Operation
 * @property {string} id            operationId (or the generated fallback)
 * @property {string} name          function name in index.js
 * @property {string} method        upper case
 * @property {string} path         the request path: server prefix plus `docPath`
 * @property {string} docPath       the key in `paths`
 * @property {'none'|'user'} auth
 * @property {boolean} mutation
 * @property {boolean} deprecated
 * @property {boolean} undocumented
 * @property {string} summary
 * @property {string} description
 * @property {{ name: string, in: string, required: boolean, schema: any, description: string }[]} parameters
 * @property {{ required: boolean, kind: 'json'|'form'|'other', schema: any } | null} body
 * @property {{ kind: 'void'|'json'|'text'|'blob', schema: any }} response
 * @property {any} raw
 */

/** @param {any} security */
function authOf(security) {
  if (!Array.isArray(security) || security.length === 0) return 'none'
  return security.some((s) => s && typeof s === 'object' && Object.keys(s).length === 0) ? 'none' : 'user'
}

/**
 * The path part of the first usable server (`/api/plugins/pano-plugin-market`, `/api/v1`), without a trailing slash;
 * `''` for none, `/` or an absolute URL without a path. An operation's `servers` wins over its path item's, and
 * that over the document's (OpenAPI 3.1).
 * @param {any} servers
 */
export function serverPrefix(servers) {
  const first = Array.isArray(servers) ? servers.find((s) => s && typeof s.url === 'string') : undefined
  if (!first) return ''
  let url = first.url
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(url)
  if (absolute) url = url.slice(absolute[0].length)
  return url.startsWith('/') ? url.replace(/\/+$/, '') : ''
}

/** The request path of an operation: the server prefix plus the document path (not doubled when already there). */
function joinServerPath(prefix, path) {
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path
  return `${prefix}${path}`
}

/**
 * Collects every operation of the document, sorted by function name.
 * @param {any} doc
 * @param {(message: string) => void} [warn]
 * @returns {Operation[]}
 */
export function collectOperations(doc, warn = () => {}) {
  /** @type {Operation[]} */
  const list = []
  const paths = doc && typeof doc.paths === 'object' && doc.paths ? doc.paths : {}

  for (const path of Object.keys(paths).sort()) {
    const item = paths[path]
    if (!item || typeof item !== 'object') continue
    for (const method of METHODS) {
      const raw = item[method]
      if (!raw || typeof raw !== 'object') continue

      let id = typeof raw.operationId === 'string' && raw.operationId ? raw.operationId : ''
      if (!id) {
        id = fallbackId(method, path)
        warn(`${method.toUpperCase()} ${path} has no operationId, using "${id}"`)
      }

      let name = lowerFirst(id.includes('-') || id.includes('_') || id.includes(' ') || id.includes('.') ? pascal(id) : id.replace(/[^A-Za-z0-9_$]/g, ''))
      if (!name || /^[0-9]/.test(name)) name = 'op' + upperFirst(name)
      if (RESERVED.has(name)) name += 'Operation'

      /** @type {Map<string, any>} */
      const params = new Map()
      for (const p of [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(raw.parameters) ? raw.parameters : [])]) {
        const r = deref(doc, p)
        if (r && typeof r === 'object' && typeof r.name === 'string') params.set(`${r.in}:${r.name}`, r)
      }
      const parameters = [...params.values()]
        .filter((p) => p.in === 'path' || p.in === 'query')
        .map((p) => ({
          name: p.name,
          in: p.in,
          required: p.in === 'path' ? true : p.required === true,
          schema: p.schema ?? (p.content?.['application/json']?.schema ?? {}),
          description: typeof p.description === 'string' ? p.description : ''
        }))
      // placeholders in the path that the document forgot to declare
      for (const m of path.matchAll(/\{([^}]+)\}/g)) {
        if (!parameters.some((p) => p.in === 'path' && p.name === m[1])) {
          parameters.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' }, description: '' })
        }
      }
      parameters.sort((a, b) => (a.in === b.in ? a.name.localeCompare(b.name) : a.in === 'path' ? -1 : 1))

      const undocumented = raw['x-pano-undocumented'] === true || raw['x-pano-undocumented'] === 'true'

      /** @type {Operation['body']} */
      let body = null
      const rb = deref(doc, raw.requestBody)
      if (rb && typeof rb === 'object') {
        const content = rb.content && typeof rb.content === 'object' ? rb.content : {}
        const jsonKey = Object.keys(content).find((k) => /^application\/(.+\+)?json/.test(k))
        const formKey = Object.keys(content).find((k) => k.startsWith('multipart/form-data'))
        if (jsonKey) body = { required: rb.required === true, kind: 'json', schema: content[jsonKey].schema ?? {} }
        else if (formKey) body = { required: rb.required === true, kind: 'form', schema: null }
        else body = { required: rb.required === true, kind: 'other', schema: null }
      }

      /** @type {Operation['response']} */
      let response = { kind: 'void', schema: null }
      const responses = raw.responses && typeof raw.responses === 'object' ? raw.responses : {}
      const okKey = Object.keys(responses).filter((k) => /^2/.test(k)).sort()[0]
      if (okKey !== undefined) {
        const r = deref(doc, responses[okKey])
        const content = r && typeof r.content === 'object' && r.content ? r.content : {}
        const keys = Object.keys(content)
        const jsonKey = keys.find((k) => /^application\/(.+\+)?json/.test(k))
        if (jsonKey) response = { kind: 'json', schema: content[jsonKey].schema ?? {} }
        else if (keys.some((k) => k.startsWith('text/'))) response = { kind: 'text', schema: null }
        else if (keys.length) response = { kind: 'blob', schema: null }
      } else if (Object.keys(responses).length) {
        response = { kind: 'json', schema: {} }
      }

      list.push({
        id,
        name,
        method: method.toUpperCase(),
        path: joinServerPath(serverPrefix(raw.servers ?? item.servers ?? doc.servers), path),
        docPath: path,
        auth: authOf(raw.security !== undefined ? raw.security : doc.security),
        mutation: !['get', 'head', 'options'].includes(method),
        deprecated: raw.deprecated === true,
        undocumented,
        summary: typeof raw.summary === 'string' ? raw.summary : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        parameters,
        body,
        response,
        raw
      })
    }
  }

  // unique function names, deterministic: the later one in (path, method) order gets a number
  const used = new Set()
  for (const op of list) {
    let name = op.name
    for (let n = 2; used.has(name); n++) name = `${op.name}${n}`
    if (name !== op.name) warn(`${op.method} ${op.path}: operation name "${op.name}" is taken, using "${name}"`)
    op.name = name
    used.add(name)
  }
  return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Operation object with every `$ref` replaced by its target (cycles stay as `$ref`), canonical text.
 * Two documents with the same fingerprint for an operation describe the same request and response types.
 * @param {any} doc
 * @param {Operation} op
 */
export function fingerprint(doc, op) {
  /** @param {any} node @param {string[]} stack @returns {any} */
  const inline = (node, stack) => {
    if (Array.isArray(node)) return node.map((n) => inline(n, stack))
    if (!node || typeof node !== 'object') return node
    if (typeof node.$ref === 'string') {
      if (stack.includes(node.$ref)) return { $ref: node.$ref }
      const target = resolveRef(doc, node.$ref)
      return target === undefined ? { $ref: node.$ref } : inline(target, [...stack, node.$ref])
    }
    /** @type {Record<string, any>} */
    const out = {}
    for (const k of Object.keys(node)) out[k] = inline(node[k], stack)
    return out
  }
  const pathItem = doc.paths?.[op.docPath ?? op.path] ?? {}
  return canonicalJson({
    method: op.method,
    path: op.path,
    pathParameters: inline(pathItem.parameters ?? [], []),
    operation: inline(op.raw, [])
  })
}

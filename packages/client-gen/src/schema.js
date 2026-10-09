// OpenAPI 3.1 schema -> JSDoc type string. A plain walk over the JSON, no dependency.

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** @param {string} s */
export const isIdent = (s) => IDENT.test(s)

/** Property key as it appears in an object type literal. @param {string} s */
export const propKey = (s) => (isIdent(s) ? s : quote(s))

/** @param {string} s */
export function quote(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`
}

/**
 * Precedence of a rendered type: 0 union, 1 intersection, 2 atom (needs no parentheses anywhere).
 * @typedef {{ s: string, p: number }} Rendered
 */

/** @param {Rendered} r @param {number} min */
const at = (r, min) => (r.p < min ? `(${r.s})` : r.s)

/** @param {string} s @returns {Rendered} */
const atom = (s) => ({ s, p: 2 })

/** @param {Rendered[]} parts @returns {Rendered} */
function union(parts) {
  const seen = new Set()
  const out = []
  for (const part of parts) {
    if (seen.has(part.s)) continue
    seen.add(part.s)
    out.push(part)
  }
  if (out.length === 0) return atom('never')
  if (out.length === 1) return out[0]
  if (out.some((p) => p.s === 'any')) return atom('any')
  return { s: out.map((p) => at(p, 0)).join(' | '), p: 0 }
}

/** @param {Rendered[]} parts @returns {Rendered} */
function intersection(parts) {
  if (parts.length === 1) return parts[0]
  if (parts.length === 0) return atom('any')
  return { s: parts.map((p) => at(p, 1)).join(' & '), p: 1 }
}

/** @param {any} v */
function literal(v) {
  if (typeof v === 'string') return quote(v)
  if (v === null) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return 'any'
}

/**
 * @typedef {Object} TypeContext
 * @property {(schemaName: string) => string} ref   how a components.schemas entry is named at the call site
 */

/**
 * @param {any} schema
 * @param {TypeContext} ctx
 * @returns {string}
 */
export function schemaType(schema, ctx) {
  return render(schema, ctx).s
}

/**
 * @param {any} schema
 * @param {TypeContext} ctx
 * @returns {Rendered}
 */
function render(schema, ctx) {
  if (schema === false) return atom('never')
  if (schema === true || schema === null || typeof schema !== 'object') return atom('any')

  if (typeof schema.$ref === 'string') {
    const m = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref)
    if (!m) return atom('any')
    const name = m[1].replace(/~1/g, '/').replace(/~0/g, '~')
    const r = atom(ctx.ref(name))
    return schema.nullable === true ? union([r, atom('null')]) : r
  }

  let out = renderBody(schema, ctx)
  if (schema.nullable === true) out = union([out, atom('null')])
  return out
}

/** @param {any} schema @param {TypeContext} ctx @returns {Rendered} */
function renderBody(schema, ctx) {
  if ('const' in schema) return atom(literal(schema.const))
  if (Array.isArray(schema.enum)) return union(schema.enum.map((v) => atom(literal(v))))

  /** @type {Rendered[]} */
  const parts = []
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    parts.push(intersection(schema.allOf.map((/** @type {any} */ s) => render(s, ctx))))
  }
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key]) && schema[key].length) {
      parts.push(union(schema[key].map((/** @type {any} */ s) => render(s, ctx))))
    }
  }

  const hasShape = schema.type !== undefined || schema.properties || schema.additionalProperties !== undefined || schema.items
  if (hasShape || parts.length === 0) {
    const own = renderTyped(schema, ctx)
    // allOf/oneOf next to a bare `type: object` adds nothing; keep the composed part alone
    if (!(parts.length && own.s === 'Record<string, any>' && !schema.properties)) parts.push(own)
  }
  return intersection(parts)
}

/** @param {any} schema @param {TypeContext} ctx @returns {Rendered} */
function renderTyped(schema, ctx) {
  /** @type {string[]} */
  let types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length === 0) {
    if (schema.properties || schema.additionalProperties !== undefined) types = ['object']
    else if (schema.items) types = ['array']
    else return atom('any')
  }
  return union(types.map((t) => renderOne(t, schema, ctx)))
}

/** @param {string} type @param {any} schema @param {TypeContext} ctx @returns {Rendered} */
function renderOne(type, schema, ctx) {
  switch (type) {
    case 'string':
      return atom(schema.format === 'binary' ? 'Blob' : 'string')
    case 'integer':
    case 'number':
      return atom('number')
    case 'boolean':
      return atom('boolean')
    case 'null':
      return atom('null')
    case 'array':
      return atom(`${at(schema.items === undefined ? atom('any') : render(schema.items, ctx), 2)}[]`)
    case 'object':
      return renderObject(schema, ctx)
    default:
      return atom('any')
  }
}

/** @param {any} schema @param {TypeContext} ctx @returns {Rendered} */
function renderObject(schema, ctx) {
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const names = Object.keys(props)
  const extra = schema.additionalProperties
  const extraType =
    extra === undefined || extra === false
      ? null
      : extra === true
        ? atom('any')
        : render(extra, ctx)

  if (names.length === 0) return atom(`Record<string, ${extraType ? extraType.s : 'any'}>`)

  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  const body = names
    .map((n) => `${propKey(n)}${required.has(n) ? '' : '?'}: ${render(props[n], ctx).s}`)
    .join(', ')
  const literalType = atom(`{ ${body} }`)
  return extraType ? intersection([literalType, atom(`Record<string, ${extraType.s}>`)]) : literalType
}

/**
 * Names, types and descriptions of an object schema's properties when every name is a plain identifier,
 * so the typedef can use `@property`. Null otherwise (the caller falls back to the inline literal).
 * @param {any} schema
 * @param {TypeContext} ctx
 * @returns {{ name: string, type: string, optional: boolean, description: string }[] | null}
 */
export function objectProperties(schema, ctx) {
  if (!schema || typeof schema !== 'object' || schema.$ref) return null
  if (schema.allOf || schema.oneOf || schema.anyOf || schema.enum || 'const' in schema || schema.nullable === true) return null
  if (schema.type !== undefined && schema.type !== 'object') return null
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) return null
  const props = schema.properties
  if (!props || typeof props !== 'object') return null
  const names = Object.keys(props)
  if (names.length === 0 || !names.every(isIdent)) return null
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return names.map((name) => ({
    name,
    type: render(props[name], ctx).s,
    optional: !required.has(name),
    description: oneLine(props[name] && typeof props[name] === 'object' ? props[name].description : '')
  }))
}

/** Collapse text to one comment-safe line. @param {any} text */
export function oneLine(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/\*\//g, '*\\/').replace(/\s+/g, ' ').trim()
}

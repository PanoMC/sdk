// api-compat: the additive-only promise of doc 04 section 6, as a diff of two OpenAPI documents.
// `breaks(oldSpec, newSpec, today)` returns one message per break; an empty list means compatible.

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const DAY = /^\d{4}-\d{2}-\d{2}/;

/** @param {any} spec @param {any} node */
function deref(spec, node, depth = 0) {
  if (!node || typeof node !== 'object' || !node.$ref || depth > 12) return node;
  const ref = String(node.$ref);
  if (!ref.startsWith('#/')) return node;
  let cur = spec;
  for (const part of ref.slice(2).split('/')) cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  return deref(spec, cur, depth + 1);
}

/**
 * Resolves `$ref` and flattens `allOf` into one object-ish schema.
 * @param {any} spec @param {any} node
 */
function flatten(spec, node, depth = 0) {
  node = deref(spec, node);
  if (!node || typeof node !== 'object' || depth > 12) return node || {};
  if (!Array.isArray(node.allOf)) return node;
  const merged = { ...node };
  delete merged.allOf;
  for (const part of node.allOf) {
    const f = flatten(spec, part, depth + 1);
    merged.properties = { ...(f.properties || {}), ...(merged.properties || {}) };
    merged.required = [...new Set([...(f.required || []), ...(merged.required || [])])];
    if (f.type && !merged.type) merged.type = f.type;
    if (f.items && !merged.items) merged.items = f.items;
  }
  return merged;
}

const typesOf = (s) => (s && s.type ? [].concat(s.type).sort().join('|') : null);

/**
 * Response side: nothing a client reads may disappear or change type.
 * @returns {string[]}
 */
function responseBreaks(oldSpec, newSpec, a, b, at, seen = new Set(), depth = 0) {
  a = flatten(oldSpec, a);
  b = flatten(newSpec, b);
  if (!a || !b || depth > 10) return [];
  const key = `${at}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const out = [];
  const ta = typesOf(a);
  const tb = typesOf(b);
  if (ta && tb && ta !== tb) {
    // integer -> number widening still breaks typed clients; report every change
    out.push(`${at}: type changed from ${ta} to ${tb}`);
    return out;
  }
  if (ta && !tb && !b.oneOf && !b.anyOf) out.push(`${at}: type ${ta} was removed`);
  if (a.properties) {
    for (const [name, sub] of Object.entries(a.properties)) {
      if (!b.properties || !(name in b.properties)) {
        if (b.properties || tb === 'object') out.push(`${at}.${name}: response property was removed`);
        continue;
      }
      out.push(...responseBreaks(oldSpec, newSpec, sub, b.properties[name], `${at}.${name}`, seen, depth + 1));
    }
  }
  if (a.items && b.items) out.push(...responseBreaks(oldSpec, newSpec, a.items, b.items, `${at}[]`, seen, depth + 1));
  return out;
}

/** Request side: no field may become required. */
function requestBreaks(oldSpec, newSpec, a, b, at, depth = 0) {
  a = flatten(oldSpec, a);
  b = flatten(newSpec, b);
  if (!b || depth > 10) return [];
  const out = [];
  const ra = new Set((a && a.required) || []);
  for (const name of b.required || []) {
    if (!ra.has(name)) out.push(`${at}.${name}: request property became required`);
  }
  const ta = typesOf(a);
  const tb = typesOf(b);
  if (ta && tb && ta !== tb) out.push(`${at}: request type changed from ${ta} to ${tb}`);
  if (a && a.properties && b.properties) {
    for (const [name, sub] of Object.entries(a.properties)) {
      if (name in b.properties) out.push(...requestBreaks(oldSpec, newSpec, sub, b.properties[name], `${at}.${name}`, depth + 1));
    }
  }
  return out;
}

const jsonSchemaOf = (spec, holder) => {
  const content = deref(spec, holder)?.content;
  if (!content) return undefined;
  const entry = content['application/json'] || Object.values(content)[0];
  return entry && entry.schema;
};

const paramKey = (p) => `${p.in}:${p.name}`;

/** Months between two ISO dates, fractional ignored. */
function addMonths(iso, months) {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Compares a committed spec with a fresh one.
 * @param {any} oldSpec the snapshot
 * @param {any} newSpec what the running Pano serves
 * @param {string} today ISO date; a deprecated operation may disappear once its `x-pano-removal` is before it
 * @returns {string[]}
 */
export function breaks(oldSpec, newSpec, today) {
  const out = [];
  const oldPaths = (oldSpec && oldSpec.paths) || {};
  const newPaths = (newSpec && newSpec.paths) || {};
  for (const [p, oldItem] of Object.entries(oldPaths)) {
    for (const method of METHODS) {
      const oldOp = oldItem[method];
      if (!oldOp) continue;
      const id = `${method.toUpperCase()} ${p}`;
      if (oldOp['x-pano-stability'] === 'internal') continue; // internal operations carry no promise
      const newOp = newPaths[p] && newPaths[p][method];
      if (!newOp) {
        const removal = oldOp['x-pano-removal'];
        if (oldOp.deprecated === true && typeof removal === 'string' && DAY.test(removal) && removal.slice(0, 10) < today) continue;
        out.push(
          oldOp.deprecated === true && removal
            ? `${id}: removed before its removal date ${removal}`
            : `${id}: operation was removed${oldOp.deprecated ? ' (deprecated without x-pano-removal)' : ' without being deprecated'}`,
        );
        continue;
      }
      // parameters
      const oldParams = new Map(((oldOp.parameters || oldItem.parameters || []).map((x) => deref(oldSpec, x))).map((x) => [paramKey(x), x]));
      for (const raw of newOp.parameters || newItem(newPaths, p).parameters || []) {
        const np = deref(newSpec, raw);
        const op = oldParams.get(paramKey(np));
        if (!op) {
          if (np.required) out.push(`${id}: new required ${np.in} parameter "${np.name}"`);
        } else {
          if (!op.required && np.required) out.push(`${id}: ${np.in} parameter "${np.name}" became required`);
          const ta = typesOf(flatten(oldSpec, op.schema));
          const tb = typesOf(flatten(newSpec, np.schema));
          if (ta && tb && ta !== tb) out.push(`${id}: ${np.in} parameter "${np.name}" changed type from ${ta} to ${tb}`);
        }
      }
      // request body
      const rbNew = deref(newSpec, newOp.requestBody);
      if (rbNew) {
        const rbOld = deref(oldSpec, oldOp.requestBody);
        if (rbNew.required && !(rbOld && rbOld.required)) out.push(`${id}: request body became required`);
        const sNew = jsonSchemaOf(newSpec, rbNew);
        if (sNew) out.push(...requestBreaks(oldSpec, newSpec, jsonSchemaOf(oldSpec, rbOld), sNew, `${id} request`).map((m) => m));
      }
      // responses
      for (const [status, oldRes] of Object.entries(oldOp.responses || {})) {
        const newRes = (newOp.responses || {})[status];
        if (!newRes) {
          out.push(`${id}: response ${status} was removed`);
          continue;
        }
        const so = jsonSchemaOf(oldSpec, oldRes);
        const sn = jsonSchemaOf(newSpec, newRes);
        if (so && sn) out.push(...responseBreaks(oldSpec, newSpec, so, sn, `${id} ${status}`));
        else if (so && !sn) out.push(`${id}: response ${status} lost its body schema`);
      }
    }
  }
  // the deprecation floor: removal at least 6 months after the deprecating release
  for (const [p, item] of Object.entries(newPaths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op || op.deprecated !== true) continue;
      const removal = op['x-pano-removal'];
      const since = op['x-pano-deprecated-on'];
      if (typeof removal === 'string' && typeof since === 'string' && DAY.test(removal) && DAY.test(since) && removal.slice(0, 10) < addMonths(since, 6)) {
        out.push(`${method.toUpperCase()} ${p}: x-pano-removal ${removal} is less than 6 months after x-pano-deprecated-on ${since}`);
      }
    }
  }
  return out;
}

function newItem(paths, p) {
  return paths[p] || {};
}

/**
 * CLI entry: `api-compat <old.json> <new.json> [--today YYYY-MM-DD]`.
 * @param {{ oldFile: string, newFile: string, today?: string }} o
 * @param {(p: string) => any} read
 * @returns {number}
 */
export function runApiCompat(o, read) {
  const today = o.today || new Date().toISOString().slice(0, 10);
  const list = breaks(read(o.oldFile), read(o.newFile), today);
  for (const b of list) console.error(`break: ${b}`);
  console.error(`api-compat: ${list.length} break(s)`);
  return list.length ? 1 : 0;
}

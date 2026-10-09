// Scanning of JS / Svelte sources for the codemod and check-paths: API path literals, API client names,
// and the old->new client path mapping. Regex based on purpose (Svelte markup is not valid JS).
import { segments, applyRenames } from './rename-table.mjs';
import { escapeRe, lineIndex } from './util.mjs';

/**
 * Index of the closing quote of the JS literal that opens at `q`, or -1 (unterminated on its line for quotes).
 * @param {string} src @param {number} q
 */
export function literalEnd(src, q) {
  const quote = src[q];
  let j = q + 1;
  if (quote === '`') {
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') j += 2;
      else if (c === '`') return j;
      else if (c === '$' && src[j + 1] === '{') {
        let depth = 0;
        for (; j < src.length; j++) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}' && --depth === 0) break;
        }
        j++;
      } else j++;
    }
    return -1;
  }
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === quote) return j;
    else if (c === '\n') return -1;
    else j++;
  }
  return -1;
}

/**
 * Index of the paren closing the one at `open`, skipping strings, templates and comments.
 * @param {string} src @param {number} open
 */
export function matchParenJs(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const e = literalEnd(src, i);
      if (e === -1) return -1;
      i = e;
    } else if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      if (e === -1) return -1;
      i = e;
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e === -1) return -1;
      i = e + 1;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

const CONTEXTS = [
  { kind: 'path', re: /\bpath\s*:\s*(['"`])/g },
  { kind: 'url', re: /\b(?:src|href|action|poster)\s*=\s*\{?\s*(['"`])/g },
  { kind: 'url', re: /\bfetch\s*\(\s*(['"`])/g },
  { kind: 'url', re: /\bnew\s+(?:WebSocket|EventSource)\s*\(\s*(['"`])/g },
];

/**
 * Finds the API path literals of a source: `path:` values (relative to /api/v1 after the cutover) and raw URL
 * strings (`src=`, `href=`, `fetch`, WebSocket).
 * @param {string} src
 * @returns {{ kind: 'path' | 'url', start: number, end: number, content: string }[]}
 */
export function findPathLiterals(src) {
  const out = [];
  for (const { kind, re } of CONTEXTS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const q = m.index + m[0].length - 1;
      const e = literalEnd(src, q);
      if (e === -1) continue;
      out.push({ kind, start: q + 1, end: e, content: src.slice(q + 1, e) });
    }
  }
  const seen = new Set();
  return out
    .sort((a, b) => a.start - b.start)
    .filter((l) => (seen.has(l.start) ? false : (seen.add(l.start), true)));
}

/** `<prefix>/api<rest>` of a legacy URL; the prefix is empty or an origin / template hole. */
export const LEGACY_URL = /^((?:\$\{[^}]*\}|(?:https?|wss?):\/\/[^/'"`?#\s]*)?)(\/(?:panel\/)?api)(?=\/|$|\?|#)/;

/**
 * Splits a path tail (query / hash) off, ignoring `?` inside template holes.
 * @param {string} s @returns {[string, string]}
 */
export function splitTail(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$' && s[i + 1] === '{') depth++;
    else if (s[i] === '}' && depth) depth--;
    else if (depth === 0 && (s[i] === '?' || s[i] === '#')) return [s.slice(0, i), s.slice(i)];
  }
  return [s, ''];
}

/**
 * @typedef {{ method?: string, old: string, new: string, relative: string, class?: string, file?: string }} PathPair
 */

/**
 * Maps an old client path (the part after `/api`) to its path relative to /api/v1.
 * Order: the repository's own old->new pairs, the core rename table, then the `--strip` plugin segment.
 * @param {string} oldRest e.g. `/panel/plugins/search`, `/market/store/products/${id}`
 * @param {{ pairs?: PathPair[], strip?: string | null, pluginId?: string | null }} ctx
 * @returns {{ path: string, how: 'pair' | 'core' | 'strip' | 'generic' }}
 */
export function mapClientPath(oldRest, ctx) {
  const exact = mapExactPath(oldRest, ctx);
  if (exact.how !== 'generic') return exact;
  // `/staff/config${query}`: the text after the matched path stays where it is
  const last = segments(oldRest).pop() ?? '';
  const tail = /^([^$/]+)(\$\{.*)$/.exec(last);
  if (tail) {
    const base = mapExactPath(oldRest.slice(0, oldRest.length - tail[2].length), ctx);
    if (base.how !== 'generic') return { path: base.path + tail[2], how: base.how };
  }
  return exact;
}

/**
 * A client path segment against a route segment: a segment with a `${...}` hole fits only a route parameter
 * (a hole is a value, so `/staff/${id}` is never the fixed route `/staff/config`).
 * @param {string} lit @param {string} pat
 */
const fitsSegment = (lit, pat) => (pat.startsWith(':') ? lit.length > 0 : !lit.includes('${') && lit === pat);

/** @param {string} oldRest @param {{ pairs?: PathPair[], strip?: string | null, pluginId?: string | null }} ctx */
function mapExactPath(oldRest, ctx) {
  const lit = segments(oldRest);
  let best = null;
  let bestScore = -1;
  for (const pair of ctx.pairs || []) {
    const pat = segments(pair.old.replace(/^\/api/, ''));
    if (pat.length !== lit.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < pat.length; i++) {
      if (!fitsSegment(lit[i], pat[i])) {
        ok = false;
        break;
      }
      if (!pat[i].startsWith(':') && lit[i] === pat[i]) score++;
    }
    if (ok && score > bestScore) {
      best = pair;
      bestScore = score;
    }
  }
  if (best) {
    const pat = segments(best.old.replace(/^\/api/, ''));
    const names = {};
    pat.forEach((s, i) => {
      if (s.startsWith(':')) names[s] = lit[i];
    });
    const out = segments(best.relative).map((s) => (s.startsWith(':') ? names[s] ?? s : s));
    return { path: '/' + out.join('/'), how: 'pair' };
  }
  const renamed = applyRenames(oldRest, fitsSegment);
  if (renamed.renamed) return { path: renamed.path, how: 'core' };
  if (ctx.strip && ctx.pluginId) {
    if (lit[0] === 'panel' && lit[1] === ctx.strip) return { path: '/' + ['plugins', ctx.pluginId, 'panel', ...lit.slice(2)].join('/'), how: 'strip' };
    if (lit[0] === ctx.strip) return { path: '/' + ['plugins', ctx.pluginId, ...lit.slice(1)].join('/'), how: 'strip' };
  }
  return { path: oldRest || '/', how: 'generic' };
}

/**
 * A path of a plugin's own endpoints (`/plugins/<id>/...`, not core's `/plugins/<id>/_/...`): unversioned, so a full
 * URL for it starts with `/api`, not `/api/v1` (decision 81).
 * @param {string} rel
 */
export const isPluginOwnPath = (rel) => /^\/plugins\/[^/]+\/(?!_(?:\/|$))[^/]/.test(rel);

/** `/api/plugins/<id>/...` is the final form of a plugin's own URL (decision 81), not a legacy path. */
export const isMigratedPluginUrl = (content) => /^(?:\$\{[^}]*\}|(?:https?|wss?):\/\/[^/'"`?#\s]*)?\/api\/plugins\/[^/?#]+/.test(content);

/**
 * Rewrites the legacy path literals of a source (step e of migrate-v1).
 * @param {string} src
 * @param {{ pairs?: PathPair[], strip?: string | null, pluginId?: string | null }} ctx
 * @returns {{ text: string, count: number, generic: string[] }}
 */
export function rewritePathLiterals(src, ctx) {
  let out = '';
  let at = 0;
  let count = 0;
  const generic = [];
  for (const lit of findPathLiterals(src)) {
    const m = LEGACY_URL.exec(lit.content);
    if (!m) continue;
    if (lit.kind === 'path' && m[1]) continue;
    const rest = lit.content.slice(m[0].length);
    if (rest === '/v1' || rest.startsWith('/v1/') || rest.startsWith('/v1?')) continue;
    if (isMigratedPluginUrl(lit.content)) continue;
    const [pathPart, tail] = splitTail(rest);
    const mapped = mapClientPath(pathPart, ctx);
    if (mapped.how === 'generic' && pathPart) generic.push(lit.content);
    const rel = mapped.path === '/' ? '' : mapped.path;
    const next = lit.kind === 'path' ? `${m[1]}${rel || '/'}${tail}` : `${m[1]}${isPluginOwnPath(rel) ? '/api' : '/api/v1'}${rel}${tail}`;
    out += src.slice(at, lit.start) + next;
    at = lit.end;
    count++;
  }
  return { text: out + src.slice(at), count, generic };
}

/**
 * Names under which API clients are reachable in a file.
 * `core` clients take paths relative to /api/v1; `plugin` clients prefix `/api/plugins/<id>` themselves.
 * @param {string} src
 * @returns {{ core: Set<string>, plugin: Map<string, string | null> }}
 */
export function detectClients(src) {
  const core = new Set(['ApiUtil']);
  /** @type {Map<string, string | null>} */
  const plugin = new Map();
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+['"][^'"]*utils\/api(?:\.js)?['"]/g)) core.add(m[1]);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@panomc\/sdk\/plugin-api['"]/g)) {
    for (const part of m[1].split(',')) {
      const p = /^\s*api(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (p) plugin.set(p[1] || 'api', null);
    }
  }
  if (!plugin.has('api') && /\bapi\.(?:panel\.)?(?:get|post|put|delete|customRequest)\s*\(/.test(src) && /plugin-api/.test(src)) plugin.set('api', null);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createPluginApi\(\s*(['"`])([^'"`]+)\2\s*\)/g)) plugin.set(m[1], m[3]);
  return { core, plugin };
}

const METHODS = '(?:get|post|put|delete|customRequest)';

/**
 * Finds calls on API clients.
 * @param {string} src
 * @returns {{ name: string, kind: 'core' | 'plugin', pluginId: string | null, panel: boolean, open: number, close: number }[]}
 */
export function findApiCalls(src) {
  const { core, plugin } = detectClients(src);
  const names = [...core, ...plugin.keys()];
  if (!names.length) return [];
  const re = new RegExp(`(?<![\\w$.])(${names.map(escapeRe).join('|')})(\\.panel)?\\.${METHODS}\\s*\\(`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = matchParenJs(src, open);
    if (close === -1) continue;
    const isPlugin = plugin.has(m[1]);
    out.push({ name: m[1], kind: isPlugin ? 'plugin' : 'core', pluginId: isPlugin ? plugin.get(m[1]) ?? null : null, panel: !!m[2], open, close });
  }
  return out;
}

/**
 * Variable names that hold values returned by API client calls in this file.
 * @param {string} src
 * @returns {Set<string>}
 */
export function resultVariables(src) {
  const vars = new Set();
  for (const call of findApiCalls(src)) {
    const start = src.lastIndexOf(call.name, call.open);
    const before = src.slice(Math.max(0, start - 80), start);
    const a = /([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/.exec(before);
    if (a) vars.add(a[1]);
    const after = src.slice(call.close + 1, call.close + 240);
    const t = /^\s*\.then\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/.exec(after);
    if (t) vars.add(t[1]);
  }
  return vars;
}

/**
 * Rewrites result reads on API values (step f): error codes to `error.code`, `result` checks to `error` checks,
 * `errors` to `error.fields`. Only variables that receive an API client call result are touched.
 * @param {string} src
 * @returns {{ text: string, count: number }}
 */
export function rewriteResults(src) {
  let text = src;
  let count = 0;
  for (const v of resultVariables(src)) {
    const acc = `(?<![\\w$.])${escapeRe(v)}(?:\\s*\\?)?`;
    const rules = [
      [new RegExp(`(${acc})\\.result\\s*(?:===|==)\\s*(['"])ok\\2`, 'g'), (_m, a) => `!${a}.error`],
      [new RegExp(`(${acc})\\.result\\s*(?:!==|!=)\\s*(['"])ok\\2`, 'g'), (_m, a) => `!!${a}.error`],
      [new RegExp(`(${acc})\\.result\\s*(?:===|==)\\s*(['"])errors?\\2`, 'g'), (_m, a) => `!!${a}.error`],
      [new RegExp(`(${acc})\\.result\\s*(?:!==|!=)\\s*(['"])errors?\\2`, 'g'), (_m, a) => `!${a}.error`],
      [new RegExp(`(${acc})\\.error(\\s*)(===|==|!==|!=)(\\s*)(['"\`])`, 'g'), (_m, a, s1, op, s2, q) => `${a}.error?.code${s1}${op}${s2}${q}`],
      [new RegExp(`(${acc})\\.errors\\b`, 'g'), (_m, a) => `${a}.error?.fields`],
    ];
    for (const [re, fn] of rules) {
      text = text.replace(re, (...args) => {
        count++;
        return fn(...args);
      });
    }
  }
  return { text, count };
}

/**
 * Leftovers a migration aid reports: legacy path literals, `.result ===` reads, `totalPage`.
 * @param {string} src
 * @returns {{ line: number, what: string, text: string }[]}
 */
export function findJsLeftovers(src) {
  const lineOf = lineIndex(src);
  const out = [];
  for (const lit of findPathLiterals(src)) {
    const m = LEGACY_URL.exec(lit.content);
    if (!m || (lit.kind === 'path' && m[1])) continue;
    const rest = lit.content.slice(m[0].length);
    if (rest === '/v1' || rest.startsWith('/v1/')) continue;
    if (isMigratedPluginUrl(lit.content)) continue;
    out.push({ line: lineOf(lit.start), what: '/api/ path literal', text: lit.content });
  }
  for (const m of src.matchAll(/\.result\s*(?:===|!==|==|!=)/g)) out.push({ line: lineOf(m.index), what: '.result comparison', text: m[0] });
  for (const m of src.matchAll(/\btotalPage\b/g)) out.push({ line: lineOf(m.index), what: 'totalPage', text: 'totalPage' });
  return out.sort((a, b) => a.line - b.line);
}

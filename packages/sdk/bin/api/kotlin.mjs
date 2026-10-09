// A small Kotlin reader for the pano-api CLI: it masks comments and strings, finds classes with their supertypes,
// `const val` string constants and `Path(...)` calls. It is not a Kotlin parser; it understands exactly what
// the endpoint scan and the codemod need and fails loudly on the rest.
import { lineIndex } from './util.mjs';

/**
 * Skips a Kotlin string literal starting at the opening quote; returns the index after the closing quote.
 * @param {string} s @param {number} i
 */
function skipString(s, i) {
  if (s.startsWith('"""', i)) {
    const end = s.indexOf('"""', i + 3);
    if (end === -1) return s.length;
    let e = end + 3;
    while (s[e] === '"') e++;
    return e;
  }
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') j += 2;
    else if (c === '"') return j + 1;
    else if (c === '$' && s[j + 1] === '{') {
      let depth = 0;
      let k = j + 1;
      for (; k < s.length; k++) {
        if (s[k] === '"') k = skipString(s, k) - 1;
        else if (s[k] === '{') depth++;
        else if (s[k] === '}' && --depth === 0) break;
      }
      j = k + 1;
    } else j++;
  }
  return s.length;
}

/**
 * Masks a Kotlin source. `text` has comments blanked (strings intact); `code` additionally has string contents
 * replaced by `x` so brace and paren matching never trips over a quoted bracket. Offsets are identical to `src`.
 * @param {string} src
 * @returns {{ text: string, code: string }}
 */
export function maskKotlin(src) {
  const text = src.split('');
  const code = src.split('');
  const blank = (arr, from, to) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      let e = src.indexOf('\n', i);
      if (e === -1) e = n;
      blank(text, i, e);
      blank(code, i, e);
      i = e;
    } else if (c === '/' && src[i + 1] === '*') {
      // KDoc and block comments nest in Kotlin.
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (src[j] === '*' && src[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      blank(text, i, j);
      blank(code, i, j);
      i = j;
    } else if (c === '"') {
      const e = skipString(src, i);
      const q = src.startsWith('"""', i) ? 3 : 1;
      for (let k = i + q; k < e - q; k++) if (code[k] !== '\n' && code[k] !== '\r') code[k] = 'x';
      i = e;
    } else if (c === "'") {
      const m = /^'(?:\\.[^']{0,6}|[^\\'])'/.exec(src.slice(i, i + 10));
      if (m) {
        for (let k = i + 1; k < i + m[0].length - 1; k++) code[k] = 'x';
        i += m[0].length;
      } else i++;
    } else i++;
  }
  return { text: text.join(''), code: code.join('') };
}

/**
 * Index of the bracket closing the one at `open`, or -1. Works on masked code.
 * @param {string} code @param {number} open
 */
export function matchBracket(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']', '<': '>' };
  const o = code[open];
  const c = pairs[o];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++;
    else if (code[i] === c) {
      if (o === '<' && code[i - 1] === '-') continue;
      if (--depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Splits a masked range on top-level commas.
 * @param {string} code @param {number} from @param {number} to
 * @returns {{ start: number, end: number }[]}
 */
export function splitArgs(code, from, to) {
  const out = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push({ start, end: i });
      start = i + 1;
    }
  }
  if (code.slice(start, to).trim()) out.push({ start, end: to });
  return out;
}

const MODIFIERS =
  '(?:abstract|open|data|inner|internal|private|public|protected|sealed|final|enum|annotation|value|fun|expect|actual)';
const ANNOTATIONS_BEFORE = new RegExp(`((?:@[\\w.]+(?::\\w+)?(?:\\([^)]*\\))?\\s*|\\b${MODIFIERS}\\s+)*)$`);

/**
 * @typedef {{ name: string, call: boolean, open: number, close: number }} SuperRef
 * @typedef {{
 *   name: string, kind: string, start: number, line: number, supers: SuperRef[], body: [number, number] | null,
 *   annotations: string[], abstract: boolean, file: KotlinFile, owner: ClassInfo | null
 * }} ClassInfo
 * @typedef {{ name: string, owner: string | null, raw: string, start: number, end: number, file: KotlinFile }} ConstInfo
 * @typedef {{
 *   path: string, rel: string, src: string, text: string, code: string, pkg: string, imports: string[],
 *   classes: ClassInfo[], consts: ConstInfo[], lineOf: (i: number) => number
 * }} KotlinFile
 */

/**
 * Parses one Kotlin file.
 * @param {string} src @param {string} filePath @param {string} relPath
 * @returns {KotlinFile}
 */
export function parseKotlin(src, filePath, relPath) {
  const { text, code } = maskKotlin(src);
  const lineOf = lineIndex(src);
  const pkg = /^\s*package\s+([\w.]+)/m.exec(code)?.[1] ?? '';
  const imports = [...code.matchAll(/^\s*import\s+([\w.*]+)(?:\s+as\s+\w+)?/gm)].map((m) => m[1]);
  /** @type {KotlinFile} */
  const file = { path: filePath, rel: relPath, src, text, code, pkg, imports, classes: [], consts: [], lineOf };

  const re = /(?<![:\w.])(?:(class|interface)|(object))\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(code))) {
    const kind = m[1] || m[2];
    let pos = m.index + m[0].length;
    const skipWs = () => {
      while (pos < code.length && /\s/.test(code[pos])) pos++;
    };
    skipWs();
    if (code[pos] === '<') {
      const e = matchBracket(code, pos);
      if (e === -1) continue;
      pos = e + 1;
      skipWs();
    }
    const ctor = /^(?:(?:private|internal|public|protected)\s+)?(?:constructor\s*)?\(/.exec(code.slice(pos, pos + 40));
    if (ctor) {
      const open = pos + ctor[0].length - 1;
      const close = matchBracket(code, open);
      if (close === -1) continue;
      pos = close + 1;
      skipWs();
    }
    /** @type {SuperRef[]} */
    const supers = [];
    if (code[pos] === ':') {
      pos++;
      for (;;) {
        skipWs();
        const t = /^([A-Za-z_][\w.]*)/.exec(code.slice(pos));
        if (!t) break;
        pos += t[0].length;
        if (code[pos] === '<') {
          const e = matchBracket(code, pos);
          if (e === -1) break;
          pos = e + 1;
        }
        if (code[pos] === '?') pos++;
        let wsPos = pos;
        while (/\s/.test(code[wsPos] || '')) wsPos++;
        let call = false;
        let open = -1;
        let close = -1;
        if (code[wsPos] === '(') {
          const e = matchBracket(code, wsPos);
          if (e === -1) break;
          call = true;
          open = wsPos;
          close = e;
          pos = e + 1;
        }
        supers.push({ name: t[1].split('.').pop() || t[1], call, open, close });
        wsPos = pos;
        while (/\s/.test(code[wsPos] || '')) wsPos++;
        if (code.startsWith('by', wsPos) && /\s/.test(code[wsPos + 2] || '')) {
          // delegation: skip the expression up to the next top-level comma, brace or line end
          let depth = 0;
          let k = wsPos + 2;
          for (; k < code.length; k++) {
            const c = code[k];
            if (c === '(' || c === '[') depth++;
            else if (c === ')' || c === ']') depth--;
            else if (depth === 0 && (c === ',' || c === '{' || c === '\n')) break;
          }
          pos = k;
          wsPos = pos;
          while (/\s/.test(code[wsPos] || '')) wsPos++;
        }
        if (code[wsPos] === ',') {
          pos = wsPos + 1;
          continue;
        }
        break;
      }
      skipWs();
    }
    const where = /^where\b/.exec(code.slice(pos, pos + 8));
    if (where) {
      const b = code.indexOf('{', pos);
      if (b !== -1) pos = b;
    }
    /** @type {[number, number] | null} */
    let body = null;
    if (code[pos] === '{') {
      const e = matchBracket(code, pos);
      if (e !== -1) body = [pos, e];
    }
    const before = code.slice(Math.max(0, m.index - 600), m.index);
    const tail = ANNOTATIONS_BEFORE.exec(before)?.[1] ?? '';
    const annotations = [...tail.matchAll(/@([\w.]+)/g)].map((a) => a[1].split('.').pop() || a[1]);
    file.classes.push({
      name: m[3], kind, start: m.index, line: lineOf(m.index), supers, body, annotations,
      abstract: /\babstract\b/.test(tail), file, owner: null,
    });
  }
  // nesting: the innermost class whose body contains the declaration is its owner
  for (const c of file.classes) {
    let best = null;
    for (const o of file.classes) {
      if (o === c || !o.body) continue;
      if (c.start > o.body[0] && c.start < o.body[1] && (!best || o.body[0] > best.body[0])) best = o;
    }
    c.owner = best;
  }

  const cre = /\bconst\s+val\s+([A-Za-z_]\w*)\s*(?::\s*String)?\s*=\s*"/g;
  while ((m = cre.exec(code))) {
    const q = m.index + m[0].length - 1;
    const end = skipString(src, q);
    if (src.startsWith('"""', q)) continue;
    let owner = null;
    for (const o of file.classes) {
      if (o.body && q > o.body[0] && q < o.body[1] && (!owner || o.body[0] > owner.body[0])) owner = o;
    }
    file.consts.push({ name: m[1], owner: owner ? owner.name : null, raw: text.slice(q + 1, end - 1), start: q + 1, end: end - 1, file });
  }
  return file;
}

/**
 * Finds `Path(...)` calls inside a range of a parsed file.
 * @param {KotlinFile} file @param {number} from @param {number} to
 * @returns {{ start: number, line: number, expr: { start: number, end: number }, method: string }[]}
 */
export function findPathCalls(file, from, to) {
  const out = [];
  const re = /(?<![\w.])Path\s*\(/g;
  const slice = file.code.slice(from, to);
  let m;
  while ((m = re.exec(slice))) {
    const open = from + m.index + m[0].length - 1;
    const close = matchBracket(file.code, open);
    if (close === -1) continue;
    const args = splitArgs(file.code, open + 1, close);
    if (args.length < 2) continue;
    const mt = /(?:RouteType\.)?([A-Z]+)\s*$/.exec(file.text.slice(args[1].start, args[1].end).trim());
    if (!mt) continue;
    out.push({ start: from + m.index, line: file.lineOf(from + m.index), expr: args[0], method: mt[1] === 'ROUTE' ? 'ANY' : mt[1] });
  }
  return out;
}

/** @typedef {{ value: string, file: KotlinFile, start: number, end: number }} Piece */

/**
 * Evaluates a path expression (string literals with `$NAME` / `${NAME}` templates, constant references and `+`)
 * into its string value plus the literal pieces it is made of (with file ranges, so the codemod can edit them).
 * @param {KotlinFile} file
 * @param {{ start: number, end: number }} expr
 * @param {(file: KotlinFile, ref: string) => ConstInfo | null} resolveConst
 * @returns {{ value: string, pieces: Piece[] }}
 */
export function evalPathExpr(file, expr, resolveConst) {
  /** @type {Piece[]} */
  const pieces = [];
  const evalRaw = (f, raw, rawStart, depth) => {
    if (depth > 8) throw new Error('constant reference chain is too deep');
    let at = 0;
    const re = /\$\{\s*([\w.]+)\s*\}|\$([A-Za-z_]\w*)/g;
    let m;
    while ((m = re.exec(raw))) {
      if (m.index > at) pieces.push({ value: raw.slice(at, m.index), file: f, start: rawStart + at, end: rawStart + m.index });
      const ref = m[1] || m[2];
      const def = resolveConst(f, ref);
      if (!def) throw new Error(`cannot resolve constant "${ref}"`);
      evalRaw(def.file, def.raw, def.start, depth + 1);
      at = m.index + m[0].length;
    }
    if (at < raw.length) pieces.push({ value: raw.slice(at), file: f, start: rawStart + at, end: rawStart + raw.length });
  };
  const src = file.text;
  const code = file.code;
  // split on top-level +
  const terms = [];
  let depth = 0;
  let s = expr.start;
  for (let i = expr.start; i < expr.end; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '+' && depth === 0) {
      terms.push([s, i]);
      s = i + 1;
    }
  }
  terms.push([s, expr.end]);
  for (const [a, b] of terms) {
    const t = src.slice(a, b);
    const lead = t.length - t.trimStart().length;
    const body = t.trim();
    if (body.startsWith('"') && !body.startsWith('"""') && body.endsWith('"') && body.length >= 2) {
      const rawStart = a + lead + 1;
      const raw = body.slice(1, -1);
      if (/\\/.test(raw)) throw new Error('escape sequences in a path literal are not supported');
      evalRaw(file, raw, rawStart, 0);
    } else if (/^[A-Za-z_][\w.]*$/.test(body)) {
      const def = resolveConst(file, body);
      if (!def) throw new Error(`cannot resolve constant "${body}"`);
      evalRaw(def.file, def.raw, def.start, 1);
    } else {
      throw new Error(`unsupported path expression "${body.length > 60 ? body.slice(0, 57) + '...' : body}"`);
    }
  }
  return { value: pieces.map((p) => p.value).join(''), pieces };
}

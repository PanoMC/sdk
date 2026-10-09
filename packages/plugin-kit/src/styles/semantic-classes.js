/**
 * Semantic classes (doc 03 section 1): the root class `<ns>-<view-kebab>` is added by the build,
 * the part classes `<ns>-<view-kebab>__<part>` by the `pano-plugin classes --fix` codemod.
 *
 * Parser: `parse(source, { modern: true })` from `svelte/compiler`; edits with `magic-string`.
 * Classes carry no styling; Bootstrap classes stay beside them.
 */
import MagicString from 'magic-string';
import { parse } from 'svelte/compiler';
import { isAllowedThemeClass } from './bootstrap-classes.js';

/**
 * The Bootstrap table of doc 03 section 1.2, in priority order: the first entry whose class the
 * element carries names the part.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const PART_TABLE = Object.freeze([
  ['card-body', 'body'],
  ['card-title', 'title'],
  ['card-header', 'header'],
  ['card-footer', 'footer'],
  ['card-img-top', 'image'],
  ['badge', 'badge'],
  ['alert', 'alert'],
  ['list-group', 'list'],
  ['list-group-item', 'item'],
  ['table', 'table'],
  ['form-control', 'input'],
  ['form-select', 'select'],
  ['form-label', 'label'],
  ['form-check-input', 'check'],
  ['nav-link', 'link'],
  ['modal-header', 'header'],
  ['modal-body', 'body'],
  ['modal-footer', 'footer'],
  ['offcanvas-header', 'header'],
  ['offcanvas-body', 'body'],
  ['dropdown-menu', 'menu'],
  ['dropdown-item', 'menu-item'],
  ['pagination', 'pager'],
  ['btn', 'action'],
]);

/** The tag table, used after the Bootstrap table. @type {Readonly<Record<string, string>>} */
export const TAG_TABLE = Object.freeze({
  img: 'image',
  h1: 'title',
  h2: 'title',
  h3: 'title',
  h4: 'title',
  h5: 'title',
  h6: 'title',
});

/** Block types a root element may sit in, with the fragments to descend into. */
const ROOT_BLOCKS = {
  IfBlock: ['consequent', 'alternate'],
  EachBlock: ['body', 'fallback'],
  AwaitBlock: ['pending', 'then', 'catch'],
  KeyBlock: ['fragment'],
};

/**
 * `ProductCard` -> `product-card`, `HTMLView` -> `html-view`, `add_to_cart` -> `add-to-cart`.
 *
 * @param {string} name
 * @returns {string}
 */
export function kebab(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * The root class of a view.
 *
 * @param {string} ns
 * @param {string} view
 * @returns {string}
 */
export function rootClassOf(ns, view) {
  return `${ns}-${kebab(view)}`;
}

/** A generated root class collides with a Bootstrap / FontAwesome class: the build must fail. */
export class SemanticClassCollisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SemanticClassCollisionError';
  }
}

/** @param {string} source @param {number} index @returns {number} 1-based line */
function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function parseModern(source) {
  return parse(source, { modern: true });
}

/**
 * Class tokens an expression names literally: string literals, template quasis and the keys of an
 * object (`{ 'is-sold-out': cond }`).
 *
 * @param {any} node ESTree node
 * @param {string[]} out
 */
function literalTokens(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) literalTokens(n, out);
    return;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') {
    out.push(...node.value.split(/\s+/).filter(Boolean));
    return;
  }
  if (node.type === 'TemplateElement') {
    out.push(...String(node.value?.cooked ?? node.value?.raw ?? '').split(/\s+/).filter(Boolean));
    return;
  }
  if (node.type === 'Property' && !node.computed) {
    if (node.key?.type === 'Identifier') out.push(node.key.name);
    else literalTokens(node.key, out);
    literalTokens(node.value, out);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
    literalTokens(node[key], out);
  }
}

/**
 * Literal class tokens of one element: the `class` attribute (text and expression literals) and
 * `class:name` directives.
 *
 * @param {any} el RegularElement
 * @returns {string[]}
 */
function elementTokens(el) {
  /** @type {string[]} */
  const out = [];
  for (const attr of el.attributes ?? []) {
    if (attr.type === 'ClassDirective') out.push(attr.name);
    if (attr.type !== 'Attribute' || attr.name !== 'class' || attr.value === true) continue;
    const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
    for (const part of parts) {
      if (part.type === 'Text') out.push(...part.data.split(/\s+/).filter(Boolean));
      else if (part.type === 'ExpressionTag') literalTokens(part.expression, out);
    }
  }
  return out;
}

/**
 * Root elements: RegularElement nodes reached from the top fragment, descending only through
 * IfBlock, EachBlock, AwaitBlock and KeyBlock (every branch).
 *
 * @param {any} fragment
 * @returns {any[]}
 */
function rootElements(fragment) {
  const found = [];
  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.type === 'RegularElement') found.push(node);
      else if (ROOT_BLOCKS[node.type])
        for (const key of ROOT_BLOCKS[node.type]) visit(node[key]?.nodes);
    }
  };
  visit(fragment?.nodes);
  return found;
}

/**
 * Root elements of a view with their literal class tokens, for the lint.
 *
 * @param {string} source
 * @returns {{ tag: string, tokens: string[], line: number }[]}
 */
export function inspectRoots(source) {
  const ast = parseModern(source);
  return rootElements(ast.fragment).map((el) => ({
    tag: el.name,
    tokens: elementTokens(el),
    line: lineOf(source, el.start),
  }));
}

/** Every RegularElement in the template, in source order. */
function allElements(root) {
  const found = [];
  const seen = new WeakSet();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (node.type === 'RegularElement') found.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'name_loc' || key === 'metadata') continue;
      visit(node[key]);
    }
  };
  visit(root.fragment);
  return found.sort((a, b) => a.start - b.start);
}

/**
 * Adds `cls` to an element with the three class forms of doc 03 section 1.2. Returns false when the
 * element already carries it.
 *
 * - no `class` attribute: `class="x"`
 * - text value: `x` is prepended (also inside a quoted value that holds `{expr}` parts)
 * - expression value: `class={['x', <expr>]}`; an array literal gets the entry inserted
 *
 * @param {MagicString} ms
 * @param {any} el RegularElement
 * @param {string} cls
 * @returns {boolean}
 */
function mergeClass(ms, el, cls) {
  if (elementTokens(el).includes(cls)) return false;
  const attr = (el.attributes ?? []).find((a) => a.type === 'Attribute' && a.name === 'class');
  if (!attr) {
    ms.appendLeft(el.start + 1 + el.name.length, ` class="${cls}"`);
    return true;
  }
  const original = ms.original;
  if (attr.value === true) {
    ms.overwrite(attr.start, attr.end, `class="${cls}"`);
    return true;
  }
  if (Array.isArray(attr.value)) {
    const first = attr.value[0];
    const last = attr.value[attr.value.length - 1];
    if (!first) {
      ms.overwrite(attr.start, attr.end, `class="${cls}"`);
      return true;
    }
    const quoted = /["']/.test(original[first.start - 1] ?? '');
    if (quoted) ms.appendLeft(first.start, `${cls} `);
    else {
      ms.appendLeft(first.start, `"${cls} `);
      ms.appendRight(last.end, '"');
    }
    return true;
  }
  const expr = attr.value.expression;
  if (expr.type === 'ArrayExpression') {
    ms.appendLeft(expr.start + 1, `'${cls}'${expr.elements.length ? ', ' : ''}`);
  } else {
    ms.appendLeft(expr.start, `['${cls}', `);
    ms.appendRight(expr.end, ']');
  }
  return true;
}

/**
 * Adds the root class `<ns>-<view-kebab>` to every root element. Idempotent.
 *
 * - No element root (a component, `{@render}` or text at the top level): no class, `roots` is
 *   empty and `warnings` carries the build message.
 * - A generated class that is a Bootstrap / FontAwesome class throws an Error naming `namespace`.
 *
 * @param {string} source
 * @param {{ ns: string, view: string }} ctx
 * @returns {{ code: string, added: string[], roots: string[], warnings: string[] }}
 *   roots = tag names found
 */
export function addRootClass(source, ctx) {
  const cls = rootClassOf(ctx.ns, ctx.view);
  if (isAllowedThemeClass(cls)) {
    throw new SemanticClassCollisionError(
      `${ctx.view}: the generated root class "${cls}" is a Bootstrap / FontAwesome class. ` +
        `Set "namespace" in pano.plugin.js to a short name that does not start like one.`,
    );
  }
  const ast = parseModern(source);
  const elements = rootElements(ast.fragment);
  if (!elements.length) {
    return {
      code: source,
      added: [],
      roots: [],
      warnings: [
        `${ctx.view} has no root element; wrap it in an element so themes can target it`,
      ],
    };
  }
  const ms = new MagicString(source);
  let changed = false;
  for (const el of elements) if (mergeClass(ms, el, cls)) changed = true;
  return {
    code: changed ? ms.toString() : source,
    added: changed ? [cls] : [],
    roots: [...new Set(elements.map((e) => e.name))],
    warnings: [],
  };
}

/** The part name an element's classes ask for, or null. */
function partNameOf(el, tokens) {
  for (const [bootstrapClass, part] of PART_TABLE) if (tokens.includes(bootstrapClass)) return part;
  const tagPart = TAG_TABLE[el.name];
  if (tagPart && tokens.some((t) => isAllowedThemeClass(t))) return tagPart;
  return null;
}

/**
 * Part name of the Bootstrap table or the tag table for an element, or null when it has none.
 * Used by the lint to name the part a missing class would get.
 *
 * @param {string} tag
 * @param {string[]} tokens
 * @returns {string | null}
 */
export function partNameFor(tag, tokens) {
  return partNameOf({ name: tag }, tokens);
}

/** Last segment of the first literal `$_('…')` key inside the element, as a kebab part name. */
function keyPartOf(source, el) {
  const m = /\$_\(\s*(['"`])([^'"`]+)\1/.exec(source.slice(el.start, el.end));
  if (!m) return null;
  const segment = m[2].split('.').pop() ?? '';
  return kebab(segment) || null;
}

/**
 * Adds part classes to elements with a Bootstrap component class and no `<ns>-` class. Idempotent.
 * Name: first match of the Bootstrap table, then the tag table. On a clash inside one file: the
 * last segment of the first `$_('…')` key inside the element, else `<name>-2`, `-3`.
 *
 * @param {string} source
 * @param {{ ns: string, view: string }} ctx
 * @returns {{ code: string, added: { line: number, class: string }[] }}
 */
export function addPartClasses(source, ctx) {
  const root = rootClassOf(ctx.ns, ctx.view);
  const ast = parseModern(source);
  const ms = new MagicString(source);
  const used = new Set();
  for (const m of source.matchAll(new RegExp(`${escapeRe(root)}__([a-z0-9-]+)`, 'g')))
    used.add(m[1]);

  const added = [];
  for (const el of allElements(ast)) {
    const tokens = elementTokens(el);
    if (tokens.some((t) => t.startsWith(`${ctx.ns}-`))) continue;
    const base = partNameOf(el, tokens);
    if (!base) continue;
    let name = base;
    if (used.has(name)) {
      const fromKey = keyPartOf(source, el);
      if (fromKey && !used.has(fromKey)) name = fromKey;
      else {
        let n = 2;
        while (used.has(`${base}-${n}`)) n++;
        name = `${base}-${n}`;
      }
    }
    used.add(name);
    const cls = `${root}__${name}`;
    if (mergeClass(ms, el, cls)) added.push({ line: lineOf(source, el.start), class: cls });
  }
  return { code: added.length ? ms.toString() : source, added };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Views a preprocessor instance handles.
 *
 * @typedef {(filename: string) => (string | null | undefined)} ViewResolver
 *   returns the view name for a file, or null when the file is not a view
 */

/**
 * rollup-plugin-svelte `preprocess` entry (inside `panoPlugin()`): addRootClass on every view.
 *
 * `views` decides which files are views (name = file name without `.svelte`): a function
 * `(filename) => name | null`, or a list of directories / files. Default: every `.svelte` file
 * outside `node_modules`. A file with no element root is left alone and `warn` (default
 * `console.warn`) prints the message. A Bootstrap collision throws, which fails the build.
 *
 * @param {{ ns: string, views?: ViewResolver | string[], warn?: (message: string) => void }} options
 * @returns {{ name: string, markup: (input: { content: string, filename?: string }) => { code: string } | undefined }}
 */
export function panoSemanticClasses({ ns, views, warn = (m) => console.warn(m) }) {
  const resolve = viewResolver(views);
  return {
    name: 'pano-semantic-classes',
    markup({ content, filename }) {
      if (!filename || !filename.endsWith('.svelte')) return undefined;
      const view = resolve(filename.replace(/\\/g, '/'));
      if (!view) return undefined;
      let result;
      try {
        result = addRootClass(content, { ns, view });
      } catch (error) {
        // A Svelte syntax error is reported by the compiler with better positions; a collision
        // is ours and must fail the build.
        if (error instanceof SemanticClassCollisionError) throw error;
        return undefined;
      }
      for (const message of result.warnings) warn(`${filename}: ${message}`);
      return result.code === content ? undefined : { code: result.code };
    },
  };
}

/** @param {ViewResolver | string[] | undefined} views @returns {ViewResolver} */
function viewResolver(views) {
  const nameOf = (file) => file.slice(file.lastIndexOf('/') + 1).replace(/\.svelte$/, '');
  if (typeof views === 'function') return views;
  if (Array.isArray(views)) {
    const entries = views.map((v) => v.replace(/\\/g, '/').replace(/\/+$/, ''));
    return (file) =>
      entries.some((e) => file === e || file.startsWith(`${e}/`)) ? nameOf(file) : null;
  }
  return (file) => (file.includes('/node_modules/') ? null : nameOf(file));
}

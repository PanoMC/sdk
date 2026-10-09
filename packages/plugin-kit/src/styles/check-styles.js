/**
 * The plugin style lint (doc 03 section 3): the generalised form of market's `theme-class` /
 * `theme-style` rules. `pano-plugin check` runs it at level `core`, `--styles badge` at `badge`.
 *
 * Every message is `<what> — <next step>.` so the author always sees what to do next.
 */
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { parse } from 'svelte/compiler';
import { classTokens, parseTags, splitSvelte } from './scan.js';
import { isAllowedThemeClass } from './bootstrap-classes.js';
import { PART_TABLE, inspectRoots, rootClassOf } from './semantic-classes.js';

/**
 * @typedef {{ rule: string, file: string, line: number, message: string, level: 'error'|'warn' }} StyleFinding
 */

/**
 * Severity of each rule per level; `null` = rule off.
 *
 * @type {Readonly<Record<string, { core: 'error'|'warn'|null, badge: 'error'|'warn'|null }>>}
 */
export const RULE_LEVELS = Object.freeze({
  'class-allowed': { core: 'warn', badge: 'error' },
  'style-block-scope': { core: null, badge: 'error' },
  'style-attr': { core: null, badge: 'error' },
  'no-bs-var': { core: 'warn', badge: 'error' },
  'dynamic-class': { core: 'warn', badge: 'warn' },
  'root-class': { core: null, badge: 'error' },
  'part-coverage': { core: null, badge: 'error' },
  'part-prefix': { core: 'warn', badge: 'error' },
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function walkSvelte(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const visit = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.svelte')) out.push(full);
    }
  };
  visit(dir);
  return out.sort();
}

function walkJs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const visit = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(js|mjs)$/.test(entry.name) && !/\.test\.m?js$/.test(entry.name)) out.push(full);
    }
  };
  visit(dir);
  return out.sort();
}

/**
 * Reads the value of the attribute whose name starts at `pos` (just after `name=`).
 *
 * @returns {{ kind: 'quoted'|'brace'|'bare', raw: string }}
 */
function readAttrValue(attrs, pos) {
  const c = attrs[pos];
  if (c === '"' || c === "'") {
    const end = attrs.indexOf(c, pos + 1);
    return { kind: 'quoted', raw: attrs.slice(pos + 1, end === -1 ? attrs.length : end) };
  }
  if (c === '{') {
    let depth = 0;
    let quote = '';
    for (let i = pos; i < attrs.length; i++) {
      const ch = attrs[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return { kind: 'brace', raw: attrs.slice(pos + 1, i) };
    }
    return { kind: 'brace', raw: attrs.slice(pos + 1) };
  }
  const m = /^[^\s>]*/.exec(attrs.slice(pos));
  return { kind: 'bare', raw: m ? m[0] : '' };
}

/** `{…}` chunks of a quoted attribute replaced by `0`. */
function stripBraces(raw) {
  let out = '';
  let depth = 0;
  for (const ch of raw) {
    if (ch === '{') {
      if (depth++ === 0) out += '0';
    } else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/** True when every declaration in the text is a custom property (`--x: …`) and there is one. */
function onlyCustomProperties(text) {
  const decls = text
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  return decls.length > 0 && decls.every((d) => /^--[\w-]+\s*:/.test(d));
}

/**
 * Style attributes of one tag: `[{ offset, raw, custom }]` and `style:` directives.
 *
 * @param {string} attrs
 */
function styleAttributes(attrs) {
  const found = [];
  for (const m of attrs.matchAll(/(?:^|\s)style\s*=\s*/g)) {
    const valuePos = m.index + m[0].length;
    const { kind, raw } = readAttrValue(attrs, valuePos);
    let custom;
    if (kind === 'brace') {
      const literals = [...raw.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((s) =>
        s[2].replace(/\$\{[^}]*\}/g, '0'),
      );
      custom = literals.length > 0 && onlyCustomProperties(literals.join(';'));
    } else custom = onlyCustomProperties(stripBraces(raw));
    found.push({ offset: m.index, raw, custom });
  }
  for (const m of attrs.matchAll(/(?:^|\s)style:([\w-]+)/g))
    found.push({ offset: m.index, raw: m[1], custom: m[1].startsWith('--'), directive: m[1] });
  return found;
}

// ---- dynamic-class -----------------------------------------------------------------------------

function literalStrings(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) literalStrings(n, out);
    return;
  }
  if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
  else if (node.type === 'TemplateElement') out.push(String(node.value?.cooked ?? ''));
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type') continue;
    literalStrings(node[key], out);
  }
}

const tokensOf = (strings) => strings.flatMap((s) => s.split(/\s+/)).filter(Boolean);

/** Declared name -> class-like literal tokens of its initialiser, plus every literal token seen. */
function collectDeclarations(scripts, into) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    let name = null;
    let body = null;
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
      name = node.id.name;
      body = node.init;
    } else if (node.type === 'FunctionDeclaration' && node.id) {
      name = node.id.name;
      body = node.body;
    } else if (node.type === 'Property' && !node.computed && node.key?.type === 'Identifier') {
      name = node.key.name;
      body = node.value;
    }
    if (name && body) {
      const strings = [];
      literalStrings(body, strings);
      const tokens = tokensOf(strings);
      const entry = into.declared.get(name) ?? new Set();
      for (const t of tokens) entry.add(t);
      into.declared.set(name, entry);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'type') continue;
      visit(node[key]);
    }
  };
  for (const script of scripts) {
    const strings = [];
    literalStrings(script, strings);
    for (const t of tokensOf(strings)) into.literals.add(t);
    visit(script);
  }
}

function parseScripts(source) {
  try {
    const ast = parse(source, { modern: true });
    return { ast, scripts: [ast.instance?.content, ast.module?.content].filter(Boolean) };
  } catch {
    return { ast: null, scripts: [] };
  }
}

function helperScripts(files) {
  const scripts = [];
  for (const file of files) {
    try {
      const wrapped = parse(`<script module>${fs.readFileSync(file, 'utf8')}\n</script>`, {
        modern: true,
      });
      if (wrapped.module?.content) scripts.push(wrapped.module.content);
    } catch {
      // an unparsable helper only makes the lint less precise
    }
  }
  return scripts;
}

/** Root identifier names an expression reads (`a.b.c(d)` -> a). */
function headIdentifiers(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Identifier') out.add(node.name);
  else if (node.type === 'MemberExpression') headIdentifiers(node.object, out);
  else if (node.type === 'CallExpression') headIdentifiers(node.callee, out);
  else if (node.type === 'ChainExpression') headIdentifiers(node.expression, out);
  else if (node.type === 'TemplateLiteral') for (const e of node.expressions) headIdentifiers(e, out);
  else if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    headIdentifiers(node.left, out);
    headIdentifiers(node.right, out);
  } else if (node.type === 'ConditionalExpression') {
    headIdentifiers(node.consequent, out);
    headIdentifiers(node.alternate, out);
  }
}

/** Trailing token of literal text (`btn btn-` -> `btn-`). */
const trailingToken = (text) => /(\S*)$/.exec(text)?.[1] ?? '';

/**
 * Non-literal members of a class expression.
 *
 * @param {any} node
 * @param {{ node: any, prefix: string, text: string }[]} out
 * @param {string} source
 */
function dynamicMembers(node, out, source) {
  if (!node) return;
  switch (node.type) {
    case 'Literal':
      return;
    case 'ArrayExpression':
      for (const e of node.elements) dynamicMembers(e, out, source);
      return;
    case 'SpreadElement':
      dynamicMembers(node.argument, out, source);
      return;
    case 'ConditionalExpression':
      dynamicMembers(node.consequent, out, source);
      dynamicMembers(node.alternate, out, source);
      return;
    case 'LogicalExpression':
      if (node.operator !== '&&') dynamicMembers(node.left, out, source);
      dynamicMembers(node.right, out, source);
      return;
    case 'ObjectExpression':
      for (const p of node.properties) {
        if (p.type === 'Property' && p.computed) dynamicMembers(p.key, out, source);
      }
      return;
    case 'TemplateLiteral':
      if (node.expressions.length)
        out.push({
          node,
          prefix: trailingToken(String(node.quasis[0].value.cooked ?? '')),
          text: source.slice(node.start, node.end),
        });
      return;
    case 'BinaryExpression': {
      let left = node;
      while (left.type === 'BinaryExpression' && left.operator === '+') left = left.left;
      const prefix =
        left.type === 'Literal' && typeof left.value === 'string' ? trailingToken(left.value) : '';
      out.push({ node, prefix, text: source.slice(node.start, node.end) });
      return;
    }
    case 'Identifier':
      if (node.name === 'undefined') return;
    // falls through
    default:
      out.push({ node, prefix: '', text: source.slice(node.start, node.end) });
  }
}

/** @param {any} root parsed component @param {string} source */
function classAttributes(root) {
  const found = [];
  const seen = new WeakSet();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (
      (node.type === 'RegularElement' || node.type === 'Component' || node.type === 'SvelteElement') &&
      node.attributes
    ) {
      for (const a of node.attributes)
        if (a.type === 'Attribute' && a.name === 'class' && a.value !== true) found.push(a);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'name_loc' || key === 'metadata') continue;
      visit(node[key]);
    }
  };
  visit(root.fragment);
  return found;
}

/** @returns {{ attr: any, text: string, prefix: string, node: any }[]} */
function dynamicClassMembers(ast, source) {
  const out = [];
  for (const attr of classAttributes(ast)) {
    const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
    parts.forEach((part, i) => {
      if (part.type !== 'ExpressionTag') return;
      const members = [];
      dynamicMembers(part.expression, members, source);
      const before = parts[i - 1];
      const textPrefix = before?.type === 'Text' ? trailingToken(before.data) : '';
      for (const m of members) {
        // `btn-{variant}`: the literal text in front of the tag is the prefix
        const prefix = Array.isArray(attr.value) && m.node === part.expression ? textPrefix : m.prefix;
        out.push({ attr, text: m.text, prefix, node: m.node });
      }
    });
  }
  return out;
}

// ---- main --------------------------------------------------------------------------------------

/**
 * @param {{ root: string, ns: string, viewsDir?: string, views: { name: string, file: string }[],
 *            styleAttrAllow?: string[], dynamicClassAllow?: string[], safelist?: string[],
 *            level?: 'core'|'badge' }} options
 * @returns {StyleFinding[]}   viewsDir default 'src/theme'
 */
export function checkStyles(options) {
  const {
    root,
    ns,
    viewsDir = 'src/theme',
    views = [],
    styleAttrAllow = [],
    dynamicClassAllow = [],
    safelist = [],
    level = 'core',
  } = options;
  if (level !== 'core' && level !== 'badge')
    throw new Error(`checkStyles: unknown level "${level}" — use "core" or "badge".`);

  const absRoot = path.resolve(root);
  const absViews = path.resolve(absRoot, viewsDir);
  const toRel = (file) => path.relative(absRoot, file).split(path.sep).join('/');
  const viewByFile = new Map(views.map((v) => [path.resolve(absRoot, v.file), v.name]));
  const ownClass = new RegExp(`^${escapeRe(ns)}-[a-z0-9-]+(__[a-z0-9-]+)?$`);
  const partClass = new RegExp(`^${escapeRe(ns)}-[a-z0-9-]+__[a-z0-9-]+$`);
  const safe = new Set(safelist);

  /** @type {StyleFinding[]} */
  const findings = [];
  const addAt = (rule, file, line, what, next) => {
    const severity = RULE_LEVELS[rule][level];
    if (!severity) return;
    findings.push({ rule, file, line, message: `${what} — ${next}.`, level: severity });
  };
  const add = (rule, file, source, index, what, next) =>
    addAt(rule, file, lineOf(source, index), what, next);

  const files = walkSvelte(absViews);
  const helperDecls = { declared: new Map(), literals: new Set() };
  collectDeclarations(helperScripts(walkJs(absViews)), helperDecls);

  for (const abs of files) {
    const file = toRel(abs);
    const source = fs.readFileSync(abs, 'utf8');
    const baseName = path.basename(abs, '.svelte');
    const viewName = viewByFile.get(abs);
    const rootClass = rootClassOf(ns, viewName ?? baseName);
    const { markup, styles } = splitSvelte(source);
    const allowedStyleAttr = styleAttrAllow.some(
      (a) => a === baseName || a === path.basename(abs) || a === file || file.endsWith(`/${a}`),
    );

    // style-block-scope (the plugin's own look lives in its views, decision 77) and no-bs-var in <style> blocks
    for (const m of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
      const bodyStart = m.index + m[0].indexOf('>') + 1;
      const bodyLine = lineOf(source, bodyStart);
      const body = m[1];
      const atLine = (node) => bodyLine + (node.source?.start?.line ?? 1) - 1;

      for (const v of body.matchAll(/var\(\s*(--bs-[\w-]+)/g))
        add(
          'no-bs-var',
          file,
          source,
          bodyStart + v.index,
          `var(${v[1]}) in a <style> block`,
          'use the matching --pano-* variable (for example --pano-color-primary) so Bootstrap-free themes keep working',
        );

      let sheet = null;
      try {
        sheet = postcss.parse(body);
      } catch {
        // CSS the lint cannot read (a preprocessor dialect) is the compiler's to report
      }
      if (!sheet) continue;

      const ownSelector = new RegExp(`\\.${escapeRe(ns)}-[a-z0-9_-]+`);
      const ownName = new RegExp(`^${escapeRe(ns)}-[a-z0-9_-]+$`);
      const ownProperty = new RegExp(`^--${escapeRe(ns)}-[a-z0-9_-]+$`);
      const rule = 'style-block-scope';

      sheet.walk((node) => {
        const line = atLine(node);

        if (node.type === 'rule') {
          if (/:global\b/.test(node.selector))
            addAt(
              rule,
              file,
              line,
              `${baseName}: "${node.selector.trim()}" uses :global`,
              `drop :global and style an element of this view through a class of its own (.${ns}-...)`,
            );

          const inKeyframes = node.parent?.type === 'atrule' && /keyframes$/i.test(node.parent.name);
          const nested = node.parent?.type === 'rule';

          if (!inKeyframes && !nested && !node.selectors.every((sel) => ownSelector.test(sel)))
            addAt(
              rule,
              file,
              line,
              `${baseName}: selector "${node.selector.trim().replace(/\s+/g, ' ')}" has no class of the plugin namespace`,
              `start every selector with a class like .${ns}-name (optionally with .is-state) so the rule cannot reach other markup`,
            );
        } else if (node.type === 'atrule' && /keyframes$/i.test(node.name)) {
          const name = node.params.trim();

          if (!ownName.test(name))
            addAt(
              rule,
              file,
              line,
              `${baseName}: keyframes "${name}" is not named after the plugin`,
              `rename it to ${ns}-${name.replace(/^-+/, '') || 'name'} and update the animation that uses it`,
            );
        } else if (node.type === 'decl' && node.prop.startsWith('--') && !ownProperty.test(node.prop)) {
          addAt(
            rule,
            file,
            line,
            `${baseName}: custom property "${node.prop}" is not named after the plugin`,
            `rename it to --${ns}-${node.prop.replace(/^-+/, '')} (read theme values through var(--pano-*) instead of redefining them)`,
          );
        }
      });
    }

    for (const tag of parseTags(markup)) {
      const attrsStart = tag.index + 1 + tag.name.length;

      // class-allowed, part-prefix
      for (const token of classTokens(tag.attrs)) {
        const isOwn = ownClass.test(token);
        if (!isOwn && !/^is-[a-z0-9-]+$/.test(token) && !isAllowedThemeClass(token) && !safe.has(token))
          add(
            'class-allowed',
            file,
            source,
            tag.index,
            `own class "${token}": not covered by fallback.css in a Bootstrap-free theme`,
            `rename it to ${ns}-${token} (a semantic class), use a Bootstrap class, or add it to styles.safelist in pano.plugin.js`,
          );
        if (isOwn && token.includes('__') && !token.startsWith(`${rootClass}__`))
          add(
            'part-prefix',
            file,
            source,
            tag.index,
            `class "${token}" in ${baseName}.svelte does not start with its view's root class "${rootClass}"`,
            `rename it to ${rootClass}__${token.split('__').pop()}`,
          );
      }

      // style-attr, no-bs-var in style=
      if (/(?:^|\s)style(?::|\s*=)/.test(tag.attrs)) {
        for (const st of styleAttributes(tag.attrs)) {
          const index = attrsStart + st.offset;
          if (!st.custom && !allowedStyleAttr)
            add(
              'style-attr',
              file,
              source,
              index,
              st.directive
                ? `style:${st.directive} sets a regular property on <${tag.name}>`
                : `style= on <${tag.name}> sets more than custom properties`,
              `set only --custom-properties there and read them in a class, move the rules into a class, or list ${baseName} in styleAttrAllow`,
            );
          for (const v of st.raw.matchAll(/var\(\s*(--bs-[\w-]+)/g))
            add(
              'no-bs-var',
              file,
              source,
              index,
              `var(${v[1]}) in style=`,
              'use the matching --pano-* variable (for example --pano-color-primary) so Bootstrap-free themes keep working',
            );
        }
      }

      // part-coverage
      const tokens = classTokens(tag.attrs);
      const tableEntry = PART_TABLE.find(([c]) => tokens.includes(c));
      if (tableEntry && !tokens.some((t) => partClass.test(t))) {
        const part = tableEntry[1];
        add(
          'part-coverage',
          file,
          source,
          tag.index,
          `<${tag.name}> with a Bootstrap component class has no part class`,
          `run pano-plugin classes --fix to add ${rootClass}__${part}`,
        );
      }
    }

    // root-class
    if (viewName !== undefined) {
      try {
        const roots = inspectRoots(source);
        if (!roots.length) {
          if (RULE_LEVELS['root-class'][level])
            findings.push({
              rule: 'root-class',
              file,
              line: 1,
              message: `${viewName} has no root element and cannot carry "${rootClass}" — wrap it in an element so themes can target it.`,
              level: 'warn',
            });
        }
        for (const r of roots)
          if (!r.tokens.includes(rootClass))
            addAt(
              'root-class',
              file,
              r.line,
              `${viewName}: root <${r.tag}> lacks the class "${rootClass}" in source`,
              'run pano-plugin classes --fix (the build adds it, but badge level wants it committed)',
            );
      } catch {
        // a Svelte syntax error is the compiler's to report
      }
    }

    // dynamic-class
    const { ast, scripts } = parseScripts(source);
    if (ast) {
      const decls = { declared: new Map(), literals: new Set() };
      collectDeclarations(scripts, decls);
      for (const m of dynamicClassMembers(ast, source)) {
        let resolved = false;
        if (m.prefix) {
          const hit = (t) => t.startsWith(m.prefix) && t !== m.prefix;
          resolved =
            [...safe].some(hit) ||
            [...decls.literals].some(hit) ||
            [...helperDecls.literals].some(hit);
        } else {
          const names = new Set();
          headIdentifiers(m.node, names);
          for (const name of names) {
            const known = decls.declared.get(name) ?? helperDecls.declared.get(name);
            if (known && [...known].some((t) => isAllowedThemeClass(t) || ownClass.test(t)))
              resolved = true;
          }
        }
        if (!resolved && !m.prefix && dynamicClassAllow.includes(baseName)) resolved = true;
        if (!resolved)
          add(
            'dynamic-class',
            file,
            source,
            m.attr.start,
            `class expression "${m.text}" has values the build cannot see`,
            m.prefix
              ? `write the possible classes as literals in the view or add them to styles.safelist in pano.plugin.js (they start with "${m.prefix}")`
              : 'write the possible classes as literals in the view (a map of full class names), add them to styles.safelist in pano.plugin.js, or list the view in styles.dynamicClassAllow',
          );
      }
    }
  }

  return findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
}

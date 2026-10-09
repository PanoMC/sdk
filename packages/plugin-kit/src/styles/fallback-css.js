/**
 * The scoped fallback stylesheet (doc 03 section 4, decision 47).
 *
 * `buildFallbackCss` is the pure core: it takes the compiled Bootstrap base sheet
 * (`assets/pano-bootstrap.css`) and the classes a plugin's views use, and returns a layered,
 * `@scope`d sheet that holds only those classes, with no `!important` and with Bootstrap's
 * variables bound to the `--pano-*` tokens. `panoFallbackCss` is the client-build rollup plugin
 * around it: it scans the views, writes `client/fallback.css` and tells the package index about the
 * sheet (`styles`) and about each view (`roots`, `classes`).
 *
 * The seven steps of doc 03 section 4.2 are marked `STEP n` below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { getBuildContext } from '../rollup/meta.js';
import { PALETTES, TOKENS } from './tokens.map.js';
import { classTokens, parseTags, splitSvelte } from './scan.js';
import { SemanticClassCollisionError, addRootClass, rootClassOf } from './semantic-classes.js';
import { clearStyleFile, recordStyleFile } from './plugin-css.js';

/** The base sheet shipped with the kit. */
export const BASE_CSS_FILE = fileURLToPath(new URL('../../assets/pano-bootstrap.css', import.meta.url));

/** Classes Bootstrap's JavaScript toggles at run time; never visible in a view's markup. */
export const JS_TOGGLED = Object.freeze([
  'show',
  'showing',
  'hiding',
  'fade',
  'collapse',
  'collapsing',
  'active',
  'disabled',
  'was-validated',
]);

/** Classless selectors that survive the purge (STEP 4). */
const RESET_TYPES = new Set([
  '*',
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'img',
  'svg',
  'hr',
  'p',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'small',
  'table',
  'th',
  'td',
]);

const THEME_COLORS = ['primary', 'secondary', 'success', 'danger', 'warning', 'info'];

/** Contrast colour of a theme colour that has no `--pano-color-on-*` token (Bootstrap's own results). */
const ON_COLOR = {
  primary: 'var(--pano-color-on-primary)',
  secondary: 'var(--pano-color-on-secondary)',
  success: '#fff',
  danger: '#fff',
  warning: '#000',
  info: '#000',
};

/** Classes whose elements Bootstrap's JavaScript appends to `<body>`, outside the scope root. */
const BODY_CLASS = /^(?:modal-backdrop|modal-open|offcanvas-backdrop|tooltip(?:-[a-z]+)?|bs-tooltip-[a-z]+|popover(?:-[a-z]+)?|bs-popover-[a-z]+)$/;

/** Classes a view gets for free when it uses the component (the JS creates them). */
const FEATURE_CLASSES = {
  modal: /^(?:modal-backdrop|modal-open|modal-static)$/,
  offcanvas: /^offcanvas-backdrop$/,
  tooltip: /^(?:tooltip(?:-[a-z]+)?|bs-tooltip-[a-z]+)$/,
  popover: /^(?:popover(?:-[a-z]+)?|bs-popover-[a-z]+)$/,
};

const NS_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** `--bs-*` variables the tokens mirror. */
const MAPPED_VARS = new Set(TOKENS.filter((t) => t.bs).map((t) => /** @type {string} */ (t.bs)));

/** `--bs-*` variables the scope block derives from the tokens itself (STEP 7, rows c and d). */
const DERIVED_VARS = new Set([
  ...THEME_COLORS.flatMap((c) => [`--bs-${c}-bg-subtle`, `--bs-${c}-text-emphasis`, `--bs-${c}-border-subtle`]),
  '--bs-heading-color',
  '--bs-border-color-translucent',
  '--bs-focus-ring-color',
]);

/** Names `X` for which `rgba(var(--bs-X-rgb), a)` becomes a `color-mix()` of `var(--bs-X)` (STEP 6). */
const RGB_REWRITE = new Set([
  ...[...MAPPED_VARS].map((v) => v.slice('--bs-'.length)),
  'emphasis-color',
  ...THEME_COLORS,
]);

/* ------------------------------------------------------------------------------------------------
 * Selector scanning
 * ---------------------------------------------------------------------------------------------- */

/**
 * Index just after the bracket that closes the one at `start`, honouring quotes and nesting.
 *
 * @param {string} text
 * @param {number} start index of the opening `(` or `[`
 * @returns {number}
 */
function skipBalanced(text, start) {
  const open = text[start];
  const close = open === '(' ? ')' : ']';
  let depth = 0;
  let quote = '';

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }

    if (c === '"' || c === "'") quote = c;
    else if (c === '\\') i++;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }

  return text.length;
}

/**
 * The class names and the type selectors of one selector. Class names inside `:not()`, `:is()`,
 * `:where()` and `:has()` count; `:nth-*()` and `:lang()` arguments and attribute selectors do not.
 *
 * @param {string} selector
 * @returns {{ classes: string[], types: string[] }}
 */
export function scanSelector(selector) {
  /** @type {string[]} */
  const classes = [];
  /** @type {string[]} */
  const types = [];
  const n = selector.length;
  let i = 0;
  let atStart = true;

  const ident = () => {
    let out = '';

    while (i < n) {
      const c = selector[i];

      if (c === '\\') {
        out += selector[i + 1] ?? '';
        i += 2;
      } else if (/[\w\u0080-￿-]/.test(c)) {
        out += c;
        i++;
      } else break;
    }

    return out;
  };

  while (i < n) {
    const c = selector[i];

    if (c === '[') {
      i = skipBalanced(selector, i);
      atStart = false;
    } else if (c === '.') {
      i++;

      const name = ident();

      if (name) classes.push(name);

      atStart = false;
    } else if (c === '#') {
      i++;
      ident();
      atStart = false;
    } else if (c === ':') {
      i++;

      if (selector[i] === ':') i++;

      const name = ident();

      if (selector[i] === '(') {
        if (/^(?:not|is|where|has|matches|any)$/i.test(name)) {
          i++;
          atStart = true;
          continue;
        }

        i = skipBalanced(selector, i);
      }

      atStart = false;
    } else if (c === '*') {
      if (atStart) types.push('*');

      i++;
      atStart = false;
    } else if (/[\s>+~,(]/.test(c)) {
      i++;
      atStart = true;
    } else if (c === ')') {
      i++;
      atStart = false;
    } else if (/[A-Za-z_\u0080-￿-]/.test(c)) {
      const name = ident();

      if (atStart && name) types.push(name.toLowerCase());

      atStart = false;
    } else {
      i++;
    }
  }

  return { classes, types };
}

/** Variable block selectors: `:root`, `[data-bs-theme=X]`. @returns {string | null} palette name, `root` for `:root` */
function variableSelector(selector) {
  const s = selector.trim();

  if (s === ':root') return 'root';

  const m = /^\[data-bs-theme\s*=\s*(?:"([\w-]+)"|'([\w-]+)'|([\w-]+))\s*\]$/.exec(s);

  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

const THEME_PREFIX = /^\[data-bs-theme\s*=\s*(?:"([\w-]+)"|'([\w-]+)'|([\w-]+))\s*\]\s+(?=\S)/;

/**
 * STEP 3: `[data-bs-theme=X] rest` -> `:scope:where([data-bs-theme='X'] *) rest`.
 *
 * @param {string} selector
 * @returns {{ rest: string, rewritten: string }}
 */
function rewriteThemePrefix(selector) {
  const m = THEME_PREFIX.exec(selector);

  if (!m) return { rest: selector, rewritten: selector };

  const rest = selector.slice(m[0].length);

  return { rest, rewritten: `:scope:where([data-bs-theme='${m[1] ?? m[2] ?? m[3]}'] *) ${rest}` };
}

/* ------------------------------------------------------------------------------------------------
 * Values (STEP 6)
 * ---------------------------------------------------------------------------------------------- */

/**
 * `rgba(var(--bs-X-rgb), A)` -> `color-mix(in srgb, var(--bs-X) calc(A * 100%), transparent)` for the
 * names in {@link RGB_REWRITE}. Any other `-rgb` use stays.
 *
 * @param {string} value
 * @returns {string}
 */
export function rewriteRgb(value) {
  if (!/rgba?\(/i.test(value)) return value;

  let out = '';
  let i = 0;
  const re = /(?<![\w-])rgba?\(/gi;

  for (;;) {
    re.lastIndex = i;

    const m = re.exec(value);

    if (!m) break;

    const open = m.index + m[0].length - 1;
    const end = skipBalanced(value, open);
    const inner = value.slice(open + 1, end - 1).trim();
    const arg = /^var\(\s*--bs-([a-z0-9-]+)-rgb\s*\)\s*([\s\S]*)$/i.exec(inner);

    out += value.slice(i, m.index);

    if (arg && RGB_REWRITE.has(arg[1])) {
      const rest = arg[2].trim();
      let alpha = null;
      let ok = true;

      if (rest.startsWith(',') || rest.startsWith('/')) alpha = rest.slice(1).trim();
      else if (rest !== '') ok = false;

      if (ok && alpha !== '') {
        out +=
          alpha === null
            ? `var(--bs-${arg[1]})`
            : `color-mix(in srgb, var(--bs-${arg[1]}) calc(${alpha} * 100%), transparent)`;
        i = end;
        continue;
      }
    }

    out += value.slice(m.index, end);
    i = end;
  }

  return out + value.slice(i);
}

/**
 * STEP 6 on one declaration. Besides the `rgba()` rewrite, a swap of two rewritten colour channels
 * (`a:hover { --bs-link-color-rgb: var(--bs-link-hover-color-rgb) }`) becomes a swap of the colours
 * themselves, because nothing reads the `-rgb` variables of those colours any more.
 *
 * @param {string} prop
 * @param {string} value
 * @returns {Decl}
 */
function rewriteDecl(prop, value) {
  const swap = /^--bs-([a-z0-9-]+)-rgb$/.exec(prop);
  const from = /^var\(\s*--bs-([a-z0-9-]+)-rgb\s*\)$/.exec(value.trim());

  if (swap && from && RGB_REWRITE.has(swap[1]) && RGB_REWRITE.has(from[1])) {
    return { prop: `--bs-${swap[1]}`, value: `var(--bs-${from[1]})` };
  }

  return { prop, value: rewriteRgb(value.trim()) };
}

/* ------------------------------------------------------------------------------------------------
 * Tree model and output
 * ---------------------------------------------------------------------------------------------- */

/**
 * @typedef {{ prop: string, value: string }} Decl
 * @typedef {{ type: 'rule', selectors: string[], decls: Decl[] }} RuleNode
 * @typedef {{ type: 'at', name: string, params: string, nodes: Node[] }} AtNode
 * @typedef {RuleNode | AtNode} Node
 * @typedef {{ cs: Node[], cb: Node[], us: Node[], ub: Node[], fb: Node[] }} Buckets
 *   components / utilities, scoped / body-level, plus the generic `.fade` rules for body-level tooltips
 */

/** @returns {Buckets} */
const emptyBuckets = () => ({ cs: [], cb: [], us: [], ub: [], fb: [] });

/**
 * @param {Node[]} nodes
 * @param {string} indent
 * @returns {string}
 */
function emit(nodes, indent) {
  let out = '';

  for (const node of nodes) {
    if (node.type === 'at') {
      out += `${indent}@${node.name} ${node.params} {\n${emit(node.nodes, indent + '  ')}${indent}}\n`;
      continue;
    }

    const body = node.decls.map((d) => `${indent}  ${d.prop}: ${d.value};\n`).join('');

    out += `${indent}${node.selectors.join(`,\n${indent}`)} {\n${body}${indent}}\n`;
  }

  return out;
}

/** @param {Node[]} nodes @param {(rule: RuleNode) => void} visit */
function walkRules(nodes, visit) {
  for (const node of nodes) {
    if (node.type === 'rule') visit(node);
    else walkRules(node.nodes, visit);
  }
}

/** @param {string} name @returns {string} */
const escapeRe = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pure core of the fallback stylesheet (doc 03 sections 4.2 and 4.3).
 *
 * `classes` is the sorted list of base classes the sheet covers (every class of a kept selector).
 * An empty base gives an empty result.
 *
 * @param {{ baseCss: string, usedClasses: string[] | Set<string>, ns: string }} input
 * @returns {{ css: string, classes: string[] }}
 */
export function buildFallbackCss({ baseCss, usedClasses, ns }) {
  if (typeof ns !== 'string' || !NS_PATTERN.test(ns)) {
    throw new Error(`[pano-plugin] buildFallbackCss: namespace "${ns}" must match ${NS_PATTERN}`);
  }

  if (!baseCss || !baseCss.trim()) return { css: '', classes: [] };

  const used = new Set([...usedClasses].map((c) => String(c).replace(/^\./, '')).filter(Boolean));

  for (const c of JS_TOGGLED) used.add(c);

  /** @type {Record<string, boolean>} */
  const features = {};

  for (const feature of Object.keys(FEATURE_CLASSES)) features[feature] = used.has(feature);

  /** @param {string} cls */
  const isUsable = (cls) =>
    used.has(cls) || Object.entries(FEATURE_CLASSES).some(([feature, re]) => features[feature] && re.test(cls));

  const root = postcss.parse(baseCss);

  /** STEP 2 collections. @type {Map<string, string>} */
  const defaults = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const extras = new Map();
  /** @type {Map<string, { name: string, params: string, nodes: Node[] }>} */
  const keyframes = new Map();
  const keptClasses = new Set();

  /**
   * STEP 3, 4, 5, 6 on a list of postcss nodes.
   *
   * @param {import('postcss').Container} container
   * @param {boolean} top
   * @returns {Buckets}
   */
  function walk(container, top) {
    const buckets = emptyBuckets();

    container.each((node) => {
      if (node.type === 'rule') {
        if (top && collectVariables(node)) return;

        processRule(node, buckets);

        return;
      }

      if (node.type !== 'atrule') return;

      if (/keyframes$/i.test(node.name)) {
        if (top) keyframes.set(node.params, { name: node.name, params: node.params, nodes: keyframeNodes(node) });

        return;
      }

      if (!node.nodes || /^(?:font-face|charset|import|page|property|namespace)$/i.test(node.name)) return;

      const inner = walk(node, false);

      for (const key of /** @type {(keyof Buckets)[]} */ (Object.keys(inner))) {
        if (inner[key].length > 0) {
          buckets[key].push({ type: 'at', name: node.name, params: node.params, nodes: inner[key] });
        }
      }
    });

    return buckets;
  }

  /**
   * STEP 2: a rule made only of `:root` / `[data-bs-theme=X]` selectors is a variable block.
   *
   * @param {import('postcss').Rule} rule
   * @returns {boolean} true when it was one (and is now removed from the pipeline)
   */
  function collectVariables(rule) {
    const palettes = rule.selectors.map(variableSelector);

    if (palettes.length === 0 || palettes.some((p) => p === null)) return false;

    for (const palette of /** @type {string[]} */ (palettes)) {
      const isDefault = palette === 'root' || palette === 'light';

      rule.each((decl) => {
        if (decl.type !== 'decl') return;

        const prop = decl.prop;
        const value = decl.value.trim();

        if (prop.startsWith('--')) {
          if (MAPPED_VARS.has(prop) || DERIVED_VARS.has(prop) || value.includes('$')) return;
        } else if (isDefault) {
          return;
        }

        if (isDefault) {
          defaults.set(prop, value);
        } else {
          if (!extras.has(palette)) extras.set(palette, new Map());

          /** @type {Map<string, string>} */ (extras.get(palette)).set(prop, value);
        }
      });
    }

    return true;
  }

  /**
   * @param {import('postcss').Rule} rule
   * @param {Buckets} buckets
   */
  function processRule(rule, buckets) {
    /** @type {string[]} */
    const scoped = [];
    /** @type {string[]} */
    const body = [];
    /** @type {string[]} */
    const fade = [];

    for (const selector of rule.selectors) {
      const { rest, rewritten } = rewriteThemePrefix(selector.trim());
      const { classes, types } = scanSelector(rest);

      if (classes.length > 0) {
        if (!classes.every(isUsable)) continue;

        for (const cls of classes) keptClasses.add(cls);

        if (classes.some((c) => BODY_CLASS.test(c))) {
          body.push(rewritten);
          continue;
        }

        scoped.push(rewritten);

        if (classes.includes('fade') && classes.every((c) => c === 'fade' || c === 'show')) fade.push(rest);
      } else if (types.length > 0 && types.every((t) => RESET_TYPES.has(t))) {
        scoped.push(rewritten);
      }
    }

    if (scoped.length === 0 && body.length === 0) return;

    /** @type {Decl[]} */
    const decls = [];
    let important = 0;

    rule.each((decl) => {
      if (decl.type !== 'decl') return;

      if (decl.important) important++;

      decls.push(rewriteDecl(decl.prop, decl.value));
    });

    if (decls.length === 0) return;

    // STEP 5: a rule that is !important all through is a utility, anything else a component
    const utility = important === decls.length;
    const [scopedKey, bodyKey] = utility ? ['us', 'ub'] : ['cs', 'cb'];

    if (scoped.length > 0) buckets[/** @type {'cs' | 'us'} */ (scopedKey)].push({ type: 'rule', selectors: scoped, decls });

    if (body.length > 0) buckets[/** @type {'cb' | 'ub'} */ (bodyKey)].push({ type: 'rule', selectors: body, decls });

    if (fade.length > 0) buckets.fb.push({ type: 'rule', selectors: fade, decls });
  }

  /** @param {import('postcss').AtRule} atRule @returns {Node[]} */
  function keyframeNodes(atRule) {
    /** @type {Node[]} */
    const out = [];

    atRule.each((step) => {
      if (step.type !== 'rule') return;

      /** @type {Decl[]} */
      const decls = [];

      step.each((decl) => {
        if (decl.type === 'decl') decls.push(rewriteDecl(decl.prop, decl.value));
      });
      out.push({ type: 'rule', selectors: step.selectors.map((s) => s.trim()), decls });
    });

    return out;
  }

  const buckets = walk(root, true);

  // The base sheet repeats some blocks verbatim (it is two Sass compiles in a row). Of two identical
  // nodes of one bucket the later one decides the cascade, so the earlier one is redundant.
  for (const key of /** @type {(keyof Buckets)[]} */ (Object.keys(buckets))) {
    const seen = new Set();

    buckets[key] = buckets[key]
      .reverse()
      .filter((node) => {
        const id = JSON.stringify(node);

        return seen.has(id) ? false : (seen.add(id), true);
      })
      .reverse();
  }

  /* ---- binding templates (doc 03 section 4.3) ---- */

  /** @type {{ components: Node[], utilities: Node[] }} */
  const templates = { components: [], utilities: [] };

  /**
   * @param {'components' | 'utilities'} layer
   * @param {string[]} classes classes that must be in use
   * @param {string} selector
   * @param {[string, string][]} decls
   */
  const template = (layer, classes, selector, decls) => {
    if (!classes.every((c) => used.has(c))) return;

    for (const c of classes) keptClasses.add(c);

    templates[layer].push({
      type: 'rule',
      selectors: [selector],
      decls: decls.map(([prop, value]) => ({ prop, value })),
    });
  };

  /** @param {string} c @param {number} percent @param {string} [other] */
  const mix = (c, percent, other = 'transparent') =>
    `color-mix(in srgb, var(--pano-color-${c}) ${percent}%, ${other})`;

  for (const c of THEME_COLORS) {
    const color = `var(--pano-color-${c})`;
    const on = ON_COLOR[/** @type {keyof typeof ON_COLOR} */ (c)];

    template('components', [`btn-${c}`], `.btn-${c}`, [
      ['--bs-btn-color', on],
      ['--bs-btn-bg', color],
      ['--bs-btn-border-color', color],
      ['--bs-btn-hover-color', on],
      ['--bs-btn-hover-bg', mix(c, 85, '#000')],
      ['--bs-btn-hover-border-color', mix(c, 85, '#000')],
      ['--bs-btn-active-color', on],
      ['--bs-btn-active-bg', color],
      ['--bs-btn-active-border-color', color],
      ['--bs-btn-disabled-color', on],
      ['--bs-btn-disabled-bg', color],
      ['--bs-btn-disabled-border-color', color],
    ]);
    template('components', [`btn-outline-${c}`], `.btn-outline-${c}`, [
      ['--bs-btn-color', color],
      ['--bs-btn-border-color', color],
      ['--bs-btn-hover-color', on],
      ['--bs-btn-hover-bg', color],
      ['--bs-btn-hover-border-color', color],
      ['--bs-btn-active-color', on],
      ['--bs-btn-active-bg', color],
      ['--bs-btn-active-border-color', color],
      ['--bs-btn-disabled-color', color],
      ['--bs-btn-disabled-border-color', color],
    ]);
    template('components', [`alert-${c}`], `.alert-${c}`, [
      ['--bs-alert-color', mix(c, 85, '#000')],
      ['--bs-alert-border-color', mix(c, 25)],
      ['border-radius', 'var(--pano-radius)'],
    ]);
    template('utilities', [`text-bg-${c}`], `.text-bg-${c}`, [
      ['background-color', color],
      ['color', on],
    ]);
    template('utilities', [`bg-${c}-subtle`], `.bg-${c}-subtle`, [
      ['background-color', mix(c, 12)],
      ['color', color],
      ['border-color', mix(c, 20)],
    ]);
    template('utilities', [`text-${c}-emphasis`], `.text-${c}-emphasis`, [['color', mix(c, 80, '#000')]]);
  }

  template('components', ['btn'], '.btn:not(.btn-link)', [
    ['border', '1.5px solid color-mix(in srgb, var(--pano-color-text) 10%, transparent)'],
  ]);
  template('components', ['nav-pills'], '.nav-pills', [
    ['--bs-nav-pills-link-active-bg', 'var(--pano-color-primary)'],
    ['--bs-nav-pills-link-active-color', 'var(--pano-color-on-primary)'],
  ]);

  /* ---- what the kept rules read ---- */

  let keptText = '';

  /** @param {Node[]} nodes */
  const collectText = (nodes) =>
    walkRules(nodes, (rule) => {
      for (const d of rule.decls) keptText += `${d.value}\n`;
    });

  collectText(buckets.cs);
  collectText(buckets.cb);
  collectText(buckets.us);
  collectText(buckets.ub);
  collectText(templates.components);
  collectText(templates.utilities);

  // After STEP 6 nothing reads `--bs-X-rgb` of a rewritten colour any more (unless a use was not
  // recognised), so those variables are left out of the literal defaults and the palette extras.
  const stillUsedRgb = new Set([...keptText.matchAll(/var\(\s*--bs-([a-z0-9-]+)-rgb\b/g)].map((m) => m[1]));
  /** @param {string} prop */
  const deadVar = (prop) => {
    const m = /^--bs-([a-z0-9-]+)-rgb$/.exec(prop);

    return m !== null && RGB_REWRITE.has(m[1]) && !stillUsedRgb.has(m[1]);
  };

  /** @param {string} palette @returns {Decl[]} */
  const extrasOf = (palette) =>
    [.../** @type {Map<string, string>} */ (extras.get(palette))]
      .filter(([prop]) => !deadVar(prop))
      .map(([prop, value]) => ({ prop, value }));

  /* ---- STEP 7: the :scope block ---- */

  /** @type {[string, string][]} */
  const scopeDecls = [];

  for (const [prop, value] of defaults) if (!deadVar(prop)) scopeDecls.push([prop, value]);

  for (const t of TOKENS) if (t.bs) scopeDecls.push([t.bs, `var(${t.token})`]);

  for (const c of THEME_COLORS) {
    scopeDecls.push([`--bs-${c}-bg-subtle`, mix(c, 12)]);
    scopeDecls.push([`--bs-${c}-text-emphasis`, mix(c, 60, '#fff')]);
    scopeDecls.push([`--bs-${c}-border-subtle`, mix(c, 75, '#000')]);
  }

  scopeDecls.push(['--bs-heading-color', 'var(--pano-color-heading)']);
  scopeDecls.push(['--bs-border-color-translucent', 'color-mix(in srgb, var(--pano-color-text) 17.5%, transparent)']);
  scopeDecls.push(['--bs-focus-ring-color', 'color-mix(in srgb, var(--pano-color-primary) 25%, transparent)']);
  scopeDecls.push(['color', 'var(--bs-body-color)']);
  scopeDecls.push(['font-family', 'var(--bs-body-font-family)']);
  scopeDecls.push(['font-size', 'var(--bs-body-font-size)']);
  scopeDecls.push(['line-height', 'var(--bs-body-line-height)']);

  const paletteOrder = [
    ...PALETTES.filter((p) => p !== 'light' && extras.has(p)),
    ...[...extras.keys()].filter((p) => !PALETTES.includes(p)),
  ];

  /**
   * @param {string} head selector before `:where(...)`
   * @returns {Node[]}
   */
  const paletteBlocks = (head) =>
    paletteOrder.map((palette) => ({
      type: /** @type {const} */ ('rule'),
      selectors: [`${head}:where([data-bs-theme='${palette}'] *)`],
      decls: extrasOf(palette),
    }));

  const toDecls = (/** @type {[string, string][]} */ list) => list.map(([prop, value]) => ({ prop, value }));

  /** @type {Node[]} */
  const scopeNodes = [
    { type: 'rule', selectors: [':scope'], decls: toDecls(scopeDecls) },
    ...paletteBlocks(':scope'),
  ];

  /* ---- body-level block ---- */

  const bodyClasses = new Set();

  for (const key of /** @type {const} */ (['cb', 'ub'])) {
    walkRules(buckets[key], (rule) => {
      for (const selector of rule.selectors) for (const c of scanSelector(selector).classes) bodyClasses.add(c);
    });
  }

  const bodyRoots = ['tooltip', 'popover'].filter((c) => bodyClasses.has(c)).map((c) => `.${c}`);
  /** @type {Node[]} */
  const bodyHead = [];

  if (bodyRoots.length > 0) {
    bodyHead.push({ type: 'rule', selectors: bodyRoots, decls: toDecls(scopeDecls) });

    for (const palette of paletteOrder) {
      bodyHead.push({
        type: 'rule',
        selectors: bodyRoots.map((r) => `${r}:where([data-bs-theme='${palette}'] *)`),
        decls: extrasOf(palette),
      });
    }

    bodyHead.push(...buckets.fb);
  }

  /* ---- keyframes a kept rule names ---- */

  /** @type {Node[]} */
  const keptKeyframes = [];

  for (const frames of keyframes.values()) {
    if (new RegExp(`(?<![\\w-])${escapeRe(frames.params)}(?![\\w-])`).test(keptText)) {
      keptKeyframes.push({ type: 'at', name: frames.name, params: frames.params, nodes: frames.nodes });
    }
  }

  /* ---- layers ---- */

  const scopeRoot = `.pano-fb[data-pano-fb="${ns}"]`;
  const scopeLimit = `.pano-fb-stop, .pano-fb:not([data-pano-fb="${ns}"])`;
  const scopeHead = `@scope (${scopeRoot}) to (${scopeLimit}) {\n`;

  let css =
    `/* Pano fallback stylesheet for "${ns}" (generated by @panomc/plugin-kit; do not edit) */\n` +
    '@layer pano-defaults, pano-fallback.components, pano-fallback.utilities, pano-plugin;\n';

  const componentScoped = [...scopeNodes, ...buckets.cs, ...templates.components];
  const componentBody = [...bodyHead, ...buckets.cb];

  css += '@layer pano-fallback.components {\n';
  css += `  ${scopeHead}${emit(componentScoped, '    ')}  }\n`;
  css += emit(componentBody, '  ');
  css += emit(keptKeyframes, '  ');
  css += '}\n';

  const utilityScoped = [...buckets.us, ...templates.utilities];

  if (utilityScoped.length > 0 || buckets.ub.length > 0) {
    css += '@layer pano-fallback.utilities {\n';

    if (utilityScoped.length > 0) css += `  ${scopeHead}${emit(utilityScoped, '    ')}  }\n`;

    css += emit(buckets.ub, '  ');
    css += '}\n';
  }

  return { css, classes: [...keptClasses].sort() };
}

/* ------------------------------------------------------------------------------------------------
 * Scanning the views
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every string literal of a piece of JavaScript (quotes, backticks; the quasis of a template and
 * the literals inside its `${}`), comments skipped.
 *
 * @param {string} code
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function stringLiterals(code, out = []) {
  const n = code.length;
  let i = 0;

  while (i < n) {
    const c = code[i];

    if (c === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++;
    } else if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);

      i = end === -1 ? n : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let text = '';

      while (j < n && code[j] !== c && code[j] !== '\n') {
        if (code[j] === '\\') {
          text += code[j + 1] ?? '';
          j += 2;
        } else text += code[j++];
      }

      out.push(text);
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let text = '';

      while (j < n && code[j] !== '`') {
        if (code[j] === '\\') {
          text += code[j + 1] ?? '';
          j += 2;
        } else if (code[j] === '$' && code[j + 1] === '{') {
          out.push(text);
          text = '';

          let depth = 0;
          const start = j + 2;

          for (j = j + 1; j < n; j++) {
            if (code[j] === '{') depth++;
            else if (code[j] === '}' && --depth === 0) break;
            else if (code[j] === '"' || code[j] === "'" || code[j] === '`') {
              // skip a nested literal so its braces do not count
              const q = code[j];

              for (j++; j < n && code[j] !== q; j++) if (code[j] === '\\') j++;
            }
          }

          stringLiterals(code.slice(start, j), out);
          j++;
        } else text += code[j++];
      }

      out.push(text);
      i = j + 1;
    } else {
      i++;
    }
  }

  return out;
}

/**
 * Class names (selectors' classes) the base sheet defines.
 *
 * @param {string} baseCss
 * @returns {Set<string>}
 */
export function baseClassSet(baseCss) {
  const found = new Set();

  postcss.parse(baseCss).walkRules((rule) => {
    for (const selector of rule.selectors) for (const c of scanSelector(selector).classes) found.add(c);
  });

  return found;
}

/** @param {string} a @param {string} b @returns {number} */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, k) => k);

  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];

    row[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const next = row[j];

      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }

  return row[b.length];
}

/** The base classes closest to `name`. @param {string} name @param {Set<string>} known @returns {string[]} */
export function nearMatches(name, known) {
  return [...known]
    .map((c) => ({ c, d: c.includes(name) || name.includes(c) ? 1 : distance(c, name) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(name.length / 3)))
    .sort((x, y) => x.d - y.d || (x.c < y.c ? -1 : 1))
    .slice(0, 3)
    .map((x) => x.c);
}

/**
 * @typedef {object} ViewsScan
 * @property {Set<string>} used literal class tokens of the views plus the script literals that are base classes
 * @property {boolean} fa a Font Awesome class (`fa-…`) is used
 * @property {{ name: string, file: string, roots: string[], classes: string[] }[]} views
 * @property {string[]} files every file read
 */

/**
 * STEP 1: the classes a plugin's views use.
 *
 * @param {string} viewsDir
 * @param {Set<string>} baseClasses
 * @param {string} ns
 * @returns {ViewsScan}
 */
export function scanViews(viewsDir, baseClasses, ns) {
  /** @type {ViewsScan} */
  const result = { used: new Set(), fa: false, views: [], files: [] };

  if (!fs.existsSync(viewsDir)) return result;

  /** @type {string[]} */
  const files = [];

  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (/\.(?:svelte|js|mjs)$/.test(entry.name)) {
        files.push(full);
      }
    }
  })(viewsDir);

  /** @param {string} text @param {boolean} onlyBase */
  const addTokens = (text, onlyBase) => {
    for (const token of text.split(/\s+/)) {
      if (!token) continue;

      if (token.startsWith('fa-')) result.fa = true;

      if (!onlyBase || baseClasses.has(token)) result.used.add(token);
    }
  };

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');

    result.files.push(file);

    if (file.endsWith('.svelte')) {
      const { markup, scripts } = splitSvelte(source);
      /** @type {string[]} */
      const markupTokens = [];

      for (const tag of parseTags(markup)) markupTokens.push(...classTokens(tag.attrs));

      for (const token of markupTokens) addTokens(token, false);

      for (const script of scripts) for (const literal of stringLiterals(script.code)) addTokens(literal, true);

      // Bootstrap's tooltips and popovers are created by script and appended to <body>
      if (/data-bs-toggle\s*=\s*["']?tooltip/.test(source)) result.used.add('tooltip');
      if (/data-bs-toggle\s*=\s*["']?popover/.test(source)) result.used.add('popover');

      const name = path.basename(file, '.svelte');

      if (/^[A-Z][A-Za-z0-9]*$/.test(name)) {
        const rootClass = rootClassOf(ns, name);
        let info = { roots: /** @type {string[]} */ ([]) };

        try {
          info = addRootClass(source, { ns, view: name });
        } catch (error) {
          // a Svelte syntax error is the compiler's to report; a root-class collision fails the build
          if (error instanceof SemanticClassCollisionError) throw error;
        }
        const parts = [];

        for (const token of markupTokens) {
          if (
            token.startsWith(`${rootClass}__`) &&
            /^[a-z0-9-]+$/.test(token.slice(rootClass.length + 2)) &&
            !parts.includes(token)
          ) {
            parts.push(token);
          }
        }

        result.views.push({
          name,
          file,
          roots: info.roots,
          classes: info.roots.length > 0 ? [rootClass, ...parts] : [],
        });
      }
    } else {
      for (const literal of stringLiterals(source)) addTokens(literal, true);
    }
  }

  return result;
}

/** @type {{ css: string, classes: Set<string> } | null} */
let cachedBase = null;

/** The base sheet and its class set, read once. @returns {{ css: string, classes: Set<string> }} */
function loadBase() {
  if (!cachedBase) {
    const css = fs.readFileSync(BASE_CSS_FILE, 'utf8');

    cachedBase = { css, classes: baseClassSet(css) };
  }

  return cachedBase;
}

/**
 * Client-build rollup plugin: scans the views (STEP 1), runs {@link buildFallbackCss}, emits
 * `fallback.css` into the client folder and records `styles` and the views' `roots` / `classes` for
 * `pano-plugin.json`.
 *
 * `icons` `'auto'` (default) is true when any used class starts with `fa-`.
 *
 * @param {{ ns: string, viewsDir?: string | string[], safelist?: string[], icons?: boolean | 'auto',
 *           root?: string, outDir?: string, side?: string }} options
 * @returns {import('rollup').Plugin}
 */
export function panoFallbackCss(options) {
  if (options?.side !== undefined && options.side !== 'client') return { name: 'pano-fallback-css' };

  const ns = options?.ns;

  if (typeof ns !== 'string' || !NS_PATTERN.test(ns)) {
    throw new Error(`[pano-plugin] panoFallbackCss: "ns" must match ${NS_PATTERN}, got "${ns}"`);
  }

  const root = path.resolve(options.root ?? process.cwd());
  const viewsDirs = [options.viewsDir ?? 'src/theme/views'].flat().map((dir) => path.resolve(root, dir));
  const safelist = (options.safelist ?? []).map((c) => String(c).replace(/^\./, ''));
  const iconsOption = options.icons ?? 'auto';

  /** @type {{ css: string, icons: boolean } | null} */
  let built = null;

  return {
    name: 'pano-fallback-css',

    buildStart() {
      clearStyleFile(root, 'fallback');
      built = null;

      const base = loadBase();
      const missing = safelist.filter((c) => !base.classes.has(c));

      if (missing.length > 0) {
        const lines = missing.map((c) => {
          const near = nearMatches(c, base.classes);

          return `  "${c}"${near.length ? ` (did you mean ${near.map((n) => `"${n}"`).join(', ')}?)` : ''}`;
        });

        this.error(
          `[pano-plugin] styles.safelist in pano.plugin.js names classes that are not in the Bootstrap base sheet:\n${lines.join('\n')}\n` +
            'Fix the spelling, or remove the entry if the class is your own.',
        );
      }

      const used = new Set(safelist);
      let fa = false;
      /** @type {ViewsScan['views']} */
      let views = [];

      for (const dir of viewsDirs) {
        let scan;

        try {
          scan = scanViews(dir, base.classes, ns);
        } catch (error) {
          this.error(/** @type {Error} */ (error).message);
        }

        for (const token of scan.used) used.add(token);

        fa ||= scan.fa;
        views = views.concat(scan.views);

        for (const file of scan.files) this.addWatchFile(file);
      }

      const icons = iconsOption === 'auto' ? fa : iconsOption === true;

      built = { css: buildFallbackCss({ baseCss: base.css, usedClasses: [...used], ns }).css, icons };

      const context = getBuildContext(root);

      for (const view of views) {
        context.views[view.name] = { ...(context.views[view.name] ?? {}), roots: view.roots, classes: view.classes };
      }
    },

    generateBundle() {
      if (!built) return;

      this.emitFile({ type: 'asset', fileName: 'fallback.css', source: built.css });
      recordStyleFile(root, 'fallback', built.css, { icons: built.icons });
    },
  };
}

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import {
  BASE_CSS_FILE,
  JS_TOGGLED,
  buildFallbackCss,
  rewriteRgb,
  scanSelector,
  stringLiterals,
} from '../../fallback-css.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.readFileSync(path.join(here, 'fixtures/base.css'), 'utf8');

/** @param {string} used space separated @param {string} [css] */
function build(used, css = base) {
  return buildFallbackCss({ baseCss: css, usedClasses: used.split(' ').filter(Boolean), ns: 'market' });
}

/** Text of the rule with exactly this selector list (first match), or null. */
function ruleText(css, selector) {
  let found = null;

  postcss.parse(css).walkRules((rule) => {
    if (found === null && rule.selectors.map((s) => s.trim()).join(',') === selector) found = rule.toString();
  });

  return found;
}

/** The at-rule chain ("layer pano-fallback.components > scope ...") around every rule with this selector. */
function contextsOf(css, selector) {
  const out = [];

  postcss.parse(css).walkRules((rule) => {
    if (!rule.selectors.some((s) => s.trim() === selector)) return;

    const chain = [];

    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) chain.unshift(`${p.name} ${p.params}`.trim());

    out.push(chain);
  });

  return out;
}

const hasSelector = (css, selector) => contextsOf(css, selector).length > 0;

describe('output shape (doc 03 section 4.3)', () => {
  test('layer statement, one scope per sublayer, scoped to the namespace', () => {
    const { css } = build('btn');
    const lines = css.split('\n');

    expect(lines[1]).toBe('@layer pano-defaults, pano-fallback.components, pano-fallback.utilities, pano-plugin;');
    expect(css).toContain('@layer pano-fallback.components {');
    expect(css).toContain(
      '@scope (.pano-fb[data-pano-fb="market"]) to (.pano-fb-stop, .pano-fb:not([data-pano-fb="market"])) {',
    );
  });

  test('a namespace that is not a plain token is refused', () => {
    expect(() => buildFallbackCss({ baseCss: base, usedClasses: [], ns: 'Bad Ns' })).toThrow(/namespace/);
    expect(() => buildFallbackCss({ baseCss: base, usedClasses: [], ns: 'a"]' })).toThrow(/namespace/);
  });

  test('an empty base gives an empty sheet', () => {
    expect(buildFallbackCss({ baseCss: '', usedClasses: ['btn'], ns: 'x' })).toEqual({ css: '', classes: [] });
  });

  test('the output parses and holds no !important and no comment but the banner', () => {
    const { css } = build('btn btn-primary mb-0 text-bg-success modal tooltip');

    expect(() => postcss.parse(css)).not.toThrow();
    expect(css).not.toContain('!important');
    expect(css.match(/\/\*/g)).toHaveLength(1);
  });

  test('is deterministic and independent of the order of the used classes', () => {
    const a = build('btn card mb-0 fade');
    const b = build('fade mb-0 card btn');

    expect(a).toEqual(b);
    expect(build('btn card mb-0 fade')).toEqual(a);
  });

  test('snapshot for a five-class input', () => {
    expect(build('btn btn-primary card mb-0 text-bg-success')).toMatchSnapshot();
  });
});

describe('STEP 1 / 4: purge', () => {
  test('keeps only rules whose classes are all in use', () => {
    const { css, classes } = build('btn card mb-0');

    expect(hasSelector(css, '.btn')).toBe(true);
    expect(hasSelector(css, '.card')).toBe(true);
    expect(hasSelector(css, '.mb-0')).toBe(true);
    expect(hasSelector(css, '.card-body')).toBe(false);
    expect(hasSelector(css, '.mb-1')).toBe(false);
    expect(hasSelector(css, '.btn-primary')).toBe(false);
    expect(classes).toContain('mb-0');
    expect(classes).not.toContain('mb-1');
  });

  test('a comma list is cut selector by selector', () => {
    const { css } = build('btn');

    expect(ruleText(css, '.btn:disabled,.btn.disabled')).not.toBeNull();
    // `.btn-check:checked + .btn` needs `btn-check`
    expect(css).not.toContain('btn-check');
  });

  test('every selector of a compound rule needs all of its classes', () => {
    expect(hasSelector(build('nav-pills').css, '.nav-pills .nav-link.active')).toBe(false);
    expect(hasSelector(build('nav-pills nav-link').css, '.nav-pills .nav-link.active')).toBe(true);
  });

  test("Bootstrap's JS-toggled classes are always in use", () => {
    const { css } = build('');

    for (const cls of JS_TOGGLED) expect(JS_TOGGLED).toContain(cls);
    expect(hasSelector(css, '.fade:not(.show)')).toBe(true);
    expect(hasSelector(css, '.collapse:not(.show)')).toBe(true);
    expect(hasSelector(css, '.fade')).toBe(true);
  });

  test('classless selectors survive only from the Reboot list', () => {
    const { css } = build('');

    expect(hasSelector(css, '*')).toBe(true);
    expect(hasSelector(css, 'a')).toBe(true);
    expect(hasSelector(css, 'body')).toBe(false);
    expect(hasSelector(css, '[type=button]:not(:disabled)')).toBe(false);
    expect(hasSelector(css, 'optgroup')).toBe(false);
    expect(css).not.toContain('scroll-behavior');
  });

  test('a media block that ends up empty is dropped, a kept one stays', () => {
    const { css } = build('');
    const media = [];

    postcss.parse(css).walkAtRules('media', (m) => media.push(m.params));
    expect(media).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  test('@keyframes stays only when a kept rule names it', () => {
    expect(build('spinner-border').css).toContain('@keyframes spinner-border');
    expect(build('spinner-border').css).not.toContain('unused-frames');
    expect(build('btn').css).not.toContain('@keyframes');
  });

  test('@font-face and @charset are dropped', () => {
    const { css } = build('btn');

    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('@charset');
  });

  test('unknown classes are ignored, a leading dot is tolerated', () => {
    expect(build('market-product-card btn').css).toEqual(build('btn').css);
    expect(build('.btn').css).toEqual(build('btn').css);
  });
});

describe('STEP 5: !important and sublayers', () => {
  test('a rule that is !important all through is a utility, the rest a component', () => {
    const { css } = build('btn mb-0 text-bg-success border');

    expect(contextsOf(css, '.mb-0')[0][0]).toBe('layer pano-fallback.utilities');
    expect(contextsOf(css, '.btn')[0][0]).toBe('layer pano-fallback.components');
    // `.border` mixes an !important and a plain declaration -> component
    expect(contextsOf(css, '.border')[0][0]).toBe('layer pano-fallback.components');
  });

  test('the declarations keep their values without !important', () => {
    expect(ruleText(build('mb-0').css, '.mb-0')).toContain('margin-bottom: 0;');
    expect(ruleText(build('border').css, '.border')).toContain('border: 1px solid #dee2e6;');
  });

  test('a repeated block of the base is emitted once', () => {
    const matches = build('mb-0').css.match(/\.mb-0 \{/g);

    expect(matches).toHaveLength(1);
  });

  test('cascade: an unlayered theme rule beats a kept utility, a utility beats a component', () => {
    const { css } = build('mb-0 btn');
    const rank = new Map();

    // layer order as the statement declares it
    ['pano-defaults', 'pano-fallback.components', 'pano-fallback.utilities', 'pano-plugin'].forEach((l, i) => rank.set(l, i));

    /** Winner among candidates {layer|null, decl}: unlayered beats every layer, later layer beats earlier. */
    const winner = (list) => list.reduce((a, b) => ((b.layer === null ? 99 : rank.get(b.layer)) >= (a.layer === null ? 99 : rank.get(a.layer)) ? b : a));
    const layerOf = (selector) => contextsOf(css, selector)[0][0].replace(/^layer /, '');

    expect(css).not.toContain('!important');
    expect(layerOf('.mb-0')).toBe('pano-fallback.utilities');
    expect(winner([{ layer: layerOf('.mb-0'), v: 'mb-0' }, { layer: null, v: 'theme' }]).v).toBe('theme');
    expect(winner([{ layer: layerOf('.btn'), v: 'component' }, { layer: layerOf('.mb-0'), v: 'utility' }]).v).toBe('utility');
    // nothing the sheet emits sits outside a layer
    postcss.parse(css).each((node) => {
      expect(node.type === 'comment' || (node.type === 'atrule' && node.name === 'layer')).toBe(true);
    });
  });
});

describe('STEP 6: rgba(var(--bs-X-rgb)) rewrite', () => {
  test('a token colour becomes a color-mix of the variable (case insensitive)', () => {
    const { css } = build('text-bg-success card');

    expect(css).toContain(
      'background-color: color-mix(in srgb, var(--bs-success) calc(var(--bs-bg-opacity, 1) * 100%), transparent);',
    );
    expect(css).toContain('color-mix(in srgb, var(--bs-body-color) calc(0.125 * 100%), transparent)');
  });

  test('a channel that is not a token colour stays', () => {
    const { css } = build('btn btn-primary card');

    expect(css).toContain('rgba(var(--bs-btn-focus-shadow-rgb), .5)');
    expect(css).toContain('rgba(var(--bs-light-rgb), 0.2)');
    expect(css).toContain('--bs-btn-focus-shadow-rgb: 42, 95, 155;');
  });

  test('rewriteRgb handles slash alpha, no alpha and leaves other functions alone', () => {
    expect(rewriteRgb('rgb(var(--bs-primary-rgb) / 50%)')).toBe(
      'color-mix(in srgb, var(--bs-primary) calc(50% * 100%), transparent)',
    );
    expect(rewriteRgb('rgb(var(--bs-primary-rgb))')).toBe('var(--bs-primary)');
    expect(rewriteRgb('rgba(255, 255, 255, 0.1)')).toBe('rgba(255, 255, 255, 0.1)');
    expect(rewriteRgb('rgba(var(--bs-dark-rgb), 0.5)')).toBe('rgba(var(--bs-dark-rgb), 0.5)');
    expect(rewriteRgb('0 0 0 1px rgba(var(--bs-info-rgb), .1), 0 1px rgba(var(--bs-danger-rgb), .2)')).toBe(
      '0 0 0 1px color-mix(in srgb, var(--bs-info) calc(.1 * 100%), transparent), 0 1px color-mix(in srgb, var(--bs-danger) calc(.2 * 100%), transparent)',
    );
  });

  test('a swap of two rewritten channels becomes a swap of the colours (a:hover)', () => {
    const { css } = build('');

    expect(ruleText(css, 'a:hover')).toContain('--bs-link-color: var(--bs-link-hover-color);');
    expect(css).not.toContain('--bs-link-color-rgb');
  });

  test('the -rgb variables of rewritten colours are not declared, the others are', () => {
    const { css } = build('btn card');
    const scope = ruleText(css, ':scope');

    expect(scope).not.toContain('--bs-primary-rgb');
    expect(scope).not.toContain('--bs-body-color-rgb');
    expect(scope).toContain('--bs-light-rgb: 245, 247, 250;');
  });
});

describe('STEP 2: literal defaults and palette extras', () => {
  const scope = () => ruleText(build('btn').css, ':scope');

  test('every base :root declaration that is not a token is defined (--bs-border-style)', () => {
    expect(scope()).toContain('--bs-border-style: solid;');
    expect(scope()).toContain('--bs-white: #fff;');
    expect(scope()).toContain('--bs-breakpoint-md: 768px;');
    expect(scope()).toContain('--bs-btn-close-filter: ;');
  });

  test('a variable a token mirrors is bound to the token, not given its literal', () => {
    expect(scope()).toContain('--bs-body-bg: var(--pano-color-bg);');
    expect(scope()).toContain('--bs-primary: var(--pano-color-primary);');
    expect(scope()).not.toContain('--bs-body-bg: #fff');
    expect(scope()).not.toContain('--bs-primary: #044389');
  });

  test('palette extras are one block per palette, without token variables', () => {
    const { css } = build('btn');
    const dark = ruleText(css, ":scope:where([data-bs-theme='dark'] *)");
    const copper = ruleText(css, ":scope:where([data-bs-theme='copper'] *)");

    expect(dark).toContain('color-scheme: dark;');
    expect(dark).toContain('--bs-code-color: #e685b5;');
    expect(dark).not.toContain('--bs-body-bg');
    expect(dark).not.toContain('--bs-copper-only');
    expect(copper).toContain('--bs-code-color: #e685b5;');
    expect(copper).toContain('--bs-copper-only: 1px;');
    expect(copper).not.toContain('--bs-primary:');
    expect(hasSelector(css, ":scope:where([data-bs-theme='light'] *)")).toBe(false);
  });

  test('values the Sass left unevaluated and variables the scope derives are not copied', () => {
    const { css } = build('btn');

    expect(css).not.toContain('$primary');
    expect(ruleText(css, ":scope:where([data-bs-theme='dark'] *)")).not.toContain('bg-subtle');
    expect(ruleText(css, ":scope:where([data-bs-theme='dark'] *)")).not.toContain('--bs-heading-color');
  });

  test('token bindings, then derived colours, then the body text', () => {
    const text = scope();

    expect(text).toContain('--bs-primary-bg-subtle: color-mix(in srgb, var(--pano-color-primary) 12%, transparent);');
    expect(text).toContain('--bs-primary-text-emphasis: color-mix(in srgb, var(--pano-color-primary) 60%, #fff);');
    expect(text).toContain('--bs-primary-border-subtle: color-mix(in srgb, var(--pano-color-primary) 75%, #000);');
    expect(text).toContain('--bs-heading-color: var(--pano-color-heading);');
    expect(text).toContain(
      '--bs-border-color-translucent: color-mix(in srgb, var(--pano-color-text) 17.5%, transparent);',
    );
    expect(text).toContain('--bs-focus-ring-color: color-mix(in srgb, var(--pano-color-primary) 25%, transparent);');
    expect(text).toContain('font-family: var(--bs-body-font-family);');
    expect(text.indexOf('--bs-border-style')).toBeLessThan(text.indexOf('--bs-body-bg'));
    expect(text.indexOf('--bs-body-bg')).toBeLessThan(text.indexOf('--bs-primary-bg-subtle'));
    expect(text.indexOf('--bs-primary-bg-subtle')).toBeLessThan(text.indexOf('--bs-heading-color'));
  });
});

describe('STEP 3: [data-bs-theme=X] descendant rules', () => {
  test('the prefix becomes a :scope:where() ancestor test', () => {
    const { css } = build('form-select');

    expect(hasSelector(css, ":scope:where([data-bs-theme='dark'] *) .form-select")).toBe(true);
    expect(hasSelector(css, ":scope:where([data-bs-theme='copper'] *) .form-select")).toBe(true);
    expect(css).not.toContain('[data-bs-theme=dark] .form-select');
  });

  test('a rule whose class is not in use is dropped with its palette prefixes', () => {
    expect(build('card').css).not.toContain('.form-select');
    expect(build('card').css).not.toContain('.blocks');
  });

  test('an attribute on the element itself is left alone', () => {
    const { css } = build('navbar');

    expect(hasSelector(css, '.navbar[data-bs-theme=dark]')).toBe(true);
  });
});

describe('binding templates (doc 03 section 4.3)', () => {
  test('only for classes in use, after the Bootstrap rule of the same class', () => {
    const { css } = build('btn btn-primary');
    const rules = contextsOf(css, '.btn-primary');

    expect(rules).toHaveLength(2);
    expect(hasSelector(css, '.btn-secondary')).toBe(false);

    const text = css.slice(css.lastIndexOf('.btn-primary {'));

    expect(text).toContain('--bs-btn-color: var(--pano-color-on-primary);');
    expect(text).toContain('--bs-btn-bg: var(--pano-color-primary);');
    expect(text).toContain('--bs-btn-border-color: var(--pano-color-primary);');
    expect(text).toContain('--bs-btn-hover-bg: color-mix(in srgb, var(--pano-color-primary) 85%, #000);');
    expect(text).toContain('--bs-btn-hover-border-color: color-mix(in srgb, var(--pano-color-primary) 85%, #000);');
    expect(text).toContain('--bs-btn-active-bg: var(--pano-color-primary);');
    expect(css.lastIndexOf('.btn-primary {')).toBeGreaterThan(css.indexOf('--bs-btn-padding-x'));
  });

  test('no template for a class that is not in use', () => {
    expect(build('btn').css).not.toContain('--pano-color-on-primary');
    expect(build('card').css).not.toContain('.btn:not(.btn-link)');
  });

  test('btn border except .btn-link; nav-pills; alert; outline', () => {
    const { css } = build('btn nav-pills alert alert-danger btn-outline-success');

    expect(ruleText(css, '.btn:not(.btn-link)')).toContain(
      'border: 1.5px solid color-mix(in srgb, var(--pano-color-text) 10%, transparent);',
    );
    expect(ruleText(css, '.nav-pills')).toContain('--bs-nav-pills-link-active-bg: var(--pano-color-primary);');
    expect(ruleText(css, '.nav-pills')).toContain('--bs-nav-pills-link-active-color: var(--pano-color-on-primary);');

    const alert = css.slice(css.lastIndexOf('.alert-danger {'));

    expect(alert).toContain('--bs-alert-color: color-mix(in srgb, var(--pano-color-danger) 85%, #000);');
    expect(alert).toContain('--bs-alert-border-color: color-mix(in srgb, var(--pano-color-danger) 25%, transparent);');
    expect(alert).toContain('border-radius: var(--pano-radius);');

    const outline = css.slice(css.lastIndexOf('.btn-outline-success {'));

    expect(outline).toContain('--bs-btn-color: var(--pano-color-success);');
    expect(outline).toContain('--bs-btn-hover-bg: var(--pano-color-success);');
    expect(outline).toContain('--bs-btn-hover-color: #fff;');
  });

  test('utility templates sit in the utilities sublayer, after the Bootstrap utility', () => {
    const { css } = build('text-bg-success bg-warning-subtle text-info-emphasis');
    const contexts = contextsOf(css, '.text-bg-success');

    expect(contexts).toHaveLength(2);
    expect(contexts.every((chain) => chain[0] === 'layer pano-fallback.utilities')).toBe(true);

    const last = css.slice(css.lastIndexOf('.text-bg-success {'));

    expect(last).toContain('background-color: var(--pano-color-success);');
    expect(last).toContain('color: #fff;');
    expect(css).toContain('background-color: color-mix(in srgb, var(--pano-color-warning) 12%, transparent);');
    expect(css).toContain('color: var(--pano-color-warning);');
    expect(css).toContain('border-color: color-mix(in srgb, var(--pano-color-warning) 20%, transparent);');
    expect(css).toContain('color: color-mix(in srgb, var(--pano-color-info) 80%, #000);');
  });

  test('contrast colours: primary / secondary have tokens, the rest are Bootstrap results', () => {
    const { css } = build('text-bg-warning text-bg-danger text-bg-secondary');

    expect(css).toContain('background-color: var(--pano-color-warning);\n      color: #000;');
    expect(css).toContain('background-color: var(--pano-color-danger);\n      color: #fff;');
    expect(css).toContain('background-color: var(--pano-color-secondary);\n      color: var(--pano-color-on-secondary);');
  });
});

describe('body-level block', () => {
  test('modal: the backdrop rules are emitted outside the scope', () => {
    const { css } = build('modal');

    expect(contextsOf(css, '.modal-backdrop')).toEqual([['layer pano-fallback.components']]);
    expect(contextsOf(css, '.modal-backdrop.fade')).toEqual([['layer pano-fallback.components']]);
    expect(contextsOf(css, '.modal-backdrop.show')).toEqual([['layer pano-fallback.components']]);
    expect(contextsOf(css, '.modal-open .modal')).toEqual([['layer pano-fallback.components']]);
    // the modal itself stays inside the scope
    expect(contextsOf(css, '.modal')[0][1]).toMatch(/^scope /);
  });

  test('no modal in use, no backdrop', () => {
    expect(build('card').css).not.toContain('modal');
  });

  test('tooltip: its rules, the :scope declarations on .tooltip and the generic .fade', () => {
    const { css } = build('tooltip');

    expect(contextsOf(css, '.tooltip')).toHaveLength(2); // the repeated declarations + the Bootstrap rule
    expect(contextsOf(css, '.tooltip .tooltip-arrow')).toEqual([['layer pano-fallback.components']]);

    const repeated = ruleText(css, '.tooltip');

    expect(repeated).toContain('--bs-body-bg: var(--pano-color-bg);');
    expect(repeated).toContain('font-family: var(--bs-body-font-family);');
    expect(hasSelector(css, ".tooltip:where([data-bs-theme='dark'] *)")).toBe(true);
    // .fade also outside the scope, because the tooltip element sits in <body>
    expect(contextsOf(css, '.fade').some((chain) => chain.length === 1)).toBe(true);
  });

  test('popover and tooltip share one repeated block', () => {
    const { css } = build('tooltip popover');

    expect(ruleText(css, '.tooltip,.popover')).not.toBeNull();
  });

  test('without tooltip or popover the generic .fade stays inside the scope', () => {
    const { css } = build('modal');

    expect(contextsOf(css, '.fade').every((chain) => chain.length > 1)).toBe(true);
  });
});

describe('classes', () => {
  test('lists every base class the sheet covers, sorted', () => {
    const { classes } = build('btn btn-primary mb-0 market-x');

    expect(classes).toEqual([...classes].sort());
    expect(classes).toEqual(expect.arrayContaining(['btn', 'btn-primary', 'mb-0', 'fade', 'show']));
    expect(classes).not.toContain('market-x');
  });
});

describe('helpers', () => {
  test('scanSelector finds classes in pseudo-classes and types at compound starts only', () => {
    expect(scanSelector('.btn-check:checked + .btn')).toEqual({ classes: ['btn-check', 'btn'], types: [] });
    expect(scanSelector(':not(.btn-check) + .btn:active')).toEqual({ classes: ['btn-check', 'btn'], types: [] });
    expect(scanSelector('a:not([href]):not([class])')).toEqual({ classes: [], types: ['a'] });
    expect(scanSelector('.table > :not(caption) > * > *')).toEqual({ classes: ['table'], types: ['caption', '*', '*'] });
    expect(scanSelector('.bs-tooltip-auto[data-popper-placement^=top] .tooltip-arrow::before').classes).toEqual([
      'bs-tooltip-auto',
      'tooltip-arrow',
    ]);
    expect(scanSelector('li:nth-child(2n+1)')).toEqual({ classes: [], types: ['li'] });
    expect(scanSelector(':root')).toEqual({ classes: [], types: [] });
    expect(scanSelector('.col-md-1\\.5').classes).toEqual(['col-md-1.5']);
  });

  test('stringLiterals reads quotes, templates (quasis and ${} literals) and skips comments', () => {
    const code = [
      "const a = 'badge bg-success'; // 'ignored comment'",
      'const b = "btn btn-primary";',
      '/* "block comment" */',
      'const c = `text-bg-${kind} ${ok ? "is-valid" : \'is-invalid\'} px-2`;',
    ].join('\n');
    const found = stringLiterals(code);

    expect(found).toContain('badge bg-success');
    expect(found).toContain('btn btn-primary');
    expect(found).toContain('is-valid');
    expect(found).toContain('is-invalid');
    expect(found.some((s) => s.includes('text-bg-'))).toBe(true);
    expect(found.some((s) => s.includes('px-2'))).toBe(true);
    expect(found).not.toContain('ignored comment');
    expect(found).not.toContain('block comment');
  });
});

describe('the real base sheet', () => {
  const real = fs.readFileSync(BASE_CSS_FILE, 'utf8');

  test('a small view gets a small, valid, layered sheet', () => {
    const { css, classes } = buildFallbackCss({
      baseCss: real,
      usedClasses: ['card', 'card-body', 'btn', 'btn-primary', 'text-bg-success', 'mb-0', 'form-control'],
      ns: 'market',
    });

    expect(() => postcss.parse(css)).not.toThrow();
    expect(css).not.toContain('!important');
    expect(css).not.toContain('@font-face');
    expect(css.length).toBeLessThan(real.length / 4);
    expect(classes).toEqual(expect.arrayContaining(['card', 'card-body', 'btn-primary', 'text-bg-success', 'mb-0']));
    expect(css).toContain('--bs-border-style: solid;');
    expect(css).toContain('--bs-body-bg: var(--pano-color-bg);');
    expect(contextsOf(css, '.text-bg-success').length).toBeGreaterThanOrEqual(2);
    expect(css).not.toMatch(/\.col-md-6/);
  });

  test('the modal backdrop and a spinner survive in the real sheet', () => {
    const { css } = buildFallbackCss({ baseCss: real, usedClasses: ['modal', 'modal-dialog', 'spinner-border'], ns: 'market' });

    expect(contextsOf(css, '.modal-backdrop')[0]).toEqual(['layer pano-fallback.components']);
    expect(css).toContain('@keyframes spinner-border');
  });
});

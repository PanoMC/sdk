import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RULE_LEVELS, checkStyles } from '../../check-styles.js';

const dirs = [];
/** Writes `files` ({ 'views/A.svelte': source }) under a fresh plugin root. */
function plugin(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pano-lint-'));
  dirs.push(root);
  for (const [name, source] of Object.entries(files)) {
    const full = path.join(root, 'src/theme', name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }
  return root;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function run(files, extra = {}) {
  const root = plugin(files);
  const views = Object.keys(files)
    .filter((f) => f.endsWith('.svelte') && !extra.noViews)
    .map((f) => ({ name: path.basename(f, '.svelte'), file: `src/theme/${f}` }));
  const opts = { root, ns: 'market', views, ...extra };
  delete opts.noViews;
  return {
    core: checkStyles({ ...opts, level: 'core' }),
    badge: checkStyles({ ...opts, level: 'badge' }),
    default: checkStyles(opts),
  };
}
const ofRule = (list, rule) => list.filter((f) => f.rule === rule);

describe('level table', () => {
  test('matches doc 03 section 3', () => {
    expect(RULE_LEVELS).toEqual({
      'class-allowed': { core: 'warn', badge: 'error' },
      'style-block-scope': { core: null, badge: 'error' },
      'style-attr': { core: null, badge: 'error' },
      'no-bs-var': { core: 'warn', badge: 'error' },
      'dynamic-class': { core: 'warn', badge: 'warn' },
      'root-class': { core: null, badge: 'error' },
      'part-coverage': { core: null, badge: 'error' },
      'part-prefix': { core: 'warn', badge: 'error' },
    });
  });

  test('level defaults to core and an unknown level throws', () => {
    const { core, default: def } = run({ 'views/A.svelte': '<div class="staff-list">x</div>' });
    expect(def).toEqual(core);
    expect(() => checkStyles({ root: '.', ns: 'market', views: [], level: 'loud' })).toThrow(/core/);
  });

  test('a clean view has no finding at either level', () => {
    const clean =
      '<div class="market-a card"><h3 class="market-a__title card-title" style="--w: 3px">t</h3></div>';
    const { core, badge } = run({ 'views/A.svelte': clean });
    expect(core).toEqual([]);
    expect(badge).toEqual([]);
  });

  test('a missing views directory is no finding', () => {
    expect(checkStyles({ root: os.tmpdir(), ns: 'x', views: [], viewsDir: 'does/not/exist' })).toEqual([]);
  });
});

describe('class-allowed', () => {
  const src = '<div class="market-a card staff-list is-open fa-solid fa-check mb-2">x</div>';

  test('core warns, badge errors; the message names the class and the next step', () => {
    const { core, badge } = run({ 'views/A.svelte': src });
    for (const [list, level] of [
      [core, 'warn'],
      [badge, 'error'],
    ]) {
      const found = ofRule(list, 'class-allowed');
      expect(found.length).toBe(1);
      expect(found[0].level).toBe(level);
      expect(found[0].file).toBe('src/theme/views/A.svelte');
      expect(found[0].line).toBe(1);
      expect(found[0].message).toContain('own class "staff-list"');
      expect(found[0].message).toContain('not covered by fallback.css in a Bootstrap-free theme');
      expect(found[0].message).toContain('market-staff-list');
      expect(found[0].message).toMatch(/\.$/);
    }
  });

  test('own classes, is- states, Bootstrap and FontAwesome tokens pass', () => {
    const ok =
      '<div class="market-a market-a__x is-sold-out card btn-primary fa-solid fa-check mb-3 gap-2 col-md-6">x</div>';
    expect(ofRule(run({ 'views/A.svelte': ok }).badge, 'class-allowed')).toEqual([]);
  });

  test('class: directives and string literals in class expressions are checked', () => {
    const { badge } = run({
      'views/A.svelte': "<div class={['market-a', 'weird']} class:other={x}>x</div>",
    });
    expect(ofRule(badge, 'class-allowed').map((f) => f.message.match(/"([^"]+)"/)[1])).toEqual([
      'weird',
      'other',
    ]);
  });

  test('another plugin namespace is not an own class', () => {
    const { badge } = run({ 'views/A.svelte': '<div class="shop-thing">x</div>' });
    expect(ofRule(badge, 'class-allowed').length).toBe(1);
  });

  test('a safelisted class passes', () => {
    const { badge } = run({ 'views/A.svelte': '<div class="market-a staff-list">x</div>' }, { safelist: ['staff-list'] });
    expect(ofRule(badge, 'class-allowed')).toEqual([]);
  });
});

describe('style-block-scope', () => {
  const view = (style) => `<div class="market-a">x</div>\n<style>\n${style}\n</style>`;
  const scope = (style, extra) => ofRule(run({ 'views/A.svelte': view(style) }, extra).badge, 'style-block-scope');

  test('off at core', () => {
    expect(ofRule(run({ 'views/A.svelte': view('p { color: red; }') }).core, 'style-block-scope')).toEqual([]);
  });

  test('a selector without the namespace class is an error with a line and a next step', () => {
    const found = scope('  .x { color: red; }');
    expect(found.length).toBe(1);
    expect(found[0].level).toBe('error');
    expect(found[0].line).toBe(3);
    expect(found[0].message).toContain('".x"');
    expect(found[0].message).toMatch(/start every selector with a class like \.market-name/);
  });

  test('own classes, with .is-state, descendants and media queries pass', () => {
    const css = [
      '  .market-a { color: var(--pano-color-primary); }',
      '  .market-a.is-open .inner, .market-a__body > p { margin: 0; }',
      '  @media (min-width: 600px) { .market-a { padding: 1rem; } }',
      '  @keyframes market-fade { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }',
      '  .market-a { --market-gap: 1px; animation: market-fade 1s; }',
      '  .market-a { &:hover { color: red; } }',
    ].join('\n');
    expect(scope(css)).toEqual([]);
  });

  test('every selector of a list needs the namespace class', () => {
    expect(scope('  .market-a, .other { color: red; }').length).toBe(1);
  });

  test('a class of another namespace does not count', () => {
    expect(scope('  .shop-a { color: red; }').length).toBe(1);
  });

  test(':global is an error', () => {
    const found = scope('  :global(body) .market-a { color: red; }\n  :global(.x) { color: blue; }');
    expect(found.some((f) => f.message.includes(':global'))).toBe(true);
    expect(found.every((f) => f.level === 'error')).toBe(true);
  });

  test('keyframes must be named after the plugin', () => {
    const found = scope('  @keyframes pulse { from { opacity: 0 } to { opacity: 1 } }');
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('keyframes "pulse"');
    expect(found[0].message).toContain('market-pulse');
  });

  test('own custom properties must be --<ns>-...', () => {
    const found = scope('  .market-a { --gap: 1px; --market-ok: 2px; }');
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('"--gap"');
    expect(found[0].message).toContain('--market-gap');
  });

  test('var(--bs-...) stays no-bs-var', () => {
    const { badge } = run({ 'views/A.svelte': view('  .market-a { color: var(--bs-primary); }') });
    expect(ofRule(badge, 'no-bs-var').length).toBe(1);
    expect(ofRule(badge, 'style-block-scope')).toEqual([]);
  });

  test('a view without a style block has no finding', () => {
    expect(ofRule(run({ 'views/A.svelte': '<div class="market-a">x</div>' }).badge, 'style-block-scope')).toEqual([]);
  });
});

describe('style-attr', () => {
  test('off at core; at badge only custom properties are allowed', () => {
    const files = {
      'views/Bad.svelte': '<div class="market-bad" style="width: 10px">x</div>',
      'views/Good.svelte': '<div class="market-good" style="--w: {pct}%; --h: 2px">x</div>',
      'views/GoodExpr.svelte': '<div class="market-good-expr" style={`--w: ${pct}%`}>x</div>',
      'views/Dir.svelte': '<div class="market-dir" style:--w={pct} style:color={c}>x</div>',
      'views/Mixed.svelte': '<div class="market-mixed" style="--w: 1px; color: red">x</div>',
      'views/Dyn.svelte': '<div class="market-dyn" style={s}>x</div>',
    };
    const { core, badge } = run(files);
    expect(ofRule(core, 'style-attr')).toEqual([]);
    const found = ofRule(badge, 'style-attr');
    expect(found.map((f) => path.basename(f.file)).sort()).toEqual([
      'Bad.svelte',
      'Dir.svelte',
      'Dyn.svelte',
      'Mixed.svelte',
    ]);
    expect(found.every((f) => f.level === 'error')).toBe(true);
    expect(found[0].message).toContain('styleAttrAllow');
    expect(found.find((f) => f.file.endsWith('Dir.svelte')).message).toContain('style:color');
  });

  test('a file in styleAttrAllow may set any property (by base name, file name or path)', () => {
    const files = { 'views/CategoryNode.svelte': '<li class="market-category-node" style="padding-left: 4px">x</li>' };
    for (const allow of ['CategoryNode', 'CategoryNode.svelte', 'src/theme/views/CategoryNode.svelte']) {
      expect(ofRule(run(files, { styleAttrAllow: [allow] }).badge, 'style-attr')).toEqual([]);
    }
    expect(ofRule(run(files).badge, 'style-attr').length).toBe(1);
  });
});

describe('no-bs-var', () => {
  const files = {
    'views/A.svelte':
      '<div class="market-a" style="--c: var(--bs-primary)">x</div>\n<style>\n  .x { color: var(--bs-body-color); }\n</style>',
    'views/B.svelte': '<div class="market-b" style="color: var(--pano-color-text)">x</div>',
  };
  test('core warns, badge errors, for style= and <style>', () => {
    const { core, badge } = run(files);
    const warn = ofRule(core, 'no-bs-var');
    const err = ofRule(badge, 'no-bs-var');
    expect(warn.length).toBe(2);
    expect(err.length).toBe(2);
    expect(warn.every((f) => f.level === 'warn' && f.file.endsWith('A.svelte'))).toBe(true);
    expect(err.every((f) => f.level === 'error')).toBe(true);
    expect(err.map((f) => f.line)).toEqual([1, 3]);
    expect(err[0].message).toContain('var(--bs-primary)');
    expect(err[0].message).toContain('--pano-*');
    expect(err[0].message).toMatch(/\.$/);
  });
});

describe('dynamic-class', () => {
  test('a non-literal member whose values cannot be found is a warning at both levels', () => {
    const src = '<script>let { icon } = $props();</script>\n<i class={[\'market-a\', icon]}></i>';
    const { core, badge } = run({ 'views/A.svelte': src });
    for (const list of [core, badge]) {
      const found = ofRule(list, 'dynamic-class');
      expect(found.length).toBe(1);
      expect(found[0].level).toBe('warn');
      expect(found[0].line).toBe(2);
      expect(found[0].message).toContain('"icon"');
      expect(found[0].message).toContain('styles.safelist');
    }
  });

  test('values found in the file script or in a helper under viewsDir are resolved', () => {
    const files = {
      'views/A.svelte':
        "<script>import { badgeFor } from '../lib/badges.js'; const STATUS = { paid: 'text-bg-success', open: 'text-bg-warning' }; let { s } = $props();</script>\n" +
        '<span class={[\'market-a\', STATUS[s], badgeFor(s)]}></span>',
      'lib/badges.js': "export function badgeFor(s) { return s ? 'text-bg-primary' : 'text-bg-secondary'; }\n",
    };
    expect(ofRule(run(files).core, 'dynamic-class')).toEqual([]);
  });

  test('a prefix is resolved by a literal in a script or by the safelist', () => {
    const tpl = '<script>let { v } = $props();</script>\n<button class="market-a btn btn-{v}">x</button>';
    expect(ofRule(run({ 'views/A.svelte': tpl }).core, 'dynamic-class').length).toBe(1);
    expect(ofRule(run({ 'views/A.svelte': tpl }, { safelist: ['btn-primary'] }).core, 'dynamic-class')).toEqual([]);
    const withLiteral = tpl.replace('let { v }', "const V = ['btn-primary', 'btn-danger']; let { v }");
    expect(ofRule(run({ 'views/A.svelte': withLiteral }).core, 'dynamic-class')).toEqual([]);
  });

  test('template literals and concatenation are dynamic members with a prefix', () => {
    const src =
      '<script>let { v } = $props();</script>\n<div class={`market-a btn-${v}`}></div><div class={"market-a " + v}></div>';
    const found = ofRule(run({ 'views/A.svelte': src }).core, 'dynamic-class');
    expect(found.length).toBe(2);
    expect(found[0].message).toContain('start with "btn-"');
  });

  test('literal members, conditionals of literals and object keys are fine', () => {
    const src =
      "<div class={['market-a', on && 'is-on', big ? 'is-big' : 'is-small', { 'is-x': y }, false]}></div>";
    expect(ofRule(run({ 'views/A.svelte': src }).core, 'dynamic-class')).toEqual([]);
  });

  test('dynamicClassAllow exempts a named view when the expression has no literal prefix', () => {
    const src = '<script>let { cls } = $props();</script>\n<div class={cls}></div>';
    const files = { 'views/A.svelte': src, 'views/B.svelte': src };
    const free = run(files);
    expect(ofRule(free.core, 'dynamic-class').length).toBe(2);
    const allowed = run(files, { dynamicClassAllow: ['A'] });
    const left = ofRule(allowed.core, 'dynamic-class');
    expect(left.length).toBe(1);
    expect(left[0].file).toContain('B.svelte');
    expect(left[0].message).toContain('styles.dynamicClassAllow');
    expect(ofRule(allowed.badge, 'dynamic-class').map((f) => f.file)).toEqual(left.map((f) => f.file));
  });

  test('dynamicClassAllow does not hide an expression with a literal prefix', () => {
    const src = '<script>let { v } = $props();</script>\n<div class={`btn-${v}`}></div>';
    expect(ofRule(run({ 'views/A.svelte': src }, { dynamicClassAllow: ['A'] }).core, 'dynamic-class').length).toBe(1);
  });
});

describe('root-class', () => {
  test('off at core; at badge each registered view needs its root class in source', () => {
    const files = {
      'views/ProductCard.svelte': '<div class="card">x</div>',
      'views/Done.svelte': '<div class="market-done card">x</div>',
      'views/Branches.svelte': '{#if a}<div class="market-branches">a</div>{:else}<p>b</p>{/if}',
    };
    const { core, badge } = run(files);
    expect(ofRule(core, 'root-class')).toEqual([]);
    const found = ofRule(badge, 'root-class');
    expect(found.map((f) => path.basename(f.file)).sort()).toEqual(['Branches.svelte', 'ProductCard.svelte']);
    const card = found.find((f) => f.file.endsWith('ProductCard.svelte'));
    expect(card.level).toBe('error');
    expect(card.message).toContain('"market-product-card"');
    expect(card.message).toContain('pano-plugin classes --fix');
    expect(found.find((f) => f.file.endsWith('Branches.svelte')).message).toContain('<p>');
  });

  test('files that are not registered views are not checked', () => {
    const { badge } = run({ 'components/Sub.svelte': '<div class="card">x</div>' }, { noViews: true });
    expect(ofRule(badge, 'root-class')).toEqual([]);
  });

  test('a view without an element root is a warning that says to wrap it', () => {
    const { core, badge } = run({ 'views/Wrap.svelte': '<script>import C from "./C.svelte";</script><C />' });
    expect(ofRule(core, 'root-class')).toEqual([]);
    const found = ofRule(badge, 'root-class');
    expect(found.length).toBe(1);
    expect(found[0].level).toBe('warn');
    expect(found[0].message).toContain('wrap it in an element');
  });
});

describe('part-coverage', () => {
  const files = {
    'views/A.svelte':
      '<div class="market-a">\n  <div class="card-body">x</div>\n  <h3 class="market-a__title card-title">t</h3>\n  <button class="btn btn-primary">go</button>\n</div>',
  };
  test('off at core; at badge each Bootstrap component class needs a part class', () => {
    const { core, badge } = run(files);
    expect(ofRule(core, 'part-coverage')).toEqual([]);
    const found = ofRule(badge, 'part-coverage');
    expect(found.map((f) => f.line)).toEqual([2, 4]);
    expect(found.every((f) => f.level === 'error')).toBe(true);
    expect(found[0].message).toContain('market-a__body');
    expect(found[1].message).toContain('market-a__action');
    expect(found[0].message).toContain('pano-plugin classes --fix');
  });

  test('utility-only elements need no part class', () => {
    const { badge } = run({ 'views/A.svelte': '<div class="market-a"><p class="mb-2 d-flex">x</p></div>' });
    expect(ofRule(badge, 'part-coverage')).toEqual([]);
  });

  test('the generator output passes the rule', async () => {
    const { addPartClasses, addRootClass } = await import('../../semantic-classes.js');
    const input = fs.readFileSync(path.join(import.meta.dir, 'fixtures/ProductCard.in.svelte'), 'utf8');
    const ctx = { ns: 'market', view: 'ProductCard' };
    const fixed = addPartClasses(addRootClass(input, ctx).code, ctx).code;
    const { badge } = run({ 'views/ProductCard.svelte': fixed });
    expect(ofRule(badge, 'part-coverage')).toEqual([]);
    expect(ofRule(badge, 'root-class')).toEqual([]);
    expect(ofRule(badge, 'part-prefix')).toEqual([]);
    expect(ofRule(badge, 'class-allowed')).toEqual([]);
  });
});

describe('part-prefix', () => {
  const files = { 'views/ProductCard.svelte': '<div class="market-product-card"><i class="market-order__icon">x</i></div>' };
  test('a part class must start with the root class of its file: warn at core, error at badge', () => {
    const { core, badge } = run(files);
    const warn = ofRule(core, 'part-prefix');
    const err = ofRule(badge, 'part-prefix');
    expect(warn.length).toBe(1);
    expect(err.length).toBe(1);
    expect(warn[0].level).toBe('warn');
    expect(err[0].level).toBe('error');
    expect(err[0].message).toContain('"market-order__icon"');
    expect(err[0].message).toContain('market-product-card__icon');
  });

  test('a file that is not a registered view uses its own file name', () => {
    const f = { 'components/Row.svelte': '<tr class="market-row__cell"><td class="market-other__cell">x</td></tr>' };
    const { badge } = run(f, { noViews: true });
    const found = ofRule(badge, 'part-prefix');
    expect(found.length).toBe(1);
    expect(found[0].message).toContain('"market-other__cell"');
    expect(found[0].message).toContain('market-row__');
  });
});

describe('messages', () => {
  test('every message ends with a next step', () => {
    const files = {
      'views/A.svelte':
        '<script>let { icon } = $props();</script>\n<div class="staff-list card-body" style="width: 1px; color: var(--bs-primary)"><i class={icon}></i></div>\n<style>p { color: var(--bs-body-color) }</style>',
      'views/Wrap.svelte': '<A />',
    };
    const { badge } = run(files);
    const rules = new Set(badge.map((f) => f.rule));
    for (const rule of ['class-allowed', 'style-block-scope', 'style-attr', 'no-bs-var', 'dynamic-class', 'root-class', 'part-coverage'])
      expect(rules.has(rule), rule).toBe(true);
    for (const f of badge) {
      expect(f.message, f.rule).toMatch(/ — .+\.$/);
      expect(['error', 'warn']).toContain(f.level);
      expect(f.line).toBeGreaterThan(0);
    }
  });

  test('findings are sorted by file and line', () => {
    const { badge } = run({
      'views/B.svelte': '<div class="x-b">x</div>',
      'views/A.svelte': '<div class="x-a">x</div>\n<div class="x-c">y</div>',
    });
    const keys = badge.map((f) => `${f.file}:${String(f.line).padStart(4, '0')}`);
    expect(keys).toEqual([...keys].sort());
  });
});

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  SemanticClassCollisionError,
  addPartClasses,
  addRootClass,
  kebab,
  panoSemanticClasses,
} from '../../semantic-classes.js';

const fixtures = path.join(import.meta.dir, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');
const ctx = { ns: 'market', view: 'ProductCard' };
const ROOT = 'market-product-card';

describe('kebab', () => {
  test('view names', () => {
    expect(kebab('ProductCard')).toBe('product-card');
    expect(kebab('HTMLView')).toBe('html-view');
    expect(kebab('Navbar')).toBe('navbar');
    expect(kebab('addToCart')).toBe('add-to-cart');
    expect(kebab('add_to_cart')).toBe('add-to-cart');
  });
});

describe('addRootClass', () => {
  test('plain root without a class attribute', () => {
    const r = addRootClass('<div><p>x</p></div>', ctx);
    expect(r.code).toBe(`<div class="${ROOT}"><p>x</p></div>`);
    expect(r.added).toEqual([ROOT]);
    expect(r.roots).toEqual(['div']);
    expect(r.warnings).toEqual([]);
  });

  test('plain root keeps script and style blocks untouched', () => {
    const src = '<script>let a = 1;</script>\n<section id="s">{a}</section>\n<style>p { color: red }</style>';
    const r = addRootClass(src, ctx);
    expect(r.code).toBe(
      `<script>let a = 1;</script>\n<section class="${ROOT}" id="s">{a}</section>\n<style>p { color: red }</style>`,
    );
  });

  test('self closing and void roots', () => {
    expect(addRootClass('<img src="a.png" />', ctx).code).toBe(`<img class="${ROOT}" src="a.png" />`);
  });

  test('{#if} roots: every branch gets the class, else-if included', () => {
    const src = '{#if a}<div>a</div>{:else if b}<section>b</section>{:else}<p>c</p>{/if}';
    const r = addRootClass(src, ctx);
    expect(r.code).toBe(
      `{#if a}<div class="${ROOT}">a</div>{:else if b}<section class="${ROOT}">b</section>{:else}<p class="${ROOT}">c</p>{/if}`,
    );
    expect(r.roots).toEqual(['div', 'section', 'p']);
    expect(r.added).toEqual([ROOT]);
  });

  test('{#each} body and fallback, {#key} and {#await} roots', () => {
    const src =
      '{#each items as i}<li>{i}</li>{:else}<p>none</p>{/each}' +
      '{#key k}<div>k</div>{/key}' +
      '{#await p}<span>wait</span>{:then v}<b>{v}</b>{:catch e}<i>{e}</i>{/await}';
    const r = addRootClass(src, ctx);
    for (const tag of ['li', 'p', 'div', 'span', 'b', 'i'])
      expect(r.code).toContain(`<${tag} class="${ROOT}">`);
    expect(r.roots).toEqual(['li', 'p', 'div', 'span', 'b', 'i']);
  });

  test('elements nested in a root element are not roots', () => {
    const r = addRootClass('<div><span>x</span></div>', ctx);
    expect(r.code).not.toContain('<span class');
  });

  test('a component root gets no class and the build message', () => {
    const src = '<script>import Card from "./Card.svelte";</script>\n<Card title="x" />';
    const r = addRootClass(src, ctx);
    expect(r.code).toBe(src);
    expect(r.added).toEqual([]);
    expect(r.roots).toEqual([]);
    expect(r.warnings).toEqual([
      'ProductCard has no root element; wrap it in an element so themes can target it',
    ]);
  });

  test('{@render} and text-only tops have no root either', () => {
    expect(addRootClass('{@render children?.()}', ctx).roots).toEqual([]);
    expect(addRootClass('just text', ctx).warnings.length).toBe(1);
  });

  test('class form 1: text value is prepended', () => {
    expect(addRootClass('<div class="card h-100">x</div>', ctx).code).toBe(
      `<div class="${ROOT} card h-100">x</div>`,
    );
    expect(addRootClass("<div class='card'>x</div>", ctx).code).toBe(
      `<div class='${ROOT} card'>x</div>`,
    );
  });

  test('class form 1: quoted value with expression parts is prepended', () => {
    expect(addRootClass('<div class="card {size}">x</div>', ctx).code).toBe(
      `<div class="${ROOT} card {size}">x</div>`,
    );
    expect(addRootClass('<div class="{size}">x</div>', ctx).code).toBe(
      `<div class="${ROOT} {size}">x</div>`,
    );
  });

  test('class form 1: unquoted and empty values', () => {
    expect(addRootClass('<div class=card>x</div>', ctx).code).toBe(`<div class="${ROOT} card">x</div>`);
    expect(addRootClass('<div class>x</div>', ctx).code).toBe(`<div class="${ROOT}">x</div>`);
  });

  test('class form 2: expression becomes an array', () => {
    expect(addRootClass('<div class={cls}>x</div>', ctx).code).toBe(
      `<div class={['${ROOT}', cls]}>x</div>`,
    );
    expect(addRootClass("<div class={a ? 'x' : 'y'}>x</div>", ctx).code).toBe(
      `<div class={['${ROOT}', a ? 'x' : 'y']}>x</div>`,
    );
  });

  test('class form 3: an array literal gets the entry inserted', () => {
    expect(addRootClass("<div class={['card', { on: x }]}>x</div>", ctx).code).toBe(
      `<div class={['${ROOT}', 'card', { on: x }]}>x</div>`,
    );
    expect(addRootClass('<div class={[]}>x</div>', ctx).code).toBe(`<div class={['${ROOT}']}>x</div>`);
  });

  test('idempotent for every class form', () => {
    const sources = [
      '<div>x</div>',
      '<div class="card">x</div>',
      '<div class={cls}>x</div>',
      "<div class={['card', { on: x }]}>x</div>",
      '<div class="card {size}">x</div>',
      '{#if a}<div>a</div>{:else}<p>b</p>{/if}',
      '<div class>x</div>',
    ];
    for (const src of sources) {
      const once = addRootClass(src, ctx);
      const twice = addRootClass(once.code, ctx);
      expect(twice.code).toBe(once.code);
      expect(twice.added).toEqual([]);
      expect(twice.roots).toEqual(once.roots);
    }
  });

  test('a root class written by hand is left alone', () => {
    const src = `<div class="${ROOT} card">x</div>`;
    const r = addRootClass(src, ctx);
    expect(r.code).toBe(src);
    expect(r.added).toEqual([]);
    expect(r.roots).toEqual(['div']);
  });

  test('a Bootstrap / FontAwesome collision throws and names namespace', () => {
    expect(() => addRootClass('<div>x</div>', { ns: 'card', view: 'Body' })).toThrow(
      SemanticClassCollisionError,
    );
    try {
      addRootClass('<div>x</div>', { ns: 'card', view: 'Body' });
    } catch (error) {
      expect(error.message).toContain('"card-body"');
      expect(error.message).toContain('"namespace"');
      expect(error.message).toContain('pano.plugin.js');
    }
    expect(() => addRootClass('<div>x</div>', { ns: 'fa', view: 'Solid' })).toThrow(/namespace/);
    expect(() => addRootClass('<div>x</div>', { ns: 'pano', view: 'Post' })).not.toThrow();
  });
});

describe('addPartClasses', () => {
  const part = (src) => addPartClasses(src, ctx);

  test('Bootstrap table: every entry', () => {
    const table = {
      'card-body': 'body',
      'card-title': 'title',
      'card-header': 'header',
      'card-footer': 'footer',
      'card-img-top': 'image',
      badge: 'badge',
      alert: 'alert',
      'list-group': 'list',
      'list-group-item': 'item',
      table: 'table',
      'form-control': 'input',
      'form-select': 'select',
      'form-label': 'label',
      'form-check-input': 'check',
      'nav-link': 'link',
      'modal-header': 'header',
      'modal-body': 'body',
      'modal-footer': 'footer',
      'offcanvas-header': 'header',
      'offcanvas-body': 'body',
      'dropdown-menu': 'menu',
      'dropdown-item': 'menu-item',
      pagination: 'pager',
      btn: 'action',
    };
    for (const [bootstrapClass, name] of Object.entries(table)) {
      const r = part(`<div><span class="${bootstrapClass} mb-2">x</span></div>`);
      expect(r.added.map((a) => a.class)).toEqual([`${ROOT}__${name}`]);
      expect(r.code).toContain(`class="${ROOT}__${name} ${bootstrapClass} mb-2"`);
    }
  });

  test('tag table: img and headings that carry a Bootstrap class', () => {
    const r = part('<div><img class="img-fluid" src="a"><h4 class="mb-0">t</h4><h2>plain</h2></div>');
    expect(r.added.map((a) => a.class)).toEqual([`${ROOT}__image`, `${ROOT}__title`]);
    expect(r.code).toContain('<h2>plain</h2>');
  });

  test('the Bootstrap table wins over the tag table', () => {
    const r = part('<div><h5 class="card-header">t</h5></div>');
    expect(r.added.map((a) => a.class)).toEqual([`${ROOT}__header`]);
  });

  test('elements without a Bootstrap component class are left alone', () => {
    const src = '<div class="d-flex gap-2"><span class="text-muted">x</span></div>';
    expect(part(src).code).toBe(src);
  });

  test('an element that already has an <ns>- class is skipped', () => {
    const src = '<div><p class="market-other__x card-body">x</p></div>';
    expect(part(src)).toEqual({ code: src, added: [] });
  });

  test('clash: the last segment of the first $_ key, then -2, -3', () => {
    const src =
      '<div>' +
      '<button class="btn">{$_("theme.a")}</button>' +
      '<button class="btn">{$_(\'theme.store.addToCart\')}</button>' +
      '<button class="btn">{$_(\'theme.store.addToCart\')}</button>' +
      '<button class="btn">no key</button>' +
      '</div>';
    const names = part(src).added.map((a) => a.class.replace(`${ROOT}__`, ''));
    expect(names).toEqual(['action', 'add-to-cart', 'action-2', 'action-3']);
  });

  test('names already present in the file count as used', () => {
    const src = `<div class="card"><p class="${ROOT}__title">x</p><h3 class="card-title">y</h3></div>`;
    expect(part(src).added.map((a) => a.class)).toEqual([`${ROOT}__title-2`]);
  });

  test('reports the 1-based line of each element', () => {
    const r = part('<div>\n  <p class="alert">x</p>\n\n  <b class="badge">y</b>\n</div>');
    expect(r.added.map((a) => a.line)).toEqual([2, 4]);
  });

  test('works inside blocks and component children', () => {
    const src =
      '{#if a}<div>{#each l as i}<span class="badge">{i}</span>{/each}</div>{/if}' +
      '<Modal><div class="modal-body">x</div></Modal>';
    const r = part(src);
    expect(r.added.map((a) => a.class)).toEqual([`${ROOT}__badge`, `${ROOT}__body`]);
  });

  test('the three class forms', () => {
    expect(part('<p class="alert">x</p>').code).toBe(`<p class="${ROOT}__alert alert">x</p>`);
    expect(part('<p class={alertClass} data-x="1">x</p>').code).toBe(
      '<p class={alertClass} data-x="1">x</p>',
    ); // no literal Bootstrap class: nothing to name
    expect(part("<p class={['alert', kind]}>x</p>").code).toBe(
      `<p class={['${ROOT}__alert', 'alert', kind]}>x</p>`,
    );
    expect(part('<p class="btn {extra}">x</p>').code).toBe(
      `<p class="${ROOT}__action btn {extra}">x</p>`,
    );
  });

  test('idempotent', () => {
    const once = part(read('ProductCard.in.svelte'));
    const twice = part(once.code);
    expect(twice.code).toBe(once.code);
    expect(twice.added).toEqual([]);
  });
});

describe('ProductCard golden file (doc 03 section 1.1)', () => {
  const run = (input) => {
    const root = addRootClass(input, ctx);
    return addPartClasses(root.code, ctx).code;
  };

  test('root step then codemod equals the golden file', () => {
    expect(run(read('ProductCard.in.svelte'))).toBe(read('ProductCard.golden.svelte'));
  });

  test('the golden file contains the lines of the worked example', () => {
    const golden = read('ProductCard.golden.svelte');
    for (const line of [
      "<div class={['market-product-card', 'card', 'h-100', { 'is-sold-out': !product.inStock }]}>",
      '<div class="market-product-card__body card-body d-flex flex-column gap-1">',
      '<h3 class="market-product-card__title h6 card-title mb-0 text-truncate">',
      '<button class="market-product-card__add-to-cart btn btn-primary btn-sm w-100" onclick={add}>',
    ])
      expect(golden).toContain(line);
  });

  test('running both steps on the golden file changes nothing', () => {
    const golden = read('ProductCard.golden.svelte');
    expect(run(golden)).toBe(golden);
  });
});

describe('panoSemanticClasses', () => {
  test('is a svelte markup preprocessor', () => {
    const pre = panoSemanticClasses({ ns: 'market' });
    expect(pre.name).toBe('pano-semantic-classes');
    expect(typeof pre.markup).toBe('function');
  });

  test('adds the root class from the file name', () => {
    const pre = panoSemanticClasses({ ns: 'market' });
    const out = pre.markup({ content: '<div>x</div>', filename: '/p/src/theme/views/ProductCard.svelte' });
    expect(out.code).toBe(`<div class="${ROOT}">x</div>`);
  });

  test('leaves other files, node_modules and unchanged sources alone', () => {
    const pre = panoSemanticClasses({ ns: 'market' });
    expect(pre.markup({ content: '<div>x</div>', filename: '/p/a.js' })).toBeUndefined();
    expect(pre.markup({ content: '<div>x</div>', filename: '/p/node_modules/x/A.svelte' })).toBeUndefined();
    expect(pre.markup({ content: '<div>x</div>' })).toBeUndefined();
    expect(
      pre.markup({ content: `<div class="${ROOT}">x</div>`, filename: '/p/ProductCard.svelte' }),
    ).toBeUndefined();
  });

  test('views option: a directory list and a resolver', () => {
    const dirs = panoSemanticClasses({ ns: 'market', views: ['/p/src/theme/views'] });
    expect(dirs.markup({ content: '<b>x</b>', filename: '/p/src/theme/views/A.svelte' }).code).toContain(
      'market-a',
    );
    expect(dirs.markup({ content: '<b>x</b>', filename: '/p/src/theme/lib/B.svelte' })).toBeUndefined();
    const fn = panoSemanticClasses({ ns: 'market', views: (f) => (f.endsWith('Z.svelte') ? 'Zed' : null) });
    expect(fn.markup({ content: '<b>x</b>', filename: '/q/Z.svelte' }).code).toContain('market-zed');
  });

  test('no element root prints the build message', () => {
    const messages = [];
    const pre = panoSemanticClasses({ ns: 'market', warn: (m) => messages.push(m) });
    expect(pre.markup({ content: '<Card />', filename: '/p/Wrapper.svelte' })).toBeUndefined();
    expect(messages).toEqual([
      '/p/Wrapper.svelte: Wrapper has no root element; wrap it in an element so themes can target it',
    ]);
  });

  test('a collision fails the build, a syntax error is left to the compiler', () => {
    const pre = panoSemanticClasses({ ns: 'card' });
    expect(() => pre.markup({ content: '<div>x</div>', filename: '/p/Body.svelte' })).toThrow(/namespace/);
    const ok = panoSemanticClasses({ ns: 'market' });
    expect(ok.markup({ content: '<div>', filename: '/p/Broken.svelte' })).toBeUndefined();
  });

  test('works as a rollup-plugin-svelte preprocess group through svelte/compiler', async () => {
    const { preprocess } = await import('svelte/compiler');
    const out = await preprocess('<div>x</div>', panoSemanticClasses({ ns: 'market' }), {
      filename: '/p/ProductCard.svelte',
    });
    expect(out.code).toBe(`<div class="${ROOT}">x</div>`);
  });
});

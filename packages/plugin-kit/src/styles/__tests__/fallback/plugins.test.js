import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rollup } from 'rollup';
import svelte from 'rollup-plugin-svelte';
import { getBuildContext } from '../../../rollup/meta.js';
import { panoFallbackCss, scanViews, baseClassSet, nearMatches } from '../../fallback-css.js';
import { panoPluginCss, styleHash } from '../../plugin-css.js';

const dirs = [];

/** A plugin root with these files ({ 'src/theme/views/A.svelte': source }). */
function pluginRoot(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pano-fallback-')));

  dirs.push(root);

  for (const [name, source] of Object.entries(files)) {
    const full = path.join(root, name);

    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
  }

  return root;
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const CARD = `<script>
  import { statusClass } from './lib/status.js';
  /** @type {{ product: { name: string } }} */
  let { product } = $props();
  const BADGES = { ok: 'text-bg-success', bad: 'text-bg-danger' };
</script>

<div class="card h-100">
  <div class="card-body d-flex">
    <h3 class="card-title h6">{product.name}</h3>
    <button class="btn btn-primary btn-sm" onclick={() => {}}>buy</button>
    <span class={statusClass('ok')}>ok</span>
  </div>
</div>

<style>
  .market-product-card { padding: 1rem; }
  .card-title { margin: 0; }
</style>
`;

const FILES = {
  'src/theme/views/ProductCard.svelte': CARD,
  'src/theme/views/lib/status.js': "export const statusClass = (s) => (s === 'ok' ? 'badge bg-success' : `badge bg-${s}`);\nexport const unrelated = 'not a class';\n",
  'src/entry.js': "import ProductCard from './theme/views/ProductCard.svelte';\nexport default ProductCard;\n",
};

/**
 * Builds `src/entry.js` of a plugin root with the two plugins and the svelte plugin; returns the
 * written files of the client folder.
 */
async function build(root, { emitCss = false, fallback = {}, own = {} } = {}) {
  const out = path.join(root, 'out/client');
  const bundle = await rollup({
    input: path.join(root, 'src/entry.js'),
    external: (id) => id.startsWith('svelte'),
    onwarn() {},
    plugins: [
      panoPluginCss({ ns: 'market', root, outDir: path.join(root, 'out'), side: 'client', ...own }),
      panoFallbackCss({ ns: 'market', root, outDir: path.join(root, 'out'), side: 'client', ...fallback }),
      svelte({ compilerOptions: { generate: 'client', css: 'external' }, emitCss, onwarn() {} }),
    ],
  });

  await bundle.write({ dir: out, format: 'es', entryFileNames: 'client.mjs' });
  await bundle.close();

  const files = {};

  for (const name of fs.readdirSync(out)) files[name] = fs.readFileSync(path.join(out, name), 'utf8');

  return files;
}

describe('scanViews (STEP 1)', () => {
  const root = pluginRoot(FILES);
  const baseClasses = baseClassSet(fs.readFileSync(new URL('./fixtures/base.css', import.meta.url), 'utf8') +
    '.badge, .bg-success, .bg-danger, .text-bg-success, .text-bg-danger, .card-title, .h-100, .d-flex, .btn-sm {}');

  test('markup class tokens, script literals that are base classes, helper files', () => {
    const scan = scanViews(path.join(root, 'src/theme/views'), baseClasses, 'market');

    expect(scan.used.has('card')).toBe(true);
    expect(scan.used.has('btn-sm')).toBe(true);
    expect(scan.used.has('text-bg-success')).toBe(true); // BADGES map in <script>
    expect(scan.used.has('text-bg-danger')).toBe(true);
    expect(scan.used.has('unrelated')).toBe(false); // a helper literal that is not a class
    expect(scan.used.has('not')).toBe(false);
    expect(scan.fa).toBe(false);
  });

  test('.js files under the views folder are read too', () => {
    const lib = pluginRoot({
      'views/A.svelte': '<div class="card"></div>',
      'views/helpers/classes.js': "export const x = 'badge bg-danger'; export const y = `bg-${'success'}`;",
    });
    const scan = scanViews(path.join(lib, 'views'), baseClasses, 'market');

    expect(scan.used.has('badge')).toBe(true);
    expect(scan.used.has('bg-danger')).toBe(true);
    expect(scan.used.has('bg-')).toBe(false);
  });

  test('Font Awesome and tooltip hints', () => {
    const r = pluginRoot({
      'views/Icon.svelte': '<i class="fa-solid fa-user"></i><span data-bs-toggle="tooltip" title="x">y</span>',
    });
    const scan = scanViews(path.join(r, 'views'), baseClasses, 'market');

    expect(scan.fa).toBe(true);
    expect(scan.used.has('tooltip')).toBe(true);
  });

  test('roots and classes per view: root class first, parts in source order, none without an element root', () => {
    const r = pluginRoot({
      'views/Parts.svelte':
        '<div class="market-parts card"><h3 class="market-parts__title">a</h3><p class="market-parts__add-to-cart">b</p></div>',
      'views/Wrapper.svelte': "<script>import Parts from './Parts.svelte';</script>\n<Parts />",
      'views/helper.svelte': '<p>not a view name</p>',
    });
    const scan = scanViews(path.join(r, 'views'), baseClasses, 'market');
    const byName = Object.fromEntries(scan.views.map((v) => [v.name, v]));

    expect(byName.Parts.roots).toEqual(['div']);
    expect(byName.Parts.classes).toEqual(['market-parts', 'market-parts__title', 'market-parts__add-to-cart']);
    expect(byName.Wrapper.roots).toEqual([]);
    expect(byName.Wrapper.classes).toEqual([]);
    expect(byName.helper).toBeUndefined();
  });

  test('a missing views folder is an empty scan', () => {
    expect(scanViews('/nonexistent/views', baseClasses, 'market').used.size).toBe(0);
  });
});

describe('safelist helpers', () => {
  test('nearMatches suggests close base classes', () => {
    const known = new Set(['text-bg-success', 'text-bg-danger', 'btn', 'card']);

    expect(nearMatches('text-bg-sucess', known)[0]).toBe('text-bg-success');
    expect(nearMatches('zzzzzzzz', known)).toEqual([]);
  });
});

describe('panoFallbackCss + panoPluginCss in a rollup build', () => {
  test('emits client/fallback.css with the classes of markup, scripts and helpers', async () => {
    const root = pluginRoot(FILES);
    const files = await build(root);

    expect(Object.keys(files).sort()).toEqual(['client.mjs', 'fallback.css', 'plugin.css']);

    const css = files['fallback.css'];

    expect(css).toContain('@layer pano-fallback.components');
    expect(css).toContain('.card-body');
    expect(css).toContain('.btn-primary');
    expect(css).toContain('.text-bg-success'); // built in a <script> map
    expect(css).toContain('.text-bg-danger');
    expect(css).toContain('.badge');
    expect(css).toContain('.bg-success'); // a string literal of a helper file
    expect(css).not.toContain('!important');
    expect(css).not.toContain('.col-md-6');
    expect(css).toContain('data-pano-fb="market"');
  });

  test('records styles and per-view roots / classes for pano-plugin.json', async () => {
    const root = pluginRoot(FILES);
    const files = await build(root);
    const context = getBuildContext(root);

    expect(context.styles).toEqual({
      fallback: 'client/fallback.css',
      own: 'client/plugin.css',
      hash: styleHash({ fallback: files['fallback.css'], own: files['plugin.css'] }),
      icons: false,
    });
    expect(context.styles.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(context.views.ProductCard.roots).toEqual(['div']);
    expect(context.views.ProductCard.classes).toEqual(['market-product-card']);
  });

  test('the hash changes with either file', () => {
    expect(styleHash({ fallback: 'a', own: 'b' })).not.toBe(styleHash({ fallback: 'a', own: 'c' }));
    expect(styleHash({ fallback: 'a' })).not.toBe(styleHash({ fallback: 'b' }));
    expect(styleHash({ fallback: 'a' })).toBe(styleHash({ fallback: 'a' }));
  });

  test('icons: auto follows fa- classes, true / false are taken as given', async () => {
    const withIcon = pluginRoot({ ...FILES, 'src/theme/views/Icon.svelte': '<i class="fa-solid fa-user"></i>' });

    await build(withIcon);
    expect(getBuildContext(withIcon).styles.icons).toBe(true);

    const plain = pluginRoot(FILES);

    await build(plain, { fallback: { icons: true } });
    expect(getBuildContext(plain).styles.icons).toBe(true);
    await build(withIcon, { fallback: { icons: false } });
    expect(getBuildContext(withIcon).styles.icons).toBe(false);
  });

  test('the safelist adds classes the scan cannot see', async () => {
    const root = pluginRoot(FILES);
    const files = await build(root, { fallback: { safelist: ['table', 'progress-bar'] } });

    expect(files['fallback.css']).toContain('.progress-bar');
  });

  test('an unknown safelist entry fails the build and names near matches', async () => {
    const root = pluginRoot(FILES);

    await expect(build(root, { fallback: { safelist: ['text-bg-sucess'] } })).rejects.toThrow(
      /text-bg-sucess[\s\S]*did you mean "text-bg-success"/,
    );
  });

  test('a server build gets no-op plugins', () => {
    expect(Object.keys(panoFallbackCss({ ns: 'market', side: 'server' }))).toEqual(['name']);
    expect(Object.keys(panoPluginCss({ ns: 'market', side: 'server' }))).toEqual(['name']);
  });

  test('a bad namespace is refused', () => {
    expect(() => panoFallbackCss({ ns: 'Bad' })).toThrow(/ns/);
  });
});

describe('plugin.css (doc 03 section 3.1)', () => {
  test('component CSS lands in @layer pano-plugin with the hashed selectors of the compiled markup', async () => {
    const root = pluginRoot(FILES);
    const files = await build(root);
    const own = files['plugin.css'];

    expect(own.startsWith('@layer pano-plugin {')).toBe(true);
    expect(own.trimEnd().endsWith('}')).toBe(true);
    expect(own).toContain('src/theme/views/ProductCard.svelte');

    const hash = /svelte-[a-z0-9]+/.exec(own)[0];

    expect(own).toContain(`.market-product-card.${hash}`);
    expect(own).toContain(`.card-title.${hash}`);
    // the same hash class sits on the markup of the compiled component
    expect(files['client.mjs']).toContain(hash);
    expect(own).not.toContain('<style');
  });

  test('a plugin without <style> emits no file and no styles.own', async () => {
    const root = pluginRoot({
      'src/theme/views/Plain.svelte': '<div class="card">x</div>',
      'src/entry.js': "import P from './theme/views/Plain.svelte'; export default P;",
    });
    const files = await build(root);

    expect(files['plugin.css']).toBeUndefined();
    expect(getBuildContext(root).styles.own).toBeUndefined();
    expect(getBuildContext(root).styles.fallback).toBe('client/fallback.css');
    expect(getBuildContext(root).styles.hash).toBe(styleHash({ fallback: files['fallback.css'] }));
  });

  test('with emitCss: true the same CSS is collected and no .css module reaches the bundle', async () => {
    const root = pluginRoot(FILES);
    const compiledHere = await build(root);
    const emitted = await build(pluginRoot(FILES), { emitCss: true });

    expect(emitted['plugin.css']).toBeDefined();
    expect(emitted['client.mjs']).not.toContain('.css');

    const hashOf = (css) => /svelte-[a-z0-9]+/.exec(css)[0];

    // the file name of the hash differs between two temp roots, but both modes compile each root alike
    const sameRoot = await build(root, { emitCss: true });

    expect(hashOf(sameRoot['plugin.css'])).toBe(hashOf(compiledHere['plugin.css']));
    expect(sameRoot['plugin.css']).toBe(compiledHere['plugin.css']);
  });

  test('a rebuild forgets what the previous build recorded', async () => {
    const root = pluginRoot(FILES);

    await build(root);
    expect(getBuildContext(root).styles.own).toBe('client/plugin.css');

    fs.writeFileSync(
      path.join(root, 'src/theme/views/ProductCard.svelte'),
      CARD.replace(/<style>[\s\S]*<\/style>/, ''),
    );
    await build(root);
    expect(getBuildContext(root).styles.own).toBeUndefined();
  });
});

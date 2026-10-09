// TC-38: the built runtime working end to end on happy-dom, laid out the way Pano serves it:
//   <site>/api/v1/widgets/loader.js            <site>/api/v1/widgets/runtime/...
//   <site>/api/v1/plugins/<id>/_/ui/widgets/<View>-<hash>.js   (imports the runtime by the relative URLs of doc 06 section 3.3)
// The widget module is compiled here the way the kit's widget target compiles one (TC-43 does the real thing).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { RUNTIME_FILES, widgetImportPath } from '../../scripts/runtime-map.js';
import { BUDGET, PACKAGE_DIR, RUNTIME_DIR, installDom, requireBuild, restoreDom, settle } from './helpers.js';

const require = createRequire(import.meta.url);
const { compile } = require('svelte/compiler');

const SITE = join(PACKAGE_DIR, 'dist/test-site');
const WIDGETS = join(SITE, 'api/v1/widgets');
const PLUGIN_UI = join(SITE, 'api/v1/plugins/pano-plugin-test/_/ui');
const GOAL = `
<script>
  import { showToast } from '@panomc/sdk/toasts';
  let { data, label = 'goal' } = $props();
</script>
<p class="goal">{label}:{data?.value}</p>
<button type="button" onclick={() => showToast('hello', {}, undefined, { variant: 'success' })}>toast</button>
`;

/** compiled client code with every runtime specifier rewritten to the relative runtime URL, like the widget target's output.paths */
function widgetModule() {
  let code = compile(GOAL, { generate: 'client', filename: 'GoalWidget.svelte', dev: false }).js.code;
  for (const spec of Object.keys(RUNTIME_FILES)) {
    for (const q of ['"', "'"]) {
      code = code.replaceAll(`from ${q}${spec}${q}`, `from "${widgetImportPath(spec)}"`).replaceAll(`import ${q}${spec}${q}`, `import "${widgetImportPath(spec)}"`);
    }
  }
  return `${code}
export const component = GoalWidget;
export const load = async () => ({ data: { value: 7 } });
export const attrs = ['label'];
export const session = 'none';
`;
}

const index = {
  runtime: { svelte: '5', hash: 'x' },
  site: { name: 'Test', url: 'https://site.test', locale: 'en' },
  widgets: {
    'pano-test-goal': {
      pluginId: 'pano-plugin-test', ns: 'test', module: 'GoalWidget-abc.js', attrs: ['label'], session: 'none', controllers: false,
      styles: { fallback: 'fallback.css', hash: 'h1', icons: 'icons.css' },
    },
    'pano-test-late': {
      pluginId: 'pano-plugin-test', ns: 'test', module: 'GoalWidget-abc.js', attrs: ['label'], session: 'none', controllers: false,
      styles: { fallback: 'fallback.css', hash: 'h1' },
    },
  },
};

const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await settle(10);
  }
  throw new Error('timed out');
};
const text = (el) => el.shadowRoot?.querySelector('.pano-fb .goal')?.textContent;

let fetchCalls = [];
let loaderModule;
let first;

beforeAll(async () => {
  requireBuild();
  rmSync(SITE, { recursive: true, force: true });
  mkdirSync(PLUGIN_UI + '/widgets', { recursive: true });
  cpSync(RUNTIME_DIR, join(WIDGETS, 'runtime'), { recursive: true });
  cpSync(join(RUNTIME_DIR, 'loader.js'), join(WIDGETS, 'loader.js'));
  writeFileSync(join(PLUGIN_UI, 'widgets/GoalWidget-abc.js'), widgetModule());

  installDom('https://site.test/page');
  document.body.innerHTML = '<pano-test-goal label="x" id="first"></pano-test-goal><pano-not-listed id="nope"></pano-not-listed>';
  first = document.getElementById('first');

  loaderModule = await import(pathToFileURL(join(WIDGETS, 'loader.js')).href);
  // a module script after the loader configures it before the first scan
  window.PanoWidgets.configure({
    locale: 'en',
    urls: { 'auth.login': '/login' },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).endsWith('/api/v1/widgets/index.json')) return new Response(JSON.stringify(index), { headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 });
    },
  });
});

afterAll(() => {
  restoreDom();
  rmSync(SITE, { recursive: true, force: true });
});

describe('loader.js over the served layout', () => {
  test('reads the index once, defines the listed tags that are on the page and ignores unknown pano-* tags', async () => {
    await until(() => text(first) === 'x:7');
    expect(fetchCalls.filter((u) => u.endsWith('/api/v1/widgets/index.json')).length).toBe(1);
    expect(fetchCalls[0]).toContain('/dist/test-site/api/v1/widgets/index.json');
    expect(customElements.get('pano-test-goal')).toBeDefined();
    expect(customElements.get('pano-test-late')).toBeUndefined(); // not on the page yet: its module is not even requested
    expect(customElements.get('pano-not-listed')).toBeUndefined();
    expect(first.dataset.panoState).toBe('ready');
  });

  test('the plugin sheets are linked in the shadow root, the token and icon sheets once in head', () => {
    const hrefs = [...first.shadowRoot.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href'));
    expect(hrefs[0]).toEndWith('/api/v1/plugins/pano-plugin-test/_/ui/fallback.css?v=h1');
    expect(hrefs[1]).toEndWith('/api/v1/plugins/pano-plugin-test/_/ui/icons.css');
    const head = [...document.head.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href'));
    expect(head.filter((h) => h.endsWith('/api/v1/widgets/runtime/css/pano-tokens.css')).length).toBe(1);
    expect(head.filter((h) => h.endsWith('/_/ui/icons.css')).length).toBe(1);
  });

  test('data-bs-theme is the palette of the script, light by default', () => {
    expect(first.getAttribute('data-bs-theme')).toBe('light');
  });

  test('configure reaches the host: apiBase from the loader URL, locale, urls, the site url of the index', async () => {
    const host = await window.PanoWidgets.host();
    const config = host.getConfig();
    expect(config.apiBase).toContain('/dist/test-site');
    expect(config.locale).toBe('en');
    expect(config.urls['auth.login']).toBe('/login');
    expect(config.siteUrl).toBe('https://site.test');
    // the loader and a widget module import the host from the same URL: one module instance, so one Svelte
    const direct = await import(pathToFileURL(join(WIDGETS, 'runtime', RUNTIME_FILES['@panomc/sdk'])).href);
    expect(direct).toBe(host);
  });

  test('a widget added later is picked up by the observer and its module is imported on first use', async () => {
    const late = document.createElement('pano-test-late');
    late.setAttribute('label', 'y');
    document.body.append(late);
    await until(() => text(late) === 'y:7');
    expect(customElements.get('pano-test-late')).toBeDefined();
    expect(late.getAttribute('data-bs-theme')).toBe('light');

    const again = document.createElement('pano-test-goal');
    again.setAttribute('label', 'z');
    document.body.append(again);
    await until(() => text(again) === 'z:7');
    expect(fetchCalls.filter((u) => u.endsWith('/api/v1/widgets/index.json')).length).toBe(1);
  });

  test('widget code and the host share the page state: a toast raised in the widget reaches its element', async () => {
    const events = [];
    // events go to the most recent widget; with a second copy of the host they would be raised on `document`
    document.addEventListener('pano:toast', (e) => events.push({ detail: e.detail, target: e.target }));
    first.shadowRoot.querySelector('button').click();
    await until(() => events.length > 0);
    expect(events[0].detail.variant).toBe('success');
    expect(events[0].target.localName).toStartWith('pano-test-');
  });

  test('a widget module is small', () => {
    const size = gzipSync(readFileSync(join(PLUGIN_UI, 'widgets/GoalWidget-abc.js')), { level: 9 }).length;
    console.log(`fixture widget module: ${size} B gzip`);
    expect(size).toBeLessThanOrEqual(BUDGET.marketWidget);
  });

  test('loader module exposes the same PanoWidgets object it installed', () => {
    expect(typeof window.PanoWidgets.configure).toBe('function');
    expect(loaderModule).toBeDefined();
  });
});

// TC-38: the shape and the size of `dist/runtime` (run `bun run build` first). Doc 06 section 3.3.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { RUNTIME_SPECIFIERS } from '../../../theme-core/src/kit/specifiers.js';
import { RUNTIME_FILES, widgetImportPath } from '../../scripts/runtime-map.js';
import { SPECIFIER_MODULES } from '../../src/index.js';
import { BUDGET, RUNTIME_DIR, bareImports, closure, gzipSize, gzipTotal, installDom, kb, read, requireBuild, restoreDom, runtimeFiles, staticImports } from './helpers.js';

const require = createRequire(import.meta.url);
const svelteDir = dirname(require.resolve('svelte/package.json'));
const svelteExports = JSON.parse(readFileSync(join(svelteDir, 'package.json'), 'utf8')).exports;
const svelteVersion = JSON.parse(readFileSync(join(svelteDir, 'package.json'), 'utf8')).version;

let files;
beforeAll(() => {
  requireBuild();
  files = runtimeFiles();
  installDom(); // svelte/motion and svelte/reactivity/window touch `window` when they load
});
afterAll(() => restoreDom());

describe('layout', () => {
  test('one entry per svelte name of RUNTIME_SPECIFIERS, with the same file name', () => {
    const svelteNames = Object.entries(RUNTIME_SPECIFIERS).filter(([spec]) => spec === 'svelte' || spec.startsWith('svelte/'));
    expect(svelteNames.length).toBe(17);
    for (const [spec, file] of svelteNames) {
      expect(files).toContain(file);
      expect(RUNTIME_FILES[spec]).toBe(file);
    }
  });

  test('svelte-i18n.js, loader.js, the css and the webfonts', () => {
    for (const f of ['svelte-i18n.js', 'loader.js', 'css/pano-tokens.css', 'css/pano-fallback-icons.css', 'runtime.json']) expect(files).toContain(f);
    expect(files.filter((f) => f.startsWith('webfonts/') && f.endsWith('.woff2')).length).toBeGreaterThanOrEqual(3);
    expect(read('css/pano-fallback-icons.css')).toContain('../webfonts/fa-solid-900.woff2');
    expect(read('css/pano-tokens.css')).toContain('@layer pano-defaults');
  });

  test('one host/<module>.js per SDK facade of SPECIFIER_MODULES', () => {
    const hostFiles = files.filter((f) => f.startsWith('host/'));
    expect(hostFiles.length).toBe(Object.keys(SPECIFIER_MODULES).length);
    for (const spec of Object.keys(SPECIFIER_MODULES)) {
      expect(RUNTIME_FILES[spec]).toMatch(/^host\/[a-z-]+\.js$/);
      expect(files).toContain(RUNTIME_FILES[spec]);
    }
    expect(RUNTIME_FILES['@panomc/sdk/toasts']).toBe('host/toasts.js');
  });

  test('a widget module in .../_/ui/widgets/ reaches the runtime five levels up (doc 06 section 3.3)', () => {
    expect(widgetImportPath('svelte/internal/client')).toBe('../../../../../widgets/runtime/svelte/internal-client.js');
    expect(widgetImportPath('@panomc/sdk/toasts')).toBe('../../../../../widgets/runtime/host/toasts.js');
  });

  test('runtime.json: svelte pin, hash and the file table', () => {
    const meta = JSON.parse(read('runtime.json'));
    expect(meta.format).toBe(1);
    expect(meta.svelte).toBe(svelteVersion);
    expect(meta.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(meta.specifiers).toEqual(RUNTIME_FILES);
    expect(meta.files).toEqual(files.filter((f) => f !== 'runtime.json'));
  });

  test('no bare specifier is left in any file (nothing needs an import map)', () => {
    for (const f of files.filter((x) => x.endsWith('.js'))) expect([f, ...bareImports(f)]).toEqual([f]);
  });

  test('every relative import points at a file of the runtime', () => {
    for (const f of files.filter((x) => x.endsWith('.js'))) {
      for (const spec of staticImports(f)) {
        const target = join(dirname(f), spec).split('\\').join('/');
        expect(files).toContain(target);
      }
    }
  });
});

describe('one Svelte', () => {
  test('the Svelte runtime exists once (its error table, which every copy carries, is in one file)', () => {
    const holders = files.filter((f) => f.endsWith('.js') && read(f).includes('svelte.dev/e/effect_orphan'));
    expect(holders.length).toBe(1);
  });

  test('every entry keeps the export names of the package it stands for', async () => {
    const pick = (entry) => {
      if (typeof entry === 'string') return entry;
      for (const key of ['browser', 'import', 'default']) if (entry && key in entry) return pick(entry[key]);
      return null;
    };
    const names = async (file) => Object.keys(await import(file)).sort();
    for (const [spec, runtimeFile] of Object.entries(RUNTIME_FILES)) {
      if (!spec.startsWith('svelte/') && spec !== 'svelte') continue;
      if (spec === 'svelte/internal') continue; // throws on purpose (a Svelte 4 leftover), in the package and here
      if (spec === 'svelte/internal/client') continue; // exports 400+ minified-internal names; checked below
      const key = spec === 'svelte' ? '.' : `./${spec.slice('svelte/'.length)}`;
      const source = join(svelteDir, pick(svelteExports[key]));
      expect([spec, await names(join(RUNTIME_DIR, runtimeFile))]).toEqual([spec, await names(source)]);
    }
  });

  test('svelte/internal/client keeps every export of the package', async () => {
    const source = join(svelteDir, 'src/internal/client/index.js');
    const built = Object.keys(await import(join(RUNTIME_DIR, 'svelte/internal-client.js'))).sort();
    const wanted = Object.keys(await import(source)).sort();
    expect(built).toEqual(wanted);
  });

  test('host modules and the loader reach Svelte only through the svelte/ entries', () => {
    const host = closure('host/index.js');
    expect(host).toContain('svelte/index.js');
    expect(host.filter((f) => f.startsWith('svelte/')).length).toBeGreaterThan(0);
    // no host file carries its own copy of the Svelte runtime
    for (const f of files.filter((x) => x.startsWith('host/'))) expect(read(f)).not.toContain('svelte.dev/e/effect_orphan');
  });
});

describe('sizes (gzip)', () => {
  test('loader', () => {
    const size = gzipSize('loader.js');
    console.log(`loader.js: ${size} B gzip (${kb(size)})`);
    expect(size).toBeLessThanOrEqual(BUDGET.loader);
    expect(staticImports('loader.js')).toEqual([]);
  });

  test('eager runtime: Svelte client + host, svelte-i18n and the rest of the static graph of host/index.js', () => {
    const all = closure('host/index.js');
    const eager = gzipTotal(all);
    const withoutI18n = gzipTotal(all.filter((f) => f !== 'svelte-i18n.js'));
    console.log(`eager runtime: ${eager} B gzip over ${all.length} files (${kb(eager)}), without svelte-i18n ${withoutI18n} B (${kb(withoutI18n)})`);
    expect(eager).toBeLessThanOrEqual(BUDGET.eagerRuntime);
    expect(withoutI18n).toBeLessThanOrEqual(BUDGET.eagerRuntimeWithoutI18n);
  });

  test('Svelte client and svelte-i18n', () => {
    const client = gzipTotal(closure('svelte/index.js'));
    const i18n = gzipSize('svelte-i18n.js');
    console.log(`svelte client: ${client} B gzip (${kb(client)}), svelte-i18n.js: ${i18n} B (${kb(i18n)})`);
    expect(client).toBeLessThanOrEqual(BUDGET.svelteClient);
    expect(i18n).toBeLessThanOrEqual(BUDGET.svelteI18n);
  });

  test('rarely used Svelte entries are not part of the eager runtime', () => {
    const all = closure('host/index.js');
    for (const f of ['svelte/motion.js', 'svelte/legacy.js', 'svelte/reactivity-window.js', 'svelte/transition.js', 'svelte/animate.js']) {
      expect(all).not.toContain(f);
    }
  });
});

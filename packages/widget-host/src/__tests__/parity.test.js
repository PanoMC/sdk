// W1: every name an SDK facade exports exists in the widget host (doc 06 section 3.2), for every facade under packages/sdk/src.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBrowserEnv, uninstallBrowserEnv } from './env.js';

const here = dirname(fileURLToPath(import.meta.url));
const hostSrc = resolve(here, '..');
const sdkDir = resolve(here, '../../../sdk');
const sdkPackage = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'));

// exports that are not facades: build output, the engine's core files, package.json
const NOT_FACADES = (key) => key === './package.json' || key.startsWith('./build/') || key.startsWith('./core/');

/** A value that answers every property read and call: stands in for the theme's context while a facade module evaluates. */
const deep = () => new Proxy(function () {}, { get: (_t, key) => (key === 'then' ? undefined : deep()), apply: () => deep() });

const facades = Object.entries(sdkPackage.exports)
  .filter(([key]) => !NOT_FACADES(key))
  .map(([key, value]) => ({
    key,
    specifier: key === '.' ? '@panomc/sdk' : `@panomc/sdk/${key.slice(2)}`,
    file: join(sdkDir, (typeof value === 'string' ? value : (value.default ?? value.svelte)).replace(/^\.\//, '')),
  }));

let host;
let SPECIFIER_MODULES;

beforeAll(async () => {
  await installBrowserEnv();
  globalThis.__PANO_CONTEXT__ = { context: deep(), listeners: [] };
  host = await import('../index.js');
  SPECIFIER_MODULES = host.SPECIFIER_MODULES;
});

afterAll(() => {
  delete globalThis.__PANO_CONTEXT__;
  uninstallBrowserEnv();
});

describe('export parity with the SDK facades', () => {
  test('the SDK still has the facades this test knows', () => {
    const specifiers = facades.map((f) => f.specifier);
    for (const must of ['@panomc/sdk', '@panomc/sdk/svelte', '@panomc/sdk/views', '@panomc/sdk/controllers', '@panomc/sdk/toasts']) {
      expect(specifiers).toContain(must);
    }
  });

  test('every SDK facade has a host module, and no host module is for a facade that is gone', () => {
    expect(Object.keys(SPECIFIER_MODULES).sort()).toEqual(facades.map((f) => f.specifier).sort());
  });

  for (const facade of facades) {
    test(`${facade.specifier} -> every export is present`, async () => {
      const sdk = await import(facade.file);
      const module = await import(join(hostSrc, SPECIFIER_MODULES[facade.specifier]));

      expect(Object.keys(sdk).length).toBeGreaterThan(0);
      const missing = Object.keys(sdk).filter((name) => !(name in module));
      expect(missing).toEqual([]);
    });
  }

  test('the names of the work order are really there', async () => {
    const names = {
      'svelte.js': ['browser', 'base', 'page', 'goto', 'redirect', 'error', 'invalidate', 'invalidateAll', 'navigating'],
      'language.js': ['_', 'currentLanguage', 'changeLanguage', 'languageLoading', 'Languages', 'init', 'getAcceptedLanguage', 'loadLanguage', 'getLanguageByLocale'],
      'toasts.js': ['showToast', 'limitTitle'],
      'api.js': ['ApiUtil', 'NETWORK_ERROR', 'networkErrorBody', 'buildQueryParams', 'createPluginApi'],
      'controllers.js': ['plugin', 'useController', 'reactive'],
      'views.js': ['createViewProxy'],
      'index.js': ['viewComponent', 'getPanoContext', 'PanoPlugin', 'defineWidget'],
    };
    for (const [file, list] of Object.entries(names)) {
      const module = await import(join(hostSrc, file));
      for (const name of list) expect(name in module).toBe(true);
    }
    const components = await import(join(hostSrc, 'components/index.js'));
    for (const name of ['PlayerHead', 'NoContent', 'Date', 'Toast', 'PageTitle', 'PageActions', 'Pagination', 'PluginBlock', 'PluginSlot']) {
      expect(typeof components[name]).toBe('function');
    }
  });

  test('createPluginApi has the contract of @panomc/sdk/utils/api', async () => {
    const { createPluginApi } = await import(join(hostSrc, 'api.js'));

    expect(() => createPluginApi('market/x')).toThrow(/full plugin id/);
    expect(() => createPluginApi(undefined)).toThrow(/full plugin id/);

    const api = createPluginApi('pano-plugin-market');
    for (const scope of [api, api.panel]) {
      for (const method of ['get', 'post', 'put', 'delete', 'customRequest']) expect(typeof scope[method]).toBe('function');
    }
    expect(await api.get({ path: '/api/v1/x' }).catch((e) => e.message)).toMatch(/must not start with \/api/);
    expect(await api.panel.get({}).catch((e) => e.message)).toMatch(/must be a string/);
  });

  test('createPluginApi calls the unversioned plugin namespace (decision 81)', async () => {
    const { createPluginApi } = await import(join(hostSrc, 'api.js'));
    const { configure, resetConfig } = await import(join(hostSrc, 'config.js'));
    const calls = [];
    configure({
      apiBase: 'https://pano.test',
      csrf: 'off',
      fetch: async (url, init) => {
        calls.push([init?.method ?? 'GET', String(url)]);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    try {
      const api = createPluginApi('pano-plugin-market');
      await api.get({ path: '/store/products' });
      await api.panel.get({ path: '/products' });
    } finally {
      resetConfig();
    }
    expect(calls).toEqual([
      ['GET', 'https://pano.test/api/plugins/pano-plugin-market/store/products'],
      ['GET', 'https://pano.test/api/plugins/pano-plugin-market/panel/products'],
    ]);
  });
});

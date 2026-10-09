import { describe, expect, mock, test } from 'bun:test';
import { writable } from 'svelte/store';

// FX-01: a theme process downloads a plugin's UI zip from `/plugins/<id>/_/ui.zip` (relative to /api/v1).

const calls = [];
const ApiUtil = {
  get: async (options) => {
    calls.push(options);
    return new Blob(['zip']);
  },
};

mock.module('$lib/api.util.js', () => ({ default: ApiUtil }));
mock.module('$lib/PluginAPI.js', () => ({
  init: () => {},
  panoApiClient: {},
  panoApiServer: {},
}));
mock.module('$app/environment', () => ({ browser: false, dev: false }));
mock.module('$app/paths', () => ({ base: '' }));
mock.module('@sveltejs/kit', () => ({
  error: (status, message) => Object.assign(new Error(`HTTP ${status} ${message ?? ''}`), { status }),
}));
mock.module('svelte/store', () => ({ writable, get: (store) => { let v; store.subscribe((x) => (v = x))(); return v; } }));

const manager = await import('../PluginManager.js');

describe('downloadPluginUiZip', () => {
  test('asks the core endpoint relative to /api/v1, as a blob', async () => {
    calls.length = 0;
    const file = await manager.downloadPluginUiZip('pano-plugin-market');

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/plugins/pano-plugin-market/_/ui.zip');
    expect(calls[0].blob).toBe(true);
    expect(file).toBeInstanceOf(Blob);
  });

  test('no path literal of the file starts with /api', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../PluginManager.js', import.meta.url), 'utf8');

    expect(source).not.toMatch(/\/api\//);
    expect(source).not.toContain('resources/plugin-ui.zip');
  });
});

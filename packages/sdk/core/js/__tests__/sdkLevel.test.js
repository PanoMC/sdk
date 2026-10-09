import { describe, expect, mock, spyOn, test } from 'bun:test';
import { get } from 'svelte/store';

// TC-70: a plugin module without `panoSdk === 2` was built for @panomc/sdk 1.x and is skipped.

mock.module('$lib/api.util.js', () => ({ default: {} }));
mock.module('$lib/PluginAPI.js', () => ({ init: () => {}, panoApiClient: {}, panoApiServer: {} }));
mock.module('$app/environment', () => ({ browser: false, dev: false }));
mock.module('$app/paths', () => ({ base: '' }));
mock.module('@sveltejs/kit', () => ({ error: (status) => new Error(`HTTP ${status}`) }));

const manager = await import('../PluginManager.js');

describe('dropOldSdkPlugins', () => {
  test('a 1.x module is skipped with the rebuild message; a 2.x module stays', () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    manager.plugins.set({
      old: { module: { default: class {} } },
      wrong: { module: { default: class {}, panoSdk: 1 } },
      fresh: { module: { default: class {}, panoSdk: 2 } },
      unloaded: {},
    });

    const skipped = manager.dropOldSdkPlugins();
    const messages = spy.mock.calls.map((call) => String(call[0]));
    spy.mockRestore();

    expect(skipped).toEqual(['old', 'wrong']);
    expect(Object.keys(get(manager.plugins))).toEqual(['fresh', 'unloaded']);
    expect(messages).toContain(
      '[Plugin Manager] old was built for @panomc/sdk 1.x and does not load on this Pano; rebuild it with @panomc/plugin-kit',
    );
  });
});

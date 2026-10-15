import { describe, expect, mock, test } from 'bun:test';
import { get } from 'svelte/store';

// The server side of the `$app/stores` shapes over `$app/state`. A flag stands for "the host's component context is
// current": SvelteKit's server `page` throws when it is not.
const state = { rendering: true, url: new URL('https://pano.example/store') };

mock.module('$app/env', () => ({ browser: false, dev: false }));
mock.module('$app/state', () => {
  const read = (name) => {
    if (!state.rendering) throw new Error(`Can only read \`page.${name}\` on the server during rendering`);
    return name === 'url' ? state.url : name === 'data' ? { from: state.url.pathname } : null;
  };
  return {
    page: new Proxy({}, { get: (_, name) => read(String(name)) }),
    navigating: { from: null, to: null, type: null, willUnload: null, delta: null, complete: null },
  };
});

const stores = await import('../appStores.js');

describe('appStores on the server', () => {
  test('a read outside the host render throws while no request was captured', () => {
    state.rendering = false;
    expect(() => get(stores.page)).toThrow('during rendering');
  });

  test('during the host render the page is read from $app/state', () => {
    state.rendering = true;
    expect(get(stores.page).url.pathname).toBe('/store');
    expect(get(stores.page).data).toEqual({ from: '/store' });
  });

  test('a read outside it gets the page captured by the host app layout', () => {
    state.rendering = true;
    state.url = new URL('https://pano.example/support');
    stores.captureRequestState();

    state.rendering = false;
    expect(get(stores.page).url.pathname).toBe('/support');
  });

  test('navigating is null while the server renders', () => {
    state.rendering = false;
    expect(get(stores.navigating)).toBeNull();
  });
});

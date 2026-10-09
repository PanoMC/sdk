import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readable, writable } from 'svelte/store';

// TC-34: transport on /api/v1 and the plugin-scoped client (doc 04 section 9).

const state = { apiUrl: 'http://127.0.0.1:8088/api', browser: false };

function mockHost() {
  mock.module('$lib/variables.js', () => ({
    get API_URL() {
      return state.apiUrl;
    },
    CSRF_HEADER: 'X-CSRF-Token',
  }));
  mock.module('$app/environment', () => ({
    get browser() {
      return state.browser;
    },
  }));
  mock.module('$app/stores', () => ({ page: readable({ data: {} }) }));
  mock.module('$lib/Store.js', () => ({ initialized: writable(true) }));
  mock.module('$lib/components/ToastContainer.svelte', () => ({ show: async () => {} }));
}

mockHost();

// Bun snapshots a mock factory's values, so a change is applied by registering the mock again
// (the imports of api.util.js are live bindings and see the new values).
function setHost(next) {
  Object.assign(state, next);
  mockHost();
}

const mod = await import('../api.util.js');
const { default: ApiUtil, resolveApiUrl, createPluginApi, networkErrorBody } = mod;

const realFetch = globalThis.fetch;
const realLog = console.log;

/** @param {(url: string, init: any) => Response | Promise<Response>} impl */
function recordingFetch(impl) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  fn.calls = calls;
  return fn;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  setHost({ apiUrl: 'http://127.0.0.1:8088/api', browser: false });
  console.log = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

describe('resolveApiUrl: the four cases', () => {
  test('website (.panomc.com): API_URL + path, no /v1', () => {
    expect(resolveApiUrl('/resources', { apiUrl: 'https://api.panomc.com' })).toBe('https://api.panomc.com/resources');
    expect(
      resolveApiUrl('/resources', { apiUrl: 'https://api.panomc.com', hasEventFetch: true, browser: true, prod: true }),
    ).toBe('https://api.panomc.com/resources');
    // the /api refusal does not apply to the website API
    expect(resolveApiUrl('/api/x', { apiUrl: 'https://api-dev.panomc.com' })).toBe('https://api-dev.panomc.com/api/x');
  });

  test('SSR with request.fetch: relative /api/v1', () => {
    expect(resolveApiUrl('/posts', { apiUrl: 'http://127.0.0.1:8088/api', hasEventFetch: true })).toBe('/api/v1/posts');
    expect(resolveApiUrl('/posts', { apiUrl: 'http://10.0.0.5:8088/api', hasEventFetch: true, prod: true })).toBe(
      '/api/v1/posts',
    );
  });

  test('browser, production: relative /api/v1', () => {
    expect(resolveApiUrl('/posts', { apiUrl: 'http://10.0.0.5:8088/api', browser: true, prod: true })).toBe('/api/v1/posts');
  });

  test('browser, loopback API_URL in dev: relative /api/v1', () => {
    for (const apiUrl of ['http://localhost:8088/api', 'http://127.0.0.1:8088/api', 'http://0.0.0.0:8088/api']) {
      expect(resolveApiUrl('/posts', { apiUrl, browser: true })).toBe('/api/v1/posts');
    }
  });

  test('SSR without an event: absolute API_URL + /v1', () => {
    expect(resolveApiUrl('/posts', { apiUrl: 'http://127.0.0.1:8088/api' })).toBe('http://127.0.0.1:8088/api/v1/posts');
    expect(resolveApiUrl('/posts', { apiUrl: 'http://backend:8088/api/' })).toBe('http://backend:8088/api/v1/posts');
  });

  test('browser, dev, non-loopback API_URL: absolute API_URL + /v1', () => {
    expect(resolveApiUrl('/posts', { apiUrl: 'http://backend:8088/api', browser: true })).toBe(
      'http://backend:8088/api/v1/posts',
    );
  });

  test('a path without a leading slash gets one', () => {
    expect(resolveApiUrl('posts?page=2', { apiUrl: 'http://127.0.0.1:8088/api', hasEventFetch: true })).toBe(
      '/api/v1/posts?page=2',
    );
  });
});

describe('/api refusal', () => {
  test('throws in dev with the fix in the message', () => {
    expect(() => resolveApiUrl('/api/posts', { apiUrl: 'http://127.0.0.1:8088/api' })).toThrow(
      "[pano] path must not start with /api: write '/posts'",
    );
    expect(() => resolveApiUrl('/api/v1/posts', { apiUrl: 'http://127.0.0.1:8088/api', hasEventFetch: true })).toThrow(
      "write '/v1/posts'",
    );
  });

  test('does not throw in production, and "/apiary" is not an /api path', () => {
    expect(() => resolveApiUrl('/api/posts', { apiUrl: 'http://127.0.0.1:8088/api', prod: true })).not.toThrow();
    expect(resolveApiUrl('/apiary', { apiUrl: 'http://127.0.0.1:8088/api', hasEventFetch: true })).toBe('/api/v1/apiary');
  });

  test('ApiUtil.get rejects before any request is made', async () => {
    const fetchMock = recordingFetch(() => json({}));
    globalThis.fetch = fetchMock;
    await expect(ApiUtil.get({ path: '/api/posts' })).rejects.toThrow('must not start with /api');
    expect(fetchMock.calls.length).toBe(0);
  });
});

describe('ApiUtil requests', () => {
  test('SSR with request.fetch calls the relative URL through request.fetch', async () => {
    const eventFetch = recordingFetch(() => json({ items: [], page: { number: 1 } }));
    const direct = recordingFetch(() => json({}));
    globalThis.fetch = direct;

    const body = await ApiUtil.get({ path: '/posts', csrfToken: 'x', request: { fetch: eventFetch } });

    expect(body).toEqual({ items: [], page: { number: 1 } });
    expect(eventFetch.calls.map((c) => c.url)).toEqual(['/api/v1/posts']);
    expect(direct.calls.length).toBe(0);
  });

  test('SSR without an event calls the absolute URL', async () => {
    const fetchMock = recordingFetch(() => json({ ok: 1 }));
    globalThis.fetch = fetchMock;

    await ApiUtil.get({ path: '/posts', csrfToken: 'x' });

    expect(fetchMock.calls[0].url).toBe('http://127.0.0.1:8088/api/v1/posts');
  });

  test('browser (loopback API_URL) calls the relative URL', async () => {
    setHost({ browser: true });
    const fetchMock = recordingFetch(() => json({ ok: 1 }));
    globalThis.fetch = fetchMock;

    await ApiUtil.get({ path: '/posts', csrfToken: 'x' });

    expect(fetchMock.calls[0].url).toBe('/api/v1/posts');
  });

  test('website API_URL keeps its form', async () => {
    setHost({ apiUrl: 'https://api.panomc.com' });
    const fetchMock = recordingFetch(() => json({ ok: 1 }));
    globalThis.fetch = fetchMock;

    await ApiUtil.get({ path: '/resources', csrfToken: 'x' });
    await ApiUtil.get({ path: '/resources', csrfToken: 'x', request: { fetch: fetchMock } });

    expect(fetchMock.calls.map((c) => c.url)).toEqual([
      'https://api.panomc.com/resources',
      'https://api.panomc.com/resources',
    ]);
  });

  test('a non-2xx answer returns the envelope unchanged', async () => {
    const envelope = { error: { code: 'NOT_EXISTS', message: 'gone', details: { id: 3 }, fields: { id: 'NOT_FOUND' } } };
    globalThis.fetch = recordingFetch(() => json(envelope, 404));

    expect(await ApiUtil.get({ path: '/posts/3', csrfToken: 'x' })).toEqual(envelope);
  });

  test('POST sends the CSRF header and a JSON body', async () => {
    const fetchMock = recordingFetch(() => json({}));
    globalThis.fetch = fetchMock;

    await ApiUtil.post({ path: '/auth/login', body: { a: 1 }, csrfToken: 'tok' });

    const { url, init } = fetchMock.calls[0];
    expect(url).toBe('http://127.0.0.1:8088/api/v1/auth/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  test('a network failure returns { error: { code: NETWORK_ERROR } }', async () => {
    globalThis.fetch = recordingFetch(() => {
      throw new TypeError('fetch failed');
    });

    const result = await ApiUtil.post({ path: '/posts', csrfToken: 'x', body: {} });

    expect(result).toEqual({ error: { code: 'NETWORK_ERROR' } });
    expect(networkErrorBody).toEqual({ error: { code: 'NETWORK_ERROR' } });
  });

  test('DISABLED_FOR_DEMO is read from error.code and resolves nothing', async () => {
    globalThis.fetch = recordingFetch(() => json({ error: { code: 'DISABLED_FOR_DEMO' } }, 403));
    const handled = [];

    const result = await ApiUtil.post({
      path: '/panel/settings',
      csrfToken: 'x',
      body: {},
      handler: (body) => handled.push(body),
    });

    expect(result).toBeUndefined();
    expect(handled).toEqual([]);
  });

  test('the old string form is no longer the demo marker', async () => {
    globalThis.fetch = recordingFetch(() => json({ error: 'DISABLED_FOR_DEMO' }, 403));

    expect(await ApiUtil.post({ path: '/x', csrfToken: 'x', body: {} })).toEqual({ error: 'DISABLED_FOR_DEMO' });
  });
});

describe('resolveApiUrl unversioned (plugin endpoints)', () => {
  test('the four cases leave the version segment out', () => {
    expect(resolveApiUrl('/plugins/p/x', { unversioned: true, hasEventFetch: true })).toBe('/api/plugins/p/x');
    expect(resolveApiUrl('/plugins/p/x', { unversioned: true, browser: true, prod: true })).toBe('/api/plugins/p/x');
    expect(resolveApiUrl('/plugins/p/x', { unversioned: true, apiUrl: 'http://127.0.0.1:8088/api' })).toBe(
      'http://127.0.0.1:8088/api/plugins/p/x',
    );
    expect(resolveApiUrl('/plugins/p/x', { unversioned: true })).toBe('/api/plugins/p/x');
    expect(resolveApiUrl('/plugins/p/x', { hasEventFetch: true })).toBe('/api/v1/plugins/p/x');
  });
});

describe('ApiUtil routes a plugin\'s own path outside /api/v1', () => {
  test('/plugins/<id>/x and /api/plugins/<id>/x go to /api/plugins; core /plugins/<id>/_/x stays under /api/v1', async () => {
    const fetchMock = recordingFetch(() => json({}));
    globalThis.fetch = fetchMock;

    await ApiUtil.get({ path: '/plugins/pano-plugin-market/store/products', csrfToken: 'x' });
    await ApiUtil.get({ path: '/api/plugins/pano-plugin-market/store/products', csrfToken: 'x' });
    await ApiUtil.get({ path: '/plugins/pano-plugin-market/panel/products', csrfToken: 'x' });
    await ApiUtil.get({ path: '/plugins/pano-plugin-market/_/ui.zip', csrfToken: 'x' });

    expect(fetchMock.calls.map((c) => c.url)).toEqual([
      'http://127.0.0.1:8088/api/plugins/pano-plugin-market/store/products',
      'http://127.0.0.1:8088/api/plugins/pano-plugin-market/store/products',
      'http://127.0.0.1:8088/api/plugins/pano-plugin-market/panel/products',
      'http://127.0.0.1:8088/api/v1/plugins/pano-plugin-market/_/ui.zip',
    ]);
  });

  test('on the server (event fetch) the relative URL is /api/plugins, which the theme hook sends to the backend', async () => {
    const eventFetch = recordingFetch(() => json({ items: [] }));
    await ApiUtil.get({ path: '/plugins/pano-plugin-market/store/products', csrfToken: 'x', request: { fetch: eventFetch } });
    expect(eventFetch.calls[0].url).toBe('/api/plugins/pano-plugin-market/store/products');
  });
});

describe('createPluginApi', () => {
  test('prefixes /api/plugins/<id> and /api/plugins/<id>/panel (unversioned)', async () => {
    const fetchMock = recordingFetch(() => json({ items: [] }));
    globalThis.fetch = fetchMock;
    const api = createPluginApi('pano-plugin-market');

    await api.get({ path: '/store/products', csrfToken: 'x' });
    await api.post({ path: '/cart/items', body: { id: 1 }, csrfToken: 'x' });
    await api.put({ path: '/cart/items/1', body: {}, csrfToken: 'x' });
    await api.delete({ path: '/cart/items/1', csrfToken: 'x' });
    await api.customRequest({ path: '/ping', data: { method: 'PATCH' }, csrfToken: 'x' });
    await api.panel.get({ path: '/products', csrfToken: 'x' });
    await api.panel.post({ path: '/products', body: {}, csrfToken: 'x' });
    await api.panel.put({ path: '/products/1', body: {}, csrfToken: 'x' });
    await api.panel.delete({ path: '/products/1', csrfToken: 'x' });
    await api.panel.customRequest({ path: '/ping', data: { method: 'PATCH' }, csrfToken: 'x' });

    const base = 'http://127.0.0.1:8088/api';
    expect(fetchMock.calls.map((c) => [c.init?.method ?? 'GET', c.url])).toEqual([
      ['GET', `${base}/plugins/pano-plugin-market/store/products`],
      ['POST', `${base}/plugins/pano-plugin-market/cart/items`],
      ['PUT', `${base}/plugins/pano-plugin-market/cart/items/1`],
      ['DELETE', `${base}/plugins/pano-plugin-market/cart/items/1`],
      ['PATCH', `${base}/plugins/pano-plugin-market/ping`],
      ['GET', `${base}/plugins/pano-plugin-market/panel/products`],
      ['POST', `${base}/plugins/pano-plugin-market/panel/products`],
      ['PUT', `${base}/plugins/pano-plugin-market/panel/products/1`],
      ['DELETE', `${base}/plugins/pano-plugin-market/panel/products/1`],
      ['PATCH', `${base}/plugins/pano-plugin-market/panel/ping`],
    ]);
  });

  test('passes the other options through (request.fetch, token, handler)', async () => {
    const eventFetch = recordingFetch(() => json({ n: 1 }));
    const api = createPluginApi('pano-plugin-faq');

    const result = await api.get({
      path: '/faq',
      csrfToken: 'x',
      token: 'jwt',
      request: { fetch: eventFetch },
      handler: (body) => body.n + 1,
    });

    expect(result).toBe(2);
    expect(eventFetch.calls[0].url).toBe('/api/plugins/pano-plugin-faq/faq');
    expect(eventFetch.calls[0].init.headers.Authorization).toBe('Bearer jwt');
  });

  test('a path without a leading slash is accepted; a path starting with /api throws in dev', async () => {
    const fetchMock = recordingFetch(() => json({}));
    globalThis.fetch = fetchMock;
    const api = createPluginApi('pano-plugin-faq');

    await api.get({ path: 'faq', csrfToken: 'x' });
    expect(fetchMock.calls[0].url).toBe('http://127.0.0.1:8088/api/plugins/pano-plugin-faq/faq');

    await expect(api.get({ path: '/api/faq' })).rejects.toThrow('must not start with /api');
    await expect(api.panel.get({ path: '/api/faq' })).rejects.toThrow('must not start with /api');
    expect(fetchMock.calls.length).toBe(1);
  });

  test('needs the full plugin id', () => {
    expect(() => createPluginApi('')).toThrow('full plugin id');
    expect(() => createPluginApi(undefined)).toThrow('full plugin id');
    expect(() => createPluginApi('a/b')).toThrow('full plugin id');
  });
});

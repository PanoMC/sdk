import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CSRF_HEADER_NAME,
  createFetchHost,
  createSampleController,
  createState,
  defineController,
  derive,
  nullHost,
} from '../index.js';

const SOURCE_FILE = fileURLToPath(new URL('../index.js', import.meta.url));
const SDK_VARIABLES = fileURLToPath(new URL('../../../../sdk/core/js/variables.js', import.meta.url));

const browserHost = { ...nullHost, browser: true };

describe('source constraints', () => {
  test('the file has no import statement, dynamic import or require', () => {
    const source = readFileSync(SOURCE_FILE, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\bimport\.meta\b/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bfrom\s+['"]/);
  });

  test('the CSRF header constant equals CSRF_HEADER of the sdk', () => {
    const sdk = readFileSync(SDK_VARIABLES, 'utf8');
    const match = sdk.match(/export const CSRF_HEADER\s*=\s*['"]([^'"]+)['"]/);
    expect(match).not.toBeNull();
    expect(CSRF_HEADER_NAME).toBe(match[1]);
  });
});

describe('createState', () => {
  test('satisfies the store contract: get, subscribe runs once synchronously', () => {
    const s = createState({ n: 1 });
    const seen = [];
    const off = s.subscribe((v) => seen.push(v));
    expect(seen).toEqual([{ n: 1 }]);
    expect(s.get()).toEqual({ n: 1 });
    off();
  });

  test('set notifies synchronously and only when !Object.is', () => {
    const s = createState(1);
    const seen = [];
    s.subscribe((v) => seen.push(v));
    s.set(1);
    expect(seen).toEqual([1]);
    s.set(2);
    expect(seen).toEqual([1, 2]);
    s.set(2);
    expect(seen).toEqual([1, 2]);
    s.update((v) => v + 1);
    expect(seen).toEqual([1, 2, 3]);
    const o = {};
    s.set(o);
    s.set(o);
    expect(seen.length).toBe(4);
    s.set(NaN);
    s.set(NaN);
    expect(seen.length).toBe(5);
  });

  test('unsubscribe stops notifications and is idempotent', () => {
    const s = createState(0);
    const seen = [];
    const off = s.subscribe((v) => seen.push(v));
    off();
    off();
    s.set(1);
    expect(seen).toEqual([0]);
  });

  test('a set made inside a subscriber is delivered in order', () => {
    const s = createState(0);
    const a = [];
    const b = [];
    s.subscribe((v) => {
      a.push(v);
      if (v === 1) s.set(2);
    });
    s.subscribe((v) => b.push(v));
    s.set(1);
    expect(a).toEqual([0, 1, 2]);
    expect(b).toEqual([0, 1, 2]);
  });

  test('works with the Svelte store contract shape', () => {
    const s = createState('x');
    expect(typeof s.subscribe).toBe('function');
    expect(typeof s.subscribe(() => {})).toBe('function');
  });
});

describe('derive', () => {
  test('one source', () => {
    const a = createState(2);
    const d = derive(a, (v) => v * 2);
    expect(d.get()).toBe(4);
    const seen = [];
    const off = d.subscribe((v) => seen.push(v));
    a.set(3);
    expect(seen).toEqual([4, 6]);
    expect(d.get()).toBe(6);
    off();
  });

  test('several sources and no recompute when inputs are unchanged', () => {
    const a = createState(1);
    const b = createState(10);
    let runs = 0;
    const d = derive([a, b], ([x, y]) => {
      runs++;
      return { sum: x + y };
    });
    const first = d.get();
    expect(first).toEqual({ sum: 11 });
    expect(d.get()).toBe(first);
    expect(runs).toBe(1);
    const seen = [];
    const off = d.subscribe((v) => seen.push(v.sum));
    b.set(20);
    a.set(2);
    expect(seen).toEqual([11, 21, 22]);
    off();
  });

  test('connects to its sources on the first subscriber and lets go after the last', () => {
    let subscribed = 0;
    let unsubscribed = 0;
    const src = {
      get: () => 1,
      subscribe(run) {
        subscribed++;
        run(1);
        return () => {
          unsubscribed++;
        };
      },
    };
    const d = derive(src, (v) => v);
    const o1 = d.subscribe(() => {});
    const o2 = d.subscribe(() => {});
    expect(subscribed).toBe(1);
    o1();
    expect(unsubscribed).toBe(0);
    o2();
    expect(unsubscribed).toBe(1);
  });
});

describe('defineController', () => {
  test('validates the spec', () => {
    expect(() => defineController({ name: 'Cart', version: 1 })).toThrow();
    expect(() => defineController({ name: 'cart', version: 0 })).toThrow();
    expect(() => defineController({ name: 'cart', version: 1.5 })).toThrow();
    expect(() => defineController({ name: 'cart', version: 1, scope: 'page' })).toThrow();
    expect(() => defineController({ name: 'cart', version: 1, state: 3 })).toThrow();
  });

  test('definition carries name, version, scope default, eager and load', () => {
    const load = async () => ({ ok: 1 });
    const def = defineController({ name: 'cart', version: 2, load });
    expect(def.name).toBe('cart');
    expect(def.version).toBe(2);
    expect(def.scope).toBe('app');
    expect(def.eager).toBe(false);
    expect(def.load).toBe(load);
    expect(defineController({ name: 'x', version: 1, scope: 'instance', eager: true }).scope).toBe('instance');
  });

  test('create: state, params, initial patch, name with namespace, no actions by default', () => {
    const def = defineController({
      name: 'cart',
      version: 1,
      state: ({ params }) => ({ count: params.start ?? 0, items: [] }),
    });
    const c = def.create(nullHost, { start: 3 }, { items: ['a'] }, { namespace: 'market' });
    expect(c.name).toBe('market/cart');
    expect(c.version).toBe(1);
    expect(c.get()).toEqual({ count: 3, items: ['a'] });
    expect(c.actions).toEqual({});
    expect(def.create(nullHost).name).toBe('cart');
    expect(def.create(nullHost).get()).toEqual({ count: 0, items: [] });
  });

  test('state accepts params {} and a spec without state starts with {}', () => {
    expect(defineController({ name: 'format', version: 1 }).create(nullHost).get()).toEqual({});
  });

  test('actions mutate state through ctx; the snapshot is replaced, never mutated', () => {
    const def = defineController({
      name: 'cart',
      version: 1,
      state: () => ({ count: 0 }),
      actions: (c) => ({
        add: () => {
          c.update((s) => ({ ...s, count: s.count + 1 }));
          return { ok: true };
        },
      }),
    });
    const c = def.create(nullHost);
    const before = c.get();
    const seen = [];
    c.subscribe((s) => seen.push(s.count));
    expect(c.actions.add()).toEqual({ ok: true });
    expect(before.count).toBe(0);
    expect(c.get()).not.toBe(before);
    expect(seen).toEqual([0, 1]);
  });

  test('ctx exposes host and params; set with an equal value does not notify', () => {
    const marker = { ...nullHost, marker: true };
    let got;
    const def = defineController({
      name: 'a',
      version: 1,
      state: () => ({ v: 1 }),
      actions: (c) => {
        got = c;
        return {};
      },
    });
    const c = def.create(marker, { p: 1 });
    expect(got.host).toBe(marker);
    expect(got.params).toEqual({ p: 1 });
    const seen = [];
    c.subscribe((s) => seen.push(s));
    got.set(got.get());
    expect(seen.length).toBe(1);
  });

  test('start runs on the first subscriber and its cleanup after the last leaves', () => {
    const log = [];
    const def = defineController({
      name: 'a',
      version: 1,
      start: () => {
        log.push('start');
        return () => log.push('stop');
      },
    });
    const c = def.create(browserHost);
    expect(log).toEqual([]);
    const o1 = c.subscribe(() => {});
    const o2 = c.subscribe(() => {});
    expect(log).toEqual(['start']);
    o1();
    o1();
    expect(log).toEqual(['start']);
    o2();
    expect(log).toEqual(['start', 'stop']);
    const o3 = c.subscribe(() => {});
    expect(log).toEqual(['start', 'stop', 'start']);
    o3();
    expect(log).toEqual(['start', 'stop', 'start', 'stop']);
  });

  test('start gets actions and does not run on the server', () => {
    let seenActions = null;
    const def = defineController({
      name: 'a',
      version: 1,
      actions: () => ({ ping: () => 1 }),
      start: ({ actions }) => {
        seenActions = actions;
      },
    });
    def.create(nullHost).subscribe(() => {})();
    expect(seenActions).toBeNull();
    def.create(browserHost).subscribe(() => {})();
    expect(typeof seenActions.ping).toBe('function');
  });

  test('what start sets synchronously is in the first value delivered to the subscriber', () => {
    const def = defineController({
      name: 'a',
      version: 1,
      state: () => ({ ready: false }),
      start: ({ update }) => update(() => ({ ready: true })),
    });
    const seen = [];
    def.create(browserHost).subscribe((s) => seen.push(s.ready));
    expect(seen).toEqual([true]);
  });

  test('eager: started at creation in the browser, not by subscribers, cleanup on destroy', () => {
    const log = [];
    const def = defineController({
      name: 'a',
      version: 1,
      eager: true,
      start: () => {
        log.push('start');
        return () => log.push('stop');
      },
    });
    expect(log).toEqual([]);
    const server = def.create(nullHost);
    expect(log).toEqual([]);
    server.destroy();
    const c = def.create(browserHost);
    expect(log).toEqual(['start']);
    const off = c.subscribe(() => {});
    off();
    expect(log).toEqual(['start']);
    c.destroy();
    expect(log).toEqual(['start', 'stop']);
    c.destroy();
    expect(log).toEqual(['start', 'stop']);
  });

  test('destroy stops a running non-eager controller and drops its subscribers', () => {
    const log = [];
    const def = defineController({
      name: 'a',
      version: 1,
      state: () => ({ n: 0 }),
      actions: (c) => ({ inc: () => c.update((s) => ({ n: s.n + 1 })) }),
      start: () => () => log.push('stop'),
    });
    const c = def.create(browserHost);
    const seen = [];
    c.subscribe((s) => seen.push(s.n));
    c.destroy();
    expect(log).toEqual(['stop']);
    c.actions.inc();
    expect(seen).toEqual([0]);
    c.subscribe(() => {})();
    expect(log).toEqual(['stop']);
  });

  test('ctx.use resolves siblings through the registry callback', () => {
    const format = defineController({
      name: 'format',
      version: 1,
      actions: () => ({ money: (n) => `$${n}` }),
    }).create(nullHost, {}, undefined, { namespace: 'market' });
    const asked = [];
    const cart = defineController({
      name: 'cart',
      version: 1,
      actions: (c) => ({ label: (n) => c.use('format').actions.money(n) }),
    }).create(nullHost, {}, undefined, {
      namespace: 'market',
      use: (name) => {
        asked.push(name);
        return format;
      },
    });
    expect(cart.actions.label(5)).toBe('$5');
    expect(asked).toEqual(['format']);
  });

  test('ctx.use without a registry throws a clear error', () => {
    const def = defineController({
      name: 'cart',
      version: 1,
      actions: (c) => ({ x: () => c.use('format') }),
    });
    expect(() => def.create(nullHost).actions.x()).toThrow(/outside a registry/);
  });
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createFetchHost', () => {
  test('a plugin path goes to /api/plugins (unversioned), a core path under /api/v1', async () => {
    const f = fakeFetch(() => jsonResponse({}));
    const host = createFetchHost({ baseUrl: 'https://example.com', fetch: f });
    await host.request({ path: '/api/plugins/pano-plugin-market/store/products' });
    await host.request({ path: '/plugins/pano-plugin-market/panel/products' });
    await host.request({ path: '/plugins/pano-plugin-market/_/translations/en' });
    await host.request({ path: '/posts' });
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://example.com/api/plugins/pano-plugin-market/store/products',
      'https://example.com/api/plugins/pano-plugin-market/panel/products',
      'https://example.com/api/v1/plugins/pano-plugin-market/_/translations/en',
      'https://example.com/api/v1/posts',
    ]);
  });

  test('request builds the URL under /api/v1 with query and returns the body', async () => {
    const f = fakeFetch(() => jsonResponse({ items: [1], page: { total: 1 } }));
    const host = createFetchHost({ baseUrl: 'https://example.com/', fetch: f });
    const body = await host.request({ path: '/store/products', query: { q: 'a b', tag: ['x', 'y'], skip: undefined, n: 0 } });
    expect(body).toEqual({ items: [1], page: { total: 1 } });
    expect(f.calls[0].url).toBe('https://example.com/api/v1/store/products?q=a+b&tag=x&tag=y&n=0');
    expect(f.calls[0].init.method).toBe('GET');
    expect(f.calls[0].init.credentials).toBe('include');
    expect(f.calls[0].init.body).toBeUndefined();
  });

  test('a proxy prefix works as baseUrl', async () => {
    const f = fakeFetch(() => jsonResponse({}));
    await createFetchHost({ baseUrl: '/pano', fetch: f }).request({ path: '/posts' });
    expect(f.calls[0].url).toBe('/pano/api/v1/posts');
  });

  test('mutations send JSON, and the CSRF header when a token exists', async () => {
    const f = fakeFetch(() => jsonResponse({ ok: 1 }));
    const host = createFetchHost({ baseUrl: '', fetch: f, getCsrf: () => 'tok' });
    await host.request({ method: 'post', path: '/cart', body: { a: 1 } });
    const init = f.calls[0].init;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers[CSRF_HEADER_NAME]).toBe('tok');
    await host.request({ path: '/cart' });
    expect(f.calls[1].init.headers[CSRF_HEADER_NAME]).toBeUndefined();
  });

  test('getToken sends a bearer header and no cookies', async () => {
    const f = fakeFetch(() => jsonResponse({}));
    const host = createFetchHost({ baseUrl: '', fetch: f, getToken: () => 'jwt' });
    await host.request({ path: '/me' });
    expect(f.calls[0].init.headers.Authorization).toBe('Bearer jwt');
    expect(f.calls[0].init.credentials).toBeUndefined();
  });

  test('FormData bodies pass through and custom headers win', async () => {
    const f = fakeFetch(() => jsonResponse({}));
    const host = createFetchHost({ baseUrl: '', fetch: f });
    const form = new FormData();
    form.append('a', 'b');
    await host.request({ method: 'POST', path: '/up', body: form, headers: { 'X-Extra': '1' } });
    expect(f.calls[0].init.body).toBe(form);
    expect(f.calls[0].init.headers['Content-Type']).toBeUndefined();
    expect(f.calls[0].init.headers['X-Extra']).toBe('1');
  });

  test('non-2xx returns the envelope unchanged', async () => {
    const envelope = { error: { code: 'INVALID_CART', details: { lineErrors: { a: ['OUT_OF_STOCK'] } } } };
    const host = createFetchHost({ baseUrl: '', fetch: fakeFetch(() => jsonResponse(envelope, 400)) });
    expect(await host.request({ path: '/x' })).toEqual(envelope);
  });

  test('non-2xx without an envelope still resolves a code', async () => {
    const host = createFetchHost({ baseUrl: '', fetch: fakeFetch(() => new Response('<html>bad gateway</html>', { status: 502 })) });
    expect(await host.request({ path: '/x' })).toEqual({ error: { code: 'UNKNOWN_ERROR', details: { status: 502 } } });
  });

  test('network failure resolves NETWORK_ERROR and never rejects', async () => {
    const host = createFetchHost({
      baseUrl: '',
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await host.request({ path: '/x' })).toEqual({ error: { code: 'NETWORK_ERROR' } });
    const broken = createFetchHost({
      baseUrl: '',
      fetch: async () => ({ ok: true, status: 200, text: async () => { throw new Error('reset'); } }),
    });
    expect(await broken.request({ path: '/x' })).toEqual({ error: { code: 'NETWORK_ERROR' } });
    expect(await createFetchHost({ baseUrl: '', getToken: () => { throw new Error('x'); }, fetch: async () => jsonResponse({}) }).request({ path: '/x' })).toEqual({ error: { code: 'NETWORK_ERROR' } });
  });

  test('empty 2xx body is {} and an unparsable 2xx body is INVALID_RESPONSE', async () => {
    expect(await createFetchHost({ baseUrl: '', fetch: fakeFetch(() => new Response(null, { status: 204 })) }).request({ method: 'DELETE', path: '/x' })).toEqual({});
    expect(await createFetchHost({ baseUrl: '', fetch: fakeFetch(() => new Response('nope', { status: 200 })) }).request({ path: '/x' })).toEqual({ error: { code: 'INVALID_RESPONSE' } });
  });

  test('blob: ok returns the Blob, failure returns the envelope', async () => {
    const ok = createFetchHost({ baseUrl: '', fetch: fakeFetch(() => new Response('PDF', { status: 200 })) });
    const blob = await ok.request({ path: '/invoice', blob: true });
    expect(blob instanceof Blob).toBe(true);
    expect(await blob.text()).toBe('PDF');
    const bad = createFetchHost({ baseUrl: '', fetch: fakeFetch(() => jsonResponse({ error: { code: 'NOT_FOUND' } }, 404)) });
    expect(await bad.request({ path: '/invoice', blob: true })).toEqual({ error: { code: 'NOT_FOUND' } });
  });

  test('session, locale, t, toast, feature, urls, storage, now, navigate', () => {
    const toasts = [];
    const nav = [];
    const store = { getItem: () => null };
    const host = createFetchHost({
      baseUrl: 'https://x.test',
      browser: true,
      getCsrf: () => 'c',
      getSession: () => ({ user: { id: 1 } }),
      locale: () => 'tr',
      messages: { 'plugins.pano-plugin-market.hello': 'Merhaba {name}' },
      features: ['login-return-url'],
      onToast: (key, o) => toasts.push([key, o]),
      onNavigate: (url, o) => nav.push([url, o]),
      storage: { local: store },
      now: () => 42,
    });
    expect(host.baseUrl).toBe('https://x.test');
    expect(host.browser).toBe(true);
    expect(host.session()).toEqual({ user: { id: 1 }, csrfToken: 'c' });
    expect(host.locale()).toBe('tr');
    expect(host.t('plugins.pano-plugin-market.hello', { name: 'Ali' })).toBe('Merhaba Ali');
    expect(host.t('missing.key')).toBe('missing.key');
    host.toast('plugins.pano-plugin-market.hello', { variant: 'success', values: { name: 'Veli' } });
    expect(toasts[0][0]).toBe('plugins.pano-plugin-market.hello');
    expect(toasts[0][1]).toMatchObject({ variant: 'success', message: 'Merhaba Veli' });
    expect(host.feature('login-return-url')).toBe(true);
    expect(host.feature('other')).toBe(false);
    expect(host.loginUrl()).toBe('/login');
    expect(host.loginUrl('/store/checkout?a=1')).toBe('/login?redirect=%2Fstore%2Fcheckout%3Fa%3D1');
    expect(host.registerUrl('/x')).toBe('/register?redirect=%2Fx');
    expect(host.storage('local')).toBe(store);
    expect(host.storage('session')).toBeNull();
    expect(host.now()).toBe(42);
    host.navigate('/a', { replace: true });
    expect(nav).toEqual([['/a', { replace: true }]]);
    expect(typeof host.onSession(() => {})).toBe('function');
  });

  test('defaults are safe on the server: guest, no storage, no toast target', () => {
    const host = createFetchHost({ baseUrl: '', browser: false });
    expect(host.session()).toEqual({ user: null, csrfToken: null });
    expect(host.storage('local')).toBeNull();
    expect(host.locale()).toBeUndefined();
    expect(() => host.toast('k')).not.toThrow();
    expect(() => host.navigate('/x')).not.toThrow();
    expect(host.feature('x')).toBe(false);
  });

  test('a host drives a controller end to end', async () => {
    const f = fakeFetch(() => jsonResponse({ items: [{ id: 'a' }, { id: 'b' }] }));
    const def = defineController({
      name: 'products',
      version: 1,
      state: () => ({ items: [], error: null }),
      actions: (c) => ({
        async load() {
          const body = await c.host.request({ path: '/products' });
          if (body.error) return { ok: false, code: body.error.code };
          c.update((s) => ({ ...s, items: body.items }));
          return { ok: true };
        },
      }),
    });
    const c = def.create(createFetchHost({ baseUrl: 'https://x.test', fetch: f }));
    expect(await c.actions.load()).toEqual({ ok: true });
    expect(c.get().items.length).toBe(2);
  });
});

describe('nullHost', () => {
  test('guest session and request resolves NULL_HOST', async () => {
    expect(nullHost.session()).toEqual({ user: null, csrfToken: null });
    expect(nullHost.browser).toBe(false);
    expect(await nullHost.request({ path: '/x' })).toEqual({ error: { code: 'NULL_HOST' } });
  });

  test('the rest are safe no-ops', () => {
    expect(nullHost.locale()).toBeUndefined();
    expect(nullHost.t('a.b')).toBe('a.b');
    expect(nullHost.storage('local')).toBeNull();
    expect(nullHost.feature('x')).toBe(false);
    expect(nullHost.loginUrl('/x')).toBe('/login');
    expect(nullHost.registerUrl()).toBe('/register');
    expect(typeof nullHost.now()).toBe('number');
    expect(() => nullHost.toast('k')).not.toThrow();
    expect(() => nullHost.navigate('/x')).not.toThrow();
    expect(nullHost.onSession(() => {})()).toBeUndefined();
    expect(Object.isFrozen(nullHost)).toBe(true);
  });

  test('a controller can be created on it for key enumeration', () => {
    const def = defineController({
      name: 'cart',
      version: 1,
      state: () => ({ count: 0, items: [] }),
      actions: () => ({ add() {}, clear() {} }),
    });
    const c = def.create(nullHost, {});
    expect(Object.keys(c.get())).toEqual(['count', 'items']);
    expect(Object.keys(c.actions)).toEqual(['add', 'clear']);
  });
});

describe('createSampleController', () => {
  const def = defineController({
    name: 'cart',
    version: 3,
    state: () => ({ count: 0, items: [] }),
    actions: (c) => ({
      add: (id) => c.update((s) => ({ ...s, count: s.count + 1 })),
      clear: () => c.set({ count: 0, items: [] }),
    }),
    start: () => {
      throw new Error('must not run');
    },
  });

  test('fixed state is the initial state with the patch merged over it', () => {
    const c = createSampleController(def, { count: 2 });
    expect(c.get()).toEqual({ count: 2, items: [] });
    const seen = [];
    c.subscribe((s) => seen.push(s.count))();
    expect(seen).toEqual([2]);
    expect(c.name).toBe('cart');
    expect(c.version).toBe(3);
    expect(createSampleController(def, {}, { namespace: 'market' }).name).toBe('market/cart');
  });

  test('actions record { name, args } and leave the state alone', async () => {
    const calls = [];
    const c = createSampleController(def, { count: 2 }, { onCall: (call) => calls.push(call) });
    expect(Object.keys(c.actions)).toEqual(['add', 'clear']);
    expect(await c.actions.add('p1', 3)).toEqual({ ok: true });
    await c.actions.clear();
    expect(c.calls).toEqual([
      { name: 'add', args: ['p1', 3] },
      { name: 'clear', args: [] },
    ]);
    expect(calls).toEqual(c.calls);
    expect(c.get()).toEqual({ count: 2, items: [] });
  });

  test('does not touch the app: a second sample is independent, a failing factory yields no actions', () => {
    const a = createSampleController(def, { count: 1 });
    const b = createSampleController(def, { count: 5 });
    expect(a.get().count).toBe(1);
    expect(b.get().count).toBe(5);
    const broken = defineController({
      name: 'broken',
      version: 1,
      actions: () => {
        throw new Error('boom');
      },
    });
    expect(createSampleController(broken).actions).toEqual({});
  });
});

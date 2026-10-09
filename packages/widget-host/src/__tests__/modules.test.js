// W1: the host modules that talk to the page: api, svelte, toasts, language, session, the controller host.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { installBrowserEnv, settle, uninstallBrowserEnv } from './env.js';

let m = {};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** @param {(url:string, init:any) => Response|Promise<Response>} handler */
function serve(handler) {
  const calls = [];
  m.config.configure({
    apiBase: 'https://pano.test',
    siteUrl: 'https://site.test',
    urls: { 'market.order': '/shop/o/{id}', 'auth.login': '/login' },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    },
  });
  return calls;
}

beforeAll(async () => {
  await installBrowserEnv();
  m.config = await import('../config.js');
  m.api = await import('../api.js');
  m.svelte = await import('../svelte.js');
  m.toasts = await import('../toasts.js');
  m.language = await import('../language.js');
  m.session = await import('../session.js');
  m.controllers = await import('../controllers.js');
  m.runtime = await import('../runtime.js');
});

afterAll(() => uninstallBrowserEnv());

beforeEach(() => {
  m.session.resetSession();
  m.language.resetLanguage();
});

afterEach(() => {
  document.body.replaceChildren();
  m.config.resetConfig();
});

describe('config', () => {
  test('csrf is off for a relative apiBase only', () => {
    expect(m.config.configure({ apiBase: 'https://pano.test' }).csrf).toBe('auto');
    expect(m.config.configure({ apiBase: '/pano' }).csrf).toBe('off');
    expect(m.config.configure({ apiBase: '' }).csrf).toBe('auto');
  });

  test('resolveUrl fills the URL map and prefixes the site', () => {
    serve(() => json(200, {}));
    expect(m.config.resolveUrl('market.order', { id: 7 })).toBe('https://site.test/shop/o/7');
    expect(m.config.resolveUrl('/shop')).toBe('https://site.test/shop');
    expect(m.config.resolveUrl('https://elsewhere.test/x')).toBe('https://elsewhere.test/x');
  });
});

describe('ApiUtil', () => {
  test('success: the parsed body; paths relative to /api/v1', async () => {
    const calls = serve(() => json(200, { items: [1], page: { current: 1 } }));
    const body = await m.api.ApiUtil.get({ path: '/posts?page=1' });
    expect(body).toEqual({ items: [1], page: { current: 1 } });
    expect(calls[0].url).toBe('https://pano.test/api/v1/posts?page=1');
    expect(calls[0].init.credentials).toBe('include');
  });

  test('a path with the prefix means the same', async () => {
    const calls = serve(() => json(200, {}));
    await m.api.ApiUtil.get({ path: '/api/v1/posts' });
    await m.api.ApiUtil.get({ path: '/api/posts' });
    expect(calls.map((c) => c.url)).toEqual(['https://pano.test/api/v1/posts', 'https://pano.test/api/v1/posts']);
  });

  test('the envelope of a failed answer comes back unchanged; no body is {}', async () => {
    serve((url) => (url.endsWith('/nothing') ? new Response(null, { status: 204 }) : json(404, { error: { code: 'NOT_FOUND', message: 'no' } })));
    expect(await m.api.ApiUtil.get({ path: '/x' })).toEqual({ error: { code: 'NOT_FOUND', message: 'no' } });
    expect(await m.api.ApiUtil.delete({ path: '/nothing' })).toEqual({});
  });

  test('network failure: { error: { code: NETWORK_ERROR } }', async () => {
    m.config.configure({ apiBase: 'https://pano.test', fetch: async () => { throw new TypeError('offline'); } });
    expect(await m.api.ApiUtil.get({ path: '/x' })).toEqual({ error: { code: 'NETWORK_ERROR' } });
    expect(m.api.networkErrorBody).toEqual({ error: { code: m.api.NETWORK_ERROR } });
  });

  test('post sends JSON and a token, a handler maps the body', async () => {
    const calls = serve(() => json(200, { id: 3 }));
    const out = await m.api.ApiUtil.post({ path: '/things', body: { a: 1 }, token: 'jwt', handler: (b) => b.id });
    expect(out).toBe(3);
    expect(calls[calls.length - 1].init.method).toBe('POST');
    expect(calls[calls.length - 1].init.body).toBe('{"a":1}');
    expect(calls[calls.length - 1].init.headers.Authorization).toBe('Bearer jwt');
  });

  test('buildQueryParams drops empty values', () => {
    expect(m.api.buildQueryParams({ a: 1, b: '', c: 'x y' })).toBe('?a=1&c=x%20y');
    expect(m.api.buildQueryParams({})).toBe('');
  });
});

describe('svelte module', () => {
  test('goto raises a cancelable pano:navigate; cancelled does not navigate', async () => {
    serve(() => json(200, {}));
    const navigated = [];
    m.config.configure({ navigate: (url) => navigated.push(url) });

    const seen = [];
    const listener = (e) => {
      seen.push(e.detail.url);
      if (e.detail.url.includes('blocked')) e.preventDefault();
    };
    document.addEventListener('pano:navigate', listener);

    await m.svelte.goto('/shop');
    await m.svelte.goto('/blocked');
    await m.svelte.goto('market.order');

    expect(seen).toEqual(['https://site.test/shop', 'https://site.test/blocked', 'https://site.test/shop/o/{id}']);
    expect(navigated).toEqual(['https://site.test/shop', 'https://site.test/shop/o/{id}']);
    document.removeEventListener('pano:navigate', listener);
  });

  test('error() throws a WidgetError, base follows configure, page and navigating are readable', async () => {
    serve(() => json(200, {}));
    expect(() => m.svelte.error(404, 'missing')).toThrow('missing');
    try {
      m.svelte.error(418, 'tea');
    } catch (e) {
      expect(e.status).toBe(418);
      expect(e.code).toBe('HTTP_418');
    }
    expect(m.svelte.browser).toBe(true);
    expect(m.svelte.base).toBe('https://site.test');

    const { get } = await import('svelte/store');
    expect(get(m.svelte.page).url.href).toBe('https://site.test/page');
    expect(get(m.svelte.page).params).toEqual({});
    expect(get(m.svelte.navigating)).toBeNull();
  });
});

describe('toasts', () => {
  test('pano:toast is cancelable; uncancelled it shows in one shared <pano-toasts>', async () => {
    serve(() => json(200, {}));
    const events = [];
    const listener = (e) => events.push(e.detail);
    document.addEventListener('pano:toast', listener);

    await m.toasts.showToast('Saved', {}, undefined, { variant: 'success' });
    await m.toasts.showToast('Again');

    expect(events.map((d) => d.variant)).toEqual(['success', null]);
    expect(document.querySelectorAll('pano-toasts')).toHaveLength(1);
    const items = document.querySelector('pano-toasts').shadowRoot.querySelectorAll('.toast');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('Saved');

    const cancel = (e) => e.preventDefault();
    document.addEventListener('pano:toast', cancel);
    await m.toasts.showToast('Hidden');
    expect(document.querySelector('pano-toasts').shadowRoot.querySelectorAll('.toast')).toHaveLength(2);

    document.removeEventListener('pano:toast', cancel);
    document.removeEventListener('pano:toast', listener);
  });

  test('limitTitle', () => {
    expect(m.toasts.limitTitle('x'.repeat(40))).toBe(`${'x'.repeat(32)}...`);
    expect(m.toasts.limitTitle('short')).toBe('short');
  });
});

describe('language', () => {
  test('text from the core THEME endpoint and the plugin endpoint, each fetched once', async () => {
    const calls = serve((url) => {
      if (url.endsWith('/api/v1/locales')) return json(200, { items: [{ code: 'en-US' }, { code: 'tr-TR' }] });
      if (url.endsWith('/locales/tr-TR/translations/types/THEME')) return json(200, { components: { 'no-content': { text: 'Icerik yok' } } });
      if (url.endsWith('/locales/en-US/translations/types/THEME')) return json(200, { components: { 'no-content': { text: 'No content' } } });
      if (url.endsWith('/plugins/pano-plugin-market/_/translations/tr-TR')) return json(200, { locale: 'tr-TR', translations: { goal: { title: 'Hedef' } } });
      return json(404, { error: { code: 'NOT_FOUND' } });
    });
    m.config.configure({ locale: 'tr-TR' });

    await m.language.ensureLanguage();
    await m.language.ensureLanguage();
    await m.language.loadPluginTranslations('pano-plugin-market', 'tr-TR');
    await m.language.loadPluginTranslations('pano-plugin-market', 'tr-TR');

    const { get } = await import('svelte/store');
    expect(get(m.language.currentLanguage).code).toBe('tr-TR');
    expect(get(m.language._)('components.no-content.text')).toBe('Icerik yok');
    expect(get(m.language._)('plugins.pano-plugin-market.goal.title')).toBe('Hedef');

    expect(calls.filter((c) => c.url.endsWith('/locales/tr-TR/translations/types/THEME'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/_/translations/'))).toHaveLength(1);
  });

  test('init works when the API is down: the key is shown', async () => {
    serve(() => json(500, { error: { code: 'INTERNAL' } }));
    await m.language.ensureLanguage();
    expect(m.language.translate('missing.key', 'Fallback')).toBe('Fallback');
  });
});

describe('session probe', () => {
  test('logged in: the user and token; anonymous and failure: a guest, never an error; once per page', async () => {
    const calls = serve(() => json(200, { username: 'steve', panelAccess: false, csrfToken: 'tok' }));
    const changes = [];
    m.session.onSession((s) => changes.push(s.user?.username ?? null));

    await m.session.ensureSession();
    await m.session.ensureSession();
    expect(calls.filter((c) => c.url.endsWith('/auth/credentials'))).toHaveLength(1);
    expect(m.session.getSession()).toEqual({ user: { username: 'steve', panelAccess: false }, csrfToken: 'tok' });
    expect(changes).toEqual(['steve']);

    m.session.resetSession();
    serve(() => json(401, { error: { code: 'NOT_LOGGED_IN' } }));
    expect((await m.session.ensureSession()).user).toBeNull();

    m.session.resetSession();
    m.config.configure({ fetch: async () => { throw new Error('down'); } });
    expect((await m.session.ensureSession()).user).toBeNull();
  });
});

describe('controller host', () => {
  test('request goes to the page client in the body shape; session, locale, toast, navigate, storage, urls', async () => {
    const calls = serve((url) => json(200, { ok: url }));
    m.config.configure({ locale: 'tr-TR', navigate: (u) => calls.push({ navigated: u }) });
    const host = m.controllers.createWidgetHost();

    expect(host.baseUrl).toBe('https://pano.test');
    expect(await host.request({ method: 'GET', path: '/widgets', query: { a: 1 } })).toEqual({ ok: 'https://pano.test/api/v1/widgets?a=1' });
    expect(host.session()).toEqual({ user: null, csrfToken: null });
    expect(host.locale()).toBe('tr-TR');
    expect(host.feature('x')).toBe(false);
    expect(host.loginUrl('/cart')).toBe('https://site.test/login?redirect=%2Fcart');
    expect(host.registerUrl()).toBe('https://site.test/register');
    expect(host.storage('local')).not.toBeNull();

    host.navigate('/shop');
    await settle(5);
    expect(calls.some((c) => c.navigated === 'https://site.test/shop')).toBe(true);
  });
});

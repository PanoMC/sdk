import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readable, writable } from 'svelte/store';

// TC-61 (doc 05 sections 3.1, 4, 6, slice 10): what an engine front-end sends to Pano.
//  - handleFetch of the engine hooks: key and client-IP headers, no Origin, no visitor-visit special case
//  - ApiUtil: X-CSRF-Token from the page session, GET /auth/csrf once when the session has none
//  - siteRealtime: POST /auth/ws-ticket, then the socket opens with ?ticket=

const BACKEND = 'http://127.0.0.1:8088/api';
const state = { apiUrl: BACKEND, browser: false };
const pageStore = writable({ data: {} });

function mockHost() {
  mock.module('$lib/variables.js', () => ({
    get API_URL() {
      return state.apiUrl;
    },
    CSRF_HEADER: 'X-CSRF-Token',
  }));
  mock.module('$app/environment', () => ({
    dev: false,
    get browser() {
      return state.browser;
    },
  }));
  mock.module('$app/stores', () => ({ page: pageStore }));
  mock.module('$app/paths', () => ({ base: '' }));
  mock.module('$lib/Store.js', () => ({ initialized: writable(true) }));
  mock.module('$lib/components/ToastContainer.svelte', () => ({ show: async () => {} }));
}

mockHost();

// Bun snapshots a mock factory's values, so a change is applied by registering the mock again.
function setHost(next) {
  Object.assign(state, next);
  mockHost();
}

const apiMod = await import('../api.util.js');
const { default: ApiUtil, resetFetchedCsrfToken } = apiMod;

// hooks-server.js and siteRealtime.js reach ApiUtil through the engine's own specifier.
mock.module('$pano/lib/api.util', () => apiMod);
mock.module('$pano/lib/api.util.js', () => apiMod);

const { createThemeHooks } = await import('../../../../theme-core/src/kit/hooks-server.js');
const { updateApiUrl } = await import('../../../../theme-core/src/lib/variables.js');
const realtime = await import('../../../../theme-core/src/lib/siteRealtime.js');

updateApiUrl(BACKEND);

const { handleFetch } = createThemeHooks({ internalLibsHash: 'test', runtimeShimsHash: 'test' });

const realFetch = globalThis.fetch;
const realLog = console.log;
const realKey = process.env.PANO_FRONTEND_KEY;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  setHost({ apiUrl: BACKEND, browser: false });
  pageStore.set({ data: {} });
  resetFetchedCsrfToken();
  delete process.env.PANO_FRONTEND_KEY;
  console.log = () => {};
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

afterAll(() => {
  if (realKey === undefined) delete process.env.PANO_FRONTEND_KEY;
  else process.env.PANO_FRONTEND_KEY = realKey;
});

// ---------------------------------------------------------------------------
// A stub Pano and a stand-in for SvelteKit's event.fetch
// ---------------------------------------------------------------------------

/**
 * The parts of Pano these tests lean on: the key and IP headers it records, the CSRF rule of doc 05 section 4
 * (a cookie session without the header is refused on a mutation), `/auth/csrf` and `/auth/ws-ticket`.
 */
function stubPano({ session = 'sess-1', csrfToken = 'csrf-1' } = {}) {
  const seen = [];

  const handler = async (request) => {
    const url = new URL(request.url);
    const cookie = request.headers.get('cookie') ?? '';
    const loggedIn = cookie.includes(`pano_auth_token=${session}`);
    const entry = {
      method: request.method,
      path: url.pathname,
      key: request.headers.get('X-Pano-Frontend-Key'),
      ip: request.headers.get('X-Pano-Client-Ip'),
      origin: request.headers.get('Origin'),
      forwardedFor: request.headers.get('X-Forwarded-For'),
      csrf: request.headers.get('X-CSRF-Token'),
      cookie,
    };
    seen.push(entry);

    if (url.pathname === '/api/v1/auth/csrf') {
      return loggedIn ? json({ csrfToken }) : json({ error: { code: 'UNAUTHORIZED' } }, 401);
    }
    if (url.pathname === '/api/v1/auth/login') return json({ csrfToken });
    if (url.pathname === '/api/v1/auth/ws-ticket') {
      if (!loggedIn) return json({ error: { code: 'UNAUTHORIZED' } }, 401);
      return entry.csrf === csrfToken
        ? json({ ticket: 'ticket-1', expiresIn: 30 })
        : json({ error: { code: 'INVALID_CSRF_TOKEN' } }, 403);
    }

    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (unsafe && loggedIn && entry.csrf !== csrfToken) {
      return json({ error: { code: 'INVALID_CSRF_TOKEN' } }, 403);
    }
    return json({ ok: true });
  };

  handler.seen = seen;
  return handler;
}

/** @returns {any} a SvelteKit RequestEvent with the parts handleFetch reads */
function eventFor({ headers = {}, peer = '10.0.0.7' } = {}) {
  return {
    url: new URL('https://site.test/profile'),
    request: new Request('https://site.test/profile', { headers }),
    getClientAddress: () => peer,
  };
}

/** event.fetch: resolves against the page origin, runs handleFetch, ends at the stub. */
function eventFetch(event, backend) {
  return (input, init) => {
    // Backend calls go through the runtime's own fetch, not the hook's (78d89b5): the stub stands behind both.
    globalThis.fetch = (request) => backend(request);

    return handleFetch({
      event,
      request: new Request(new URL(String(input), event.url).href, init),
      fetch: (request) => backend(request),
    });
  };
}

// ---------------------------------------------------------------------------
// handleFetch
// ---------------------------------------------------------------------------

describe('handleFetch: key and client-IP headers', () => {
  test('with a key: both headers, the cookie, and no Origin', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const backend = stubPano();
    const event = eventFor({ headers: { cookie: 'pano_auth_token=sess-1', 'x-forwarded-for': '203.0.113.9' } });

    const response = await eventFetch(event, backend)('/api/v1/posts');
    expect(response.status).toBe(200);

    const [seen] = backend.seen;
    expect(seen.key).toBe('pfk_secret');
    expect(seen.ip).toBe('203.0.113.9');
    expect(seen.origin).toBeNull();
    expect(seen.cookie).toBe('pano_auth_token=sess-1');
    expect(seen.path).toBe('/api/v1/posts');
  });

  test('an absolute backend URL gets the same treatment', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const backend = stubPano();
    const event = eventFor({ headers: { 'x-forwarded-for': '203.0.113.9' } });
    globalThis.fetch = (request) => backend(request);

    await handleFetch({
      event,
      request: new Request(`${BACKEND}/v1/posts`),
      fetch: (request) => backend(request),
    });

    expect(backend.seen[0].key).toBe('pfk_secret');
    expect(backend.seen[0].ip).toBe('203.0.113.9');
    expect(backend.seen[0].origin).toBeNull();
  });

  test('the IP is the X-Forwarded-For value, never cf-connecting-ip', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const backend = stubPano();
    const event = eventFor({ headers: { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '198.51.100.1' } });

    await eventFetch(event, backend)('/api/v1/posts');

    expect(backend.seen[0].ip).toBe('203.0.113.9');
  });

  test('without X-Forwarded-For the socket peer is the visitor', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const backend = stubPano();
    const event = eventFor({ headers: { 'cf-connecting-ip': '198.51.100.1' }, peer: '192.0.2.44' });

    await eventFetch(event, backend)('/api/v1/posts');

    expect(backend.seen[0].ip).toBe('192.0.2.44');
  });

  test('no resolvable address: the key is sent, the IP header is left out, never empty', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const backend = stubPano();
    const event = eventFor();
    event.getClientAddress = () => {
      throw new Error('no address');
    };

    await eventFetch(event, backend)('/api/v1/posts');

    expect(backend.seen[0].key).toBe('pfk_secret');
    expect(backend.seen[0].ip).toBeNull();
  });

  test('without a key neither header is sent, and an empty key counts as unset', async () => {
    const backend = stubPano();
    const event = eventFor({ headers: { 'x-forwarded-for': '203.0.113.9' } });

    await eventFetch(event, backend)('/api/v1/posts');
    process.env.PANO_FRONTEND_KEY = '   ';
    await eventFetch(event, backend)('/api/v1/posts');

    for (const seen of backend.seen) {
      expect(seen.key).toBeNull();
      expect(seen.ip).toBeNull();
      expect(seen.origin).toBeNull();
    }
    expect(backend.seen).toHaveLength(2);
  });

  test('a request to another host carries no key, no IP and no cookie', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const sent = [];
    const event = eventFor({ headers: { cookie: 'pano_auth_token=sess-1', 'x-forwarded-for': '203.0.113.9' } });

    await handleFetch({
      event,
      request: new Request('https://api.example.org/v1/thing'),
      fetch: async (request) => {
        sent.push(request);
        return json({});
      },
    });

    expect(sent[0].headers.get('X-Pano-Frontend-Key')).toBeNull();
    expect(sent[0].headers.get('X-Pano-Client-Ip')).toBeNull();
    expect(sent[0].headers.get('cookie')).toBeNull();
  });

  test('visitor-visit gets no X-Forwarded-For special case', async () => {
    const backend = stubPano();
    const event = eventFor({ headers: { 'x-forwarded-for': '203.0.113.9' } });

    await eventFetch(event, backend)('/api/v1/visitor-visit', { method: 'POST' });

    expect(backend.seen[0].forwardedFor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SSR through ApiUtil
// ---------------------------------------------------------------------------

describe('SSR requests through ApiUtil', () => {
  test('a login made during SSR carries the visitor IP', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const backend = stubPano();
    const event = eventFor({ headers: { 'x-forwarded-for': '203.0.113.9' }, peer: '127.0.0.1' });
    event.fetch = eventFetch(event, backend);

    const result = await ApiUtil.post({
      path: '/auth/login',
      body: { usernameOrEmail: 'steve', password: 'pw' },
      request: event,
    });

    expect(result.csrfToken).toBe('csrf-1');
    const login = backend.seen.find((s) => s.path === '/api/v1/auth/login');
    expect(login.ip).toBe('203.0.113.9');
    expect(login.key).toBe('pfk_secret');
    expect(login.origin).toBeNull();
  });

  test('30 logged-in navigations stay 200 (visitor-visit with and without a session token)', async () => {
    process.env.PANO_FRONTEND_KEY = 'pfk_secret';
    const backend = stubPano();
    const statuses = [];
    const recording = async (request) => {
      const response = await backend(request);
      statuses.push(response.status);
      return response;
    };

    for (let i = 0; i < 30; i++) {
      const event = eventFor({
        headers: { cookie: 'pano_auth_token=sess-1', 'x-forwarded-for': `203.0.113.${i + 1}` },
      });
      event.fetch = eventFetch(event, recording);

      const credentials = await ApiUtil.get({ path: '/auth/credentials', request: event });
      // even rounds pass the cookie's token, odd rounds rely on GET /auth/csrf
      const visit = await ApiUtil.post({
        path: '/visitor-visit',
        request: event,
        csrfToken: i % 2 === 0 ? 'csrf-1' : undefined,
      });

      expect(credentials.error).toBeUndefined();
      expect(visit.error).toBeUndefined();
    }

    expect(statuses.length).toBeGreaterThanOrEqual(60);
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(backend.seen.filter((s) => s.path === '/api/v1/visitor-visit').every((s) => s.csrf === 'csrf-1')).toBe(true);
    // each visit carries its own visitor
    expect(backend.seen.find((s) => s.path === '/api/v1/visitor-visit' && s.ip === '203.0.113.30')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ApiUtil: CSRF header and GET /auth/csrf
// ---------------------------------------------------------------------------

/** A global fetch that records the call and answers by path. */
function browserFetch(answer) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: { ...(init.headers ?? {}) } };
    calls.push(call);
    return answer(call);
  };
  return calls;
}

const isCsrfCall = (call) => call.url.endsWith('/auth/csrf');

describe('ApiUtil CSRF header', () => {
  test('sends the page session token and does not ask /auth/csrf', async () => {
    setHost({ browser: true });
    pageStore.set({ data: { session: { csrfToken: 'from-page' } } });
    const calls = browserFetch(() => json({ ok: true }));

    await ApiUtil.post({ path: '/posts', body: {} });

    expect(calls).toHaveLength(1);
    expect(calls[0].headers['X-CSRF-Token']).toBe('from-page');
  });

  test('a mutation without a session token calls GET /auth/csrf once and then reuses the token', async () => {
    setHost({ browser: true });
    const calls = browserFetch((call) => (isCsrfCall(call) ? json({ csrfToken: 'fetched' }) : json({ ok: true })));

    await ApiUtil.post({ path: '/posts', body: {} });
    await ApiUtil.put({ path: '/posts/1', body: {} });
    await ApiUtil.delete({ path: '/posts/1' });

    const csrfCalls = calls.filter(isCsrfCall);
    expect(csrfCalls).toHaveLength(1);
    expect(csrfCalls[0].url).toBe('/api/v1/auth/csrf');
    expect(csrfCalls[0].method).toBe('GET');

    const mutations = calls.filter((call) => !isCsrfCall(call));
    expect(mutations).toHaveLength(3);
    for (const mutation of mutations) expect(mutation.headers['X-CSRF-Token']).toBe('fetched');
    // the token was in hand before the first mutation was sent
    expect(calls[0].url).toBe('/api/v1/auth/csrf');
  });

  test('concurrent mutations share one /auth/csrf call', async () => {
    setHost({ browser: true });
    const calls = browserFetch((call) => (isCsrfCall(call) ? json({ csrfToken: 'fetched' }) : json({ ok: true })));

    await Promise.all([
      ApiUtil.post({ path: '/a', body: {} }),
      ApiUtil.post({ path: '/b', body: {} }),
      ApiUtil.post({ path: '/c', body: {} }),
    ]);

    expect(calls.filter(isCsrfCall)).toHaveLength(1);
  });

  test('a read never calls /auth/csrf', async () => {
    setHost({ browser: true });
    const calls = browserFetch(() => json({ ok: true }));

    await ApiUtil.get({ path: '/posts' });

    expect(calls.some(isCsrfCall)).toBe(false);
  });

  test('a Bearer call never calls /auth/csrf', async () => {
    setHost({ browser: true });
    const calls = browserFetch(() => json({ ok: true }));

    await ApiUtil.post({ path: '/cart/items', body: {}, token: 'eyJ.site.token' });

    expect(calls.some(isCsrfCall)).toBe(false);
    expect(calls[0].headers['X-CSRF-Token']).toBeUndefined();
    expect(calls[0].headers.Authorization).toBe('Bearer eyJ.site.token');
  });

  test('an anonymous visitor (401) sends no header, the mutation still goes out, and 401 is asked once', async () => {
    setHost({ browser: true });
    const calls = browserFetch((call) =>
      isCsrfCall(call) ? json({ error: { code: 'UNAUTHORIZED' } }, 401) : json({ ok: true }),
    );

    const first = await ApiUtil.post({ path: '/auth/login', body: { usernameOrEmail: 'a', password: 'b' } });
    const second = await ApiUtil.post({ path: '/auth/login', body: { usernameOrEmail: 'a', password: 'b' } });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const logins = calls.filter((call) => !isCsrfCall(call));
    expect(logins).toHaveLength(2);
    for (const login of logins) expect(login.headers['X-CSRF-Token']).toBeUndefined();
    expect(calls.filter(isCsrfCall)).toHaveLength(1);
  });

  test('a token answer of null (Bearer session) means no header', async () => {
    setHost({ browser: true });
    const calls = browserFetch((call) => (isCsrfCall(call) ? json({ csrfToken: null }) : json({ ok: true })));

    await ApiUtil.post({ path: '/posts', body: {} });

    expect(calls.find((call) => !isCsrfCall(call)).headers['X-CSRF-Token']).toBeUndefined();
  });

  test('a refused request drops the cached token so the next mutation asks again', async () => {
    setHost({ browser: true });
    let issued = 0;
    const calls = browserFetch((call) => {
      if (isCsrfCall(call)) return json({ csrfToken: `token-${++issued}` });
      return call.headers['X-CSRF-Token'] === 'token-1' ? json({ error: { code: 'INVALID_CSRF_TOKEN' } }, 403) : json({ ok: true });
    });

    const refused = await ApiUtil.post({ path: '/posts', body: {} });
    const retried = await ApiUtil.post({ path: '/posts', body: {} });

    expect(refused.error.code).toBe('INVALID_CSRF_TOKEN');
    expect(retried.ok).toBe(true);
    expect(calls.filter(isCsrfCall)).toHaveLength(2);
  });

  test('on the server nothing is cached between callers', async () => {
    const seenCookies = [];
    const makeRequest = (cookie, token) => ({
      fetch: async (url, init = {}) => {
        if (String(url).endsWith('/auth/csrf')) return json({ csrfToken: token });
        seenCookies.push({ cookie, csrf: init.headers['X-CSRF-Token'] });
        return json({ ok: true });
      },
    });

    await ApiUtil.post({ path: '/posts', body: {}, request: makeRequest('a', 'token-a') });
    await ApiUtil.post({ path: '/posts', body: {}, request: makeRequest('b', 'token-b') });

    expect(seenCookies).toEqual([
      { cookie: 'a', csrf: 'token-a' },
      { cookie: 'b', csrf: 'token-b' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// siteRealtime: ticket, then socket
// ---------------------------------------------------------------------------

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeSocket.CONNECTING;
    FakeSocket.instances.push(this);
  }

  send() {}

  close() {
    this.readyState = FakeSocket.CLOSED;
  }
}

async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('siteRealtime WebSocket ticket', () => {
  const realWebSocket = globalThis.WebSocket;
  const hadWindow = 'window' in globalThis;
  const realWindow = globalThis.window;

  beforeEach(() => {
    FakeSocket.instances = [];
    globalThis.WebSocket = FakeSocket;
    globalThis.window = { location: { origin: 'https://site.test' } };
    setHost({ browser: true });
    pageStore.set({ data: { session: { csrfToken: 'csrf-1' } } });
  });

  afterEach(() => {
    realtime.setSiteNotificationsSubscription(false);
    globalThis.WebSocket = realWebSocket;
    if (hadWindow) globalThis.window = realWindow;
    else delete globalThis.window;
  });

  test('fetches POST /auth/ws-ticket with the CSRF header and connects with ?ticket=', async () => {
    const calls = browserFetch((call) =>
      call.url.endsWith('/auth/ws-ticket') ? json({ ticket: 'ticket-9', expiresIn: 30 }) : json({ ok: true }),
    );

    realtime.setSiteNotificationsSubscription(true);
    await until(() => FakeSocket.instances.length === 1, 'the socket');

    const [ticketCall] = calls;
    expect(ticketCall.url).toBe('/api/v1/auth/ws-ticket');
    expect(ticketCall.method).toBe('POST');
    expect(ticketCall.headers['X-CSRF-Token']).toBe('csrf-1');
    expect(FakeSocket.instances[0].url).toBe('wss://site.test/api/v1/ws?ticket=ticket-9');
  });

  test('a second subscribe while the ticket is in flight opens one socket', async () => {
    browserFetch((call) =>
      call.url.endsWith('/auth/ws-ticket') ? json({ ticket: 'ticket-9', expiresIn: 30 }) : json({ ok: true }),
    );

    realtime.setSiteNotificationsSubscription(true);
    realtime.setSiteNotificationsSubscription(true);
    await until(() => FakeSocket.instances.length >= 1, 'the socket');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(FakeSocket.instances).toHaveLength(1);
  });

  test('switching off while the ticket is in flight opens no socket', async () => {
    let release;
    browserFetch(
      (call) =>
        new Promise((resolve) => {
          release = () => resolve(json({ ticket: 'ticket-9', expiresIn: 30 }));
          if (!call.url.endsWith('/auth/ws-ticket')) resolve(json({ ok: true }));
        }),
    );

    realtime.setSiteNotificationsSubscription(true);
    await until(() => typeof release === 'function', 'the ticket request');
    realtime.setSiteNotificationsSubscription(false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(FakeSocket.instances).toHaveLength(0);
  });

  test('a refused ticket for a logged-out visitor stops the loop without a socket', async () => {
    const calls = browserFetch((call) => json({ error: { code: 'UNAUTHORIZED' } }, 401));

    realtime.setSiteNotificationsSubscription(true);
    await until(() => calls.some((call) => call.url.endsWith('/notifications/quick')), 'the auth probe');
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(FakeSocket.instances).toHaveLength(0);
    expect(calls.filter((call) => call.url.endsWith('/auth/ws-ticket'))).toHaveLength(1);
  });
});

// W1: defineWidget life cycle with the real browser build of Svelte on happy-dom.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { installBrowserEnv, settle, uninstallBrowserEnv } from './env.js';

let defineWidget, configure, resetConfig, resetSession, activeWidgets, Goal, invalidateAll;

/** a fake Pano: `credentials` answers per `session`, everything else 404 */
function fakePano({ user = null } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(String(url));
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (String(url).endsWith('/api/v1/auth/credentials')) {
      return user ? json(200, { ...user, csrfToken: 'tok' }) : json(401, { error: { code: 'NOT_LOGGED_IN' } });
    }
    return json(404, { error: { code: 'NOT_FOUND' } });
  };
  return { fetch, calls };
}

let counter = 0;
const nextTag = () => `pano-test-w${++counter}`;
const mountEl = (tag, attrs = {}) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
};
const body = (el) => (el.shadowRoot ?? el).querySelector('.pano-fb');

beforeAll(async () => {
  await installBrowserEnv();
  ({ defineWidget } = await import('../define.js'));
  ({ configure, resetConfig } = await import('../config.js'));
  ({ resetSession } = await import('../session.js'));
  ({ activeWidgets } = await import('../runtime.js'));
  ({ invalidateAll } = await import('../svelte.js'));
  Goal = (await import('./fixtures/Goal.svelte')).default;
});

afterAll(() => uninstallBrowserEnv());

beforeEach(() => {
  resetSession();
  configure({ apiBase: 'https://pano.test', siteUrl: 'https://site.test', urls: { 'auth.login': '/login' }, fetch: fakePano().fetch });
});

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  resetConfig();
});

describe('defineWidget', () => {
  test('connected: shadow root with the sheets and div.pano-fb, load, mount, pano:ready', async () => {
    const tag = nextTag();
    const loadCalls = [];
    defineWidget(
      tag,
      {
        component: Goal,
        attrs: ['label', { name: 'count', type: 'number' }],
        load: async (event, props) => {
          loadCalls.push({ event, props });
          return { data: { value: 5 } };
        },
      },
      { ns: 'test', styles: { fallback: 'https://pano.test/api/v1/plugins/pano-plugin-test/_/ui/fallback.css', hash: 'abc', icons: 'https://pano.test/icons.css' } },
    );

    const events = [];
    document.addEventListener('pano:ready', (e) => events.push(e));

    const el = mountEl(tag, { label: 'goal-x' });
    expect(el.dataset.panoState).toBe('loading');
    await settle(20);

    const root = el.shadowRoot;
    expect(root.mode ?? 'open').toBe('open');
    const hrefs = [...root.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute('href'));
    expect(hrefs).toEqual(['https://pano.test/api/v1/plugins/pano-plugin-test/_/ui/fallback.css?v=abc', 'https://pano.test/icons.css']);

    const fb = root.querySelector('div.pano-fb');
    expect(fb.getAttribute('data-pano-fb')).toBe('test');
    expect(fb.querySelector('.goal').textContent).toBe('goal-x:5:0');

    // the load contract of doc 06 section 3.1
    expect(loadCalls).toHaveLength(1);
    expect(loadCalls[0].event.widget).toBe(true);
    expect(loadCalls[0].event.params).toEqual({ label: 'goal-x' });
    expect(loadCalls[0].event.url).toBeInstanceOf(URL);
    expect(typeof loadCalls[0].event.fetch).toBe('function');
    expect(loadCalls[0].props).toEqual({ label: 'goal-x' });

    expect(el.dataset.panoState).toBe('ready');
    expect(events).toHaveLength(1);
    expect(events[0].bubbles).toBe(true);
    expect(events[0].composed).toBe(true);
    expect(activeWidgets()).toContain(el);
  });

  test('attribute change updates the props of the mounted component; properties too', async () => {
    const tag = nextTag();
    let loads = 0;
    defineWidget(tag, { component: Goal, attrs: ['label', { name: 'count', type: 'number' }], load: async () => (loads++, { data: { value: 1 } }) });

    const el = mountEl(tag, { count: '2' });
    await settle(20);
    expect(body(el).querySelector('.goal').textContent).toBe('goal:1:2');

    el.setAttribute('count', '7');
    await settle(10);
    expect(body(el).querySelector('.goal').textContent).toBe('goal:1:7');

    el.label = 'renamed';
    await settle(10);
    expect(body(el).querySelector('.goal').textContent).toBe('renamed:1:7');

    el.props = { data: { value: 42 } };
    await settle(10);
    expect(body(el).querySelector('.goal').textContent).toBe('renamed:42:7');
    expect(loads).toBe(1);
  });

  test('disconnected unmounts the component; reconnecting mounts again', async () => {
    const tag = nextTag();
    defineWidget(tag, { component: Goal, load: async () => ({ data: { value: 3 } }) });

    const el = mountEl(tag);
    await settle(20);
    expect(body(el).querySelector('.goal')).not.toBeNull();

    el.remove();
    expect(body(el).childElementCount).toBe(0);
    expect(activeWidgets()).not.toContain(el);

    document.body.append(el);
    await settle(20);
    expect(body(el).querySelector('.goal').textContent).toBe('goal:3:0');
  });

  test('a load that finishes after disconnect mounts nothing', async () => {
    const tag = nextTag();
    let release;
    defineWidget(tag, { component: Goal, load: () => new Promise((r) => (release = r)) });

    const el = mountEl(tag);
    await settle(20);
    el.remove();
    release({ data: { value: 1 } });
    await settle(10);
    expect(body(el).childElementCount).toBe(0);
  });

  test('load error: inline message, retry button, pano:error { code }, retry loads again', async () => {
    const tag = nextTag();
    let fail = true;
    defineWidget(tag, {
      component: Goal,
      load: async () => {
        if (fail) throw Object.assign(new Error('nope'), { code: 'BOOM' });
        return { data: { value: 9 } };
      },
    });

    const errors = [];
    document.addEventListener('pano:error', (e) => errors.push(e.detail));

    const el = mountEl(tag);
    await settle(20);
    expect(el.dataset.panoState).toBe('error');
    expect(errors).toEqual([{ code: 'BOOM' }]);
    const retry = body(el).querySelector('[data-pano-retry]');
    expect(retry).not.toBeNull();

    fail = false;
    retry.click();
    await settle(20);
    expect(el.dataset.panoState).toBe('ready');
    expect(body(el).querySelector('.goal').textContent).toBe('goal:9:0');
  });

  test('inactive plugin: empty, no error event', async () => {
    const errors = [];
    const onError = (e) => errors.push(e.detail);
    document.addEventListener('pano:error', onError);

    const a = nextTag();
    defineWidget(a, { component: Goal, load: async () => ({}) }, { active: false });
    const b = nextTag();
    defineWidget(b, {
      component: Goal,
      load: async () => {
        throw Object.assign(new Error('gone'), { code: 'PLUGIN_INACTIVE' });
      },
    });

    const first = mountEl(a);
    const second = mountEl(b);
    await settle(20);

    for (const el of [first, second]) {
      expect(el.dataset.panoState).toBe('inactive');
      expect(body(el).childElementCount).toBe(0);
    }
    expect(errors).toEqual([]);
    document.removeEventListener('pano:error', onError);
  });

  test("session 'required' and anonymous: sign-in link to the URL map; logged in: mounts", async () => {
    const tag = nextTag();
    let loads = 0;
    defineWidget(tag, { component: Goal, session: 'required', load: async () => (loads++, { data: { value: 1 } }) });

    const el = mountEl(tag);
    await settle(30);
    expect(el.dataset.panoState).toBe('signin');
    const a = body(el).querySelector('a');
    expect(a.getAttribute('href')).toBe('https://site.test/login');
    expect(loads).toBe(0);

    resetSession();
    configure({ fetch: fakePano({ user: { username: 'steve' } }).fetch });
    await el.reload();
    await settle(20);
    expect(el.dataset.panoState).toBe('ready');
    expect(loads).toBe(1);
  });

  test("session 'none' never probes the session", async () => {
    const tag = nextTag();
    const pano = fakePano();
    configure({ fetch: pano.fetch });
    defineWidget(tag, { component: Goal, load: async () => ({ data: { value: 1 } }) });

    mountEl(tag);
    await settle(20);
    expect(pano.calls.some((u) => u.endsWith('/auth/credentials'))).toBe(false);
  });

  test('no-shadow renders in the light DOM and links the sheets in head once', async () => {
    const tag = nextTag();
    defineWidget(tag, { component: Goal, load: async () => ({ data: { value: 6 } }) }, { ns: 'test', styles: { fallback: 'https://pano.test/fb.css', hash: 'h' } });

    const one = mountEl(tag, { 'no-shadow': '' });
    const two = mountEl(tag, { 'no-shadow': '' });
    await settle(20);

    expect(one.shadowRoot).toBeNull();
    expect(one.querySelector('div.pano-fb .goal').textContent).toBe('goal:6:0');
    expect(two.querySelector('div.pano-fb .goal')).not.toBeNull();
    const links = [...document.head.querySelectorAll('link[rel="stylesheet"]')];
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['https://pano.test/fb.css?v=h']);
  });

  test('invalidateAll re-runs the load of the mounted widgets', async () => {
    const tag = nextTag();
    let loads = 0;
    defineWidget(tag, { component: Goal, load: async () => ({ data: { value: ++loads } }) });

    const el = mountEl(tag);
    await settle(20);
    expect(body(el).querySelector('.goal').textContent).toBe('goal:1:0');

    await invalidateAll();
    await settle(10);
    expect(loads).toBe(2);
    expect(body(el).querySelector('.goal').textContent).toBe('goal:2:0');
  });

  test('an existing registration is kept', () => {
    const tag = nextTag();
    const first = defineWidget(tag, { component: Goal });
    expect(defineWidget(tag, { component: Goal })).toBe(first);
  });
});

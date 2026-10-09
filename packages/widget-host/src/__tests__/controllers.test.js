// W1: the controller host memoises load(name, params) while in flight and for 5 s (doc 06 section 3.1).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { installBrowserEnv, uninstallBrowserEnv } from './env.js';

let createLoadMemo, LOAD_MEMO_MS, plugin, clearLoadMemo, registry, loadPluginControllers, reactive;

beforeAll(async () => {
  await installBrowserEnv();
  ({ createLoadMemo, LOAD_MEMO_MS, plugin, clearLoadMemo, registry, loadPluginControllers, reactive } = await import('../controllers.js'));
});

afterAll(() => uninstallBrowserEnv());

afterEach(() => {
  clearLoadMemo();
  registry.reset();
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

describe('createLoadMemo', () => {
  test('the window is 5 seconds', () => {
    expect(LOAD_MEMO_MS).toBe(5000);
  });

  test('callers in flight share one call', async () => {
    const memo = createLoadMemo();
    const d = deferred();
    let calls = 0;
    const produce = () => (calls++, d.promise);

    const results = [memo.run('market/widgets', {}, produce), memo.run('market/widgets', {}, produce), memo.run('market/widgets', undefined, produce), memo.run('market/widgets', {}, produce)];
    expect(calls).toBe(1);

    d.resolve({ goal: 1 });
    expect(await Promise.all(results)).toEqual([{ goal: 1 }, { goal: 1 }, { goal: 1 }, { goal: 1 }]);
  });

  test('the answer is kept for 5 s after it arrived, then asked again', async () => {
    let time = 1000;
    const memo = createLoadMemo({ now: () => time });
    let calls = 0;
    const produce = async () => ({ n: ++calls });

    expect(await memo.run('a/b', {}, produce)).toEqual({ n: 1 });
    await Promise.resolve();

    time += 4999;
    expect(await memo.run('a/b', {}, produce)).toEqual({ n: 1 });
    expect(calls).toBe(1);

    time += 1;
    expect(await memo.run('a/b', {}, produce)).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  test('the 5 s run from the answer, not from the call', async () => {
    let time = 0;
    const memo = createLoadMemo({ now: () => time });
    const d = deferred();
    let calls = 0;
    const produce = () => (calls++, d.promise);

    const first = memo.run('a/b', {}, produce);
    time = 20000; // a slow request
    d.resolve({ ok: true });
    await first;
    await Promise.resolve();

    time = 24000;
    await memo.run('a/b', {}, produce);
    expect(calls).toBe(1);
  });

  test('params and names are separate keys; key order does not matter', async () => {
    const memo = createLoadMemo();
    let calls = 0;
    const produce = async () => ++calls;

    await memo.run('a/b', { x: 1, y: 2 }, produce);
    await memo.run('a/b', { y: 2, x: 1 }, produce);
    expect(calls).toBe(1);

    await memo.run('a/b', { x: 2, y: 2 }, produce);
    await memo.run('a/c', { x: 1, y: 2 }, produce);
    expect(calls).toBe(3);
  });

  test('a failure is not kept', async () => {
    const memo = createLoadMemo();
    let calls = 0;
    const produce = async () => {
      calls++;
      if (calls === 1) throw new Error('down');
      return { ok: true };
    };

    await expect(memo.run('a/b', {}, produce)).rejects.toThrow('down');
    await Promise.resolve();
    expect(await memo.run('a/b', {}, produce)).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('null (controller not available yet) is not kept', async () => {
    const memo = createLoadMemo();
    let calls = 0;
    const produce = async () => (++calls === 1 ? null : { ok: true });

    expect(await memo.run('a/b', {}, produce)).toBeNull();
    await Promise.resolve();
    expect(await memo.run('a/b', {}, produce)).toEqual({ ok: true });
  });
});

describe('plugin(ns).load', () => {
  test('four widgets of one plugin make one request', async () => {
    let requests = 0;
    const definition = {
      name: 'widgets',
      version: 1,
      load: async ({ params }) => {
        requests++;
        await new Promise((r) => setTimeout(r, 5));
        return { goal: 10, params };
      },
      create: () => ({ get: () => ({}), subscribe: (run) => (run({}), () => {}), actions: {}, destroy() {} }),
    };
    registry.register('pano-plugin-demo', 'demo', [definition]);

    const results = await Promise.all(['goal', 'buyers', 'top', 'stats'].map(() => plugin('demo').load('widgets')));
    expect(requests).toBe(1);
    expect(results.every((r) => r.goal === 10)).toBe(true);

    // a different params object is another request; clearing (invalidate) forgets
    await plugin('demo').load('widgets', { params: { page: 2 } });
    expect(requests).toBe(2);
    clearLoadMemo();
    await plugin('demo').load('widgets');
    expect(requests).toBe(3);
  });

  test('an unknown controller resolves null and is not remembered', async () => {
    expect(await plugin('missing').load('nothing')).toBeNull();
  });
});

describe('loadPluginControllers', () => {
  test('registers the definitions of a plugin once, with the widget host', async () => {
    let created = 0;
    const module = {
      controllers: {
        cart: {
          name: 'cart',
          version: 1,
          create: (host) => {
            created++;
            return { get: () => ({ guest: host.session().user === null, base: host.baseUrl }), subscribe: (run) => (run({}), () => {}), actions: {}, destroy() {} };
          },
        },
      },
    };

    expect(await loadPluginControllers({ pluginId: 'pano-plugin-shop', ns: 'shop', module })).toBe(true);
    expect(await loadPluginControllers({ pluginId: 'pano-plugin-shop', ns: 'shop', module: {} })).toBe(true); // once per plugin

    const cart = plugin('shop').use('cart');
    expect(cart.state.guest).toBe(true);
    expect(created).toBe(1);
    expect(plugin('shop').installed).toBe(true);
  });

  test('a plugin without controllers resolves false', async () => {
    expect(await loadPluginControllers({ pluginId: 'pano-plugin-none', ns: 'none', module: {} })).toBe(false);
  });
});

describe('reactive', () => {
  test('exposes state and actions of a controller', () => {
    const controller = { get: () => ({ n: 1 }), subscribe: (run) => (run({ n: 1 }), () => {}), actions: { add() {} } };
    const wrapped = reactive(controller);
    expect(wrapped.state).toEqual({ n: 1 });
    expect(wrapped.actions).toBe(controller.actions);
  });
});

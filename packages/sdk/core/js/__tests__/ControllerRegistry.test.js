import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as registry from '../ControllerRegistry.js';

const KEY = '__PANO_CONTROLLERS__';

/** hand-built definition: { name, version, scope, eager, create() } */
function makeDef({ name = 'cart', version = 1, scope, eager, load } = {}) {
  const def = {
    name,
    version,
    scope,
    eager,
    load,
    created: [],
    destroyed: 0,
    create(host, params, initial, ctx) {
      let state = { count: 0, ...(initial ?? {}) };
      const subs = new Set();
      const controller = {
        name,
        version,
        get: () => state,
        subscribe(run) {
          subs.add(run);
          run(state);
          return () => subs.delete(run);
        },
        actions: {
          add() {
            state = { ...state, count: state.count + 1 };
            subs.forEach((fn) => fn(state));
          },
        },
        destroy() {
          def.destroyed += 1;
        },
        host,
        params,
        ctx,
      };
      def.created.push(controller);
      return controller;
    },
  };
  return def;
}

const makeHost = (tag = 'h') => ({ tag, browser: true, request: async () => ({}) });

function enterBrowser() {
  globalThis.window = {};
  globalThis.document = {};
}
function leaveBrowser() {
  delete globalThis.window;
  delete globalThis.document;
}

let warn;
beforeEach(() => {
  delete globalThis[KEY];
  warn = spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  leaveBrowser();
  warn.mockRestore();
  delete globalThis[KEY];
});

describe('state on globalThis', () => {
  test('lives on __PANO_CONTROLLERS__ and is shared by name', () => {
    registry.register('pano-plugin-market', 'market', [makeDef()]);
    expect(globalThis[KEY]).toBeDefined();
    expect(registry.has('market/cart')).toBe(true);
    expect(globalThis[KEY].defs.has('market/cart')).toBe(true);
  });
});

describe('register / has / list', () => {
  test('array and object definitions, has with version, list shape', () => {
    registry.register('pano-plugin-market', 'market', { cart: makeDef({ name: 'cart', version: 2 }) });
    registry.register('pano-plugin-market', 'market', [makeDef({ name: 'format', scope: 'instance' })]);
    expect(registry.has('market/cart')).toBe(true);
    expect(registry.has('market/cart', 2)).toBe(true);
    expect(registry.has('market/cart', 1)).toBe(false);
    expect(registry.has('market/nope')).toBe(false);
    expect(registry.list()).toEqual([
      { name: 'market/cart', version: 2, pluginId: 'pano-plugin-market', scope: 'app' },
      { name: 'market/format', version: 1, pluginId: 'pano-plugin-market', scope: 'instance' },
    ]);
    expect(registry.pluginIdOf('market')).toBe('pano-plugin-market');
  });

  test('registering a name again replaces it', () => {
    registry.setHostFactory(() => makeHost());
    registry.register('p', 'market', [makeDef({ version: 1 })]);
    registry.register('p', 'market', [makeDef({ version: 2 })]);
    expect(registry.list()).toHaveLength(1);
    expect(registry.has('market/cart', 2)).toBe(true);
  });

  test('a definition without create() is skipped, not thrown', () => {
    expect(() => registry.register('p', 'market', [{ name: 'broken', version: 1 }])).not.toThrow();
    expect(registry.has('market/broken')).toBe(false);
  });
});

describe('use: unknown name and version rule', () => {
  beforeEach(() => registry.setHostFactory(() => makeHost()));

  test('unknown name returns null, warns once, never throws', () => {
    expect(registry.use('market/cart')).toBeNull();
    expect(registry.use('market/cart')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("controller 'market/cart' is not registered");
  });

  test('no version wanted returns the registered one', () => {
    registry.register('p', 'market', [makeDef({ version: 3 })]);
    expect(registry.use('market/cart')).not.toBeNull();
  });

  test('explicit version matches or mismatches', () => {
    registry.register('p', 'market', [makeDef({ version: 2 })]);
    expect(registry.use('market/cart', { version: 2 })).not.toBeNull();
    expect(registry.use('market/cart', { version: 1 })).toBeNull();
  });

  test('theme pin is used when no explicit version', () => {
    registry.register('p', 'market', [makeDef({ version: 2 })]);
    registry.setThemePins({ 'market/cart': 1 });
    expect(registry.use('market/cart')).toBeNull();
    registry.setThemePins({ 'market/cart': 2 });
    expect(registry.use('market/cart')).not.toBeNull();
  });

  test('explicit version beats the theme pin', () => {
    registry.register('p', 'market', [makeDef({ version: 2 })]);
    registry.setThemePins({ 'market/cart': 1 });
    expect(registry.use('market/cart', { version: 2 })).not.toBeNull();
  });

  test('mismatch reports to onMismatch with wanted and available, and warns', () => {
    registry.register('p', 'market', [makeDef({ version: 2 })]);
    registry.setThemePins({ 'market/cart': 1 });
    const seen = [];
    const off = registry.onMismatch((m) => seen.push(m));
    registry.use('market/cart');
    expect(seen).toEqual([{ kind: 'controller', name: 'market/cart', wanted: 1, available: 2 }]);
    expect(warn.mock.calls.at(-1)[0]).toContain("'market/cart' is at version 2, this theme was written for 1");
    off();
    registry.use('market/cart');
    expect(seen).toHaveLength(1);
  });

  test('a throwing onMismatch listener does not break use()', () => {
    const err = spyOn(console, 'error').mockImplementation(() => {});
    registry.register('p', 'market', [makeDef({ version: 2 })]);
    registry.onMismatch(() => {
      throw new Error('boom');
    });
    expect(registry.use('market/cart', { version: 1 })).toBeNull();
    err.mockRestore();
  });

  test('load honours the same version rule', async () => {
    registry.register('p', 'market', [makeDef({ version: 2, load: async () => ({ ok: 1 }) })]);
    expect(await registry.load('market/cart', { version: 1 })).toBeNull();
    expect(await registry.load('market/nope')).toBeNull();
  });
});

describe('browser: scopes and eager', () => {
  beforeEach(() => {
    enterBrowser();
    registry.setHostFactory(() => makeHost('browser'));
  });

  test('app scope is cached per name', () => {
    const d = makeDef();
    registry.register('p', 'market', [d]);
    const a = registry.use('market/cart');
    const b = registry.use('market/cart');
    expect(a).toBe(b);
    expect(d.created).toHaveLength(1);
  });

  test('instance scope is new per call', () => {
    const d = makeDef({ scope: 'instance' });
    registry.register('p', 'market', [d]);
    expect(registry.use('market/cart')).not.toBe(registry.use('market/cart'));
    expect(d.created).toHaveLength(2);
  });

  test('params and initial reach create()', () => {
    const d = makeDef({ scope: 'instance' });
    registry.register('p', 'market', [d]);
    const c = registry.use('market/cart', { params: { id: 7 }, initial: { count: 5 } });
    expect(c.params).toEqual({ id: 7 });
    expect(c.get().count).toBe(5);
  });

  test('eager controller is created inside register() and destroyed on reset()', () => {
    const d = makeDef({ eager: true });
    registry.register('p', 'market', [d]);
    expect(d.created).toHaveLength(1);
    expect(registry.use('market/cart')).toBe(d.created[0]);
    registry.reset();
    expect(d.destroyed).toBe(1);
    expect(registry.has('market/cart')).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  test('eager waits for the host factory, then starts', () => {
    registry.setHostFactory(null);
    const d = makeDef({ eager: true });
    registry.register('p', 'market', [d]);
    expect(d.created).toHaveLength(0);
    registry.setHostFactory(() => makeHost());
    expect(d.created).toHaveLength(1);
  });

  test('re-registering destroys the cached controller of that name', () => {
    const first = makeDef();
    registry.register('p', 'market', [first]);
    registry.use('market/cart');
    registry.register('p', 'market', [makeDef()]);
    expect(first.destroyed).toBe(1);
  });

  test('reset clears the cache so the next register builds a fresh controller', () => {
    const d = makeDef();
    registry.register('p', 'market', [d]);
    const a = registry.use('market/cart');
    registry.reset();
    const d2 = makeDef();
    registry.register('p', 'market', [d2]);
    expect(registry.use('market/cart')).not.toBe(a);
  });

  test('reset keeps host factory and pins (the engine sets them once)', () => {
    registry.setThemePins({ 'market/cart': 1 });
    registry.reset();
    registry.register('p', 'market', [makeDef({ version: 2 })]);
    expect(registry.use('market/cart')).toBeNull();
  });

  test('the browser host is built once', () => {
    let calls = 0;
    registry.setHostFactory(() => {
      calls += 1;
      return makeHost();
    });
    registry.register('p', 'market', [makeDef({ scope: 'instance' })]);
    registry.use('market/cart');
    registry.use('market/cart');
    expect(calls).toBe(1);
  });

  test('ctx.use reaches a sibling of the same plugin on the same host', () => {
    const format = makeDef({ name: 'format' });
    const cart = makeDef({ name: 'cart', scope: 'instance' });
    registry.register('p', 'market', [format, cart]);
    const c = registry.use('market/cart');
    const sib = c.ctx.use('format');
    expect(sib).toBe(registry.use('market/format'));
    expect(c.ctx.use('missing')).toBeNull();
  });
});

describe('server: no cache, host per call from event', () => {
  test('nothing is cached and eager does not start', () => {
    const hosts = [];
    registry.setHostFactory((event) => {
      const h = makeHost(event?.id);
      hosts.push(h);
      return h;
    });
    const d = makeDef({ eager: true });
    registry.register('p', 'market', [d]);
    expect(d.created).toHaveLength(0);

    const a = registry.use('market/cart', { event: { id: 'r1' } });
    const b = registry.use('market/cart', { event: { id: 'r2' } });
    expect(a).not.toBe(b);
    expect(a.host.tag).toBe('r1');
    expect(b.host.tag).toBe('r2');
    expect(hosts).toHaveLength(2);
    expect(globalThis[KEY].cache.size).toBe(0);
  });

  test('load gets the host of its own event', async () => {
    registry.setHostFactory((event) => makeHost(event?.id));
    const d = makeDef({ load: async ({ host, params }) => ({ tag: host.tag, params }) });
    registry.register('p', 'market', [d]);
    expect(await registry.load('market/cart', { event: { id: 'r9' }, params: { a: 1 } })).toEqual({
      tag: 'r9',
      params: { a: 1 },
    });
  });

  test('load without a loader resolves {}', async () => {
    registry.setHostFactory(() => makeHost());
    registry.register('p', 'market', [makeDef()]);
    expect(await registry.load('market/cart', { event: {} })).toEqual({});
  });

  test('use before a host factory returns null', () => {
    registry.register('p', 'market', [makeDef()]);
    expect(registry.use('market/cart')).toBeNull();
  });
});

describe('sample mode', () => {
  test('use() returns fixed-state sample controllers and leaves the app cache alone', () => {
    enterBrowser();
    registry.setHostFactory(() => makeHost());
    const d = makeDef();
    registry.register('p', 'market', [d]);

    const real = registry.use('market/cart');
    real.actions.add();
    expect(real.get().count).toBe(1);
    const cacheSize = globalThis[KEY].cache.size;
    const createdBefore = d.created.length;

    registry.setSamples({ 'market/cart': { count: 9 } });
    const sample = registry.use('market/cart');
    expect(sample).not.toBe(real);
    expect(sample.get().count).toBe(9);
    sample.actions.add('x', 1);
    expect(sample.calls).toEqual([{ name: 'add', args: ['x', 1] }]);
    expect(sample.get().count).toBe(9);
    expect(globalThis[KEY].cache.size).toBe(cacheSize);

    registry.setSamples(null);
    expect(registry.use('market/cart')).toBe(real);
    expect(real.get().count).toBe(1);
    // the throwaway controller used to read the initial state was destroyed, the real one was not
    expect(d.created.length).toBe(createdBefore + 1);
    expect(d.destroyed).toBe(1);
  });

  test('a name the samples do not mention still gets a sample controller', () => {
    registry.setHostFactory(() => makeHost());
    registry.register('p', 'market', [makeDef()]);
    registry.setSamples({});
    expect(registry.use('market/cart').get().count).toBe(0);
  });

  test('createSample on the definition wins when present', () => {
    registry.setHostFactory(() => makeHost());
    const d = makeDef();
    d.createSample = (patch) => ({ custom: true, patch });
    registry.register('p', 'market', [d]);
    registry.setSamples({ 'market/cart': { count: 4 } });
    expect(registry.use('market/cart')).toEqual({ custom: true, patch: { count: 4 } });
  });
});

describe('the exposed object', () => {
  test('controllers has the whole surface of doc 02 section 2', () => {
    for (const k of [
      'register',
      'reset',
      'use',
      'load',
      'has',
      'list',
      'setHostFactory',
      'setThemePins',
      'setSamples',
      'onMismatch',
    ]) {
      expect(typeof registry.controllers[k]).toBe('function');
    }
  });
});

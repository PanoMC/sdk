import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

// Model of svelte's createSubscriber: the first tracked read (inside an "effect") starts the subscription,
// update() re-runs the effect, and the returned stop function runs when the effect is torn down.
const effects = { started: 0, stopped: 0, updates: 0, update: null, stop: null };
let inEffect = false;
mock.module('svelte/reactivity', () => ({
  createSubscriber(start) {
    let stop = null;
    return () => {
      if (!inEffect || stop) return;
      effects.started += 1;
      stop = start(() => {
        effects.updates += 1;
      });
      effects.stop = () => {
        effects.stopped += 1;
        stop?.();
        stop = null;
      };
    };
  },
}));

const registry = await import('../../core/js/ControllerRegistry.js');
const { reactive, useController, plugin } = await import('../controllers.js');
const { setPanoContext } = await import('../internal/index.js');

const KEY = '__PANO_CONTROLLERS__';

function makeDef({ name = 'cart', version = 1, scope, load } = {}) {
  const def = {
    name,
    version,
    scope,
    load,
    destroyed: 0,
    create(host, params, initial) {
      let state = { count: 0, ...(initial ?? {}) };
      const subs = new Set();
      return {
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
      };
    },
  };
  return def;
}

let warn;
beforeEach(() => {
  delete globalThis[KEY];
  effects.started = effects.stopped = effects.updates = 0;
  warn = spyOn(console, 'warn').mockImplementation(() => {});
  registry.setHostFactory(() => ({ browser: false }));
});
afterEach(() => {
  warn.mockRestore();
  delete globalThis[KEY];
  setPanoContext({ utils: undefined });
});

describe('reactive', () => {
  test('state reads the snapshot and actions pass through', () => {
    const c = makeDef().create({}, {});
    const r = reactive(c);
    expect(r.controller).toBe(c);
    expect(r.state.count).toBe(0);
    r.actions.add();
    expect(r.state.count).toBe(1);
  });

  test('a read inside an effect subscribes once; changes call update; the first synchronous callback does not', () => {
    const c = makeDef().create({}, {});
    const r = reactive(c);
    inEffect = true;
    r.state;
    r.state;
    inEffect = false;
    expect(effects.started).toBe(1);
    expect(effects.updates).toBe(0);
    r.actions.add();
    expect(effects.updates).toBe(1);
    effects.stop();
    r.actions.add();
    expect(effects.updates).toBe(1);
  });

  test('a read outside an effect does not subscribe', () => {
    const r = reactive(makeDef().create({}, {}));
    r.state;
    expect(effects.started).toBe(0);
  });
});

describe('useController', () => {
  test('returns null when unavailable, a reactive wrapper otherwise', () => {
    expect(useController('market/cart')).toBeNull();
    registry.register('pano-plugin-market', 'market', [makeDef()]);
    const r = useController('market/cart', { initial: { count: 3 } });
    expect(r.state.count).toBe(3);
    expect(typeof r.actions.add).toBe('function');
  });

  test('a version mismatch is null, not a throw', () => {
    registry.register('pano-plugin-market', 'market', [makeDef({ version: 2 })]);
    expect(useController('market/cart', { version: 1 })).toBeNull();
  });

  test('outside a component an instance controller does not throw (caller owns destroy)', () => {
    registry.register('pano-plugin-market', 'market', [makeDef({ scope: 'instance' })]);
    expect(() => useController('market/cart')).not.toThrow();
  });
});

describe('plugin(ns)', () => {
  test('id, namespace, installed', () => {
    const p = plugin('market');
    expect(p.namespace).toBe('market');
    expect(p.installed).toBe(false);
    expect(p.id).toBe('pano-plugin-market');
    registry.register('pano-plugin-shop', 'market', [makeDef()]);
    expect(p.installed).toBe(true);
    expect(p.id).toBe('pano-plugin-shop');
  });

  test('use returns null when unavailable and a controller otherwise', () => {
    const p = plugin('market');
    expect(p.use('cart')).toBeNull();
    registry.register('pano-plugin-market', 'market', [makeDef()]);
    expect(p.use('cart').state.count).toBe(0);
  });

  test('use honours a theme pin and an explicit version', () => {
    registry.register('pano-plugin-market', 'market', [makeDef({ version: 2 })]);
    registry.setThemePins({ 'market/cart': 1 });
    const p = plugin('market');
    expect(p.use('cart')).toBeNull();
    expect(p.use('cart', { version: 2 })).not.toBeNull();
  });

  test('require throws "<name> is not available"; works when present', () => {
    const p = plugin('market');
    expect(() => p.require('cart')).toThrow('market/cart is not available');
    registry.register('pano-plugin-market', 'market', [makeDef({ version: 2 })]);
    expect(() => p.require('cart', { version: 1 })).toThrow('market/cart is not available');
    expect(p.require('cart', { version: 2 }).actions.add).toBeFunction();
  });

  test('load goes through the registry', async () => {
    registry.register('pano-plugin-market', 'market', [
      makeDef({ load: async ({ params }) => ({ products: [params.id] }) }),
    ]);
    const p = plugin('market');
    expect(await p.load('cart', { params: { id: 1 }, event: {} })).toEqual({ products: [1] });
    expect(await p.load('nope', { event: {} })).toBeNull();
  });

  test('_ is a readable store that prefixes keys with plugins.<pluginId>.', () => {
    const seen = [];
    const base = (key, options) => {
      seen.push([key, options]);
      return `T:${key}`;
    };
    setPanoContext({
      utils: {
        language: {
          _: {
            subscribe(run) {
              run(base);
              return () => {};
            },
          },
        },
      },
    });
    registry.register('pano-plugin-market', 'market', [makeDef()]);

    let fn;
    const off = plugin('market')._.subscribe((f) => (fn = f));
    expect(fn('cart.title')).toBe('T:plugins.pano-plugin-market.cart.title');
    fn('cart.items', { n: 2 });
    fn('cart.items', { values: { n: 3 } });
    expect(seen.at(-2)[1]).toEqual({ values: { n: 2 } });
    expect(seen.at(-1)[1]).toEqual({ values: { n: 3 } });
    off();
  });

  test('_ without a language store falls back to the prefixed key', () => {
    let fn;
    plugin('market')._.subscribe((f) => (fn = f));
    expect(fn('x')).toBe('plugins.pano-plugin-market.x');
  });

  test('toast prefixes the key and maps the variant; no host toast is a no-op', () => {
    const calls = [];
    expect(() => plugin('market').toast('saved')).not.toThrow();
    setPanoContext({ utils: { toast: { show: (...a) => calls.push(a) } } });
    registry.register('pano-plugin-market', 'market', [makeDef()]);
    plugin('market').toast('saved', { variant: 'success', values: { n: 1 } });
    plugin('market').toast('plain');
    expect(calls[0]).toEqual(['plugins.pano-plugin-market.saved', { n: 1 }, undefined, { variant: 'success' }]);
    expect(calls[1]).toEqual(['plugins.pano-plugin-market.plain', {}, undefined, undefined]);
  });
});

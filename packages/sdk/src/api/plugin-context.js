const GLOBAL_KEY = '__PANO_PLUGIN_CONTEXTS__';

function getStore() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = Object.create(null);
  }
  return globalThis[GLOBAL_KEY];
}

export function createPluginContext(pluginId) {
  if (!pluginId) {
    throw new Error('[PanoSDK] pluginId is required');
  }

  const store = getStore();

  if (!store[pluginId]) {
    store[pluginId] = {
      context: {},
      listeners: [],
    };
  }

  const pluginStore = store[pluginId];

  return {
    context: pluginStore.context,

    set(partial) {
      if (typeof partial !== 'object' || partial === null) return;

      Object.assign(pluginStore.context, partial);

      pluginStore.listeners.forEach((fn) => {
        try {
          fn(pluginStore.context);
        } catch (e) {
          console.error(`[PanoSDK][${pluginId}] listener error`, e);
        }
      });
    },

    subscribe(fn) {
      pluginStore.listeners.push(fn);

      return () => {
        pluginStore.listeners = pluginStore.listeners.filter((l) => l !== fn);
      };
    },

    destroy() {
      delete store[pluginId];
    },
  };
}

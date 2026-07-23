const GLOBAL_KEY = '__PANO_CONTEXT__';

function getStore() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      context: {},
      listeners: [],
    };
  }
  return globalThis[GLOBAL_KEY];
}

/**
 * @typedef {import('../types.js').Pano} Pano
 */

/**
 * @param {Partial<Pano>} partial
 */
export function setPanoContext(partial) {
  const store = getStore();

  if (typeof partial !== 'object' || partial === null) {
    console.warn('[PanoSDK] setPanoContext expects an object');
    return;
  }

  Object.assign(store.context, partial);

  store.listeners.forEach((fn) => {
    try {
      fn(store.context);
    } catch (e) {
      console.error('[PanoSDK] listener error', e);
    }
  });
}

/**
 * @returns {{ context: Pano, subscribe: (fn: (ctx: Pano) => void) => () => void }}
 */
export function getPanoContext() {
  const store = getStore();

  return {
    context: store.context,

    subscribe(fn) {
      store.listeners.push(fn);

      // unsubscribe
      return () => {
        store.listeners = store.listeners.filter((l) => l !== fn);
      };
    },
  };
}

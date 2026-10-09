// `getPanoContext` of a widget page (`@panomc/sdk` and `@panomc/sdk/internal`): a small context of the host modules.
// It is not the theme's `globalThis.__PANO_CONTEXT__`: a widget page has no theme and no engine.
import { getConfig, onConfigure } from './config.js';

const store = { context: /** @type {Record<string, any>} */ ({ isPanel: false, browser: true }), listeners: /** @type {Array<(c:any)=>void>} */ ([]) };

function notify() {
  for (const fn of [...store.listeners]) {
    try {
      fn(store.context);
    } catch (e) {
      console.error('[pano-widgets] context listener failed', e);
    }
  }
}

/** @param {Record<string, any>} partial */
export function setPanoContext(partial) {
  if (typeof partial !== 'object' || partial === null) {
    console.warn('[PanoSDK] setPanoContext expects an object');
    return;
  }
  Object.assign(store.context, partial);
  notify();
}

/** @returns {{ context: Record<string, any>, subscribe: (fn: (c:any)=>void) => () => void }} */
export function getPanoContext() {
  return {
    context: store.context,
    subscribe(fn) {
      store.listeners.push(fn);
      return () => {
        store.listeners = store.listeners.filter((l) => l !== fn);
      };
    },
  };
}

// the parts every module can read without importing the others
onConfigure((config) => {
  store.context.base = config.siteUrl;
  store.context.urls = { ...config.urls };
  notify();
});
store.context.base = getConfig().siteUrl;
store.context.urls = getConfig().urls;

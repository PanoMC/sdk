import { createPluginContext } from './plugin-context.js';

/**
 * @typedef {import('../types.js').Pano} Pano
 * @typedef {import('../types.js').PanoPluginContext} PanoPluginContext
 */

export class PanoPlugin {
  static isPanoPlugin = true;

  /** @type {Pano} */
  pano;

  /** @type {PanoPluginContext} */
  contextApi;

  /** @type {any} */
  context;

  constructor({ pluginId, scope } = {}) {
    if (!pluginId) {
      throw new Error('[PanoPlugin] pluginId is required');
    }

    // plugin-scoped context
    this.contextApi = createPluginContext(pluginId, scope);
    this.context = this.contextApi.context;

    this._unsubscribers = [];
  }

  /**
   * @param {Pano} pano
   */
  onLoad(pano) {}
  onUnload() {}

  /** plugin context helper */
  setContext(partial) {
    this.contextApi.set(partial);
  }

  /** internal cleanup */
  __destroy() {
    this._unsubscribers.forEach((fn) => fn());
    this.contextApi.destroy?.();
    this.onUnload();
  }
}

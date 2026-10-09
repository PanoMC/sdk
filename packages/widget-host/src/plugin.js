// `PanoPlugin` base class of a widget page: never instantiated (a plugin's `main.js` / `onLoad` does not run in a widget).
export class PanoPlugin {
  static isPanoPlugin = true;

  pano;
  contextApi;
  context;

  constructor({ pluginId } = {}) {
    if (!pluginId) throw new Error('[PanoPlugin] pluginId is required');
    this.contextApi = { context: {}, set() {}, subscribe: () => () => {}, destroy() {} };
    this.context = this.contextApi.context;
    this._unsubscribers = [];
  }

  onLoad(_pano) {}
  onUnload() {}
  setContext(_partial) {}
  __destroy() {}
}

// Rollup plugin of the plugin-scoped API client (doc 04 section 9).
//
//   import { api } from '@panomc/sdk/plugin-api';
//   await api.get({ path: '/hello', request: event });   // api.panel.get(...) for a PanelApi
//
// `@panomc/sdk/plugin-api` is a virtual module: this plugin resolves it to
//
//   import { createPluginApi } from '@panomc/sdk/utils/api';
//   export const api = createPluginApi('<pluginId>');
//
// so the plugin id never appears in the author's code. The file has no dependencies and no
// imports, so any `rollup.config.js` can load it from a folder (the kit loads it from the
// sdk folder it builds against); `panoPlugin()` of @panomc/plugin-kit includes it.

/** Specifier the author imports. */
export const PLUGIN_API_SPECIFIER = '@panomc/sdk/plugin-api';

const VIRTUAL_ID = '\0pano:plugin-api';

/**
 * @param {string} pluginId full plugin id, e.g. `pano-plugin-market` (gradle.properties `pluginId`)
 * @returns {import('rollup').Plugin}
 */
export function pluginApi(pluginId) {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new Error('[pano] pluginApi(pluginId) needs the plugin id from gradle.properties');
  }

  return {
    name: 'pano-plugin-api',
    resolveId(source) {
      if (source === PLUGIN_API_SPECIFIER) return VIRTUAL_ID;
      return null;
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null;

      return (
        `import { createPluginApi } from '@panomc/sdk/utils/api';\n` +
        `export const api = createPluginApi(${JSON.stringify(pluginId)});\n`
      );
    },
  };
}

export default pluginApi;

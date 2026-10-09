import { getPanoContext } from '../internal/index.js';

const panoContext = getPanoContext();
const apiStuff = panoContext.context.utils.api;

const ApiUtil = apiStuff.ApiUtil;

const NETWORK_ERROR = apiStuff.NETWORK_ERROR;
const networkErrorBody = apiStuff.networkErrorBody;
const buildQueryParams = apiStuff.buildQueryParams;

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Plugin-scoped client (doc 04 section 9): `createPluginApi('pano-plugin-market').get({ path: '/store/products' })`
 * calls `/api/plugins/pano-plugin-market/store/products`, `.panel.get(...)` the `/api/plugins/<id>/panel/...`
 * twin (decision 81: plugin endpoints are unversioned). Takes the options of the matching `ApiUtil` method. The host's own implementation is used when it provides
 * one (same behaviour); otherwise this one builds the prefixed call on the host's `ApiUtil`, so the module works
 * with every host version.
 *
 * @param {string} pluginId the full plugin id (`pano-plugin-market`), never the short namespace
 */
const createPluginApi =
  apiStuff.createPluginApi ??
  function createPluginApi(pluginId) {
    if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) {
      throw new Error(`[pano] createPluginApi needs the full plugin id, got ${JSON.stringify(pluginId)}`);
    }

    const scoped = (prefix) => {
      const wrap = (method) => async (options = {}) => {
        let path = String(options.path ?? '');
        if (!path.startsWith('/')) path = `/${path}`;
        if (!import.meta.env?.PROD && /^\/api(?:[/?#]|$)/.test(path)) {
          throw new Error(`[pano] path must not start with /api: write '${path.replace(/^\/api/, '') || '/'}'`);
        }

        return ApiUtil[method]({ ...options, unversioned: true, path: `${prefix}${path}` });
      };

      return {
        get: wrap('get'),
        post: wrap('post'),
        put: wrap('put'),
        delete: wrap('delete'),
        customRequest: wrap('customRequest'),
      };
    };

    return { ...scoped(`/plugins/${pluginId}`), panel: scoped(`/plugins/${pluginId}/panel`) };
  };

export { ApiUtil, NETWORK_ERROR, networkErrorBody, buildQueryParams, createPluginApi };

export default ApiUtil;

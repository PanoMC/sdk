// `@panomc/sdk/utils/api` outside a theme (doc 06 section 3.2): `ApiUtil` over the page's `@panomc/client`.
// Paths are relative to `/api/v1`. The return value is the body shape of doc 04 section 9: the parsed body of a 2xx answer
// (`{}` when it has none), `{ error: { code, ... } }` for any other answer, `{ error: { code: 'NETWORK_ERROR' } }` when nothing arrived.
import { getClient, getConfig, pageFetch } from './config.js';

export const NETWORK_ERROR = 'NETWORK_ERROR';
export const networkErrorBody = Object.freeze({ error: Object.freeze({ code: NETWORK_ERROR }) });

/** Query string from an object; empty values are left out (same rule as the theme). */
export function buildQueryParams(params) {
  const query = Object.keys(params ?? {})
    .filter((key) => params[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return query === '' ? '' : `?${query}`;
}

/**
 * `/posts`, `posts`, `/api/v1/posts` and `/api/posts` all mean `/api/v1/posts`. A plugin's own path
 * (`/api/plugins/<id>/...`, unversioned, decision 81) is kept as it is.
 */
function v1Path(path) {
  const text = String(path ?? '');
  if (/^\/api\/plugins\/[^/?#]+\/(?!_(?:[/?#]|$))[^?#]/.test(text)) return text;
  if (/^\/plugins\/[^/?#]+\/(?!_(?:[/?#]|$))[^?#]/.test(text)) return `/api${text}`;
  const rest = String(path ?? '').replace(/^\/?api(\/v1)?(?=\/|$)/, '');
  return `/api/v1${rest.startsWith('/') || rest === '' ? '' : '/'}${rest}`;
}

/**
 * The call behind `ApiUtil` and the controller host's `request`.
 * @param {{ method?: string, path: string, query?: Record<string, any>, body?: any, headers?: Record<string,string>, blob?: boolean, signal?: AbortSignal }} r
 */
export async function hostRequest(r) {
  const method = String(r?.method ?? 'GET').toUpperCase();
  const path = v1Path(r?.path);

  if (r?.blob && method === 'GET') {
    try {
      const url = `${getConfig().apiBase}${path}${buildQueryParams(r.query ?? {})}`;
      const response = await pageFetch(url, { method, credentials: 'include', headers: r.headers, signal: r.signal });
      if (response.ok) return await response.blob();
      return { error: { code: 'UNKNOWN_ERROR', details: { status: response.status } } };
    } catch {
      return { error: { code: NETWORK_ERROR } };
    }
  }

  const result = await getClient().request(
    { method, path },
    { query: r?.query, body: r?.body, headers: r?.headers, signal: r?.signal },
  );

  if (result.ok) return result.data === undefined || result.data === null ? {} : result.data;
  if (result.error?.code === NETWORK_ERROR) return { error: { code: NETWORK_ERROR } };
  return { error: result.error };
}

async function finish(body, handler) {
  return handler ? handler(body) : body;
}

function headersOf({ headers, token, csrfToken }) {
  const out = { ...(headers ?? {}) };
  if (token) out.Authorization = `Bearer ${token}`;
  if (csrfToken) out['X-CSRF-Token'] = csrfToken;
  return out;
}

export const ApiUtil = {
  interceptors: {},

  get({ path, query, headers, csrfToken, token, blob, handler }) {
    return this.customRequest({ path, data: { method: 'GET', query, headers }, csrfToken, token, blob, handler });
  },

  post({ path, body, headers, csrfToken, token, blob, handler }) {
    return this.customRequest({ path, data: { method: 'POST', body, headers }, csrfToken, token, blob, handler });
  },

  put({ path, body, headers, csrfToken, token, blob, handler }) {
    return this.customRequest({ path, data: { method: 'PUT', body, headers }, csrfToken, token, blob, handler });
  },

  delete({ path, headers, csrfToken, token, blob, handler }) {
    return this.customRequest({ path, data: { method: 'DELETE', headers }, csrfToken, token, blob, handler });
  },

  /** `request` (a SvelteKit load event) is accepted and ignored: a widget has none. */
  async customRequest({ path, data = {}, csrfToken, token, blob, handler }) {
    const body = await hostRequest({
      method: data.method ?? 'GET',
      path,
      query: data.query,
      body: data.body,
      headers: headersOf({ headers: data.headers, token, csrfToken }),
      blob,
    });
    return finish(body, handler);
  },
};

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Plugin-scoped client with the contract of `createPluginApi` in `@panomc/sdk/utils/api` (doc 04 section 9):
 * `createPluginApi('pano-plugin-market').get({ path: '/store/products' })` calls
 * `/api/plugins/pano-plugin-market/store/products`, `.panel.get(...)` the `/api/plugins/<id>/panel/...` twin.
 * Every method takes the options of the matching `ApiUtil` method. A path that starts with `/api` throws outside
 * production, as it does in a theme.
 *
 * @param {string} pluginId the full plugin id (`pano-plugin-market`), never the short namespace
 */
export function createPluginApi(pluginId) {
  if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error(`[pano] createPluginApi needs the full plugin id, got ${JSON.stringify(pluginId)}`);
  }

  const scoped = (prefix) => {
    const wrap = (method) => async (options = {}) => {
      if (typeof options.path !== 'string') throw new TypeError('[pano] api path must be a string');

      const path = options.path.startsWith('/') ? options.path : `/${options.path}`;

      if (!import.meta.env?.PROD && /^\/api(?:[/?#]|$)/.test(path)) {
        throw new Error(`[pano] path must not start with /api: write '${path.replace(/^\/api/, '') || '/'}'`);
      }

      return ApiUtil[method]({ ...options, path: `${prefix}${path}` });
    };

    return {
      get: wrap('get'),
      post: wrap('post'),
      put: wrap('put'),
      delete: wrap('delete'),
      customRequest: wrap('customRequest'),
    };
  };

  return { ...scoped(`/api/plugins/${pluginId}`), panel: scoped(`/api/plugins/${pluginId}/panel`) };
}

export default ApiUtil;

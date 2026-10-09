import { API_URL, CSRF_HEADER } from "$lib/variables.js";
import { get } from "svelte/store";
import { page } from "$app/stores";
import { browser } from "$app/environment";
import { initialized } from "$lib/Store.js";
import { show } from "$lib/components/ToastContainer.svelte";

// Constants for network error handling
export const NETWORK_ERROR = 'NETWORK_ERROR';
export const networkErrorBody = { error: { code: NETWORK_ERROR } };
export const DISABLED_FOR_DEMO = 'DISABLED_FOR_DEMO';

/** Prefix of the whole API when the backend base (`API_URL`) ends in `/api` (doc 04 section 9). */
const API_VERSION_PREFIX = '/api/v1';

/** Prefix of the plugin namespace (decision 81): plugin endpoints are unversioned, `/api/plugins/<id>/...`. */
const API_PLUGIN_PREFIX = '/api';

const NETWORK_RETRY_DELAY_MS = 400;

function isIdempotent(method) {
  return !method || ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * The browser's cached answer of `GET /auth/csrf` (doc 05 section 4): the promise of the token, `null`
 * when the visitor has no cookie session. Kept in the browser only; on the server one module serves every
 * visitor, so nothing is cached there.
 * @type {Promise<string | null> | undefined}
 */
let fetchedCsrfToken;

/** Forget the token fetched from `GET /auth/csrf` (a test, or a client that knows the session changed). */
export function resetFetchedCsrfToken() {
  fetchedCsrfToken = undefined;
}

/**
 * Ask Pano for the session's CSRF token. Used before a mutation when the page session has none (a front-end
 * on another origin, or a page whose data carries no session): a cookie session answers `{ csrfToken }`, a
 * Bearer or anonymous request gets `null` (`401` is "no live cookie session", not an error).
 *
 * @param {{ fetch?: typeof fetch } | undefined} request SvelteKit's `load` / event, whose `fetch` is used on the server
 * @returns {Promise<string | null>}
 */
async function loadCsrfToken(request) {
  const url = resolveApiUrl('/auth/csrf', {
    apiUrl: API_URL,
    hasEventFetch: !!(request && request.fetch),
    browser,
    prod: !!import.meta.env.PROD,
  });

  try {
    const response = await (request && request.fetch ? request.fetch : fetch)(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const body = await response.json();

    return typeof body?.csrfToken === 'string' && body.csrfToken ? body.csrfToken : null;
  } catch {
    return null;
  }
}

/** The CSRF token for a mutation that has none: fetched once in the browser, per call on the server. */
function resolveCsrfToken(request) {
  if (!browser) return loadCsrfToken(request);

  fetchedCsrfToken ??= loadCsrfToken(request);

  return fetchedCsrfToken;
}

/** A refused request means the session behind a cached token may be gone: ask again next time. */
function noteStatus(response) {
  if (response && (response.status === 401 || response.status === 403)) fetchedCsrfToken = undefined;

  return response;
}

// Function to build query parameters from an object
export function buildQueryParams(params) {
  const queryString = Object.keys(params)
    .filter((key) => params[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return queryString === '' ? '' : '?' + queryString;
}

const isWebsiteApi = (apiUrl) => typeof apiUrl === 'string' && apiUrl.includes('.panomc.com');

const isLoopbackApi = (apiUrl) =>
  typeof apiUrl === 'string' &&
  (apiUrl.includes('0.0.0.0') || apiUrl.includes('127.0.0.1') || apiUrl.includes('localhost'));

/** A path that still carries the `/api` prefix (`/api`, `/api/...`, `/api?x`), but not `/apiary`. */
const startsWithApi = (path) => /^\/api(?:[/?#]|$)/.test(path);

/**
 * A plugin's own endpoint path: `/plugins/<id>/...` or `/api/plugins/<id>/...`, anything but core's `/plugins/<id>/_/...`.
 * These live outside `/api/v1` (decision 81), so `ApiUtil` sends them to `/api/plugins/<id>/...` whichever form came in.
 * @param {string} path
 */
export const isPluginOwnPath = (path) =>
  typeof path === 'string' && /^\/(?:api\/)?plugins\/[^/?#]+\/(?!_(?:[/?#]|$))[^?#]/.test(path);

/**
 * Callers pass paths relative to `/api/v1` ("/posts"). A missing leading slash is added.
 * In dev a path that starts with `/api` throws (the website API has no `/v1`, so it is exempt).
 *
 * @param {string} path
 * @param {{ website?: boolean, prod?: boolean }} [opts]
 * @returns {string} the path with a leading slash
 */
export function normalizeApiPath(path, { website = false, prod = false } = {}) {
  if (typeof path !== 'string') throw new TypeError('[pano] api path must be a string');

  const normalized = path.startsWith('/') ? path : `/${path}`;

  if (!website && !prod && startsWithApi(normalized)) {
    throw new Error(
      `[pano] path must not start with /api: write '${normalized.replace(/^\/api/, '') || '/'}'`,
    );
  }

  return normalized;
}

/**
 * The URL of one call: exactly the four cases of doc 04 section 9, no pass-through.
 *
 *  1. `apiUrl` contains `.panomc.com` (the website; its API has no `/v1`): `apiUrl + path`.
 *  2. `hasEventFetch` (SSR `load` behind the proxy): relative `/api/v1` + path, so SSR and CSR dedupe.
 *  3. browser, and production or a loopback `apiUrl`: `/api/v1` + path.
 *  4. everything else (SSR without an event, not initialised): `apiUrl + '/v1' + path`.
 *
 * With `unversioned` (a plugin's own endpoints, `/plugins/<id>/...`, decision 81) the same four cases apply but the
 * version segment is left out: `/api` + path, or `apiUrl + path`.
 *
 * @param {string} path relative to `/api/v1` (relative to `/api` with `unversioned`)
 * @param {{ apiUrl?: string, hasEventFetch?: boolean, browser?: boolean, prod?: boolean, unversioned?: boolean }} ctx
 * @returns {string}
 */
export function resolveApiUrl(
  path,
  { apiUrl = '', hasEventFetch = false, browser = false, prod = false, unversioned = false } = {},
) {
  const website = isWebsiteApi(apiUrl);
  const relative = normalizeApiPath(path, { website, prod });
  const root = unversioned ? API_PLUGIN_PREFIX : API_VERSION_PREFIX;

  if (website) return `${apiUrl.replace(/\/+$/, '')}${relative}`;
  if (hasEventFetch) return `${root}${relative}`;
  if (browser && (prod || isLoopbackApi(apiUrl))) return `${root}${relative}`;

  return `${(apiUrl || '/api').replace(/\/+$/, '')}${unversioned ? '' : '/v1'}${relative}`;
}

const ApiUtil = {
  interceptors: {},

  // GET request
  async get({ path, request, csrfToken, token, blob, handler, unversioned }) {
    return this.customRequest({
      path,
      unversioned,
      request,
      csrfToken,
      token,
      blob,
      handler,
    });
  },

  // POST request
  async post({ path, request, body, headers, csrfToken, token, blob, handler, onUploadProgress, unversioned }) {
    return this.customRequest({
      path,
      unversioned,
      data: { method: 'POST', credentials: 'include', body, headers },
      request,
      csrfToken,
      token,
      blob,
      handler,
      onUploadProgress,
    });
  },

  // PUT request
  async put({ path, request, body, headers, csrfToken, token, blob, handler, onUploadProgress, unversioned }) {
    return this.customRequest({
      path,
      unversioned,
      data: { method: 'PUT', credentials: 'include', body, headers },
      request,
      csrfToken,
      token,
      blob,
      handler,
      onUploadProgress,
    });
  },

  // DELETE request
  async delete({ path, request, headers, csrfToken, token, blob, handler, unversioned }) {
    return this.customRequest({
      path,
      unversioned,
      data: { method: 'DELETE', headers },
      request,
      csrfToken,
      token,
      blob,
      handler,
    });
  },

  // Custom request handler
  async customRequest({ path, data = {}, request, csrfToken, token, blob, handler, onUploadProgress, unversioned }) {
    // Retrieve CSRF token if not provided
    if (!csrfToken) {
      let session;
      if (request && typeof request.parent === "function") {
        const parentData = await request.parent();
        session = parentData.session;
      } else if (browser && get(page).data) {
        session = get(page).data.session;
      }
      csrfToken = session && session.csrfToken;
    }

    // A mutation on a cookie session needs the header (doc 05 section 4). When the page session has no token,
    // ask `GET /auth/csrf` once. A Bearer call (`token`) never needs it.
    if (!csrfToken && !token && !isIdempotent(data.method)) {
      csrfToken = await resolveCsrfToken(request);
    }

    // Set CSRF header if token is available
    const CSRFHeader = csrfToken ? { [CSRF_HEADER]: csrfToken } : {};

    // Convert body to JSON string if not FormData
    if (!(data.body instanceof FormData)) {
      data.body = JSON.stringify(data.body);
      data.headers = { 'Content-Type': 'application/json', ...data.headers };
    }

    // Set request options
    const options = {
      ...data,
      headers: { ...data.headers, ...CSRFHeader },
    };

    // Add Authorization header if token is provided
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    } else if ('credentials' in Request.prototype) {
      options['credentials'] = 'include';
    }

    // A plugin's own path (`/plugins/<id>/...`) is unversioned: `/api/plugins/<id>/...` (decision 81).
    if (!unversioned && isPluginOwnPath(path)) {
      unversioned = true;
      path = path.replace(/^\/api(?=\/plugins\/)/, '');
    }

    // Callers pass paths relative to /api/v1; see resolveApiUrl for the four cases.
    path = resolveApiUrl(path, {
      apiUrl: API_URL,
      hasEventFetch: !!(request && request.fetch),
      browser,
      prod: !!import.meta.env.PROD,
      unversioned: !!unversioned,
    });

    const bodyHandler = (response) => (blob ? response.blob() : response.text());
    const jsonParseHandler = (json) => {
      try {
        return JSON.parse(json);
      } catch (err) {
        return json;
      }
    };

    const requestCall = (rejectHandler) => {
      const reject = async (err) => {
        console.log(err);
        if (rejectHandler) {
          throw new Error(err);
        }

        if (this.interceptors.errorHandler && handler) {
          this.interceptors.errorHandler(requestCall);
        }

        // A failure without a response is an envelope too: callers read `error.code`.
        return networkErrorBody;
      };

      if (onUploadProgress && browser && data.body instanceof FormData) {
        return new Promise((resolve, rejectFn) => {
          const xhr = new XMLHttpRequest();
          xhr.open(data.method, path);

          if (options.credentials === 'include') {
            xhr.withCredentials = true;
          }

          const headersToSet = { ...options.headers };
          delete headersToSet['Content-Type'];

          Object.keys(headersToSet).forEach((key) => {
            xhr.setRequestHeader(key, headersToSet[key]);
          });

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              onUploadProgress(event.loaded / event.total);
            }
          };

          xhr.onload = async () => {
            try {
              let parsedJson;
              try {
                parsedJson = JSON.parse(xhr.responseText);
              } catch (err) {
                parsedJson = xhr.responseText;
              }

              if (parsedJson?.error?.code === DISABLED_FOR_DEMO) {
                if (browser) {
                  await show("components.toasts.demo-mode-restricted");
                }
                resolve();
                return;
              }

              const finalData = handler ? await handler(parsedJson, rejectFn) : parsedJson;
              resolve(finalData);
            } catch (err) {
              rejectFn(err);
            }
          };

          xhr.onerror = () => rejectFn(NETWORK_ERROR);

          xhr.send(data.body);
        }).catch(reject);
      }

      // Perform fetch request
      const doFetch = () =>
        (request && request.fetch ? request.fetch(path, options) : fetch(path, options)).then(noteStatus);

      // A request that never got a response (fetch rejected) is retried ONCE before the
      // offline splash: browsers reuse a pooled HTTP/3 connection that the peer may have
      // just idled out (Firefox: 30 s), and the request on it fails instantly although the
      // server is fine. A new connection succeeds. Only idempotent methods, so a POST/PUT
      // is never sent twice; HTTP error responses are not retried (fetch resolves them).
      const fetchMethod =
        browser && isIdempotent(data.method)
          ? doFetch().catch((err) => {
              if (err?.name === 'AbortError') throw err;

              return new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS)).then(
                doFetch,
              );
            })
          : doFetch();

      // Handle response
      return fetchMethod
        .then(bodyHandler)
        .then(jsonParseHandler)
        .then(async (parsedJson) => {
          if (parsedJson?.error?.code === DISABLED_FOR_DEMO) {
            if (browser) {
              await show("components.toasts.demo-mode-restricted");
            }
            return;
          }
          return handler ? await handler(parsedJson, reject) : parsedJson;
        })
        .catch(reject);
    };

    return requestCall();
  },
};

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Plugin-scoped client (doc 04 section 9). `createPluginApi('pano-plugin-market').get({ path: '/store/products' })`
 * calls `/api/plugins/pano-plugin-market/store/products`; `.panel.get(...)` calls
 * `/api/plugins/pano-plugin-market/panel/...` (decision 81: plugin endpoints are unversioned). Every method takes the options of the matching `ApiUtil` method.
 * A path that starts with `/api` throws in dev, as it does for `ApiUtil`.
 *
 * @param {string} pluginId the full plugin id (`pano-plugin-market`), never the short namespace
 */
export function createPluginApi(pluginId) {
  if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error(`[pano] createPluginApi needs the full plugin id, got ${JSON.stringify(pluginId)}`);
  }

  const scoped = (prefix) => {
    const wrap = (method) => async (options = {}) =>
      ApiUtil[method]({
        ...options,
        unversioned: true,
        path: `${prefix}${normalizeApiPath(options.path, { prod: !!import.meta.env.PROD })}`,
      });

    return {
      get: wrap('get'),
      post: wrap('post'),
      put: wrap('put'),
      delete: wrap('delete'),
      customRequest: wrap('customRequest'),
    };
  };

  return { ...scoped(`/plugins/${pluginId}`), panel: scoped(`/plugins/${pluginId}/panel`) };
}

export default ApiUtil;

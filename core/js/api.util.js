import { API_URL, CSRF_HEADER } from "$lib/variables.js";
import { get } from "svelte/store";
import { page } from "$app/stores";
import { browser } from "$app/environment";
import { initialized } from "$lib/Store.js";
import { show } from "$lib/components/ToastContainer.svelte";

// Constants for network error handling
export const NETWORK_ERROR = 'NETWORK_ERROR';
export const networkErrorBody = { result: 'error', error: NETWORK_ERROR };

// Function to build query parameters from an object
export function buildQueryParams(params) {
  const queryString = Object.keys(params)
    .filter((key) => params[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  return queryString === '' ? '' : '?' + queryString;
}

const ApiUtil = {
  interceptors: {},

  // GET request
  async get({ path, request, csrfToken, token, blob, handler }) {
    return this.customRequest({
      path,
      request,
      csrfToken,
      token,
      blob,
      handler,
    });
  },

  // POST request
  async post({ path, request, body, headers, csrfToken, token, blob, handler, onUploadProgress }) {
    return this.customRequest({
      path,
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
  async put({ path, request, body, headers, csrfToken, token, blob, handler, onUploadProgress }) {
    return this.customRequest({
      path,
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
  async delete({ path, request, headers, csrfToken, token, blob, handler }) {
    return this.customRequest({
      path,
      data: { method: 'DELETE', headers },
      request,
      csrfToken,
      token,
      blob,
      handler,
    });
  },

  // Custom request handler
  async customRequest({ path, data = {}, request, csrfToken, token, blob, handler, onUploadProgress }) {
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

    // When the app runs behind the Pano backend's reverse proxy, SvelteKit load
    // functions must use relative paths so SSR and CSR fetch URLs match.
    // SvelteKit deduplicates event.fetch calls by URL — if SSR uses an absolute URL
    // (e.g. http://0.0.0.0:8088/api/...) but CSR uses relative (/api/...), the client
    // will re-fetch instead of using the serialized SSR response.
    //
    // For the Pano website (api.panomc.com on Cloudflare Pages), both SSR and CSR
    // already use the same absolute URL, so dedup works naturally — no change needed.
    const hasEventFetch = request && request.fetch;
    const isReverseProxied = !API_URL.includes(".panomc.com");

    if (hasEventFetch && isReverseProxied) {
      // Reverse proxy scenario: use relative path for consistent SSR↔CSR dedup.
      // handleFetch in hooks.server.js will rewrite this to the backend URL during SSR.
      if (!path.startsWith("/api/")) {
        path = `/api/${path.replace("/api/", "")}`;
      }
    } else if ((request && !get(initialized)) || !browser || API_URL.includes(".panomc.com")) {
      let apiUrl = API_URL;

      if (
        !API_URL.includes(".panomc.com") &&
        import.meta.env.PROD &&
        browser &&
        get(initialized)
      ) {
        apiUrl = "/api"
      }

      if (browser && (API_URL.includes("0.0.0.0") || API_URL.includes("127.0.0.1") || API_URL.includes("localhost"))) {
        apiUrl = "/api"
      }

      path = `${apiUrl}/${path.replace('/api/', '')}`;
    }

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

        if (!this.interceptors.errorHandler || !handler) {
          return;
        }

        this.interceptors.errorHandler(requestCall);
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

              if (parsedJson?.error === 'DISABLED_FOR_DEMO') {
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

          xhr.onerror = () => rejectFn('NETWORK_ERROR');

          xhr.send(data.body);
        }).catch(reject);
      }

      // Perform fetch request
      const fetchMethod =
        request && request.fetch ? request.fetch(path, options) : fetch(path, options);

      // Handle response
      return fetchMethod
        .then(bodyHandler)
        .then(jsonParseHandler)
        .then(async (parsedJson) => {
          if (parsedJson?.error === 'DISABLED_FOR_DEMO') {
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

export default ApiUtil;

// Theme host for public controllers (doc 02 section 1, "Theme" host).
//
// A controller reaches the world only through a ControllerHost. This file builds the one the theme
// engine hands to `pano.controllers` (`controllers.setHostFactory(createThemeHost)`):
//
//   createThemeHost({ event? })     browser: one host for the whole page; server: one host per call
//   bindControllerSession(session)  browser only, once per layout: feeds `host.session()` / `host.onSession()`
//
// Nothing request-bound is ever stored on the server. A server host reads the session of the request it
// was created for (`event.locals`, the same data the root layout turns into its `session`), through
// `event`, and nothing else. `bindControllerSession` does nothing outside the browser, so two SSR
// requests that interleave can never see each other's user.

import { get } from "svelte/store";
import { _, locale } from "svelte-i18n";

import { browser } from "$app/environment";

import ApiUtil from "$pano/lib/api.util.js";
import { sanitizeReturnTo } from "./returnTo.util.js";
import { panoApi, routedGoto } from "$pano/lib/PluginAPI.js";
import { route } from "../registry/index.js";

/**
 * @typedef {{ user: object | null, csrfToken: string | null }} HostSession
 */

const GUEST = Object.freeze({ user: null, csrfToken: null });

// The toast container is a component module the host has no other use for, and the layout has already loaded
// it, so it is imported when the first toast is shown.
let showToast = async (...args) => (await import("$pano/lib/components/ToastContainer.svelte")).show(...args);

/** Tests only: replace what shows a toast. */
export function setToastForTests(fn) {
  showToast = fn;
}

// ---------------------------------------------------------------------------
// Browser session binding
// ---------------------------------------------------------------------------

/** @type {HostSession} */
let current = GUEST;
let bound = false;
/** @type {null | (() => void)} */
let stopBinding = null;
/** @type {Set<(session: HostSession) => void>} */
const listeners = new Set();

/** Who the session belongs to: a login or a logout changes it, a refreshed token alone does not. */
function identityOf(user) {
  if (!user) return null;
  return user.id ?? user.username ?? "user";
}

function toHostSession(value) {
  return {
    user: value?.user ?? null,
    csrfToken: value?.csrfToken ?? null,
  };
}

function receive(value) {
  const next = toHostSession(value);
  const changed = !bound || identityOf(next.user) !== identityOf(current.user);

  current = next;
  bound = true;

  if (!changed) return;

  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch (e) {
      console.error("[theme-core] a controller session listener failed", e);
    }
  }
}

/**
 * Feeds the browser host with the layout's session. Call it once where the layout sets its
 * `session` context (browser only). Listeners registered through `host.onSession` run on the first
 * bind and whenever the user logs in or out.
 *
 * @param {{ subscribe: (run: (value: any) => void) => (() => void) } | object | null} session
 *   the layout's `session` store (`{ user, csrfToken, siteInfo }`), or a plain value
 * @returns {() => void} unbind (the layout calls it when it is destroyed)
 */
export function bindControllerSession(session) {
  // Server: nothing is bound, nothing is stored (see the header).
  if (!browser) return () => {};

  stopBinding?.();
  stopBinding = null;

  if (session && typeof session.subscribe === "function") {
    const stop = session.subscribe(receive);
    const unbind = () => {
      stop();
      if (stopBinding === unbind) stopBinding = null;
    };
    stopBinding = unbind;
    return unbind;
  }

  receive(session);
  return () => {};
}

/** Tests only: forget the binding and every listener. */
export function resetControllerSessionForTests() {
  stopBinding?.();
  stopBinding = null;
  current = GUEST;
  bound = false;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

function queryString(query) {
  if (!query || typeof query !== "object") return "";

  const parts = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
  }

  return parts.length ? "?" + parts.join("&") : "";
}

const networkError = () => ({ error: { code: "NETWORK_ERROR" } });

/**
 * Turns what `ApiUtil` hands back into the controller contract: an object, never a rejection;
 * `{ error: { code } }` for a failure. A legacy `{ result: "error", error: "CODE" }` body keeps its
 * other keys and gets the object form of `error`.
 * @param {unknown} body
 */
function toControllerBody(body) {
  if (body === undefined || body === null) return networkError();
  if (typeof Blob !== "undefined" && body instanceof Blob) return body;
  if (typeof body === "string") return body === "" ? {} : { error: { code: "INVALID_RESPONSE" } };
  if (typeof body !== "object") return { error: { code: "INVALID_RESPONSE" } };

  if (typeof body.error === "string") {
    return { ...body, error: { code: body.error } };
  }

  return body;
}

function registerPath(returnTo) {
  const safe = sanitizeReturnTo(returnTo);

  return safe === "/" ? "/register" : `/register?redirect=${encodeURIComponent(safe)}`;
}

function safeStorage(kind) {
  if (!browser) return null;

  try {
    return (kind === "session" ? globalThis.sessionStorage : globalThis.localStorage) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {{ event?: any }} [options]  the SvelteKit load / request event of the server request this
 *   host serves. The browser needs none.
 * @returns {import("@panomc/plugin-kit/controller").ControllerHost}
 */
export function createThemeHost({ event } = {}) {
  /** @returns {HostSession} */
  const session = () => {
    if (browser) return current;
    if (!event) return GUEST;

    return toHostSession(event.locals);
  };

  async function request({ method = "GET", path = "", query, body, headers, blob } = {}) {
    if (!browser && !event) {
      return { error: { code: "NO_REQUEST_EVENT" } };
    }

    const verb = String(method).toUpperCase();
    const hasBody = body !== undefined && body !== null && verb !== "GET" && verb !== "HEAD";
    const data = { method: verb, ...(headers ? { headers } : {}), ...(hasBody ? { body } : {}) };

    try {
      const result = await ApiUtil.customRequest({
        path: String(path) + queryString(query),
        data,
        request: event,
        csrfToken: session().csrfToken ?? undefined,
        blob,
      });

      return toControllerBody(result);
    } catch {
      return networkError();
    }
  }

  return {
    baseUrl: browser ? (globalThis.location?.origin ?? "") : (event?.url?.origin ?? ""),
    browser,
    request,
    session,
    locale: () => get(locale) ?? undefined,
    onSession(fn) {
      if (!browser || typeof fn !== "function") return () => {};

      listeners.add(fn);

      return () => {
        listeners.delete(fn);
      };
    },
    t: (key, values) => get(_)(key, values ? { values } : undefined),
    toast(key, options) {
      if (!browser) return;

      Promise.resolve(showToast(key, { ...(options?.values ?? {}) }, undefined, { variant: options?.variant })).catch(
        (e) => console.error("[theme-core] a controller toast failed", e),
      );
    },
    storage: safeStorage,
    now: () => Date.now(),
    navigate(url, options) {
      if (!browser) return;

      routedGoto(url, options?.replace ? { replaceState: true } : undefined);
    },
    feature: (name) => panoApi.features.has(name),
    loginUrl: (returnTo) => panoApi.auth.loginUrl(returnTo),
    registerUrl: (returnTo) => route(registerPath(returnTo)),
  };
}

/**
 * What `controllers.setHostFactory` takes. The controller registry calls its factory with the SvelteKit
 * event of the request being served (`controllers.load(name, { event })`), or with nothing in the browser;
 * `createThemeHost` takes `{ event }`. Registering `createThemeHost` itself would hand it the event as the
 * options object, so every server-side controller call got `NO_REQUEST_EVENT`.
 * @param {any} [event]
 */
export function themeHostFactory(event) {
  return createThemeHost({ event });
}

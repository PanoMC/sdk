/**
 * Theme config + view registry.
 *
 * A theme declares overrides in its theme.config.js; the generated root layout
 * shim calls setThemeConfig() as a module side effect, so the registry is
 * populated on both server and client before any load function runs.
 *
 * Core code never imports a theme's view directly — it resolves through
 * resolveView(name, defaultThunk):
 *   - theme override registered → the theme's component wins
 *   - otherwise → core's default view (code-split via the thunk)
 *
 * If a theme override fails to load at runtime, the default view is used and
 * the failure is logged instead of crashing the page (graceful degradation —
 * the site keeps working while the theme author catches up with a core major).
 */

let themeConfig = {};

export function setThemeConfig(config) {
  themeConfig = config ?? {};
}

export function getThemeConfig() {
  return themeConfig;
}

/** Theme-declared extensions to the theme-settings schema (P2). */
export function getSettingsSchemaExtension() {
  return themeConfig.settingsSchema ?? null;
}

import { dev } from "$app/environment";

const overrideCache = new Map();

/**
 * @param {string} name  stable view id, e.g. "LoginView" — part of the theme contract
 * @param {() => Promise<any>} defaultThunk  core's default view module thunk
 * @returns {Promise<any>} the Svelte component to render
 */
export async function resolveView(name, defaultThunk) {
  const override = themeConfig.views?.[name];

  if (override) {
    // Never cache in dev: the cache would pin the module instance from the
    // first request, so view-file edits (and core fixes) would silently not
    // apply until a full dev-server restart. Vite already dedupes and
    // HMR-invalidates the underlying import() calls.
    if (dev) {
      return Promise.resolve(
        typeof override === "function" ? override() : override,
      ).then(
        (mod) => mod?.default ?? mod,
        (e) => {
          console.error(
            `[theme-core] view override '${name}' failed to load; falling back to the default view`,
            e,
          );
          return defaultThunk().then((m) => m?.default ?? m);
        },
      );
    }

    let cached = overrideCache.get(name);
    if (!cached) {
      cached = Promise.resolve(
        typeof override === "function" ? override() : override,
      ).then(
        (mod) => mod?.default ?? mod,
        (e) => {
          console.error(
            `[theme-core] view override '${name}' failed to load; falling back to the default view`,
            e,
          );
          overrideCache.delete(name);
          return defaultThunk().then((m) => m?.default ?? m);
        },
      );
      overrideCache.set(name, cached);
    }
    return cached;
  }

  return defaultThunk().then((m) => m?.default ?? m);
}

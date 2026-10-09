import { getContext } from 'svelte';
import FallbackScope from './FallbackScope.svelte';

/**
 * The theme side of `context.views`: `getOverride` / `getDefault` as the registry has them, and the doc 03 section 4.4
 * `wrap` (FallbackScope pattern) when `fallback` is on. `log` receives one record per wrap call.
 *
 * @param {{ overrides?: Record<string, Function>, defaults?: Record<string, Function>, fallback?: boolean, log?: object[] }} options
 */
export function createViews({ overrides = {}, defaults = {}, fallback = false, log = [] } = {}) {
  return {
    getOverride: (name) => overrides[name] ?? null,
    getDefault: (name) => defaults[name] ?? null,
    wrap(name, Component, source) {
      if (!fallback) return Component;

      const ns = name.includes(':') ? name.split(':')[0] : 'pano';
      let inside = undefined;
      let threw = false;

      try {
        inside = getContext('pano:fb');
      } catch {
        // No theme component is on the stack (a root that never touched context): treat as outside every scope.
        threw = true;
      }

      let mode = null;

      if (source === 'default') {
        if (inside !== ns) mode = 'fallback';
      } else if (typeof inside === 'string') {
        mode = 'stop';
      }

      log.push({ name, source, inside: inside === undefined ? undefined : inside, threw, mode });

      if (!mode) return Component;

      return (anchorOrPayload, props) => FallbackScope(anchorOrPayload, { Component, ns, mode, props });
    },
  };
}

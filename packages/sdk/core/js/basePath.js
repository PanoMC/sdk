/**
 * The app's base path: "" for a theme, "/panel" for panel-ui.
 *
 * SvelteKit 3 removed `base` from `$app/paths`. The engine's vite config (`createViteConfig`) defines
 * `__PANO_BASE_PATH__` at build time with the value it gives SvelteKit as `paths.base`, so this is always the absolute
 * path, on the server too (Pano serves every UI at a fixed path, so an absolute and a relative link point at the same
 * place).
 */
/* global __PANO_BASE_PATH__ */
export const base = typeof __PANO_BASE_PATH__ === "string" ? __PANO_BASE_PATH__ : "";

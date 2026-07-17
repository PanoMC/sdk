// @panomc/theme-core — package root.
//
// Deep-import surface (via the $pano vite alias inside themes, or the exports
// map from node contexts):
//   $pano/kit/*        hooks factories, config factories, specifiers, license runtime
//   $pano/lib/*        the engine: services, ui-logics, components, layouts, pages
//   $pano/routes/*     route-level building blocks ((plugin-ui) host, +server handlers)
//   @panomc/theme-core/registry   theme config + view registry
export {
  setThemeConfig,
  getThemeConfig,
  getSettingsSchemaExtension,
  resolveView,
} from "./registry/index.js";
export { RUNTIME_SPECIFIERS } from "./kit/specifiers.js";

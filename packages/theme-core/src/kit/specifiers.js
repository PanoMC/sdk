// The plugin runtime module surface lives in @panomc/sdk (`@panomc/sdk/runtime-specifiers`), the one package every consumer
// (engine, plugin kit, widget host) already depends on. This file keeps the engine's `$pano/kit/specifiers` import path.
export { RUNTIME_SPECIFIERS, SVELTE_SPECIFIERS, SDK_SPECIFIERS } from "@panomc/sdk/runtime-specifiers";

/**
 * THE single source of truth for the plugin runtime module surface (owned by @panomc/sdk: the theme engine, the plugin
 * kit and the widget host all depend on the sdk, so none of them has to depend on another to read this table).
 *
 * Every bare specifier a plugin build may import is listed here, mapped to the
 * stable shim file the theme serves under /runtime/. This list drives:
 *   - bin/generate-runtime-shims.js  (emits static/runtime/<shimFile> per entry)
 *   - createThemeHooks()             (the <script type="importmap"> in every page)
 *   - the runtime registry in kit/hooks-client.js (which must keep literal
 *     import() calls for bundler static analysis — its keys are asserted
 *     against this list in dev so the two can never drift)
 *
 * FROZEN CONTRACT: shipped plugin client builds resolve these exact names via
 * the import map forever. Never rename or remove an entry; additions are a
 * core minor version.
 */
export const RUNTIME_SPECIFIERS = {
  "svelte": "svelte/index.js",
  "svelte/animate": "svelte/animate.js",
  "svelte/easing": "svelte/easing.js",
  "svelte/motion": "svelte/motion.js",
  "svelte/store": "svelte/store.js",
  "svelte/transition": "svelte/transition.js",
  "svelte/internal": "svelte/internal.js",
  "svelte/internal/client": "svelte/internal-client.js",
  "svelte/internal/disclose-version": "svelte/internal-disclose-version.js",
  "svelte/internal/flags/legacy": "svelte/internal-flags-legacy.js",
  "svelte/internal/flags/async": "svelte/internal-flags-async.js",
  "svelte/internal/flags/tracing": "svelte/internal-flags-tracing.js",
  "svelte/legacy": "svelte/legacy.js",
  "svelte/events": "svelte/events.js",
  "svelte/attachments": "svelte/attachments.js",
  "svelte/reactivity": "svelte/reactivity.js",
  "svelte/reactivity/window": "svelte/reactivity-window.js",
  "svelte-i18n": "svelte/i18n.js",
  "@panomc/sdk": "sdk/index.js",
  "@panomc/sdk/components/theme": "sdk/components-theme.js",
  "@panomc/sdk/components/panel": "sdk/components-panel.js",
  "@panomc/sdk/toasts": "sdk/toasts.js",
  "@panomc/sdk/utils/api": "sdk/utils-api.js",
  "@panomc/sdk/utils/auth": "sdk/utils-auth.js",
  "@panomc/sdk/utils/tooltip": "sdk/utils-tooltip.js",
  "@panomc/sdk/utils/language": "sdk/utils-language.js",
  "@panomc/sdk/utils/component": "sdk/utils-component.js",
  "@panomc/sdk/utils/text": "sdk/utils-text.js",
  "@panomc/sdk/variables": "sdk/variables.js",
  "@panomc/sdk/svelte": "sdk/svelte.js",
  "@panomc/sdk/internal": "sdk/internal.js",
  "@panomc/sdk/views": "sdk/views.js",
  "@panomc/sdk/controllers": "sdk/controllers.js",
  "@panomc/sdk/utils/route": "sdk/utils-route.js",
};

/** Entries whose shim re-exports come from the svelte/svelte-i18n packages. */
export const SVELTE_SPECIFIERS = Object.fromEntries(
  Object.entries(RUNTIME_SPECIFIERS).filter(([, file]) =>
    file.startsWith("svelte/"),
  ),
);

/** Entries whose shim re-exports come from @panomc/sdk. */
export const SDK_SPECIFIERS = Object.fromEntries(
  Object.entries(RUNTIME_SPECIFIERS).filter(([, file]) =>
    file.startsWith("sdk/"),
  ),
);

/** Specifier -> file of the widget runtime directory (`dist/runtime/` of @panomc/widget-host), for every `svelte*` name and every `@panomc/sdk` facade. */
export const RUNTIME_FILES = Object.freeze(
  Object.fromEntries(
    Object.entries(RUNTIME_SPECIFIERS).map(([specifier, file]) => {
      if (specifier === "svelte-i18n") return [specifier, "svelte-i18n.js"];
      if (file.startsWith("sdk/")) return [specifier, `host/${file.slice("sdk/".length)}`];
      return [specifier, file];
    }),
  ),
);

/**
 * Relative URL of a runtime file seen from a widget module that sits in `.../_/ui/widgets/` of a plugin
 * (`/api/v1/plugins/<id>/_/ui/widgets/` -> five levels up is `/api/v1/`, doc 06 section 3.3).
 * @param {string} specifier
 */
export function widgetImportPath(specifier) {
  const file = RUNTIME_FILES[specifier];
  if (!file) throw new Error(`no runtime file for ${specifier}`);
  return `../../../../../widgets/runtime/${file}`;
}

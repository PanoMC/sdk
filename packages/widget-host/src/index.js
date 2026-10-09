// `@panomc/widget-host` (doc 06 section 3.2): the `@panomc/sdk` facade for a widget page, plus the wrapper and the page API.
// The module files beside this one stand in for the other SDK specifiers; `SPECIFIER_MODULES` says which is which.
import { createViewProxy } from './views.js';

export { getPanoContext, setPanoContext } from './context.js';
export { PanoPlugin } from './plugin.js';
export { viewComponent } from './component.js';

export { defineWidget } from './define.js';
export { configure, getConfig, resolveUrl } from './config.js';
export { ensureSession, getSession, setSession } from './session.js';
export { ensureLanguage, loadPluginTranslations } from './language.js';
export { loadPluginControllers, createWidgetHost, createLoadMemo, clearLoadMemo, LOAD_MEMO_MS } from './controllers.js';
export { WidgetError } from './runtime.js';
export { createViewProxy };

/**
 * SDK specifier -> file in this package that replaces it in a widget bundle (the aliases of the widget build target).
 * Every key of `@panomc/sdk`'s `exports` that is a facade is listed; `@panomc/sdk/build/*` and `core/*` are not facades.
 */
export const SPECIFIER_MODULES = Object.freeze({
  '@panomc/sdk': 'index.js',
  '@panomc/sdk/svelte': 'svelte.js',
  '@panomc/sdk/views': 'views.js',
  '@panomc/sdk/controllers': 'controllers.js',
  '@panomc/sdk/toasts': 'toasts.js',
  '@panomc/sdk/internal': 'internal.js',
  '@panomc/sdk/variables': 'variables.js',
  '@panomc/sdk/components/theme': 'components/index.js',
  '@panomc/sdk/components/panel': 'components/panel.js',
  '@panomc/sdk/utils/api': 'api.js',
  '@panomc/sdk/utils/auth': 'auth.js',
  '@panomc/sdk/utils/tooltip': 'tooltip.js',
  '@panomc/sdk/utils/language': 'language.js',
  '@panomc/sdk/utils/component': 'component.js',
  '@panomc/sdk/utils/text': 'text.js',
  '@panomc/sdk/utils/route': 'route.js',
});

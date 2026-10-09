/**
 * @typedef {Object} Pano
 * @property {boolean} isPanel
 * @property {any} page - SvelteKit page store
 * @property {string} base
 * @property {any} navigating - SvelteKit navigating store
 * @property {boolean} browser
 * @property {Object} ui
 * @property {Object} ui.page
 * @property {function({path: string, component: any, layout?: any, resetLayout?: boolean}): void} ui.page.register
 * @property {Object} ui.nav
 * @property {Object} ui.nav.site
 * @property {function(function(any[]): any[]): void} ui.nav.site.editNavLinks
 * @property {Object} utils
 * @property {Object} utils.api
 * @property {any} utils.api.ApiUtil
 * @property {function(Record<string, any>): string} utils.api.buildQueryParams
 * @property {string} utils.api.NETWORK_ERROR
 * @property {function(string): any} utils.api.createPluginApi - `createPluginApi(pluginId)` (the full plugin id): a client scoped
 *   to `/api/plugins/<pluginId>/...` (unversioned; `.get`, `.post`, ... and `.panel.*`); same options and same error envelope as `ApiUtil`
 * @property {{ error: { code: string, message?: string, details?: any, fields?: Record<string, string> } }} utils.api.networkErrorBody
 *   The body of a failed call, also the one a network failure produces (code `NETWORK_ERROR`):
 *   `{ error: { code, message?, details?, fields? } }`. Test `body.error?.code`; a success body has no `error` key.
 * @property {Object} utils.language
 * @property {any} utils.language.init
 * @property {any} utils.language._ - i18n store or function
 * @property {Object} utils.tooltip
 * @property {any} utils.tooltip.tooltip
 * @property {any} utils.toast
 * @property {Record<string, any>} components
 * @property {Record<string, any>} variables
 */

/**
 * @typedef {Object} PanoPluginContext
 * @property {any} context
 * @property {function(any): void} set
 * @property {function(function(any): void): function(): void} subscribe
 * @property {function(): void} [destroy]
 */

export {};

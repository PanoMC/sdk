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
 * @property {Object} utils.api.networkErrorBody
 * @property {string} utils.api.networkErrorBody.result
 * @property {string} utils.api.networkErrorBody.error
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

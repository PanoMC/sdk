// `@panomc/sdk/components/theme` outside a theme (doc 06 section 3.2): plain Svelte copies of the theme components.
import Empty from './empty.js';

export { default as PlayerHead } from './PlayerHead.svelte';
export { default as NoContent } from './NoContent.svelte';
export { default as Date } from './Date.svelte';
export { default as Toast } from './Toast.svelte';
export { default as PageTitle } from './PageTitle.svelte';
export { default as PageActions } from './PageActions.svelte';
export { default as Pagination } from './Pagination.svelte';

/** Outside a theme there is no registry: blocks and slots are empty. */
export const PluginBlock = Empty;
export const PluginSlot = Empty;

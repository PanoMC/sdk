// `@panomc/sdk/components/panel` in a widget: the panel is not part of a widget page. Shared names are the real components, the rest render nothing.
import Empty from './empty.js';

export { default as NoContent } from './NoContent.svelte';
export { default as Date } from './Date.svelte';
export { default as Toast } from './Toast.svelte';
export { default as PageActions } from './PageActions.svelte';
export { default as Pagination } from './Pagination.svelte';

export const Editor = Empty;
export const DragAndDropZone = Empty;
export const PageLoading = Empty;
export const PageLoader = Empty;
export const PageNavItem = Empty;
export const PageNav = Empty;
export const CardFilters = Empty;
export const CardFiltersItem = Empty;
export const CardHeader = Empty;
export const SearchInput = Empty;

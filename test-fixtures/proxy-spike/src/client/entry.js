// The client build: one Svelte for plugin and theme (the browser shares it through the import map).
export { mount, hydrate, unmount } from 'svelte';
export * from '../plugin/index.js';
export * from '../theme/entry.js';

import { load as loadLayout } from './Layout.svelte';

/**
 * @type {import('@sveltejs/kit').PageLoad}
 */
export async function load(event) {
  return loadLayout(event);
}

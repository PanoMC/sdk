import { load as loadPage } from './Page.svelte';

/**
 * @type {import('@sveltejs/kit').PageLoad}
 */
export async function load(event) {
  return loadPage(event);
}

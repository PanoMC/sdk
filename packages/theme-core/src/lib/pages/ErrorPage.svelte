<svelte:component this={data?.View ?? View} {data} {page} />

<script context="module">
  import { resolveView } from "$pano/registry/index.js";

  // This page is wired as +error.svelte by the shim, and SvelteKit never runs
  // a load function for error pages — so unlike other controllers the view
  // cannot travel in `data`. Resolution starts at module scope (the theme
  // config is registered as a root-layout module side effect, before any
  // route module renders) and the settled component is cached so SSR can pick
  // it up synchronously on the very first read.
  const viewPromise = resolveView(
    "ErrorView",
    () => import("../views/ErrorView.svelte"),
  );

  let resolvedView;
  viewPromise.then((view) => (resolvedView = view));

  /**
   * Never invoked while this page is wired as +error.svelte (the shim does not
   * re-export it and SvelteKit does not run load for error pages); kept so the
   * controller keeps the shared controller contract if it is ever routed as a
   * regular page.
   * @type {import("@sveltejs/kit").Load}
   */
  export async function load(event) {
    const parentData = await event.parent();

    return { ...parentData, View: await viewPromise };
  }
</script>

<script>
  import { page } from "$app/state";

  export let data = undefined;

  let View = resolvedView;
  if (!View) viewPromise.then((view) => (View = view));
</script>

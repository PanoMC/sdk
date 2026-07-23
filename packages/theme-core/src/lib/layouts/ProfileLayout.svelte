<svelte:component this={layoutView} data={viewData}><slot /></svelte:component>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/layout-logics/ProfileLayoutLogics";
  import { resolveView } from "$pano/registry/index.js";

  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "ProfileLayoutView",
      () => import("../views/ProfileLayoutView.svelte"),
    );
    const data = await processLoad(event);
    return { ...data, profileLayoutView: await viewPromise };
  }
</script>

<script>
  import { page } from "$app/stores";
  export let data = undefined;

  // Layout view resolution: every layout uses a UNIQUE data key (profileLayoutView)
  // because SvelteKit merges all layout+page load results into one bag —
  // a generic `View` key gets clobbered by deeper layouts/pages.
  $: viewData = data ?? $page.data;
  $: layoutView = viewData?.profileLayoutView ?? $page.data.profileLayoutView;
</script>

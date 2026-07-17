<svelte:component this={data.View} {data}><slot /></svelte:component>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/layout-logics/TicketsLayoutLogics";
  import { resolveView } from "$pano/registry/index.js";

  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "TicketsLayoutView",
      () => import("../views/TicketsLayoutView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  export let data;
</script>

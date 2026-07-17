<svelte:component this={data.View} {data}><slot /></svelte:component>

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
    return { ...data, View: await viewPromise };
  }
</script>

<script>
  export let data;
</script>

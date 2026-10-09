<svelte:component this={data.View} {data} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/PlayerDetailPageLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "PlayerDetailView", () => import("../views/PlayerDetailView.svelte"))) };
  }
</script>

<script>
  import { getContext } from "svelte";

  export let data;
</script>

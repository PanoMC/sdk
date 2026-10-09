<svelte:component this={data.View} {data} {contentItems} {cardRowItems} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/ProfilePageLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "ProfileView", () => import("../../views/ProfileView.svelte"))) };
  }
</script>

<script>
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  const contentItems = panoApiClient.ui.profile.content.get();
  const cardRowItems = panoApiClient.ui.profile.cardRows.get();
</script>

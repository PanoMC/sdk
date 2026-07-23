<svelte:component this={data.View} {data} {contentItems} {cardRowItems} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/ProfilePageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "ProfileView",
      () => import("../../views/ProfileView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  const contentItems = panoApiClient.ui.profile.content.get();
  const cardRowItems = panoApiClient.ui.profile.cardRows.get();
</script>

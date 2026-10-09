<svelte:component this={data.View} {data} {session} {items} {optionItems} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/SupportPageLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "SupportView", () => import("../views/SupportView.svelte"))) };
  }
</script>

<script>
  import { getContext } from "svelte";

  import { panoApi } from "$pano/lib/PluginAPI";

  export let data;

  const session = getContext("session");

  const items = panoApi.ui.view.get("support-content");
  const optionItems = panoApi.ui.view.get("support-options");
</script>

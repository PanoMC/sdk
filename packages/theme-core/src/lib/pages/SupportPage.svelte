<svelte:component this={data.View} {data} {session} {items} {optionItems} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/SupportPageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "SupportView",
      () => import("../views/SupportView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
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

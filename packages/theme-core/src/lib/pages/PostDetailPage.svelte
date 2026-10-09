<svelte:component this={data.View} {data} {themeSettings} {avatarVersion} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/PostDetailPageLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const data = await processLoad(event);

    return { ...data, ...(await loadView(event, "PostDetailView", () => import("../views/PostDetailView.svelte"))) };
  }
</script>

<script>
  import { getContext } from "svelte";
  import { avatarVersion } from "$pano/lib/Store";

  import { truncate } from "$pano/lib/string.util";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let data;

  const themeSettings = getContext("themeSettings");
  const session = getContext("session");
</script>

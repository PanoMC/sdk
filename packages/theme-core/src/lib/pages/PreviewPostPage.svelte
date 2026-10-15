<svelte:component
  this={pageData.View}
  data={pageData}
  post={post ?? pageData.post}
  {themeSettings}
  {avatarVersion} />

<script context="module">
  /**
   * @type {import("@sveltejs/kit").Load}
   */
  import { processLoad } from "$pano/lib/ui-logics/page-logics/PreviewPostPageLogics";
  import { loadView } from "$pano/registry/index.js";

  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "PreviewPostView", () => import("../views/PreviewPostView.svelte"))) };
  }
</script>

<script>
  import { getContext } from "svelte";
  import { avatarVersion } from "$pano/lib/Store";

  import { page } from "@panomc/sdk/core/js/appStores.js";

  // The route generated for this page hands over `post` only (older syncs) or `data` (newer ones).
  // Without `data` the view could not be found (`data.View` of undefined) and the preview answered
  // 500 for everyone who was allowed to see it, so the page's own load data is the fallback.
  export let data = undefined;
  export let post = undefined;

  $: pageData = data ?? $page.data;

  const themeSettings = getContext("themeSettings");
</script>

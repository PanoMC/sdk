<svelte:component
  this={data.View}
  {data}
  {post}
  {themeSettings}
  {avatarVersion} />

<script context="module">
  /**
   * @type {import("@sveltejs/kit").Load}
   */
  import { processLoad } from "$pano/lib/ui-logics/page-logics/PreviewPostPageLogics";
  import { resolveView } from "$pano/registry/index.js";

  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "PreviewPostView",
      () => import("../views/PreviewPostView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { getContext } from "svelte";
  import { avatarVersion } from "$pano/lib/Store";

  export let data;
  export let post;

  const themeSettings = getContext("themeSettings");
</script>

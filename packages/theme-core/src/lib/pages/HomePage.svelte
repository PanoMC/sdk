<svelte:component this={data.View} {data} {themeSettings} {onPageClick} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/HomePageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "HomeView",
      () => import("../views/HomeView.svelte"),
    );

    const data = await processLoad(event);

    return { ...data, View: await viewPromise };
  }
</script>

<script>
  import { getContext } from "svelte";

  import { onPageClick } from "$pano/lib/ui-logics/page-logics/HomePageLogics";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let data;

  const themeSettings = getContext("themeSettings");
</script>

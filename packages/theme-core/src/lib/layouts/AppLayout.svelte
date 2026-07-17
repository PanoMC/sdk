<svelte:component this={data.View} {data} {session} {pageTitle} {getTitle}>
  <slot />
</svelte:component>

<script context="module">
  import { processLoad, processServerLoad } from "$pano/lib/ui-logics/layout-logics/AppLayoutLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import("@sveltejs/kit").LayoutServerLoad}
   */
  export async function loadServer(event) {
    return await processServerLoad(event);
  }

  /**
   * @type {import("@sveltejs/kit").LayoutLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "AppLayoutView",
      () => import("../views/AppLayoutView.svelte"),
    );

    const data = await processLoad(event);

    return { ...data, View: await viewPromise };
  }
</script>

<script>
  import { _ } from "svelte-i18n";
  import { init } from "$pano/lib/ui-logics/layout-logics/AppLayoutLogics";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { avatarVersion } from "$pano/lib/Store.js";

  export let data;

  const { session, pageTitle } = init(data);

  function getTitle(pt, siteName) {
    if (!pt) return siteName;
    const titleStr = typeof pt === "string"
      ? $_(pt)
      : (pt.title ? $_(pt.title, { values: pt.titleValues || {} }) : "");
    return `${titleStr} \u2014 ${siteName}`;
  }
</script>

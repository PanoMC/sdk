<svelte:component this={View} data={viewData} {themeSettings} {session}>
  <slot />
</svelte:component>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/layout-logics/MainLayoutLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import("@sveltejs/kit").LayoutLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "MainLayoutView",
      () => import("../views/MainLayoutView.svelte"),
    );

    const data = await processLoad(event);

    // `mainLayoutView` alias: this load's result is merged into the ROOT
    // layout data (routes/root-layout-load.js), and RootLayout mounts this
    // layout WITHOUT a data prop, so the instance script falls back to
    // $page.data — where the generic `View` key is clobbered by every split
    // page's own view. The unique key survives that merge.
    const View = await viewPromise;
    return { ...data, View, mainLayoutView: View };
  }
</script>

<script>
  import { getContext } from "svelte";
  import { page } from "$app/stores";

  // RootLayout renders <MainLayout><slot /></MainLayout> with no data prop;
  // fall back to the root-merged $page.data (see the alias note in load above).
  export let data = undefined;

  const themeSettings = getContext("themeSettings");
  const session = getContext("session");

  $: View = data?.View ?? $page.data.mainLayoutView;
  $: viewData = data ?? $page.data;
</script>

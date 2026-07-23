<svelte:component this={layoutView} data={viewData} {hidden}><slot /></svelte:component>

<script context="module">
  import { processLoadServer, processLoad } from "$pano/lib/ui-logics/layout-logics/ThemeSettingsLayoutLogics";
  import { resolveView } from "$pano/registry/index.js";

  export async function loadServer(event) {
    return await processLoadServer(event);
  }

  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "ThemeSettingsLayoutView",
      () => import("../views/ThemeSettingsLayoutView.svelte"),
    );
    const data = await processLoad(event);
    return { ...data, themeSettingsLayoutView: await viewPromise };
  }
</script>

<script>
  import { page } from "$app/stores";
  import { init } from "$pano/lib/ui-logics/layout-logics/ThemeSettingsLayoutLogics";

  export let data = undefined;

  const hidden = init();

  // Layout view resolution: every layout uses a UNIQUE data key (themeSettingsLayoutView)
  // because SvelteKit merges all layout+page load results into one bag —
  // a generic `View` key gets clobbered by deeper layouts/pages.
  $: viewData = data ?? $page.data;
  $: layoutView = viewData?.themeSettingsLayoutView ?? $page.data.themeSettingsLayoutView;
</script>

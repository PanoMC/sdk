<svelte:component this={data.View} {data} {hidden}><slot /></svelte:component>

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
    return { ...data, View: await viewPromise };
  }
</script>

<script>
  import { init } from "$pano/lib/ui-logics/layout-logics/ThemeSettingsLayoutLogics";

  export let data;

  const hidden = init();
</script>

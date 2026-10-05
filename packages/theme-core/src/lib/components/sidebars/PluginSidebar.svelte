<Sidebar {side}>
  <div class="vstack gap-3">
    {#each items as item (item.id)}
      <ViewComponent component={item.component} {...item.props} />
    {/each}
  </div>
</Sidebar>

<script>
  import { fromStore } from "svelte/store";

  import { panoApi } from "$pano/lib/PluginAPI";
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  // Generic engine sidebar for plugin pages (`sidebar: "plugin:<sidebarId>"`): renders the items
  // other plugins contributed with `pano.ui.sidebar.register({ sidebarId, id, component, priority })`.
  let { side = "right", sidebarId } = $props();

  const items = $derived(fromStore(panoApi.ui.sidebar.get(sidebarId)).current ?? []);
</script>

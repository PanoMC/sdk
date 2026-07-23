<Sidebar side="{side}">
  <div class="vstack gap-3">
    {#each $items as item (item.id)}
      {#if item.id === 'online-admins'}
        <!-- Online Admins Snippet -->
        <OnlineAdmins onlineAdmins="{$data.onlineAdmins}" />
      {:else}
        <!-- External Component -->
        <ViewComponent component={item.component} data={$data} {...item.props} />
      {/if}
    {/each}
  </div>
</Sidebar>

<script context="module">
  import ApiUtil from "$pano/lib/api.util.js";
  import { writable } from "svelte/store";
  import { panoApi } from "$pano/lib/PluginAPI";
  import { executeSidebarLoad } from "$pano/lib/PluginAPI";

  const data = writable({
    onlineAdmins: [],
  });

  export const load = async (event) => {
    /* Register Defaults */
    panoApi.ui.sidebar.register({
      sidebarId: "support",
      id: "online-admins",
      component: "local:online-admins",
      priority: 100,
    });

    // Execute sidebar load and resolve components for SSR
    await executeSidebarLoad('support', event);

    data.set(
      await ApiUtil.get({
        path: "/api/sidebars/support",
        request: event,
      }),
    );
  };
</script>

<script>
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import OnlineAdmins from "$pano/lib/components/OnlineAdmins.svelte";

  export let side;

  const items = panoApi.ui.sidebar.get("support");
</script>

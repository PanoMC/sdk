<!--
  Controller of the engine's <SupportSidebar>. The markup lives in views/parts/SupportSidebar.svelte; a
  theme may replace it with the "SupportSidebar" entry of theme.config.js views (see skin-contract.json
  for the props).
-->
<svelte:component
  this={getOverride("SupportSidebar") ?? SupportSidebarView}
  {side}
  {items}
  {data} />

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

    // The wire shape is { items: string[] } (decision 80); the view contract keeps { onlineAdmins }.
    const response = await ApiUtil.get({
      path: "/sidebars/support",
      request: event,
    });

    data.set({ onlineAdmins: Array.isArray(response?.items) ? response.items : [] });
  };
</script>

<script>
  import { getOverride } from "$pano/registry/index.js";
  import SupportSidebarView from "$pano/lib/views/parts/SupportSidebar.svelte";

  export let side;

  const items = panoApi.ui.sidebar.get("support");
</script>

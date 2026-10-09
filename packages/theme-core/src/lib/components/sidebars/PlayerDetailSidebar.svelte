<!--
  Controller of the engine's <PlayerDetailSidebar>. The markup lives in views/parts/PlayerDetailSidebar.svelte; a
  theme may replace it with the "PlayerDetailSidebar" entry of theme.config.js views (see skin-contract.json
  for the props).
-->
<svelte:component
  this={getOverride("PlayerDetailSidebar") ?? PlayerDetailSidebarView}
  {side}
  {items}
  {data}
  {checkTime} />

<script context="module">
  import ApiUtil from "$pano/lib/api.util.js";
  import { writable } from "svelte/store";
  import { panoApi } from "$pano/lib/PluginAPI";
  import { executeSidebarLoad } from "$pano/lib/PluginAPI";

  const data = writable({
    username: "",
    lastActivityTime: 0,
    inGame: false,
    permissionGroupName: "",
    banned: false,
  });

  export const load = async (event) => {
    /* Register Defaults */
    panoApi.ui.sidebar.register({
      sidebarId: "player-detail",
      id: "player-info",
      component: "local:player-info",
      priority: 100,
    });

    // Execute sidebar load and resolve components for SSR
    await executeSidebarLoad('player-detail', event);

    data.set({
      ...(await ApiUtil.get({
        path: `/sidebars/profile/${event.params.player}`,
        request: event,
      })),
      username: event.params.player,
    });
  };

  String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
  };
</script>

<script>
  import { onDestroy, onMount } from "svelte";

  import { getOverride } from "$pano/registry/index.js";
  import PlayerDetailSidebarView from "$pano/lib/views/parts/PlayerDetailSidebar.svelte";

  let checkTime = 0;
  let interval;

  export let side;

  onMount(() => {
    interval = setInterval(() => {
      checkTime += 1;
    }, 1000);
  });

  onDestroy(() => {
    clearInterval(interval);
  });

  const items = panoApi.ui.sidebar.get("player-detail");
</script>

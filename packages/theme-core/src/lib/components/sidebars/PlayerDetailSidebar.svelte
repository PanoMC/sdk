<Sidebar side={side}>
  <div class="vstack gap-3">
    {#each $items as item (item.id)}
      {#if item.id === 'player-info'}
        <!-- Player Info Snippet -->
        <div class="card border-0 square-card-desktop">
          <div class="card-body vstack gap-3">
            <PlayerHead
              username={$data.username}
              inGame={$data.inGame}
              banned={$data.banned}
              lastActivityTime={$data.lastActivityTime}
              checkTime={checkTime}
              width="64"
              height="64" />

            <PageTitle title={$data.username} breadcrumb={false} />

            <div class="text-center">
              <PlayerStatusBadge
                banned={$data.banned}
                lastActivityTime={$data.lastActivityTime}
                inGame={$data.inGame}
                checkTime={checkTime} />
            </div>
            <div class="text-center">
              <PlayerPermissionBadge
                permissionGroupName={$data.permissionGroupName} />
            </div>
          </div>
        </div>
      {:else}
        <!-- External Component -->
        <ViewComponent component={item.component} data={$data} checkTime={checkTime} {...item.props} />
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
        path: `/api/sidebars/profile/${event.params.player}`,
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
  import { _ } from "svelte-i18n";

  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import PlayerPermissionBadge from "$pano/lib/components/PlayerPermissionBadge.svelte";
  import PlayerStatusBadge from "$pano/lib/components/PlayerStatusBadge.svelte";
  import PlayerHead from "$pano/lib/components/PlayerHead.svelte";
  import PageTitle from "../PageTitle.svelte";

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

<style>
  @media (min-width: 992px) {
    .square-card-desktop {
      aspect-ratio: 1 / 1;
      display: flex;
      flex-direction: column;
    }

    .square-card-desktop :global(.card-body) {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
  }
</style>

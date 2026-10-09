<!--
  Default markup of the engine's <PlayerDetailSidebar> (registry name "PlayerDetailSidebar", contract 1):
  the player card beside a player's page. The controller (components/sidebars/PlayerDetailSidebar.svelte)
  owns the data, the item list and the clock.

  Props:
    side       "left" | "right" - which side of the content the column sits on
    items      store of { id, component, props } - the sidebar items, plugin items included;
               unknown ids are rendered with <ViewComponent> (the place plugins inject)
    data       store of { username, lastActivityTime, inGame, permissionGroupName, banned }
    checkTime  number - ticks every second, re-renders the "last seen" texts
-->
<Sidebar side={side}>
  <div class="vstack gap-3">
    {#each $items as item (item.id)}
      {#if item.id === 'player-info'}
        <!-- Player Info Snippet -->
        <div class="card border-0 square-card-desktop">
          <div class="pano-player-detail-sidebar__body card-body vstack gap-3">
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

<script>
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import PlayerPermissionBadge from "$pano/lib/components/PlayerPermissionBadge.svelte";
  import PlayerStatusBadge from "$pano/lib/components/PlayerStatusBadge.svelte";
  import PlayerHead from "$pano/lib/components/PlayerHead.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let side;
  export let items;
  export let data;
  export let checkTime;
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

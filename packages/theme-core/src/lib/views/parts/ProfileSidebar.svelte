<!--
  Default markup of the engine's <ProfileSidebar> (registry name "ProfileSidebar", contract 1): the
  cards beside the profile pages. The controller (components/sidebars/ProfileSidebar.svelte) owns the
  data, the item list, the navigation entries and the clock.

  Props:
    side               "left" | "right" - which side of the content the column sits on
    showDeleteAll      boolean - show the "delete all notifications" button
    onDeleteAllClick   function() - opens the confirmation for deleting all notifications
    items              store of { id, component, props } - the sidebar items, plugin items included;
                       unknown ids are rendered with <ViewComponent> (the place plugins inject)
    data               store of { lastActivityTime, inGame, permissionGroupName, isBanned }
    user               object - the signed-in user ({} for a visitor)
    checkTime          number - ticks every second, re-renders the "last seen" texts
    navEntries         array - { id, href, text, icon, badge, active } of the profile navigation
-->
<Sidebar side={side}>
  <div class="d-flex flex-column gap-3">
    {#if showDeleteAll}
      <div class="order-last order-lg-first w-100">
        <button
          class="pano-profile-sidebar__action btn btn-danger w-100"
          type="button"
          on:click={() => onDeleteAllClick()}>
          <i class="fas fa-trash-alt me-2"></i>
          {$_("buttons.delete-all")}
        </button>
      </div>
    {/if}
    <div
      class="vstack gap-3"
      class:order-first={showDeleteAll}
      class:order-lg-last={showDeleteAll}>
    {#each $items as item (item.id)}
      {#if item.id === "profile-info"}
        <!-- Profile Info Snippet -->
        <div class="card square-card-desktop">
          <div class="pano-profile-sidebar__body card-body vstack gap-3">
            <div class="d-block">
              <PlayerHead
                width="64"
                height="64"
                username={user.username}
                inGame={$data.inGame}
                lastActivityTime={$data.lastActivityTime}
                checkTime={checkTime} />
            </div>
            <PageTitle title={user.username} breadcrumb={false} />
            <div class="text-center">
              <PlayerStatusBadge
                banned={$data.isBanned}
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
      {:else if item.id === "profile-nav"}
        <!-- Profile navigation: built-ins plus the plugin-contributed `profile-nav` items -->
        <ProfileNavCard entries={navEntries} />
      {:else}
        <!-- External Component -->
        <ViewComponent
          component={item.component}
          data={$data}
          user={user}
          checkTime={checkTime}
          {...item.props} />
      {/if}
    {/each}
    </div>
  </div>
</Sidebar>

<script>
  import { _ } from "svelte-i18n";

  import PlayerPermissionBadge from "$pano/lib/components/PlayerPermissionBadge.svelte";
  import PlayerStatusBadge from "$pano/lib/components/PlayerStatusBadge.svelte";
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import PlayerHead from "$pano/lib/components/PlayerHead.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import ProfileNavCard from "$pano/lib/components/sidebars/ProfileNavCard.svelte";

  export let side;
  export let showDeleteAll = false;
  export let onDeleteAllClick = () => {};
  export let items;
  export let data;
  export let user;
  export let checkTime;
  export let navEntries;
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

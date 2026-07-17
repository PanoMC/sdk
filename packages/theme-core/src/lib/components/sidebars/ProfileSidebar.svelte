<Sidebar side={side}>
  <div class="d-flex flex-column gap-3">
    {#if showDeleteAll}
      <div class="order-last order-lg-first w-100">
        <button
          class="btn btn-danger w-100"
          type="button"
          on:click={() => showDeleteAllNotificationsModal()}>
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
          <div class="card-body vstack gap-3">
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

<script context="module">
  import ApiUtil from "$pano/lib/api.util.js";
  import { writable } from "svelte/store";
  import { executeSidebarLoad, panoApi } from "$pano/lib/PluginAPI";

  const data = writable({
    lastActivityTime: 0,
    inGame: false,
    permissionGroupName: "",
    isBanned: false,
  });

  export const load = async (event) => {
    /* Register Defaults */
    panoApi.ui.sidebar.register({
      sidebarId: "profile",
      id: "profile-info",
      component: "local:profile-info",
      priority: 100,
    });

    // Execute sidebar load and resolve components for SSR
    await executeSidebarLoad("profile", event);

    data.set(
      await ApiUtil.get({
        path: "/api/sidebars/profile",
        request: event,
      }),
    );
  };

  String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
  };
</script>

<script>
  import { getContext, onDestroy, onMount } from "svelte";
  import { _ } from "svelte-i18n";

  import tooltip from "$pano/lib/tooltip.util";

  import PlayerPermissionBadge from "$pano/lib/components/PlayerPermissionBadge.svelte";
  import PlayerStatusBadge from "$pano/lib/components/PlayerStatusBadge.svelte";
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import PlayerHead from "$pano/lib/components/PlayerHead.svelte";
  import PageTitle from "../PageTitle.svelte";
  import { show as showDeleteAllNotificationsModal } from "$pano/lib/components/modals/ConfirmRemoveAllNotificationsModal.svelte";

  export let side;
  export let showDeleteAll = false;

  const session = getContext("session");

  $: user = $session.user ? $session.user : {};

  let checkTime = 0;
  let interval;

  onMount(() => {
    interval = setInterval(() => {
      checkTime += 1;
    }, 1000);
  });

  onDestroy(() => {
    clearInterval(interval);
  });

  const items = panoApi.ui.sidebar.get("profile");
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

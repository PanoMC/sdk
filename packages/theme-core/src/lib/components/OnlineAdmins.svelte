<!-- Online Admins Card -->
<div
  class="card h-100 mb-3 mb-lg-0"
  hidden={typeof themeSettings.sidebarCarts?.onlineAdmins === "undefined"
    ? false
    : !themeSettings.sidebarCarts.onlineAdmins}>
  <CardHeader headerClasses="bg-transparent">
    <div slot="left">{$_("components.online-admins.online-admins")}</div>
  </CardHeader>
  <div class="card-body pt-3 d-flex flex-column justify-content-start">
    {#if onlineAdmins && onlineAdmins.length > 0}
      <div class="row g-3 justify-content-evenly align-items-start align-content-start">
        {#each onlineAdmins as onlineAdmin, index (onlineAdmin)}
          <div class="col-auto">
            <a
              href="/player/{onlineAdmin}"
              class="online-admin-link focus-ring rounded position-relative d-inline-block">
              <img
                src="/api/profile/picture/{onlineAdmin}?{$avatarVersion}"
                class="online-admin-avatar rounded border border-3 border-success"
                alt={onlineAdmin}
                use:tooltip={[
                  $_("components.player-head.in-website"),
                  { placement: "bottom" },
                ]} />
            </a>
          </div>
        {/each}
      </div>
    {:else}
      <NoContent />
    {/if}
  </div>
</div>

<!-- Online Admins Card End -->
<script>
  import { _ } from "svelte-i18n";
  import { avatarVersion } from "$pano/lib/Store";
  import tooltip from "$pano/lib/tooltip.util";
  import { getContext } from "svelte";
  import NoContent from "./NoContent.svelte";
  import CardHeader from "./CardHeader.svelte";

  export let onlineAdmins;

  const themeSettings = getContext("themeSettings");
</script>

<style>


    .online-admin-link {
        display: block;
        flex-shrink: 0;
    }

    .online-admin-avatar {
        display: block;
        width: 48px;
        height: 48px;
        object-fit: cover;
    }
</style>

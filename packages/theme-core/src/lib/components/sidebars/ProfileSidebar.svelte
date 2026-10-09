<!--
  Controller of the engine's <ProfileSidebar>. The markup lives in views/parts/ProfileSidebar.svelte; a
  theme may replace it with the "ProfileSidebar" entry of theme.config.js views (see skin-contract.json
  for the props). The controller keeps the data, the item list, the navigation entries and the clock.
-->
<svelte:component
  this={getOverride("ProfileSidebar") ?? ProfileSidebarView}
  {side}
  {showDeleteAll}
  {onDeleteAllClick}
  {items}
  {data}
  {user}
  {checkTime}
  {navEntries} />

<script context="module">
  import ApiUtil from "$pano/lib/api.util.js";
  import { writable } from "svelte/store";
  import { executeSidebarLoad, panoApi } from "$pano/lib/PluginAPI";
  import { mergeProfileNav } from "./profileNav.util.js";

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

    panoApi.ui.sidebar.register({
      sidebarId: "profile",
      id: "profile-nav",
      component: "local:profile-nav",
      priority: 95,
    });

    // Built-in navigation entries; plugins add theirs with pano.ui.profile.nav.edit. Built-ins an
    // item of the same id already covers are not added again (load runs on every page visit).
    panoApi.ui.profile.nav.edit((navItems) => {
      navItems.splice(0, navItems.length, ...mergeProfileNav(navItems));
    });

    // Execute sidebar load and resolve components for SSR
    await executeSidebarLoad("profile", event);

    data.set(
      await ApiUtil.get({
        path: "/sidebars/profile",
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
  import { page } from "$app/stores";
  import { base } from "$app/paths";

  import { getOverride } from "$pano/registry/index.js";
  import ProfileSidebarView from "$pano/lib/views/parts/ProfileSidebar.svelte";
  import { buildProfileNavEntries } from "./profileNav.util.js";
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
  const navItems = panoApi.ui.profile.nav.get();

  const onDeleteAllClick = () => showDeleteAllNotificationsModal();

  $: navEntries = buildProfileNavEntries($navItems, {
    pathname: $page.url.pathname,
    base,
    translate: (key) => $_(key),
  });
</script>

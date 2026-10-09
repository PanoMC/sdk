<svelte:component
  this={data.View}
  {data}
  {notifications}
  {count}
  {page}
  {loadMoreLoading}
  {checkTime}
  {avatarVersion}
  {currentLanguage}
  {locales}
  {onNotificationClick}
  {onDeleteNotificationClick}
  {getTime}
  {loadMore}
  {sanitizeObject} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/NotificationsPageLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "NotificationsView", () => import("../views/NotificationsView.svelte"))) };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { avatarVersion } from "$pano/lib/Store";
  import * as locales from "date-fns/locale";

  import { onNotificationClick } from "$pano/lib/NotificationManager";
  import { currentLanguage } from "$pano/lib/language.util";

  import {
    onDeleteNotificationClick,
    getTime,
    init,
    loadMore,
    onDeleteAllClick,
    sanitizeObject,
  } from "$pano/lib/ui-logics/page-logics/NotificationsPageLogics";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let data;

  const {
    notifications,
    count,
    notificationProcessID,
    page,
    loadMoreLoading,
    checkTime,
    interval,
  } = init(data);
</script>

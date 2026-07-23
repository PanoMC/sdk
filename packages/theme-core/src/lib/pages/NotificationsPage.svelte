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
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "NotificationsView",
      () => import("../views/NotificationsView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
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

<!--
  @view NotificationsView
  Controller: $pano/lib/pages/NotificationsPage.svelte
  Props:
    data                       object — page data from load (notifications, notificationCount, sidebar config)
    notifications              store — list of the user's currently loaded notifications
    count                      store — total notification count on the server
    page                       store — zero-based "load more" page index
    loadMoreLoading            store — true while the next page of notifications is being fetched
    checkTime                  store — tick counter handed to getTime so relative timestamps refresh
    avatarVersion              store — cache-busting version appended to profile picture URLs
    currentLanguage            store — active language object; .dateFnsCode selects the date-fns locale
    locales                    object — date-fns locale namespace, indexed by $currentLanguage.dateFnsCode
    onNotificationClick        function — opens/acts on a notification when its row is clicked
    onDeleteNotificationClick  function — deletes a single notification
    getTime                    function — formats a timestamp as a relative "time ago" string
    loadMore                   function — fetches the next page of notifications
    sanitizeObject             function — escapes notification detail values before {@html} interpolation
  Override from a theme:
    theme.config.js → views: { NotificationsView: () => import("./src/views/NotificationsView.svelte") }
-->
<div class="vstack gap-3">

  <!-- Notifications -->
  <div class="card mt-3 mt-lg-0">
    <div class="card-body">
      <div class="list-group" class:d-none={$notifications.length === 0}>
        {#each $notifications as notification, index (notification.id)}
          <div
            class="site-notification-row fw-normal list-group-item list-group-item-action d-flex align-items-center gap-3 text-wrap"
            class:notification-unread={notification.status === "NOT_READ"}>
            <button
              type="button"
              title={$_("buttons.view")}
              on:click={() => onNotificationClick(notification)}
              class="flex-grow-1 text-start border-0 bg-transparent p-0 d-flex align-items-center gap-3">
              <span class="d-flex align-items-center">
                {#if notification.details.faIcon}
                  <i
                    class="{notification.details
                      .faIcon} fa-xl fa-fw text-primary"></i>
                {:else if notification.details.image || notification.details.username}
                  <img
                    src={notification.details.image ||
                      `/api/profile/picture/${notification.details.username}?${$avatarVersion}`}
                    alt={$_("buttons.view")}
                    width="30"
                    height="30"
                    class="rounded" />
                {:else}
                  <i class="fa fa-bolt fa-xl fa-fw text-primary"></i>
                {/if}
              </span>

              <div class="fw-normal">
                <span class="text-wrap markdown-renderer text-break"
                  >{@html $_("notifications." + notification.type, {
                    values: { ...sanitizeObject(notification.details || {}) },
                  })}</span>
                <br />
                <small>
                  {getTime(
                    checkTime,
                    parseInt(notification.createdAt),
                    locales[$currentLanguage.dateFnsCode],
                  )}
                </small>
              </div>
            </button>

            <button
              type="button"
              class="btn-close ms-2"
              aria-label={$_("pages.notifications.delete-notification")}
              use:tooltip={[
                $_("pages.notifications.delete-notification"),
                { placement: "bottom" },
              ]}
              on:click={() => onDeleteNotificationClick(notification.id)}>
            </button>
          </div>
        {/each}
      </div>

      {#if $notifications.length === 0}
        <NoContent />
      {/if}

      {#if $notifications.length < $count && $count > 10 + 10 * $page}
        <div class="mt-3">
          <button
            class="btn btn-primary d-block m-auto"
            class:disabled={$loadMoreLoading}
            on:click={() => loadMore(notifications, loadMoreLoading)}
            >{$_("pages.notifications.show-more", {
              values: { count: $count - $notifications.length },
            })}
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<ConfirmRemoveAllNotificationsModal />

<script>
  import { _ } from "svelte-i18n";

  import tooltip from "$pano/lib/tooltip.util.js";

  import ConfirmRemoveAllNotificationsModal from "$pano/lib/components/modals/ConfirmRemoveAllNotificationsModal.svelte";
  import NoContent from "$pano/lib/components/NoContent.svelte";

  export let data;
  export let notifications;
  export let count;
  export let page;
  export let loadMoreLoading;
  export let checkTime;
  export let avatarVersion;
  export let currentLanguage;
  export let locales;
  export let onNotificationClick;
  export let onDeleteNotificationClick;
  export let getTime;
  export let loadMore;
  export let sanitizeObject;
</script>

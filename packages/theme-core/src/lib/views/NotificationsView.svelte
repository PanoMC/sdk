<!--
  @view NotificationsView
  Controller: $pano/lib/pages/NotificationsPage.svelte
  Props:
    data                       object — page data from load (notifications, notificationCount, sidebar config)
    notifications              store — list of the user's currently loaded notifications
    count                      store — notifications on the server as far as the cursor says: above the loaded list while page.nextCursor is set, equal to it when the list is complete
    page                       store — zero-based "load more" page index
    loadMoreLoading            store — true while the next page of notifications is being fetched
    checkTime                  store — tick counter handed to getTime so relative timestamps refresh
    avatarVersion              store — cache-busting version appended to profile picture URLs
    currentLanguage            store — active language object; .dateFnsCode selects the date-fns locale
    locales                    object — date-fns locale namespace, indexed by $currentLanguage.dateFnsCode
    onNotificationClick        function(notification, navigate) — opens/acts on a notification when its row is clicked; the view passes navigate(path) for the details.href fallback
                               (text key: notificationTextKey(notification) from @panomc/sdk/core/js/NotificationManager.js, default $_("notifications.UNKNOWN"))
    onDeleteNotificationClick  function — deletes a single notification
    getTime                    function — formats a timestamp as a relative "time ago" string
    loadMore                   function — fetches the next page of notifications
    sanitizeObject             function — escapes notification detail values before {@html} interpolation
  Override from a theme:
    theme.config.js → views: { NotificationsView: () => import("./src/views/NotificationsView.svelte") }
-->
<div class="pano-notifications-view vstack gap-3">

  <!-- Notifications -->
  <div class="card mt-3 mt-lg-0">
    <div class="pano-notifications-view__body card-body">
      <div class="pano-notifications-view__list list-group" class:d-none={$notifications.length === 0}>
        {#each $notifications as notification, index (notification.id)}
          <div
            class="pano-notifications-view__item site-notification-row fw-normal list-group-item list-group-item-action d-flex align-items-center gap-3 text-wrap"
            class:notification-unread={notification.status === "NOT_READ"}>
            <button
              type="button"
              title={$_("buttons.view")}
              on:click={() => onNotificationClick(notification, navigate)}
              class="flex-grow-1 text-start border-0 bg-transparent p-0 d-flex align-items-center gap-3">
              <span class="d-flex align-items-center">
                {#if notification.details.faIcon}
                  <i
                    class="{notification.details
                      .faIcon} fa-xl fa-fw text-primary"></i>
                {:else if notification.details.image || notification.details.username}
                  <img
                    src={notification.details.image ||
                      `/api/v1/profile/picture/${notification.details.username}?${$avatarVersion}`}
                    alt={$_("buttons.view")}
                    width="30"
                    height="30"
                    class="pano-notifications-view__image rounded" />
                {:else}
                  <i class="fa fa-bolt fa-xl fa-fw text-primary"></i>
                {/if}
              </span>

              <div class="fw-normal">
                <span class="text-wrap markdown-renderer text-break"
                  >{@html $_(notificationTextKey(notification), {
                    values: { ...sanitizeObject(notification.details || {}) },
                    default: $_("notifications.UNKNOWN"),
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

      {#if $notifications.length < $count}
        <div class="mt-3">
          <button
            class="pano-notifications-view__action btn btn-primary d-block m-auto"
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

  import { goto } from "$app/navigation";
  import { base } from "$app/paths";
  import { notificationTextKey } from "@panomc/sdk/core/js/NotificationManager.js";

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

  // Notifications without a click listener navigate to their safe `details.href`.
  const navigate = (path) => goto(base + path);
</script>

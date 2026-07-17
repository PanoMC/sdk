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

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/NotificationsPageLogics";

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    return processLoad(event);
  }
</script>

<script>
  import { _ } from "svelte-i18n";
  import { getContext, onMount } from "svelte";
  import { avatarVersion } from "$pano/lib/Store";
  import * as locales from "date-fns/locale";

  import tooltip from "$pano/lib/tooltip.util.js";

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

  import ConfirmRemoveAllNotificationsModal from "$pano/lib/components/modals/ConfirmRemoveAllNotificationsModal.svelte";
  import NoContent from "$pano/lib/components/NoContent.svelte";
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

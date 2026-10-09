<!--
  Default markup of the engine's <NotificationContainer> (registry name "NotificationContainer", contract 1):
  the toast stack of new site notifications.

  Props:
    notifications           store - the notifications on screen (objects of the notifications API)
    checkTime               number - tick counter, passed to getTime so the relative times refresh
    currentLanguage         store - active language object; .dateFnsCode selects the date-fns locale
    locales                 object - the date-fns locale namespace
    avatarVersion           store - cache-busting version appended to profile picture URLs
    getTime                 function(checkTime, time, locale) - relative "time ago" text
    onNotificationClick     function(notification, navigate) - runs the notification's listener, or navigates
    navigate                function(path) - goto(base + path)
    notificationTextKey     function(notification) - the translation key of the notification text
    sanitizeObject          function(details) - escapes detail values before {@html} interpolation
    onClick                 function(notification) - the whole-card click: marks it read, follows it, hides it
-->
<div class="pano-notification-container toast-container position-fixed bottom-0 end-0 p-3 d-xl-block d-none">
  {#each $notifications as notification, index (notification)}
    <article
      id="notificationToast{notification.id}"
      class="toast position-relative"
      aria-live="assertive"
      aria-atomic="true">

      <div class="toast-header text-bg-primary">
        <strong class="me-auto">
          {$_("components.notification-container.notification")}
        </strong>
        <small>
          {getTime(
            checkTime,
            parseInt(notification.createdAt),
            locales[$currentLanguage.dateFnsCode],
          )}
        </small>

        <button
          type="button"
          class="btn-close btn-close-white position-relative z-3"
          aria-label="{$_('buttons.close')}"
          data-bs-dismiss="toast"
          on:click|stopPropagation>
        </button>
      </div>

      <div class="toast-body">
        <div
          class="pano-notification-container__item fw-normal list-group-item list-group-item-action d-flex align-items-center gap-3 text-wrap">
          <button
            type="button"
            title={$_("buttons.view")}
            on:click={() => onNotificationClick(notification, navigate)}
            class="text-start border-0 bg-transparent p-0 d-flex align-items-center gap-3">

          <span class="d-flex align-items-center">
            {#if notification.details.faIcon}
              <i class="{notification.details.faIcon} fa-fw"></i>
            {:else if notification.details.image || notification.details.username}
              <img
                src="{notification.details.image || `/api/v1/profile/picture/${notification.details.username}?${$avatarVersion}`}"
                alt="{$_('buttons.view')}"
                width="48"
                height="48"
                class="pano-notification-container__image rounded" />
            {:else}
              <i class="fa fa-fw fa-bolt"></i>
            {/if}
          </span>

            <span class="text-start">
            <span class="text-wrap markdown-renderer text-break">
              {@html $_(notificationTextKey(notification), {
                values: { ...sanitizeObject(notification.details || {}) },
                default: $_('notifications.UNKNOWN')
              })}
            </span>
          </span>
          </button>
        </div>
      </div>

      <!-- Invisible button covering whole area without creating spacing -->
      <button
        type="button"
        class="stretched-link p-0 border-0 bg-transparent position-absolute top-0 start-0 w-100 h-100"
        aria-label={$_("buttons.view")}
        on:click={() => onClick(notification)}>
      </button>
    </article>

  {/each}
</div>

<script>
  import { _ } from "svelte-i18n";

  export let notifications;
  export let checkTime;
  export let currentLanguage;
  export let locales;
  export let avatarVersion;
  export let getTime;
  export let onNotificationClick;
  export let navigate;
  export let notificationTextKey;
  export let sanitizeObject;
  export let onClick;
</script>

<!--
  Controller of the engine's <NotificationContainer>. The markup lives in views/parts/NotificationContainer.svelte; a
  theme may replace it with the "NotificationContainer" entry of theme.config.js views (see skin-contract.json for the
  props). The module API (show, hide) and the realtime / polling logic stay here.
-->
<svelte:component
  this={getOverride("NotificationContainer") ?? NotificationContainerView}
  {notifications}
  {checkTime}
  {currentLanguage}
  {locales}
  {avatarVersion}
  {getTime}
  {onNotificationClick}
  {navigate}
  {notificationTextKey}
  {sanitizeObject}
  {onClick} />

<script context="module">
  import { tick } from "svelte";
  import { get, writable } from "svelte/store";

  const notifications = writable([]);
  const notificationToasts = writable({});

  Array.prototype.insert = function (index, item) {
    this.splice(index, 0, item);

    return this;
  };

  Array.prototype.remove = function (index) {
    this.splice(index, 1);

    return this;
  };

  function delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }

  function deleteFromNotifications(id) {
    notifications.update((notifications) => {
      const foundNotification = notifications.find(
        (notification) => notification.id === id
      );

      notifications.remove(notifications.indexOf(foundNotification));
      delete notificationToasts[id];

      return notifications;
    });
  }

  export async function show(id) {
    await tick();

    const notificationElement = document.getElementById(
      "notificationToast" + id
    );

    if (notificationElement) {
      const toast = new window.bootstrap.Toast(notificationElement);

      notificationToasts[id] = toast;

      toast.show();

      notificationElement.addEventListener("hidden.bs.toast", () => {
        deleteFromNotifications(id);
      });
    }
  }

  export async function hide(id) {
    notificationToasts[id].hide();
    deleteFromNotifications(id);
  }
</script>

<script>
  import { getContext, onDestroy, onMount } from "svelte";
  import { formatDistanceToNow } from "date-fns";
  import { sanitize } from "@jill64/universal-sanitizer";

  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { base } from "$app/paths";

  import { notificationsCount, quickNotifications, avatarVersion } from "$pano/lib/Store";
  import { onNotificationRefresh, setSiteNotificationsSubscription } from "$pano/lib/siteRealtime.js";
  import ApiUtil from "$pano/lib/api.util";
  import { onNotificationClick, notificationTextKey } from "$pano/lib/NotificationManager.js";
  import * as locales from "date-fns/locale";
  import { currentLanguage } from "$pano/lib/language.util.js";
  import { getOverride } from "$pano/registry/index.js";
  import NotificationContainerView from "$pano/lib/views/parts/NotificationContainer.svelte";

  let quickNotificationProcessID = 0;

  let checkTime = 0;
  let interval;
  let mounted = false;
  let unsubRefresh = () => {};

  const session = getContext("session");

  function getTime(check, time, locale) {
    return formatDistanceToNow(time, { addSuffix: true, locale });
  }

  function addNotification(notification) {
    notifications.update((notifications) => {
      notifications.push(notification);

      return notifications;
    });

    show(notification.id);
  }

  function setNotifications(newNotifications) {
    if (get(quickNotifications).length === 0 || newNotifications.length === 0) {
      quickNotifications.set(newNotifications);

      newNotifications.forEach((notification) => {
        if (notification.status === "NOT_READ") {
          addNotification(notification);
        }
      });

      return;
    }

    const listOfFilterIsNotificationExists = [];

    newNotifications.forEach((item, index) => {
      listOfFilterIsNotificationExists[index] = get(quickNotifications).filter(
        (filterItem) => filterItem.id === item.id
      );
    });

    newNotifications.forEach((item, index) => {
      if (listOfFilterIsNotificationExists[index].length === 0) {
        quickNotifications.update((quickNotifications) => {
          return quickNotifications.insert(index, item);
        });

        addNotification(item);
      }
    });

    get(quickNotifications).forEach((item, index) => {
      const newArrayOfFilter = newNotifications.filter(
        (filterItem) => filterItem.id === item.id
      );

      if (newArrayOfFilter.length === 0) {
        quickNotifications.update((quickNotifications) => {
          return quickNotifications.remove(index);
        });
      }
    });
  }

  function delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }

  async function getQuickNotifications(id) {
    await delay();

    ApiUtil.get({
      path: "/notifications/quick",
    }).then((body) => {
      if (quickNotificationProcessID === id) {
        if (!body.error) {
          setNotifications(body.items);

          notificationsCount.set(body.notificationCount);
        }
      }
    });
  }

  function startQuickNotificationsCountDown() {
    quickNotificationProcessID++;

    const id = quickNotificationProcessID;

    getQuickNotifications(id);
  }

  if (browser) {
    const sessionSubscription = session.subscribe((session) => {
      quickNotificationProcessID++;
      if (mounted && session.user) {
        setSiteNotificationsSubscription(true);
        startQuickNotificationsCountDown();
      } else {
        setSiteNotificationsSubscription(false);
      }
    });

    onDestroy(sessionSubscription);
  }

  // Notifications without a click listener navigate to their safe `details.href`.
  const navigate = (path) => goto(base + path);

  function markRead(id) {
    ApiUtil.post({
      path: `/notifications/${id}/read`,
    });
  }

  function onClick(notification) {
    markRead(notification.id);
    onNotificationClick(notification, navigate);
    hide(notification.id);
  }

  onMount(() => {
    mounted = true;
    unsubRefresh = onNotificationRefresh(() => {
      if (get(session).user) {
        startQuickNotificationsCountDown();
      }
    });
    if ($session.user) {
      setSiteNotificationsSubscription(true);
      startQuickNotificationsCountDown();
    }
    interval = setInterval(() => {
      checkTime += 1;
    }, 1000);
  });

  onDestroy(() => {
    quickNotificationProcessID++;
    setSiteNotificationsSubscription(false);
    unsubRefresh();
    clearInterval(interval);
  });

  function sanitizeObject(obj) {
    return Object.keys(obj).reduce((sanitizedObj, key) => {
      sanitizedObj[key] = sanitize(obj[key]);
      return sanitizedObj;
    }, {});
  }
</script>

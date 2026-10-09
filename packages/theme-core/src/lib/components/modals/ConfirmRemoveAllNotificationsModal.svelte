<!--
  Controller of the engine's <ConfirmRemoveAllNotificationsModal>. The markup lives in
  views/parts/ConfirmRemoveAllNotificationsModal.svelte; a theme may replace it with the
  "ConfirmRemoveAllNotificationsModal" entry of theme.config.js views (see skin-contract.json for the props). The module
  API (show, hide, setCallback, onHide) stays here.
-->
<svelte:component
  this={getOverride("ConfirmRemoveAllNotificationsModal") ?? ConfirmRemoveAllNotificationsModalView}
  {dialogID}
  {loading}
  {hide}
  {onYesClick} />

<script context="module">
  const dialogID = "confirmDeleteAllNotifications";

  let callback = () => {};
  let hideCallback = () => {};
  let modal;

  export function show() {
    modal = new window.bootstrap.Modal(document.getElementById(dialogID), {
      backdrop: "static",
      keyboard: false,
    });
    modal.show();
  }

  export function setCallback(newCallback) {
    callback = newCallback;
  }

  export function hide() {
    hideCallback();

    modal.hide();
  }

  export function onHide(newCallback) {
    hideCallback = newCallback;
  }
</script>

<script>
  import ApiUtil from "$pano/lib/api.util";

  import { getOverride } from "$pano/registry/index.js";
  import ConfirmRemoveAllNotificationsModalView from "$pano/lib/views/parts/ConfirmRemoveAllNotificationsModal.svelte";

  let loading;

  function refreshBrowserPage() {
    location.reload();
  }

  function onYesClick() {
    loading = true;

    ApiUtil.delete({
      path: "/notifications",
    }).then((body) => {
      if (!body.error) {
        loading = false;

        hide();

        callback();
      } else refreshBrowserPage();
    });
  }
</script>

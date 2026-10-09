<!--
  Controller of the engine's <LogoutSessionConfirmModal>. The markup lives in views/parts/LogoutSessionConfirmModal.svelte;
  a theme may replace it with the "LogoutSessionConfirmModal" entry of theme.config.js views (see skin-contract.json for
  the props). The module API (show, hide, setCallback) stays here.
-->
<svelte:component
  this={getOverride("LogoutSessionConfirmModal") ?? LogoutSessionConfirmModalView}
  {dialogID}
  {hide}
  {onYesClick} />

<script context="module">
  const dialogID = "logoutSessionConfirmModal";

  let callback = () => {};
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
    modal.hide();
  }
</script>

<script>
  import { getOverride } from "$pano/registry/index.js";
  import LogoutSessionConfirmModalView from "$pano/lib/views/parts/LogoutSessionConfirmModal.svelte";

  function onYesClick() {
    hide();
    callback();
  }
</script>

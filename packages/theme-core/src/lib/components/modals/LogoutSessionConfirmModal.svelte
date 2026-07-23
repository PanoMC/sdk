<div
  aria-hidden="true"
  class="modal fade"
  id="{dialogID}"
  role="dialog"
  tabindex="-1">
  <div class="modal-dialog modal-dialog-centered" role="dialog">
    <div class="modal-content">
      <div class="modal-body text-center">
        <div class="pb-3">
          <i class="fas fa-question-circle fa-3x d-block m-auto text-gray"></i>
        </div>
        {$_("components.modals.logout-session-confirm.title")}
      </div>
      <div class="modal-footer flex-nowrap">
        <button
          class="btn btn-link col-6 m-0"
          type="button"
          onclick={hide}>
          {$_("buttons.cancel")}
        </button>
        <button
          class="btn btn-danger col-6 m-0"
          type="button"
          onclick={onYesClick}>{$_("buttons.yes")}</button>
      </div>
    </div>
  </div>
</div>

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
  import { _ } from "svelte-i18n";

  function onYesClick() {
    hide();
    callback();
  }
</script>

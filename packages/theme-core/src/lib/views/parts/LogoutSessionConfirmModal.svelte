<!--
  Default markup of the engine's <LogoutSessionConfirmModal> (registry name "LogoutSessionConfirmModal", contract 1).
  A Bootstrap modal: show() finds it by id and opens it, so the root element must keep that id.

  Props:
    dialogID   string - the id of the modal root element
    hide       function() - cancel: closes the modal
    onYesClick function() - confirm: closes the modal and runs the callback (logs out)
-->
<div
  aria-hidden="true"
  class="pano-logout-session-confirm-modal modal fade"
  id="{dialogID}"
  role="dialog"
  tabindex="-1">
  <div class="modal-dialog modal-dialog-centered" role="dialog">
    <div class="modal-content">
      <div class="pano-logout-session-confirm-modal__body modal-body text-center">
        <div class="pb-3">
          <i class="fas fa-question-circle fa-3x d-block m-auto text-gray"></i>
        </div>
        {$_("components.modals.logout-session-confirm.title")}
      </div>
      <div class="pano-logout-session-confirm-modal__footer modal-footer flex-nowrap">
        <button
          class="pano-logout-session-confirm-modal__action btn btn-link col-6 m-0"
          type="button"
          onclick={hide}>
          {$_("buttons.cancel")}
        </button>
        <button
          class="pano-logout-session-confirm-modal__yes btn btn-danger col-6 m-0"
          type="button"
          onclick={onYesClick}>{$_("buttons.yes")}</button>
      </div>
    </div>
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  export let dialogID;
  export let hide;
  export let onYesClick;
</script>

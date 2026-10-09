<!--
  Default markup of the engine's <ConfirmRemoveAllNotificationsModal> (registry name
  "ConfirmRemoveAllNotificationsModal", contract 1). A Bootstrap modal: show() finds it by id and opens it, so the root
  element must keep that id.

  Props:
    dialogID   string - the id of the modal root element
    loading    boolean - the delete request is in flight; disable the buttons
    hide       function() - cancel: closes the modal
    onYesClick function() - confirm: deletes every notification
-->
<div
  aria-hidden="true"
  class="pano-confirm-remove-all-notifications-modal modal fade"
  id="{dialogID}"
  role="dialog"
  tabindex="-1">
  <div class="modal-dialog modal-dialog-centered" role="dialog">
    <div class="modal-content">
      <div class="pano-confirm-remove-all-notifications-modal__body modal-body text-center">
        <div class="pb-3">
          <i class="fas fa-question-circle fa-3x d-block m-auto text-gray"></i>
        </div>
        {$_("components.modals.confirm-remove-all-notifications.title")}
      </div>
      <div class="pano-confirm-remove-all-notifications-modal__footer modal-footer flex-nowrap">
        <button
          class="pano-confirm-remove-all-notifications-modal__action btn btn-link col-6 m-0"
          type="button"
          class:disabled="{loading}"
          aria-disabled="{loading}"
          disabled="{loading}"
          on:click="{hide}">
          {$_("buttons.cancel")}
        </button>
        <button
          class="pano-confirm-remove-all-notifications-modal__yes btn btn-danger col-6 m-0"
          type="button"
          class:disabled="{loading}"
          aria-disabled="{loading}"
          disabled="{loading}"
          on:click="{onYesClick}">{$_("buttons.yes")}</button>
      </div>
    </div>
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  export let dialogID;
  export let loading;
  export let hide;
  export let onYesClick;
</script>

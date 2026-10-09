<!--
  Default markup of the engine's <CloseTicketConfirmModal> (registry name "CloseTicketConfirmModal", contract 1).
  A Bootstrap modal: show() finds it by id and opens it, so the root element must keep that id.

  Props:
    dialogID   string - the id of the modal root element
    error      store - the current error (string or { key, props }), shown through <ErrorAlert>
    loading    boolean - the close request is in flight; disable the buttons
    hide       function() - cancel: closes the modal
    onYesClick function() - confirm: closes the ticket
-->
<div
  aria-hidden="true"
  class="pano-close-ticket-confirm-modal modal fade"
  id="{dialogID}"
  role="dialog"
  tabindex="-1">
  <div class="modal-dialog modal-dialog-centered" role="dialog">
    <div class="modal-content">
      <div class="pano-close-ticket-confirm-modal__body modal-body text-center">
        <ErrorAlert error="{$error}" />

        <div class="pb-3">
          <i class="fas fa-question-circle fa-3x d-block m-auto text-gray"></i>
        </div>
        {$_("components.modals.close-ticket-confirm.title")}
      </div>
      <div class="pano-close-ticket-confirm-modal__footer modal-footer flex-nowrap">
        <button
          class="pano-close-ticket-confirm-modal__action btn btn-link col-6 m-0"
          data-bs-dismiss="modal"
          type="button"
          class:disabled="{loading}"
          aria-disabled="{loading}"
          disabled="{loading}"
          on:click="{hide}">
          {$_("buttons.cancel")}
        </button>
        <button
          class="pano-close-ticket-confirm-modal__yes btn btn-danger col-6 m-0"
          type="button"
          class:disabled="{loading}"
          aria-disabled="{loading}"
          disabled="{loading}"
          on:click="{onYesClick}">
          {$_("buttons.yes")}
        </button>
      </div>
    </div>
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";

  export let dialogID;
  export let error;
  export let loading = false;
  export let hide;
  export let onYesClick;
</script>

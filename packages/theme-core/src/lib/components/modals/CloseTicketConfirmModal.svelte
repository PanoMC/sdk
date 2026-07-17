<!-- Close Ticket Confirm Modal -->

<div
  aria-hidden="true"
  class="modal fade"
  id="{dialogID}"
  role="dialog"
  tabindex="-1">
  <div class="modal-dialog modal-dialog-centered" role="dialog">
    <div class="modal-content">
      <div class="modal-body text-center">
        <ErrorAlert error="{$error}" />

        <div class="pb-3">
          <i class="fas fa-question-circle fa-3x d-block m-auto text-gray"></i>
        </div>
        {$_("components.modals.close-ticket-confirm.title")}
      </div>
      <div class="modal-footer flex-nowrap">
        <button
          class="btn btn-link col-6 m-0"
          data-bs-dismiss="modal"
          type="button"
          class:disabled="{loading}"
          aria-disabled="{loading}"
          disabled="{loading}"
          on:click="{hide}">
          {$_("buttons.cancel")}
        </button>
        <button
          class="btn btn-danger col-6 m-0"
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

<script context="module">
  import { writable } from "svelte/store";

  const dialogID = "closeTicketConfirmModal";
  const error = writable();

  let callback = () => {};
  let hideCallback = () => {};
  let modal;
  let ticket;

  export function show(newTicket) {
    ticket = newTicket;

    error.set(null);

    modal = new window.bootstrap.Modal(document.getElementById(dialogID), {
      backdrop: "static",
      keyboard: false,
    });

    modal.show();
  }

  export function hide() {
    hideCallback();

    modal.hide();
  }

  export function setCallback(newCallback) {
    callback = newCallback;
  }

  export function onHide(newCallback) {
    hideCallback = newCallback;
  }
</script>

<script>
  import { _ } from "svelte-i18n";

  import { NETWORK_ERROR } from "$pano/lib/api.util";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import { updateTicket } from "$pano/lib/services/tickets";
  import { TicketStatuses } from "$pano/lib/components/TicketStatus.svelte";

  let loading = false;

  function refreshBrowserPage() {
    location.reload();
  }

  async function onYesClick() {
    error.set(null);

    loading = true;

    await updateTicket({ id: ticket.id, status: TicketStatuses.CLOSED })
      .then((body) => {
        if (body.result === "ok") {
          loading = false;

          hide();

          //TODO TOAST

          callback(ticket);
        } else refreshBrowserPage();
      })
      .catch(() => {
        loading = false;

        error.set(NETWORK_ERROR);
      });
  }
</script>

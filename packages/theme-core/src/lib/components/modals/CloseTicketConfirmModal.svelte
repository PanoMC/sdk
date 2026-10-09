<!--
  Controller of the engine's <CloseTicketConfirmModal>. The markup lives in views/parts/CloseTicketConfirmModal.svelte; a
  theme may replace it with the "CloseTicketConfirmModal" entry of theme.config.js views (see skin-contract.json for the
  props). The module API (show, hide, setCallback, onHide) stays here.
-->
<svelte:component
  this={getOverride("CloseTicketConfirmModal") ?? CloseTicketConfirmModalView}
  {dialogID}
  {error}
  {loading}
  {hide}
  {onYesClick} />

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
  import { NETWORK_ERROR } from "$pano/lib/api.util";

  import { getOverride } from "$pano/registry/index.js";
  import CloseTicketConfirmModalView from "$pano/lib/views/parts/CloseTicketConfirmModal.svelte";
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
        if (!body.error) {
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

<!--
  Controller of the engine's <TicketRow>. The markup lives in views/parts/TicketRow.svelte; a theme may
  replace it with the "TicketRow" entry of theme.config.js views (see skin-contract.json for the props).
  Dispatches `closeTicket` with { ticket }.
-->
<svelte:component this={getOverride("TicketRow") ?? TicketRowView} {ticket} {onCloseTicket} />

<script>
  import { createEventDispatcher } from "svelte";

  import { getOverride } from "$pano/registry/index.js";
  import TicketRowView from "$pano/lib/views/parts/TicketRow.svelte";

  export let ticket;

  const dispatch = createEventDispatcher();

  function onCloseTicket() {
    dispatch("closeTicket", { ticket });
  }
</script>

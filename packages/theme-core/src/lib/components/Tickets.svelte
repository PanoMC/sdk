<!--
  Controller of the engine's <Tickets>. The markup lives in views/parts/Tickets.svelte; a theme may
  replace it with the "Tickets" entry of theme.config.js views (see skin-contract.json for the props).
  Dispatches `closeTicket` with { ticket }.
-->
<svelte:component this={getOverride("Tickets") ?? TicketsView} {tickets} {onCloseTicketClick} />

<script>
  import { createEventDispatcher } from "svelte";

  import { getOverride } from "$pano/registry/index.js";
  import TicketsView from "$pano/lib/views/parts/Tickets.svelte";

  export let tickets;

  const dispatch = createEventDispatcher();

  const onCloseTicketClick = (ticket) => {
    dispatch("closeTicket", { ticket });
  };
</script>

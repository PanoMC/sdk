<!--
  Controller of the engine's <TicketStatus>. The markup lives in views/parts/TicketStatus.svelte; a theme may
  replace it with the "TicketStatus" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component this={getOverride("TicketStatus") ?? TicketStatusView} {status} />

<script context="module">
  import { TicketStatuses } from "$pano/lib/views/parts/ticketStatuses.js";

  export { TicketStatuses };
</script>

<script>
  import { getOverride } from "$pano/registry/index.js";
  import TicketStatusView from "$pano/lib/views/parts/TicketStatus.svelte";

  export let status = TicketStatuses.NEW;
</script>

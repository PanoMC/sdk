<!--
  Default markup of the engine's <TicketStatus> (registry name "TicketStatus", contract 1).

  Props:
    status  "NEW" | "REPLIED" | "CLOSED" - the ticket status to show as a badge
-->
{#if status === TicketStatuses.NEW}
  <span class="pano-ticket-status pano-ticket-status__badge badge text-bg-success rounded-pill"
    >{$_("ticket-statuses.new")}</span>
{:else if status === TicketStatuses.REPLIED}
  <span class="pano-ticket-status pano-ticket-status__badge badge text-bg-warning rounded-pill"
    >{$_("ticket-statuses.replied")}</span>
{:else if status === TicketStatuses.CLOSED}
  <span class="pano-ticket-status pano-ticket-status__badge badge text-bg-danger rounded-pill"
    >{$_("ticket-statuses.closed")}</span>
{/if}

<script>
  import { _ } from "svelte-i18n";

  import { TicketStatuses } from "$pano/lib/views/parts/ticketStatuses.js";

  export let status = TicketStatuses.NEW;
</script>

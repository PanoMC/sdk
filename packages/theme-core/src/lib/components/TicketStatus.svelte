{#if status === TicketStatuses.NEW}
  <span class="badge text-bg-success rounded-pill"
    >{$_("ticket-statuses.new")}</span>
{:else if status === TicketStatuses.REPLIED}
  <span class="badge text-bg-warning rounded-pill"
    >{$_("ticket-statuses.replied")}</span>
{:else if status === TicketStatuses.CLOSED}
  <span class="badge text-bg-danger rounded-pill"
    >{$_("ticket-statuses.closed")}</span>
{/if}

<script context="module">
  export const TicketStatuses = Object.freeze({
    NEW: "NEW",
    REPLIED: "REPLIED",
    CLOSED: "CLOSED",
  });
</script>

<script>
  import { _ } from "svelte-i18n";

  export let status = TicketStatuses.NEW;
</script>

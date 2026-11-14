<!--
  Default markup of the engine's <Tickets> (registry name "Tickets", contract 1).

  Props:
    tickets             array - ticket objects, see TicketRow
    onCloseTicketClick  function(ticket) - called when a row's close button is pressed
                        (the controller dispatches `closeTicket` with { ticket })
-->
<!-- Tickets Card -->

{#if tickets.length > 0}
  <div class="pano-tickets table-responsive">
    <table class="pano-tickets__table table table-hover">
      <thead>
        <tr>
          <th class="align-middle" scope="col"></th>
          <th class="align-middle" scope="col">{$_("components.tickets.table.title")}</th>
          <th class="align-middle" scope="col">{$_("components.tickets.table.status")}</th>
          <th class="align-middle" scope="col">{$_("components.tickets.table.category")}</th>
          <th class="align-middle" scope="col">{$_("components.tickets.table.last-reply")}</th></tr>
      </thead>
      <tbody>
        {#each tickets as ticket, index (ticket)}
          <TicketRow
            ticket="{ticket}"
            on:closeTicket="{(event) =>
              onCloseTicketClick(event.detail.ticket)}" />
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <NoContent />
{/if}

<!-- Tickets Card End -->
<script>
  import { _ } from "svelte-i18n";

  import TicketRow from "$pano/lib/components/TicketRow.svelte";
  import NoContent from "$pano/lib/components/NoContent.svelte";

  export let tickets;
  export let onCloseTicketClick = () => {};
</script>

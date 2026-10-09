<!--
  Default markup of the engine's <TicketRow> (registry name "TicketRow", contract 1).

  Props:
    ticket         object - { id, title, status, category: { title, url }, lastUpdate, selected? }
    onCloseTicket  function() - the close button handler (the controller dispatches `closeTicket`)
-->
<tr class="pano-ticket-row" class:table-active={ticket.selected}>
  <th scope="row" class="text-center align-middle">
    {#if ticket.status !== TicketStatuses.CLOSED}
      <button
        type="button"
        title={$_("buttons.close-ticket")}
        aria-label={$_("buttons.close-ticket")}
        class="pano-ticket-row__action btn btn-link"
        on:click={() => onCloseTicket()}>
        <i class="fas fa-check"></i>
      </button>
    {/if}
  </th>
  <td class="align-middle" style="max-width: 300px;">
    <div class="text-truncate">
      <a
        class="rounded focus-ring text-decoration-none d-block text-truncate"
        href={route(`/ticket/${ticket.id}`)}
        title="#{ticket.id} {ticket.title}">
        #{ticket.id} {ticket.title}
      </a>
    </div>
  </td>
  <td class="align-middle">
    <TicketStatus status={ticket.status} />
  </td>
  <td class="align-middle text-nowrap">
    <a
      use:tooltip={[
        $_("components.ticket-row.filter"),
        { placement: "bottom" },
      ]}
      class="pano-ticket-row__badge badge rounded-pill {ticket.category.title === '-' ? 'text-bg-primary' : 'text-bg-secondary'} text-decoration-none focus-ring"
      href="{route('/tickets')}?category={ticket.category.url}">
      {ticket.category.title === "-"
        ? $_("components.ticket-row.no-category")
        : ticket.category.title}
    </a>
  </td>
  <td class="align-middle text-nowrap"
    ><span><Date time={ticket.lastUpdate} /></span></td>
</tr>

<script>
  import { _ } from "svelte-i18n";

  import { route } from "$pano/registry/routes.js";

  import tooltip from "$pano/lib/tooltip.util";
  import TicketStatus from "$pano/lib/components/TicketStatus.svelte";
  import { TicketStatuses } from "$pano/lib/views/parts/ticketStatuses.js";
  import Date from "$pano/lib/components/Date.svelte";

  export let ticket;
  export let onCloseTicket = () => {};
</script>

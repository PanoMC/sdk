<!--
  Default markup of the engine's <TicketCreateAndDetailSidebar> (registry name "TicketCreateAndDetailSidebar",
  contract 1): the cards beside the ticket pages. The controller
  (components/sidebars/TicketCreateAndDetailSidebar.svelte) owns the data, the open ticket and the item list.

  Props:
    side                "left" | "right" - which side of the content the column sits on
    items               store of { id, component, props } - the sidebar items, plugin items included;
                        unknown ids are rendered with <ViewComponent> (the place plugins inject)
    data                store of { onlineAdmins: string[] }
    ticketData          store of the open ticket ({ id, status, ... }) or null on the create page
    onCloseTicketClick  function(ticket) - opens the confirmation for closing the ticket
-->
<Sidebar side={side}>
  <div class="vstack gap-3">
    {#each $items as item (item.id)}
      {#if item.id === 'online-admins'}
        <!-- Online Admins Snippet -->
        <OnlineAdmins onlineAdmins={$data.onlineAdmins} />
      {:else if item.id === 'close-ticket-button'}
        <!-- Close Ticket Button Snippet -->
        {#if $ticketData && $ticketData.status !== TicketStatuses.CLOSED}
          <button
            class="pano-ticket-create-and-detail-sidebar__action btn btn-danger w-100"
            type="button"
            on:click={() => onCloseTicketClick($ticketData)}>
            <i class="fas fa-times me-2"></i>
            {$_("buttons.close-ticket")}
          </button>
        {/if}
      {:else}
        <!-- External Component -->
        <ViewComponent component={item.component} data={$data} ticketData={$ticketData} {...item.props} />
      {/if}
    {/each}
  </div>
</Sidebar>

<script>
  import { _ } from "svelte-i18n";
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import OnlineAdmins from "$pano/lib/components/OnlineAdmins.svelte";
  import { TicketStatuses } from "$pano/lib/views/parts/ticketStatuses.js";

  export let side;
  export let items;
  export let data;
  export let ticketData;
  export let onCloseTicketClick = () => {};
</script>

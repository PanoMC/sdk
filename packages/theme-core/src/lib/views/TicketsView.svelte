<!--
  @view TicketsView
  Controller: $pano/lib/pages/profile/TicketsPage.svelte
  Props:
    data                object — page data from load (pageType, page, totalPage, ticketCount, category, categoryUrl)
    contentItems        store — plugin-extendable content item list for the tickets page
    tickets             store — the tickets list from TicketsPageLogics.init; $tickets to read, the raw store is handed back to onCloseTicketClick
    PageTypes           object — ticket list filter enum (ALL, CLOSED) for the header buttons
    onCloseTicketClick  function — (ticketsStore, ticket) closes a ticket and updates the store
    onPageClick         function — (data, page) navigates to the given pagination page
  Override from a theme:
    theme.config.js → views: { TicketsView: () => import("./src/views/TicketsView.svelte") }
-->
<div class="vstack gap-3">
  {#each $contentItems as item (item.id)}
    {#if item.id === "tickets-card"}
      <div class="card mt-3 mt-lg-0">
        <CardHeader>
          <div slot="left">
            {@html data.categoryUrl
              ? $_("pages.category-tickets.title", {
                  values: {
                    categoryName: `<strong>"${
                      data.category.title === "-"
                        ? $_("pages.category-tickets.no-category")
                        : data.category.title
                    }"</strong>`,
                  },
                })
              : $_("pages.tickets.title")}
          </div>
          <div slot="right" class="btn-group">
            <a
              class="btn btn-outline-primary btn-sm"
              class:active={data.pageType === PageTypes.ALL}
              role="button"
              href="/tickets">
              {$_("pages.tickets.all")}
            </a>
            <a
              class="btn btn-outline-primary btn-sm"
              class:active={data.pageType === PageTypes.CLOSED}
              role="button"
              href="/tickets?pageType=CLOSED">
              {$_("pages.tickets.closed")}
            </a>
          </div>
        </CardHeader>
        <Tickets
          on:closeTicket={(event) =>
            onCloseTicketClick(tickets, event.detail.ticket)}
          tickets={$tickets} />

        {#if data.ticketCount > 0}
          <div class="card-footer">
            <Pagination
              page={data.page}
              totalPage={data.totalPage}
              loading={false}
              on:firstPageClick={() => onPageClick(data, 1)}
              on:lastPageClick={() => onPageClick(data, data.totalPage)}
              on:pageLinkClick={(event) => onPageClick(data, event.detail.page)} />
          </div>
        {/if}
      </div>
    {:else if item.component}
      <!-- External plugin component -->
      <ViewComponent component={item.component} {data} />
    {/if}
  {/each}
</div>

<script>
  import { _ } from "svelte-i18n";

  import Pagination from "$pano/lib/components/Pagination.svelte";
  import CardHeader from "$pano/lib/components/CardHeader.svelte";
  import Tickets from "$pano/lib/components/Tickets.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;
  export let contentItems;
  export let tickets;
  export let PageTypes;
  export let onCloseTicketClick;
  export let onPageClick;
</script>

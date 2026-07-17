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

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/TicketsPageLogics";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    return processLoad(event);
  }
</script>

<script>
  import { _ } from "svelte-i18n";

  import { getContext, onMount } from "svelte";
  import {
    init,
    onCloseTicketClick,
    onPageClick,
    PageTypes,
  } from "$pano/lib/ui-logics/page-logics/TicketsPageLogics";

  import Pagination from "$pano/lib/components/Pagination.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import CardHeader from "$pano/lib/components/CardHeader.svelte";
  import PageActions from "$pano/lib/components/PageActions.svelte";
  import Tickets from "$pano/lib/components/Tickets.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  let tickets;

  const contentItems = panoApiClient.ui.tickets.content.get();

  $: {
    tickets = init(data).tickets;
  }
</script>

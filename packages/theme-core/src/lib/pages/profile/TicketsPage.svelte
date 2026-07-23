<svelte:component
  this={data.View}
  {data}
  {contentItems}
  {tickets}
  {PageTypes}
  {onCloseTicketClick}
  {onPageClick} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/TicketsPageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "TicketsView",
      () => import("../../views/TicketsView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import {
    init,
    onCloseTicketClick,
    onPageClick,
    PageTypes,
  } from "$pano/lib/ui-logics/page-logics/TicketsPageLogics";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import PageActions from "$pano/lib/components/PageActions.svelte";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  let tickets;

  const contentItems = panoApiClient.ui.tickets.content.get();

  $: {
    tickets = init(data).tickets;
  }
</script>

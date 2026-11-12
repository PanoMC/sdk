<svelte:component
  this={data.View}
  data={viewData}
  {contentItems}
  {tickets}
  {PageTypes}
  {onCloseTicketClick}
  {onPageClick} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/TicketsPageLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "TicketsView", () => import("../../views/TicketsView.svelte"))) };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { locale } from "svelte-i18n";
  import {
    init,
    onCloseTicketClick,
    onPageClick,
    PageTypes,
    ticketsPageTitle,
  } from "$pano/lib/ui-logics/page-logics/TicketsPageLogics";
  import { localizeCategory } from "$pano/lib/contentI18n.js";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import PageActions from "$pano/lib/components/PageActions.svelte";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  let tickets;

  const contentItems = panoApiClient.ui.tickets.content.get();

  $: {
    tickets = init(data).tickets;
  }

  // The filtered category's title in the site's current language (view and page title).
  $: viewData = { ...data, category: localizeCategory(data.category, $locale) };

  const pageTitle = getContext("pageTitle");

  onMount(() => {
    let first = true;

    return locale.subscribe((code) => {
      if (first) {
        first = false;
        return;
      }

      pageTitle?.set(ticketsPageTitle(data, code));
    });
  });
</script>

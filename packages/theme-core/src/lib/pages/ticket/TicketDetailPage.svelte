<svelte:component
  this={data.View}
  {data}
  {ticket}
  {messages}
  {message}
  {messageSendLoading}
  {messagesSectionDiv}
  {loadMoreLoading}
  {shouldScroll}
  {sentMessageCount}
  {avatarVersion}
  {loadMore}
  {sendMessage} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/TicketDetailPageLogics.js";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "TicketDetailView", () => import("../../views/TicketDetailView.svelte"))) };
  }
</script>

<script>
  import { avatarVersion } from "$pano/lib/Store";

  import {
    applyTicket,
    init,
    loadMore,
    sendMessage,
  } from "$pano/lib/ui-logics/page-logics/TicketDetailPageLogics";

  export let data;

  const {
    message,
    messageSendLoading,
    messagesSectionDiv,
    loadMoreLoading,
    shouldScroll,
    sentMessageCount,
    messages,
    ticket,
  } = init(data);

  // The stores are filled once, on mount. When the same page loads again (a notification about this
  // ticket clicked while it is open) the new ticket goes into them, so the new messages show.
  let shownTicket = data.ticket;

  $: if (data.ticket !== shownTicket) {
    shownTicket = data.ticket;

    applyTicket({ ticket, messages, sentMessageCount, shouldScroll }, data.ticket);
  }
</script>

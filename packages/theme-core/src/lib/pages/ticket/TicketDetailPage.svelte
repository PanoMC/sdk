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
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "TicketDetailView",
      () => import("../../views/TicketDetailView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { avatarVersion } from "$pano/lib/Store";

  import {
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
</script>

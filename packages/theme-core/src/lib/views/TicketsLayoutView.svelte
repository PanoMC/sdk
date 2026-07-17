<!--
  @view TicketsLayoutView
  Controller: $pano/lib/layouts/TicketsLayout.svelte
  Props:
    data  object — layout load data (parent data; View)
  Slot:
    default — the nested tickets page content, forwarded by the controller
  Override from a theme:
    theme.config.js → views: { TicketsLayoutView: () => import("./src/views/TicketsLayoutView.svelte") }
-->
<!-- Tickets Page -->

<slot />

<CloseTicketConfirmModal />

<script>
  import CloseTicketConfirmModal from "$pano/lib/components/modals/CloseTicketConfirmModal.svelte";

  export let data;
</script>

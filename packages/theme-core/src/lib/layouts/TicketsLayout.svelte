<!-- Tickets Page -->

<slot />

<CloseTicketConfirmModal />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/layout-logics/TicketsLayoutLogics";

  export async function load(event) {
    return await processLoad(event);
  }
</script>

<script>
  import CloseTicketConfirmModal from "$pano/lib/components/modals/CloseTicketConfirmModal.svelte";
</script>

<!--
  Controller of the engine's <TicketRow>. The markup lives in views/parts/TicketRow.svelte; a theme may
  replace it with the "TicketRow" entry of theme.config.js views (see skin-contract.json for the props).
  Dispatches `closeTicket` with { ticket }.
-->
<svelte:component this={getOverride("TicketRow") ?? TicketRowView} ticket={shownTicket} {onCloseTicket} />

<script>
  import { createEventDispatcher } from "svelte";
  import { locale } from "svelte-i18n";

  import { getOverride } from "$pano/registry/index.js";
  import TicketRowView from "$pano/lib/views/parts/TicketRow.svelte";
  import { localizeCategory } from "$pano/lib/contentI18n.js";

  export let ticket;

  // The markup gets the category title in the site's current language (the event keeps the original).
  $: shownTicket =
    ticket?.category && typeof ticket.category === "object"
      ? { ...ticket, category: localizeCategory(ticket.category, $locale) }
      : ticket;

  const dispatch = createEventDispatcher();

  function onCloseTicket() {
    dispatch("closeTicket", { ticket });
  }
</script>

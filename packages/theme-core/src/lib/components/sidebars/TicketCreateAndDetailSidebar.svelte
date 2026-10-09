<!--
  Controller of the engine's <TicketCreateAndDetailSidebar>. The markup lives in views/parts/TicketCreateAndDetailSidebar.svelte; a
  theme may replace it with the "TicketCreateAndDetailSidebar" entry of theme.config.js views (see skin-contract.json
  for the props).
-->
<svelte:component
  this={getOverride("TicketCreateAndDetailSidebar") ?? TicketCreateAndDetailSidebarView}
  {side}
  {items}
  {data}
  {ticketData}
  {onCloseTicketClick} />

<script context="module">
  import { writable } from "svelte/store";
  import ApiUtil from "$pano/lib/api.util.js";
  import { panoApi } from "$pano/lib/PluginAPI";
  import { executeSidebarLoad } from "$pano/lib/PluginAPI";

  const data = writable({
    onlineAdmins: [],
  });
  const ticketData = writable(null);

  export const load = async (event, ticket) => {
    /* Register Defaults */
    panoApi.ui.sidebar.register({
      sidebarId: "ticket",
      id: "online-admins",
      component: "local:online-admins",
      priority: 100,
    });

    panoApi.ui.sidebar.register({
      sidebarId: "ticket",
      id: "close-ticket-button",
      component: "local:close-ticket-button",
      priority: 110,
    });

    // Execute sidebar load and resolve components for SSR
    await executeSidebarLoad('ticket', event);

    // The wire shape is { items: string[] } (decision 80); the view contract keeps { onlineAdmins }.
    const response = await ApiUtil.get({
      path: "/sidebars/support",
      request: event,
    });

    data.set({ onlineAdmins: Array.isArray(response?.items) ? response.items : [] });

    if (ticket) {
      ticketData.set(ticket);
    }
  };

  export const update = (ticket) => {
    ticketData.set(ticket);
  };
</script>

<script>
  import { getOverride } from "$pano/registry/index.js";
  import TicketCreateAndDetailSidebarView from "$pano/lib/views/parts/TicketCreateAndDetailSidebar.svelte";
  import { show as showCloseTicketConfirmModal } from "$pano/lib/components/modals/CloseTicketConfirmModal.svelte";

  export let side;

  const items = panoApi.ui.sidebar.get("ticket");

  const onCloseTicketClick = (ticket) => showCloseTicketConfirmModal(ticket);
</script>

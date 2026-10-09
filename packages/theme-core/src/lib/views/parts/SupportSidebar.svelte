<!--
  Default markup of the engine's <SupportSidebar> (registry name "SupportSidebar", contract 1): the cards
  beside the support page. The controller (components/sidebars/SupportSidebar.svelte) owns the data and
  the item list.

  Props:
    side   "left" | "right" - which side of the content the column sits on
    items  store of { id, component, props } - the sidebar items, plugin items included;
           unknown ids are rendered with <ViewComponent> (the place plugins inject)
    data   store of { onlineAdmins: string[] }
-->
<Sidebar side="{side}">
  <div class="vstack gap-3">
    {#each $items as item (item.id)}
      {#if item.id === 'online-admins'}
        <!-- Online Admins Snippet -->
        <OnlineAdmins onlineAdmins="{$data.onlineAdmins}" />
      {:else}
        <!-- External Component -->
        <ViewComponent component={item.component} data={$data} {...item.props} />
      {/if}
    {/each}
  </div>
</Sidebar>

<script>
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import OnlineAdmins from "$pano/lib/components/OnlineAdmins.svelte";

  export let side;
  export let items;
  export let data;
</script>

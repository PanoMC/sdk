<!--
  Controller of the engine's <Sidebar>. The markup lives in views/parts/Sidebar.svelte; a theme may
  replace it with the "Sidebar" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component this={getOverride("Sidebar") ?? SidebarView} {side}>
  <slot />
</svelte:component>

<script>
  import { getOverride } from "$pano/registry/index.js";
  import SidebarView from "$pano/lib/views/parts/Sidebar.svelte";

  export let side = "right";
</script>

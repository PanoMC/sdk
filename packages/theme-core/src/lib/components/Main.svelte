<!--
  Controller of the engine's <Main>. The markup lives in views/parts/Main.svelte; a theme may
  replace it with the "Main" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component
  this={getOverride("Main") ?? MainView}
  {dev}
  {devUi}
  {pageTitle}
  {resolvedTitle}
  {sidebar}
  {sidebarProps}
  {sidebarEnabled}
  {sidebarPosition}>
  <slot />
</svelte:component>

<script>
  import "@theme-style";
  import { getContext } from "svelte";
  import { dev } from "$app/environment";
  import { _ } from "svelte-i18n";
  import { getOverride } from "$pano/registry/index.js";
  import MainView from "$pano/lib/views/parts/Main.svelte";
  import { resolvePageTitle } from "$pano/lib/pageTitle.util.js";


  const devUi = import.meta.env.VITE_DEV_UI === "true";

  const sidebar = getContext("sidebar");
  const sidebarProps = getContext("sidebarProps");
  const pageTitle = getContext("pageTitle");

  const themeSettings = getContext("themeSettings");

  // `raw` skips translation; `hidden` keeps the title for the document <title> only.
  $: resolvedTitle = resolvePageTitle($pageTitle, $_);

  $: sidebarEnabled =
    typeof themeSettings.sidebarEnabled === "undefined"
      ? true
      : themeSettings.sidebarEnabled;
  $: sidebarPosition =
    typeof themeSettings.sidebarPosition !== "undefined"
      ? themeSettings.sidebarPosition
      : !$sidebarProps.side
        ? "RIGHT"
        : $sidebarProps.side === "left"
          ? "LEFT"
          : "RIGHT";
</script>

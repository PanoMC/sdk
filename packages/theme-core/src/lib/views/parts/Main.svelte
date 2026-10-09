<!--
  Default markup of the engine's <Main> (registry name "Main", contract 1). The controller
  (lib/components/Main.svelte) resolves the theme's override or this file and passes the props below.

  Props:
    dev              boolean - SvelteKit dev flag
    devUi            boolean - true while the theme's UI dev server runs (it serves /style.css itself)
    pageTitle        store - the page's title value (string key or object)
    resolvedTitle    { title, subtitle, hidden } - the translated title
    sidebar          store - the sidebar component for this page (or null)
    sidebarProps     store - props of the sidebar component
    sidebarEnabled   boolean - the theme setting
    sidebarPosition  "LEFT" | "RIGHT"
  Slot: the routed page content.
-->
<svelte:head>
  {#if dev && !devUi}
    <link rel="stylesheet" href={stylesheet} />
  {/if}
</svelte:head>

<!-- Main Container -->
<main class="pano-main container">

  {#if $pageTitle && !resolvedTitle.hidden}
    {@const isString = typeof $pageTitle === "string"}
    <div class="row">
      <div class="col-12 mb-3">
        <PageTitle
          title={resolvedTitle.title}
          subtitle={resolvedTitle.subtitle}
          html={isString ? undefined : $pageTitle.html}
          subtitleHtml={isString ? undefined : $pageTitle.subtitleHtml} />
      </div>
    </div>
  {/if}

  <div class="row gx-3 align-items-start">
    {#if sidebarEnabled}
      <svelte:component
        this={$sidebar}
        {...{
          ...$sidebarProps,
          side: sidebarPosition === "LEFT" ? "left" : "right",
        }} />
    {/if}

    <!-- Content -->
    <div class:col={!sidebarEnabled} class:col-lg-8={sidebarEnabled && $sidebar}>
      <slot />
    </div>
    <!-- Content End -->
  </div>
</main>

<!-- Main Container End -->
<script>
  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let dev = false;
  export let devUi = false;
  export let pageTitle;
  export let resolvedTitle;
  export let sidebar;
  export let sidebarProps;
  export let sidebarEnabled = true;
  export let sidebarPosition = "RIGHT";

  // The theme's compiled stylesheet, served by the dev server only (a static asset, not a route).
  const stylesheet = "/style.css";
</script>

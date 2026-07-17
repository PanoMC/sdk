

<svelte:head>
  {#if dev && !devUi}
    <link rel="stylesheet" href="/style.css" />
  {/if}
</svelte:head>

<!-- Main Container -->
<main class="container">

  {#if $pageTitle}
    {@const isString = typeof $pageTitle === "string"}
    {@const
      titleText = isString ? $_($pageTitle) : ($pageTitle?.title ? $_($pageTitle.title, { values: $pageTitle.titleValues || {} }) : "")}
    {@const
      subtitleText = isString ? "" : ($pageTitle?.subtitle ? $_($pageTitle.subtitle, { values: $pageTitle.subtitleValues || {} }) : "")}
    <div class="row">
      <div class="col-12 mb-3">
        <PageTitle
          title={titleText}
          subtitle={subtitleText}
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
  import "@theme-style";
  import { getContext } from "svelte";
  import { dev } from "$app/environment";
  import { _ } from "svelte-i18n";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";


  const devUi = import.meta.env.VITE_DEV_UI === "true";

  const sidebar = getContext("sidebar");
  const sidebarProps = getContext("sidebarProps");
  const pageTitle = getContext("pageTitle");

  const themeSettings = getContext("themeSettings");

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

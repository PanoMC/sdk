<script>
  import { onMount, setContext } from "svelte";
  import { page } from "$app/stores";
  import { browser } from "$app/environment";
  import { markAvatarVersionHydrated } from "$pano/lib/avatarVersion.js";
  import { markAppBooted } from "$pano/kit/hooks-client.js";
  import AppLayout from "$pano/lib/layouts/AppLayout.svelte";
  import FallbackLinks from "$pano/lib/components/FallbackLinks.svelte";
  import MainLayout from "$pano/lib/layouts/MainLayout.svelte";
  import { getThemeProvides } from "$pano/registry/index.js";
  import {
    createFallbackStyles,
    setActiveFallbackStyles,
    STYLES_CONTEXT,
  } from "$pano/lib/fallbackStyles.js";

  export let data;

  // The stylesheets of the plugin views this render uses (doc 03 section 4.4): views add keys while they render,
  // the links below are rendered after the page, so the server has collected every key by then.
  const styles = createFallbackStyles({ browser });

  setContext(STYLES_CONTEXT, styles);
  setActiveFallbackStyles(styles);

  $: provides = getThemeProvides();
  $: plugins = data.pluginStyles ?? {};

  $: isThemeSettings = $page.route.id?.includes("(theme-settings)");
  $: isResetLayout = $page.data.resetLayout;
  $: showMainLayout = !isThemeSettings && !isResetLayout;

  onMount(() => {
    markAvatarVersionHydrated();
    // Arms the hydration watchdog's "booted" state only after the page really rendered. An
    // error render (a route chunk that failed to load) keeps it unarmed so the watchdog can
    // still issue its one recovery reload.
    if (!$page.error) {
      markAppBooted();
    }
  });
</script>

<AppLayout {data}>
  {#if showMainLayout}
    <MainLayout>
      <slot />
    </MainLayout>
  {:else}
    <slot />
  {/if}
</AppLayout>

<!-- after the page: a child component runs where it is placed, so the server has collected every key (FallbackLinks) -->
<FallbackLinks {styles} {plugins} {provides} />

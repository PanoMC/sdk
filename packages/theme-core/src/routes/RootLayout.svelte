<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { markAppBooted } from "$pano/kit/hooks-client.js";
  import AppLayout from "$pano/lib/layouts/AppLayout.svelte";
  import MainLayout from "$pano/lib/layouts/MainLayout.svelte";

  export let data;

  $: isThemeSettings = $page.route.id?.includes("(theme-settings)");
  $: isResetLayout = $page.data.resetLayout;
  $: showMainLayout = !isThemeSettings && !isResetLayout;

  onMount(() => {
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

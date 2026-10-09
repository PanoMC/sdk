{#if data.homeKind === "page"}
  <svelte:component this={data.HomeComponent} {data} />
{:else if data.homeKind === "path"}
  <Page {data} />
{:else}
  <svelte:component this={data.View} {data} {themeSettings} {onPageClick} />
{/if}

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/HomePageLogics";
  import { loadView } from "$pano/registry/index.js";
  import { registeredPages, findMatch } from "$pano/lib/PluginManager.js";
  import { hasPermission } from "$pano/lib/auth.util.js";
  import { resolveHomeFor } from "$pano/lib/home.js";
  import { loadHomeTarget } from "$pano/routes/plugin-ui/load.js";
  import Page, { sidebarDeps } from "$pano/routes/plugin-ui/Page.svelte";

  /**
   * `/` shows what the admin picked as the home page (the posts feed unless a plugin page or a page of the
   * theme was picked); `/posts` is the same controller and always shows the feed (doc 01 section 9).
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    const home = await resolveHomeFor(event, () => registeredPages);

    if (home.kind === "page" || home.kind === "path") {
      const target = await loadHomeTarget(event, home, {
        sidebar: sidebarDeps,
        hasPermission,
        findPage: (path) => findMatch(registeredPages, path),
      });

      // null: the page cannot be shown to this visitor, the feed is shown instead
      if (target) {
        return target;
      }
    }

    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const data = await processLoad(event);

    return { ...data, ...(await loadView(event, "HomeView", () => import("../views/HomeView.svelte"))) };
  }
</script>

<script>
  import { getContext } from "svelte";

  import { onPageClick } from "$pano/lib/ui-logics/page-logics/HomePageLogics";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let data;

  const themeSettings = getContext("themeSettings");
</script>

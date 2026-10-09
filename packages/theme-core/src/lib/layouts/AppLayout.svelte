<PageHead
  meta={$page.data?.meta}
  siteInfo={$session.siteInfo}
  url={$page.url}
  title={resolvePageTitle($pageTitle, $_).title} />

<svelte:component this={layoutView} data={viewData} {session} {pageTitle} {getTitle}>
  <slot />
</svelte:component>

<script context="module">
  import { processLoad, processServerLoad } from "$pano/lib/ui-logics/layout-logics/AppLayoutLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import("@sveltejs/kit").LayoutServerLoad}
   */
  export async function loadServer(event) {
    return await processServerLoad(event);
  }

  /**
   * @type {import("@sveltejs/kit").LayoutLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const data = await processLoad(event);

    const { View, ...blocks } = await loadView(
      event,
      "AppLayoutView",
      () => import("../views/AppLayoutView.svelte"),
    );

    return { ...data, ...blocks, appLayoutView: View };
  }
</script>

<script>
  import { page } from "$app/stores";
  import { _ } from "svelte-i18n";
  import { init } from "$pano/lib/ui-logics/layout-logics/AppLayoutLogics";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { avatarVersion } from "$pano/lib/Store.js";
  import PageHead from "$pano/lib/components/PageHead.svelte";
  import { resolvePageTitle } from "$pano/lib/pageTitle.util.js";

  export let data = undefined;

  const { session, pageTitle } = init(data);

  function getTitle(pt, siteName) {
    if (!pt) return siteName;
    // `raw` titles are used verbatim; `hidden` only affects the visible <PageTitle>.
    const { title: titleStr } = resolvePageTitle(pt, $_);
    return `${titleStr} \u2014 ${siteName}`;
  }

  // Layout view resolution: every layout uses a UNIQUE data key (appLayoutView)
  // because SvelteKit merges all layout+page load results into one bag —
  // a generic `View` key gets clobbered by deeper layouts/pages.
  $: viewData = data ?? $page.data;
  $: layoutView = viewData?.appLayoutView ?? $page.data.appLayoutView;
</script>

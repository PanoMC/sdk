<App>
  <slot></slot>
</App>

<ToastContainer />

<script context="module">
  import { processLoad, processServerLoad } from "$pano/lib/ui-logics/layout-logics/AppLayoutLogics";

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
    return await processLoad(event);
  }
</script>

<script>
  import { _ } from "svelte-i18n";
  import { init } from "$pano/lib/ui-logics/layout-logics/AppLayoutLogics";
  import App from "$pano/lib/components/App.svelte";
  import ToastContainer from "$pano/lib/components/ToastContainer.svelte";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { avatarVersion } from "$pano/lib/Store.js";

  export let data;

  const { session, pageTitle } = init(data);

  function getTitle(pt, siteName) {
    if (!pt) return siteName;
    const titleStr = typeof pt === "string"
      ? $_(pt)
      : (pt.title ? $_(pt.title, { values: pt.titleValues || {} }) : "");
    return `${titleStr} \u2014 ${siteName}`;
  }
</script>

<svelte:head>
  <link href="/api/favicon?hash={$session.siteInfo.faviconHash}" rel="icon" />
  <title>{getTitle($pageTitle, $session.siteInfo.websiteName)}</title>
</svelte:head>
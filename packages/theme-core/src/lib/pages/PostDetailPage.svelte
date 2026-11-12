<svelte:component this={data.View} data={viewData} {themeSettings} {avatarVersion} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/PostDetailPageLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const data = await processLoad(event);

    return { ...data, ...(await loadView(event, "PostDetailView", () => import("../views/PostDetailView.svelte"))) };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { locale } from "svelte-i18n";

  import { avatarVersion } from "$pano/lib/Store";
  import { localizePost } from "$pano/lib/contentI18n.js";
  import { postPageTitle } from "$pano/lib/ui-logics/page-logics/PostDetailPageLogics";

  import { truncate } from "$pano/lib/string.util";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let data;

  const themeSettings = getContext("themeSettings");
  const session = getContext("session");

  // The post (title, HTML text, category) and the previous / next links in the site's current language
  // (translated content, `i18n`), so an overriding PostDetailView gets them localized too.
  $: viewData = {
    ...data,
    post: localizePost(data.post, $locale),
    previousPost: localizePost(data.previousPost, $locale),
    nextPost: localizePost(data.nextPost, $locale),
  };

  // Switching the site language re-reads the page title: the post title is translated content.
  const pageTitle = getContext("pageTitle");

  onMount(() => {
    let first = true;

    return locale.subscribe((code) => {
      if (first) {
        first = false;
        return;
      }

      pageTitle?.set(postPageTitle(data.post, code));
    });
  });
</script>

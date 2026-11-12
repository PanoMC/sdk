<!--
  Controller of the engine's <Posts>. The markup lives in views/parts/Posts.svelte; a theme may
  replace it with the "Posts" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component this={getOverride("Posts") ?? PostsView} posts={localizePosts(posts, $locale)} />

<script>
  import { locale } from "svelte-i18n";

  import { localizePosts } from "$pano/lib/contentI18n.js";
  import { getOverride } from "$pano/registry/index.js";
  import PostsView from "$pano/lib/views/parts/Posts.svelte";

  // Posts in the site's current language (translated content, `i18n`); posts that are already
  // localized are localized again from their original, so a page may hand in either.
  export let posts;
</script>

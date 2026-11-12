<!--
  Controller of the engine's <Post>. The markup lives in views/parts/Post.svelte; a theme may
  replace it with the "Post" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component
  this={getOverride("Post") ?? PostView}
  post={localizePost(post, $locale)}
  {detail}
  {themeSettings}
  {avatarVersion} />

<script>
  import { getContext } from "svelte";
  import { locale } from "svelte-i18n";

  import { localizePost } from "$pano/lib/contentI18n.js";

  import { getOverride } from "$pano/registry/index.js";
  import { avatarVersion } from "$pano/lib/Store";
  import PostView from "$pano/lib/views/parts/Post.svelte";

  // The post in the site's current language (translated content, `i18n`); an already localized post
  // is localized again from its original.
  export let post;
  export let detail = false;

  const themeSettings = getContext("themeSettings");
</script>

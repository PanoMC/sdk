<!--
  Controller of the engine's <Post>. The markup lives in views/parts/Post.svelte; a theme may
  replace it with the "Post" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component
  this={getOverride("Post") ?? PostView}
  {post}
  {detail}
  {themeSettings}
  {avatarVersion} />

<script>
  import { getContext } from "svelte";

  import { getOverride } from "$pano/registry/index.js";
  import { avatarVersion } from "$pano/lib/Store";
  import PostView from "$pano/lib/views/parts/Post.svelte";

  export let post;
  export let detail = false;

  const themeSettings = getContext("themeSettings");
</script>

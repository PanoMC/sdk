<!--
  Controller of the engine's <Posts>. The markup lives in views/parts/Posts.svelte; a theme may
  replace it with the "Posts" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component this={getOverride("Posts") ?? PostsView} {posts} />

<script>
  import { getOverride } from "$pano/registry/index.js";
  import PostsView from "$pano/lib/views/parts/Posts.svelte";

  export let posts;
</script>

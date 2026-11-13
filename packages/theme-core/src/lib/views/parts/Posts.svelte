<!--
  Default markup of the engine's <Posts> (registry name "Posts", contract 1).

  Props:
    posts  array - post objects, see Post
-->
<div class="pano-posts row g-3">
  {#each posts as post, index (post)}
    <div class="col-md-6">
      <Post post="{post}" />
    </div>
  {/each}
</div>

<!-- Post Card End -->
<script>
  import Post from "$pano/lib/components/Post.svelte";

  export let posts;
</script>

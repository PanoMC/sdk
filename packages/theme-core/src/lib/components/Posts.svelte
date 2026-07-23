<div class="row g-3">
  {#each posts as post, index (post)}
    <div class="col-md-6">
      <Post post="{post}" />
    </div>
  {:else}
    <div class="col-12">
      <NoContent />
    </div>
  {/each}
</div>

<!-- Post Card End -->
<script>
  import Post from "$pano/lib/components/Post.svelte";
  import NoContent from "$pano/lib/components/NoContent.svelte";

  export let posts;
</script>

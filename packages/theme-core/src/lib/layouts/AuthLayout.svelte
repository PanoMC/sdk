<style>
  .container {
    max-width: 400px !important;
  }
</style>

<div class="container mx-auto">
  <slot />
</div>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/layout-logics/AuthLayoutLogics";

  export async function load(event) {
    return await processLoad(event);
  }
</script>
